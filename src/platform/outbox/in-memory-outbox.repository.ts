import type {
  OutboxEventRecord,
  OutboxRepositoryPort,
} from './outbox.repository.port.js';

export class InMemoryOutboxRepository implements OutboxRepositoryPort {
  private readonly events = new Map<string, OutboxEventRecord>();
  private readonly lockedEventIds = new Set<string>();

  addEvent(event: OutboxEventRecord): void {
    this.events.set(event.id, { ...event });
  }

  async fetchPendingEvents(batchSize: number): Promise<OutboxEventRecord[]> {
    const results: OutboxEventRecord[] = [];

    // Filter events where status is PENDING and not currently locked by another worker (SKIP LOCKED)
    for (const event of this.events.values()) {
      if (results.length >= batchSize) {
        break;
      }
      if (event.status === 'PENDING' && !this.lockedEventIds.has(event.id)) {
        this.lockedEventIds.add(event.id);
        results.push({ ...event });
      }
    }

    return results;
  }

  async markPublished(eventIds: string[]): Promise<void> {
    for (const id of eventIds) {
      const event = this.events.get(id);
      if (event) {
        event.status = 'PUBLISHED';
      }
      this.lockedEventIds.delete(id);
    }
  }

  async incrementRetry(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (event) {
      event.retryCount += 1;
    }
    this.lockedEventIds.delete(eventId);
  }

  getEvent(id: string): OutboxEventRecord | undefined {
    return this.events.get(id);
  }

  getAllEvents(): OutboxEventRecord[] {
    return Array.from(this.events.values()).map((e) => ({ ...e }));
  }
}
