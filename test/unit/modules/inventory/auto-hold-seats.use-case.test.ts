import { beforeEach, describe, expect, it } from 'vitest';
import { AutoHoldSeatsUseCase } from '../../../../src/modules/inventory/application/auto-hold-seats.use-case.js';
import { InMemoryInventoryRepository } from '../../../../src/modules/inventory/infrastructure/in-memory-inventory.repository.js';
import { ConflictError, ValidationError } from '../../../../src/platform/errors/problem-details.js';

describe('AutoHoldSeatsUseCase', () => {
  let repo: InMemoryInventoryRepository;
  let useCase: AutoHoldSeatsUseCase;
  const eventId = 'ev-1';
  const categoryId = 'cat-vip';
  const userId = 'user-1';

  beforeEach(() => {
    repo = new InMemoryInventoryRepository();
    useCase = new AutoHoldSeatsUseCase(repo);

    for (let i = 1; i <= 5; i++) {
      repo.addSeat({
        id: `seat-${i}`,
        eventId,
        categoryId,
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

  it('automatically allocates requested number of seats in category', async () => {
    const result = await useCase.execute({
      eventId,
      userId,
      categoryId,
      quantity: 2,
    });

    expect(result.holds).toHaveLength(2);
    expect(result.holds[0]?.seatNumber).toBe('VIP-001');
    expect(result.holds[1]?.seatNumber).toBe('VIP-002');
    expect(result.holds[0]?.status).toBe('ACTIVE');

    const layout = await repo.findSeatsByEventId(eventId);
    expect(layout.find((s) => s.id === 'seat-1')?.status).toBe('HELD');
    expect(layout.find((s) => s.id === 'seat-2')?.status).toBe('HELD');
    expect(layout.find((s) => s.id === 'seat-3')?.status).toBe('AVAILABLE');
  });

  it('throws ValidationError when quantity is less than 1 or not an integer', async () => {
    await expect(
      useCase.execute({
        eventId,
        userId,
        categoryId,
        quantity: 0,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when quantity exceeds 4 seats', async () => {
    await expect(
      useCase.execute({
        eventId,
        userId,
        categoryId,
        quantity: 5,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when cumulative user quota of 4 seats is exceeded', async () => {
    await useCase.execute({
      eventId,
      userId,
      categoryId,
      quantity: 3,
    });

    // Trying to hold 2 more seats exceeds max 4
    await expect(
      useCase.execute({
        eventId,
        userId,
        categoryId,
        quantity: 2,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ConflictError when category has insufficient available seats', async () => {
    // There are only 5 seats in total. Requesting 4 works, then requesting 2 fails with ConflictError.
    await useCase.execute({
      eventId,
      userId: 'user-1',
      categoryId,
      quantity: 4,
    });

    await expect(
      useCase.execute({
        eventId,
        userId: 'user-2',
        categoryId,
        quantity: 2,
      }),
    ).rejects.toThrow(ConflictError);
  });
});
