import type { Clock } from '../../../platform/clock/clock.js';
import { UnauthorizedError } from '../../../platform/errors/problem-details.js';
import type { IdGenerator } from '../../../platform/id/id-generator.js';
import type { PasswordHasher } from '../domain/password-hasher.port.js';
import type { TokenPair, TokenService } from '../domain/token-service.port.js';
import type { RefreshTokenRepository } from './ports/refresh-token.repository.port.js';
import type { UserRepository } from './ports/user.repository.port.js';
import type { UserOutput } from './register.use-case.js';

export interface LoginInput {
  identifier: string; // email or username
  password: string;
}

export interface LoginOutput {
  user: UserOutput;
  tokens: TokenPair;
}

export class LoginUseCase {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly tokenRepo: RefreshTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokenService: TokenService,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: LoginInput): Promise<LoginOutput> {
    const isEmail = input.identifier.includes('@');
    const user = isEmail
      ? await this.userRepo.findByEmail(input.identifier)
      : await this.userRepo.findByUsername(input.identifier);

    if (!user) {
      throw new UnauthorizedError('Invalid credentials.');
    }

    const isMatch = await this.hasher.verify(input.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid credentials.');
    }

    const familyId = this.idGen.generate();
    const version = 1;
    const now = this.clock.now();
    const refreshExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.tokenRepo.saveFamily({
      familyId,
      userId: user.id,
      currentVersion: version,
      isRevoked: false,
      expiresAt: refreshExpiresAt,
    });

    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      role: user.role,
      email: user.email,
    });

    const refreshToken = this.tokenService.generateRefreshToken({
      sub: user.id,
      familyId,
      version,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900, // 15 minutes
      },
    };
  }
}
