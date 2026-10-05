import { ValidationError } from '../../../platform/errors/problem-details.js';
import type {
  HoldSeatsResult,
  InventoryRepositoryPort,
} from '../domain/inventory.repository.port.js';
import { DEFAULT_HOLD_TTL_SECONDS, MAX_SEATS_PER_USER_PER_EVENT } from '../domain/seat.entity.js';

export interface AutoHoldSeatsCommand {
  eventId: string;
  userId: string;
  categoryId: string;
  quantity: number;
  holdTtlSeconds?: number | undefined;
}

export class AutoHoldSeatsUseCase {
  constructor(private readonly inventoryRepo: InventoryRepositoryPort) {}

  async execute(command: AutoHoldSeatsCommand): Promise<HoldSeatsResult> {
    if (!Number.isInteger(command.quantity) || command.quantity < 1) {
      throw new ValidationError('Quantity must be an integer of at least 1.');
    }

    if (command.quantity > MAX_SEATS_PER_USER_PER_EVENT) {
      throw new ValidationError(
        `Cannot reserve more than ${MAX_SEATS_PER_USER_PER_EVENT} seats at once.`,
      );
    }

    const currentHeld = await this.inventoryRepo.countUserActiveSeats(
      command.eventId,
      command.userId,
    );

    if (currentHeld + command.quantity > MAX_SEATS_PER_USER_PER_EVENT) {
      throw new ValidationError(
        `User exceeds the maximum limit of ${MAX_SEATS_PER_USER_PER_EVENT} seats per event. Currently active: ${currentHeld}.`,
        [
          {
            name: 'quantity',
            reason: `Total held seats would exceed the limit of ${MAX_SEATS_PER_USER_PER_EVENT}.`,
          },
        ],
      );
    }

    const ttl = command.holdTtlSeconds ?? DEFAULT_HOLD_TTL_SECONDS;

    return await this.inventoryRepo.autoHoldSeatsByCategory({
      eventId: command.eventId,
      userId: command.userId,
      categoryId: command.categoryId,
      quantity: command.quantity,
      holdTtlSeconds: ttl,
    });
  }
}
