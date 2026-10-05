import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '../../../../src/modules/identity/infrastructure/argon2-password-hasher.js';

describe('Argon2PasswordHasher', () => {
  it('hashes plain text using argon2id and verifies match', async () => {
    const hasher = new Argon2PasswordHasher();
    const plain = 'superSecurePassword123!';

    const hash = await hasher.hash(plain);
    expect(hash).toContain('$argon2id$');

    const isValid = await hasher.verify(plain, hash);
    expect(isValid).toBe(true);

    const isWrong = await hasher.verify('wrongPassword', hash);
    expect(isWrong).toBe(false);
  });
});
