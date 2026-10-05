import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../../../platform/errors/problem-details.js';
import type { UserRole } from '../domain/user.entity.js';

export function requireRole(...allowedRoles: UserRole[]) {
  return async function roleGuard(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required.');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(', ')}.`);
    }
  };
}

export function requireOwnership(getOwnerId: (req: FastifyRequest) => string) {
  return async function ownershipGuard(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required.');
    }

    const ownerId = getOwnerId(req);
    if (req.user.role !== 'admin' && req.user.id !== ownerId) {
      throw new ForbiddenError('You do not have permission to access this resource.');
    }
  };
}
