import type { InboxRepositoryPort } from './inbox.repository.port.js';

export interface IdempotentProcessResult {
  executed: boolean;
  duplicate: boolean;
}

export class IdempotentInboxService {
  constructor(private readonly inboxRepository: InboxRepositoryPort) {}

  async process(
    eventId: string,
    consumerGroup: string,
    handler: () => Promise<void>,
  ): Promise<IdempotentProcessResult> {
    const isNew = await this.inboxRepository.recordProcessed(eventId, consumerGroup);
    if (!isNew) {
      return { executed: false, duplicate: true };
    }

    await handler();
    return { executed: true, duplicate: false };
  }
}
