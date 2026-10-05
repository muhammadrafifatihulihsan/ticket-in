import { randomUUID } from 'node:crypto';
import type {
  CatalogRepositoryPort,
  NewEventInput,
  NewSeatCategoryInput,
} from '../domain/catalog.repository.port.js';
import type { EventDetail, EventSummary } from '../domain/event.entity.js';

interface StoredEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  venue: string;
  saleStartsAt: Date;
  saleEndsAt: Date;
  status: 'DRAFT' | 'PUBLISHED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
  createdAt: Date;
  updatedAt: Date;
}

interface StoredCategory {
  id: string;
  eventId: string;
  name: string;
  price: number;
  totalSeats: number;
}

export class InMemoryCatalogRepository implements CatalogRepositoryPort {
  private events: StoredEvent[] = [];
  private categories: StoredCategory[] = [];

  async findAllActiveEvents(): Promise<EventSummary[]> {
    return this.events
      .filter((e) => e.status === 'ACTIVE' || e.status === 'PUBLISHED')
      .map((e) => ({
        id: e.id,
        slug: e.slug,
        title: e.title,
        venue: e.venue,
        saleStartsAt: e.saleStartsAt.toISOString(),
        saleEndsAt: e.saleEndsAt.toISOString(),
        status: e.status,
      }));
  }

  async findEventById(id: string): Promise<EventDetail | null> {
    const event = this.events.find((e) => e.id === id);
    if (!event) return null;
    return this.mapToDetail(event);
  }

  async findEventBySlug(slug: string): Promise<EventDetail | null> {
    const event = this.events.find((e) => e.slug === slug);
    if (!event) return null;
    return this.mapToDetail(event);
  }

  async createEvent(
    event: NewEventInput,
    categories: NewSeatCategoryInput[],
  ): Promise<EventDetail> {
    const eventId = randomUUID();
    const now = new Date();

    const storedEvent: StoredEvent = {
      id: eventId,
      slug: event.slug,
      title: event.title,
      description: event.description ?? null,
      venue: event.venue,
      saleStartsAt: event.saleStartsAt,
      saleEndsAt: event.saleEndsAt,
      status: event.status ?? 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    this.events.push(storedEvent);

    for (const cat of categories) {
      this.categories.push({
        id: randomUUID(),
        eventId,
        name: cat.name,
        price: cat.price,
        totalSeats: cat.totalSeats,
      });
    }

    return this.mapToDetail(storedEvent);
  }

  private mapToDetail(event: StoredEvent): EventDetail {
    const eventCategories = this.categories
      .filter((c) => c.eventId === event.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        price: c.price,
        totalSeats: c.totalSeats,
      }));

    return {
      id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description,
      venue: event.venue,
      saleStartsAt: event.saleStartsAt.toISOString(),
      saleEndsAt: event.saleEndsAt.toISOString(),
      status: event.status,
      categories: eventCategories,
      createdAt: event.createdAt.toISOString(),
    };
  }

  clear(): void {
    this.events = [];
    this.categories = [];
  }
}
