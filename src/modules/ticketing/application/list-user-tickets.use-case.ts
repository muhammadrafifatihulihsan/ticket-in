import type { TicketWithDetails } from '../domain/ticket.entity.js';
import type { TicketRepositoryPort } from '../domain/ticket.repository.port.js';

export interface ListUserTicketsCommand {
  userId: string;
}

export class ListUserTicketsUseCase {
  constructor(private readonly ticketRepository: TicketRepositoryPort) {}

  async execute(command: ListUserTicketsCommand): Promise<TicketWithDetails[]> {
    return this.ticketRepository.findByUserId(command.userId);
  }
}
