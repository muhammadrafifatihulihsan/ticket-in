import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../../../src/platform/errors/problem-details.js';
import type { RefreshTokenRepository, TokenFamilyRecord } from '../../../../src/modules/identity/application/ports/refresh-token.repository.port.js';
import type { UserRepository } from '../../../../src/modules/identity/application/ports/user.repository.port.js';
import { RefreshTokenUseCase } from '../../../../src/modules/identity/application/refresh-token.use-case.js';
import type { AccessTokenPayload, RefreshTokenPayload, TokenService } from '../../../../src/modules/identity/domain/token-service.port.js';
import { User } from '../../../../src/modules/identity/domain/user.entity.js';

class MockUserRepository implements UserRepository {
  user: User | null = null;
  async findById(id: string): Promise<User | null> {
    return this.user?.id === id ? this.user : null;
  }
  async findByEmail(): Promise<User | null> {
    return null;
  }
  async findByUsername(): Promise<User | null> {
    return null;
  }
  async create(): Promise<void> {}
}

class MockTokenRepo implements RefreshTokenRepository {
  family: TokenFamilyRecord | null = null;
  async saveFamily(record: TokenFamilyRecord): Promise<void> {
    this.family = record;
  }
  async findFamily(familyId: string): Promise<TokenFamilyRecord | null> {
    return this.family?.familyId === familyId ? this.family : null;
  }
  async updateVersion(familyId: string, newVersion: number): Promise<void> {
    if (this.family?.familyId === familyId) {
      this.family.currentVersion = newVersion;
    }
  }
  async revokeFamily(familyId: string): Promise<void> {
    if (this.family?.familyId === familyId) {
      this.family.isRevoked = true;
    }
  }
}

class MockTokenService implements TokenService {
  generateAccessToken(payload: AccessTokenPayload): string {
    return `access_${payload.sub}_${payload.role}`;
  }
  generateRefreshToken(payload: RefreshTokenPayload): string {
    return `token_${payload.familyId}_v${payload.version}`;
  }
  verifyAccessToken(): AccessTokenPayload {
    return { sub: 'u1', role: 'user', email: 'u@test.com' };
  }
  verifyRefreshToken(token: string): RefreshTokenPayload {
    const parts = token.split('_');
    const familyId = parts[1] ?? 'fam-1';
    const version = Number(parts[2]?.replace('v', '') ?? 1);
    return { sub: 'u1', familyId, version };
  }
}

describe('RefreshTokenUseCase', () => {
  it('rotates valid refresh token and increments version', async () => {
    const userRepo = new MockUserRepository();
    const tokenRepo = new MockTokenRepo();
    const tokenService = new MockTokenService();

    userRepo.user = new User({
      id: 'u1',
      email: 'u1@test.com',
      username: 'u1',
      passwordHash: 'hash',
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    tokenRepo.family = {
      familyId: 'fam-alpha',
      userId: 'u1',
      currentVersion: 1,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 100000),
    };

    const useCase = new RefreshTokenUseCase(tokenRepo, userRepo, tokenService);

    const result = await useCase.execute({ refreshToken: 'token_fam-alpha_v1' });

    expect(result.refreshToken).toBe('token_fam-alpha_v2');
    expect(tokenRepo.family.currentVersion).toBe(2);
    expect(tokenRepo.family.isRevoked).toBe(false);
  });

  it('detects token reuse and revokes entire family', async () => {
    const userRepo = new MockUserRepository();
    const tokenRepo = new MockTokenRepo();
    const tokenService = new MockTokenService();

    userRepo.user = new User({
      id: 'u1',
      email: 'u1@test.com',
      username: 'u1',
      passwordHash: 'hash',
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Already rotated to version 2
    tokenRepo.family = {
      familyId: 'fam-alpha',
      userId: 'u1',
      currentVersion: 2,
      isRevoked: false,
      expiresAt: new Date(Date.now() + 100000),
    };

    const useCase = new RefreshTokenUseCase(tokenRepo, userRepo, tokenService);

    // Attacker tries to reuse old token v1
    await expect(
      useCase.execute({ refreshToken: 'token_fam-alpha_v1' }),
    ).rejects.toThrow(UnauthorizedError);

    // Family is now revoked!
    expect(tokenRepo.family.isRevoked).toBe(true);
  });
});
