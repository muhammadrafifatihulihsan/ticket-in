import { beforeEach, describe, expect, it } from 'vitest';
import { SystemClock } from '../../../../src/platform/clock/clock.js';
import {
  IdempotencyConflictError,
  IdempotencyPayloadMismatchError,
} from '../../../../src/platform/errors/problem-details.js';
import {
  canonicalizeJson,
  computePayloadHash,
  IdempotencyService,
} from '../../../../src/modules/order/infrastructure/idempotency.service.js';
import { InMemoryIdempotencyRepository } from '../../../../src/modules/order/infrastructure/in-memory-idempotency.repository.js';

describe('IdempotencyService', () => {
  let repository: InMemoryIdempotencyRepository;
  let clock: SystemClock;
  let service: IdempotencyService;

  beforeEach(() => {
    repository = new InMemoryIdempotencyRepository();
    clock = new SystemClock();
    service = new IdempotencyService(repository, clock);
  });

  describe('canonicalizeJson and computePayloadHash', () => {
    it('produces identical hashes regardless of key ordering', () => {
      const obj1 = { holdId: 'hold-123', quantity: 2 };
      const obj2 = { quantity: 2, holdId: 'hold-123' };

      expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
      expect(computePayloadHash(obj1)).toBe(computePayloadHash(obj2));
    });

    it('produces different hashes for different payloads', () => {
      const obj1 = { holdId: 'hold-123' };
      const obj2 = { holdId: 'hold-456' };

      expect(computePayloadHash(obj1)).not.toBe(computePayloadHash(obj2));
    });
  });

  describe('idempotent execution lifecycle', () => {
    const key = 'idem-key-001';
    const userId = 'user-001';
    const requestPath = '/api/v1/orders';
    const payload = { holdId: 'hold-123' };

    it('executes new action, caches result, and returns replayed: false', async () => {
      let executionCount = 0;
      const result = await service.process({
        key,
        userId,
        requestPath,
        payload,
        action: async () => {
          executionCount++;
          return { statusCode: 201, body: { orderId: 'order-123' } };
        },
      });

      expect(executionCount).toBe(1);
      expect(result.statusCode).toBe(201);
      expect(result.body).toEqual({ orderId: 'order-123' });
      expect(result.replayed).toBe(false);
    });

    it('replays cached result with replayed: true for identical payload without executing action again', async () => {
      let executionCount = 0;
      const action = async () => {
        executionCount++;
        return { statusCode: 201, body: { orderId: 'order-123' } };
      };

      // First call
      await service.process({ key, userId, requestPath, payload, action });
      expect(executionCount).toBe(1);

      // Replay call with same payload (even with shuffled keys)
      const replayResult = await service.process({
        key,
        userId,
        requestPath,
        payload: { ...payload },
        action,
      });

      expect(executionCount).toBe(1); // Action not called again
      expect(replayResult.statusCode).toBe(201);
      expect(replayResult.body).toEqual({ orderId: 'order-123' });
      expect(replayResult.replayed).toBe(true);
    });

    it('throws IdempotencyPayloadMismatchError if key is reused with different payload', async () => {
      // First call
      await service.process({
        key,
        userId,
        requestPath,
        payload,
        action: async () => ({ statusCode: 201, body: { orderId: 'order-123' } }),
      });

      // Second call with different payload
      await expect(
        service.process({
          key,
          userId,
          requestPath,
          payload: { holdId: 'different-hold-999' },
          action: async () => ({ statusCode: 201, body: { orderId: 'order-999' } }),
        }),
      ).rejects.toThrow(IdempotencyPayloadMismatchError);
    });

    it('throws IdempotencyConflictError if another request with same key is IN_PROGRESS', async () => {
      // Pre-set key as IN_PROGRESS
      await repository.acquireKey({
        key,
        userId,
        requestPath,
        requestHash: computePayloadHash(payload),
        expiresAt: new Date(Date.now() + 60000),
      });

      await expect(
        service.process({
          key,
          userId,
          requestPath,
          payload,
          action: async () => ({ statusCode: 201, body: { orderId: 'order-123' } }),
        }),
      ).rejects.toThrow(IdempotencyConflictError);
    });

    it('releases key when action throws error, enabling retry', async () => {
      let attempt = 0;
      const failingAction = async () => {
        attempt++;
        if (attempt === 1) {
          throw new Error('Database connection failed');
        }
        return { statusCode: 201, body: { orderId: 'recovered-order' } };
      };

      // First attempt fails
      await expect(
        service.process({ key, userId, requestPath, payload, action: failingAction }),
      ).rejects.toThrow('Database connection failed');

      // Second attempt succeeds because key was released
      const retryResult = await service.process({
        key,
        userId,
        requestPath,
        payload,
        action: failingAction,
      });

      expect(retryResult.statusCode).toBe(201);
      expect(retryResult.body).toEqual({ orderId: 'recovered-order' });
      expect(retryResult.replayed).toBe(false);
    });
  });
});
