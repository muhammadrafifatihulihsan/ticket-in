import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
} from '../../../../src/platform/errors/problem-details.js';
import type { OrderWithItems } from '../../../../src/modules/order/domain/order.entity.js';
import { InMemoryOrderRepository } from '../../../../src/modules/order/infrastructure/in-memory-order.repository.js';
import { GetTicketUseCase } from '../../../../src/modules/ticketing/application/get-ticket.use-case.js';
import { IssueTicketsUseCase } from '../../../../src/modules/ticketing/application/issue-tickets.use-case.js';
import { ListUserTicketsUseCase } from '../../../../src/modules/ticketing/application/list-user-tickets.use-case.js';
import { VerifyTicketUseCase } from '../../../../src/modules/ticketing/application/verify-ticket.use-case.js';
import { InMemoryTicketRepository } from '../../../../src/modules/ticketing/infrastructure/in-memory-ticket.repository.js';

describe('Ticketing Module Application Use Cases', () => {
  let orderRepository: InMemoryOrderRepository;
  let ticketRepository: InMemoryTicketRepository;
  let issueTicketsUseCase: IssueTicketsUseCase;
  let getTicketUseCase: GetTicketUseCase;
  let listUserTicketsUseCase: ListUserTicketsUseCase;
  let verifyTicketUseCase: VerifyTicketUseCase;

  const userA = 'user-001';
  const userB = 'user-002';
  const adminUser = 'admin-999';

  const createMockOrder = (
    id: string,
    userId: string,
    status: 'PENDING' | 'PAID' | 'CANCELLED' | 'REFUNDED',
    seatIds: string[],
  ): OrderWithItems => ({
    id,
    userId,
    eventId: 'event-1',
    status,
    totalAmount: seatIds.length * 500000,
    expiresAt: new Date(Date.now() + 900000),
    createdAt: new Date(),
    updatedAt: new Date(),
    items: seatIds.map((seatId, idx) => ({
      id: `item-${id}-${idx + 1}`,
      orderId: id,
      seatId,
      price: 500000,
      createdAt: new Date(),
    })),
  });

  beforeEach(() => {
    orderRepository = new InMemoryOrderRepository();
    ticketRepository = new InMemoryTicketRepository();
    issueTicketsUseCase = new IssueTicketsUseCase(orderRepository, ticketRepository);
    getTicketUseCase = new GetTicketUseCase(ticketRepository);
    listUserTicketsUseCase = new ListUserTicketsUseCase(ticketRepository);
    verifyTicketUseCase = new VerifyTicketUseCase(ticketRepository);
  });

  describe('IssueTicketsUseCase', () => {
    it('throws NotFoundError if order does not exist', async () => {
      await expect(
        issueTicketsUseCase.execute({ orderId: 'non-existent-order' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws InvalidStateTransitionError if order is not in PAID status', async () => {
      const order = createMockOrder('order-1', userA, 'PENDING', ['seat-1']);
      orderRepository.setOrder(order);

      await expect(
        issueTicketsUseCase.execute({ orderId: order.id }),
      ).rejects.toThrow(InvalidStateTransitionError);
    });

    it('successfully issues digital tickets when order status is PAID', async () => {
      const order = createMockOrder('order-1', userA, 'PAID', ['seat-1', 'seat-2']);
      orderRepository.setOrder(order);

      const tickets = await issueTicketsUseCase.execute({ orderId: order.id });
      expect(tickets).toHaveLength(2);
      const ticket0 = tickets[0]!;
      const ticket1 = tickets[1]!;

      expect(ticket0.status).toBe('ISSUED');
      expect(ticket0.userId).toBe(userA);
      expect(ticket0.orderId).toBe(order.id);
      expect(ticket0.ticketCode).toMatch(/^TIX-\d{8}-[A-F0-9]{10}$/);
      expect(ticket1.ticketCode).toMatch(/^TIX-\d{8}-[A-F0-9]{10}$/);
      expect(ticket0.ticketCode).not.toBe(ticket1.ticketCode);
    });

    it('is idempotent and returns existing tickets without creating duplicates', async () => {
      const order = createMockOrder('order-1', userA, 'PAID', ['seat-1']);
      orderRepository.setOrder(order);

      const firstCall = await issueTicketsUseCase.execute({ orderId: order.id });
      const secondCall = await issueTicketsUseCase.execute({ orderId: order.id });

      expect(firstCall).toHaveLength(1);
      expect(secondCall).toHaveLength(1);
      const first = firstCall[0]!;
      const second = secondCall[0]!;

      expect(second.id).toBe(first.id);
      expect(second.ticketCode).toBe(first.ticketCode);
    });
  });

  describe('GetTicketUseCase & IDOR Protection', () => {
    it('throws NotFoundError when ticket does not exist', async () => {
      await expect(
        getTicketUseCase.execute({
          ticketId: 'unknown-ticket',
          requestingUserId: userA,
          requestingRole: 'customer',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('allows ticket owner to view ticket details', async () => {
      const order = createMockOrder('order-1', userA, 'PAID', ['seat-1']);
      orderRepository.setOrder(order);
      const tickets = await issueTicketsUseCase.execute({ orderId: order.id });
      const createdTicket = tickets[0]!;

      const ticket = await getTicketUseCase.execute({
        ticketId: createdTicket.id,
        requestingUserId: userA,
        requestingRole: 'customer',
      });

      expect(ticket.id).toBe(createdTicket.id);
      expect(ticket.userId).toBe(userA);
      expect(ticket.seatNumber).toBeDefined();
    });

    it('rejects access with ForbiddenError when requested by another user (IDOR prevention)', async () => {
      const order = createMockOrder('order-1', userA, 'PAID', ['seat-1']);
      orderRepository.setOrder(order);
      const tickets = await issueTicketsUseCase.execute({ orderId: order.id });
      const createdTicket = tickets[0]!;

      await expect(
        getTicketUseCase.execute({
          ticketId: createdTicket.id,
          requestingUserId: userB,
          requestingRole: 'customer',
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows admin to view ticket owned by any user', async () => {
      const order = createMockOrder('order-1', userA, 'PAID', ['seat-1']);
      orderRepository.setOrder(order);
      const tickets = await issueTicketsUseCase.execute({ orderId: order.id });
      const createdTicket = tickets[0]!;

      const ticket = await getTicketUseCase.execute({
        ticketId: createdTicket.id,
        requestingUserId: adminUser,
        requestingRole: 'admin',
      });

      expect(ticket.id).toBe(createdTicket.id);
    });
  });

  describe('ListUserTicketsUseCase', () => {
    it('returns only tickets owned by the requesting user', async () => {
      const orderA = createMockOrder('order-a', userA, 'PAID', ['seat-1']);
      const orderB = createMockOrder('order-b', userB, 'PAID', ['seat-2']);
      orderRepository.setOrder(orderA);
      orderRepository.setOrder(orderB);

      await issueTicketsUseCase.execute({ orderId: orderA.id });
      await issueTicketsUseCase.execute({ orderId: orderB.id });

      const ticketsA = await listUserTicketsUseCase.execute({ userId: userA });
      expect(ticketsA).toHaveLength(1);
      expect(ticketsA[0]!.userId).toBe(userA);

      const ticketsB = await listUserTicketsUseCase.execute({ userId: userB });
      expect(ticketsB).toHaveLength(1);
      expect(ticketsB[0]!.userId).toBe(userB);
    });
  });

  describe('VerifyTicketUseCase (Check-in)', () => {
    it('rejects verification if requester is not organizer or admin', async () => {
      await expect(
        verifyTicketUseCase.execute({
          ticketIdOrCode: 'some-ticket',
          verifierRole: 'customer',
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects verification if ticket is not found', async () => {
      await expect(
        verifyTicketUseCase.execute({
          ticketIdOrCode: 'unknown-ticket',
          verifierRole: 'organizer',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('successfully verifies and checks in an ISSUED ticket', async () => {
      const order = createMockOrder('order-1', userA, 'PAID', ['seat-1']);
      orderRepository.setOrder(order);
      const tickets = await issueTicketsUseCase.execute({ orderId: order.id });
      const createdTicket = tickets[0]!;

      const verified = await verifyTicketUseCase.execute({
        ticketIdOrCode: createdTicket.ticketCode,
        verifierRole: 'organizer',
      });

      expect(verified.id).toBe(createdTicket.id);
      expect(verified.status).toBe('CHECKED_IN');
    });

    it('throws ConflictError if ticket is already checked in', async () => {
      const order = createMockOrder('order-1', userA, 'PAID', ['seat-1']);
      orderRepository.setOrder(order);
      const tickets = await issueTicketsUseCase.execute({ orderId: order.id });
      const createdTicket = tickets[0]!;

      // First check-in
      await verifyTicketUseCase.execute({
        ticketIdOrCode: createdTicket.id,
        verifierRole: 'organizer',
      });

      // Second check-in must fail with ConflictError
      await expect(
        verifyTicketUseCase.execute({
          ticketIdOrCode: createdTicket.id,
          verifierRole: 'organizer',
        }),
      ).rejects.toThrow(ConflictError);
    });
  });
});
