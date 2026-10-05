import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '../../../platform/db/schema.js';
import { NotFoundError } from '../../../platform/errors/problem-details.js';
import { assertValidOrderTransition, type OrderStatus } from '../../order/index.js';
import type { PaymentRecord, PaymentStatus } from '../domain/payment.entity.js';
import type {
  InitiatePaymentParams,
  PaymentProcessOutcome,
  PaymentRepositoryPort,
  RecordPaymentResultParams,
} from '../domain/payment.repository.port.js';

export class DrizzlePaymentRepository implements PaymentRepositoryPort {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async initiatePayment(params: InitiatePaymentParams): Promise<PaymentRecord> {
    const now = new Date();
    await this.db.insert(schema.payments).values({
      id: params.paymentId,
      orderId: params.orderId,
      amount: params.amount,
      provider: params.provider ?? 'simulator',
      status: 'PENDING',
      createdAt: now,
    });

    return {
      id: params.paymentId,
      orderId: params.orderId,
      amount: params.amount,
      provider: params.provider ?? 'simulator',
      status: 'PENDING',
      createdAt: now,
    };
  }

  async recordSuccessfulPayment(params: RecordPaymentResultParams): Promise<PaymentProcessOutcome> {
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      // 1. Fetch order
      const orderRows = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, params.orderId))
        .limit(1);

      const order = orderRows[0];
      if (!order) {
        throw new NotFoundError('Order not found.');
      }

      // Idempotency: if already PAID, return alreadyProcessed: true
      if (order.status === 'PAID') {
        return {
          orderId: params.orderId,
          status: 'PAID',
          alreadyProcessed: true,
        };
      }

      assertValidOrderTransition(order.status as OrderStatus, 'PAID');

      // 2. Update order to PAID
      await tx
        .update(schema.orders)
        .set({
          status: 'PAID',
          updatedAt: now,
        })
        .where(eq(schema.orders.id, params.orderId));

      // 3. Find seats in order and update to SOLD
      const orderItems = await tx
        .select({ seatId: schema.orderItems.seatId })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, params.orderId));

      const seatIds = orderItems.map((i) => i.seatId);

      if (seatIds.length > 0) {
        await tx
          .update(schema.seats)
          .set({
            status: 'SOLD',
            updatedAt: now,
          })
          .where(inArray(schema.seats.id, seatIds));
      }

      // 4. Update or insert payment row
      const existingPayment = await tx
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, params.orderId))
        .limit(1);

      if (existingPayment[0]) {
        await tx
          .update(schema.payments)
          .set({
            status: 'PAID',
            externalId: params.externalId,
            signature: params.signature,
          })
          .where(eq(schema.payments.id, existingPayment[0].id));
      } else {
        await tx.insert(schema.payments).values({
          id: uuidv7(),
          orderId: params.orderId,
          externalId: params.externalId,
          provider: 'simulator',
          amount: order.totalAmount,
          status: 'PAID',
          signature: params.signature,
          createdAt: now,
        });
      }

      // 5. Insert transactional outbox event
      await tx.insert(schema.outboxEvents).values({
        id: uuidv7(),
        aggregateType: 'ORDER',
        aggregateId: params.orderId,
        eventType: 'order.paid',
        payload: {
          orderId: params.orderId,
          userId: order.userId,
          eventId: order.eventId,
          totalAmount: order.totalAmount,
          seatIds,
          externalId: params.externalId,
        },
        status: 'PENDING',
        createdAt: now,
      });

      return {
        orderId: params.orderId,
        status: 'PAID',
        alreadyProcessed: false,
      };
    });
  }

  async recordFailedPayment(params: RecordPaymentResultParams): Promise<PaymentProcessOutcome> {
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      const orderRows = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, params.orderId))
        .limit(1);

      const order = orderRows[0];
      if (!order) {
        throw new NotFoundError('Order not found.');
      }

      if (order.status === 'CANCELLED') {
        return {
          orderId: params.orderId,
          status: 'CANCELLED',
          alreadyProcessed: true,
        };
      }

      assertValidOrderTransition(order.status as OrderStatus, 'CANCELLED');

      // Update order to CANCELLED
      await tx
        .update(schema.orders)
        .set({
          status: 'CANCELLED',
          updatedAt: now,
        })
        .where(eq(schema.orders.id, params.orderId));

      // Release seats back to AVAILABLE
      const orderItems = await tx
        .select({ seatId: schema.orderItems.seatId })
        .from(schema.orderItems)
        .where(eq(schema.orderItems.orderId, params.orderId));

      const seatIds = orderItems.map((i) => i.seatId);

      if (seatIds.length > 0) {
        await tx
          .update(schema.seats)
          .set({
            status: 'AVAILABLE',
            heldBy: null,
            expiresAt: null,
            updatedAt: now,
          })
          .where(inArray(schema.seats.id, seatIds));
      }

      // Update or insert payment row
      const existingPayment = await tx
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, params.orderId))
        .limit(1);

      if (existingPayment[0]) {
        await tx
          .update(schema.payments)
          .set({
            status: 'FAILED',
            externalId: params.externalId,
            signature: params.signature,
          })
          .where(eq(schema.payments.id, existingPayment[0].id));
      } else {
        await tx.insert(schema.payments).values({
          id: uuidv7(),
          orderId: params.orderId,
          externalId: params.externalId,
          provider: 'simulator',
          amount: order.totalAmount,
          status: 'FAILED',
          signature: params.signature,
          createdAt: now,
        });
      }

      // Record outbox cancellation
      await tx.insert(schema.outboxEvents).values({
        id: uuidv7(),
        aggregateType: 'ORDER',
        aggregateId: params.orderId,
        eventType: 'order.cancelled',
        payload: {
          orderId: params.orderId,
          reason: 'PAYMENT_FAILED',
        },
        status: 'PENDING',
        createdAt: now,
      });

      return {
        orderId: params.orderId,
        status: 'CANCELLED',
        alreadyProcessed: false,
      };
    });
  }

  async findById(paymentId: string): Promise<PaymentRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      orderId: row.orderId,
      externalId: row.externalId ?? undefined,
      provider: row.provider,
      amount: row.amount,
      status: row.status as PaymentStatus,
      signature: row.signature ?? undefined,
      createdAt: row.createdAt,
    };
  }

  async findByOrderId(orderId: string): Promise<PaymentRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      orderId: row.orderId,
      externalId: row.externalId ?? undefined,
      provider: row.provider,
      amount: row.amount,
      status: row.status as PaymentStatus,
      signature: row.signature ?? undefined,
      createdAt: row.createdAt,
    };
  }
}
