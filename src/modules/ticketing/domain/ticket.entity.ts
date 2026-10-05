import { randomBytes } from 'node:crypto';
import { InvalidStateTransitionError } from '../../../platform/errors/problem-details.js';

export type TicketStatus = 'ISSUED' | 'CHECKED_IN' | 'CANCELLED' | 'REFUNDED';

export interface Ticket {
  id: string;
  orderId: string;
  seatId: string;
  userId: string;
  ticketCode: string;
  status: TicketStatus;
  issuedAt: Date;
}

export interface TicketWithDetails extends Ticket {
  seatNumber: string;
  seatCategoryName: string;
  price: number;
  eventId: string;
  eventName: string;
  eventDate: Date;
  venue: string;
}

const ALLOWED_TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  ISSUED: ['CHECKED_IN', 'CANCELLED', 'REFUNDED'],
  CHECKED_IN: [],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Validates if a ticket status transition is permitted.
 * Throws InvalidStateTransitionError if transition is not permitted.
 */
export function assertValidTicketTransition(from: TicketStatus, to: TicketStatus): void {
  const allowed = ALLOWED_TICKET_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidStateTransitionError(
      `Cannot transition ticket status from '${from}' to '${to}'.`,
    );
  }
}

/**
 * Checks whether a ticket status transition is permitted.
 */
export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED_TICKET_TRANSITIONS[from].includes(to);
}

/**
 * Generates an alphanumeric ticket code with date prefix.
 * Format: TIX-YYYYMMDD-XXXXXXXXXX
 */
export function generateTicketCode(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;
  const randomSuffix = randomBytes(5).toString('hex').toUpperCase();

  return `TIX-${dateStr}-${randomSuffix}`;
}
