import type { FastifyPluginAsync } from 'fastify';
import { ValidationError } from '../../../platform/errors/problem-details.js';
import type { TokenService } from '../../identity/domain/token-service.port.js';
import { createAuthMiddleware } from '../../identity/interface/auth.middleware.js';
import type { CreateOrderUseCase } from '../application/create-order.use-case.js';
import type { GetOrderUseCase } from '../application/get-order.use-case.js';
import type { ListUserOrdersUseCase } from '../application/list-user-orders.use-case.js';
import type { OrderWithItems } from '../domain/order.entity.js';
import type { IdempotencyService } from '../infrastructure/idempotency.service.js';
import {
  createOrderBodySchema,
  getOrderParamsSchema,
  type OrderResponse,
} from './order.schemas.js';

export interface OrderRoutesOptions {
  createOrderUseCase: CreateOrderUseCase;
  getOrderUseCase: GetOrderUseCase;
  listUserOrdersUseCase: ListUserOrdersUseCase;
  idempotencyService: IdempotencyService;
  tokenService?: TokenService;
}

export function formatOrderResponse(order: OrderWithItems): OrderResponse {
  return {
    id: order.id,
    userId: order.userId,
    eventId: order.eventId,
    status: order.status,
    totalAmount: order.totalAmount,
    expiresAt: order.expiresAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map((item) => {
      const formattedItem: OrderResponse['items'][number] = {
        id: item.id,
        orderId: item.orderId,
        seatId: item.seatId,
        price: item.price,
        createdAt: item.createdAt.toISOString(),
      };
      if (item.seatNumber !== undefined) {
        formattedItem.seatNumber = item.seatNumber;
      }
      if (item.seatCategoryName !== undefined) {
        formattedItem.seatCategoryName = item.seatCategoryName;
      }
      return formattedItem;
    }),
  };
}

export function createOrderRoutes(options: OrderRoutesOptions): FastifyPluginAsync {
  const {
    createOrderUseCase,
    getOrderUseCase,
    listUserOrdersUseCase,
    idempotencyService,
    tokenService,
  } = options;

  const authPreHandlers = tokenService ? [createAuthMiddleware(tokenService)] : [];

  return async function orderRoutes(fastify) {
    // POST /orders (Protected with JWT and required Idempotency-Key)
    fastify.post('/orders', { preHandler: authPreHandlers }, async (req, reply) => {
      const rawHeader = req.headers['idempotency-key'];
      const idempotencyKey =
        typeof rawHeader === 'string' ? rawHeader.trim() : undefined;

      if (!idempotencyKey) {
        throw new ValidationError('Header Idempotency-Key is required.', [
          { name: 'idempotency-key', reason: 'Header is missing or empty' },
        ]);
      }

      const body = createOrderBodySchema.parse(req.body);

      const result = await idempotencyService.process({
        key: idempotencyKey,
        userId: req.user!.id,
        requestPath: req.url,
        payload: body,
        action: async () => {
          const order = await createOrderUseCase.execute({
            userId: req.user!.id,
            holdId: body.holdId,
            holdIds: body.holdIds,
          });

          return {
            statusCode: 201,
            body: formatOrderResponse(order),
          };
        },
      });

      if (result.replayed) {
        reply.header('x-cache-lookup', 'HIT');
      }

      return reply.status(result.statusCode).send(result.body);
    });

    // GET /orders/:id (Protected with JWT and IDOR ownership check)
    fastify.get('/orders/:id', { preHandler: authPreHandlers }, async (req, reply) => {
      const params = getOrderParamsSchema.parse(req.params);
      const order = await getOrderUseCase.execute({
        orderId: params.id,
        userId: req.user!.id,
        userRole: req.user!.role,
      });

      return reply.status(200).send(formatOrderResponse(order));
    });

    // GET /orders (Protected with JWT, lists authenticated user orders)
    fastify.get('/orders', { preHandler: authPreHandlers }, async (req, reply) => {
      const orders = await listUserOrdersUseCase.execute({
        userId: req.user!.id,
      });

      return reply.status(200).send(orders.map(formatOrderResponse));
    });
  };
}
