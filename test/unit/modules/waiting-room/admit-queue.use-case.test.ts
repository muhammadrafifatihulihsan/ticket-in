import { beforeEach, describe, expect, it } from 'vitest';
import { AdmitQueueUseCase } from '../../../../src/modules/waiting-room/application/admit-queue.use-case.js';
import { InMemoryWaitingRoomRepository } from '../../../../src/modules/waiting-room/infrastructure/in-memory-waiting-room.repository.js';
import { JwtAdmissionTokenService } from '../../../../src/modules/waiting-room/infrastructure/jwt-admission-token.service.js';

describe('AdmitQueueUseCase', () => {
  let repo: InMemoryWaitingRoomRepository;
  let tokenService: JwtAdmissionTokenService;
  let useCase: AdmitQueueUseCase;
  const eventId = 'ev-1';

  beforeEach(() => {
    repo = new InMemoryWaitingRoomRepository();
    tokenService = new JwtAdmissionTokenService('valid_secret_key_minimum_32_characters_12345');
    useCase = new AdmitQueueUseCase(repo, tokenService, {
      defaultBatchSize: 2,
      tokenTtlSeconds: 600,
    });
  });

  it('admits top N users from queue and generates signed tokens', async () => {
    await repo.joinQueue(eventId, 'user-1', 30);
    await repo.joinQueue(eventId, 'user-2', 30);
    await repo.joinQueue(eventId, 'user-3', 30);

    const result = await useCase.execute(eventId, 2);
    expect(result.admittedCount).toBe(2);
    expect(result.userIds).toEqual(['user-1', 'user-2']);

    // Check user-1 receives ADMITTED status with verifiable token
    const status1 = await repo.getQueueStatus(eventId, 'user-1');
    expect(status1.status).toBe('ADMITTED');
    expect(status1.admissionToken).toBeDefined();

    const verified = tokenService.verifyToken(status1.admissionToken!, eventId, 'user-1');
    expect(verified.sub).toBe('user-1');
    expect(verified.eventId).toBe(eventId);

    // Remaining user-3 should now be rank 1
    const status3 = await repo.getQueueStatus(eventId, 'user-3');
    expect(status3.status).toBe('QUEUED');
    expect(status3.rank).toBe(1);
    expect(status3.totalInQueue).toBe(1);
  });

  it('handles empty queue gracefully', async () => {
    const result = await useCase.execute(eventId, 5);
    expect(result.admittedCount).toBe(0);
    expect(result.userIds).toEqual([]);
  });
});
