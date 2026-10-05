import { ForbiddenError, NotFoundError } from '../../../platform/errors/problem-details.js';
import type { OrderWithItems } from '../domain/order.entity.js';
import type { OrderRepositoryPort } from '../domain/order.repository.port.js';

export interface GetOrderQuery {
  orderId: string;
  userId: string;
  userRole: string;
}

export class GetOrderUseCase {
  constructor(private readonly orderRepository: OrderRepositoryPort) {}

  async execute(query: GetOrderQuery): Promise<OrderWithItems> {
    const order = await this.orderRepository.findById(query.orderId);
    if (!order) {
      throw new NotFoundError('Order not found.');
    }

    if (order.userId !== query.userId && query.userRole !== 'admin') {
      throw new ForbiddenError('You do not have access to this order.');
    }

    return order;
  }
}
