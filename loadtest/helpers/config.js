/**
 * @file config.js
 *
 * Common configuration and helper functions for k6 load test scenarios.
 */

import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || __ENV.TARGET_URL || 'http://localhost:3000';
export const EVENT_ID = __ENV.EVENT_ID || '018f0000-0000-7000-8000-000000000001';

export const JSON_HEADERS = {
  'Content-Type': 'application/json',
};

/**
 * Creates an authenticated session for a virtual user.
 * Registers a unique user and returns the access token.
 */
export function authenticateUser(vuId, iteration) {
  const email = `k6-user-${vuId}-${iteration}-${Date.now()}@ticketin.test`;
  const password = 'K6SecurePassword123!';

  const registerPayload = JSON.stringify({
    email,
    password,
    name: `k6 VU ${vuId}`,
  });

  const res = http.post(`${BASE_URL}/api/v1/auth/register`, registerPayload, {
    headers: JSON_HEADERS,
  });

  check(res, {
    'user registration succeeded': (r) => r.status === 201 || r.status === 200,
  });

  if (res.status === 201 || res.status === 200) {
    const body = JSON.parse(res.body);
    return {
      token: body.accessToken,
      userId: body.user ? body.user.id : null,
      authHeaders: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${body.accessToken}`,
      },
    };
  }

  return null;
}
