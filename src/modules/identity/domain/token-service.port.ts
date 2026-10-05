import type { UserRole } from './user.entity.js';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  email: string;
}

export interface RefreshTokenPayload {
  sub: string;
  familyId: string;
  version: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface TokenService {
  generateAccessToken(payload: AccessTokenPayload): string;
  generateRefreshToken(payload: RefreshTokenPayload): string;
  verifyAccessToken(token: string): AccessTokenPayload;
  verifyRefreshToken(token: string): RefreshTokenPayload;
}
