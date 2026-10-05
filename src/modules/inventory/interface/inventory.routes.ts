import type { FastifyPluginAsync } from 'fastify';
import { createAuthMiddleware, type TokenService } from '../../identity/index.js';
import {
  createAdmissionTokenMiddleware,
  type AdmissionTokenServicePort,
} from '../../waiting-room/index.js';
import type { AutoHoldSeatsUseCase } from '../application/auto-hold-seats.use-case.js';
import type { GetEventSeatsUseCase } from '../application/get-event-seats.use-case.js';
import type { HoldSpecificSeatsUseCase } from '../application/hold-specific-seats.use-case.js';
import type { ReleaseHoldUseCase } from '../application/release-hold.use-case.js';
import {
  autoHoldSeatsBodySchema,
  getEventSeatsParamsSchema,
  holdSeatsResponseSchema,
  holdSpecificSeatsBodySchema,
  releaseHoldParamsSchema,
  seatLayoutItemResponseSchema,
} from './inventory.schemas.js';

export interface InventoryRoutesOptions {
  getEventSeatsUseCase: GetEventSeatsUseCase;
  holdSpecificSeatsUseCase: HoldSpecificSeatsUseCase;
  autoHoldSeatsUseCase: AutoHoldSeatsUseCase;
  releaseHoldUseCase: ReleaseHoldUseCase;
  tokenService?: TokenService;
  admissionTokenService?: AdmissionTokenServicePort;
}

export function createInventoryRoutes(options: InventoryRoutesOptions): FastifyPluginAsync {
  const {
    getEventSeatsUseCase,
    holdSpecificSeatsUseCase,
    autoHoldSeatsUseCase,
    releaseHoldUseCase,
    tokenService,
    admissionTokenService,
  } = options;

  const authPreHandlers = tokenService ? [createAuthMiddleware(tokenService)] : [];
  const admissionPreHandlers =
    tokenService && admissionTokenService
      ? [createAuthMiddleware(tokenService), createAdmissionTokenMiddleware(admissionTokenService)]
      : authPreHandlers;

  return async function inventoryRoutes(fastify) {
    // GET /api/v1/events/:id/seats (Protected with JWT and admission token)
    fastify.get('/events/:id/seats', { preHandler: admissionPreHandlers }, async (req, reply) => {
      const params = getEventSeatsParamsSchema.parse(req.params);
      const seats = await getEventSeatsUseCase.execute(params.id);
      const response = seats.map((s) => seatLayoutItemResponseSchema.parse(s));
      return reply.status(200).send(response);
    });

    // POST /api/v1/reservations/holds (Mode 1: Hold specific seats)
    fastify.post(
      '/reservations/holds',
      { preHandler: admissionPreHandlers },
      async (req, reply) => {
        const body = holdSpecificSeatsBodySchema.parse(req.body);
        const result = await holdSpecificSeatsUseCase.execute({
          eventId: body.eventId,
          userId: req.user!.id,
          seatIds: body.seatIds,
          holdTtlSeconds: body.holdTtlSeconds,
        });

        const response = {
          holds: result.holds.map((h) => ({
            id: h.id,
            seatId: h.seatId,
            seatNumber: h.seatNumber,
            userId: h.userId,
            status: h.status,
            expiresAt: h.expiresAt.toISOString(),
            createdAt: h.createdAt.toISOString(),
          })),
          expiresAt: result.expiresAt.toISOString(),
        };

        return reply.status(201).send(holdSeatsResponseSchema.parse(response));
      },
    );

    // POST /api/v1/reservations/auto-holds (Mode 2: Auto-allocation per category)
    fastify.post(
      '/reservations/auto-holds',
      { preHandler: admissionPreHandlers },
      async (req, reply) => {
        const body = autoHoldSeatsBodySchema.parse(req.body);
        const result = await autoHoldSeatsUseCase.execute({
          eventId: body.eventId,
          userId: req.user!.id,
          categoryId: body.categoryId,
          quantity: body.quantity,
          holdTtlSeconds: body.holdTtlSeconds,
        });

        const response = {
          holds: result.holds.map((h) => ({
            id: h.id,
            seatId: h.seatId,
            seatNumber: h.seatNumber,
            userId: h.userId,
            status: h.status,
            expiresAt: h.expiresAt.toISOString(),
            createdAt: h.createdAt.toISOString(),
          })),
          expiresAt: result.expiresAt.toISOString(),
        };

        return reply.status(201).send(holdSeatsResponseSchema.parse(response));
      },
    );

    // DELETE /api/v1/reservations/holds/:id (Voluntary hold release)
    fastify.delete(
      '/reservations/holds/:id',
      { preHandler: authPreHandlers },
      async (req, reply) => {
        const params = releaseHoldParamsSchema.parse(req.params);
        const result = await releaseHoldUseCase.execute(params.id, req.user!.id);
        return reply.status(200).send(result);
      },
    );
  };
}
