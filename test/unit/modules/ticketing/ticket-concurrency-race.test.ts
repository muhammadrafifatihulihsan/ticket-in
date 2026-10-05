import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../../../src/platform/errors/problem-details.js';
import type { OrderWithItems } from '../../../../src/modules/order/domain/order.entity.js';
import { InMemoryOrderRepository } from '../../../../src/modules/order/infrastructure/in-memory-order.repository.js';
import { IssueTicketsUseCase } from '../../../../src/modules/ticketing/application/issue-tickets.use-case.js';
import { VerifyTicketUseCase } from '../../../../src/modules/ticketing/application/verify-ticket.use-case.js';
import { InMemoryTicketRepository } from '../../../../src/modules/ticketing/infrastructure/in-memory-ticket.repository.js';

describe('Ticketing Module Concurrency & Race Tests', () => {
  it('prevents duplicate ticket issuance across 20 concurrent workers for the same order', async () => {
    const orderRepo = new InMemoryOrderRepository();
    const ticketRepo = new InMemoryTicketRepository();
    const issueTicketsUseCase = new IssueTicketsUseCase(orderRepo, ticketRepo);

    const orderId = '01925b30-745a-714e-b5c9-254199180777';
    const userId = '01925b30-745a-714e-b5c9-254199180001';

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

    const competitorCount = 20;
    const competitors = Array.from({ length: competitorCount }, () =>
      issueTicketsUseCase.execute({ orderId }),
    );

    const results = await Promise.all(competitors);

    // 1. Verify all 20 competitor calls resolved with 2 tickets each
    expect(results).toHaveLength(competitorCount);
    for (const ticketList of results) {
      expect(ticketList).toHaveLength(2);
    }

    // 2. Verify all 20 competitor calls received the exact same ticket IDs and ticket codes
    const baseTickets = results[0]!;
    const baseIds = baseTickets.map((t) => t.id).sort();
    const baseCodes = baseTickets.map((t) => t.ticketCode).sort();

    for (let i = 1; i < results.length; i++) {
      const tickets = results[i]!;
      const ids = tickets.map((t) => t.id).sort();
      const codes = tickets.map((t) => t.ticketCode).sort();
      expect(ids).toEqual(baseIds);
      expect(codes).toEqual(baseCodes);
    }

    // 3. Verify exactly 2 tickets were persisted in the repository (zero duplicate tickets)
    const storedTickets = await ticketRepo.findByOrderId(orderId);
    expect(storedTickets).toHaveLength(2);
  });

  it('handles 20 concurrent check-in verification attempts on the same ticket with exactly 1 success', async () => {
    const orderRepo = new InMemoryOrderRepository();
    const ticketRepo = new InMemoryTicketRepository();
    const issueTicketsUseCase = new IssueTicketsUseCase(orderRepo, ticketRepo);
    const verifyTicketUseCase = new VerifyTicketUseCase(ticketRepo);

    const orderId = '01925b30-745a-714e-b5c9-254199180888';
    const userId = '01925b30-745a-714e-b5c9-254199180001';

    const paidOrder: OrderWithItems = {
      id: orderId,
      userId,
      eventId: '01925b30-745a-714e-b5c9-254199180010',
      status: 'PAID',
      totalAmount: 500000,
      expiresAt: new Date(Date.now() + 900000),
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 'item-1',
          orderId,
          seatId: 'seat-201',
          price: 500000,
          createdAt: new Date(),
        },
      ],
    };

    orderRepo.setOrder(paidOrder);

    const [issuedTicket] = await issueTicketsUseCase.execute({ orderId });
    expect(issuedTicket).toBeDefined();

    const competitorCount = 20;
    const results = await Promise.allSettled(
      Array.from({ length: competitorCount }, () =>
        verifyTicketUseCase.execute({
          ticketIdOrCode: issuedTicket!.id,
          verifierRole: 'organizer',
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 1 check-in should succeed, and 19 should fail with ConflictError
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(19);

    for (const failure of rejected) {
      if (failure.status === 'rejected') {
        expect(failure.reason).toBeInstanceOf(ConflictError);
      }
    }

    // Ticket status in repo must be CHECKED_IN
    const finalTicket = await ticketRepo.findById(issuedTicket!.id);
    expect(finalTicket?.status).toBe('CHECKED_IN');
  });
});
