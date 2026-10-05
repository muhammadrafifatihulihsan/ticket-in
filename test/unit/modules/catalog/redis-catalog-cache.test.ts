import type { Redis } from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventDetail, EventSummary } from '../../../../src/modules/catalog/domain/event.entity.js';
import { RedisCatalogCache } from '../../../../src/modules/catalog/infrastructure/redis-catalog-cache.js';

describe('RedisCatalogCache', () => {
  let mockRedis: Partial<Redis>;
  let cache: RedisCatalogCache;

  beforeEach(() => {
    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };
    cache = new RedisCatalogCache(mockRedis as Redis);
  });

  it('serializes and retrieves active events from redis', async () => {
    const events: EventSummary[] = [
      {
        id: 'ev-1',
        slug: 'concert-a',
        title: 'Concert A',
        venue: 'GBK',
        saleStartsAt: new Date().toISOString(),
        saleEndsAt: new Date().toISOString(),
        status: 'ACTIVE',
      },
    ];

    vi.mocked(mockRedis.get!).mockResolvedValue(JSON.stringify(events));

    const result = await cache.getActiveEvents();
    expect(result).toEqual(events);
    expect(mockRedis.get).toHaveBeenCalledWith('catalog:events:active');
  });

  it('sets active events in redis with TTL', async () => {
    const events: EventSummary[] = [];
    vi.mocked(mockRedis.set!).mockResolvedValue('OK');

    await cache.setActiveEvents(events, 60);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'catalog:events:active',
      JSON.stringify(events),
      'EX',
      60,
    );
  });

  it('returns null and does not throw when redis.get fails', async () => {
    vi.mocked(mockRedis.get!).mockRejectedValue(new Error('Connection timed out'));

    const result = await cache.getActiveEvents();
    expect(result).toBeNull();
  });

  it('does not throw when redis.set fails', async () => {
    vi.mocked(mockRedis.set!).mockRejectedValue(new Error('Connection timed out'));

    await expect(cache.setActiveEvents([], 60)).resolves.not.toThrow();
  });

  it('sets and invalidates event detail in redis', async () => {
    const detail: EventDetail = {
      id: 'ev-1',
      slug: 'concert-a',
      title: 'Concert A',
      description: 'Desc',
      venue: 'GBK',
      saleStartsAt: new Date().toISOString(),
      saleEndsAt: new Date().toISOString(),
      status: 'ACTIVE',
      categories: [{ id: 'cat-1', name: 'VIP', price: 1500000, totalSeats: 100 }],
      createdAt: new Date().toISOString(),
    };

    vi.mocked(mockRedis.set!).mockResolvedValue('OK');
    vi.mocked(mockRedis.del!).mockResolvedValue(1);

    await cache.setEventDetail('ev-1', detail, 60);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'catalog:event:ev-1',
      JSON.stringify(detail),
      'EX',
      60,
    );

    await cache.invalidateEvent('ev-1');
    expect(mockRedis.del).toHaveBeenCalledWith('catalog:event:ev-1');
  });
});
