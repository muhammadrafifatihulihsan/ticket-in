import { beforeEach, describe, expect, it } from 'vitest';
import { JoinQueueUseCase } from '../../../../src/modules/waiting-room/application/join-queue.use-case.js';
import { InMemoryWaitingRoomRepository } from '../../../../src/modules/waiting-room/infrastructure/in-memory-waiting-room.repository.js';

describe('JoinQueueUseCase', () => {
  let repo: InMemoryWaitingRoomRepository;
  let useCase: JoinQueueUseCase;
  const eventId = 'ev-1';

  beforeEach(() => {
    repo = new InMemoryWaitingRoomRepository();
    useCase = new JoinQueueUseCase(repo, {
      admissionRate: 10,
      admissionIntervalMs: 5000,
      heartbeatTtlSeconds: 30,
    });
  });

  it('joins queue and receives rank 1 with estimated wait seconds', async () => {
    const pos = await useCase.execute(eventId, 'user-1');

    expect(pos.status).toBe('QUEUED');
    expect(pos.rank).toBe(1);
    expect(pos.totalInQueue).toBe(1);
    expect(pos.estimatedWaitSeconds).toBe(1); // ceil((1/10) * 5) = 1
  });

  it('enforces FIFO order for multiple joining users', async () => {
    const pos1 = await useCase.execute(eventId, 'user-1');
    const pos2 = await useCase.execute(eventId, 'user-2');
    const pos3 = await useCase.execute(eventId, 'user-3');

    expect(pos1.rank).toBe(1);
    expect(pos2.rank).toBe(2);
    expect(pos3.rank).toBe(3);
    expect(pos3.totalInQueue).toBe(3);
  });

  it('maintains existing rank if user joins again', async () => {
    await useCase.execute(eventId, 'user-1');
    await useCase.execute(eventId, 'user-2');

    const rejoin = await useCase.execute(eventId, 'user-1');
    expect(rejoin.rank).toBe(1);
    expect(rejoin.totalInQueue).toBe(2);
  });
});
