import type { CatalogCachePort } from '../domain/catalog-cache.port.js';
import type { CatalogRepositoryPort } from '../domain/catalog.repository.port.js';
import type { EventSummary } from '../domain/event.entity.js';

export class GetEventsUseCase {
  constructor(
    private readonly catalogRepo: CatalogRepositoryPort,
    private readonly cache?: CatalogCachePort,
  ) {}

  async execute(): Promise<EventSummary[]> {
    if (this.cache) {
      try {
        const cached = await this.cache.getActiveEvents();
        if (cached !== null) {
          return cached;
        }
      } catch {
        // Cache read failure: gracefully fallback to repository
      }
    }

    const events = await this.catalogRepo.findAllActiveEvents();

    if (this.cache) {
      try {
        await this.cache.setActiveEvents(events, 60);
      } catch {
        // Cache write failure: non-blocking, return fresh data
      }
    }

    return events;
  }
}
