import { and, count, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../platform/db/schema.js';
import { ConflictError } from '../../../platform/errors/problem-details.js';
import { type IdGenerator, UuidV7Generator } from '../../../platform/id/id-generator.js';
import type {
  HoldSeatsParams,
  HoldSeatsResult,
  InventoryRepositoryPort,
} from '../domain/inventory.repository.port.js';
import type {
  SeatHoldDetail,
  SeatHoldStatus,
  SeatLayoutItem,
  SeatStatus,
} from '../domain/seat.entity.js';

export class DrizzleInventoryRepository implements InventoryRepositoryPort {
  private readonly idGen: IdGenerator;

  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    idGen?: IdGenerator,
  ) {
    this.idGen = idGen ?? new UuidV7Generator();
  }

  async findSeatsByEventId(eventId: string): Promise<SeatLayoutItem[]> {
    const rows = await this.db
      .select({
        id: schema.seats.id,
        seatNumber: schema.seats.seatNumber,
        categoryId: schema.seats.categoryId,
        categoryName: schema.seatCategories.name,
        price: schema.seatCategories.price,
        status: schema.seats.status,
      })
      .from(schema.seats)
      .innerJoin(schema.seatCategories, eq(schema.seats.categoryId, schema.seatCategories.id))
      .where(eq(schema.seats.eventId, eventId))
      .orderBy(schema.seats.seatNumber);

    return rows.map((r) => ({
      id: r.id,
      seatNumber: r.seatNumber,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      price: r.price,
      status: r.status as SeatStatus,
    }));
  }

  async countUserActiveSeats(eventId: string, userId: string): Promise<number> {
    const now = new Date();
    const result = await this.db
      .select({ count: count() })
      .from(schema.seatHolds)
      .innerJoin(schema.seats, eq(schema.seatHolds.seatId, schema.seats.id))
      .where(
        and(
          eq(schema.seatHolds.userId, userId),
          eq(schema.seatHolds.status, 'ACTIVE'),
          gt(schema.seatHolds.expiresAt, now),
          eq(schema.seats.eventId, eventId),
        ),
      );

    return Number(result[0]?.count ?? 0);
  }

  async holdSpecificSeats(params: HoldSeatsParams): Promise<HoldSeatsResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + params.holdTtlSeconds * 1000);

    return await this.db.transaction(async (tx) => {
      // 1. Atomic conditional update: only update if seats are currently AVAILABLE
      const updatedSeats = await tx
        .update(schema.seats)
        .set({
          status: 'HELD',
          heldBy: params.userId,
          expiresAt,
          version: sql`${schema.seats.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            inArray(schema.seats.id, params.seatIds),
            eq(schema.seats.eventId, params.eventId),
            eq(schema.seats.status, 'AVAILABLE'),
          ),
        )
        .returning({ id: schema.seats.id, seatNumber: schema.seats.seatNumber });

      if (updatedSeats.length < params.seatIds.length) {
        throw new ConflictError('One or more selected seats are no longer available.');
      }

      // 2. Insert active holds (enforced by idx_seat_holds_single_active partial unique index)
      const holdInserts = updatedSeats.map((s) => ({
        id: this.idGen.generate(),
        seatId: s.id,
        userId: params.userId,
        status: 'ACTIVE',
        expiresAt,
        createdAt: now,
      }));

      await tx.insert(schema.seatHolds).values(holdInserts);

      const holdDetails: SeatHoldDetail[] = holdInserts.map((h, index) => ({
        id: h.id,
        seatId: h.seatId,
        seatNumber: updatedSeats[index]?.seatNumber ?? '',
        userId: h.userId,
        status: 'ACTIVE',
        expiresAt: h.expiresAt,
        createdAt: h.createdAt,
      }));

      return {
        holds: holdDetails,
        expiresAt,
      };
    });
  }

  async releaseSeatHold(holdId: string, userId: string): Promise<boolean> {
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.seatHolds)
        .where(
          and(
            eq(schema.seatHolds.id, holdId),
            eq(schema.seatHolds.userId, userId),
            eq(schema.seatHolds.status, 'ACTIVE'),
          ),
        )
        .limit(1);

      const hold = rows[0];
      if (!hold) return false;

      await tx
        .update(schema.seatHolds)
        .set({ status: 'RELEASED' })
        .where(eq(schema.seatHolds.id, holdId));

      await tx
        .update(schema.seats)
        .set({
          status: 'AVAILABLE',
          heldBy: null,
          expiresAt: null,
          version: sql`${schema.seats.version} + 1`,
          updatedAt: now,
        })
        .where(eq(schema.seats.id, hold.seatId));

      return true;
    });
  }

  async releaseExpiredHolds(now: Date = new Date()): Promise<number> {
    return await this.db.transaction(async (tx) => {
      const expiredHolds = await tx
        .select()
        .from(schema.seatHolds)
        .where(
          and(
            eq(schema.seatHolds.status, 'ACTIVE'),
            lte(schema.seatHolds.expiresAt, now),
          ),
        );

      if (expiredHolds.length === 0) return 0;

      const holdIds = expiredHolds.map((h) => h.id);
      const seatIds = expiredHolds.map((h) => h.seatId);

      await tx
        .update(schema.seatHolds)
        .set({ status: 'EXPIRED' })
        .where(inArray(schema.seatHolds.id, holdIds));

      await tx
        .update(schema.seats)
        .set({
          status: 'AVAILABLE',
          heldBy: null,
          expiresAt: null,
          version: sql`${schema.seats.version} + 1`,
          updatedAt: now,
        })
        .where(inArray(schema.seats.id, seatIds));

      return expiredHolds.length;
    });
  }

  async findHoldById(holdId: string): Promise<SeatHoldDetail | null> {
    const rows = await this.db
      .select({
        id: schema.seatHolds.id,
        seatId: schema.seatHolds.seatId,
        seatNumber: schema.seats.seatNumber,
        userId: schema.seatHolds.userId,
        status: schema.seatHolds.status,
        expiresAt: schema.seatHolds.expiresAt,
        createdAt: schema.seatHolds.createdAt,
      })
      .from(schema.seatHolds)
      .innerJoin(schema.seats, eq(schema.seatHolds.seatId, schema.seats.id))
      .where(eq(schema.seatHolds.id, holdId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      seatId: row.seatId,
      seatNumber: row.seatNumber,
      userId: row.userId,
      status: row.status as SeatHoldStatus,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}
