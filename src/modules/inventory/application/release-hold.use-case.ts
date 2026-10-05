import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../platform/errors/problem-details.js';
import type { InventoryRepositoryPort } from '../domain/inventory.repository.port.js';

export class ReleaseHoldUseCase {
  constructor(private readonly inventoryRepo: InventoryRepositoryPort) {}

  async execute(
    holdId: string,
    userId: string,
  ): Promise<{ success: boolean; releasedHoldId: string }> {
    const hold = await this.inventoryRepo.findHoldById(holdId);
    if (!hold) {
      throw new NotFoundError(`Seat hold with ID '${holdId}' was not found.`);
    }

    if (hold.userId !== userId) {
      throw new ForbiddenError('You do not have permission to release this seat hold.');
    }

    if (hold.status !== 'ACTIVE') {
      throw new ValidationError(`Cannot release hold with status '${hold.status}'.`);
    }

    const released = await this.inventoryRepo.releaseSeatHold(holdId, userId);
    return { success: released, releasedHoldId: holdId };
  }
}
