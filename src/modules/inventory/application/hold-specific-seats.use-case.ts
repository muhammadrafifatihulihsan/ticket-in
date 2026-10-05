import { ValidationError } from '../../../platform/errors/problem-details.js';
import type {
  HoldSeatsResult,
  InventoryRepositoryPort,
} from '../domain/inventory.repository.port.js';
import {
  DEFAULT_HOLD_TTL_SECONDS,
  MAX_SEATS_PER_USER_PER_EVENT,
} from '../domain/seat.entity.js';

export interface HoldSpecificSeatsCommand {
  eventId: string;
  userId: string;
  seatIds: string[];
  holdTtlSeconds?: number | undefined;
}

export class HoldSpecificSeatsUseCase {
  constructor(private readonly inventoryRepo: InventoryRepositoryPort) {}

  async execute(command: HoldSpecificSeatsCommand): Promise<HoldSeatsResult> {
    if (!command.seatIds || command.seatIds.length === 0) {
      throw new ValidationError('At least one seat must be selected for reservation.');
    }

    if (command.seatIds.length > MAX_SEATS_PER_USER_PER_EVENT) {
      throw new ValidationError(`Cannot reserve more than ${MAX_SEATS_PER_USER_PER_EVENT} seats at once.`);
    }

    const uniqueSeatIds = new Set(command.seatIds);
    if (uniqueSeatIds.size !== command.seatIds.length) {
      throw new ValidationError('Duplicate seat selections are not allowed.');
    }

    const currentHeld = await this.inventoryRepo.countUserActiveSeats(command.eventId, command.userId);
    if (currentHeld + command.seatIds.length > MAX_SEATS_PER_USER_PER_EVENT) {
      throw new ValidationError(
        `User exceeds the maximum limit of ${MAX_SEATS_PER_USER_PER_EVENT} seats per event. Currently active: ${currentHeld}.`,
        [
          {
            name: 'seatIds',
            reason: `Total held seats would exceed the limit of ${MAX_SEATS_PER_USER_PER_EVENT}.`,
          },
        ],
      );
    }

    const ttl = command.holdTtlSeconds ?? DEFAULT_HOLD_TTL_SECONDS;

    return await this.inventoryRepo.holdSpecificSeats({
      eventId: command.eventId,
      userId: command.userId,
      seatIds: command.seatIds,
      holdTtlSeconds: ttl,
    });
  }
}
