import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerProblemDetailsErrorHandler } from '../../../../src/platform/errors/problem-details.js';
import { JwtTokenService } from '../../../../src/modules/identity/infrastructure/jwt-token-service.js';
import { GetTicketUseCase } from '../../../../src/modules/ticketing/application/get-ticket.use-case.js';
import { ListUserTicketsUseCase } from '../../../../src/modules/ticketing/application/list-user-tickets.use-case.js';
import { VerifyTicketUseCase } from '../../../../src/modules/ticketing/application/verify-ticket.use-case.js';
import { InMemoryTicketRepository } from '../../../../src/modules/ticketing/infrastructure/in-memory-ticket.repository.js';
import { createTicketRoutes } from '../../../../src/modules/ticketing/interface/ticket.routes.js';

describe('Ticketing Routes Integration (Fastify)', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;
  let ticketRepo: InMemoryTicketRepository;

  const userA = '01925b30-745a-714e-b5c9-254199180001';
  const userB = '01925b30-745a-714e-b5c9-254199180002';
  const adminUser = '01925b30-745a-714e-b5c9-254199180099';
  const organizerUser = '01925b30-745a-714e-b5c9-254199180088';

  let tokenA: string;
  let tokenB: string;
  let tokenAdmin: string;
  let tokenOrganizer: string;

  beforeEach(async () => {
    tokenService = new JwtTokenService(
      'super-secret-access-token-key-which-is-long-enough',
      'super-secret-refresh-token-key-which-is-long-enough',
      '15m',
      '7d',
    );

    tokenA = tokenService.generateAccessToken({
      sub: userA,
      email: 'usera@example.com',
      role: 'user',
    });

    tokenB = tokenService.generateAccessToken({
      sub: userB,
      email: 'userb@example.com',
      role: 'user',
    });

    tokenAdmin = tokenService.generateAccessToken({
      sub: adminUser,
      email: 'admin@example.com',
      role: 'admin',
    });

    tokenOrganizer = tokenService.generateAccessToken({
      sub: organizerUser,
      email: 'organizer@example.com',
      role: 'organizer',
    });

    ticketRepo = new InMemoryTicketRepository();

    const getTicketUseCase = new GetTicketUseCase(ticketRepo);
    const listUserTicketsUseCase = new ListUserTicketsUseCase(ticketRepo);
    const verifyTicketUseCase = new VerifyTicketUseCase(ticketRepo);

    app = Fastify();
    registerProblemDetailsErrorHandler(app);

    const routes = createTicketRoutes({
      getTicketUseCase,
      listUserTicketsUseCase,
      verifyTicketUseCase,
      tokenService,
    });

    await app.register(routes, { prefix: '/api/v1' });
  });

  describe('GET /api/v1/tickets', () => {
    it('returns 401 Unauthorized if no Bearer token is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tickets',
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('returns 200 OK with list of tickets for authenticated user', async () => {
      await ticketRepo.issueTicketsForOrder({
        orderId: 'order-1',
        userId: userA,
        items: [{ seatId: 'seat-1' }, { seatId: 'seat-2' }],
      });

      await ticketRepo.issueTicketsForOrder({
        orderId: 'order-2',
        userId: userB,
        items: [{ seatId: 'seat-3' }],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tickets',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const tickets = JSON.parse(res.body);
      expect(tickets).toHaveLength(2);
      expect(tickets[0].userId).toBe(userA);
      expect(tickets[1].userId).toBe(userA);
    });
  });

  describe('GET /api/v1/tickets/:id', () => {
    it('returns 401 Unauthorized if no token is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tickets/any-ticket-id',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 200 OK if requested by ticket owner', async () => {
      const [ticket] = await ticketRepo.issueTicketsForOrder({
        orderId: 'order-1',
        userId: userA,
        items: [{ seatId: 'seat-1' }],
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${ticket!.id}`,
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.id).toBe(ticket!.id);
      expect(data.userId).toBe(userA);
      expect(data.ticketCode).toBeDefined();
    });

    it('returns 403 Forbidden with IDOR protection if requested by another user', async () => {
      const [ticket] = await ticketRepo.issueTicketsForOrder({
        orderId: 'order-1',
        userId: userA,
        items: [{ seatId: 'seat-1' }],
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${ticket!.id}`,
        headers: {
          authorization: `Bearer ${tokenB}`,
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('FORBIDDEN_OBJECT_ACCESS');
    });

    it('returns 200 OK if requested by admin', async () => {
      const [ticket] = await ticketRepo.issueTicketsForOrder({
        orderId: 'order-1',
        userId: userA,
        items: [{ seatId: 'seat-1' }],
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${ticket!.id}`,
        headers: {
          authorization: `Bearer ${tokenAdmin}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.id).toBe(ticket!.id);
    });

    it('returns 404 Not Found if ticket does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tickets/non-existent-ticket-id',
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('RESOURCE_NOT_FOUND');
    });
  });

  describe('POST /api/v1/tickets/:id/verify (Check-in)', () => {
    it('returns 403 Forbidden if called by a regular customer', async () => {
      const [ticket] = await ticketRepo.issueTicketsForOrder({
        orderId: 'order-1',
        userId: userA,
        items: [{ seatId: 'seat-1' }],
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tickets/${ticket!.id}/verify`,
        headers: {
          authorization: `Bearer ${tokenA}`,
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('FORBIDDEN_OBJECT_ACCESS');
    });

    it('returns 200 OK when verified by organizer', async () => {
      const [ticket] = await ticketRepo.issueTicketsForOrder({
        orderId: 'order-1',
        userId: userA,
        items: [{ seatId: 'seat-1' }],
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tickets/${ticket!.id}/verify`,
        headers: {
          authorization: `Bearer ${tokenOrganizer}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.message).toBe('Ticket verified successfully.');
      expect(body.ticket.status).toBe('CHECKED_IN');
    });

    it('returns 409 Conflict when ticket has already been checked in', async () => {
      const [ticket] = await ticketRepo.issueTicketsForOrder({
        orderId: 'order-1',
        userId: userA,
        items: [{ seatId: 'seat-1' }],
      });

      // First verification
      await app.inject({
        method: 'POST',
        url: `/api/v1/tickets/${ticket!.id}/verify`,
        headers: {
          authorization: `Bearer ${tokenOrganizer}`,
        },
      });

      // Second verification attempt
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tickets/${ticket!.id}/verify`,
        headers: {
          authorization: `Bearer ${tokenOrganizer}`,
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('CONFLICT');
    });
  });
});
