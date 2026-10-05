import { beforeEach, describe, expect, it } from 'vitest';
import { GetEventSeatsUseCase } from '../../../../src/modules/inventory/application/get-event-seats.use-case.js';
import { InMemoryInventoryRepository } from '../../../../src/modules/inventory/infrastructure/in-memory-inventory.repository.js';

describe('GetEventSeatsUseCase', () => {
  let repo: InMemoryInventoryRepository;
  let useCase: GetEventSeatsUseCase;
  const eventId = 'ev-1';

  beforeEach(() => {
    repo = new InMemoryInventoryRepository();
    useCase = new GetEventSeatsUseCase(repo);

    repo.addSeat({
      id: 'seat-1',
      eventId,
      categoryId: 'cat-1',
      categoryName: 'VIP',
      seatNumber: 'VIP-001',
      price: 1500000,
      status: 'AVAILABLE',
      heldBy: null,
      expiresAt: null,
      version: 0,
    });
    repo.addSeat({
      id: 'seat-2',
      eventId,
      categoryId: 'cat-1',
      categoryName: 'VIP',
      seatNumber: 'VIP-002',
      price: 1500000,
      status: 'SOLD',
      heldBy: null,
      expiresAt: null,
      version: 1,
    });
  });

  it('retrieves all seats for an event with status and pricing', async () => {
    const seats = await useCase.execute(eventId);

    expect(seats).toHaveLength(2);
    expect(seats[0]?.seatNumber).toBe('VIP-001');
    expect(seats[0]?.status).toBe('AVAILABLE');
    expect(seats[1]?.seatNumber).toBe('VIP-002');
    expect(seats[1]?.status).toBe('SOLD');
  });

  it('returns empty array when event has no seats', async () => {
    const seats = await useCase.execute('unknown-event');
    expect(seats).toHaveLength(0);
  });
});
