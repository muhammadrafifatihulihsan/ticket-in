/**
 * @file scenario-b-queue-surge.js
 *
 * k6 Load Test – Scenario B: Queue Surge
 * 1,000 VU sudden burst joining the virtual waiting room simultaneously.
 * Target Thresholds: p95 < 100ms, zero dropped connections.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, EVENT_ID, JSON_HEADERS, authenticateUser } from '../helpers/config.js';

export const options = {
  scenarios: {
    queue_surge: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 500,
      maxVUs: 1000,
      stages: [
        { duration: '10s', target: 500 },
        { duration: '30s', target: 1000 },
        { duration: '20s', target: 100 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<100'],
    http_req_failed: ['rate<0.001'],
  },
};

export default function () {
  const vuId = __VU;
  const iter = __ITER;

  const auth = authenticateUser(vuId, iter);
  if (!auth) return;

  // 1. Join queue
  const joinPayload = JSON.stringify({
    eventId: EVENT_ID,
  });

  const joinRes = http.post(`${BASE_URL}/api/v1/queue/join`, joinPayload, {
    headers: auth.authHeaders,
  });

  check(joinRes, {
    'POST /api/v1/queue/join status is 200': (r) => r.status === 200,
    'Join response includes rank': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.rank === 'number' || typeof body.position === 'number';
      } catch {
        return false;
      }
    },
  });

  // 2. Poll queue status with jitter
  sleep(Math.random() * 2 + 1);

  const statusRes = http.get(`${BASE_URL}/api/v1/queue/status?eventId=${EVENT_ID}`, {
    headers: auth.authHeaders,
  });

  check(statusRes, {
    'GET /api/v1/queue/status is 200': (r) => r.status === 200,
  });

  // 3. Send heartbeat signal
  const heartbeatRes = http.post(
    `${BASE_URL}/api/v1/queue/heartbeat`,
    JSON.stringify({ eventId: EVENT_ID }),
    { headers: auth.authHeaders },
  );

  check(heartbeatRes, {
    'POST /api/v1/queue/heartbeat is 200': (r) => r.status === 200,
  });
}
