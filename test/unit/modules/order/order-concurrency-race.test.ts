import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { SystemClock } from '../../../../src/platform/clock/clock.js';
import { registerProblemDetailsErrorHandler } from '../../../../src/platform/errors/problem-details.js';
import { UuidV7Generator } from '../../../../src/platform/id/id-generator.js';
import { JwtTokenService } from '../../../../src/modules/identity/infrastructure/jwt-token-service.js';
import { CreateOrderUseCase } from '../../../../src/modules/order/application/create-order.use-case.js';
import { GetOrderUseCase } from '../../../../src/modules/order/application/get-order.use-case.js';
import { ListUserOrdersUseCase } from '../../../../src/modules/order/application/list-user-orders.use-case.js';
import { IdempotencyService } from '../../../../src/modules/order/infrastructure/idempotency.service.js';
import { InMemoryIdempotencyRepository } from '../../../../src/modules/order/infrastructure/in-memory-idempotency.repository.js';
import {
  InMemoryOrderRepository,
  type InMemoryHoldRecord,
  type InMemorySeatRecord,
} from '../../../../src/modules/order/infrastructure/in-memory-order.repository.js';
import { createOrderRoutes } from '../../../../src/modules/order/interface/order.routes.js';

describe('Order Idempotency Concurrency Race', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let orderRepo: InMemoryOrderRepository;
  let idemRepo: InMemoryIdempotencyRepository;
  let idemService: IdempotencyService;

  const userA = '01925b30-745a-714e-b5c9-254199180001';
  const eventId = '01925b30-745a-714e-b5c9-254199180010';
  const holdId = '01925b30-745a-714e-b5c9-254199180020';
  let tokenA: string;

  beforeEach(async () => {
    tokenService = new JwtTokenService(
      'super-secret-access-token-key-which-is-long-enough',
      'super-secret-refresh-token-key-which-is-long-enough',
      '15m',
      '7d',
    );

    tokenA = tokenService.generateAccessToken({
      sub: userA,
      email: 'usera@example.com',
      role: 'user',
    });

    const seats: InMemorySeatRecord[] = [
      {
        id: '01925b30-745a-714e-b5c9-254199180031',
        eventId,
        seatNumber: 'VIP-01',
        categoryName: 'VIP',
        price: 2500000,
        status: 'HELD',
      },
    ];

    const holds: InMemoryHoldRecord[] = [
      {
        id: holdId,
        userId: userA,
        eventId,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 600000),
        seatIds: ['01925b30-745a-714e-b5c9-254199180031'],
      },
    ];

    orderRepo = new InMemoryOrderRepository(holds, seats);
    idemRepo = new InMemoryIdempotencyRepository();
    const clock = new SystemClock();
    const idGen = new UuidV7Generator();

    idemService = new IdempotencyService(idemRepo, clock);
    const createOrderUseCase = new CreateOrderUseCase(orderRepo, idGen, clock);
    const getOrderUseCase = new GetOrderUseCase(orderRepo);
    const listUserOrdersUseCase = new ListUserOrdersUseCase(orderRepo);

    app = Fastify();
    registerProblemDetailsErrorHandler(app);

    await app.register(
      createOrderRoutes({
        createOrderUseCase,
        getOrderUseCase,
        listUserOrdersUseCase,
        idempotencyService: idemService,
        tokenService,
      }),
      { prefix: '/api/v1' },
    );

    await app.ready();
  });

  it('handles 20 concurrent requests with same Idempotency-Key resulting in exactly 1 order and zero double-orders', async () => {
    orderRepo.artificialDelayMs = 40;
    const concurrentRequestsCount = 20;
    const idempotencyKey = 'race-idem-key-999';

    // Simulate concurrent dispatch
    const promises = Array.from({ length: concurrentRequestsCount }, () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'idempotency-key': idempotencyKey,
        },
        payload: {
          holdId,
        },
      }),
    );

    const results = await Promise.all(promises);

    const createdResponses = results.filter((r) => r.statusCode === 201);
    const conflictResponses = results.filter((r) => r.statusCode === 409);

    // Exactly 1 winner creates the order
    expect(createdResponses).toHaveLength(1);

    // The other 19 concurrent in-flight requests receive 409 Conflict (IDEMPOTENCY_IN_PROGRESS)
    expect(conflictResponses).toHaveLength(19);

    for (const conflict of conflictResponses) {
      const body = conflict.json();
      expect(body.code).toBe('IDEMPOTENCY_IN_PROGRESS');
      expect(body.status).toBe(409);
    }

    // Check database state: exactly 1 order exists
    const orders = await orderRepo.findByUserId(userA);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.totalAmount).toBe(2500000);
    expect(orders[0]?.status).toBe('PENDING');

    // Seat transitioned to RESERVED
    const seat = orderRepo.getSeat('01925b30-745a-714e-b5c9-254199180031');
    expect(seat?.status).toBe('RESERVED');
  });
});
