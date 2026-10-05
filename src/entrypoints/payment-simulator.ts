import Fastify, { type FastifyInstance } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { SystemClock } from '../platform/clock/clock.js';
import { config as defaultConfig, type EnvConfig } from '../platform/config/env.js';
import { HmacSignatureService } from '../modules/payment/infrastructure/hmac-signature.service.js';

export const simulatePaymentBodySchema = z.object({
  orderId: z.string().uuid(),
  amount: z.number().int().positive(),
  status: z.enum(['SUCCESS', 'FAILED', 'RANDOM']).optional().default('RANDOM'),
  callbackUrl: z.string().url().optional(),
  delayMs: z.number().int().nonnegative().optional(),
  duplicate: z.boolean().optional().default(false),
});

export type SimulatePaymentBody = z.infer<typeof simulatePaymentBodySchema>;

export interface PaymentSimulatorOptions {
  config?: EnvConfig | undefined;
  dispatcher?: ((url: string, headers: Record<string, string>, body: unknown) => Promise<void>) | undefined;
}

export function createPaymentSimulatorApp(options: PaymentSimulatorOptions = {}): FastifyInstance {
  const cfg = options.config ?? defaultConfig;
  const clock = new SystemClock();
  const hmacService = new HmacSignatureService(cfg.WEBHOOK_HMAC_SECRET, clock);

  const defaultDispatcher = async (url: string, headers: Record<string, string>, body: unknown): Promise<void> => {
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // Discard or log simulated network dispatch errors
      console.error('Simulator webhook dispatch error:', error);
    }
  };

  const dispatch = options.dispatcher ?? defaultDispatcher;

  const app = Fastify({ logger: false });

  // GET /health
  app.get('/health', async (_req, reply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'payment-simulator',
    });
  });

  // POST /simulate
  app.post('/simulate', async (req, reply) => {
    const body = simulatePaymentBodySchema.parse(req.body);

    const simulationId = uuidv7();
    const externalId = `sim-tx-${uuidv7()}`;

    let outcomeStatus: 'SUCCESS' | 'FAILED';
    if (body.status === 'RANDOM') {
      outcomeStatus = Math.random() < cfg.PAYMENT_SIMULATOR_FAILURE_RATE ? 'FAILED' : 'SUCCESS';
    } else {
      outcomeStatus = body.status;
    }

    const callbackUrl =
      body.callbackUrl ?? `${cfg.HOST === '0.0.0.0' ? 'http://localhost' : 'http://' + cfg.HOST}:${cfg.PORT}/api/v1/payments/webhook`;

    const delayMs = body.delayMs ?? cfg.PAYMENT_SIMULATOR_LATENCY_MS;
    const timestamp = Math.floor(clock.now().getTime() / 1000);

    const webhookPayload = {
      orderId: body.orderId,
      externalId,
      status: outcomeStatus,
      amount: body.amount,
      timestamp,
    };

    const signature = hmacService.generateSignature(webhookPayload, timestamp);
    const headers = {
      'x-webhook-signature': signature,
      'x-webhook-timestamp': String(timestamp),
    };

    // Schedule asynchronous webhook callback
    setTimeout(() => {
      void dispatch(callbackUrl, headers, webhookPayload);

      // If duplicate simulation requested, dispatch again after 100ms
      if (body.duplicate) {
        setTimeout(() => {
          void dispatch(callbackUrl, headers, webhookPayload);
        }, 100);
      }
    }, delayMs);

    return reply.status(200).send({
      simulationId,
      orderId: body.orderId,
      externalId,
      status: outcomeStatus,
      scheduledDelayMs: delayMs,
      willCallback: true,
    });
  });

  return app;
}

// Self-starting entrypoint when executed directly
if (process.argv[1]?.endsWith('payment-simulator.ts') || process.argv[1]?.endsWith('payment-simulator.js')) {
  const server = createPaymentSimulatorApp();
  const port = defaultConfig.PAYMENT_SIMULATOR_PORT;
  server.listen({ port, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      console.error('Failed to start Payment Simulator:', err);
      process.exit(1);
    }
    console.info(`Payment Simulator service listening on ${address}`);
  });
}
