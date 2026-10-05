import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../platform/db/schema.js';
import type {
  AcquireKeyParams,
  AcquireKeyResult,
  CompleteKeyParams,
  IdempotencyRepositoryPort,
} from '../domain/idempotency.repository.port.js';

export class DrizzleIdempotencyRepository implements IdempotencyRepositoryPort {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async acquireKey(params: AcquireKeyParams): Promise<AcquireKeyResult> {
    const now = new Date();

    const existingRows = await this.db
      .select()
      .from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.key, params.key))
      .limit(1);

    const existing = existingRows[0];

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

    try {
      if (existing) {
        await this.db
          .update(schema.idempotencyKeys)
          .set({
            userId: params.userId,
            requestPath: params.requestPath,
            requestHash: params.requestHash,
            status: 'IN_PROGRESS',
            responseCode: null,
            responseBody: null,
            expiresAt: params.expiresAt,
            createdAt: now,
          })
          .where(eq(schema.idempotencyKeys.key, params.key));
      } else {
        await this.db.insert(schema.idempotencyKeys).values({
          key: params.key,
          userId: params.userId,
          requestPath: params.requestPath,
          requestHash: params.requestHash,
          status: 'IN_PROGRESS',
          expiresAt: params.expiresAt,
          createdAt: now,
        });
      }
      return { state: 'ACQUIRED' };
    } catch {
      // Handle concurrent collision on insert
      const recheckRows = await this.db
        .select()
        .from(schema.idempotencyKeys)
        .where(eq(schema.idempotencyKeys.key, params.key))
        .limit(1);

      const recheck = recheckRows[0];
      if (recheck && recheck.status === 'COMPLETED') {
        return {
          state: 'COMPLETED',
          responseCode: recheck.responseCode ?? 200,
          responseBody: recheck.responseBody,
          requestHash: recheck.requestHash,
        };
      }
      return { state: 'IN_PROGRESS' };
    }
  }

  async completeKey(params: CompleteKeyParams): Promise<void> {
    await this.db
      .update(schema.idempotencyKeys)
      .set({
        status: 'COMPLETED',
        responseCode: params.responseCode,
        responseBody: params.responseBody,
      })
      .where(eq(schema.idempotencyKeys.key, params.key));
  }

  async releaseKey(key: string): Promise<void> {
    await this.db
      .delete(schema.idempotencyKeys)
      .where(
        and(
          eq(schema.idempotencyKeys.key, key),
          eq(schema.idempotencyKeys.status, 'IN_PROGRESS'),
        ),
      );
  }
}
