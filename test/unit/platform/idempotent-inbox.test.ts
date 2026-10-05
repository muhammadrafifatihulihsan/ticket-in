import { beforeEach, describe, expect, it } from 'vitest';
import { IdempotentInboxService } from '../../../src/platform/inbox/idempotent-inbox.service.js';
import { InMemoryInboxRepository } from '../../../src/platform/inbox/in-memory-inbox.repository.js';

describe('IdempotentInboxService', () => {
  let inboxRepo: InMemoryInboxRepository;
  let inboxService: IdempotentInboxService;

  beforeEach(() => {
    inboxRepo = new InMemoryInboxRepository();
    inboxService = new IdempotentInboxService(inboxRepo);
  });

  it('executes handler on first receipt of an event', async () => {
    let executedCount = 0;
    const result = await inboxService.process('event-101', 'consumer-group-a', async () => {
      executedCount += 1;
    });

    expect(result.executed).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(executedCount).toBe(1);

    const hasBeenProcessed = await inboxRepo.hasBeenProcessed('event-101', 'consumer-group-a');
    expect(hasBeenProcessed).toBe(true);
  });

  it('skips handler execution when receiving a duplicate event with same ID and consumer group', async () => {
    let executedCount = 0;

    // First attempt
    const firstResult = await inboxService.process('event-101', 'consumer-group-a', async () => {
      executedCount += 1;
    });
    expect(firstResult.executed).toBe(true);
    expect(firstResult.duplicate).toBe(false);

    // Duplicate attempt
    const secondResult = await inboxService.process('event-101', 'consumer-group-a', async () => {
      executedCount += 1;
    });
    expect(secondResult.executed).toBe(false);
    expect(secondResult.duplicate).toBe(true);

    // Handler must only have executed once
    expect(executedCount).toBe(1);
  });

  it('allows different consumer groups to process the same event ID independently', async () => {
    let countA = 0;
    let countB = 0;

    const resA = await inboxService.process('event-common', 'consumer-group-a', async () => {
      countA += 1;
    });

    const resB = await inboxService.process('event-common', 'consumer-group-b', async () => {
      countB += 1;
    });

    expect(resA.executed).toBe(true);
    expect(resB.executed).toBe(true);
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });
});
