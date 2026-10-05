import { describe, expect, it } from 'vitest';
import { FrozenClock, SystemClock } from '../../../src/platform/clock/clock.js';

describe('Clock Port', () => {
  it('SystemClock returns a recent valid date', () => {
    const clock = new SystemClock();
    const now = clock.now();
    expect(now).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - now.getTime())).toBeLessThan(1000);
  });

  it('FrozenClock holds time static until advanced', () => {
    const fixed = new Date('2026-10-06T12:00:00.000Z');
    const clock = new FrozenClock(fixed);

    expect(clock.now().toISOString()).toBe('2026-10-06T12:00:00.000Z');

    clock.advanceByMs(5000);
    expect(clock.now().toISOString()).toBe('2026-10-06T12:00:05.000Z');

    const newTarget = new Date('2026-12-31T23:59:59.000Z');
    clock.set(newTarget);
    expect(clock.now().toISOString()).toBe('2026-12-31T23:59:59.000Z');
  });
});
