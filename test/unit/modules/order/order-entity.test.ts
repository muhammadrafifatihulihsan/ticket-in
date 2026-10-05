import { describe, expect, it } from 'vitest';
import {
  assertValidOrderTransition,
  canTransitionOrder,
} from '../../../../src/modules/order/domain/order.entity.js';
import { InvalidStateTransitionError } from '../../../../src/platform/errors/problem-details.js';

describe('Order Entity Domain Transitions', () => {
  it('allows valid transitions from PENDING to PAID and CANCELLED', () => {
    expect(canTransitionOrder('PENDING', 'PAID')).toBe(true);
    expect(canTransitionOrder('PENDING', 'CANCELLED')).toBe(true);
    expect(() => assertValidOrderTransition('PENDING', 'PAID')).not.toThrow();
    expect(() => assertValidOrderTransition('PENDING', 'CANCELLED')).not.toThrow();
  });

  it('allows valid transitions from PAID to REFUNDED', () => {
    expect(canTransitionOrder('PAID', 'REFUNDED')).toBe(true);
    expect(() => assertValidOrderTransition('PAID', 'REFUNDED')).not.toThrow();
  });

  it('rejects illegal transitions with InvalidStateTransitionError', () => {
    expect(canTransitionOrder('PENDING', 'REFUNDED')).toBe(false);
    expect(() => assertValidOrderTransition('PENDING', 'REFUNDED')).toThrow(
      InvalidStateTransitionError,
    );

    expect(canTransitionOrder('PAID', 'CANCELLED')).toBe(false);
    expect(() => assertValidOrderTransition('PAID', 'CANCELLED')).toThrow(
      InvalidStateTransitionError,
    );

    expect(canTransitionOrder('CANCELLED', 'PAID')).toBe(false);
    expect(() => assertValidOrderTransition('CANCELLED', 'PAID')).toThrow(
      InvalidStateTransitionError,
    );

    expect(canTransitionOrder('REFUNDED', 'PAID')).toBe(false);
    expect(() => assertValidOrderTransition('REFUNDED', 'PAID')).toThrow(
      InvalidStateTransitionError,
    );
  });
});
