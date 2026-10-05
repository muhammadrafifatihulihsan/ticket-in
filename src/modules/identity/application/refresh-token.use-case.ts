import { UnauthorizedError } from '../../../platform/errors/problem-details.js';
import type { TokenPair, TokenService } from '../domain/token-service.port.js';
import type { RefreshTokenRepository } from './ports/refresh-token.repository.port.js';
import type { UserRepository } from './ports/user.repository.port.js';

export interface RefreshTokenInput {
  refreshToken: string;
}

export class RefreshTokenUseCase {
  constructor(
    private readonly tokenRepo: RefreshTokenRepository,
    private readonly userRepo: UserRepository,
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: RefreshTokenInput): Promise<TokenPair> {
    let payload;
    try {
      payload = this.tokenService.verifyRefreshToken(input.refreshToken);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token.');
    }

    const family = await this.tokenRepo.findFamily(payload.familyId);
    if (!family || family.isRevoked) {
      throw new UnauthorizedError('Token family has been revoked.');
    }

    // Reuse detection: if version does not match latest active version
    if (payload.version !== family.currentVersion) {
      // Immediate family revocation to prevent replay attack
      await this.tokenRepo.revokeFamily(payload.familyId);
      throw new UnauthorizedError('Refresh token reuse detected. Family access revoked.');
    }

    const user = await this.userRepo.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedError('User no longer exists.');
    }

    const nextVersion = family.currentVersion + 1;
    await this.tokenRepo.updateVersion(payload.familyId, nextVersion);

    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      role: user.role,
      email: user.email,
    });

    const newRefreshToken = this.tokenService.generateRefreshToken({
      sub: user.id,
      familyId: payload.familyId,
      version: nextVersion,
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 900,
    };
  }
}
