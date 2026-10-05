import { ForbiddenError, NotFoundError } from '../../../platform/errors/problem-details.js';
import type { TicketWithDetails } from '../domain/ticket.entity.js';
import type { TicketRepositoryPort } from '../domain/ticket.repository.port.js';

export interface GetTicketCommand {
  ticketId: string;
  requestingUserId: string;
  requestingRole?: string | undefined;
}

export class GetTicketUseCase {
  constructor(private readonly ticketRepository: TicketRepositoryPort) {}

  async execute(command: GetTicketCommand): Promise<TicketWithDetails> {
    const ticket = await this.ticketRepository.findById(command.ticketId);
    if (!ticket) {
      throw new NotFoundError('Ticket not found.');
    }

    const isAdmin = command.requestingRole === 'admin';
    const isOwner = ticket.userId === command.requestingUserId;

    if (!isAdmin && !isOwner) {
      throw new ForbiddenError('You are not authorized to access this ticket.');
    }

    return ticket;
  }
}
