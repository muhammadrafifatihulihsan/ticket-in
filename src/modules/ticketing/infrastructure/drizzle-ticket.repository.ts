import { desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '../../../platform/db/schema.js';
import { ConflictError, NotFoundError } from '../../../platform/errors/problem-details.js';
import {
  assertValidTicketTransition,
  generateTicketCode,
  type Ticket,
  type TicketStatus,
  type TicketWithDetails,
} from '../domain/ticket.entity.js';
import type {
  IssueTicketsParams,
  TicketRepositoryPort,
} from '../domain/ticket.repository.port.js';

export class DrizzleTicketRepository implements TicketRepositoryPort {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async issueTicketsForOrder(params: IssueTicketsParams): Promise<Ticket[]> {
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      // 1. Idempotency check: see if tickets for this order were already issued
      const existingRows = await tx
        .select()
        .from(schema.tickets)
        .where(eq(schema.tickets.orderId, params.orderId));

      if (existingRows.length > 0) {
        return existingRows.map((r) => ({
          id: r.id,
          orderId: r.orderId,
          seatId: r.seatId,
          userId: r.userId,
          ticketCode: r.ticketCode,
          status: r.status as TicketStatus,
          issuedAt: r.issuedAt,
        }));
      }

      // 2. Issue tickets for each seat item
      const newTickets: Ticket[] = [];

      for (const item of params.items) {
        const ticketId = uuidv7();
        const ticketCode = generateTicketCode(now);

        const [inserted] = await tx
          .insert(schema.tickets)
          .values({
            id: ticketId,
            orderId: params.orderId,
            seatId: item.seatId,
            userId: params.userId,
            ticketCode,
            status: 'ISSUED',
            issuedAt: now,
          })
          .returning();

        if (inserted) {
          newTickets.push({
            id: inserted.id,
            orderId: inserted.orderId,
            seatId: inserted.seatId,
            userId: inserted.userId,
            ticketCode: inserted.ticketCode,
            status: inserted.status as TicketStatus,
            issuedAt: inserted.issuedAt,
          });
        }
      }

      return newTickets;
    });
  }

  async findById(ticketId: string): Promise<TicketWithDetails | null> {
    const rows = await this.db
      .select({
        id: schema.tickets.id,
        orderId: schema.tickets.orderId,
        seatId: schema.tickets.seatId,
        userId: schema.tickets.userId,
        ticketCode: schema.tickets.ticketCode,
        status: schema.tickets.status,
        issuedAt: schema.tickets.issuedAt,
        seatNumber: schema.seats.seatNumber,
        seatCategoryName: schema.seatCategories.name,
        price: schema.seatCategories.price,
        eventId: schema.events.id,
        eventName: schema.events.title,
        eventDate: schema.events.saleStartsAt,
        venue: schema.events.venue,
      })
      .from(schema.tickets)
      .innerJoin(schema.seats, eq(schema.tickets.seatId, schema.seats.id))
      .innerJoin(schema.seatCategories, eq(schema.seats.categoryId, schema.seatCategories.id))
      .innerJoin(schema.events, eq(schema.seats.eventId, schema.events.id))
      .where(eq(schema.tickets.id, ticketId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      orderId: row.orderId,
      seatId: row.seatId,
      userId: row.userId,
      ticketCode: row.ticketCode,
      status: row.status as TicketStatus,
      issuedAt: row.issuedAt,
      seatNumber: row.seatNumber,
      seatCategoryName: row.seatCategoryName,
      price: Number(row.price),
      eventId: row.eventId,
      eventName: row.eventName,
      eventDate: row.eventDate,
      venue: row.venue,
    };
  }

  async findByTicketCode(ticketCode: string): Promise<TicketWithDetails | null> {
    const rows = await this.db
      .select({
        id: schema.tickets.id,
        orderId: schema.tickets.orderId,
        seatId: schema.tickets.seatId,
        userId: schema.tickets.userId,
        ticketCode: schema.tickets.ticketCode,
        status: schema.tickets.status,
        issuedAt: schema.tickets.issuedAt,
        seatNumber: schema.seats.seatNumber,
        seatCategoryName: schema.seatCategories.name,
        price: schema.seatCategories.price,
        eventId: schema.events.id,
        eventName: schema.events.title,
        eventDate: schema.events.saleStartsAt,
        venue: schema.events.venue,
      })
      .from(schema.tickets)
      .innerJoin(schema.seats, eq(schema.tickets.seatId, schema.seats.id))
      .innerJoin(schema.seatCategories, eq(schema.seats.categoryId, schema.seatCategories.id))
      .innerJoin(schema.events, eq(schema.seats.eventId, schema.events.id))
      .where(eq(schema.tickets.ticketCode, ticketCode))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      orderId: row.orderId,
      seatId: row.seatId,
      userId: row.userId,
      ticketCode: row.ticketCode,
      status: row.status as TicketStatus,
      issuedAt: row.issuedAt,
      seatNumber: row.seatNumber,
      seatCategoryName: row.seatCategoryName,
      price: Number(row.price),
      eventId: row.eventId,
      eventName: row.eventName,
      eventDate: row.eventDate,
      venue: row.venue,
    };
  }

  async findByUserId(userId: string): Promise<TicketWithDetails[]> {
    const rows = await this.db
      .select({
        id: schema.tickets.id,
        orderId: schema.tickets.orderId,
        seatId: schema.tickets.seatId,
        userId: schema.tickets.userId,
        ticketCode: schema.tickets.ticketCode,
        status: schema.tickets.status,
        issuedAt: schema.tickets.issuedAt,
        seatNumber: schema.seats.seatNumber,
        seatCategoryName: schema.seatCategories.name,
        price: schema.seatCategories.price,
        eventId: schema.events.id,
        eventName: schema.events.title,
        eventDate: schema.events.saleStartsAt,
        venue: schema.events.venue,
      })
      .from(schema.tickets)
      .innerJoin(schema.seats, eq(schema.tickets.seatId, schema.seats.id))
      .innerJoin(schema.seatCategories, eq(schema.seats.categoryId, schema.seatCategories.id))
      .innerJoin(schema.events, eq(schema.seats.eventId, schema.events.id))
      .where(eq(schema.tickets.userId, userId))
      .orderBy(desc(schema.tickets.issuedAt));

    return rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      seatId: row.seatId,
      userId: row.userId,
      ticketCode: row.ticketCode,
      status: row.status as TicketStatus,
      issuedAt: row.issuedAt,
      seatNumber: row.seatNumber,
      seatCategoryName: row.seatCategoryName,
      price: Number(row.price),
      eventId: row.eventId,
      eventName: row.eventName,
      eventDate: row.eventDate,
      venue: row.venue,
    }));
  }

  async findByOrderId(orderId: string): Promise<Ticket[]> {
    const rows = await this.db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.orderId, orderId));

    return rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      seatId: r.seatId,
      userId: r.userId,
      ticketCode: r.ticketCode,
      status: r.status as TicketStatus,
      issuedAt: r.issuedAt,
    }));
  }

  async updateStatus(ticketId: string, status: TicketStatus): Promise<TicketWithDetails> {
    const existing = await this.findById(ticketId);
    if (!existing) {
      throw new NotFoundError('Ticket not found.');
    }

    if (existing.status === 'CHECKED_IN' && status === 'CHECKED_IN') {
      throw new ConflictError('Ticket has already been checked in.');
    }

    assertValidTicketTransition(existing.status, status);

    await this.db
      .update(schema.tickets)
      .set({ status })
      .where(eq(schema.tickets.id, ticketId));

    const updated = await this.findById(ticketId);
    if (!updated) {
      throw new NotFoundError('Ticket not found after status update.');
    }

    return updated;
  }
}
