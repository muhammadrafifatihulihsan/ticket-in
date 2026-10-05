import type { AdmissionTokenServicePort } from '../domain/admission-token.port.js';
import type { WaitingRoomPort } from '../domain/waiting-room.port.js';

export interface AdmitQueueOptions {
  defaultBatchSize?: number;
  tokenTtlSeconds?: number;
}

export interface AdmitQueueResult {
  admittedCount: number;
  userIds: string[];
}

export class AdmitQueueUseCase {
  private readonly defaultBatchSize: number;
  private readonly tokenTtlSeconds: number;

  constructor(
    private readonly waitingRoom: WaitingRoomPort,
    private readonly tokenService: AdmissionTokenServicePort,
    options?: AdmitQueueOptions,
  ) {
    this.defaultBatchSize = options?.defaultBatchSize ?? 50;
    this.tokenTtlSeconds = options?.tokenTtlSeconds ?? 600;
  }

  async execute(eventId: string, batchSize?: number): Promise<AdmitQueueResult> {
    const size = batchSize && batchSize > 0 ? batchSize : this.defaultBatchSize;
    const userIds = await this.waitingRoom.admitBatch(eventId, size);

    for (const userId of userIds) {
      const token = this.tokenService.generateToken(userId, eventId, this.tokenTtlSeconds);
      await this.waitingRoom.saveAdmissionToken(eventId, userId, token, this.tokenTtlSeconds);
    }

    return {
      admittedCount: userIds.length,
      userIds,
    };
  }
}
