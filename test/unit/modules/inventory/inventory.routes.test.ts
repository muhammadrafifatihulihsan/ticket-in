import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { JwtTokenService } from '../../../../src/modules/identity/infrastructure/jwt-token-service.js';
import { AutoHoldSeatsUseCase } from '../../../../src/modules/inventory/application/auto-hold-seats.use-case.js';
import { GetEventSeatsUseCase } from '../../../../src/modules/inventory/application/get-event-seats.use-case.js';
import { HoldSpecificSeatsUseCase } from '../../../../src/modules/inventory/application/hold-specific-seats.use-case.js';
import { ReleaseHoldUseCase } from '../../../../src/modules/inventory/application/release-hold.use-case.js';
import { InMemoryInventoryRepository } from '../../../../src/modules/inventory/infrastructure/in-memory-inventory.repository.js';
import { createInventoryRoutes } from '../../../../src/modules/inventory/interface/inventory.routes.js';
import { JwtAdmissionTokenService } from '../../../../src/modules/waiting-room/infrastructure/jwt-admission-token.service.js';
import { registerProblemDetailsErrorHandler } from '../../../../src/platform/errors/problem-details.js';

describe('Inventory Fastify Routes', () => {
  let repo: InMemoryInventoryRepository;
  let identityTokenService: JwtTokenService;
  let admissionTokenService: JwtAdmissionTokenService;
  let app: ReturnType<typeof Fastify>;

  const userTokenSecret = 'secret12345678901234567890123456';
  const admissionSecret = 'waiting_room_secret_minimum_32_characters_123';
  const eventId = '0192634e-0000-7000-8000-000000000002';
  const userId = '0192634e-0000-7000-8000-000000000001';

  beforeEach(async () => {
    repo = new InMemoryInventoryRepository();
    identityTokenService = new JwtTokenService(userTokenSecret, userTokenSecret);
    admissionTokenService = new JwtAdmissionTokenService(admissionSecret);

    repo.addSeat({
      id: '0192634e-0000-7000-8000-000000000010',
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
    repo.addSeat({
      id: '0192634e-0000-7000-8000-000000000020',
      eventId,
      categoryId: 'cat-1',
      categoryName: 'VIP',
      seatNumber: 'VIP-002',
      price: 1500000,
      status: 'AVAILABLE',
      heldBy: null,
      expiresAt: null,
      version: 0,
    });

    const getEventSeatsUseCase = new GetEventSeatsUseCase(repo);
    const holdSpecificSeatsUseCase = new HoldSpecificSeatsUseCase(repo);
    const autoHoldSeatsUseCase = new AutoHoldSeatsUseCase(repo);
    const releaseHoldUseCase = new ReleaseHoldUseCase(repo);

    app = Fastify();
    registerProblemDetailsErrorHandler(app);

    await app.register(
      createInventoryRoutes({
        getEventSeatsUseCase,
        holdSpecificSeatsUseCase,
        autoHoldSeatsUseCase,
        releaseHoldUseCase,
        tokenService: identityTokenService,
        admissionTokenService,
      }),
    );
  });

  it('GET /events/:id/seats succeeds with valid JWT and admission token', async () => {
    const userToken = identityTokenService.generateAccessToken({
      sub: userId,
      email: 'user@example.com',
      role: 'user',
    });
    const admissionToken = admissionTokenService.generateToken(userId, eventId, 300);

    const res = await app.inject({
      method: 'GET',
      url: `/events/${eventId}/seats`,
      headers: {
        authorization: `Bearer ${userToken}`,
        'x-admission-token': admissionToken,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0]?.seatNumber).toBe('VIP-001');
  });

  it('GET /events/:id/seats rejects with 401 when x-admission-token is missing', async () => {
    const userToken = identityTokenService.generateAccessToken({
      sub: userId,
      email: 'user@example.com',
      role: 'user',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/events/${eventId}/seats`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /reservations/holds locks seat and returns 201 with hold details', async () => {
    const userToken = identityTokenService.generateAccessToken({
      sub: userId,
      email: 'user@example.com',
      role: 'user',
    });
    const admissionToken = admissionTokenService.generateToken(userId, eventId, 300);

    const res = await app.inject({
      method: 'POST',
      url: '/reservations/holds',
      headers: {
        authorization: `Bearer ${userToken}`,
        'x-admission-token': admissionToken,
      },
      payload: {
        eventId,
        seatIds: ['0192634e-0000-7000-8000-000000000010'],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.holds).toHaveLength(1);
    expect(body.holds[0]?.seatNumber).toBe('VIP-001');
    expect(body.holds[0]?.status).toBe('ACTIVE');
  });

  it('POST /reservations/holds returns 409 Conflict when seat is already held', async () => {
    const user1Token = identityTokenService.generateAccessToken({
      sub: userId,
      email: 'user@example.com',
      role: 'user',
    });
    const admissionToken1 = admissionTokenService.generateToken(userId, eventId, 300);

    // User 1 locks seat 1
    await app.inject({
      method: 'POST',
      url: '/reservations/holds',
      headers: {
        authorization: `Bearer ${user1Token}`,
        'x-admission-token': admissionToken1,
      },
      payload: {
        eventId,
        seatIds: ['0192634e-0000-7000-8000-000000000010'],
      },
    });

    // User 2 attempts to lock the exact same seat
    const user2Id = '0192634e-0000-7000-8000-000000000099';
    const user2Token = identityTokenService.generateAccessToken({
      sub: user2Id,
      email: 'user2@example.com',
      role: 'user',
    });
    const admissionToken2 = admissionTokenService.generateToken(user2Id, eventId, 300);

    const conflictRes = await app.inject({
      method: 'POST',
      url: '/reservations/holds',
      headers: {
        authorization: `Bearer ${user2Token}`,
        'x-admission-token': admissionToken2,
      },
      payload: {
        eventId,
        seatIds: ['0192634e-0000-7000-8000-000000000010'],
      },
    });

    expect(conflictRes.statusCode).toBe(409);
    const body = JSON.parse(conflictRes.body);
    expect(body.code).toBe('CONFLICT');
  });

  it('DELETE /reservations/holds/:id voluntarily releases active hold', async () => {
    const userToken = identityTokenService.generateAccessToken({
      sub: userId,
      email: 'user@example.com',
      role: 'user',
    });
    const admissionToken = admissionTokenService.generateToken(userId, eventId, 300);

    const holdRes = await app.inject({
      method: 'POST',
      url: '/reservations/holds',
      headers: {
        authorization: `Bearer ${userToken}`,
        'x-admission-token': admissionToken,
      },
      payload: {
        eventId,
        seatIds: ['0192634e-0000-7000-8000-000000000020'],
      },
    });

    const holdId = JSON.parse(holdRes.body).holds[0].id;

    const releaseRes = await app.inject({
      method: 'DELETE',
      url: `/reservations/holds/${holdId}`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(releaseRes.statusCode).toBe(200);
    const body = JSON.parse(releaseRes.body);
    expect(body.success).toBe(true);
  });

  it('POST /reservations/auto-holds allocates seats automatically per category', async () => {
    const userToken = identityTokenService.generateAccessToken({
      sub: userId,
      email: 'user@example.com',
      role: 'user',
    });
    const admissionToken = admissionTokenService.generateToken(userId, eventId, 300);

    const res = await app.inject({
      method: 'POST',
      url: '/reservations/auto-holds',
      headers: {
        authorization: `Bearer ${userToken}`,
        'x-admission-token': admissionToken,
      },
      payload: {
        eventId,
        categoryId: 'cat-1',
        quantity: 1,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.holds).toHaveLength(1);
    expect(body.holds[0]?.status).toBe('ACTIVE');
  });

  it('POST /reservations/auto-holds returns 409 Conflict when insufficient seats in category', async () => {
    const userToken = identityTokenService.generateAccessToken({
      sub: userId,
      email: 'user@example.com',
      role: 'user',
    });
    const admissionToken = admissionTokenService.generateToken(userId, eventId, 300);

    // Only 2 seats in cat-1, requesting 3 exceeds stock
    const res = await app.inject({
      method: 'POST',
      url: '/reservations/auto-holds',
      headers: {
        authorization: `Bearer ${userToken}`,
        'x-admission-token': admissionToken,
      },
      payload: {
        eventId,
        categoryId: 'cat-1',
        quantity: 3,
      },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('CONFLICT');
  });
});
