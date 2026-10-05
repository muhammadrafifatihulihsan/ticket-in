import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../platform/errors/problem-details.js';
import type { SeatHoldStatus, SeatStatus } from '../../inventory/domain/seat.entity.js';
import {
  assertValidOrderTransition,
  type OrderStatus,
  type OrderWithItems,
} from '../domain/order.entity.js';
import type {
  CreateOrderParams,
  OrderRepositoryPort,
} from '../domain/order.repository.port.js';

export interface InMemoryHoldRecord {
  id: string;
  userId: string;
  eventId: string;
  status: SeatHoldStatus;
  expiresAt: Date;
  seatIds: string[];
}

export interface InMemorySeatRecord {
  id: string;
  eventId: string;
  seatNumber: string;
  categoryName: string;
  price: number;
  status: SeatStatus;
}

export class InMemoryOrderRepository implements OrderRepositoryPort {
  private readonly orders = new Map<string, OrderWithItems>();
  private readonly holds = new Map<string, InMemoryHoldRecord>();
  private readonly seats = new Map<string, InMemorySeatRecord>();
  public readonly outboxEvents: Array<{
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }> = [];
  public artificialDelayMs = 0;

  constructor(
    initialHolds: InMemoryHoldRecord[] = [],
    initialSeats: InMemorySeatRecord[] = [],
  ) {
    for (const hold of initialHolds) {
      this.holds.set(hold.id, { ...hold });
    }
    for (const seat of initialSeats) {
      this.seats.set(seat.id, { ...seat });
    }
  }

  setHold(hold: InMemoryHoldRecord): void {
    this.holds.set(hold.id, { ...hold });
  }

  setSeat(seat: InMemorySeatRecord): void {
    this.seats.set(seat.id, { ...seat });
  }

  setOrder(order: OrderWithItems): void {
    this.orders.set(order.id, { ...order, items: [...order.items] });
  }

  getHold(id: string): InMemoryHoldRecord | undefined {
    return this.holds.get(id);
  }

  getSeat(id: string): InMemorySeatRecord | undefined {
    return this.seats.get(id);
  }

  async createOrderFromHold(params: CreateOrderParams): Promise<OrderWithItems> {
    if (this.artificialDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.artificialDelayMs));
    }

    const targetHoldId = params.holdId ?? (params.holdIds?.[0]);
    if (!targetHoldId) {
      throw new NotFoundError('Reservation hold not found.');
    }
    const hold = this.holds.get(targetHoldId);
    if (!hold) {
      throw new NotFoundError('Reservation hold not found.');
    }

    if (hold.userId !== params.userId) {
      throw new ForbiddenError('You do not own this reservation hold.');
    }

    if (hold.status !== 'ACTIVE') {
      throw new ConflictError('Reservation hold is not active.');
    }

    const now = new Date();
    if (hold.expiresAt.getTime() <= now.getTime()) {
      throw new ConflictError('Reservation hold has expired.');
    }

    const items = hold.seatIds.map((seatId, idx) => {
      const seat = this.seats.get(seatId);
      const price = seat ? seat.price : 100000;
      if (seat) {
        seat.status = 'RESERVED';
      }
      return {
        id: `item-${params.orderId}-${idx + 1}`,
        orderId: params.orderId,
        seatId,
        price,
        seatNumber: seat?.seatNumber,
        seatCategoryName: seat?.categoryName,
        createdAt: now,
      };
    });

    const totalAmount = items.reduce((sum, item) => sum + item.price, 0);

    // Transition hold
    hold.status = 'CONVERTED_TO_ORDER';

    const order: OrderWithItems = {
      id: params.orderId,
      userId: params.userId,
      eventId: hold.eventId,
      status: 'PENDING',
      totalAmount,
      expiresAt: params.expiresAt,
      createdAt: now,
      updatedAt: now,
      items,
    };

    this.orders.set(order.id, order);

    this.outboxEvents.push({
      aggregateType: 'ORDER',
      aggregateId: order.id,
      eventType: 'order.created',
      payload: {
        orderId: order.id,
        userId: order.userId,
        eventId: order.eventId,
        totalAmount: order.totalAmount,
        seatIds: hold.seatIds,
        expiresAt: order.expiresAt.toISOString(),
      },
    });

    return order;
  }

  async findById(orderId: string): Promise<OrderWithItems | null> {
    const order = this.orders.get(orderId);
    return order ? { ...order, items: [...order.items] } : null;
  }

  async findByUserId(userId: string): Promise<OrderWithItems[]> {
    const results: OrderWithItems[] = [];
    for (const order of this.orders.values()) {
      if (order.userId === userId) {
        results.push({ ...order, items: [...order.items] });
      }
    }
    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async cancelExpiredOrders(now: Date): Promise<number> {
    let count = 0;
    for (const order of this.orders.values()) {
      if (order.status === 'PENDING' && order.expiresAt.getTime() <= now.getTime()) {
        order.status = 'CANCELLED';
        order.updatedAt = now;
        count++;

        // Release seats back to AVAILABLE
        for (const item of order.items) {
          const seat = this.seats.get(item.seatId);
          if (seat && seat.status === 'RESERVED') {
            seat.status = 'AVAILABLE';
          }
        }

        this.outboxEvents.push({
          aggregateType: 'ORDER',
          aggregateId: order.id,
          eventType: 'order.cancelled',
          payload: {
            orderId: order.id,
            reason: 'PAYMENT_EXPIRED',
          },
        });
      }
    }
    return count;
  }

  async updateStatus(orderId: string, status: OrderStatus): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new NotFoundError('Order not found.');
    }
    assertValidOrderTransition(order.status, status);
    order.status = status;
    order.updatedAt = new Date();
  }
}
