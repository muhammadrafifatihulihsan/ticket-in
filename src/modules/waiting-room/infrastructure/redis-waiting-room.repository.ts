import type { Redis } from 'ioredis';
import type { QueuePosition } from '../domain/queue.types.js';
import type { WaitingRoomPort } from '../domain/waiting-room.port.js';
import {
  ADMIT_BATCH_SCRIPT,
  CHECK_STATUS_SCRIPT,
  HEARTBEAT_SCRIPT,
  JOIN_QUEUE_SCRIPT,
} from './lua-scripts.js';

export class RedisWaitingRoomRepository implements WaitingRoomPort {
  constructor(private readonly redis: Redis) {}

  private queueKey(eventId: string): string {
    return `queue:event:${eventId}`;
  }

  private heartbeatKey(eventId: string, userId: string): string {
    return `queue:heartbeat:event:${eventId}:${userId}`;
  }

  private admittedKey(eventId: string, userId: string): string {
    return `queue:admitted:event:${eventId}:${userId}`;
  }

  async joinQueue(eventId: string, userId: string, heartbeatTtl: number): Promise<QueuePosition> {
    const rawResult = (await this.redis.eval(
      JOIN_QUEUE_SCRIPT,
      3,
      this.queueKey(eventId),
      this.heartbeatKey(eventId, userId),
      this.admittedKey(eventId, userId),
      userId,
      Date.now(),
      heartbeatTtl,
    )) as string;

    return JSON.parse(rawResult) as QueuePosition;
  }

  async getQueueStatus(eventId: string, userId: string): Promise<QueuePosition> {
    const rawResult = (await this.redis.eval(
      CHECK_STATUS_SCRIPT,
      3,
      this.queueKey(eventId),
      this.heartbeatKey(eventId, userId),
      this.admittedKey(eventId, userId),
      userId,
    )) as string;

    return JSON.parse(rawResult) as QueuePosition;
  }

  async sendHeartbeat(eventId: string, userId: string, heartbeatTtl: number): Promise<boolean> {
    const result = (await this.redis.eval(
      HEARTBEAT_SCRIPT,
      3,
      this.queueKey(eventId),
      this.heartbeatKey(eventId, userId),
      this.admittedKey(eventId, userId),
      userId,
      heartbeatTtl,
    )) as number;

    return result === 1;
  }

  async admitBatch(eventId: string, batchSize: number): Promise<string[]> {
    const rawResult = (await this.redis.eval(
      ADMIT_BATCH_SCRIPT,
      1,
      this.queueKey(eventId),
      eventId,
      batchSize,
    )) as string;

    return JSON.parse(rawResult) as string[];
  }

  async saveAdmissionToken(
    eventId: string,
    userId: string,
    token: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(this.admittedKey(eventId, userId), token, 'EX', ttlSeconds);
  }

  async getAdmissionToken(eventId: string, userId: string): Promise<string | null> {
    return await this.redis.get(this.admittedKey(eventId, userId));
  }
}
