import argon2 from 'argon2';
import type { PasswordHasher } from '../domain/password-hasher.port.js';

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plainText: string): Promise<string> {
    return argon2.hash(plainText, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 1,
    });
  }

  async verify(plainText: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainText);
    } catch {
      return false;
    }
  }
}
