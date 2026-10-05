import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { SystemClock } from '../../../../src/platform/clock/clock.js';
import { registerProblemDetailsErrorHandler } from '../../../../src/platform/errors/problem-details.js';
import { UuidV7Generator } from '../../../../src/platform/id/id-generator.js';
import { JwtTokenService } from '../../../../src/modules/identity/infrastructure/jwt-token-service.js';
import {
  InMemoryOrderRepository,
  type InMemoryHoldRecord,
  type InMemorySeatRecord,
} from '../../../../src/modules/order/infrastructure/in-memory-order.repository.js';
import { CheckoutPaymentUseCase } from '../../../../src/modules/payment/application/checkout-payment.use-case.js';
import { ProcessPaymentWebhookUseCase } from '../../../../src/modules/payment/application/process-payment-webhook.use-case.js';
import { HmacSignatureService } from '../../../../src/modules/payment/infrastructure/hmac-signature.service.js';
import { InMemoryPaymentRepository } from '../../../../src/modules/payment/infrastructure/in-memory-payment.repository.js';
import { createPaymentRoutes } from '../../../../src/modules/payment/interface/payment.routes.js';

describe('Payment Routes Integration (Fastify)', () => {
  const secret = 'super-secret-webhook-key-payment-module';
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let hmacService: HmacSignatureService;
  let orderRepo: InMemoryOrderRepository;
  let paymentRepo: InMemoryPaymentRepository;

  const userA = '01925b30-745a-714e-b5c9-254199180001';
  const orderId = '01925b30-745a-714e-b5c9-254199180050';
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

    const clock = new SystemClock();
    const idGen = new UuidV7Generator();
    hmacService = new HmacSignatureService(secret, clock);

    const seats: InMemorySeatRecord[] = [
      {
        id: '01925b30-745a-714e-b5c9-254199180061',
        eventId: '01925b30-745a-714e-b5c9-254199180060',
        seatNumber: 'CAT1-10',
        categoryName: 'CAT 1',
        price: 1000000,
        status: 'HELD',
      },
    ];

    const holds: InMemoryHoldRecord[] = [
      {
        id: '01925b30-745a-714e-b5c9-254199180070',
        userId: userA,
        eventId: '01925b30-745a-714e-b5c9-254199180060',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 600000),
        seatIds: ['01925b30-745a-714e-b5c9-254199180061'],
      },
    ];

    orderRepo = new InMemoryOrderRepository(holds, seats);
    paymentRepo = new InMemoryPaymentRepository(orderRepo);

    await orderRepo.createOrderFromHold({
      orderId,
      userId: userA,
      holdId: '01925b30-745a-714e-b5c9-254199180070',
      expiresAt: new Date(Date.now() + 900000),
    });

    const checkoutPaymentUseCase = new CheckoutPaymentUseCase(paymentRepo, orderRepo, idGen, clock);
    const processPaymentWebhookUseCase = new ProcessPaymentWebhookUseCase(paymentRepo, hmacService);

    app = Fastify();
    registerProblemDetailsErrorHandler(app);

    await app.register(
      createPaymentRoutes({
        checkoutPaymentUseCase,
        processPaymentWebhookUseCase,
        tokenService,
      }),
      { prefix: '/api/v1' },
    );

    await app.ready();
  });

  describe('POST /api/v1/payments/checkout', () => {
    it('returns 200 with checkout URL for authenticated user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/checkout',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
        payload: {
          orderId,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.paymentId).toBeDefined();
      expect(json.orderId).toBe(orderId);
      expect(json.amount).toBe(1000000);
      expect(json.status).toBe('PENDING');
      expect(json.checkoutUrl).toContain(json.paymentId);
    });

    it('returns 401 when token is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/checkout',
        payload: {
          orderId,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/payments/webhook', () => {
    it('returns 401 when X-Webhook-Signature is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        },
        payload: {
          orderId,
          externalId: 'ext-tx-001',
          status: 'SUCCESS',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when X-Webhook-Timestamp is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-webhook-signature': 'any-signature',
          'x-webhook-timestamp': 'invalid-timestamp',
        },
        payload: {
          orderId,
          externalId: 'ext-tx-001',
          status: 'SUCCESS',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('processes signed webhook and returns 200', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = {
        orderId,
        externalId: 'ext-tx-999',
        status: 'SUCCESS' as const,
      };
      const signature = hmacService.generateSignature(payload, timestamp);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-webhook-signature': signature,
          'x-webhook-timestamp': String(timestamp),
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.received).toBe(true);
      expect(json.orderId).toBe(orderId);
      expect(json.status).toBe('PAID');
      expect(json.alreadyProcessed).toBe(false);
    });
  });
});
