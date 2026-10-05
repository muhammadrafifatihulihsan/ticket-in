import { asc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.js';
import type { OutboxEventRecord, OutboxRepositoryPort } from './outbox.repository.port.js';

export class DrizzleOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async fetchPendingEvents(batchSize: number): Promise<OutboxEventRecord[]> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.status, 'PENDING'))
        .orderBy(asc(schema.outboxEvents.createdAt))
        .limit(batchSize)
        .for('update', { skipLocked: true });

      return rows.map((r) => ({
        id: r.id,
        aggregateType: r.aggregateType,
        aggregateId: r.aggregateId,
        eventType: r.eventType,
        payload: r.payload as Record<string, unknown>,
        status: r.status,
        retryCount: r.retryCount,
        createdAt: r.createdAt,
      }));
    });
  }

  async markPublished(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) {
      return;
    }

    await this.db
      .update(schema.outboxEvents)
      .set({ status: 'PUBLISHED' })
      .where(inArray(schema.outboxEvents.id, eventIds));
  }

  async incrementRetry(eventId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ retryCount: schema.outboxEvents.retryCount })
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.id, eventId))
        .limit(1);

      if (rows[0]) {
        await tx
          .update(schema.outboxEvents)
          .set({ retryCount: rows[0].retryCount + 1 })
          .where(eq(schema.outboxEvents.id, eventId));
      }
    });
  }
}
