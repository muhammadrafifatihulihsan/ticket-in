import type { Clock } from '../../../platform/clock/clock.js';
import type { OrderRepositoryPort } from '../domain/order.repository.port.js';

export interface CancelExpiredOrdersCommand {
  now?: Date | undefined;
}

export class CancelExpiredOrdersUseCase {
  constructor(
    private readonly orderRepository: OrderRepositoryPort,
    private readonly clock: Clock,
  ) {}

  async execute(command: CancelExpiredOrdersCommand = {}): Promise<{ cancelledCount: number }> {
    const referenceTime = command.now ?? this.clock.now();
    const cancelledCount = await this.orderRepository.cancelExpiredOrders(referenceTime);
    return { cancelledCount };
  }
}
