import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../../../src/platform/errors/problem-details.js';
import { JwtTokenService } from '../../../../src/modules/identity/infrastructure/jwt-token-service.js';

describe('JwtTokenService', () => {
  const service = new JwtTokenService(
    'test_access_secret_minimum_32_characters_123',
    'test_refresh_secret_minimum_32_characters_456',
    '15m',
    '7d',
  );

  it('generates and verifies valid access tokens', () => {
    const token = service.generateAccessToken({
      sub: 'usr-001',
      role: 'organizer',
      email: 'organizer@test.com',
    });

    const payload = service.verifyAccessToken(token);
    expect(payload.sub).toBe('usr-001');
    expect(payload.role).toBe('organizer');
    expect(payload.email).toBe('organizer@test.com');
  });

  it('generates and verifies valid refresh tokens', () => {
    const token = service.generateRefreshToken({
      sub: 'usr-001',
      familyId: 'fam-100',
      version: 3,
    });

    const payload = service.verifyRefreshToken(token);
    expect(payload.sub).toBe('usr-001');
    expect(payload.familyId).toBe('fam-100');
    expect(payload.version).toBe(3);
  });

  it('rejects tampered or forged tokens with UnauthorizedError', () => {
    expect(() => service.verifyAccessToken('invalid.token.here')).toThrow(UnauthorizedError);
  });
});
