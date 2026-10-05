import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../../platform/errors/problem-details.js';
import type {
  AdmissionTokenPayload,
  AdmissionTokenServicePort,
} from '../domain/admission-token.port.js';

declare module 'fastify' {
  interface FastifyRequest {
    admission?: AdmissionTokenPayload;
  }
}

export function createAdmissionTokenMiddleware(
  tokenService: AdmissionTokenServicePort,
  getEventId?: (req: FastifyRequest) => string,
) {
  return async function validateAdmissionToken(
    req: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const header = req.headers['x-admission-token'];
    if (!header || typeof header !== 'string' || header.trim().length === 0) {
      throw new UnauthorizedError('Missing required x-admission-token header.');
    }

    if (!req.user) {
      throw new UnauthorizedError('Authentication required before admission token validation.');
    }

    let targetEventId: string | undefined;
    if (getEventId) {
      targetEventId = getEventId(req);
    } else {
      const params = req.params as Record<string, string> | undefined;
      const body = req.body as Record<string, unknown> | undefined;
      const query = req.query as Record<string, string> | undefined;

      targetEventId =
        params?.id ??
        params?.eventId ??
        (typeof body?.eventId === 'string' ? body.eventId : undefined) ??
        query?.eventId;
    }

    if (!targetEventId) {
      throw new UnauthorizedError('Cannot determine eventId for admission verification.');
    }

    const payload = tokenService.verifyToken(header.trim(), targetEventId, req.user.id);
    req.admission = payload;
  };
}
