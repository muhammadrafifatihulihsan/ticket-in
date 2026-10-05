import { v7 as uuidv7 } from 'uuid';
import { ConflictError, NotFoundError } from '../../../platform/errors/problem-details.js';
import {
  assertValidTicketTransition,
  generateTicketCode,
  type Ticket,
  type TicketStatus,
  type TicketWithDetails,
} from '../domain/ticket.entity.js';
import type {
  IssueTicketsParams,
  TicketRepositoryPort,
} from '../domain/ticket.repository.port.js';

export interface MockTicketMetadata {
  seatNumber?: string;
  seatCategoryName?: string;
  price?: number;
  eventId?: string;
  eventName?: string;
  eventDate?: Date;
  venue?: string;
}

export class InMemoryTicketRepository implements TicketRepositoryPort {
  private readonly tickets = new Map<string, Ticket>();
  private readonly seatMetadata = new Map<string, MockTicketMetadata>();
  private readonly issuingOrders = new Map<string, Promise<Ticket[]>>();

  setSeatMetadata(seatId: string, metadata: MockTicketMetadata): void {
    this.seatMetadata.set(seatId, metadata);
  }

  async issueTicketsForOrder(params: IssueTicketsParams): Promise<Ticket[]> {
    // 1. Idempotency: check if tickets for this order already exist
    const existing = await this.findByOrderId(params.orderId);
    if (existing.length > 0) {
      return existing;
    }

    // 2. Prevent race conditions: return in-flight promise if another caller is already issuing
    const inFlight = this.issuingOrders.get(params.orderId);
    if (inFlight) {
      return inFlight;
    }

    const issuePromise = (async () => {
      const recheck = await this.findByOrderId(params.orderId);
      if (recheck.length > 0) {
        return recheck;
      }

      const issuedTickets: Ticket[] = [];
      const now = new Date();

      for (const item of params.items) {
        const ticket: Ticket = {
          id: uuidv7(),
          orderId: params.orderId,
          seatId: item.seatId,
          userId: params.userId,
          ticketCode: generateTicketCode(now),
          status: 'ISSUED',
          issuedAt: now,
        };

        this.tickets.set(ticket.id, ticket);
        issuedTickets.push(ticket);
      }

      return issuedTickets;
    })();

    this.issuingOrders.set(params.orderId, issuePromise);
    try {
      return await issuePromise;
    } finally {
      this.issuingOrders.delete(params.orderId);
    }
  }

  async findById(ticketId: string): Promise<TicketWithDetails | null> {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      return null;
    }
    return this.enrichTicketDetails(ticket);
  }

  async findByTicketCode(ticketCode: string): Promise<TicketWithDetails | null> {
    for (const ticket of this.tickets.values()) {
      if (ticket.ticketCode === ticketCode) {
        return this.enrichTicketDetails(ticket);
      }
    }
    return null;
  }

  async findByUserId(userId: string): Promise<TicketWithDetails[]> {
    const userTickets: TicketWithDetails[] = [];
    for (const ticket of this.tickets.values()) {
      if (ticket.userId === userId) {
        userTickets.push(this.enrichTicketDetails(ticket));
      }
    }
    return userTickets;
  }

  async findByOrderId(orderId: string): Promise<Ticket[]> {
    const orderTickets: Ticket[] = [];
    for (const ticket of this.tickets.values()) {
      if (ticket.orderId === orderId) {
        orderTickets.push({ ...ticket });
      }
    }
    return orderTickets;
  }

  async updateStatus(ticketId: string, status: TicketStatus): Promise<TicketWithDetails> {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      throw new NotFoundError('Ticket not found.');
    }

    if (ticket.status === 'CHECKED_IN' && status === 'CHECKED_IN') {
      throw new ConflictError('Ticket has already been checked in.');
    }

    assertValidTicketTransition(ticket.status, status);
    ticket.status = status;
    this.tickets.set(ticketId, ticket);

    return this.enrichTicketDetails(ticket);
  }

  private enrichTicketDetails(ticket: Ticket): TicketWithDetails {
    const meta = this.seatMetadata.get(ticket.seatId) ?? {};
    return {
      ...ticket,
      seatNumber: meta.seatNumber ?? 'A-01',
      seatCategoryName: meta.seatCategoryName ?? 'VIP',
      price: meta.price ?? 1500000,
      eventId: meta.eventId ?? '018f0000-0000-7000-8000-000000000001',
      eventName: meta.eventName ?? 'Coldplay Live in Jakarta',
      eventDate: meta.eventDate ?? new Date('2026-11-15T19:00:00Z'),
      venue: meta.venue ?? 'Gelora Bung Karno Stadium',
    };
  }
}
