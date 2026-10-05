import type { EventDetail, EventSummary } from './event.entity.js';

export interface CatalogCachePort {
  getActiveEvents(): Promise<EventSummary[] | null>;
  setActiveEvents(events: EventSummary[], ttlSeconds: number): Promise<void>;
  getEventDetail(idOrSlug: string): Promise<EventDetail | null>;
  setEventDetail(idOrSlug: string, detail: EventDetail, ttlSeconds: number): Promise<void>;
  invalidateEvent(idOrSlug: string): Promise<void>;
  invalidateActiveEvents(): Promise<void>;
}
