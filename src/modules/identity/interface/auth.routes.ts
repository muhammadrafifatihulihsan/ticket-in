import type { FastifyPluginAsync } from 'fastify';
import type { LoginUseCase } from '../application/login.use-case.js';
import type { RefreshTokenUseCase } from '../application/refresh-token.use-case.js';
import type { RegisterUseCase } from '../application/register.use-case.js';
import type { TokenService } from '../domain/token-service.port.js';
import { createAuthMiddleware } from './auth.middleware.js';
import {
  authResponseSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  tokenPairResponseSchema,
  userResponseSchema,
} from './auth.schemas.js';

export interface AuthRoutesOptions {
  registerUseCase: RegisterUseCase;
  loginUseCase: LoginUseCase;
  refreshTokenUseCase: RefreshTokenUseCase;
  tokenService: TokenService;
}

export function createAuthRoutes(options: AuthRoutesOptions): FastifyPluginAsync {
  const { registerUseCase, loginUseCase, refreshTokenUseCase, tokenService } = options;
  const authenticateJwt = createAuthMiddleware(tokenService);

  return async function authRoutes(fastify) {
    fastify.post('/register', async (req, reply) => {
      const body = registerSchema.parse(req.body);
      const user = await registerUseCase.execute(body);
      return reply.status(201).send(userResponseSchema.parse(user));
    });

    fastify.post('/login', async (req, reply) => {
      const body = loginSchema.parse(req.body);
      const result = await loginUseCase.execute(body);
      return reply.status(200).send(authResponseSchema.parse(result));
    });

    fastify.post('/refresh', async (req, reply) => {
      const body = refreshTokenSchema.parse(req.body);
      const tokens = await refreshTokenUseCase.execute(body);
      return reply.status(200).send(tokenPairResponseSchema.parse(tokens));
    });

    fastify.get('/me', { preHandler: [authenticateJwt] }, async (req, reply) => {
      return reply.status(200).send({
        user: req.user,
      });
    });
  };
}
