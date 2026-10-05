import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DrizzleOrderRepository } from '../modules/order/infrastructure/drizzle-order.repository.js';
import { IssueTicketsUseCase } from '../modules/ticketing/application/issue-tickets.use-case.js';
import {
  OrderPaidEventHandler,
  type OrderPaidPayload,
} from '../modules/ticketing/application/order-paid-event.handler.js';
import { DrizzleTicketRepository } from '../modules/ticketing/infrastructure/drizzle-ticket.repository.js';
import { closeDatabase, db } from '../platform/db/client.js';
import type * as schema from '../platform/db/schema.js';
import { DrizzleInboxRepository } from '../platform/inbox/drizzle-inbox.repository.js';
import { IdempotentInboxService } from '../platform/inbox/idempotent-inbox.service.js';
import { InMemoryEventBus } from '../platform/messaging/in-memory-event-bus.js';
import type {
  MessageConsumerPort,
  MessageProducerPort,
} from '../platform/messaging/kafka-client.interface.js';
import { DrizzleOutboxRepository } from '../platform/outbox/drizzle-outbox.repository.js';
import { OutboxPollerService } from '../platform/outbox/outbox-poller.service.js';

export interface WorkerOptions {
  database?: NodePgDatabase<typeof schema> | undefined;
  eventBus?: (MessageProducerPort & MessageConsumerPort) | undefined;
  pollIntervalMs?: number | undefined;
  batchSize?: number | undefined;
}

export function createWorker(options: WorkerOptions = {}) {
  const database = options.database ?? db;
  const eventBus = options.eventBus ?? new InMemoryEventBus();

  const outboxRepo = new DrizzleOutboxRepository(database);
  const inboxRepo = new DrizzleInboxRepository(database);
  const inboxService = new IdempotentInboxService(inboxRepo);

  const orderRepo = new DrizzleOrderRepository(database);
  const ticketRepo = new DrizzleTicketRepository(database);
  const issueTicketsUseCase = new IssueTicketsUseCase(orderRepo, ticketRepo);
  const orderPaidHandler = new OrderPaidEventHandler(issueTicketsUseCase, inboxService);

  const poller = new OutboxPollerService({
    outboxRepository: outboxRepo,
    producer: eventBus,
    pollIntervalMs: options.pollIntervalMs ?? 1000,
    batchSize: options.batchSize ?? 20,
  });

  return {
    poller,
    eventBus,
    inboxService,
    orderPaidHandler,
    async start(): Promise<void> {
      await eventBus.subscribe<OrderPaidPayload>('order.paid', async (envelope) => {
        await orderPaidHandler.handle(envelope);
      });
      await eventBus.start?.();
      poller.start();
      console.info('Background worker started. Listening for events and polling outbox.');
    },
    async stop(): Promise<void> {
      await poller.stop();
      await eventBus.stop?.();
      console.info('Background worker stopped gracefully.');
    },
  };
}

// Auto-run if executed as main file
if (process.argv[1] && (process.argv[1].endsWith('worker.ts') || process.argv[1].endsWith('worker.js'))) {
  const worker = createWorker();
  void worker.start().catch((err) => {
    console.error('Failed to start worker process:', err);
    process.exit(1);
  });

  const handleShutdown = async (signal: string) => {
    console.info(`Received ${signal}. Shutting down worker...`);
    try {
      await worker.stop();
      await closeDatabase();
      process.exit(0);
    } catch (err) {
      console.error('Error during worker shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void handleShutdown('SIGINT'));
  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
}
