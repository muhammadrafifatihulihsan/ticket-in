import { beforeEach, describe, expect, it } from 'vitest';
import { HoldSpecificSeatsUseCase } from '../../../../src/modules/inventory/application/hold-specific-seats.use-case.js';
import { InMemoryInventoryRepository } from '../../../../src/modules/inventory/infrastructure/in-memory-inventory.repository.js';
import { ConflictError, ValidationError } from '../../../../src/platform/errors/problem-details.js';

describe('HoldSpecificSeatsUseCase', () => {
  let repo: InMemoryInventoryRepository;
  let useCase: HoldSpecificSeatsUseCase;
  const eventId = 'ev-1';
  const userId = 'user-1';

  beforeEach(() => {
    repo = new InMemoryInventoryRepository();
    useCase = new HoldSpecificSeatsUseCase(repo);

    for (let i = 1; i <= 6; i++) {
      repo.addSeat({
        id: `seat-${i}`,
        eventId,
        categoryId: 'cat-1',
        categoryName: 'VIP',
        seatNumber: `VIP-00${i}`,
        price: 1500000,
        status: 'AVAILABLE',
        heldBy: null,
        expiresAt: null,
        version: 0,
      });
    }
  });

  it('successfully locks 2 available seats and returns active holds', async () => {
    const result = await useCase.execute({
      eventId,
      userId,
      seatIds: ['seat-1', 'seat-2'],
      holdTtlSeconds: 600,
    });

    expect(result.holds).toHaveLength(2);
    expect(result.holds[0]?.seatId).toBe('seat-1');
    expect(result.holds[0]?.status).toBe('ACTIVE');
    expect(result.holds[1]?.seatId).toBe('seat-2');

    // Check repository status updated
    const layout = await repo.findSeatsByEventId(eventId);
    expect(layout.find((s) => s.id === 'seat-1')?.status).toBe('HELD');
    expect(layout.find((s) => s.id === 'seat-2')?.status).toBe('HELD');
    expect(layout.find((s) => s.id === 'seat-3')?.status).toBe('AVAILABLE');
  });

  it('throws ValidationError when selecting more than 4 seats', async () => {
    await expect(
      useCase.execute({
        eventId,
        userId,
        seatIds: ['seat-1', 'seat-2', 'seat-3', 'seat-4', 'seat-5'],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when user quota of 4 seats is exceeded cumulatively', async () => {
    // User already holds 3 seats
    await useCase.execute({
      eventId,
      userId,
      seatIds: ['seat-1', 'seat-2', 'seat-3'],
    });

    // Attempting to hold 2 more seats exceeds max limit of 4
    await expect(
      useCase.execute({
        eventId,
        userId,
        seatIds: ['seat-4', 'seat-5'],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ConflictError when attempting to hold an already held seat', async () => {
    // User 1 holds seat-1
    await useCase.execute({
      eventId,
      userId: 'user-1',
      seatIds: ['seat-1'],
    });

    // User 2 attempts to hold seat-1
    await expect(
      useCase.execute({
        eventId,
        userId: 'user-2',
        seatIds: ['seat-1'],
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('throws ValidationError on duplicate seat IDs in the request', async () => {
    await expect(
      useCase.execute({
        eventId,
        userId,
        seatIds: ['seat-1', 'seat-1'],
      }),
    ).rejects.toThrow(ValidationError);
  });
});
