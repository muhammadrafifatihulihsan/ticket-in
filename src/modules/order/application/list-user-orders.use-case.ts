import type { OrderWithItems } from '../domain/order.entity.js';
import type { OrderRepositoryPort } from '../domain/order.repository.port.js';

export interface ListUserOrdersQuery {
  userId: string;
}

export class ListUserOrdersUseCase {
  constructor(private readonly orderRepository: OrderRepositoryPort) {}

  async execute(query: ListUserOrdersQuery): Promise<OrderWithItems[]> {
    return this.orderRepository.findByUserId(query.userId);
  }
}
