import { NotFoundError } from '../../../platform/errors/problem-details.js';
import type { InMemoryOrderRepository } from '../../order/infrastructure/in-memory-order.repository.js';
import type { PaymentRecord } from '../domain/payment.entity.js';
import type {
  InitiatePaymentParams,
  PaymentProcessOutcome,
  PaymentRepositoryPort,
  RecordPaymentResultParams,
} from '../domain/payment.repository.port.js';

export class InMemoryPaymentRepository implements PaymentRepositoryPort {
  private readonly payments = new Map<string, PaymentRecord>();
  public readonly outboxEvents: Array<{
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }> = [];

  constructor(private readonly orderRepository?: InMemoryOrderRepository) {}

  async initiatePayment(params: InitiatePaymentParams): Promise<PaymentRecord> {
    const payment: PaymentRecord = {
      id: params.paymentId,
      orderId: params.orderId,
      amount: params.amount,
      provider: params.provider ?? 'simulator',
      status: 'PENDING',
      createdAt: new Date(),
    };

    this.payments.set(payment.id, payment);
    return payment;
  }

  async recordSuccessfulPayment(params: RecordPaymentResultParams): Promise<PaymentProcessOutcome> {
    // Check if order exists
    if (this.orderRepository) {
      const order = await this.orderRepository.findById(params.orderId);
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

      // Transition order status to PAID
      await this.orderRepository.updateStatus(order.id, 'PAID');

      // Transition seats to SOLD
      for (const item of order.items) {
        const seat = this.orderRepository.getSeat(item.seatId);
        if (seat) {
          seat.status = 'SOLD';
        }
      }

      this.outboxEvents.push({
        aggregateType: 'ORDER',
        aggregateId: order.id,
        eventType: 'order.paid',
        payload: {
          orderId: order.id,
          userId: order.userId,
          eventId: order.eventId,
          totalAmount: order.totalAmount,
          seatIds: order.items.map((i) => i.seatId),
          externalId: params.externalId,
        },
      });
    }

    // Update payment record if exists or create one
    let payment = await this.findByOrderId(params.orderId);
    if (!payment) {
      payment = {
        id: `pay-${params.orderId}`,
        orderId: params.orderId,
        externalId: params.externalId,
        provider: 'simulator',
        amount: 0,
        status: 'PAID',
        signature: params.signature,
        createdAt: new Date(),
      };
      this.payments.set(payment.id, payment);
    } else {
      payment.status = 'PAID';
      payment.externalId = params.externalId;
      payment.signature = params.signature;
    }

    return {
      orderId: params.orderId,
      status: 'PAID',
      alreadyProcessed: false,
    };
  }

  async recordFailedPayment(params: RecordPaymentResultParams): Promise<PaymentProcessOutcome> {
    if (this.orderRepository) {
      const order = await this.orderRepository.findById(params.orderId);
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

      await this.orderRepository.updateStatus(order.id, 'CANCELLED');

      for (const item of order.items) {
        const seat = this.orderRepository.getSeat(item.seatId);
        if (seat) {
          seat.status = 'AVAILABLE';
        }
      }

      this.outboxEvents.push({
        aggregateType: 'ORDER',
        aggregateId: order.id,
        eventType: 'order.cancelled',
        payload: {
          orderId: order.id,
          reason: 'PAYMENT_FAILED',
        },
      });
    }

    let payment = await this.findByOrderId(params.orderId);
    if (!payment) {
      payment = {
        id: `pay-${params.orderId}`,
        orderId: params.orderId,
        externalId: params.externalId,
        provider: 'simulator',
        amount: 0,
        status: 'FAILED',
        signature: params.signature,
        createdAt: new Date(),
      };
      this.payments.set(payment.id, payment);
    } else {
      payment.status = 'FAILED';
      payment.externalId = params.externalId;
      payment.signature = params.signature;
    }

    return {
      orderId: params.orderId,
      status: 'CANCELLED',
      alreadyProcessed: false,
    };
  }

  async findById(paymentId: string): Promise<PaymentRecord | null> {
    const payment = this.payments.get(paymentId);
    return payment ? { ...payment } : null;
  }

  async findByOrderId(orderId: string): Promise<PaymentRecord | null> {
    for (const payment of this.payments.values()) {
      if (payment.orderId === orderId) {
        return { ...payment };
      }
    }
    return null;
  }
}
