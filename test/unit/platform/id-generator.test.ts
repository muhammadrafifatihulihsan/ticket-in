import { describe, expect, it } from 'vitest';
import {
  DeterministicIdGenerator,
  UuidV7Generator,
} from '../../../src/platform/id/id-generator.js';

describe('IdGenerator Port', () => {
  it('UuidV7Generator generates unique RFC 9562 UUIDv7 strings', () => {
    const generator = new UuidV7Generator();
    const id1 = generator.generate();
    const id2 = generator.generate();

    expect(id1).not.toBe(id2);
    // UUIDv7 has '7' at character 14 (index 14 in 8-4-4-4-12)
    expect(id1.charAt(14)).toBe('7');
    expect(id2.charAt(14)).toBe('7');
  });

  it('DeterministicIdGenerator yields preset sequence accurately', () => {
    const generator = new DeterministicIdGenerator(['id-alpha', 'id-beta']);
    expect(generator.generate()).toBe('id-alpha');
    expect(generator.generate()).toBe('id-beta');
    expect(generator.generate()).toBe('deterministic-id-3');

    generator.reset();
    expect(generator.generate()).toBe('id-alpha');
  });
});
