import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../../platform/clock/clock.js';
import { DEFAULT_WEBHOOK_TOLERANCE_SECONDS } from '../domain/payment.entity.js';

export function canonicalizePayload(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? '';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizePayload(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([_, val]) => val !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  const content = entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalizePayload(v)}`)
    .join(',');

  return `{${content}}`;
}

export class HmacSignatureService {
  constructor(
    private readonly secret: string,
    private readonly clock: Clock,
  ) {}

  generateSignature(payload: unknown, timestamp: number): string {
    const serialized = typeof payload === 'string' ? payload : canonicalizePayload(payload);
    const message = `${timestamp}.${serialized}`;
    return createHmac('sha256', this.secret).update(message).digest('hex');
  }

  verifySignature(
    signature: string,
    timestamp: number,
    payload: unknown,
    maxToleranceSeconds: number = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  ): boolean {
    if (!signature || typeof signature !== 'string') {
      return false;
    }

    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const diff = Math.abs(nowSeconds - timestamp);

    // Reject timestamps beyond tolerance window to prevent replay attacks
    if (diff > maxToleranceSeconds) {
      return false;
    }

    const expectedSignature = this.generateSignature(payload, timestamp);

    const sigBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (sigBuffer.byteLength !== expectedBuffer.byteLength) {
      return false;
    }

    // Timing-safe comparison to prevent timing attacks
    return timingSafeEqual(sigBuffer, expectedBuffer);
  }
}
