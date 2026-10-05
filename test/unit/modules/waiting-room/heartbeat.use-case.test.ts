import { beforeEach, describe, expect, it } from 'vitest';
import { HeartbeatUseCase } from '../../../../src/modules/waiting-room/application/heartbeat.use-case.js';
import { InMemoryWaitingRoomRepository } from '../../../../src/modules/waiting-room/infrastructure/in-memory-waiting-room.repository.js';

describe('HeartbeatUseCase', () => {
  let repo: InMemoryWaitingRoomRepository;
  let useCase: HeartbeatUseCase;
  const eventId = 'ev-1';

  beforeEach(() => {
    repo = new InMemoryWaitingRoomRepository();
    useCase = new HeartbeatUseCase(repo, { heartbeatTtlSeconds: 30 });
  });

  it('successfully refreshes heartbeat for user active in queue', async () => {
    await repo.joinQueue(eventId, 'user-1', 30);

    const result = await useCase.execute(eventId, 'user-1');
    expect(result.success).toBe(true);
  });

  it('fails heartbeat for user not in queue', async () => {
    const result = await useCase.execute(eventId, 'unknown-user');
    expect(result.success).toBe(false);
  });
});
