import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { JwtAdmissionTokenService } from '../../../../src/modules/waiting-room/infrastructure/jwt-admission-token.service.js';
import { createAdmissionTokenMiddleware } from '../../../../src/modules/waiting-room/interface/queue.middleware.js';
import { registerProblemDetailsErrorHandler } from '../../../../src/platform/errors/problem-details.js';

describe('Admission Token Middleware', () => {
  const secret = 'valid_secret_key_minimum_32_characters_12345';
  let tokenService: JwtAdmissionTokenService;
  let app: ReturnType<typeof Fastify>;

  const userId = '0192634e-0000-7000-8000-000000000001';
  const eventId = '0192634e-0000-7000-8000-000000000002';

  beforeEach(() => {
    tokenService = new JwtAdmissionTokenService(secret);
    app = Fastify();
    registerProblemDetailsErrorHandler(app);

    // Mock authentication preHandler setting req.user
    app.addHook('preHandler', async (req: FastifyRequest) => {
      req.user = {
        id: userId,
        email: 'user@example.com',
        role: 'user',
      };
    });

    const admissionMiddleware = createAdmissionTokenMiddleware(tokenService);

    app.get('/events/:id/seats', { preHandler: [admissionMiddleware] }, async (req: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send({
        admitted: true,
        admission: req.admission,
      });
    });
  });

  it('allows request with valid x-admission-token header', async () => {
    const token = tokenService.generateToken(userId, eventId, 300);

    const res = await app.inject({
      method: 'GET',
      url: `/events/${eventId}/seats`,
      headers: {
        'x-admission-token': token,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.admitted).toBe(true);
    expect(body.admission.sub).toBe(userId);
    expect(body.admission.eventId).toBe(eventId);
  });

  it('rejects request with 401 when x-admission-token is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/events/${eventId}/seats`,
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('rejects request with 403 when token is for a different event', async () => {
    const differentEvent = '0192634e-0000-7000-8000-000000000999';
    const token = tokenService.generateToken(userId, differentEvent, 300);

    const res = await app.inject({
      method: 'GET',
      url: `/events/${eventId}/seats`,
      headers: {
        'x-admission-token': token,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('FORBIDDEN_OBJECT_ACCESS');
  });
});
