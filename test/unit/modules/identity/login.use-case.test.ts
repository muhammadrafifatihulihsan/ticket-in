import { describe, expect, it } from 'vitest';
import { FrozenClock } from '../../../../src/platform/clock/clock.js';
import { UnauthorizedError } from '../../../../src/platform/errors/problem-details.js';
import { DeterministicIdGenerator } from '../../../../src/platform/id/id-generator.js';
import { LoginUseCase } from '../../../../src/modules/identity/application/login.use-case.js';
import type { RefreshTokenRepository, TokenFamilyRecord } from '../../../../src/modules/identity/application/ports/refresh-token.repository.port.js';
import type { UserRepository } from '../../../../src/modules/identity/application/ports/user.repository.port.js';
import type { PasswordHasher } from '../../../../src/modules/identity/domain/password-hasher.port.js';
import type { AccessTokenPayload, RefreshTokenPayload, TokenService } from '../../../../src/modules/identity/domain/token-service.port.js';
import { User } from '../../../../src/modules/identity/domain/user.entity.js';

class MockUserRepository implements UserRepository {
  users: User[] = [];
  async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async findByEmail(email: string): Promise<User | null> {
    return this.users.find((u) => u.email === email.toLowerCase()) ?? null;
  }
  async findByUsername(username: string): Promise<User | null> {
    return this.users.find((u) => u.username === username.toLowerCase()) ?? null;
  }
  async create(user: User): Promise<void> {
    this.users.push(user);
  }
}

class MockTokenRepo implements RefreshTokenRepository {
  families = new Map<string, TokenFamilyRecord>();
  async saveFamily(record: TokenFamilyRecord): Promise<void> {
    this.families.set(record.familyId, record);
  }
  async findFamily(familyId: string): Promise<TokenFamilyRecord | null> {
    return this.families.get(familyId) ?? null;
  }
  async updateVersion(familyId: string, newVersion: number): Promise<void> {
    const f = this.families.get(familyId);
    if (f) f.currentVersion = newVersion;
  }
  async revokeFamily(familyId: string): Promise<void> {
    const f = this.families.get(familyId);
    if (f) f.isRevoked = true;
  }
}

class MockTokenService implements TokenService {
  generateAccessToken(payload: AccessTokenPayload): string {
    return `access_${payload.sub}_${payload.role}`;
  }
  generateRefreshToken(payload: RefreshTokenPayload): string {
    return `refresh_${payload.familyId}_v${payload.version}`;
  }
  verifyAccessToken(): AccessTokenPayload {
    return { sub: 'u1', role: 'user', email: 'u@test.com' };
  }
  verifyRefreshToken(): RefreshTokenPayload {
    return { sub: 'u1', familyId: 'fam-1', version: 1 };
  }
}

class MockPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return `hashed_${plain}`;
  }
  async verify(plain: string, hash: string): Promise<boolean> {
    return hash === `hashed_${plain}`;
  }
}

describe('LoginUseCase', () => {
  it('authenticates valid credentials and generates token pair', async () => {
    const userRepo = new MockUserRepository();
    const tokenRepo = new MockTokenRepo();
    const hasher = new MockPasswordHasher();
    const tokenService = new MockTokenService();
    const idGen = new DeterministicIdGenerator(['fam-123']);
    const clock = new FrozenClock();

    await userRepo.create(
      new User({
        id: 'user-001',
        email: 'andi@example.com',
        username: 'andi',
        passwordHash: 'hashed_secret123',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const useCase = new LoginUseCase(userRepo, tokenRepo, hasher, tokenService, idGen, clock);

    const result = await useCase.execute({
      identifier: 'andi@example.com',
      password: 'secret123',
    });

    expect(result.user.id).toBe('user-001');
    expect(result.tokens.accessToken).toBe('access_user-001_user');
    expect(result.tokens.refreshToken).toBe('refresh_fam-123_v1');
    expect(tokenRepo.families.get('fam-123')?.currentVersion).toBe(1);
  });

  it('rejects incorrect password with UnauthorizedError', async () => {
    const userRepo = new MockUserRepository();
    const tokenRepo = new MockTokenRepo();
    const hasher = new MockPasswordHasher();
    const tokenService = new MockTokenService();
    const idGen = new DeterministicIdGenerator(['fam-123']);
    const clock = new FrozenClock();

    await userRepo.create(
      new User({
        id: 'user-001',
        email: 'andi@example.com',
        username: 'andi',
        passwordHash: 'hashed_secret123',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const useCase = new LoginUseCase(userRepo, tokenRepo, hasher, tokenService, idGen, clock);

    await expect(
      useCase.execute({
        identifier: 'andi@example.com',
        password: 'wrong_password',
      }),
    ).rejects.toThrow(UnauthorizedError);
  });
});
