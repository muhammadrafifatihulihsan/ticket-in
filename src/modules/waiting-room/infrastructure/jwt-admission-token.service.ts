import jwt from 'jsonwebtoken';
import { ForbiddenError, UnauthorizedError } from '../../../platform/errors/problem-details.js';
import type {
  AdmissionTokenPayload,
  AdmissionTokenServicePort,
} from '../domain/admission-token.port.js';

export class JwtAdmissionTokenService implements AdmissionTokenServicePort {
  constructor(private readonly secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error('WAITING_ROOM_SECRET must be at least 32 characters long');
    }
  }

  generateToken(userId: string, eventId: string, ttlSeconds: number = 600): string {
    const payload: AdmissionTokenPayload = {
      sub: userId,
      eventId,
      type: 'admission',
    };

    return jwt.sign(payload, this.secret, {
      algorithm: 'HS256',
      expiresIn: ttlSeconds,
    });
  }

  verifyToken(token: string, expectedEventId: string, expectedUserId: string): AdmissionTokenPayload {
    try {
      const decoded = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
      }) as AdmissionTokenPayload;

      if (decoded.type !== 'admission') {
        throw new UnauthorizedError('Token is not an admission token.');
      }

      if (decoded.sub !== expectedUserId) {
        throw new ForbiddenError('Admission token does not belong to the authenticated user.');
      }

      if (decoded.eventId !== expectedEventId) {
        throw new ForbiddenError('Admission token is not valid for this event.');
      }

      return decoded;
    } catch (error) {
      if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
        throw error;
      }
      throw new UnauthorizedError('Admission token is invalid or has expired.');
    }
  }
}
