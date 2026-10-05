import { beforeEach, describe, expect, it } from 'vitest';
import { GetQueueStatusUseCase } from '../../../../src/modules/waiting-room/application/get-queue-status.use-case.js';
import { InMemoryWaitingRoomRepository } from '../../../../src/modules/waiting-room/infrastructure/in-memory-waiting-room.repository.js';

describe('GetQueueStatusUseCase', () => {
  let repo: InMemoryWaitingRoomRepository;
  let useCase: GetQueueStatusUseCase;
  const eventId = 'ev-1';

  beforeEach(() => {
    repo = new InMemoryWaitingRoomRepository();
    useCase = new GetQueueStatusUseCase(repo, {
      admissionRate: 10,
      admissionIntervalMs: 5000,
    });
  });

  it('returns NOT_IN_QUEUE for unregistered user', async () => {
    const status = await useCase.execute(eventId, 'unknown-user');
    expect(status.status).toBe('NOT_IN_QUEUE');
  });

  it('returns rank and wait time for queued user', async () => {
    await repo.joinQueue(eventId, 'user-1', 30);
    await repo.joinQueue(eventId, 'user-2', 30);

    const status = await useCase.execute(eventId, 'user-2');
    expect(status.status).toBe('QUEUED');
    expect(status.rank).toBe(2);
    expect(status.totalInQueue).toBe(2);
    expect(status.estimatedWaitSeconds).toBe(1);
  });

  it('returns ADMITTED status with token when user is admitted', async () => {
    await repo.saveAdmissionToken(eventId, 'user-1', 'fake-jwt-token-12345', 300);

    const status = await useCase.execute(eventId, 'user-1');
    expect(status.status).toBe('ADMITTED');
    expect(status.admissionToken).toBe('fake-jwt-token-12345');
    expect(status.expiresIn).toBeGreaterThan(0);
  });
});
