import type { KafkaEnvelope, MessageProducerPort } from '../messaging/kafka-client.interface.js';
import type { OutboxEventRecord, OutboxRepositoryPort } from './outbox.repository.port.js';

export interface OutboxPollerOptions {
  outboxRepository: OutboxRepositoryPort;
  producer: MessageProducerPort;
  batchSize?: number | undefined;
  pollIntervalMs?: number | undefined;
  maxRetries?: number | undefined;
}

export class OutboxPollerService {
  private readonly outboxRepository: OutboxRepositoryPort;
  private readonly producer: MessageProducerPort;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly maxRetries: number;

  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor(options: OutboxPollerOptions) {
    this.outboxRepository = options.outboxRepository;
    this.producer = options.producer;
    this.batchSize = options.batchSize ?? 20;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.maxRetries = options.maxRetries ?? 5;
  }

  async pollOnce(): Promise<number> {
    if (this.isPolling) {
      return 0;
    }

    this.isPolling = true;
    try {
      const events: OutboxEventRecord[] = await this.outboxRepository.fetchPendingEvents(
        this.batchSize,
      );

      if (events.length === 0) {
        return 0;
      }

      const publishedIds: string[] = [];

      for (const event of events) {
        if (event.retryCount >= this.maxRetries) {
          continue;
        }

        try {
          const envelope: KafkaEnvelope = {
            id: event.id,
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            payload: event.payload,
            timestamp: event.createdAt.toISOString(),
          };

          await this.producer.publish(event.eventType, envelope, event.aggregateId);
          publishedIds.push(event.id);
        } catch {
          await this.outboxRepository.incrementRetry(event.id);
        }
      }

      if (publishedIds.length > 0) {
        await this.outboxRepository.markPublished(publishedIds);
      }

      return publishedIds.length;
    } finally {
      this.isPolling = false;
    }
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    const scheduleNext = () => {
      if (!this.isRunning) {
        return;
      }
      this.pollTimer = setTimeout(async () => {
        try {
          await this.pollOnce();
        } finally {
          scheduleNext();
        }
      }, this.pollIntervalMs);
    };

    scheduleNext();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for in-flight polling to finish
    while (this.isPolling) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  getRunningStatus(): boolean {
    return this.isRunning;
  }
}
