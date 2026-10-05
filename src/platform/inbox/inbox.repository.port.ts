export interface InboxRepositoryPort {
  /**
   * Attempts to mark an event as processed for a specific consumer group.
   * Returns true if successfully inserted (first time processing).
   * Returns false if (eventId, consumerGroup) already exists (duplicate delivery).
   */
  recordProcessed(eventId: string, consumerGroup: string): Promise<boolean>;

  /**
   * Checks if an event has already been processed by a consumer group.
   */
  hasBeenProcessed(eventId: string, consumerGroup: string): Promise<boolean>;
}
