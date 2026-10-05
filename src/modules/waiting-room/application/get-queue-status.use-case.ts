import type { QueuePosition } from '../domain/queue.types.js';
import type { WaitingRoomPort } from '../domain/waiting-room.port.js';

export interface GetQueueStatusOptions {
  admissionRate?: number;
  admissionIntervalMs?: number;
}

export class GetQueueStatusUseCase {
  private readonly admissionRate: number;
  private readonly admissionIntervalMs: number;

  constructor(
    private readonly waitingRoom: WaitingRoomPort,
    options?: GetQueueStatusOptions,
  ) {
    this.admissionRate = options?.admissionRate ?? 50;
    this.admissionIntervalMs = options?.admissionIntervalMs ?? 5000;
  }

  async execute(eventId: string, userId: string): Promise<QueuePosition> {
    const position = await this.waitingRoom.getQueueStatus(eventId, userId);

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
