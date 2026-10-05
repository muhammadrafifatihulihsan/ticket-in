import type { SeatHoldDetail, SeatLayoutItem } from './seat.entity.js';

export interface HoldSeatsParams {
  eventId: string;
  userId: string;
  seatIds: string[];
  holdTtlSeconds: number;
}

export interface HoldSeatsResult {
  holds: SeatHoldDetail[];
  expiresAt: Date;
}

export interface InventoryRepositoryPort {
  findSeatsByEventId(eventId: string): Promise<SeatLayoutItem[]>;
  countUserActiveSeats(eventId: string, userId: string): Promise<number>;
  holdSpecificSeats(params: HoldSeatsParams): Promise<HoldSeatsResult>;
  releaseSeatHold(holdId: string, userId: string): Promise<boolean>;
  releaseExpiredHolds(now: Date): Promise<number>;
  findHoldById(holdId: string): Promise<SeatHoldDetail | null>;
}
