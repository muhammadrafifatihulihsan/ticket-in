import type { WaitingRoomPort } from '../domain/waiting-room.port.js';

export interface HeartbeatOptions {
  heartbeatTtlSeconds?: number;
}

export class HeartbeatUseCase {
  private readonly heartbeatTtl: number;

  constructor(
    private readonly waitingRoom: WaitingRoomPort,
    options?: HeartbeatOptions,
  ) {
    this.heartbeatTtl = options?.heartbeatTtlSeconds ?? 30;
  }

  async execute(eventId: string, userId: string): Promise<{ success: boolean }> {
    const success = await this.waitingRoom.sendHeartbeat(eventId, userId, this.heartbeatTtl);
    return { success };
  }
}
