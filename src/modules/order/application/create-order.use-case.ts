import type { Clock } from '../../../platform/clock/clock.js';
import type { IdGenerator } from '../../../platform/id/id-generator.js';
import {
  DEFAULT_ORDER_EXPIRATION_SECONDS,
  type OrderWithItems,
} from '../domain/order.entity.js';
import type { OrderRepositoryPort } from '../domain/order.repository.port.js';

export interface CreateOrderCommand {
  userId: string;
  holdId: string;
}

export class CreateOrderUseCase {
  constructor(
    private readonly orderRepository: OrderRepositoryPort,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: CreateOrderCommand): Promise<OrderWithItems> {
    const orderId = this.idGenerator.generate();
    const expiresAt = new Date(
      this.clock.now().getTime() + DEFAULT_ORDER_EXPIRATION_SECONDS * 1000,
    );

    return this.orderRepository.createOrderFromHold({
      orderId,
      userId: command.userId,
      holdId: command.holdId,
      expiresAt,
    });
  }
}
