import { beforeEach, describe, expect, it } from 'vitest';
import { GetEventsUseCase } from '../../../../src/modules/catalog/application/get-events.use-case.js';
import { InMemoryCatalogCache } from '../../../../src/modules/catalog/infrastructure/in-memory-catalog-cache.js';
import { InMemoryCatalogRepository } from '../../../../src/modules/catalog/infrastructure/in-memory-catalog.repository.js';

describe('GetEventsUseCase', () => {
  let repo: InMemoryCatalogRepository;
  let cache: InMemoryCatalogCache;
  let useCase: GetEventsUseCase;

  beforeEach(() => {
    repo = new InMemoryCatalogRepository();
    cache = new InMemoryCatalogCache();
    useCase = new GetEventsUseCase(repo, cache);
  });

  it('fetches from repository on cache miss and populates cache', async () => {
    await repo.createEvent(
      {
        slug: 'concert-2026',
        title: 'Concert 2026',
        venue: 'GBK Jakarta',
        saleStartsAt: new Date(Date.now() - 1000),
        saleEndsAt: new Date(Date.now() + 86400000),
      },
      [{ name: 'VIP', price: 1500000, totalSeats: 100 }],
    );

    const events = await useCase.execute();
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe('Concert 2026');

    // Verify cache is populated
    const cached = await cache.getActiveEvents();
    expect(cached).not.toBeNull();
    expect(cached).toHaveLength(1);
  });

  it('returns cached events when cache hit occurs', async () => {
    await cache.setActiveEvents(
      [
        {
          id: 'fake-id',
          slug: 'cached-event',
          title: 'Cached Title',
          venue: 'Cached Venue',
          saleStartsAt: new Date().toISOString(),
          saleEndsAt: new Date().toISOString(),
          status: 'ACTIVE',
        },
      ],
      60,
    );

    const events = await useCase.execute();
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe('Cached Title');
  });

  it('gracefully degrades to repository if cache throws error', async () => {
    const brokenCache = {
      getActiveEvents: async () => {
        throw new Error('Redis connection refused');
      },
      setActiveEvents: async () => {
        throw new Error('Redis connection refused');
      },
      getEventDetail: async () => null,
      setEventDetail: async () => {},
      invalidateEvent: async () => {},
      invalidateActiveEvents: async () => {},
    };

    await repo.createEvent(
      {
        slug: 'fallback-event',
        title: 'Fallback Event',
        venue: 'Jakarta Arena',
        saleStartsAt: new Date(),
        saleEndsAt: new Date(Date.now() + 86400000),
      },
      [{ name: 'CAT1', price: 800000, totalSeats: 200 }],
    );

    const resilientUseCase = new GetEventsUseCase(repo, brokenCache);
    const events = await resilientUseCase.execute();
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe('Fallback Event');
  });
});
