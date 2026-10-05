import type { QueuePosition } from './queue.types.js';

export interface WaitingRoomPort {
  joinQueue(eventId: string, userId: string, heartbeatTtl: number): Promise<QueuePosition>;
  getQueueStatus(eventId: string, userId: string): Promise<QueuePosition>;
  sendHeartbeat(eventId: string, userId: string, heartbeatTtl: number): Promise<boolean>;
  admitBatch(eventId: string, batchSize: number): Promise<string[]>;
  saveAdmissionToken(
    eventId: string,
    userId: string,
    token: string,
    ttlSeconds: number,
  ): Promise<void>;
  getAdmissionToken(eventId: string, userId: string): Promise<string | null>;
}
