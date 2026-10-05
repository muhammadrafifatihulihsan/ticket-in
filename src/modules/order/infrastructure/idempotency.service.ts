import { createHash } from 'node:crypto';
import type { Clock } from '../../../platform/clock/clock.js';
import {
  IdempotencyConflictError,
  IdempotencyPayloadMismatchError,
} from '../../../platform/errors/problem-details.js';
import type { IdempotencyRepositoryPort } from '../domain/idempotency.repository.port.js';

export const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours

export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? '';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([_, val]) => val !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  const content = entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`)
    .join(',');

  return `{${content}}`;
}

export function computePayloadHash(payload: unknown): string {
  const canonical = canonicalizeJson(payload);
  return createHash('sha256').update(canonical).digest('hex');
}

export interface ProcessIdempotentActionParams<T> {
  key: string;
  userId: string;
  requestPath: string;
  payload: unknown;
  ttlSeconds?: number | undefined;
  action: () => Promise<{ statusCode: number; body: T }>;
}

export interface ProcessIdempotentActionResult<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

export class IdempotencyService {
  constructor(
    private readonly repository: IdempotencyRepositoryPort,
    private readonly clock: Clock,
  ) {}

  async process<T>(
    params: ProcessIdempotentActionParams<T>,
  ): Promise<ProcessIdempotentActionResult<T>> {
    const requestHash = computePayloadHash(params.payload);
    const ttl = params.ttlSeconds ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS;
    const expiresAt = new Date(this.clock.now().getTime() + ttl * 1000);

    const acquireResult = await this.repository.acquireKey({
      key: params.key,
      userId: params.userId,
      requestPath: params.requestPath,
      requestHash,
      expiresAt,
    });

    if (acquireResult.state === 'IN_PROGRESS') {
      throw new IdempotencyConflictError(
        'A request with the same Idempotency-Key is currently in progress.',
      );
    }

    if (acquireResult.state === 'COMPLETED') {
      if (acquireResult.requestHash !== requestHash) {
        throw new IdempotencyPayloadMismatchError(
          'The Idempotency-Key was already used with a different request payload.',
        );
      }
      return {
        statusCode: acquireResult.responseCode,
        body: acquireResult.responseBody as T,
        replayed: true,
      };
    }

    try {
      const outcome = await params.action();
      await this.repository.completeKey({
        key: params.key,
        responseCode: outcome.statusCode,
        responseBody: outcome.body,
      });
      return {
        statusCode: outcome.statusCode,
        body: outcome.body,
        replayed: false,
      };
    } catch (err) {
      await this.repository.releaseKey(params.key);
      throw err;
    }
  }
}
