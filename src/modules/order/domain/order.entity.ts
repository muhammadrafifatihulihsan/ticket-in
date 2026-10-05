import { InvalidStateTransitionError } from '../../../platform/errors/problem-details.js';

export type OrderStatus = 'PENDING' | 'PAID' | 'CANCELLED' | 'REFUNDED';

export const DEFAULT_ORDER_EXPIRATION_SECONDS = 900; // 15 minutes payment window

export interface OrderItem {
  id: string;
  orderId: string;
  seatId: string;
  price: number;
  seatNumber?: string | undefined;
  seatCategoryName?: string | undefined;
  createdAt: Date;
}

export interface Order {
  id: string;
  userId: string;
  eventId: string;
  status: OrderStatus;
  totalAmount: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['PAID', 'CANCELLED'],
  PAID: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Validates if an order status transition is allowed.
 * Throws InvalidStateTransitionError if transition is not permitted.
 */
export function assertValidOrderTransition(from: OrderStatus, to: OrderStatus): void {
  const allowed = ALLOWED_ORDER_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidStateTransitionError(
      `Cannot transition order status from '${from}' to '${to}'.`,
    );
  }
}

/**
 * Checks whether an order status transition is permitted.
 */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_ORDER_TRANSITIONS[from].includes(to);
}
