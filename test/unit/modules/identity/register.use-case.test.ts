import { describe, expect, it } from 'vitest';
import { FrozenClock } from '../../../../src/platform/clock/clock.js';
import { ConflictError } from '../../../../src/platform/errors/problem-details.js';
import { DeterministicIdGenerator } from '../../../../src/platform/id/id-generator.js';
import type { UserRepository } from '../../../../src/modules/identity/application/ports/user.repository.port.js';
import { RegisterUseCase } from '../../../../src/modules/identity/application/register.use-case.js';
import type { PasswordHasher } from '../../../../src/modules/identity/domain/password-hasher.port.js';
import type { User } from '../../../../src/modules/identity/domain/user.entity.js';

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

class MockPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return `hashed_${plain}`;
  }
  async verify(plain: string, hash: string): Promise<boolean> {
    return hash === `hashed_${plain}`;
  }
}

describe('RegisterUseCase', () => {
  it('registers a new user successfully', async () => {
    const userRepo = new MockUserRepository();
    const hasher = new MockPasswordHasher();
    const idGen = new DeterministicIdGenerator(['user-123']);
    const clock = new FrozenClock(new Date('2026-10-06T10:00:00.000Z'));

    const useCase = new RegisterUseCase(userRepo, hasher, idGen, clock);

    const result = await useCase.execute({
      email: 'test@example.com',
      username: 'testuser',
      password: 'password123',
    });

    expect(result.id).toBe('user-123');
    expect(result.email).toBe('test@example.com');
    expect(result.username).toBe('testuser');
    expect(result.role).toBe('user');
    expect(userRepo.users).toHaveLength(1);
    expect(userRepo.users[0]?.passwordHash).toBe('hashed_password123');
  });

  it('rejects duplicate email with ConflictError', async () => {
    const userRepo = new MockUserRepository();
    const hasher = new MockPasswordHasher();
    const idGen = new DeterministicIdGenerator(['u1', 'u2']);
    const clock = new FrozenClock();
    const useCase = new RegisterUseCase(userRepo, hasher, idGen, clock);

    await useCase.execute({
      email: 'duplicate@example.com',
      username: 'user1',
      password: 'pwd',
    });

    await expect(
      useCase.execute({
        email: 'duplicate@example.com',
        username: 'user2',
        password: 'pwd',
      }),
    ).rejects.toThrow(ConflictError);
  });
});
