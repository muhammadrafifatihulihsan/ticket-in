import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { JwtTokenService } from '../../../../src/modules/identity/infrastructure/jwt-token-service.js';
import { AdmitQueueUseCase } from '../../../../src/modules/waiting-room/application/admit-queue.use-case.js';
import { GetQueueStatusUseCase } from '../../../../src/modules/waiting-room/application/get-queue-status.use-case.js';
import { HeartbeatUseCase } from '../../../../src/modules/waiting-room/application/heartbeat.use-case.js';
import { JoinQueueUseCase } from '../../../../src/modules/waiting-room/application/join-queue.use-case.js';
import { InMemoryWaitingRoomRepository } from '../../../../src/modules/waiting-room/infrastructure/in-memory-waiting-room.repository.js';
import { JwtAdmissionTokenService } from '../../../../src/modules/waiting-room/infrastructure/jwt-admission-token.service.js';
import { createQueueRoutes } from '../../../../src/modules/waiting-room/interface/queue.routes.js';
import { registerProblemDetailsErrorHandler } from '../../../../src/platform/errors/problem-details.js';

describe('Queue Fastify Routes', () => {
  let waitingRoomRepo: InMemoryWaitingRoomRepository;
  let identityTokenService: JwtTokenService;
  let admissionTokenService: JwtAdmissionTokenService;
  let app: ReturnType<typeof Fastify>;

  const userTokenSecret = 'secret12345678901234567890123456';
  const admissionSecret = 'waiting_room_secret_minimum_32_characters_123';
  const eventId = '0192634e-0000-7000-8000-000000000002';
  const userId = '0192634e-0000-7000-8000-000000000001';

  beforeEach(async () => {
    waitingRoomRepo = new InMemoryWaitingRoomRepository();
    identityTokenService = new JwtTokenService(userTokenSecret, userTokenSecret);
    admissionTokenService = new JwtAdmissionTokenService(admissionSecret);

    const joinQueueUseCase = new JoinQueueUseCase(waitingRoomRepo);
    const getQueueStatusUseCase = new GetQueueStatusUseCase(waitingRoomRepo);
    const heartbeatUseCase = new HeartbeatUseCase(waitingRoomRepo);
    const admitQueueUseCase = new AdmitQueueUseCase(waitingRoomRepo, admissionTokenService);

    app = Fastify();
    registerProblemDetailsErrorHandler(app);

    await app.register(
      createQueueRoutes({
        joinQueueUseCase,
        getQueueStatusUseCase,
        heartbeatUseCase,
        admitQueueUseCase,
        tokenService: identityTokenService,
      }),
    );
  });

  it('POST /queue/join returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/queue/join',
      payload: { eventId },
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /queue/join assigns user to queue with valid rank', async () => {
    const userToken = identityTokenService.generateAccessToken({
      sub: userId,
      email: 'user@example.com',
      role: 'user',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/queue/join',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
      payload: { eventId },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('QUEUED');
    expect(body.rank).toBe(1);
  });

  it('GET /queue/status returns queue position for user', async () => {
    const userToken = identityTokenService.generateAccessToken({
      sub: userId,
      email: 'user@example.com',
      role: 'user',
    });

    await waitingRoomRepo.joinQueue(eventId, userId, 30);

    const res = await app.inject({
      method: 'GET',
      url: `/queue/status?eventId=${eventId}`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('QUEUED');
    expect(body.rank).toBe(1);
  });

  it('POST /queue/heartbeat refreshes user queue session', async () => {
    const userToken = identityTokenService.generateAccessToken({
      sub: userId,
      email: 'user@example.com',
      role: 'user',
    });

    await waitingRoomRepo.joinQueue(eventId, userId, 30);

    const res = await app.inject({
      method: 'POST',
      url: '/queue/heartbeat',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
      payload: { eventId },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('POST /queue/admit rejects non-admin users with 403', async () => {
    const userToken = identityTokenService.generateAccessToken({
      sub: userId,
      email: 'user@example.com',
      role: 'user',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/queue/admit',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
      payload: { eventId, batchSize: 10 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('POST /queue/admit allows admin to admit batch of users', async () => {
    const adminToken = identityTokenService.generateAccessToken({
      sub: 'admin-id',
      email: 'admin@example.com',
      role: 'admin',
    });

    await waitingRoomRepo.joinQueue(eventId, userId, 30);

    const res = await app.inject({
      method: 'POST',
      url: '/queue/admit',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: { eventId, batchSize: 5 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.admittedCount).toBe(1);
    expect(body.userIds).toEqual([userId]);
  });
});
