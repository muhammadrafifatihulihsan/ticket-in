import type { FastifyPluginAsync } from 'fastify';
import type { TokenService } from '../../identity/domain/token-service.port.js';
import { createAuthMiddleware } from '../../identity/interface/auth.middleware.js';
import { requireRole } from '../../identity/interface/rbac.guard.js';
import type { AdmitQueueUseCase } from '../application/admit-queue.use-case.js';
import type { GetQueueStatusUseCase } from '../application/get-queue-status.use-case.js';
import type { HeartbeatUseCase } from '../application/heartbeat.use-case.js';
import type { JoinQueueUseCase } from '../application/join-queue.use-case.js';
import {
  admitQueueBodySchema,
  admitQueueResponseSchema,
  heartbeatBodySchema,
  joinQueueBodySchema,
  queuePositionResponseSchema,
  queueStatusQuerySchema,
} from './queue.schemas.js';

export interface QueueRoutesOptions {
  joinQueueUseCase: JoinQueueUseCase;
  getQueueStatusUseCase: GetQueueStatusUseCase;
  heartbeatUseCase: HeartbeatUseCase;
  admitQueueUseCase: AdmitQueueUseCase;
  tokenService?: TokenService;
}

export function createQueueRoutes(options: QueueRoutesOptions): FastifyPluginAsync {
  const {
    joinQueueUseCase,
    getQueueStatusUseCase,
    heartbeatUseCase,
    admitQueueUseCase,
    tokenService,
  } = options;

  const authPreHandlers = tokenService ? [createAuthMiddleware(tokenService)] : [];
  const adminPreHandlers = tokenService
    ? [createAuthMiddleware(tokenService), requireRole('admin')]
    : [];

  return async function queueRoutes(fastify) {
    // POST /api/v1/queue/join
    fastify.post('/queue/join', { preHandler: authPreHandlers }, async (req, reply) => {
      const body = joinQueueBodySchema.parse(req.body);
      const position = await joinQueueUseCase.execute(body.eventId, req.user!.id);
      return reply.status(200).send(queuePositionResponseSchema.parse(position));
    });

    // GET /api/v1/queue/status
    fastify.get('/queue/status', { preHandler: authPreHandlers }, async (req, reply) => {
      const query = queueStatusQuerySchema.parse(req.query);
      const position = await getQueueStatusUseCase.execute(query.eventId, req.user!.id);
      return reply.status(200).send(queuePositionResponseSchema.parse(position));
    });

    // POST /api/v1/queue/heartbeat
    fastify.post('/queue/heartbeat', { preHandler: authPreHandlers }, async (req, reply) => {
      const body = heartbeatBodySchema.parse(req.body);
      const result = await heartbeatUseCase.execute(body.eventId, req.user!.id);
      return reply.status(200).send(result);
    });

    // POST /api/v1/queue/admit (Admin on-demand batch admission)
    fastify.post('/queue/admit', { preHandler: adminPreHandlers }, async (req, reply) => {
      const body = admitQueueBodySchema.parse(req.body);
      const result = await admitQueueUseCase.execute(body.eventId, body.batchSize);
      return reply.status(200).send(admitQueueResponseSchema.parse(result));
    });
  };
}
