import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
} from '../../../platform/errors/problem-details.js';
import type { TicketWithDetails } from '../domain/ticket.entity.js';
import type { TicketRepositoryPort } from '../domain/ticket.repository.port.js';

export interface VerifyTicketCommand {
  ticketIdOrCode: string;
  verifierRole: string;
}

export class VerifyTicketUseCase {
  constructor(private readonly ticketRepository: TicketRepositoryPort) {}

  async execute(command: VerifyTicketCommand): Promise<TicketWithDetails> {
    if (command.verifierRole !== 'organizer' && command.verifierRole !== 'admin') {
      throw new ForbiddenError('Only event organizers and admins can verify tickets.');
    }

    let ticket = await this.ticketRepository.findById(command.ticketIdOrCode);
    if (!ticket) {
      ticket = await this.ticketRepository.findByTicketCode(command.ticketIdOrCode);
    }

    if (!ticket) {
      throw new NotFoundError('Ticket not found.');
    }

    if (ticket.status === 'CHECKED_IN') {
      throw new ConflictError('Ticket has already been checked in.');
    }

    if (ticket.status === 'CANCELLED' || ticket.status === 'REFUNDED') {
      throw new InvalidStateTransitionError(
        `Cannot check in a ticket with status '${ticket.status}'.`,
      );
    }

    return this.ticketRepository.updateStatus(ticket.id, 'CHECKED_IN');
  }
}
