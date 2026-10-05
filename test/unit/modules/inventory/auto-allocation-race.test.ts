import { describe, expect, it } from 'vitest';
import { AutoHoldSeatsUseCase } from '../../../../src/modules/inventory/application/auto-hold-seats.use-case.js';
import { InMemoryInventoryRepository } from '../../../../src/modules/inventory/infrastructure/in-memory-inventory.repository.js';
import { ConflictError } from '../../../../src/platform/errors/problem-details.js';

describe('Auto-Allocation Concurrency Race Test (Mode 2)', () => {
  it('20 concurrent requests each asking for 2 seats in a 10-seat category yields exactly 5 winners and 15 conflicts', async () => {
    const repo = new InMemoryInventoryRepository();
    const useCase = new AutoHoldSeatsUseCase(repo);
    const eventId = 'ev-concert-war-2026';
    const categoryId = 'cat-exclusive-vip';

    // Seed 10 seats in this category
    const totalSeats = 10;
    for (let i = 1; i <= totalSeats; i++) {
      const paddedNum = String(i).padStart(3, '0');
      repo.addSeat({
        id: `seat-vip-${paddedNum}`,
        eventId,
        categoryId,
        categoryName: 'VIP',
        seatNumber: `VIP-${paddedNum}`,
        price: 1500000,
        status: 'AVAILABLE',
        heldBy: null,
        expiresAt: null,
        version: 0,
      });
    }

    const totalCompetitors = 20;
    const quantityPerRequest = 2;
    const competitors = Array.from({ length: totalCompetitors }, (_, i) => `auto-warrior-${i + 1}`);

    // Launch all 20 requests concurrently
    const results = await Promise.allSettled(
      competitors.map((userId) =>
        useCase.execute({
          eventId,
          userId,
          categoryId,
          quantity: quantityPerRequest,
          holdTtlSeconds: 600,
        }),
      ),
    );

    let fulfilledCount = 0;
    let conflictCount = 0;
    const allAllocatedSeatIds = new Set<string>();

    for (let i = 0; i < results.length; i++) {
      const res = results[i]!;
      if (res.status === 'fulfilled') {
        fulfilledCount++;
        expect(res.value.holds).toHaveLength(quantityPerRequest);
        for (const hold of res.value.holds) {
          expect(allAllocatedSeatIds.has(hold.seatId)).toBe(false); // No double allocation
          allAllocatedSeatIds.add(hold.seatId);
        }
      } else {
        expect(res.reason).toBeInstanceOf(ConflictError);
        conflictCount++;
      }
    }

    // Invariant assertions
    expect(fulfilledCount).toBe(5); // 5 winners * 2 seats = 10 seats
    expect(conflictCount).toBe(15); // 15 rejected
    expect(allAllocatedSeatIds.size).toBe(totalSeats); // Exactly 10 distinct seats allocated

    // Verify repository status
    const layout = await repo.findSeatsByEventId(eventId);
    const availableSeats = layout.filter((s) => s.status === 'AVAILABLE');
    const heldSeats = layout.filter((s) => s.status === 'HELD');

    expect(availableSeats).toHaveLength(0); // Zero available seats left
    expect(heldSeats).toHaveLength(totalSeats); // All 10 seats are held
  });
});
