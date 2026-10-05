import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../../platform/errors/problem-details.js';
import type { TokenService } from '../domain/token-service.port.js';
import type { UserRole } from '../domain/user.entity.js';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

export function createAuthMiddleware(tokenService: TokenService) {
  return async function authenticateJwt(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or malformed Authorization header.');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedError('Bearer token is empty.');
    }

    const payload = tokenService.verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role,
      email: payload.email,
    };
  };
}
