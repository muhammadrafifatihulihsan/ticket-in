import { beforeEach, describe, expect, it } from 'vitest';
import { CleanupExpiredHoldsUseCase } from '../../../../src/modules/inventory/application/cleanup-expired-holds.use-case.js';
import { HoldSpecificSeatsUseCase } from '../../../../src/modules/inventory/application/hold-specific-seats.use-case.js';
import { InMemoryInventoryRepository } from '../../../../src/modules/inventory/infrastructure/in-memory-inventory.repository.js';

describe('CleanupExpiredHoldsUseCase', () => {
  let repo: InMemoryInventoryRepository;
  let holdUseCase: HoldSpecificSeatsUseCase;
  let cleanupUseCase: CleanupExpiredHoldsUseCase;
  const eventId = 'ev-1';
  const userId = 'user-1';

  beforeEach(() => {
    repo = new InMemoryInventoryRepository();
    holdUseCase = new HoldSpecificSeatsUseCase(repo);
    cleanupUseCase = new CleanupExpiredHoldsUseCase(repo);

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
  });

  it('reverts expired holds to AVAILABLE when past expiration time', async () => {
    // Hold seat with 1 second TTL
    await holdUseCase.execute({
      eventId,
      userId,
      seatIds: ['seat-1'],
      holdTtlSeconds: 1,
    });

    const layoutBefore = await repo.findSeatsByEventId(eventId);
    expect(layoutBefore[0]?.status).toBe('HELD');

    // Run cleanup 2 seconds in the future
    const futureTime = new Date(Date.now() + 2000);
    const result = await cleanupUseCase.execute(futureTime);
    expect(result.cleanedCount).toBe(1);

    const layoutAfter = await repo.findSeatsByEventId(eventId);
    expect(layoutAfter[0]?.status).toBe('AVAILABLE');
  });

  it('does not touch active holds that have not yet expired', async () => {
    await holdUseCase.execute({
      eventId,
      userId,
      seatIds: ['seat-1'],
      holdTtlSeconds: 600,
    });

    const result = await cleanupUseCase.execute(new Date());
    expect(result.cleanedCount).toBe(0);

    const layout = await repo.findSeatsByEventId(eventId);
    expect(layout[0]?.status).toBe('HELD');
  });
});
