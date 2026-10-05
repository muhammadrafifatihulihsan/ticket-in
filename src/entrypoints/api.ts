import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CreateEventUseCase } from '../modules/catalog/application/create-event.use-case.js';
import { GetEventDetailsUseCase } from '../modules/catalog/application/get-event-details.use-case.js';
import { GetEventsUseCase } from '../modules/catalog/application/get-events.use-case.js';
import { DrizzleCatalogRepository } from '../modules/catalog/infrastructure/drizzle-catalog.repository.js';
import { RedisCatalogCache } from '../modules/catalog/infrastructure/redis-catalog-cache.js';
import {
  createCatalogRoutes,
  type CatalogRoutesOptions,
} from '../modules/catalog/interface/catalog.routes.js';
import { LoginUseCase } from '../modules/identity/application/login.use-case.js';
import { RefreshTokenUseCase } from '../modules/identity/application/refresh-token.use-case.js';
import { RegisterUseCase } from '../modules/identity/application/register.use-case.js';
import type { TokenService } from '../modules/identity/domain/token-service.port.js';
import { Argon2PasswordHasher } from '../modules/identity/infrastructure/argon2-password-hasher.js';
import { DrizzleUserRepository } from '../modules/identity/infrastructure/drizzle-user.repository.js';
import { InMemoryRefreshTokenRepository } from '../modules/identity/infrastructure/in-memory-refresh-token.repository.js';
import { JwtTokenService } from '../modules/identity/infrastructure/jwt-token-service.js';
import {
  createAuthRoutes,
  type AuthRoutesOptions,
} from '../modules/identity/interface/auth.routes.js';
import { AutoHoldSeatsUseCase } from '../modules/inventory/application/auto-hold-seats.use-case.js';
import { GetEventSeatsUseCase } from '../modules/inventory/application/get-event-seats.use-case.js';
import { HoldSpecificSeatsUseCase } from '../modules/inventory/application/hold-specific-seats.use-case.js';
import { ReleaseHoldUseCase } from '../modules/inventory/application/release-hold.use-case.js';
import { DrizzleInventoryRepository } from '../modules/inventory/infrastructure/drizzle-inventory.repository.js';
import {
  createInventoryRoutes,
  type InventoryRoutesOptions,
} from '../modules/inventory/interface/inventory.routes.js';
import { CreateOrderUseCase } from '../modules/order/application/create-order.use-case.js';
import { GetOrderUseCase } from '../modules/order/application/get-order.use-case.js';
import { ListUserOrdersUseCase } from '../modules/order/application/list-user-orders.use-case.js';
import { DrizzleIdempotencyRepository } from '../modules/order/infrastructure/drizzle-idempotency.repository.js';
import { DrizzleOrderRepository } from '../modules/order/infrastructure/drizzle-order.repository.js';
import { IdempotencyService } from '../modules/order/infrastructure/idempotency.service.js';
import {
  createOrderRoutes,
  type OrderRoutesOptions,
} from '../modules/order/interface/order.routes.js';
import { CheckoutPaymentUseCase } from '../modules/payment/application/checkout-payment.use-case.js';
import { ProcessPaymentWebhookUseCase } from '../modules/payment/application/process-payment-webhook.use-case.js';
import { DrizzlePaymentRepository } from '../modules/payment/infrastructure/drizzle-payment.repository.js';
import { HmacSignatureService } from '../modules/payment/infrastructure/hmac-signature.service.js';
import {
  createPaymentRoutes,
  type PaymentRoutesOptions,
} from '../modules/payment/interface/payment.routes.js';
import { GetTicketUseCase } from '../modules/ticketing/application/get-ticket.use-case.js';
import { ListUserTicketsUseCase } from '../modules/ticketing/application/list-user-tickets.use-case.js';
import { VerifyTicketUseCase } from '../modules/ticketing/application/verify-ticket.use-case.js';
import { DrizzleTicketRepository } from '../modules/ticketing/infrastructure/drizzle-ticket.repository.js';
import {
  createTicketRoutes,
  type TicketRoutesOptions,
} from '../modules/ticketing/interface/ticket.routes.js';
import { AdmitQueueUseCase } from '../modules/waiting-room/application/admit-queue.use-case.js';
import { GetQueueStatusUseCase } from '../modules/waiting-room/application/get-queue-status.use-case.js';
import { HeartbeatUseCase } from '../modules/waiting-room/application/heartbeat.use-case.js';
import { JoinQueueUseCase } from '../modules/waiting-room/application/join-queue.use-case.js';
import type { AdmissionTokenServicePort } from '../modules/waiting-room/domain/admission-token.port.js';
import { JwtAdmissionTokenService } from '../modules/waiting-room/infrastructure/jwt-admission-token.service.js';
import { RedisWaitingRoomRepository } from '../modules/waiting-room/infrastructure/redis-waiting-room.repository.js';
import {
  createQueueRoutes,
  type QueueRoutesOptions,
} from '../modules/waiting-room/interface/queue.routes.js';
import { SystemClock } from '../platform/clock/clock.js';
import { config as defaultConfig, type EnvConfig } from '../platform/config/env.js';
import { closeDatabase, db as defaultDb } from '../platform/db/client.js';
import type * as schema from '../platform/db/schema.js';
import { registerProblemDetailsErrorHandler } from '../platform/errors/problem-details.js';
import { UuidV7Generator } from '../platform/id/id-generator.js';
import { defaultMetricsService, type MetricsService } from '../platform/metrics/metrics.service.js';
import { getRedisClient } from '../platform/redis/client.js';

