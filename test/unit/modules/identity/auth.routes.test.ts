import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { FrozenClock } from '../../../../src/platform/clock/clock.js';
import { DeterministicIdGenerator } from '../../../../src/platform/id/id-generator.js';
import { LoginUseCase } from '../../../../src/modules/identity/application/login.use-case.js';
import { RefreshTokenUseCase } from '../../../../src/modules/identity/application/refresh-token.use-case.js';
import { RegisterUseCase } from '../../../../src/modules/identity/application/register.use-case.js';
import { InMemoryRefreshTokenRepository } from '../../../../src/modules/identity/infrastructure/in-memory-refresh-token.repository.js';
import { JwtTokenService } from '../../../../src/modules/identity/infrastructure/jwt-token-service.js';
import { createAuthRoutes } from '../../../../src/modules/identity/interface/auth.routes.js';
import type { UserRepository } from '../../../../src/modules/identity/application/ports/user.repository.port.js';
import type { PasswordHasher } from '../../../../src/modules/identity/domain/password-hasher.port.js';
import type { User } from '../../../../src/modules/identity/domain/user.entity.js';

class MockUserRepo implements UserRepository {
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

class FastHasher implements PasswordHasher {
  async hash(p: string): Promise<string> {
    return `hash_${p}`;
  }
  async verify(p: string, h: string): Promise<boolean> {
    return h === `hash_${p}`;
  }
}

describe('Auth Fastify Routes', () => {
  it('registers, logs in, and retrieves current user profile', async () => {
    const userRepo = new MockUserRepo();
    const tokenRepo = new InMemoryRefreshTokenRepository();
    const hasher = new FastHasher();
    const tokenService = new JwtTokenService(
      'secret12345678901234567890123456',
      'secret12345678901234567890123456',
    );
    const validUuid = '0192634e-0000-7000-8000-000000000001';
    const idGen = new DeterministicIdGenerator([validUuid, 'fam-1']);
    const clock = new FrozenClock();

    const registerUseCase = new RegisterUseCase(userRepo, hasher, idGen, clock);
    const loginUseCase = new LoginUseCase(userRepo, tokenRepo, hasher, tokenService, idGen, clock);
    const refreshTokenUseCase = new RefreshTokenUseCase(tokenRepo, userRepo, tokenService);

    const app = Fastify();
    await app.register(
      createAuthRoutes({
        registerUseCase,
        loginUseCase,
        refreshTokenUseCase,
        tokenService,
      }),
    );

    // 1. Register
    const regRes = await app.inject({
      method: 'POST',
      url: '/register',
      payload: {
        email: 'budi@example.com',
        username: 'budi_setiawan',
        password: 'passwordKu123!',
      },
    });

    expect(regRes.statusCode).toBe(201);
    const regBody = JSON.parse(regRes.body);
    expect(regBody.username).toBe('budi_setiawan');

    // 2. Login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/login',
      payload: {
        identifier: 'budi_setiawan',
        password: 'passwordKu123!',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const loginBody = JSON.parse(loginRes.body);
    const token = loginBody.tokens.accessToken;
    expect(token).toBeDefined();

    // 3. GET /me with token
    const meRes = await app.inject({
      method: 'GET',
      url: '/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(meRes.statusCode).toBe(200);
    const meBody = JSON.parse(meRes.body);
    expect(meBody.user.id).toBe(validUuid);
  });
});
