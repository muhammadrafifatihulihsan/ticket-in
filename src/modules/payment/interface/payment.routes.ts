import type { FastifyPluginAsync } from 'fastify';
import {
  UnauthorizedError,
  ValidationError,
} from '../../../platform/errors/problem-details.js';
import type { TokenService } from '../../identity/domain/token-service.port.js';
import { createAuthMiddleware } from '../../identity/interface/auth.middleware.js';
import type { CheckoutPaymentUseCase } from '../application/checkout-payment.use-case.js';
import type { ProcessPaymentWebhookUseCase } from '../application/process-payment-webhook.use-case.js';
import {
  checkoutPaymentBodySchema,
  paymentWebhookBodySchema,
} from './payment.schemas.js';

export interface PaymentRoutesOptions {
  checkoutPaymentUseCase: CheckoutPaymentUseCase;
  processPaymentWebhookUseCase: ProcessPaymentWebhookUseCase;
  tokenService?: TokenService;
}

export function createPaymentRoutes(options: PaymentRoutesOptions): FastifyPluginAsync {
  const { checkoutPaymentUseCase, processPaymentWebhookUseCase, tokenService } = options;

  const authPreHandlers = tokenService ? [createAuthMiddleware(tokenService)] : [];

  return async function paymentRoutes(fastify) {
    // POST /payments/checkout (Protected with JWT)
    fastify.post('/payments/checkout', { preHandler: authPreHandlers }, async (req, reply) => {
      const body = checkoutPaymentBodySchema.parse(req.body);
      const result = await checkoutPaymentUseCase.execute({
        orderId: body.orderId,
        userId: req.user!.id,
      });

      return reply.status(200).send({
        paymentId: result.payment.id,
        orderId: result.payment.orderId,
        amount: result.payment.amount,
        status: result.payment.status,
        checkoutUrl: result.checkoutUrl,
      });
    });

    // POST /payments/webhook (Public gateway webhook with HMAC verification)
    fastify.post('/payments/webhook', async (req, reply) => {
      const rawSignature = req.headers['x-webhook-signature'];
      const rawTimestamp = req.headers['x-webhook-timestamp'];

      const signature =
        typeof rawSignature === 'string' ? rawSignature.trim() : undefined;
      const timestampStr =
        typeof rawTimestamp === 'string' ? rawTimestamp.trim() : undefined;

      if (!signature) {
        throw new UnauthorizedError('Header X-Webhook-Signature is required.');
      }

      if (!timestampStr || Number.isNaN(Number(timestampStr))) {
        throw new ValidationError('Header X-Webhook-Timestamp is invalid or missing.', [
          { name: 'x-webhook-timestamp', reason: 'Header must be a valid epoch timestamp' },
        ]);
      }

      const timestamp = Number(timestampStr);
      const body = paymentWebhookBodySchema.parse(req.body);

      const outcome = await processPaymentWebhookUseCase.execute({
        signature,
        timestamp,
        payload: body,
      });

      return reply.status(200).send({
        received: true,
        orderId: outcome.orderId,
        status: outcome.status,
        alreadyProcessed: outcome.alreadyProcessed,
      });
    });
  };
}