export interface ApiServerOptions {
  config?: EnvConfig | undefined;
  database?: NodePgDatabase<typeof schema> | undefined;
  redisClient?: Redis | undefined;
  tokenService?: TokenService | undefined;
  admissionTokenService?: AdmissionTokenServicePort | undefined;
  metricsService?: MetricsService | undefined;
  authRoutesOptions?: AuthRoutesOptions | undefined;
  queueRoutesOptions?: QueueRoutesOptions | undefined;
  catalogRoutesOptions?: CatalogRoutesOptions | undefined;
  inventoryRoutesOptions?: InventoryRoutesOptions | undefined;
  orderRoutesOptions?: OrderRoutesOptions | undefined;
  paymentRoutesOptions?: PaymentRoutesOptions | undefined;
  ticketRoutesOptions?: TicketRoutesOptions | undefined;
}

export async function createApiServer(options: ApiServerOptions = {}): Promise<FastifyInstance> {
  const cfg = options.config ?? defaultConfig;
  const database = options.database ?? defaultDb;
  const redisClient = options.redisClient ?? getRedisClient();
  const clock = new SystemClock();
  const idGen = new UuidV7Generator();
  const metrics = options.metricsService ?? defaultMetricsService;

  const app = Fastify({ logger: false });

  // 1. Security & Parsing Middleware
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true, credentials: true });

  // 2. Metrics Hooks
  metrics.registerHooks(app);

  // 3. RFC 9457 Problem Details Error Handler
  registerProblemDetailsErrorHandler(app);

  // 4. OpenAPI / Swagger Documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ticket-in API',
        description: 'Enterprise backend platform for high-concurrency concert ticket wars',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // 4b. Static Web Demo (served at /app)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(__dirname, '..', '..', 'public');
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/app/',
  });

  app.get('/app', async (_req, reply) => {
    return reply.sendFile('index.html');
  });

  // 5. System Health & Observability Endpoints
  app.get('/health', async (_req, reply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'ticket-in-api',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/metrics', async (_req, reply) => {
    const rawMetrics = await metrics.getMetrics();
    return reply.type(metrics.getContentType()).send(rawMetrics);
  });

  // 6. Common Services
  const tokenService =
    options.tokenService ??
    new JwtTokenService(cfg.JWT_ACCESS_SECRET, cfg.JWT_REFRESH_SECRET, '15m', '7d');

  const admissionTokenService =
    options.admissionTokenService ?? new JwtAdmissionTokenService(cfg.WAITING_ROOM_SECRET);

  // 7. Route Wiring
  // Identity / Auth
  const tokenRepo = new InMemoryRefreshTokenRepository();
  const authRoutes = createAuthRoutes(
    options.authRoutesOptions ?? {
      registerUseCase: new RegisterUseCase(
        new DrizzleUserRepository(database),
        new Argon2PasswordHasher(),
        idGen,
        clock,
      ),
      loginUseCase: new LoginUseCase(
        new DrizzleUserRepository(database),
        tokenRepo,
        new Argon2PasswordHasher(),
        tokenService,
        idGen,
        clock,
      ),
      refreshTokenUseCase: new RefreshTokenUseCase(
        tokenRepo,
        new DrizzleUserRepository(database),
        tokenService,
      ),
      tokenService,
    },
  );
  await app.register(authRoutes, { prefix: '/api/v1/auth' });

  // Waiting Room / Queue
  const queueRepo = new RedisWaitingRoomRepository(redisClient);
  const queueRoutes = createQueueRoutes(
    options.queueRoutesOptions ?? {
      joinQueueUseCase: new JoinQueueUseCase(queueRepo, {
        admissionRate: cfg.ADMISSION_RATE_PER_INTERVAL,
        admissionIntervalMs: cfg.ADMISSION_INTERVAL_MS,
        heartbeatTtlSeconds: cfg.HEARTBEAT_TTL_SECONDS,
      }),
      getQueueStatusUseCase: new GetQueueStatusUseCase(queueRepo),
      heartbeatUseCase: new HeartbeatUseCase(queueRepo, {
        heartbeatTtlSeconds: cfg.HEARTBEAT_TTL_SECONDS,
      }),
      admitQueueUseCase: new AdmitQueueUseCase(queueRepo, admissionTokenService),
      tokenService,
    },
  );
  await app.register(queueRoutes, { prefix: '/api/v1/queue' });

  // Catalog / Events
  const catalogRepo = new DrizzleCatalogRepository(database);
  const catalogCache = new RedisCatalogCache(redisClient);
  const catalogRoutes = createCatalogRoutes(
    options.catalogRoutesOptions ?? {
      getEventsUseCase: new GetEventsUseCase(catalogRepo, catalogCache),
      getEventDetailsUseCase: new GetEventDetailsUseCase(catalogRepo, catalogCache),
      createEventUseCase: new CreateEventUseCase(catalogRepo, catalogCache),
      tokenService,
    },
  );
  await app.register(catalogRoutes, { prefix: '/api/v1' });

  // Inventory / Seats & Holds
  const inventoryRepo = new DrizzleInventoryRepository(database);
  const inventoryRoutes = createInventoryRoutes(
    options.inventoryRoutesOptions ?? {
      getEventSeatsUseCase: new GetEventSeatsUseCase(inventoryRepo),
      holdSpecificSeatsUseCase: new HoldSpecificSeatsUseCase(inventoryRepo),
      autoHoldSeatsUseCase: new AutoHoldSeatsUseCase(inventoryRepo),
      releaseHoldUseCase: new ReleaseHoldUseCase(inventoryRepo),
      tokenService,
      admissionTokenService,
    },
  );
  await app.register(inventoryRoutes, { prefix: '/api/v1' });

  // Orders & Idempotency
  const orderRepo = new DrizzleOrderRepository(database);
  const idempotencyRepo = new DrizzleIdempotencyRepository(database);
  const idempotencyService = new IdempotencyService(idempotencyRepo, clock);
  const orderRoutes = createOrderRoutes(
    options.orderRoutesOptions ?? {
      createOrderUseCase: new CreateOrderUseCase(orderRepo, idGen, clock),
      getOrderUseCase: new GetOrderUseCase(orderRepo),
      listUserOrdersUseCase: new ListUserOrdersUseCase(orderRepo),
      idempotencyService,
      tokenService,
    },
  );
  await app.register(orderRoutes, { prefix: '/api/v1' });

  // Payments
  const paymentRepo = new DrizzlePaymentRepository(database);
  const hmacService = new HmacSignatureService(cfg.WEBHOOK_HMAC_SECRET, clock);
  const paymentRoutes = createPaymentRoutes(
    options.paymentRoutesOptions ?? {
      checkoutPaymentUseCase: new CheckoutPaymentUseCase(paymentRepo, orderRepo, idGen, clock),
      processPaymentWebhookUseCase: new ProcessPaymentWebhookUseCase(paymentRepo, hmacService),
      tokenService,
    },
  );
  await app.register(paymentRoutes, { prefix: '/api/v1' });

  // Ticketing
  const ticketRepo = new DrizzleTicketRepository(database);
  const ticketRoutes = createTicketRoutes(
    options.ticketRoutesOptions ?? {
      getTicketUseCase: new GetTicketUseCase(ticketRepo),
      listUserTicketsUseCase: new ListUserTicketsUseCase(ticketRepo),
      verifyTicketUseCase: new VerifyTicketUseCase(ticketRepo),
      tokenService,
    },
  );
  await app.register(ticketRoutes, { prefix: '/api/v1' });

  return app;
}

// Auto-run if executed as main file
if (process.argv[1] && (process.argv[1].endsWith('api.ts') || process.argv[1].endsWith('api.js'))) {
  const server = await createApiServer();
  const port = defaultConfig.PORT;
  const host = defaultConfig.HOST;

  await server.listen({ port, host });
  console.info(`ticket-in API server listening at http://${host}:${port}`);

  const handleShutdown = async (signal: string) => {
    console.info(`Received ${signal}. Shutting down API server...`);
    try {
      await server.close();
      await closeDatabase();
      process.exit(0);
    } catch (err) {
      console.error('Error during API server shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void handleShutdown('SIGINT'));
  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
}
