import { z } from 'zod';

export const getTicketParamsSchema = z.object({
  id: z.string().min(1, 'Ticket ID is required'),
});

export type GetTicketParams = z.infer<typeof getTicketParamsSchema>;

export const verifyTicketParamsSchema = z.object({
  id: z.string().min(1, 'Ticket ID or code is required'),
});

export type VerifyTicketParams = z.infer<typeof verifyTicketParamsSchema>;

export const ticketResponseSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  seatId: z.string(),
  userId: z.string(),
  ticketCode: z.string(),
  status: z.enum(['ISSUED', 'CHECKED_IN', 'CANCELLED', 'REFUNDED']),
  issuedAt: z.string(),
  seatNumber: z.string(),
  seatCategoryName: z.string(),
  price: z.number(),
  eventId: z.string(),
  eventName: z.string(),
  eventDate: z.string(),
  venue: z.string(),
});

export type TicketResponse = z.infer<typeof ticketResponseSchema>;
