import { z } from 'zod';

export const createOrderBodySchema = z
  .object({
    holdId: z.string().uuid().optional(),
    holdIds: z.array(z.string().uuid()).min(1).max(4).optional(),
  })
  .refine(
    (data) => Boolean(data.holdId) || Boolean(data.holdIds && data.holdIds.length > 0),
    {
      message: 'Either holdId or holdIds must be provided.',
      path: ['holdId'],
    },
  );

export type CreateOrderBody = z.infer<typeof createOrderBodySchema>;

export const getOrderParamsSchema = z.object({
  id: z.string().uuid(),
});

export type GetOrderParams = z.infer<typeof getOrderParamsSchema>;

export const orderItemResponseSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  seatId: z.string(),
  price: z.number().int(),
  seatNumber: z.string().optional(),
  seatCategoryName: z.string().optional(),
  createdAt: z.string().datetime(),
});

export const orderResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  eventId: z.string(),
  status: z.enum(['PENDING', 'PAID', 'CANCELLED', 'REFUNDED']),
  totalAmount: z.number().int(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  items: z.array(orderItemResponseSchema),
});

export type OrderResponse = z.infer<typeof orderResponseSchema>;
