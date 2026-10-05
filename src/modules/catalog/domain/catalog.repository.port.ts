import type { EventDetail, EventStatus, EventSummary } from './event.entity.js';

export interface NewEventInput {
  slug: string;
  title: string;
  description?: string | null;
  venue: string;
  saleStartsAt: Date;
  saleEndsAt: Date;
  status?: EventStatus;
}

export interface NewSeatCategoryInput {
  name: string;
  price: number;
  totalSeats: number;
}

export interface CatalogRepositoryPort {
  findAllActiveEvents(): Promise<EventSummary[]>;
  findEventById(id: string): Promise<EventDetail | null>;
  findEventBySlug(slug: string): Promise<EventDetail | null>;
  createEvent(event: NewEventInput, categories: NewSeatCategoryInput[]): Promise<EventDetail>;
}
