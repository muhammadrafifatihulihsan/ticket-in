export type IdempotencyStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface IdempotencyRecord {
  key: string;
  userId: string;
  requestPath: string;
  requestHash: string;
  status: IdempotencyStatus;
  responseCode?: number | undefined;
  responseBody?: unknown | undefined;
  expiresAt: Date;
  createdAt: Date;
}

export type AcquireKeyResult =
  | { state: 'ACQUIRED' }
  | { state: 'IN_PROGRESS' }
  | { state: 'COMPLETED'; responseCode: number; responseBody: unknown; requestHash: string };

export interface AcquireKeyParams {
  key: string;
  userId: string;
  requestPath: string;
  requestHash: string;
  expiresAt: Date;
}

export interface CompleteKeyParams {
  key: string;
  responseCode: number;
  responseBody: unknown;
}

export interface IdempotencyRepositoryPort {
  /**
   * Atomically acquires an idempotency key.
   * If key does not exist or has expired, creates it with status IN_PROGRESS and returns ACQUIRED.
   * If key exists and is IN_PROGRESS, returns IN_PROGRESS.
   * If key exists and is COMPLETED, returns COMPLETED with cached response and payload hash.
   */
  acquireKey(params: AcquireKeyParams): Promise<AcquireKeyResult>;

  /**
   * Marks an in-progress idempotency key as COMPLETED with the response code and body.
   */
  completeKey(params: CompleteKeyParams): Promise<void>;

  /**
   * Deletes an in-progress key on error so the client can retry.
   */
  releaseKey(key: string): Promise<void>;
}
