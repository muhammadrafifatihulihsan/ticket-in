import { InvalidStateTransitionError } from '../../../platform/errors/problem-details.js';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300; // 5 minutes tolerance to prevent replay attacks

export interface PaymentRecord {
  id: string;
  orderId: string;
  externalId?: string | undefined;
  provider: string;
  amount: number;
  status: PaymentStatus;
  signature?: string | undefined;
  createdAt: Date;
}

const ALLOWED_PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['PAID', 'FAILED'],
  PAID: ['REFUNDED'],
  FAILED: [],
  REFUNDED: [],
};

/**
 * Validates if a payment status transition is permitted.
 * Throws InvalidStateTransitionError if transition is illegal.
 */
export function assertValidPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): void {
  const allowed = ALLOWED_PAYMENT_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidStateTransitionError(
      `Cannot transition payment status from '${from}' to '${to}'.`,
    );
  }
}

/**
 * Checks whether a payment status transition is permitted.
 */
export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_PAYMENT_TRANSITIONS[from].includes(to);
}
