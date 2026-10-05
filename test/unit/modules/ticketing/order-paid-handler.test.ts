import { beforeEach, describe, expect, it } from 'vitest';
import type { OrderWithItems } from '../../../../src/modules/order/domain/order.entity.js';
import { InMemoryOrderRepository } from '../../../../src/modules/order/infrastructure/in-memory-order.repository.js';
import { IssueTicketsUseCase } from '../../../../src/modules/ticketing/application/issue-tickets.use-case.js';
import {
  OrderPaidEventHandler,
  type OrderPaidPayload,
} from '../../../../src/modules/ticketing/application/order-paid-event.handler.js';
import { InMemoryTicketRepository } from '../../../../src/modules/ticketing/infrastructure/in-memory-ticket.repository.js';
import { IdempotentInboxService } from '../../../../src/platform/inbox/idempotent-inbox.service.js';
import { InMemoryInboxRepository } from '../../../../src/platform/inbox/in-memory-inbox.repository.js';
import type { KafkaEnvelope } from '../../../../src/platform/messaging/kafka-client.interface.js';

describe('OrderPaidEventHandler', () => {
  let orderRepo: InMemoryOrderRepository;
  let ticketRepo: InMemoryTicketRepository;
  let inboxRepo: InMemoryInboxRepository;
  let inboxService: IdempotentInboxService;
  let issueTicketsUseCase: IssueTicketsUseCase;
  let handler: OrderPaidEventHandler;

  const orderId = '01925b30-745a-714e-b5c9-254199180777';
  const userId = '01925b30-745a-714e-b5c9-254199180001';

  beforeEach(() => {
    orderRepo = new InMemoryOrderRepository();
    ticketRepo = new InMemoryTicketRepository();
    inboxRepo = new InMemoryInboxRepository();
    inboxService = new IdempotentInboxService(inboxRepo);
    issueTicketsUseCase = new IssueTicketsUseCase(orderRepo, ticketRepo);
    handler = new OrderPaidEventHandler(issueTicketsUseCase, inboxService);

    const paidOrder: OrderWithItems = {
      id: orderId,
      userId,
      eventId: '01925b30-745a-714e-b5c9-254199180010',
      status: 'PAID',
      totalAmount: 1000000,
      expiresAt: new Date(Date.now() + 900000),
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 'item-1',
          orderId,
          seatId: 'seat-101',
          price: 500000,
          createdAt: new Date(),
        },
        {
          id: 'item-2',
          orderId,
          seatId: 'seat-102',
          price: 500000,
          createdAt: new Date(),
        },
      ],
    };

    orderRepo.setOrder(paidOrder);
  });

  it('automatically issues digital tickets upon receiving an order.paid Kafka event', async () => {
    const envelope: KafkaEnvelope<OrderPaidPayload> = {
      id: 'event-paid-001',
      eventType: 'order.paid',
      aggregateType: 'ORDER',
      aggregateId: orderId,
      payload: {
        orderId,
        userId,
        eventId: '01925b30-745a-714e-b5c9-254199180010',
        totalAmount: 1000000,
        seatIds: ['seat-101', 'seat-102'],
      },
      timestamp: new Date().toISOString(),
    };

    const result = await handler.handle(envelope);
    expect(result.executed).toBe(true);

    const tickets = await ticketRepo.findByOrderId(orderId);
    expect(tickets).toHaveLength(2);
    expect(tickets[0]!.status).toBe('ISSUED');
    expect(tickets[1]!.status).toBe('ISSUED');
  });

  it('skips execution idempotently when receiving duplicate order.paid event with the same ID', async () => {
    const envelope: KafkaEnvelope<OrderPaidPayload> = {
      id: 'event-paid-002',
      eventType: 'order.paid',
      aggregateType: 'ORDER',
      aggregateId: orderId,
      payload: { orderId },
      timestamp: new Date().toISOString(),
    };

    // First arrival
    const firstResult = await handler.handle(envelope);
    expect(firstResult.executed).toBe(true);

    // Duplicate arrival
    const secondResult = await handler.handle(envelope);
    expect(secondResult.executed).toBe(false);

    // Tickets must still only be 2 (zero duplicate tickets)
    const tickets = await ticketRepo.findByOrderId(orderId);
    expect(tickets).toHaveLength(2);
  });
});
