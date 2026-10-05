export interface KafkaEnvelope<T = Record<string, unknown>> {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: T;
  timestamp: string;
}

export interface KafkaPublishResult {
  topic: string;
  partition?: number;
  offset?: string;
}

export interface MessageProducerPort {
  publish<T = Record<string, unknown>>(
    topic: string,
    message: KafkaEnvelope<T>,
    key?: string,
  ): Promise<KafkaPublishResult>;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
}

export type EventHandler<T = Record<string, unknown>> = (
  envelope: KafkaEnvelope<T>,
) => Promise<void>;

export interface MessageConsumerPort {
  subscribe<T = Record<string, unknown>>(topic: string, handler: EventHandler<T>): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
