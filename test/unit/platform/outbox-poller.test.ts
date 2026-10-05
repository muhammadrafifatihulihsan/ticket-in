import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/platform/messaging/in-memory-event-bus.js';
import { InMemoryOutboxRepository } from '../../../src/platform/outbox/in-memory-outbox.repository.js';
import { OutboxPollerService } from '../../../src/platform/outbox/outbox-poller.service.js';

describe('OutboxPollerService', () => {
  let outboxRepo: InMemoryOutboxRepository;
  let eventBus: InMemoryEventBus;
  let poller: OutboxPollerService;

  beforeEach(() => {
    outboxRepo = new InMemoryOutboxRepository();
    eventBus = new InMemoryEventBus();
    poller = new OutboxPollerService({
      outboxRepository: outboxRepo,
      producer: eventBus,
      batchSize: 10,
      pollIntervalMs: 50,
      maxRetries: 3,
    });
  });

  it('returns 0 when there are no pending events', async () => {
    const publishedCount = await poller.pollOnce();
    expect(publishedCount).toBe(0);
    expect(eventBus.publishedMessages).toHaveLength(0);
  });

  it('polls pending events, publishes them to the bus, and updates status to PUBLISHED', async () => {
    outboxRepo.addEvent({
      id: 'event-001',
      aggregateType: 'ORDER',
      aggregateId: 'order-100',
      eventType: 'order.paid',
      payload: { orderId: 'order-100', amount: 500000 },
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
    });

    outboxRepo.addEvent({
      id: 'event-002',
      aggregateType: 'ORDER',
      aggregateId: 'order-200',
      eventType: 'order.created',
      payload: { orderId: 'order-200' },
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
    });

    const publishedCount = await poller.pollOnce();
    expect(publishedCount).toBe(2);

    expect(eventBus.publishedMessages).toHaveLength(2);
    expect(eventBus.publishedMessages[0]!.topic).toBe('order.paid');
    expect(eventBus.publishedMessages[0]!.envelope.id).toBe('event-001');
    expect(eventBus.publishedMessages[1]!.topic).toBe('order.created');

    const e1 = outboxRepo.getEvent('event-001');
    const e2 = outboxRepo.getEvent('event-002');
    expect(e1?.status).toBe('PUBLISHED');
    expect(e2?.status).toBe('PUBLISHED');
  });

  it('increments retry count when publishing fails and leaves status as PENDING', async () => {
    outboxRepo.addEvent({
      id: 'event-fail-1',
      aggregateType: 'ORDER',
      aggregateId: 'order-300',
      eventType: 'order.paid',
      payload: { orderId: 'order-300' },
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
    });

    // Simulate producer network failure
    eventBus.publish = async () => {
      throw new Error('Kafka network connection timeout');
    };

    const count = await poller.pollOnce();
    expect(count).toBe(0);

    const event = outboxRepo.getEvent('event-fail-1');
    expect(event?.status).toBe('PENDING');
    expect(event?.retryCount).toBe(1);
  });

  it('respects batch size limits when polling events', async () => {
    for (let i = 1; i <= 25; i++) {
      outboxRepo.addEvent({
        id: `event-${i}`,
        aggregateType: 'ORDER',
        aggregateId: `order-${i}`,
        eventType: 'order.paid',
        payload: { orderId: `order-${i}` },
        status: 'PENDING',
        retryCount: 0,
        createdAt: new Date(),
      });
    }

    const firstBatchCount = await poller.pollOnce();
    expect(firstBatchCount).toBe(10);
    expect(eventBus.publishedMessages).toHaveLength(10);

    const secondBatchCount = await poller.pollOnce();
    expect(secondBatchCount).toBe(10);
    expect(eventBus.publishedMessages).toHaveLength(20);

    const thirdBatchCount = await poller.pollOnce();
    expect(thirdBatchCount).toBe(5);
    expect(eventBus.publishedMessages).toHaveLength(25);
  });

  it('starts and stops gracefully without throwing errors', async () => {
    expect(poller.getRunningStatus()).toBe(false);
    poller.start();
    expect(poller.getRunningStatus()).toBe(true);
    await poller.stop();
    expect(poller.getRunningStatus()).toBe(false);
  });
});
