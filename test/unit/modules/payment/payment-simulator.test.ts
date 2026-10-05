import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPaymentSimulatorApp,
  type PaymentSimulatorOptions,
} from '../../../../src/entrypoints/payment-simulator.js';
import { HmacSignatureService } from '../../../../src/modules/payment/infrastructure/hmac-signature.service.js';
import { SystemClock } from '../../../../src/platform/clock/clock.js';
import { loadConfig } from '../../../../src/platform/config/env.js';

describe('Payment Simulator Engine', () => {
  const cfg = loadConfig({
    ...process.env,
    WEBHOOK_HMAC_SECRET: 'sim-secret-key-32-characters-minimum-length',
    PAYMENT_SIMULATOR_PORT: '3999',
    PAYMENT_SIMULATOR_LATENCY_MS: '10',
  });

  let dispatchedCalls: Array<{ url: string; headers: Record<string, string>; body: unknown }>;
  let hmacVerifier: HmacSignatureService;

  beforeEach(() => {
    dispatchedCalls = [];
    const clock = new SystemClock();
    hmacVerifier = new HmacSignatureService(cfg.WEBHOOK_HMAC_SECRET, clock);
  });

  const customDispatcher: PaymentSimulatorOptions['dispatcher'] = async (url, headers, body) => {
    dispatchedCalls.push({ url, headers, body });
  };

  it('GET /health returns 200 with service name', async () => {
    const app = createPaymentSimulatorApp({ config: cfg, dispatcher: customDispatcher });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'payment-simulator' });
  });

  it('POST /simulate dispatches HMAC-signed webhook to callbackUrl', async () => {
    const app = createPaymentSimulatorApp({ config: cfg, dispatcher: customDispatcher });
    await app.ready();

    const orderId = '01925b30-745a-714e-b5c9-254199180001';
    const callbackUrl = 'http://localhost:3000/api/v1/payments/webhook';

    const res = await app.inject({
      method: 'POST',
      url: '/simulate',
      payload: {
        orderId,
        amount: 250000,
        status: 'SUCCESS',
        callbackUrl,
        delayMs: 20,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe('SUCCESS');
    expect(json.willCallback).toBe(true);

    // Wait for the scheduled callback
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(dispatchedCalls).toHaveLength(1);
    const call = dispatchedCalls[0]!;
    expect(call.url).toBe(callbackUrl);

    // Verify HMAC signature on the dispatched payload
    const signature = call.headers['x-webhook-signature'];
    const timestampStr = call.headers['x-webhook-timestamp'];
    expect(signature).toBeDefined();
    expect(timestampStr).toBeDefined();

    const isValid = hmacVerifier.verifySignature(signature!, Number(timestampStr), call.body);
    expect(isValid).toBe(true);
  });

  it('POST /simulate with duplicate: true dispatches twice', async () => {
    const app = createPaymentSimulatorApp({ config: cfg, dispatcher: customDispatcher });
    await app.ready();

    const orderId = '01925b30-745a-714e-b5c9-254199180002';

    await app.inject({
      method: 'POST',
      url: '/simulate',
      payload: {
        orderId,
        amount: 500000,
        status: 'FAILED',
        delayMs: 10,
        duplicate: true,
      },
    });

    // Wait for initial (10ms) + duplicate (100ms) callback
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(dispatchedCalls.length).toBe(2);
    expect(dispatchedCalls[0]?.body).toEqual(dispatchedCalls[1]?.body);
  });
});
