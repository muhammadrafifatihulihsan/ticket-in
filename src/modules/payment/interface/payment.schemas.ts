import { z } from 'zod';

export const checkoutPaymentBodySchema = z.object({
  orderId: z.string().uuid(),
});

export type CheckoutPaymentBody = z.infer<typeof checkoutPaymentBodySchema>;

export const paymentWebhookBodySchema = z.object({
  orderId: z.string().uuid(),
  externalId: z.string().min(1).max(100),
  status: z.enum(['SUCCESS', 'FAILED']),
  amount: z.number().int().nonnegative().optional(),
  timestamp: z.number().int().positive().optional(),
});

export type PaymentWebhookBody = z.infer<typeof paymentWebhookBodySchema>;

export const checkoutResponseSchema = z.object({
  paymentId: z.string(),
  orderId: z.string(),
  amount: z.number().int(),
  status: z.enum(['PENDING', 'PAID', 'FAILED', 'REFUNDED']),
  checkoutUrl: z.string(),
});

export const webhookResponseSchema = z.object({
  received: z.boolean(),
  orderId: z.string(),
  status: z.enum(['PAID', 'CANCELLED']),
  alreadyProcessed: z.boolean(),
});
