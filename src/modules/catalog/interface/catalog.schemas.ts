import { z } from 'zod';

export const createSeatCategoryInputSchema = z.object({
  name: z.string().min(1, 'Category name is required').max(50),
  price: z.number().int().positive('Price must be a positive integer in IDR'),
  totalSeats: z.number().int().positive('Total seats must be a positive integer'),
});

export const createEventSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase alphanumeric characters and hyphens'),
  title: z.string().min(3).max(255),
  description: z.string().nullable().optional(),
  venue: z.string().min(3).max(255),
  saleStartsAt: z.coerce.date(),
  saleEndsAt: z.coerce.date(),
  categories: z.array(createSeatCategoryInputSchema).min(1, 'At least one category is required'),
});

export const getEventParamsSchema = z.object({
  id: z.string().min(1, 'Event ID or slug is required'),
});

export const seatCategoryResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  totalSeats: z.number(),
});

export const eventSummaryResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  venue: z.string(),
  saleStartsAt: z.string(),
  saleEndsAt: z.string(),
  status: z.string(),
});

export const eventDetailResponseSchema = eventSummaryResponseSchema.extend({
  description: z.string().nullable(),
  categories: z.array(seatCategoryResponseSchema),
  createdAt: z.string(),
});
