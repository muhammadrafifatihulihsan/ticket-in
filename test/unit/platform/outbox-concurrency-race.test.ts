import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/platform/messaging/in-memory-event-bus.js';
import { InMemoryOutboxRepository } from '../../../src/platform/outbox/in-memory-outbox.repository.js';
import { OutboxPollerService } from '../../../src/platform/outbox/outbox-poller.service.js';

describe('Transactional Outbox Concurrency & Race Tests', () => {
  it('allows 10 concurrent pollers to process 50 pending events without overlap or duplicates using SKIP LOCKED', async () => {
    const outboxRepo = new InMemoryOutboxRepository();
    const eventBus = new InMemoryEventBus();

    const totalEvents = 50;
    for (let i = 1; i <= totalEvents; i++) {
      outboxRepo.addEvent({
        id: `event-${String(i).padStart(3, '0')}`,
        aggregateType: 'ORDER',
        aggregateId: `order-${i}`,
        eventType: 'order.paid',
        payload: { orderId: `order-${i}`, index: i },
        status: 'PENDING',
        retryCount: 0,
        createdAt: new Date(Date.now() + i),
      });
    }

    // Create 10 concurrent poller instances sharing the same outboxRepo and eventBus
    const pollerCount = 10;
    const pollers = Array.from(
      { length: pollerCount },
      () =>
        new OutboxPollerService({
          outboxRepository: outboxRepo,
          producer: eventBus,
          batchSize: 5,
        }),
    );

    // Run all 10 pollers concurrently in waves until all events are processed
    let remaining = totalEvents;
    let iterations = 0;
    const maxIterations = 20;

    while (remaining > 0 && iterations < maxIterations) {
      iterations++;
      await Promise.all(pollers.map((p) => p.pollOnce()));

      const allEvents = outboxRepo.getAllEvents();
      remaining = allEvents.filter((e) => e.status === 'PENDING').length;
    }

    // 1. All 50 events must now be PUBLISHED
    const allEvents = outboxRepo.getAllEvents();
    expect(allEvents.filter((e) => e.status === 'PUBLISHED')).toHaveLength(totalEvents);

    // 2. Exactly 50 messages must have been published to the event bus
    expect(eventBus.publishedMessages).toHaveLength(totalEvents);

    // 3. Every published message must have a unique envelope ID (zero duplicate publications)
    const publishedIds = eventBus.publishedMessages.map((m) => m.envelope.id);
    const uniqueIds = new Set(publishedIds);
    expect(uniqueIds.size).toBe(totalEvents);
  });
});
