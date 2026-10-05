import { z } from 'zod';

export const joinQueueBodySchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
});

export const queueStatusQuerySchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
});

export const heartbeatBodySchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
});

export const admitQueueBodySchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  batchSize: z.number().int().positive().optional(),
});

export const queuePositionResponseSchema = z.object({
  status: z.enum(['QUEUED', 'ADMITTED', 'EXPIRED', 'NOT_IN_QUEUE']),
  rank: z.number().int().positive().optional(),
  totalInQueue: z.number().int().nonnegative().optional(),
  estimatedWaitSeconds: z.number().int().nonnegative().optional(),
  admissionToken: z.string().optional(),
  expiresIn: z.number().int().nonnegative().optional(),
});

export const admitQueueResponseSchema = z.object({
  admittedCount: z.number().int().nonnegative(),
  userIds: z.array(z.string()),
});
