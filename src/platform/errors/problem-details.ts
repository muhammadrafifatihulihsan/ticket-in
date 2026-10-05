import type { FastifyInstance } from 'fastify';

/**
 * RFC 9457 Problem Details object structure.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  invalidParams?: Array<{ name: string; reason: string }>;
}

export abstract class DomainError extends Error {
  abstract readonly statusCode: number;
  abstract readonly errorCode: string;
  abstract readonly title: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends DomainError {
  readonly statusCode = 400;
  readonly errorCode = 'VALIDATION_ERROR';
  readonly title = 'Validation Error';
  readonly invalidParams: Array<{ name: string; reason: string }>;

  constructor(message: string, invalidParams: Array<{ name: string; reason: string }> = []) {
    super(message);
    this.invalidParams = invalidParams;
  }
}

export class UnauthorizedError extends DomainError {
  readonly statusCode = 401;
  readonly errorCode = 'UNAUTHORIZED';
  readonly title = 'Unauthorized';
}

export class ForbiddenError extends DomainError {
  readonly statusCode = 403;
  readonly errorCode = 'FORBIDDEN_OBJECT_ACCESS';
  readonly title = 'Forbidden';
}

export class NotFoundError extends DomainError {
  readonly statusCode = 404;
  readonly errorCode = 'RESOURCE_NOT_FOUND';
  readonly title = 'Not Found';
}

export class ConflictError extends DomainError {
  readonly statusCode = 409;
  readonly errorCode = 'CONFLICT';
  readonly title = 'Conflict';
}

export class IdempotencyConflictError extends DomainError {
  readonly statusCode = 409;
  readonly errorCode = 'IDEMPOTENCY_IN_PROGRESS';
  readonly title = 'Idempotency Conflict';

  constructor(message: string = 'A request with the same Idempotency-Key is currently in progress.') {
    super(message);
  }
}

export class IdempotencyPayloadMismatchError extends DomainError {
  readonly statusCode = 422;
  readonly errorCode = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
  readonly title = 'Idempotency Payload Mismatch';

  constructor(message: string = 'The Idempotency-Key was already used with a different request payload.') {
    super(message);
  }
}

export class InvalidStateTransitionError extends DomainError {
  readonly statusCode = 422;
  readonly errorCode = 'INVALID_STATE_TRANSITION';
  readonly title = 'Invalid State Transition';
}

export function toProblemDetails(error: unknown, instance?: string): ProblemDetails {
  if (error instanceof DomainError) {
    const problem: ProblemDetails = {
      type: `https://ticket-in.internal/errors/${error.errorCode.toLowerCase().replace(/_/g, '-')}`,
      title: error.title,
      status: error.statusCode,
      detail: error.message,
      code: error.errorCode,
    };
    if (instance) {
      problem.instance = instance;
    }
    if (error instanceof ValidationError && error.invalidParams.length > 0) {
      problem.invalidParams = error.invalidParams;
    }
    return problem;
  }

  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  return {
    type: 'https://ticket-in.internal/errors/internal-server-error',
    title: 'Internal Server Error',
    status: 500,
    detail: message,
    code: 'INTERNAL_SERVER_ERROR',
    ...(instance ? { instance } : {}),
  };
}

export function registerProblemDetailsErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler(
    (
      error: Error & { statusCode?: number; issues?: Array<{ path: (string | number)[]; message: string }> },
      request,
      reply,
    ) => {
      if (error instanceof DomainError) {
        const problem = toProblemDetails(error, request.url);
        return reply
          .status(error.statusCode)
          .header('content-type', 'application/problem+json')
          .send(problem);
      }

      if (error.name === 'ZodError' && Array.isArray(error.issues)) {
        const problem: ProblemDetails = {
          type: 'https://ticket-in.internal/errors/validation-error',
          title: 'Validation Error',
          status: 400,
          detail: 'Request payload validation failed.',
          instance: request.url,
          code: 'VALIDATION_ERROR',
          invalidParams: error.issues.map((i) => ({
            name: i.path.join('.'),
            reason: i.message,
          })),
        };
        return reply.status(400).header('content-type', 'application/problem+json').send(problem);
      }

      const statusCode =
        typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
          ? error.statusCode
          : 500;

      const problem: ProblemDetails = {
        type: 'https://ticket-in.internal/errors/internal-server-error',
        title: 'Internal Server Error',
        status: statusCode,
        detail: error.message || 'An unexpected error occurred.',
        instance: request.url,
        code: 'INTERNAL_SERVER_ERROR',
      };

      return reply
        .status(statusCode)
        .header('content-type', 'application/problem+json')
        .send(problem);
    },
  );
}

