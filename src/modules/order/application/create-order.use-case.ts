import type { Clock } from '../../../platform/clock/clock.js';
import { ValidationError } from '../../../platform/errors/problem-details.js';
import type { IdGenerator } from '../../../platform/id/id-generator.js';
import {
  DEFAULT_ORDER_EXPIRATION_SECONDS,
  type OrderWithItems,
} from '../domain/order.entity.js';
import type { OrderRepositoryPort } from '../domain/order.repository.port.js';

export interface CreateOrderCommand {
  userId: string;
  holdId?: string | undefined;
  holdIds?: string[] | undefined;
}

export class CreateOrderUseCase {
  constructor(
    private readonly orderRepository: OrderRepositoryPort,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: CreateOrderCommand): Promise<OrderWithItems> {
    const targetHoldIds = command.holdIds ?? (command.holdId ? [command.holdId] : []);
    if (targetHoldIds.length === 0) {
      throw new ValidationError('Either holdId or holdIds must be provided.');
    }

    const orderId = this.idGenerator.generate();
    const expiresAt = new Date(
      this.clock.now().getTime() + DEFAULT_ORDER_EXPIRATION_SECONDS * 1000,
    );

    return this.orderRepository.createOrderFromHold({
      orderId,
      userId: command.userId,
      holdId: command.holdId,
      holdIds: command.holdIds,
      expiresAt,
    });
  }
}
