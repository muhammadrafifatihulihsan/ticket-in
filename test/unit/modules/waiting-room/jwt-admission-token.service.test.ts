import { describe, expect, it } from 'vitest';
import { JwtAdmissionTokenService } from '../../../../src/modules/waiting-room/infrastructure/jwt-admission-token.service.js';
import {
  ForbiddenError,
  UnauthorizedError,
} from '../../../../src/platform/errors/problem-details.js';

describe('JwtAdmissionTokenService', () => {
  const secret = 'valid_secret_key_minimum_32_characters_12345';
  const service = new JwtAdmissionTokenService(secret);

  const userId = '0192634e-0000-7000-8000-000000000001';
  const eventId = '0192634e-0000-7000-8000-000000000002';

  it('generates and verifies a valid admission token', () => {
    const token = service.generateToken(userId, eventId, 300);
    expect(typeof token).toBe('string');

    const decoded = service.verifyToken(token, eventId, userId);
    expect(decoded.sub).toBe(userId);
    expect(decoded.eventId).toBe(eventId);
    expect(decoded.type).toBe('admission');
  });

  it('throws ForbiddenError when token user does not match expected user', () => {
    const token = service.generateToken(userId, eventId, 300);
    const differentUser = '0192634e-0000-7000-8000-000000000999';

    expect(() => service.verifyToken(token, eventId, differentUser)).toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when token event does not match expected event', () => {
    const token = service.generateToken(userId, eventId, 300);
    const differentEvent = '0192634e-0000-7000-8000-000000000888';

    expect(() => service.verifyToken(token, differentEvent, userId)).toThrow(ForbiddenError);
  });

  it('throws UnauthorizedError when token is tampered with', () => {
    const token = service.generateToken(userId, eventId, 300);
    const tampered = `${token}tampered`;

    expect(() => service.verifyToken(tampered, eventId, userId)).toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when token has expired', async () => {
    // Generate token with 0 seconds TTL
    const token = service.generateToken(userId, eventId, -1);

    expect(() => service.verifyToken(token, eventId, userId)).toThrow(UnauthorizedError);
  });

  it('rejects secret with length less than 32 characters in constructor', () => {
    expect(() => new JwtAdmissionTokenService('short_secret')).toThrow(
      'WAITING_ROOM_SECRET must be at least 32 characters long',
    );
  });
});
