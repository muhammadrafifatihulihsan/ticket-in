import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  IdempotencyConflictError,
  IdempotencyPayloadMismatchError,
  NotFoundError,
  ValidationError,
  toProblemDetails,
} from '../../../src/platform/errors/problem-details.js';

describe('Problem Details RFC 9457 Mapper', () => {
  it('maps IdempotencyConflictError to 409 Problem Details', () => {
    const error = new IdempotencyConflictError();
    const problem = toProblemDetails(error, '/api/v1/orders');

    expect(problem.status).toBe(409);
    expect(problem.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(problem.instance).toBe('/api/v1/orders');
    expect(problem.type).toBe('https://ticket-in.internal/errors/idempotency-in-progress');
  });

  it('maps ConflictError to 409 Problem Details', () => {
    const error = new ConflictError('Seat has been reserved');
    const problem = toProblemDetails(error);

    expect(problem.status).toBe(409);
    expect(problem.code).toBe('CONFLICT');
    expect(problem.detail).toBe('Seat has been reserved');
  });

  it('maps NotFoundError to 404 Problem Details', () => {
    const error = new NotFoundError('Event not found');
    const problem = toProblemDetails(error);

    expect(problem.status).toBe(404);
    expect(problem.code).toBe('RESOURCE_NOT_FOUND');
    expect(problem.detail).toBe('Event not found');
  });

  it('maps IdempotencyPayloadMismatchError to 422 Problem Details', () => {
    const error = new IdempotencyPayloadMismatchError();
    const problem = toProblemDetails(error);

    expect(problem.status).toBe(422);
    expect(problem.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  it('maps ValidationError with invalidParams to 400 Problem Details', () => {
    const error = new ValidationError('Payload validation failed', [
      { name: 'seatNumber', reason: 'seatNumber is required' },
    ]);
    const problem = toProblemDetails(error);

    expect(problem.status).toBe(400);
    expect(problem.code).toBe('VALIDATION_ERROR');
    expect(problem.invalidParams).toHaveLength(1);
    expect(problem.invalidParams?.[0]?.name).toBe('seatNumber');
  });

  it('maps generic Error to 500 Internal Server Error', () => {
    const error = new Error('Unexpected crash');
    const problem = toProblemDetails(error);

    expect(problem.status).toBe(500);
    expect(problem.code).toBe('INTERNAL_SERVER_ERROR');
    expect(problem.detail).toBe('Unexpected crash');
  });
});
