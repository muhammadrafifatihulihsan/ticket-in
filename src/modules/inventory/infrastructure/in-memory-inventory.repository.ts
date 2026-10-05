import { randomUUID } from 'node:crypto';
import { ConflictError } from '../../../platform/errors/problem-details.js';
import type {
  HoldSeatsParams,
  HoldSeatsResult,
  InventoryRepositoryPort,
} from '../domain/inventory.repository.port.js';
import type { SeatHoldDetail, SeatLayoutItem, SeatStatus } from '../domain/seat.entity.js';

export interface StoredSeat {
  id: string;
  eventId: string;
  categoryId: string;
  categoryName: string;
  seatNumber: string;
  price: number;
  status: SeatStatus;
  heldBy: string | null;
  expiresAt: Date | null;
  version: number;
}

export class InMemoryInventoryRepository implements InventoryRepositoryPort {
  private seats: StoredSeat[] = [];
  private holds: SeatHoldDetail[] = [];

  addSeat(seat: StoredSeat): void {
    this.seats.push({ ...seat });
  }

  async findSeatsByEventId(eventId: string): Promise<SeatLayoutItem[]> {
    return this.seats
      .filter((s) => s.eventId === eventId)
      .map((s) => ({
        id: s.id,
        seatNumber: s.seatNumber,
        categoryId: s.categoryId,
        categoryName: s.categoryName,
        price: s.price,
        status: s.status,
      }));
  }

  async countUserActiveSeats(eventId: string, userId: string): Promise<number> {
    const userActiveHolds = this.holds.filter(
      (h) => h.userId === userId && h.status === 'ACTIVE' && h.expiresAt > new Date(),
    );

    const seatIds = new Set(userActiveHolds.map((h) => h.seatId));
    return this.seats.filter((s) => s.eventId === eventId && seatIds.has(s.id)).length;
  }

  async holdSpecificSeats(params: HoldSeatsParams): Promise<HoldSeatsResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + params.holdTtlSeconds * 1000);

    // Atomic simulation: check all requested seats first
    for (const seatId of params.seatIds) {
      const seat = this.seats.find((s) => s.id === seatId && s.eventId === params.eventId);
      if (!seat) {
        throw new ConflictError(`Seat with ID '${seatId}' was not found in this event.`);
      }

      // Check if seat is currently held with valid expiry or sold
      if (seat.status === 'SOLD') {
        throw new ConflictError(`Seat '${seat.seatNumber}' has already been sold.`);
      }

      if (seat.status === 'HELD') {
        const activeHold = this.holds.find(
          (h) => h.seatId === seatId && h.status === 'ACTIVE' && h.expiresAt > now,
        );
        if (activeHold) {
          throw new ConflictError(`Seat '${seat.seatNumber}' is currently held by another user.`);
        }
      }

      // Partial unique index invariant check: single active hold per seat
      const existingActiveHold = this.holds.find(
        (h) => h.seatId === seatId && h.status === 'ACTIVE' && h.expiresAt > now,
      );
      if (existingActiveHold) {
        throw new ConflictError(`Seat '${seat.seatNumber}' is already locked.`);
      }
    }

    // All available: perform atomic update
    const createdHolds: SeatHoldDetail[] = [];
    for (const seatId of params.seatIds) {
      const seat = this.seats.find((s) => s.id === seatId)!;
      seat.status = 'HELD';
      seat.heldBy = params.userId;
      seat.expiresAt = expiresAt;
      seat.version += 1;

      const hold: SeatHoldDetail = {
        id: randomUUID(),
        seatId: seat.id,
        seatNumber: seat.seatNumber,
        userId: params.userId,
        status: 'ACTIVE',
        expiresAt,
        createdAt: now,
      };

      this.holds.push(hold);
      createdHolds.push(hold);
    }

    return {
      holds: createdHolds,
      expiresAt,
    };
  }

  async releaseSeatHold(holdId: string, userId: string): Promise<boolean> {
    const hold = this.holds.find((h) => h.id === holdId && h.userId === userId && h.status === 'ACTIVE');
    if (!hold) return false;

    hold.status = 'RELEASED';
    const seat = this.seats.find((s) => s.id === hold.seatId);
    if (seat && seat.heldBy === userId) {
      seat.status = 'AVAILABLE';
      seat.heldBy = null;
      seat.expiresAt = null;
      seat.version += 1;
    }

    return true;
  }

  async releaseExpiredHolds(now: Date = new Date()): Promise<number> {
    let releasedCount = 0;

    for (const hold of this.holds) {
      if (hold.status === 'ACTIVE' && hold.expiresAt <= now) {
        hold.status = 'EXPIRED';
        const seat = this.seats.find((s) => s.id === hold.seatId);
        if (seat && seat.status === 'HELD') {
          seat.status = 'AVAILABLE';
          seat.heldBy = null;
          seat.expiresAt = null;
          seat.version += 1;
        }
        releasedCount++;
      }
    }

    return releasedCount;
  }

  async findHoldById(holdId: string): Promise<SeatHoldDetail | null> {
    const hold = this.holds.find((h) => h.id === holdId);
    return hold ? { ...hold } : null;
  }

  clear(): void {
    this.seats = [];
    this.holds = [];
  }
}
