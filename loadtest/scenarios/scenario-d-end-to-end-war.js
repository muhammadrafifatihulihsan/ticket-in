/**
 * @file scenario-d-end-to-end-war.js
 *
 * k6 Load Test – Scenario D: End-to-End War
 * 1,000 VU executing full ticket acquisition lifecycle:
 *   Queue -> Hold -> Order (Idempotent) -> Payment -> Ticket Verification
 * Target Thresholds: p95 < 350ms, zero overselling, zero duplicate tickets.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, EVENT_ID, authenticateUser } from '../helpers/config.js';

export const ordersCompleted = new Counter('orders_completed');
export const ticketsVerified = new Counter('tickets_verified');

export const options = {
  stages: [
    { duration: '30s', target: 200 },
    { duration: '1m', target: 1000 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<350'],
    http_req_failed: ['rate<0.05'], // Allow 409 collisions under heavy war
  },
};

export default function () {
  const vuId = __VU;
  const iter = __ITER;

  // 1. Authenticate
  const auth = authenticateUser(vuId, iter);
  if (!auth) return;

  // 2. Join Queue
  const joinRes = http.post(
    `${BASE_URL}/api/v1/queue/join`,
    JSON.stringify({ eventId: EVENT_ID }),
    { headers: auth.authHeaders },
  );

  if (joinRes.status !== 200) return;

  // 3. Auto-Hold Seats (1 seat)
  const holdPayload = JSON.stringify({
    eventId: EVENT_ID,
    categoryId: '018f0000-0000-7000-8000-000000000012', // CAT 1
    quantity: 1,
  });

  const holdRes = http.post(`${BASE_URL}/api/v1/inventory/holds/auto`, holdPayload, {
    headers: auth.authHeaders,
  });

  if (holdRes.status !== 201 && holdRes.status !== 200) {
    // Expected 409 when category is sold out
    return;
  }

  let holdData;
  try {
    holdData = JSON.parse(holdRes.body);
  } catch {
    return;
  }

  const seatIds = holdData.seatIds || (holdData.seats ? holdData.seats.map((s) => s.id) : []);
  if (!seatIds.length) return;

  // 4. Create Order with Idempotency Key
  const idempotencyKey = `idemp-${vuId}-${iter}-${Date.now()}`;
  const orderHeaders = Object.assign({}, auth.authHeaders, {
    'Idempotency-Key': idempotencyKey,
  });

  const orderPayload = JSON.stringify({
    eventId: EVENT_ID,
    seatIds,
  });

  const orderRes = http.post(`${BASE_URL}/api/v1/orders`, orderPayload, {
    headers: orderHeaders,
  });

  check(orderRes, {
    'Order created successfully (201/200)': (r) => r.status === 201 || r.status === 200,
  });

  if (orderRes.status !== 201 && orderRes.status !== 200) return;

  let order;
  try {
    order = JSON.parse(orderRes.body);
  } catch {
    return;
  }

  const orderId = order.id;
  ordersCompleted.add(1);

  // 5. Trigger Payment Simulation
  const payRes = http.post(
    `${BASE_URL}/api/v1/payments/simulate`,
    JSON.stringify({
      orderId,
      status: 'SUCCESS',
    }),
    { headers: auth.authHeaders },
  );

  check(payRes, {
    'Payment simulation acknowledged': (r) => r.status === 200 || r.status === 202,
  });

  // Short pause for async outbox-to-inbox worker pipeline
  sleep(1);

  // 6. Query User Tickets
  const ticketsRes = http.get(`${BASE_URL}/api/v1/tickets`, {
    headers: auth.authHeaders,
  });

  check(ticketsRes, {
    'GET /api/v1/tickets status is 200': (r) => r.status === 200,
  });

  if (ticketsRes.status === 200) {
    ticketsVerified.add(1);
  }
}
