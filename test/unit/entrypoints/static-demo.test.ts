/**
 * @file static-demo.test.ts
 *
 * Integration tests for the static web demo served by the Fastify API server.
 * Verifies that the public/ assets are correctly mounted and accessible.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiServer } from '../../../src/entrypoints/api.js';
import type { FastifyInstance } from 'fastify';
import { defaultMetricsService } from '../../../src/platform/metrics/metrics.service.js';

describe('Static Web Demo (public/ assets)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApiServer({
      metricsService: defaultMetricsService,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /app returns 200 with text/html content type', async () => {
    const res = await app.inject({ method: 'GET', url: '/app' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('GET /app returns the ticket-in demo page', async () => {
    const res = await app.inject({ method: 'GET', url: '/app' });
    expect(res.body).toContain('ticket-in');
    expect(res.body.toLowerCase()).toContain('<!doctype html>');
  });

  it('GET /app/app.css returns 200 with text/css content type', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/app.css' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
  });

  it('GET /app/app.js returns 200 with javascript content type', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
  });

  it('GET /app/nonexistent.png returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/nonexistent.png' });
    expect(res.statusCode).toBe(404);
  });
});
