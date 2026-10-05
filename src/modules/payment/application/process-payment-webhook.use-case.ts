import { UnauthorizedError } from '../../../platform/errors/problem-details.js';
import type {
  PaymentProcessOutcome,
  PaymentRepositoryPort,
} from '../domain/payment.repository.port.js';
import type { HmacSignatureService } from '../infrastructure/hmac-signature.service.js';

export interface WebhookPayload {
  orderId: string;
  externalId: string;
  status: 'SUCCESS' | 'FAILED';
  amount?: number | undefined;
  timestamp?: number | undefined;
}

export interface ProcessPaymentWebhookCommand {
  signature: string;
  timestamp: number;
  payload: WebhookPayload;
}

export class ProcessPaymentWebhookUseCase {
  constructor(
    private readonly paymentRepository: PaymentRepositoryPort,
    private readonly hmacService: HmacSignatureService,
  ) {}

  async execute(command: ProcessPaymentWebhookCommand): Promise<PaymentProcessOutcome> {
    const isValid = this.hmacService.verifySignature(
      command.signature,
      command.timestamp,
      command.payload,
    );

    if (!isValid) {
      throw new UnauthorizedError('Invalid webhook signature or expired timestamp.');
    }

    if (command.payload.status === 'SUCCESS') {
      return this.paymentRepository.recordSuccessfulPayment({
        orderId: command.payload.orderId,
        externalId: command.payload.externalId,
        status: 'SUCCESS',
        signature: command.signature,
        payload: command.payload as unknown as Record<string, unknown>,
      });
    }

    return this.paymentRepository.recordFailedPayment({
      orderId: command.payload.orderId,
      externalId: command.payload.externalId,
      status: 'FAILED',
      signature: command.signature,
      payload: command.payload as unknown as Record<string, unknown>,
    });
  }
}
