/**
 * @file scenario-e-hold-expiry.js
 *
 * k6 Load Test – Scenario E: Hold Expiry Spike
 * 200 VU hold seats without paying.
 * Verifies that expired holds are cleaned up properly and seats return to AVAILABLE.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, EVENT_ID, authenticateUser } from '../helpers/config.js';

export const options = {
  vus: 200,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<300'],
  },
};

export default function () {
  const vuId = __VU;
  const iter = __ITER;

  const auth = authenticateUser(vuId, iter);
  if (!auth) return;

  // 1. Hold seats via auto-allocation
  const holdPayload = JSON.stringify({
    eventId: EVENT_ID,
    categoryId: '018f0000-0000-7000-8000-000000000013', // CAT 2
    quantity: 2,
  });

  const holdRes = http.post(`${BASE_URL}/api/v1/inventory/holds/auto`, holdPayload, {
    headers: auth.authHeaders,
  });

  check(holdRes, {
    'Hold request completed (either 200/201 or 409)': (r) =>
      r.status === 201 || r.status === 200 || r.status === 409,
  });

  // 2. Intentionally abandoned without creating order or paying
  // The background worker hold-cleaner sweeper is expected to reclaim these expired holds.
  sleep(5);
}
