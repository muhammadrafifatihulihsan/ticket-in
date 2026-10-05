import { z } from 'zod';

export const getEventSeatsParamsSchema = z.object({
  id: z.string().min(1, 'Event ID is required'),
});

export const holdSpecificSeatsBodySchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  seatIds: z
    .array(z.string().min(1, 'seatId cannot be empty'))
    .min(1, 'At least one seat must be selected')
    .max(4, 'Cannot select more than 4 seats'),
  holdTtlSeconds: z.number().int().positive().optional(),
});

export const autoHoldSeatsBodySchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  categoryId: z.string().min(1, 'categoryId is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(4, 'Cannot select more than 4 seats'),
  holdTtlSeconds: z.number().int().positive().optional(),
});

export const releaseHoldParamsSchema = z.object({
  id: z.string().min(1, 'Hold ID is required'),
});

export const seatLayoutItemResponseSchema = z.object({
  id: z.string(),
  seatNumber: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  price: z.number(),
  status: z.enum(['AVAILABLE', 'HELD', 'SOLD']),
});

export const seatHoldDetailResponseSchema = z.object({
  id: z.string(),
  seatId: z.string(),
  seatNumber: z.string(),
  userId: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export const holdSeatsResponseSchema = z.object({
  holds: z.array(seatHoldDetailResponseSchema),
  expiresAt: z.string(),
});
