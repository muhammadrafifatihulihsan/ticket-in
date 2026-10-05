import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '../../../platform/db/schema.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../platform/errors/problem-details.js';
import {
  assertValidOrderTransition,
  type OrderStatus,
  type OrderWithItems,
} from '../domain/order.entity.js';
import type {
  CreateOrderParams,
  OrderRepositoryPort,
} from '../domain/order.repository.port.js';

export class DrizzleOrderRepository implements OrderRepositoryPort {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async createOrderFromHold(params: CreateOrderParams): Promise<OrderWithItems> {
    const targetHoldIds = params.holdIds ?? (params.holdId ? [params.holdId] : []);
    if (targetHoldIds.length === 0) {
      throw new ValidationError('holdId or holdIds must be provided.');
    }

    const now = new Date();

    return await this.db.transaction(async (tx) => {
      // 1. Fetch hold records
      const holds = await tx
        .select()
        .from(schema.seatHolds)
        .where(inArray(schema.seatHolds.id, targetHoldIds));

      if (holds.length === 0) {
        throw new NotFoundError('Reservation hold not found.');
      }

      // 2. Validate hold ownership, status, and expiration
      for (const hold of holds) {
        if (hold.userId !== params.userId) {
          throw new ForbiddenError('You do not own this reservation hold.');
        }
        if (hold.status !== 'ACTIVE') {
          throw new ConflictError('Reservation hold is not active.');
        }
        if (hold.expiresAt.getTime() <= now.getTime()) {
          throw new ConflictError('Reservation hold has expired.');
        }
      }

      const seatIds = holds.map((h) => h.seatId);

      // 3. Fetch seat details with category prices
      const seatRows = await tx
        .select({
          id: schema.seats.id,
          eventId: schema.seats.eventId,
          seatNumber: schema.seats.seatNumber,
          price: schema.seatCategories.price,
          categoryName: schema.seatCategories.name,
        })
        .from(schema.seats)
        .innerJoin(
          schema.seatCategories,
          eq(schema.seats.categoryId, schema.seatCategories.id),
        )
        .where(inArray(schema.seats.id, seatIds));

      if (seatRows.length < seatIds.length) {
        throw new NotFoundError('One or more held seats could not be found.');
      }

      const firstSeat = seatRows[0]!;
      const eventId = firstSeat.eventId;
      const totalAmount = seatRows.reduce((sum: number, s) => sum + s.price, 0);

      // 4. Transition holds to CONVERTED_TO_ORDER
      await tx
        .update(schema.seatHolds)
        .set({ status: 'CONVERTED_TO_ORDER' })
        .where(inArray(schema.seatHolds.id, targetHoldIds));

      // 5. Transition seats from HELD to RESERVED
      await tx
        .update(schema.seats)
        .set({
          status: 'RESERVED',
          updatedAt: now,
        })
        .where(inArray(schema.seats.id, seatIds));

      // 6. Insert Order
      await tx.insert(schema.orders).values({
        id: params.orderId,
        userId: params.userId,
        eventId,
        status: 'PENDING',
        totalAmount,
        expiresAt: params.expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      // 7. Insert Order Items
      const orderItemInserts = seatRows.map((s) => ({
        id: uuidv7(),
        orderId: params.orderId,
        seatId: s.id,
        price: s.price,
        createdAt: now,
      }));

      await tx.insert(schema.orderItems).values(orderItemInserts);

      // 8. Insert Transactional Outbox Event
      await tx.insert(schema.outboxEvents).values({
        id: uuidv7(),
        aggregateType: 'ORDER',
        aggregateId: params.orderId,
        eventType: 'order.created',
        payload: {
          orderId: params.orderId,
          userId: params.userId,
          eventId,
          totalAmount,
          seatIds,
          expiresAt: params.expiresAt.toISOString(),
        },
        status: 'PENDING',
        createdAt: now,
      });

      // 9. Format return structure
      const items = seatRows.map((s, idx: number) => ({
        id: orderItemInserts[idx]!.id,
        orderId: params.orderId,
        seatId: s.id,
        price: s.price,
        seatNumber: s.seatNumber,
        seatCategoryName: s.categoryName,
        createdAt: now,
      }));

      return {
        id: params.orderId,
        userId: params.userId,
        eventId,
        status: 'PENDING',
        totalAmount,
        expiresAt: params.expiresAt,
        createdAt: now,
        updatedAt: now,
        items,
      };
    });
  }

  async findById(orderId: string): Promise<OrderWithItems | null> {
    const orderRows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    const orderRecord = orderRows[0];
    if (!orderRecord) {
      return null;
    }

    const itemRows = await this.db
      .select({
        id: schema.orderItems.id,
        orderId: schema.orderItems.orderId,
        seatId: schema.orderItems.seatId,
        price: schema.orderItems.price,
        createdAt: schema.orderItems.createdAt,
        seatNumber: schema.seats.seatNumber,
        seatCategoryName: schema.seatCategories.name,
      })
      .from(schema.orderItems)
      .innerJoin(schema.seats, eq(schema.orderItems.seatId, schema.seats.id))
      .innerJoin(
        schema.seatCategories,
        eq(schema.seats.categoryId, schema.seatCategories.id),
      )
      .where(eq(schema.orderItems.orderId, orderId));

    return {
      id: orderRecord.id,
      userId: orderRecord.userId,
      eventId: orderRecord.eventId,
      status: orderRecord.status as OrderStatus,
      totalAmount: orderRecord.totalAmount,
      expiresAt: orderRecord.expiresAt,
      createdAt: orderRecord.createdAt,
      updatedAt: orderRecord.updatedAt,
      items: itemRows.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        seatId: item.seatId,
        price: item.price,
        seatNumber: item.seatNumber,
        seatCategoryName: item.seatCategoryName,
        createdAt: item.createdAt,
      })),
    };
  }

  async findByUserId(userId: string): Promise<OrderWithItems[]> {
    const orderRecords = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.userId, userId))
      .orderBy(desc(schema.orders.createdAt));

    const results: OrderWithItems[] = [];

    for (const order of orderRecords) {
      const itemRows = await this.db
        .select({
          id: schema.orderItems.id,
          orderId: schema.orderItems.orderId,
          seatId: schema.orderItems.seatId,
          price: schema.orderItems.price,
          createdAt: schema.orderItems.createdAt,
          seatNumber: schema.seats.seatNumber,
          seatCategoryName: schema.seatCategories.name,
        })
        .from(schema.orderItems)
        .innerJoin(schema.seats, eq(schema.orderItems.seatId, schema.seats.id))
        .innerJoin(
          schema.seatCategories,
          eq(schema.seats.categoryId, schema.seatCategories.id),
        )
        .where(eq(schema.orderItems.orderId, order.id));

      results.push({
        id: order.id,
        userId: order.userId,
        eventId: order.eventId,
        status: order.status as OrderStatus,
        totalAmount: order.totalAmount,
        expiresAt: order.expiresAt,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        items: itemRows.map((item) => ({
          id: item.id,
          orderId: item.orderId,
          seatId: item.seatId,
          price: item.price,
          seatNumber: item.seatNumber,
          seatCategoryName: item.seatCategoryName,
          createdAt: item.createdAt,
        })),
      });
    }

    return results;
  }

  async cancelExpiredOrders(now: Date): Promise<number> {
    return await this.db.transaction(async (tx) => {
      // Find pending orders with expiresAt <= now
      const expiredOrders = await tx
        .select()
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.status, 'PENDING'),
            lte(schema.orders.expiresAt, now),
          ),
        );

      if (expiredOrders.length === 0) {
        return 0;
      }

      const expiredOrderIds = expiredOrders.map((o) => o.id);

      // Find all seatIds in these orders
      const items = await tx
        .select({ seatId: schema.orderItems.seatId })
        .from(schema.orderItems)
        .where(inArray(schema.orderItems.orderId, expiredOrderIds));

      const seatIds = items.map((i) => i.seatId);

      // Mark orders as CANCELLED
      await tx
        .update(schema.orders)
        .set({
          status: 'CANCELLED',
          updatedAt: now,
        })
        .where(inArray(schema.orders.id, expiredOrderIds));

      // Release seats back to AVAILABLE
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

      // Record outbox events for cancellations
      for (const order of expiredOrders) {
        await tx.insert(schema.outboxEvents).values({
          id: uuidv7(),
          aggregateType: 'ORDER',
          aggregateId: order.id,
          eventType: 'order.cancelled',
          payload: {
            orderId: order.id,
            reason: 'PAYMENT_EXPIRED',
          },
          status: 'PENDING',
          createdAt: now,
        });
      }

      return expiredOrders.length;
    });
  }

  async updateStatus(orderId: string, status: OrderStatus): Promise<void> {
    const order = await this.findById(orderId);
    if (!order) {
      throw new NotFoundError('Order not found.');
    }
    assertValidOrderTransition(order.status, status);

    await this.db
      .update(schema.orders)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, orderId));
  }
}
