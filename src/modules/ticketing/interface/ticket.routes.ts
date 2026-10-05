import type { FastifyPluginAsync } from 'fastify';
import { createAuthMiddleware, type TokenService } from '../../identity/index.js';
import type { GetTicketUseCase } from '../application/get-ticket.use-case.js';
import type { ListUserTicketsUseCase } from '../application/list-user-tickets.use-case.js';
import type { VerifyTicketUseCase } from '../application/verify-ticket.use-case.js';
import type { TicketWithDetails } from '../domain/ticket.entity.js';
import {
  getTicketParamsSchema,
  verifyTicketParamsSchema,
  type TicketResponse,
} from './ticket.schemas.js';

export interface TicketRoutesOptions {
  getTicketUseCase: GetTicketUseCase;
  listUserTicketsUseCase: ListUserTicketsUseCase;
  verifyTicketUseCase: VerifyTicketUseCase;
  tokenService?: TokenService;
}

export function formatTicketResponse(ticket: TicketWithDetails): TicketResponse {
  return {
    id: ticket.id,
    orderId: ticket.orderId,
    seatId: ticket.seatId,
    userId: ticket.userId,
    ticketCode: ticket.ticketCode,
    status: ticket.status,
    issuedAt: ticket.issuedAt.toISOString(),
    seatNumber: ticket.seatNumber,
    seatCategoryName: ticket.seatCategoryName,
    price: ticket.price,
    eventId: ticket.eventId,
    eventName: ticket.eventName,
    eventDate: ticket.eventDate.toISOString(),
    venue: ticket.venue,
  };
}

export function createTicketRoutes(options: TicketRoutesOptions): FastifyPluginAsync {
  const { getTicketUseCase, listUserTicketsUseCase, verifyTicketUseCase, tokenService } = options;

  const authPreHandlers = tokenService ? [createAuthMiddleware(tokenService)] : [];

  return async function ticketRoutes(fastify) {
    // GET /tickets (Protected with JWT, lists authenticated user tickets)
    fastify.get('/tickets', { preHandler: authPreHandlers }, async (req, reply) => {
      const tickets = await listUserTicketsUseCase.execute({
        userId: req.user!.id,
      });

      return reply.status(200).send(tickets.map(formatTicketResponse));
    });

    // GET /tickets/:id (Protected with JWT and IDOR ownership check)
    fastify.get('/tickets/:id', { preHandler: authPreHandlers }, async (req, reply) => {
      const params = getTicketParamsSchema.parse(req.params);
      const ticket = await getTicketUseCase.execute({
        ticketId: params.id,
        requestingUserId: req.user!.id,
        requestingRole: req.user?.role,
      });

      return reply.status(200).send(formatTicketResponse(ticket));
    });

    // POST /tickets/:id/verify (Protected with JWT, verifies ticket for admission)
    fastify.post('/tickets/:id/verify', { preHandler: authPreHandlers }, async (req, reply) => {
      const params = verifyTicketParamsSchema.parse(req.params);
      const ticket = await verifyTicketUseCase.execute({
        ticketIdOrCode: params.id,
        verifierRole: req.user?.role ?? '',
      });

      return reply.status(200).send({
        message: 'Ticket verified successfully.',
        ticket: formatTicketResponse(ticket),
      });
    });
  };
}
