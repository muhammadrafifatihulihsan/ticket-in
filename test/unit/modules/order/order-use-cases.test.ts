import { beforeEach, describe, expect, it } from 'vitest';
import { SystemClock } from '../../../../src/platform/clock/clock.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../../src/platform/errors/problem-details.js';
import { UuidV7Generator } from '../../../../src/platform/id/id-generator.js';
import { CancelExpiredOrdersUseCase } from '../../../../src/modules/order/application/cancel-expired-orders.use-case.js';
import { CreateOrderUseCase } from '../../../../src/modules/order/application/create-order.use-case.js';
import { GetOrderUseCase } from '../../../../src/modules/order/application/get-order.use-case.js';
import { ListUserOrdersUseCase } from '../../../../src/modules/order/application/list-user-orders.use-case.js';
import {
  InMemoryOrderRepository,
  type InMemoryHoldRecord,
  type InMemorySeatRecord,
} from '../../../../src/modules/order/infrastructure/in-memory-order.repository.js';

describe('Order Module Use Cases', () => {
  let orderRepository: InMemoryOrderRepository;
  let idGenerator: UuidV7Generator;
  let clock: SystemClock;
  let createOrderUseCase: CreateOrderUseCase;
  let getOrderUseCase: GetOrderUseCase;
  let listUserOrdersUseCase: ListUserOrdersUseCase;
  let cancelExpiredOrdersUseCase: CancelExpiredOrdersUseCase;

  const userA = 'user-001';
  const userB = 'user-002';
  const eventId = 'event-001';
  const validHoldId = 'hold-001';

  beforeEach(() => {
    const seats: InMemorySeatRecord[] = [
      {
        id: 'seat-vip-1',
        eventId,
        seatNumber: 'A1',
        categoryName: 'VIP',
        price: 1500000,
        status: 'HELD',
      },
      {
        id: 'seat-vip-2',
        eventId,
        seatNumber: 'A2',
        categoryName: 'VIP',
        price: 1500000,
        status: 'HELD',
      },
    ];

    const hold: InMemoryHoldRecord = {
      id: validHoldId,
      userId: userA,
      eventId,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 600000), // 10 minutes from now
      seatIds: ['seat-vip-1', 'seat-vip-2'],
    };

    orderRepository = new InMemoryOrderRepository([hold], seats);
    idGenerator = new UuidV7Generator();
    clock = new SystemClock();

    createOrderUseCase = new CreateOrderUseCase(orderRepository, idGenerator, clock);
    getOrderUseCase = new GetOrderUseCase(orderRepository);
    listUserOrdersUseCase = new ListUserOrdersUseCase(orderRepository);
    cancelExpiredOrdersUseCase = new CancelExpiredOrdersUseCase(orderRepository, clock);
  });

  describe('CreateOrderUseCase', () => {
    it('creates order from active hold, calculates IDR total, and transitions seats to RESERVED', async () => {
      const order = await createOrderUseCase.execute({
        userId: userA,
        holdId: validHoldId,
      });

      expect(order).toBeDefined();
      expect(order.status).toBe('PENDING');
      expect(order.userId).toBe(userA);
      expect(order.eventId).toBe(eventId);
      expect(order.totalAmount).toBe(3000000);
      expect(order.items).toHaveLength(2);
      expect(order.items[0]?.seatId).toBe('seat-vip-1');
      expect(order.items[1]?.seatId).toBe('seat-vip-2');

      // Hold status converted
      const hold = orderRepository.getHold(validHoldId);
      expect(hold?.status).toBe('CONVERTED_TO_ORDER');

      // Seats moved to RESERVED
      const seat1 = orderRepository.getSeat('seat-vip-1');
      const seat2 = orderRepository.getSeat('seat-vip-2');
      expect(seat1?.status).toBe('RESERVED');
      expect(seat2?.status).toBe('RESERVED');

      // Outbox event produced
      expect(orderRepository.outboxEvents).toHaveLength(1);
      expect(orderRepository.outboxEvents[0]?.eventType).toBe('order.created');
      expect(orderRepository.outboxEvents[0]?.aggregateId).toBe(order.id);
    });

    it('throws NotFoundError if hold does not exist', async () => {
      await expect(
        createOrderUseCase.execute({
          userId: userA,
          holdId: 'non-existent-hold',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError if hold belongs to another user', async () => {
      await expect(
        createOrderUseCase.execute({
          userId: userB,
          holdId: validHoldId,
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ConflictError if hold is not ACTIVE', async () => {
      const hold = orderRepository.getHold(validHoldId)!;
      hold.status = 'RELEASED';

      await expect(
        createOrderUseCase.execute({
          userId: userA,
          holdId: validHoldId,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('throws ConflictError if hold has expired', async () => {
      const hold = orderRepository.getHold(validHoldId)!;
      hold.expiresAt = new Date(Date.now() - 1000); // 1 second ago

      await expect(
        createOrderUseCase.execute({
          userId: userA,
          holdId: validHoldId,
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('GetOrderUseCase', () => {
    it('allows owner and admin to retrieve order details', async () => {
      const created = await createOrderUseCase.execute({
        userId: userA,
        holdId: validHoldId,
      });

      // Owner access
      const userOrder = await getOrderUseCase.execute({
        orderId: created.id,
        userId: userA,
        userRole: 'user',
      });
      expect(userOrder.id).toBe(created.id);
      expect(userOrder.totalAmount).toBe(3000000);

      // Admin access
      const adminOrder = await getOrderUseCase.execute({
        orderId: created.id,
        userId: 'admin-001',
        userRole: 'admin',
      });
      expect(adminOrder.id).toBe(created.id);
    });

    it('rejects access from non-owner user with ForbiddenError', async () => {
      const created = await createOrderUseCase.execute({
        userId: userA,
        holdId: validHoldId,
      });

      await expect(
        getOrderUseCase.execute({
          orderId: created.id,
          userId: userB,
          userRole: 'user',
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when order does not exist', async () => {
      await expect(
        getOrderUseCase.execute({
          orderId: 'missing-order',
          userId: userA,
          userRole: 'user',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('ListUserOrdersUseCase', () => {
    it('returns only orders belonging to the specified user', async () => {
      await createOrderUseCase.execute({
        userId: userA,
        holdId: validHoldId,
      });

      const ordersA = await listUserOrdersUseCase.execute({ userId: userA });
      expect(ordersA).toHaveLength(1);

      const ordersB = await listUserOrdersUseCase.execute({ userId: userB });
      expect(ordersB).toHaveLength(0);
    });
  });

  describe('CancelExpiredOrdersUseCase', () => {
    it('cancels pending expired orders and releases seats back to AVAILABLE', async () => {
      const created = await createOrderUseCase.execute({
        userId: userA,
        holdId: validHoldId,
      });

      // Advance time beyond expiration
      const futureTime = new Date(created.expiresAt.getTime() + 1000);

      const result = await cancelExpiredOrdersUseCase.execute({ now: futureTime });
      expect(result.cancelledCount).toBe(1);

      const updatedOrder = await orderRepository.findById(created.id);
      expect(updatedOrder?.status).toBe('CANCELLED');

      const seat1 = orderRepository.getSeat('seat-vip-1');
      const seat2 = orderRepository.getSeat('seat-vip-2');
      expect(seat1?.status).toBe('AVAILABLE');
      expect(seat2?.status).toBe('AVAILABLE');

      const cancelOutbox = orderRepository.outboxEvents.find(
        (e) => e.eventType === 'order.cancelled',
      );
      expect(cancelOutbox).toBeDefined();
      expect(cancelOutbox?.aggregateId).toBe(created.id);
    });
  });
});
