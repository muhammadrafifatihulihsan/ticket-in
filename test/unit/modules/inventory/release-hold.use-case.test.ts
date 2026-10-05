import { beforeEach, describe, expect, it } from 'vitest';
import { HoldSpecificSeatsUseCase } from '../../../../src/modules/inventory/application/hold-specific-seats.use-case.js';
import { ReleaseHoldUseCase } from '../../../../src/modules/inventory/application/release-hold.use-case.js';
import { InMemoryInventoryRepository } from '../../../../src/modules/inventory/infrastructure/in-memory-inventory.repository.js';
import { ForbiddenError, NotFoundError } from '../../../../src/platform/errors/problem-details.js';

describe('ReleaseHoldUseCase', () => {
  let repo: InMemoryInventoryRepository;
  let holdUseCase: HoldSpecificSeatsUseCase;
  let releaseUseCase: ReleaseHoldUseCase;
  const eventId = 'ev-1';
  const userId = 'user-1';

  beforeEach(() => {
    repo = new InMemoryInventoryRepository();
    holdUseCase = new HoldSpecificSeatsUseCase(repo);
    releaseUseCase = new ReleaseHoldUseCase(repo);

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

  it('successfully releases hold and reverts seat to AVAILABLE', async () => {
    const holdResult = await holdUseCase.execute({
      eventId,
      userId,
      seatIds: ['seat-1'],
    });

    const holdId = holdResult.holds[0]!.id;

    const releaseResult = await releaseUseCase.execute(holdId, userId);
    expect(releaseResult.success).toBe(true);

    const layout = await repo.findSeatsByEventId(eventId);
    expect(layout[0]?.status).toBe('AVAILABLE');
  });

  it('throws ForbiddenError when attempting to release someone elses hold', async () => {
    const holdResult = await holdUseCase.execute({
      eventId,
      userId,
      seatIds: ['seat-1'],
    });

    const holdId = holdResult.holds[0]!.id;

    await expect(releaseUseCase.execute(holdId, 'other-user')).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFoundError for non-existent hold ID', async () => {
    await expect(releaseUseCase.execute('unknown-hold-id', userId)).rejects.toThrow(NotFoundError);
  });
});
