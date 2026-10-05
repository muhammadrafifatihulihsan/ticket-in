import {
  InvalidStateTransitionError,
  NotFoundError,
} from '../../../platform/errors/problem-details.js';
import type { OrderRepositoryPort } from '../../order/index.js';
import type { Ticket } from '../domain/ticket.entity.js';
import type { TicketRepositoryPort } from '../domain/ticket.repository.port.js';

export interface IssueTicketsCommand {
  orderId: string;
}

export class IssueTicketsUseCase {
  constructor(
    private readonly orderRepository: OrderRepositoryPort,
    private readonly ticketRepository: TicketRepositoryPort,
  ) {}

  async execute(command: IssueTicketsCommand): Promise<Ticket[]> {
    const order = await this.orderRepository.findById(command.orderId);
    if (!order) {
      throw new NotFoundError('Order not found.');
    }

    if (order.status !== 'PAID') {
      throw new InvalidStateTransitionError(
        `Cannot issue tickets for order with status '${order.status}'. Order must be PAID.`,
      );
    }

    return this.ticketRepository.issueTicketsForOrder({
      orderId: order.id,
      userId: order.userId,
      items: order.items.map((item) => ({ seatId: item.seatId })),
    });
  }
}
