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

describe('Order Routes Integration (Fastify)', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let orderRepo: InMemoryOrderRepository;
  let idemRepo: InMemoryIdempotencyRepository;
  let idemService: IdempotencyService;

  const userA = '01925b30-745a-714e-b5c9-254199180001';
  const userB = '01925b30-745a-714e-b5c9-254199180002';
  const adminUser = '01925b30-745a-714e-b5c9-254199180099';
  const eventId = '01925b30-745a-714e-b5c9-254199180010';
  const holdId1 = '01925b30-745a-714e-b5c9-254199180020';
  const holdId2 = '01925b30-745a-714e-b5c9-254199180021';

  let tokenA: string;
  let tokenB: string;
  let tokenAdmin: string;

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

    tokenB = tokenService.generateAccessToken({
      sub: userB,
      email: 'userb@example.com',
      role: 'user',
    });

    tokenAdmin = tokenService.generateAccessToken({
      sub: adminUser,
      email: 'admin@example.com',
      role: 'admin',
    });

    const seats: InMemorySeatRecord[] = [
      {
        id: '01925b30-745a-714e-b5c9-254199180031',
        eventId,
        seatNumber: 'A1',
        categoryName: 'CAT 1',
        price: 750000,
        status: 'HELD',
      },
      {
        id: '01925b30-745a-714e-b5c9-254199180032',
        eventId,
        seatNumber: 'A2',
        categoryName: 'CAT 1',
        price: 750000,
        status: 'HELD',
      },
    ];

    const holds: InMemoryHoldRecord[] = [
      {
        id: holdId1,
        userId: userA,
        eventId,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 600000),
        seatIds: ['01925b30-745a-714e-b5c9-254199180031'],
      },
      {
        id: holdId2,
        userId: userA,
        eventId,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 600000),
        seatIds: ['01925b30-745a-714e-b5c9-254199180032'],
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

  describe('POST /api/v1/orders', () => {
    it('returns 400 when Idempotency-Key header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          holdId: holdId1,
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.detail).toContain('Idempotency-Key');
    });

    it('creates an order and returns 201 with Idempotency-Key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'idempotency-key': 'key-create-001',
        },
        payload: {
          holdId: holdId1,
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.id).toBeDefined();
      expect(json.status).toBe('PENDING');
      expect(json.totalAmount).toBe(750000);
      expect(json.items).toHaveLength(1);
    });

    it('replays identical response with x-cache-lookup HIT on duplicate request', async () => {
      // First request
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'idempotency-key': 'key-replay-001',
        },
        payload: {
          holdId: holdId1,
        },
      });
      expect(res1.statusCode).toBe(201);
      const orderId1 = res1.json().id;

      // Second request with same idempotency key and same payload
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'idempotency-key': 'key-replay-001',
        },
        payload: {
          holdId: holdId1,
        },
      });

      expect(res2.statusCode).toBe(201);
      expect(res2.headers['x-cache-lookup']).toBe('HIT');
      expect(res2.json().id).toBe(orderId1);
    });

    it('returns 422 IDEMPOTENCY_PAYLOAD_MISMATCH when same key is used with different payload', async () => {
      // First request
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'idempotency-key': 'key-mismatch-001',
        },
        payload: {
          holdId: holdId1,
        },
      });
      expect(res1.statusCode).toBe(201);

      // Second request with same key but different holdId
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'idempotency-key': 'key-mismatch-001',
        },
        payload: {
          holdId: holdId2,
        },
      });

      expect(res2.statusCode).toBe(422);
      const json = res2.json();
      expect(json.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
    });
  });

  describe('GET /api/v1/orders/:id (IDOR Protection)', () => {
    it('allows the order owner to view their order', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'idempotency-key': 'key-view-001',
        },
        payload: {
          holdId: holdId1,
        },
      });
      const orderId = createRes.json().id;

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/orders/${orderId}`,
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
      });

      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().id).toBe(orderId);
      expect(getRes.json().totalAmount).toBe(750000);
    });

    it('rejects another user with 403 Forbidden', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'idempotency-key': 'key-view-002',
        },
        payload: {
          holdId: holdId1,
        },
      });
      const orderId = createRes.json().id;

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/orders/${orderId}`,
        headers: {
          authorization: `Bearer ${tokenB}`, // User B attempting to view User A's order
        },
      });

      expect(getRes.statusCode).toBe(403);
      expect(getRes.json().code).toBe('FORBIDDEN_OBJECT_ACCESS');
    });

    it('allows admin to view any order', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'idempotency-key': 'key-view-003',
        },
        payload: {
          holdId: holdId1,
        },
      });
      const orderId = createRes.json().id;

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/orders/${orderId}`,
        headers: {
          authorization: `Bearer ${tokenAdmin}`, // Admin access
        },
      });

      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().id).toBe(orderId);
    });
  });

  describe('GET /api/v1/orders', () => {
    it('returns list of orders for the authenticated user', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'idempotency-key': 'key-list-001',
        },
        payload: {
          holdId: holdId1,
        },
      });

      const listResA = await app.inject({
        method: 'GET',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
      });

      expect(listResA.statusCode).toBe(200);
      expect(listResA.json()).toHaveLength(1);

      const listResB = await app.inject({
        method: 'GET',
        url: '/api/v1/orders',
        headers: {
          authorization: `Bearer ${tokenB}`,
        },
      });

      expect(listResB.statusCode).toBe(200);
      expect(listResB.json()).toHaveLength(0);
    });
  });
});
