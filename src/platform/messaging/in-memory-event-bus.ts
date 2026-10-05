import type {
  EventHandler,
  KafkaEnvelope,
  KafkaPublishResult,
  MessageConsumerPort,
  MessageProducerPort,
} from './kafka-client.interface.js';

export class InMemoryEventBus implements MessageProducerPort, MessageConsumerPort {
  private readonly handlers = new Map<string, Array<EventHandler<any>>>();
  public readonly publishedMessages: Array<{
    topic: string;
    key?: string | undefined;
    envelope: KafkaEnvelope<any>;
  }> = [];
  public isRunning = false;

  async publish<T = Record<string, unknown>>(
    topic: string,
    message: KafkaEnvelope<T>,
    key?: string,
  ): Promise<KafkaPublishResult> {
    this.publishedMessages.push({ topic, key, envelope: message });

    // Dispatches to subscribed handlers asynchronously
    const topicHandlers = this.handlers.get(topic) ?? [];
    for (const handler of topicHandlers) {
      // Fire handler asynchronously to simulate decoupled messaging
      void handler(message);
    }

    return {
      topic,
      partition: 0,
      offset: String(this.publishedMessages.length - 1),
    };
  }

  async subscribe<T = Record<string, unknown>>(
    topic: string,
    handler: EventHandler<T>,
  ): Promise<void> {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler as EventHandler<any>);
    this.handlers.set(topic, list);
  }

  async start(): Promise<void> {
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }

  clear(): void {
    this.publishedMessages.length = 0;
  }
}
