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

describe('Payment Webhook Concurrency Race', () => {
  const secret = 'super-secret-webhook-key-payment-race';
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let hmacService: HmacSignatureService;
  let orderRepo: InMemoryOrderRepository;
  let paymentRepo: InMemoryPaymentRepository;

  const userA = '01925b30-745a-714e-b5c9-254199180001';
  const orderId = '01925b30-745a-714e-b5c9-254199180050';

  beforeEach(async () => {
    tokenService = new JwtTokenService(
      'super-secret-access-token-key-which-is-long-enough',
      'super-secret-refresh-token-key-which-is-long-enough',
      '15m',
      '7d',
    );

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

  it('handles 20 duplicate concurrent webhooks idempotenly with exactly 1 status mutation and zero corruption', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      orderId,
      externalId: 'ext-tx-race-001',
      status: 'SUCCESS' as const,
    };
    const signature = hmacService.generateSignature(payload, timestamp);

    const concurrentRequestsCount = 20;

    const promises = Array.from({ length: concurrentRequestsCount }, () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/payments/webhook',
        headers: {
          'x-webhook-signature': signature,
          'x-webhook-timestamp': String(timestamp),
        },
        payload,
      }),
    );

    const results = await Promise.all(promises);

    // All 20 requests succeed with 200 OK
    for (const res of results) {
      expect(res.statusCode).toBe(200);
      expect(res.json().received).toBe(true);
      expect(res.json().status).toBe('PAID');
    }

    // Exactly 1 webhook processed the initial transition, remaining 19 handled idempotenly
    const initialProcessed = results.filter((r) => r.json().alreadyProcessed === false);
    const idempotentProcessed = results.filter((r) => r.json().alreadyProcessed === true);

    expect(initialProcessed).toHaveLength(1);
    expect(idempotentProcessed).toHaveLength(19);

    // Verify order in database is PAID
    const order = await orderRepo.findById(orderId);
    expect(order?.status).toBe('PAID');

    // Verify seat in database is SOLD
    const seat = orderRepo.getSeat('01925b30-745a-714e-b5c9-254199180061');
    expect(seat?.status).toBe('SOLD');

    // Exactly 1 outbox event emitted
    expect(paymentRepo.outboxEvents).toHaveLength(1);
    expect(paymentRepo.outboxEvents[0]?.eventType).toBe('order.paid');
  });
});
