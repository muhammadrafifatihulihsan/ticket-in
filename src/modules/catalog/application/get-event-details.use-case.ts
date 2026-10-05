import { NotFoundError } from '../../../platform/errors/problem-details.js';
import type { CatalogCachePort } from '../domain/catalog-cache.port.js';
import type { CatalogRepositoryPort } from '../domain/catalog.repository.port.js';
import type { EventDetail } from '../domain/event.entity.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class GetEventDetailsUseCase {
  constructor(
    private readonly catalogRepo: CatalogRepositoryPort,
    private readonly cache?: CatalogCachePort,
  ) {}

  async execute(idOrSlug: string): Promise<EventDetail> {
    if (this.cache) {
      try {
        const cached = await this.cache.getEventDetail(idOrSlug);
        if (cached !== null) {
          return cached;
        }
      } catch {
        // Cache read failure: fallback to repository
      }
    }

    let event: EventDetail | null = null;
    if (UUID_REGEX.test(idOrSlug)) {
      event = await this.catalogRepo.findEventById(idOrSlug);
      if (!event) {
        event = await this.catalogRepo.findEventBySlug(idOrSlug);
      }
    } else {
      event = await this.catalogRepo.findEventBySlug(idOrSlug);
    }

    if (!event) {
      throw new NotFoundError(`Event with identifier '${idOrSlug}' was not found`);
    }

    if (this.cache) {
      try {
        await this.cache.setEventDetail(idOrSlug, event, 60);
      } catch {
        // Non-blocking cache write failure
      }
    }

    return event;
  }
}
