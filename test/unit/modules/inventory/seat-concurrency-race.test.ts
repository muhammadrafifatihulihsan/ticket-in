import { describe, expect, it } from 'vitest';
import { HoldSpecificSeatsUseCase } from '../../../../src/modules/inventory/application/hold-specific-seats.use-case.js';
import { InMemoryInventoryRepository } from '../../../../src/modules/inventory/infrastructure/in-memory-inventory.repository.js';
import { ConflictError } from '../../../../src/platform/errors/problem-details.js';

describe('Seat Hold Concurrency Race Test', () => {
  it('50 concurrent users racing for 1 seat results in exactly 1 winner and 49 conflict errors', async () => {
    const repo = new InMemoryInventoryRepository();
    const useCase = new HoldSpecificSeatsUseCase(repo);
    const eventId = 'ev-concert-war-2026';
    const targetSeatId = 'seat-vip-001';

    // Seed 1 target contested seat
    repo.addSeat({
      id: targetSeatId,
      eventId,
      categoryId: 'cat-vip',
      categoryName: 'VIP',
      seatNumber: 'VIP-001',
      price: 1500000,
      status: 'AVAILABLE',
      heldBy: null,
      expiresAt: null,
      version: 0,
    });

    const totalCompetitors = 50;
    const competitors = Array.from({ length: totalCompetitors }, (_, i) => `user-warrior-${i + 1}`);

    // Launch all 50 reservation requests concurrently using Promise.allSettled
    const results = await Promise.allSettled(
      competitors.map((userId) =>
        useCase.execute({
          eventId,
          userId,
          seatIds: [targetSeatId],
          holdTtlSeconds: 600,
        }),
      ),
    );

    let fulfilledCount = 0;
    let conflictCount = 0;
    let winningUserId: string | null = null;

    for (let i = 0; i < results.length; i++) {
      const res = results[i]!;
      if (res.status === 'fulfilled') {
        fulfilledCount++;
        winningUserId = competitors[i]!;
        expect(res.value.holds).toHaveLength(1);
        expect(res.value.holds[0]?.seatId).toBe(targetSeatId);
      } else {
        expect(res.reason).toBeInstanceOf(ConflictError);
        conflictCount++;
      }
    }

    // Invariant assertions
    expect(fulfilledCount).toBe(1);
    expect(conflictCount).toBe(49);
    expect(winningUserId).not.toBeNull();

    // Verify seat status in repository
    const seats = await repo.findSeatsByEventId(eventId);
    expect(seats).toHaveLength(1);
    expect(seats[0]?.status).toBe('HELD');

    // Verify user quota in repository
    const winnerSeats = await repo.countUserActiveSeats(eventId, winningUserId!);
    expect(winnerSeats).toBe(1);
  });
});
