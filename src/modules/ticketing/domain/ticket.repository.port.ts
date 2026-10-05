import type { Ticket, TicketStatus, TicketWithDetails } from './ticket.entity.js';

export interface IssueTicketItem {
  seatId: string;
}

export interface IssueTicketsParams {
  orderId: string;
  userId: string;
  items: IssueTicketItem[];
}

export interface TicketRepositoryPort {
  /**
   * Issues tickets for an order idempotently.
   * If tickets for this order already exist, returns existing tickets without creating duplicates.
   */
  issueTicketsForOrder(params: IssueTicketsParams): Promise<Ticket[]>;

  /**
   * Finds a ticket with full details (seat, category, event) by ID.
   */
  findById(ticketId: string): Promise<TicketWithDetails | null>;

  /**
   * Finds a ticket with full details by ticket code.
   */
  findByTicketCode(ticketCode: string): Promise<TicketWithDetails | null>;

  /**
   * Retrieves all tickets owned by a user with event and seat details.
   */
  findByUserId(userId: string): Promise<TicketWithDetails[]>;

  /**
   * Retrieves all tickets associated with an order ID.
   */
  findByOrderId(orderId: string): Promise<Ticket[]>;

  /**
   * Updates ticket status (e.g. from ISSUED to CHECKED_IN).
   */
  updateStatus(ticketId: string, status: TicketStatus): Promise<TicketWithDetails>;
}
