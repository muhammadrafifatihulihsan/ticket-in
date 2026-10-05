/**
 * @file scenario-a-browse.js
 *
 * k6 Load Test – Scenario A: Baseline Browse
 * 50 VU browsing concert catalog and seat maps for 2 minutes.
 * Target Thresholds: p95 < 50ms, error rate < 0.1%
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from '../helpers/config.js';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<50'],
    http_req_failed: ['rate<0.001'],
  },
};

export default function () {
  // 1. Browse list of upcoming events
  const eventsRes = http.get(`${BASE_URL}/api/v1/events`);
  check(eventsRes, {
    'GET /api/v1/events status is 200': (r) => r.status === 200,
    'GET /api/v1/events returns array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body) || (body.data && Array.isArray(body.data));
      } catch {
        return false;
      }
    },
  });

  // Extract first event ID if available
  let eventId = '018f0000-0000-7000-8000-000000000001';
  try {
    const body = JSON.parse(eventsRes.body);
    const list = Array.isArray(body) ? body : body.data || [];
    if (list.length > 0 && list[0].id) {
      eventId = list[0].id;
    }
  } catch {
    // fallback to default eventId
  }

  // 2. View event details
  const detailRes = http.get(`${BASE_URL}/api/v1/events/${eventId}`);
  check(detailRes, {
    'GET /api/v1/events/:id status is 200': (r) => r.status === 200,
  });

  // 3. View event seat map and seat availability
  const seatsRes = http.get(`${BASE_URL}/api/v1/inventory/events/${eventId}/seats`);
  check(seatsRes, {
    'GET /api/v1/inventory/events/:id/seats status is 200': (r) => r.status === 200,
  });

  // User reading think time between 1 and 3 seconds
  sleep(Math.random() * 2 + 1);
}
