import type { Redis } from 'ioredis';
import type { CatalogCachePort } from '../domain/catalog-cache.port.js';
import type { EventDetail, EventSummary } from '../domain/event.entity.js';

export class RedisCatalogCache implements CatalogCachePort {
  private static readonly ACTIVE_EVENTS_KEY = 'catalog:events:active';
  private static readonly EVENT_DETAIL_PREFIX = 'catalog:event:';

  constructor(private readonly redis: Redis) {}

  async getActiveEvents(): Promise<EventSummary[] | null> {
    try {
      const data = await this.redis.get(RedisCatalogCache.ACTIVE_EVENTS_KEY);
      if (!data) return null;
      return JSON.parse(data) as EventSummary[];
    } catch {
      return null;
    }
  }

  async setActiveEvents(events: EventSummary[], ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(
        RedisCatalogCache.ACTIVE_EVENTS_KEY,
        JSON.stringify(events),
        'EX',
        ttlSeconds,
      );
    } catch {
      // Non-blocking cache failure
    }
  }

  async getEventDetail(idOrSlug: string): Promise<EventDetail | null> {
    try {
      const key = `${RedisCatalogCache.EVENT_DETAIL_PREFIX}${idOrSlug}`;
      const data = await this.redis.get(key);
      if (!data) return null;
      return JSON.parse(data) as EventDetail;
    } catch {
      return null;
    }
  }

  async setEventDetail(idOrSlug: string, detail: EventDetail, ttlSeconds: number): Promise<void> {
    try {
      const key = `${RedisCatalogCache.EVENT_DETAIL_PREFIX}${idOrSlug}`;
      await this.redis.set(key, JSON.stringify(detail), 'EX', ttlSeconds);
    } catch {
      // Non-blocking cache failure
    }
  }

  async invalidateEvent(idOrSlug: string): Promise<void> {
    try {
      const key = `${RedisCatalogCache.EVENT_DETAIL_PREFIX}${idOrSlug}`;
      await this.redis.del(key);
    } catch {
      // Non-blocking cache failure
    }
  }

  async invalidateActiveEvents(): Promise<void> {
    try {
      await this.redis.del(RedisCatalogCache.ACTIVE_EVENTS_KEY);
    } catch {
      // Non-blocking cache failure
    }
  }
}
