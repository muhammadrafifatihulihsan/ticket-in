import type { QueuePosition } from '../domain/queue.types.js';
import type { WaitingRoomPort } from '../domain/waiting-room.port.js';

interface AdmittedTokenEntry {
  token: string;
  expiresAt: number;
}

export class InMemoryWaitingRoomRepository implements WaitingRoomPort {
  private queues = new Map<string, Array<{ userId: string; joinedAt: number }>>();
  private heartbeats = new Map<string, number>(); // key: `${eventId}:${userId}`, value: expiresAt timestamp
  private admittedTokens = new Map<string, AdmittedTokenEntry>();

  private heartbeatKey(eventId: string, userId: string): string {
    return `${eventId}:${userId}`;
  }

  async joinQueue(eventId: string, userId: string, heartbeatTtl: number): Promise<QueuePosition> {
    const admitted = this.admittedTokens.get(this.heartbeatKey(eventId, userId));
    if (admitted && Date.now() < admitted.expiresAt) {
      return {
        status: 'ADMITTED',
        admissionToken: admitted.token,
      };
    }

    let queue = this.queues.get(eventId);
    if (!queue) {
      queue = [];
      this.queues.set(eventId, queue);
    }

    const existingIndex = queue.findIndex((entry) => entry.userId === userId);
    if (existingIndex === -1) {
      queue.push({ userId, joinedAt: Date.now() });
    }

    this.heartbeats.set(this.heartbeatKey(eventId, userId), Date.now() + heartbeatTtl * 1000);

    const rank = (queue.findIndex((entry) => entry.userId === userId) ?? 0) + 1;
    return {
      status: 'QUEUED',
      rank,
      totalInQueue: queue.length,
    };
  }

  async getQueueStatus(eventId: string, userId: string): Promise<QueuePosition> {
    const admitted = this.admittedTokens.get(this.heartbeatKey(eventId, userId));
    if (admitted && Date.now() < admitted.expiresAt) {
      const remainingSeconds = Math.max(0, Math.round((admitted.expiresAt - Date.now()) / 1000));
      return {
        status: 'ADMITTED',
        admissionToken: admitted.token,
        expiresIn: remainingSeconds,
      };
    }

    const queue = this.queues.get(eventId);
    if (!queue) {
      return { status: 'NOT_IN_QUEUE' };
    }

    const index = queue.findIndex((entry) => entry.userId === userId);
    if (index === -1) {
      return { status: 'NOT_IN_QUEUE' };
    }

    const heartbeatExpiry = this.heartbeats.get(this.heartbeatKey(eventId, userId));
    if (!heartbeatExpiry || Date.now() > heartbeatExpiry) {
      // Purge expired user
      queue.splice(index, 1);
      this.heartbeats.delete(this.heartbeatKey(eventId, userId));
      return { status: 'EXPIRED' };
    }

    return {
      status: 'QUEUED',
      rank: index + 1,
      totalInQueue: queue.length,
    };
  }

  async sendHeartbeat(eventId: string, userId: string, heartbeatTtl: number): Promise<boolean> {
    const key = this.heartbeatKey(eventId, userId);
    const admitted = this.admittedTokens.get(key);
    const queue = this.queues.get(eventId);
    const inQueue = queue && queue.some((entry) => entry.userId === userId);

    if (admitted || inQueue) {
      this.heartbeats.set(key, Date.now() + heartbeatTtl * 1000);
      return true;
    }

    return false;
  }

  async admitBatch(eventId: string, batchSize: number): Promise<string[]> {
    const queue = this.queues.get(eventId);
    if (!queue || queue.length === 0) {
      return [];
    }

    const admittedUsers: string[] = [];
    const count = Math.min(batchSize, queue.length);
    const candidates = queue.splice(0, count);

    for (const item of candidates) {
      const key = this.heartbeatKey(eventId, item.userId);
      const heartbeatExpiry = this.heartbeats.get(key);
      if (heartbeatExpiry && Date.now() <= heartbeatExpiry) {
        admittedUsers.push(item.userId);
      }
    }

    return admittedUsers;
  }

  async saveAdmissionToken(
    eventId: string,
    userId: string,
    token: string,
    ttlSeconds: number,
  ): Promise<void> {
    const key = this.heartbeatKey(eventId, userId);
    this.admittedTokens.set(key, {
      token,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async getAdmissionToken(eventId: string, userId: string): Promise<string | null> {
    const key = this.heartbeatKey(eventId, userId);
    const entry = this.admittedTokens.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.admittedTokens.delete(key);
      return null;
    }
    return entry.token;
  }

  clear(): void {
    this.queues.clear();
    this.heartbeats.clear();
    this.admittedTokens.clear();
  }
}
