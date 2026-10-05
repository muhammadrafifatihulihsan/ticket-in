import { ConflictError, ValidationError } from '../../../platform/errors/problem-details.js';
import type { CatalogCachePort } from '../domain/catalog-cache.port.js';
import type {
  CatalogRepositoryPort,
  NewEventInput,
  NewSeatCategoryInput,
} from '../domain/catalog.repository.port.js';
import { type EventDetail, validateEventSchedule } from '../domain/event.entity.js';
import { validateSeatCategoryInput } from '../domain/seat-category.entity.js';

export interface CreateEventCommand {
  slug: string;
  title: string;
  description?: string | null;
  venue: string;
  saleStartsAt: Date;
  saleEndsAt: Date;
  categories: NewSeatCategoryInput[];
}

export class CreateEventUseCase {
  constructor(
    private readonly catalogRepo: CatalogRepositoryPort,
    private readonly cache?: CatalogCachePort,
  ) {}

  async execute(command: CreateEventCommand): Promise<EventDetail> {
    if (!validateEventSchedule(command.saleStartsAt, command.saleEndsAt)) {
      throw new ValidationError('saleEndsAt must be after saleStartsAt', [
        { name: 'saleEndsAt', reason: 'Must be strictly after saleStartsAt' },
      ]);
    }

    if (!command.categories || command.categories.length === 0) {
      throw new ValidationError('At least one seat category must be provided', [
        { name: 'categories', reason: 'Categories list cannot be empty' },
      ]);
    }

    for (const [index, cat] of command.categories.entries()) {
      const validation = validateSeatCategoryInput(cat);
      if (!validation.valid) {
        throw new ValidationError(validation.reason ?? 'Invalid category', [
          { name: `categories[${index}]`, reason: validation.reason ?? 'Invalid category configuration' },
        ]);
      }
    }

    const existing = await this.catalogRepo.findEventBySlug(command.slug);
    if (existing) {
      throw new ConflictError(`An event with slug '${command.slug}' already exists`);
    }

    const eventInput: NewEventInput = {
      slug: command.slug,
      title: command.title,
      description: command.description,
      venue: command.venue,
      saleStartsAt: command.saleStartsAt,
      saleEndsAt: command.saleEndsAt,
      status: 'ACTIVE',
    };

    const created = await this.catalogRepo.createEvent(eventInput, command.categories);

    if (this.cache) {
      try {
        await this.cache.invalidateActiveEvents();
      } catch {
        // Cache invalidation failure is non-blocking
      }
    }

    return created;
  }
}
