import type { InventoryRepositoryPort } from '../domain/inventory.repository.port.js';
import type { SeatLayoutItem } from '../domain/seat.entity.js';

export class GetEventSeatsUseCase {
  constructor(private readonly inventoryRepo: InventoryRepositoryPort) {}

  async execute(eventId: string): Promise<SeatLayoutItem[]> {
    return await this.inventoryRepo.findSeatsByEventId(eventId);
  }
}
