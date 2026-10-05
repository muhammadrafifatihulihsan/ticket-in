export interface OutboxEventRecord {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: string;
  retryCount: number;
  createdAt: Date;
}

export interface OutboxRepositoryPort {
  /**
   * Fetches pending outbox events using SKIP LOCKED semantics to allow
   * concurrent workers to process batches without contention.
   */
  fetchPendingEvents(batchSize: number): Promise<OutboxEventRecord[]>;

  /**
   * Marks given events as PUBLISHED.
   */
  markPublished(eventIds: string[]): Promise<void>;

  /**
   * Increments the retry count and records the failure error message.
   */
  incrementRetry(eventId: string, error?: string): Promise<void>;
}
