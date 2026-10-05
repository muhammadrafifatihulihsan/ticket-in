import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { CreateEventUseCase } from '../../../../src/modules/catalog/application/create-event.use-case.js';
import { GetEventDetailsUseCase } from '../../../../src/modules/catalog/application/get-event-details.use-case.js';
import { GetEventsUseCase } from '../../../../src/modules/catalog/application/get-events.use-case.js';
import { InMemoryCatalogCache } from '../../../../src/modules/catalog/infrastructure/in-memory-catalog-cache.js';
import { InMemoryCatalogRepository } from '../../../../src/modules/catalog/infrastructure/in-memory-catalog.repository.js';
import { createCatalogRoutes } from '../../../../src/modules/catalog/interface/catalog.routes.js';
import { JwtTokenService } from '../../../../src/modules/identity/infrastructure/jwt-token-service.js';
import { registerProblemDetailsErrorHandler } from '../../../../src/platform/errors/problem-details.js';

describe('Catalog Fastify Routes', () => {
  let repo: InMemoryCatalogRepository;
  let cache: InMemoryCatalogCache;
  let tokenService: JwtTokenService;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    repo = new InMemoryCatalogRepository();
    cache = new InMemoryCatalogCache();
    tokenService = new JwtTokenService(
      'secret12345678901234567890123456',
      'secret12345678901234567890123456',
    );

    const getEventsUseCase = new GetEventsUseCase(repo, cache);
    const getEventDetailsUseCase = new GetEventDetailsUseCase(repo, cache);
    const createEventUseCase = new CreateEventUseCase(repo, cache);

    app = Fastify();
    registerProblemDetailsErrorHandler(app);

    await app.register(
      createCatalogRoutes({
        getEventsUseCase,
        getEventDetailsUseCase,
        createEventUseCase,
        tokenService,
      }),
    );
  });

  it('GET /events returns active events list', async () => {
    await repo.createEvent(
      {
        slug: 'active-concert',
        title: 'Active Concert',
        venue: 'GBK Jakarta',
        saleStartsAt: new Date(),
        saleEndsAt: new Date(Date.now() + 86400000),
      },
      [{ name: 'VIP', price: 1500000, totalSeats: 100 }],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/events',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0]?.slug).toBe('active-concert');
  });

  it('GET /events/:id returns event details with categories', async () => {
    const event = await repo.createEvent(
      {
        slug: 'detail-concert',
        title: 'Detail Concert',
        description: 'Concert description',
        venue: 'Tennis Indoor',
        saleStartsAt: new Date(),
        saleEndsAt: new Date(Date.now() + 86400000),
      },
      [{ name: 'CAT1', price: 800000, totalSeats: 400 }],
    );

    const res = await app.inject({
      method: 'GET',
      url: `/events/${event.slug}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.title).toBe('Detail Concert');
    expect(body.categories).toHaveLength(1);
    expect(body.categories[0]?.name).toBe('CAT1');
  });

  it('GET /events/:id returns 404 Problem Details when event not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/events/non-existent-event',
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = JSON.parse(res.body);
    expect(body.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('POST /organizer/events blocks unauthenticated access with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/organizer/events',
      payload: {
        slug: 'test-event',
        title: 'Test Event',
        venue: 'GBK',
        saleStartsAt: new Date().toISOString(),
        saleEndsAt: new Date(Date.now() + 3600000).toISOString(),
        categories: [{ name: 'VIP', price: 1000000, totalSeats: 100 }],
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /organizer/events blocks non-organizer role with 403', async () => {
    const userToken = tokenService.generateAccessToken({
      sub: '0192634e-0000-7000-8000-000000000001',
      email: 'user@example.com',
      role: 'user',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/organizer/events',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
      payload: {
        slug: 'test-event',
        title: 'Test Event',
        venue: 'GBK',
        saleStartsAt: new Date().toISOString(),
        saleEndsAt: new Date(Date.now() + 3600000).toISOString(),
        categories: [{ name: 'VIP', price: 1000000, totalSeats: 100 }],
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('FORBIDDEN_OBJECT_ACCESS');
  });

  it('POST /organizer/events allows organizer and creates event with categories', async () => {
    const organizerToken = tokenService.generateAccessToken({
      sub: '0192634e-0000-7000-8000-000000000002',
      email: 'organizer@example.com',
      role: 'organizer',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/organizer/events',
      headers: {
        authorization: `Bearer ${organizerToken}`,
      },
      payload: {
        slug: 'jakarta-sound-2026',
        title: 'Jakarta Sound 2026',
        description: 'Music Fest',
        venue: 'Stadion Madya GBK',
        saleStartsAt: new Date().toISOString(),
        saleEndsAt: new Date(Date.now() + 3600000).toISOString(),
        categories: [
          { name: 'VIP', price: 1500000, totalSeats: 100 },
          { name: 'CAT1', price: 800000, totalSeats: 400 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.slug).toBe('jakarta-sound-2026');
    expect(body.categories).toHaveLength(2);
  });
});
