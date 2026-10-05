import type { QueuePosition } from '../domain/queue.types.js';
import type { WaitingRoomPort } from '../domain/waiting-room.port.js';

export interface JoinQueueOptions {
  admissionRate?: number;
  admissionIntervalMs?: number;
  heartbeatTtlSeconds?: number;
}

export class JoinQueueUseCase {
  private readonly admissionRate: number;
  private readonly admissionIntervalMs: number;
  private readonly heartbeatTtl: number;

  constructor(
    private readonly waitingRoom: WaitingRoomPort,
    options?: JoinQueueOptions,
  ) {
    this.admissionRate = options?.admissionRate ?? 50;
    this.admissionIntervalMs = options?.admissionIntervalMs ?? 5000;
    this.heartbeatTtl = options?.heartbeatTtlSeconds ?? 30;
  }

  async execute(eventId: string, userId: string): Promise<QueuePosition> {
    const position = await this.waitingRoom.joinQueue(eventId, userId, this.heartbeatTtl);

    if (position.status === 'QUEUED' && position.rank) {
      const waitSeconds = Math.ceil((position.rank / this.admissionRate) * (this.admissionIntervalMs / 1000));
      return {
        ...position,
        estimatedWaitSeconds: waitSeconds,
      };
    }

    return position;
  }
}
