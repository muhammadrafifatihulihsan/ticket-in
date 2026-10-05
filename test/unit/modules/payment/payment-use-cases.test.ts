import { beforeEach, describe, expect, it } from 'vitest';
import { SystemClock } from '../../../../src/platform/clock/clock.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../../../src/platform/errors/problem-details.js';
import { UuidV7Generator } from '../../../../src/platform/id/id-generator.js';
import {
  InMemoryOrderRepository,
  type InMemoryHoldRecord,
  type InMemorySeatRecord,
} from '../../../../src/modules/order/infrastructure/in-memory-order.repository.js';
import { CheckoutPaymentUseCase } from '../../../../src/modules/payment/application/checkout-payment.use-case.js';
import { ProcessPaymentWebhookUseCase } from '../../../../src/modules/payment/application/process-payment-webhook.use-case.js';
import { HmacSignatureService } from '../../../../src/modules/payment/infrastructure/hmac-signature.service.js';
import { InMemoryPaymentRepository } from '../../../../src/modules/payment/infrastructure/in-memory-payment.repository.js';

describe('Payment Module Use Cases', () => {
  const secret = 'test-secret-webhook-key-for-payments';
  let clock: SystemClock;
  let idGen: UuidV7Generator;
  let hmacService: HmacSignatureService;
  let orderRepo: InMemoryOrderRepository;
  let paymentRepo: InMemoryPaymentRepository;
  let checkoutUseCase: CheckoutPaymentUseCase;
  let webhookUseCase: ProcessPaymentWebhookUseCase;

  const userA = 'user-001';
  const userB = 'user-002';
  const eventId = 'event-001';
  const holdId = 'hold-001';
  let orderId: string;

  beforeEach(async () => {
    clock = new SystemClock();
    idGen = new UuidV7Generator();
    hmacService = new HmacSignatureService(secret, clock);

    const seats: InMemorySeatRecord[] = [
      {
        id: 'seat-001',
        eventId,
        seatNumber: 'A1',
        categoryName: 'CAT 1',
        price: 500000,
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
        seatIds: ['seat-001'],
      },
    ];

    orderRepo = new InMemoryOrderRepository(holds, seats);
    paymentRepo = new InMemoryPaymentRepository(orderRepo);

    // Create an initial order
    const createdOrder = await orderRepo.createOrderFromHold({
      orderId: 'order-123',
      userId: userA,
      holdId,
      expiresAt: new Date(Date.now() + 900000),
    });
    orderId = createdOrder.id;

    checkoutUseCase = new CheckoutPaymentUseCase(paymentRepo, orderRepo, idGen, clock);
    webhookUseCase = new ProcessPaymentWebhookUseCase(paymentRepo, hmacService);
  });

  describe('CheckoutPaymentUseCase', () => {
    it('initiates checkout for valid pending order', async () => {
      const result = await checkoutUseCase.execute({ orderId, userId: userA });

      expect(result.payment).toBeDefined();
      expect(result.payment.status).toBe('PENDING');
      expect(result.payment.orderId).toBe(orderId);
      expect(result.payment.amount).toBe(500000);
      expect(result.checkoutUrl).toContain(result.payment.id);
    });

    it('returns existing payment if checkout is repeated', async () => {
      const first = await checkoutUseCase.execute({ orderId, userId: userA });
      const second = await checkoutUseCase.execute({ orderId, userId: userA });

      expect(first.payment.id).toBe(second.payment.id);
    });

    it('throws NotFoundError when order does not exist', async () => {
      await expect(
        checkoutUseCase.execute({ orderId: 'missing-order', userId: userA }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when user does not own the order', async () => {
      await expect(
        checkoutUseCase.execute({ orderId, userId: userB }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ConflictError if order is not PENDING', async () => {
      await orderRepo.updateStatus(orderId, 'CANCELLED');

      await expect(
        checkoutUseCase.execute({ orderId, userId: userA }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('ProcessPaymentWebhookUseCase', () => {
    it('rejects invalid signature with UnauthorizedError', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = {
        orderId,
        externalId: 'ext-tx-123',
        status: 'SUCCESS' as const,
      };

      await expect(
        webhookUseCase.execute({
          signature: 'invalid-signature-hex',
          timestamp,
          payload,
        }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('processes SUCCESS webhook: sets order to PAID, seats to SOLD, and produces outbox event', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = {
        orderId,
        externalId: 'ext-tx-123',
        status: 'SUCCESS' as const,
      };
      const signature = hmacService.generateSignature(payload, timestamp);

      const outcome = await webhookUseCase.execute({ signature, timestamp, payload });

      expect(outcome.status).toBe('PAID');
      expect(outcome.alreadyProcessed).toBe(false);

      // Verify order state
      const order = await orderRepo.findById(orderId);
      expect(order?.status).toBe('PAID');

      // Verify seat state
      const seat = orderRepo.getSeat('seat-001');
      expect(seat?.status).toBe('SOLD');

      // Verify outbox
      expect(paymentRepo.outboxEvents).toHaveLength(1);
      expect(paymentRepo.outboxEvents[0]?.eventType).toBe('order.paid');
      expect(paymentRepo.outboxEvents[0]?.aggregateId).toBe(orderId);
    });

    it('processes duplicate webhook idempotenly with alreadyProcessed: true', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = {
        orderId,
        externalId: 'ext-tx-123',
        status: 'SUCCESS' as const,
      };
      const signature = hmacService.generateSignature(payload, timestamp);

      // First webhook
      const firstOutcome = await webhookUseCase.execute({ signature, timestamp, payload });
      expect(firstOutcome.status).toBe('PAID');
      expect(firstOutcome.alreadyProcessed).toBe(false);

      // Duplicate webhook
      const secondOutcome = await webhookUseCase.execute({ signature, timestamp, payload });
      expect(secondOutcome.status).toBe('PAID');
      expect(secondOutcome.alreadyProcessed).toBe(true);
    });

    it('processes FAILED webhook: sets order to CANCELLED, releases seats to AVAILABLE, and produces outbox event', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = {
        orderId,
        externalId: 'ext-tx-456',
        status: 'FAILED' as const,
      };
      const signature = hmacService.generateSignature(payload, timestamp);

      const outcome = await webhookUseCase.execute({ signature, timestamp, payload });

      expect(outcome.status).toBe('CANCELLED');
      expect(outcome.alreadyProcessed).toBe(false);

      const order = await orderRepo.findById(orderId);
      expect(order?.status).toBe('CANCELLED');

      const seat = orderRepo.getSeat('seat-001');
      expect(seat?.status).toBe('AVAILABLE');

      expect(paymentRepo.outboxEvents).toHaveLength(1);
      expect(paymentRepo.outboxEvents[0]?.eventType).toBe('order.cancelled');
    });
  });
});
