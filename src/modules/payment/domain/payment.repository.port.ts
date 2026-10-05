import type { PaymentRecord } from './payment.entity.js';

export interface InitiatePaymentParams {
  paymentId: string;
  orderId: string;
  amount: number;
  provider?: string | undefined;
}

export interface RecordPaymentResultParams {
  orderId: string;
  externalId: string;
  status: 'SUCCESS' | 'FAILED';
  signature: string;
  payload: Record<string, unknown>;
}

export interface PaymentProcessOutcome {
  orderId: string;
  status: 'PAID' | 'CANCELLED';
  alreadyProcessed: boolean;
}

export interface PaymentRepositoryPort {
  /**
   * Creates an initial payment record in PENDING status.
   */
  initiatePayment(params: InitiatePaymentParams): Promise<PaymentRecord>;

  /**
   * Atomically records successful payment:
   * Transitions order to PAID,
   * transitions seats from RESERVED to SOLD,
   * updates payment status to PAID with externalId and signature,
   * and records outbox event 'order.paid'.
   * If order is already PAID, returns alreadyProcessed: true idempotenly.
   */
  recordSuccessfulPayment(params: RecordPaymentResultParams): Promise<PaymentProcessOutcome>;

  /**
   * Atomically records failed payment:
   * Transitions order to CANCELLED,
   * releases seats from RESERVED back to AVAILABLE,
   * updates payment status to FAILED,
   * and records outbox event 'order.cancelled'.
   * If order is already CANCELLED, returns alreadyProcessed: true.
   */
  recordFailedPayment(params: RecordPaymentResultParams): Promise<PaymentProcessOutcome>;

  /**
   * Finds a payment record by ID.
   */
  findById(paymentId: string): Promise<PaymentRecord | null>;

  /**
   * Finds a payment record by Order ID.
   */
  findByOrderId(orderId: string): Promise<PaymentRecord | null>;
}
