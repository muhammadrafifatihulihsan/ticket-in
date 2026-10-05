import type { CatalogCachePort } from '../domain/catalog-cache.port.js';
import type { EventDetail, EventSummary } from '../domain/event.entity.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class InMemoryCatalogCache implements CatalogCachePort {
  private activeEventsCache: CacheEntry<EventSummary[]> | null = null;
  private eventDetailCache = new Map<string, CacheEntry<EventDetail>>();

  async getActiveEvents(): Promise<EventSummary[] | null> {
    if (!this.activeEventsCache) return null;
    if (Date.now() > this.activeEventsCache.expiresAt) {
      this.activeEventsCache = null;
      return null;
    }
    return this.activeEventsCache.value;
  }

  async setActiveEvents(events: EventSummary[], ttlSeconds: number): Promise<void> {
    this.activeEventsCache = {
      value: events,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
  }

  async getEventDetail(idOrSlug: string): Promise<EventDetail | null> {
    const entry = this.eventDetailCache.get(idOrSlug);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.eventDetailCache.delete(idOrSlug);
      return null;
    }
    return entry.value;
  }

  async setEventDetail(idOrSlug: string, detail: EventDetail, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.eventDetailCache.set(idOrSlug, { value: detail, expiresAt });
  }

  async invalidateEvent(idOrSlug: string): Promise<void> {
    this.eventDetailCache.delete(idOrSlug);
  }

  async invalidateActiveEvents(): Promise<void> {
    this.activeEventsCache = null;
  }

  clear(): void {
    this.activeEventsCache = null;
    this.eventDetailCache.clear();
  }
}
