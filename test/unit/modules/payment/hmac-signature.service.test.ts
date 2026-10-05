import { beforeEach, describe, expect, it } from 'vitest';
import { FrozenClock } from '../../../../src/platform/clock/clock.js';
import {
  canonicalizePayload,
  HmacSignatureService,
} from '../../../../src/modules/payment/infrastructure/hmac-signature.service.js';

describe('HmacSignatureService', () => {
  const secret = 'super-secure-webhook-hmac-secret-key-12345';
  let clock: FrozenClock;
  let service: HmacSignatureService;

  beforeEach(() => {
    clock = new FrozenClock(new Date('2026-10-06T12:00:00.000Z'));
    service = new HmacSignatureService(secret, clock);
  });

  describe('canonicalizePayload', () => {
    it('produces identical serialized string regardless of key ordering', () => {
      const obj1 = { orderId: 'ord-123', status: 'SUCCESS', amount: 500000 };
      const obj2 = { amount: 500000, status: 'SUCCESS', orderId: 'ord-123' };

      expect(canonicalizePayload(obj1)).toBe(canonicalizePayload(obj2));
    });
  });

  describe('generateSignature and verifySignature', () => {
    it('verifies a valid signature generated with the same secret and timestamp within tolerance', () => {
      const timestamp = Math.floor(clock.now().getTime() / 1000);
      const payload = { orderId: 'ord-001', status: 'SUCCESS' };

      const signature = service.generateSignature(payload, timestamp);
      const isValid = service.verifySignature(signature, timestamp, payload);

      expect(isValid).toBe(true);
    });

    it('rejects verification if payload has been tampered with', () => {
      const timestamp = Math.floor(clock.now().getTime() / 1000);
      const payload = { orderId: 'ord-001', status: 'SUCCESS' };
      const tamperedPayload = { orderId: 'ord-001', status: 'FAILED' };

      const signature = service.generateSignature(payload, timestamp);
      const isValid = service.verifySignature(signature, timestamp, tamperedPayload);

      expect(isValid).toBe(false);
    });

    it('rejects verification if signed with a different secret', () => {
      const timestamp = Math.floor(clock.now().getTime() / 1000);
      const payload = { orderId: 'ord-001', status: 'SUCCESS' };

      const otherService = new HmacSignatureService('wrong-secret', clock);
      const signature = otherService.generateSignature(payload, timestamp);

      const isValid = service.verifySignature(signature, timestamp, payload);
      expect(isValid).toBe(false);
    });

    it('rejects timestamp outside of tolerance window to prevent replay attacks', () => {
      const nowSeconds = Math.floor(clock.now().getTime() / 1000);
      const expiredTimestamp = nowSeconds - 301; // 301 seconds ago (tolerance is 300)
      const payload = { orderId: 'ord-001', status: 'SUCCESS' };

      const signature = service.generateSignature(payload, expiredTimestamp);
      const isValid = service.verifySignature(signature, expiredTimestamp, payload);

      expect(isValid).toBe(false);
    });

    it('accepts timestamp within 300 seconds tolerance window', () => {
      const nowSeconds = Math.floor(clock.now().getTime() / 1000);
      const validPastTimestamp = nowSeconds - 150; // 150 seconds ago
      const payload = { orderId: 'ord-001', status: 'SUCCESS' };

      const signature = service.generateSignature(payload, validPastTimestamp);
      const isValid = service.verifySignature(signature, validPastTimestamp, payload);

      expect(isValid).toBe(true);
    });
  });
});
