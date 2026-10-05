import type { Clock } from '../../../platform/clock/clock.js';
import { ConflictError } from '../../../platform/errors/problem-details.js';
import type { IdGenerator } from '../../../platform/id/id-generator.js';
import type { PasswordHasher } from '../domain/password-hasher.port.js';
import { User, type UserRole } from '../domain/user.entity.js';
import type { UserRepository } from './ports/user.repository.port.js';

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  role?: UserRole;
}

export interface UserOutput {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  createdAt: Date;
}

export class RegisterUseCase {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: RegisterInput): Promise<UserOutput> {
    const existingEmail = await this.userRepo.findByEmail(input.email);
    if (existingEmail) {
      throw new ConflictError('A user with this email address already exists.');
    }

    const existingUsername = await this.userRepo.findByUsername(input.username);
    if (existingUsername) {
      throw new ConflictError('A user with this username already exists.');
    }

    const passwordHash = await this.hasher.hash(input.password);
    const now = this.clock.now();

    const user = new User({
      id: this.idGen.generate(),
      email: input.email,
      username: input.username,
      passwordHash,
      role: input.role ?? 'user',
      createdAt: now,
      updatedAt: now,
    });

    await this.userRepo.create(user);

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
