import { describe, expect, it } from 'vitest';
import {
  assertValidTicketTransition,
  canTransitionTicket,
  generateTicketCode,
} from '../../../../src/modules/ticketing/domain/ticket.entity.js';
import { InvalidStateTransitionError } from '../../../../src/platform/errors/problem-details.js';

describe('Ticket Entity Domain Transitions', () => {
  it('allows valid transitions from ISSUED to CHECKED_IN, CANCELLED, and REFUNDED', () => {
    expect(canTransitionTicket('ISSUED', 'CHECKED_IN')).toBe(true);
    expect(canTransitionTicket('ISSUED', 'CANCELLED')).toBe(true);
    expect(canTransitionTicket('ISSUED', 'REFUNDED')).toBe(true);

    expect(() => assertValidTicketTransition('ISSUED', 'CHECKED_IN')).not.toThrow();
    expect(() => assertValidTicketTransition('ISSUED', 'CANCELLED')).not.toThrow();
    expect(() => assertValidTicketTransition('ISSUED', 'REFUNDED')).not.toThrow();
  });

  it('rejects transitions from terminal states', () => {
    expect(canTransitionTicket('CHECKED_IN', 'ISSUED')).toBe(false);
    expect(canTransitionTicket('CHECKED_IN', 'CANCELLED')).toBe(false);
    expect(() => assertValidTicketTransition('CHECKED_IN', 'ISSUED')).toThrow(
      InvalidStateTransitionError,
    );

    expect(canTransitionTicket('CANCELLED', 'CHECKED_IN')).toBe(false);
    expect(() => assertValidTicketTransition('CANCELLED', 'CHECKED_IN')).toThrow(
      InvalidStateTransitionError,
    );

    expect(canTransitionTicket('REFUNDED', 'CHECKED_IN')).toBe(false);
    expect(() => assertValidTicketTransition('REFUNDED', 'CHECKED_IN')).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('generates ticket codes with correct prefix and format', () => {
    const code = generateTicketCode(new Date('2026-10-06T00:00:00Z'));
    expect(code).toMatch(/^TIX-20261006-[A-F0-9]{10}$/);

    const code2 = generateTicketCode();
    expect(code2.startsWith('TIX-')).toBe(true);
    expect(code).not.toBe(code2);
  });
});
