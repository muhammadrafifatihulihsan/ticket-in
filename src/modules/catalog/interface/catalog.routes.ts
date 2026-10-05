import type { FastifyPluginAsync } from 'fastify';
import type { TokenService } from '../../identity/domain/token-service.port.js';
import { createAuthMiddleware } from '../../identity/interface/auth.middleware.js';
import { requireRole } from '../../identity/interface/rbac.guard.js';
import type { CreateEventUseCase } from '../application/create-event.use-case.js';
import type { GetEventDetailsUseCase } from '../application/get-event-details.use-case.js';
import type { GetEventsUseCase } from '../application/get-events.use-case.js';
import {
  createEventSchema,
  eventDetailResponseSchema,
  eventSummaryResponseSchema,
  getEventParamsSchema,
} from './catalog.schemas.js';

export interface CatalogRoutesOptions {
  getEventsUseCase: GetEventsUseCase;
  getEventDetailsUseCase: GetEventDetailsUseCase;
  createEventUseCase: CreateEventUseCase;
  tokenService?: TokenService;
}

export function createCatalogRoutes(options: CatalogRoutesOptions): FastifyPluginAsync {
  const { getEventsUseCase, getEventDetailsUseCase, createEventUseCase, tokenService } = options;

  return async function catalogRoutes(fastify) {
    // GET /api/v1/events (Public active events)
    fastify.get('/events', async (_req, reply) => {
      const events = await getEventsUseCase.execute();
      const response = events.map((e) => eventSummaryResponseSchema.parse(e));
      return reply.status(200).send(response);
    });

    // GET /api/v1/events/:id (Public event details by id or slug)
    fastify.get('/events/:id', async (req, reply) => {
      const params = getEventParamsSchema.parse(req.params);
      const detail = await getEventDetailsUseCase.execute(params.id);
      return reply.status(200).send(eventDetailResponseSchema.parse(detail));
    });

    // POST /api/v1/organizer/events (Organizer/Admin only)
    const organizerPreHandlers = tokenService
      ? [createAuthMiddleware(tokenService), requireRole('organizer', 'admin')]
      : [];

    fastify.post('/organizer/events', { preHandler: organizerPreHandlers }, async (req, reply) => {
      const body = createEventSchema.parse(req.body);
      const created = await createEventUseCase.execute(body);
      return reply.status(201).send(eventDetailResponseSchema.parse(created));
    });
  };
}
