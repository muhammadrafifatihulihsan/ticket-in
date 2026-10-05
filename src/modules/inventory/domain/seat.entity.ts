export type SeatStatus = 'AVAILABLE' | 'HELD' | 'RESERVED' | 'SOLD';

export type SeatHoldStatus = 'ACTIVE' | 'EXPIRED' | 'RELEASED' | 'CONVERTED_TO_ORDER';

export const MAX_SEATS_PER_USER_PER_EVENT = 4;
export const DEFAULT_HOLD_TTL_SECONDS = 600; // 10 minutes

export interface SeatLayoutItem {
  id: string;
  seatNumber: string;
  categoryId: string;
  categoryName: string;
  price: number;
  status: SeatStatus;
}

export interface SeatHoldDetail {
  id: string;
  seatId: string;
  seatNumber: string;
  userId: string;
  status: SeatHoldStatus;
  expiresAt: Date;
  createdAt: Date;
}
