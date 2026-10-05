import type { InventoryRepositoryPort } from '../domain/inventory.repository.port.js';

export class CleanupExpiredHoldsUseCase {
  constructor(private readonly inventoryRepo: InventoryRepositoryPort) {}

  async execute(now: Date = new Date()): Promise<{ cleanedCount: number }> {
    const cleanedCount = await this.inventoryRepo.releaseExpiredHolds(now);
    return { cleanedCount };
  }
}
