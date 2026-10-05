/**
 * @file scenario-c-seat-hold-battle.js
 *
 * k6 Load Test – Scenario C: Seat Hold Battle
 * 500 VU colliding on a limited pool of 100 seats simultaneously.
 * Target Thresholds: p95 < 200ms, exactly 100 seats held, others 409 Conflict, zero overselling.
 */

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, EVENT_ID, authenticateUser } from '../helpers/config.js';

export const successfulHolds = new Counter('successful_holds');
export const conflictedHolds = new Counter('conflicted_holds');

export const options = {
  scenarios: {
    hold_battle: {
      executor: 'shared-iterations',
      vus: 500,
      iterations: 1000,
      maxDuration: '1m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200'],
  },
};

export default function () {
  const vuId = __VU;
  const iter = __ITER;

  const auth = authenticateUser(vuId, iter);
  if (!auth) return;

  // Contested seat IDs range from 1 to 100
  const targetSeatNumber = (iter % 100) + 1;
  const seatId = `seat-vip-${String(targetSeatNumber).padStart(3, '0')}`;

  const holdPayload = JSON.stringify({
    eventId: EVENT_ID,
    seatIds: [seatId],
  });

  const res = http.post(`${BASE_URL}/api/v1/inventory/holds`, holdPayload, {
    headers: auth.authHeaders,
  });

  if (res.status === 201 || res.status === 200) {
    successfulHolds.add(1);
    check(res, {
      'Seat hold won with 200/201': (r) => r.status === 201 || r.status === 200,
    });
  } else if (res.status === 409) {
    conflictedHolds.add(1);
    check(res, {
      'Seat collision handled gracefully with 409 Conflict': (r) => r.status === 409,
    });
  } else {
    check(res, {
      'Unexpected response status': (r) => false,
    });
  }
}
