import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.js';
import type { InboxRepositoryPort } from './inbox.repository.port.js';

export class DrizzleInboxRepository implements InboxRepositoryPort {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async recordProcessed(eventId: string, consumerGroup: string): Promise<boolean> {
    const result = await this.db
      .insert(schema.inboxEvents)
      .values({
        eventId,
        consumerGroup,
        processedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    return result.length > 0;
  }

  async hasBeenProcessed(eventId: string, consumerGroup: string): Promise<boolean> {
    const rows = await this.db
      .select({ eventId: schema.inboxEvents.eventId })
      .from(schema.inboxEvents)
      .where(
        and(
          eq(schema.inboxEvents.eventId, eventId),
          eq(schema.inboxEvents.consumerGroup, consumerGroup),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }
}
