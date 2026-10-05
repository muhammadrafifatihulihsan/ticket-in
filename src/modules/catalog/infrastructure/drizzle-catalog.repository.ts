import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../platform/db/schema.js';
import { type IdGenerator, UuidV7Generator } from '../../../platform/id/id-generator.js';
import type {
  CatalogRepositoryPort,
  NewEventInput,
  NewSeatCategoryInput,
} from '../domain/catalog.repository.port.js';
import type { EventDetail, EventStatus, EventSummary } from '../domain/event.entity.js';

export class DrizzleCatalogRepository implements CatalogRepositoryPort {
  private readonly idGen: IdGenerator;

  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    idGen?: IdGenerator,
  ) {
    this.idGen = idGen ?? new UuidV7Generator();
  }

  async findAllActiveEvents(): Promise<EventSummary[]> {
    const rows = await this.db
      .select()
      .from(schema.events)
      .where(inArray(schema.events.status, ['ACTIVE', 'PUBLISHED']))
      .orderBy(schema.events.saleStartsAt);

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      venue: r.venue,
      saleStartsAt: r.saleStartsAt.toISOString(),
      saleEndsAt: r.saleEndsAt.toISOString(),
      status: r.status as EventStatus,
    }));
  }

  async findEventById(id: string): Promise<EventDetail | null> {
    const eventRows = await this.db.select().from(schema.events).where(eq(schema.events.id, id)).limit(1);
    const event = eventRows[0];
    if (!event) return null;

    return this.buildEventDetail(event);
  }

  async findEventBySlug(slug: string): Promise<EventDetail | null> {
    const eventRows = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.slug, slug))
      .limit(1);
    const event = eventRows[0];
    if (!event) return null;

    return this.buildEventDetail(event);
  }

  async createEvent(event: NewEventInput, categories: NewSeatCategoryInput[]): Promise<EventDetail> {
    const eventId = this.idGen.generate();
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      await tx.insert(schema.events).values({
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
      });

      const categoryInserts = categories.map((cat) => ({
        id: this.idGen.generate(),
        eventId,
        name: cat.name,
        price: cat.price,
        totalSeats: cat.totalSeats,
        createdAt: now,
      }));

      if (categoryInserts.length > 0) {
        await tx.insert(schema.seatCategories).values(categoryInserts);
      }

      return {
        id: eventId,
        slug: event.slug,
        title: event.title,
        description: event.description ?? null,
        venue: event.venue,
        saleStartsAt: event.saleStartsAt.toISOString(),
        saleEndsAt: event.saleEndsAt.toISOString(),
        status: (event.status ?? 'ACTIVE') as EventStatus,
        categories: categoryInserts.map((c) => ({
          id: c.id,
          name: c.name,
          price: c.price,
          totalSeats: c.totalSeats,
        })),
        createdAt: now.toISOString(),
      };
    });
  }

  private async buildEventDetail(event: typeof schema.events.$inferSelect): Promise<EventDetail> {
    const categoryRows = await this.db
      .select()
      .from(schema.seatCategories)
      .where(eq(schema.seatCategories.eventId, event.id));

    return {
      id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description,
      venue: event.venue,
      saleStartsAt: event.saleStartsAt.toISOString(),
      saleEndsAt: event.saleEndsAt.toISOString(),
      status: event.status as EventStatus,
      categories: categoryRows.map((c) => ({
        id: c.id,
        name: c.name,
        price: c.price,
        totalSeats: c.totalSeats,
      })),
      createdAt: event.createdAt.toISOString(),
    };
  }
}
