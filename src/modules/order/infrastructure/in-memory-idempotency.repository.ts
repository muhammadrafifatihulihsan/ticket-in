import type {
  AcquireKeyParams,
  AcquireKeyResult,
  CompleteKeyParams,
  IdempotencyRecord,
  IdempotencyRepositoryPort,
} from '../domain/idempotency.repository.port.js';

export class InMemoryIdempotencyRepository implements IdempotencyRepositoryPort {
  private readonly keys = new Map<string, IdempotencyRecord>();

  async acquireKey(params: AcquireKeyParams): Promise<AcquireKeyResult> {
    const existing = this.keys.get(params.key);
    const now = new Date();

    if (existing && existing.expiresAt.getTime() > now.getTime()) {
      if (existing.status === 'IN_PROGRESS') {
        return { state: 'IN_PROGRESS' };
      }
      return {
        state: 'COMPLETED',
        responseCode: existing.responseCode ?? 200,
        responseBody: existing.responseBody,
        requestHash: existing.requestHash,
      };
    }

    const record: IdempotencyRecord = {
      key: params.key,
      userId: params.userId,
      requestPath: params.requestPath,
      requestHash: params.requestHash,
      status: 'IN_PROGRESS',
      expiresAt: params.expiresAt,
      createdAt: now,
    };

    this.keys.set(params.key, record);
    return { state: 'ACQUIRED' };
  }

  async completeKey(params: CompleteKeyParams): Promise<void> {
    const record = this.keys.get(params.key);
    if (record) {
      record.status = 'COMPLETED';
      record.responseCode = params.responseCode;
      record.responseBody = params.responseBody;
    }
  }

  async releaseKey(key: string): Promise<void> {
    const record = this.keys.get(key);
    if (record && record.status === 'IN_PROGRESS') {
      this.keys.delete(key);
    }
  }
}
