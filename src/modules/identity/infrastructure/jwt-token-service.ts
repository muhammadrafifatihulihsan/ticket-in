import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../../platform/errors/problem-details.js';
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
  TokenService,
} from '../domain/token-service.port.js';

export class JwtTokenService implements TokenService {
  constructor(
    private readonly accessSecret: string,
    private readonly refreshSecret: string,
    private readonly accessExpiresIn: string = '15m',
    private readonly refreshExpiresIn: string = '7d',
  ) {}

  generateAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, this.accessSecret, {
      expiresIn: this.accessExpiresIn,
    } as jwt.SignOptions);
  }

  generateRefreshToken(payload: RefreshTokenPayload): string {
    return jwt.sign(payload, this.refreshSecret, {
      expiresIn: this.refreshExpiresIn,
    } as jwt.SignOptions);
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, this.accessSecret) as jwt.JwtPayload & AccessTokenPayload;
      return {
        sub: decoded.sub,
        role: decoded.role,
        email: decoded.email,
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired access token.');
    }
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      const decoded = jwt.verify(token, this.refreshSecret) as jwt.JwtPayload & RefreshTokenPayload;
      return {
        sub: decoded.sub,
        familyId: decoded.familyId,
        version: decoded.version,
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token.');
    }
  }
}
