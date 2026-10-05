import type { InboxRepositoryPort } from './inbox.repository.port.js';

export class InMemoryInboxRepository implements InboxRepositoryPort {
  private readonly processedSet = new Set<string>();

  async recordProcessed(eventId: string, consumerGroup: string): Promise<boolean> {
    const key = `${eventId}:${consumerGroup}`;
    if (this.processedSet.has(key)) {
      return false;
    }
    this.processedSet.add(key);
    return true;
  }

  async hasBeenProcessed(eventId: string, consumerGroup: string): Promise<boolean> {
    const key = `${eventId}:${consumerGroup}`;
    return this.processedSet.has(key);
  }

  clear(): void {
    this.processedSet.clear();
  }
}
