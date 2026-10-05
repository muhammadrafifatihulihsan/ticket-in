import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApiServer } from '../../../src/entrypoints/api.js';
import { GetEventsUseCase } from '../../../src/modules/catalog/application/get-events.use-case.js';
import { InMemoryCatalogRepository } from '../../../src/modules/catalog/infrastructure/in-memory-catalog.repository.js';
import { JwtTokenService } from '../../../src/modules/identity/infrastructure/jwt-token-service.js';
import { InMemoryTicketRepository } from '../../../src/modules/ticketing/infrastructure/in-memory-ticket.repository.js';
import { GetTicketUseCase } from '../../../src/modules/ticketing/application/get-ticket.use-case.js';
import { ListUserTicketsUseCase } from '../../../src/modules/ticketing/application/list-user-tickets.use-case.js';
import { VerifyTicketUseCase } from '../../../src/modules/ticketing/application/verify-ticket.use-case.js';
import { MetricsService } from '../../../src/platform/metrics/metrics.service.js';
import { Registry } from 'prom-client';

describe('API Server Bootstrap Integration (src/entrypoints/api.ts)', () => {
  let app: FastifyInstance;
  let metricsService: MetricsService;
  let catalogRepo: InMemoryCatalogRepository;
  let ticketRepo: InMemoryTicketRepository;
  let tokenService: JwtTokenService;

  beforeEach(async () => {
    const register = new Registry();
    metricsService = new MetricsService(register);

    catalogRepo = new InMemoryCatalogRepository();
    await catalogRepo.createEvent(
      {
        slug: 'coldplay-jkt',
        title: 'Coldplay Live in Jakarta',
        description: 'Music of the Spheres World Tour',
        venue: 'GBK Stadium',
        saleStartsAt: new Date(Date.now() - 3600000),
        saleEndsAt: new Date(Date.now() + 86400000),
        status: 'PUBLISHED',
      },
      [
        {
          name: 'VIP',
          price: 5000000,
          totalSeats: 100,
        },
      ],
    );

    ticketRepo = new InMemoryTicketRepository();
    tokenService = new JwtTokenService('test-secret-at-least-32-chars-long-12345', 'refresh-secret-32-chars-long-12345', '15m', '7d');

    app = await createApiServer({
      metricsService,
      tokenService,
      catalogRoutesOptions: {
        getEventsUseCase: new GetEventsUseCase(catalogRepo),
        getEventDetailsUseCase: {} as any,
        createEventUseCase: {} as any,
        tokenService,
      },
      ticketRoutesOptions: {
        getTicketUseCase: new GetTicketUseCase(ticketRepo),
        listUserTicketsUseCase: new ListUserTicketsUseCase(ticketRepo),
        verifyTicketUseCase: new VerifyTicketUseCase(ticketRepo),
        tokenService,
      },
    });
  });

  describe('GET /health', () => {
    it('returns 200 OK with server health status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
      expect(body.service).toBe('ticket-in-api');
      expect(body.uptime).toBeTypeOf('number');
    });
  });

  describe('GET /metrics', () => {
    it('returns Prometheus metrics including request duration and default metrics', async () => {
      // Send a request first so metrics are captured
      await app.inject({ method: 'GET', url: '/health' });

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.body).toContain('ticket_in_http_request_duration_seconds');
      expect(res.body).toContain('ticket_in_http_requests_total');
      expect(res.body).toContain('route="/health"');
    });
  });

  describe('GET /docs', () => {
    it('returns OpenAPI Swagger UI', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/docs/',
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('swagger-ui');
    });
  });

  describe('Modular API Routes Mounting', () => {
    it('serves /api/v1/events from the mounted catalog module', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/events',
      });

      expect(res.statusCode).toBe(200);
      const events = JSON.parse(res.body);
      expect(events).toHaveLength(1);
      expect(events[0].slug).toBe('coldplay-jkt');
    });

    it('enforces authentication on protected routes such as /api/v1/tickets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tickets',
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });
});
