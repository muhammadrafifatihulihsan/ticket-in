/**
 * @file e2e-ticket-war.test.ts
 *
 * Phase 12 - Final End-to-End Ticket War Simulation & Invariant Verification
 *
 * Simulates the complete lifecycle of a concert ticket war:
 *   1. Registration & Authentication (identity module)
 *   2. Joining the Waiting Room Queue (waiting-room module)
 *   3. Batch Admission & Token Issue   (waiting-room module)
 *   4. Seat Hold                        (inventory module)
 *   5. Order Creation                   (order module)
 *   6. Payment Webhook (HMAC-signed)    (payment module)
 *   7. Async Ticket Issuance via Outbox/Inbox pipeline
 *   8. Ticket Retrieval                 (ticketing module)
 *   9. Gate Check-in                    (ticketing module)
 *
 * Business Invariants Verified:
 *   - Zero overselling
 *   - Zero duplicate tickets (inbox idempotency)
 *   - Quota enforcement (max 4 seats per user)
 *   - IDOR protection (users can only read own tickets)
 *   - Gate check-in idempotency (ConflictError on re-scan)
 *
 * Architecture: 100% in-memory - no network, no database, no Redis.
 * All cross-module wiring is done manually using production interfaces.
 */

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

// Platform
import { SystemClock } from '../../../src/platform/clock/clock.js';
import { ConflictError, ForbiddenError } from '../../../src/platform/errors/problem-details.js';
import { UuidV7Generator } from '../../../src/platform/id/id-generator.js';
import { InMemoryInboxRepository } from '../../../src/platform/inbox/in-memory-inbox.repository.js';
import { IdempotentInboxService } from '../../../src/platform/inbox/idempotent-inbox.service.js';
import type { KafkaEnvelope } from '../../../src/platform/messaging/kafka-client.interface.js';

// Identity
import { RegisterUseCase } from '../../../src/modules/identity/application/register.use-case.js';
import { LoginUseCase } from '../../../src/modules/identity/application/login.use-case.js';
import type { UserRepository } from '../../../src/modules/identity/application/ports/user.repository.port.js';
import type { PasswordHasher } from '../../../src/modules/identity/domain/password-hasher.port.js';
import type { User } from '../../../src/modules/identity/domain/user.entity.js';
import { JwtTokenService } from '../../../src/modules/identity/infrastructure/jwt-token-service.js';
import { InMemoryRefreshTokenRepository } from '../../../src/modules/identity/infrastructure/in-memory-refresh-token.repository.js';

// Waiting Room
import { JoinQueueUseCase } from '../../../src/modules/waiting-room/application/join-queue.use-case.js';
import { AdmitQueueUseCase } from '../../../src/modules/waiting-room/application/admit-queue.use-case.js';
import { InMemoryWaitingRoomRepository } from '../../../src/modules/waiting-room/infrastructure/in-memory-waiting-room.repository.js';
import { JwtAdmissionTokenService } from '../../../src/modules/waiting-room/infrastructure/jwt-admission-token.service.js';

// Inventory
import { HoldSpecificSeatsUseCase } from '../../../src/modules/inventory/application/hold-specific-seats.use-case.js';
import { InMemoryInventoryRepository } from '../../../src/modules/inventory/infrastructure/in-memory-inventory.repository.js';
import type { StoredSeat } from '../../../src/modules/inventory/infrastructure/in-memory-inventory.repository.js';
import { MAX_SEATS_PER_USER_PER_EVENT } from '../../../src/modules/inventory/domain/seat.entity.js';

// Order
import { CreateOrderUseCase } from '../../../src/modules/order/application/create-order.use-case.js';
import {
  InMemoryOrderRepository,
  type InMemoryHoldRecord,
  type InMemorySeatRecord,
} from '../../../src/modules/order/infrastructure/in-memory-order.repository.js';

// Payment
import { ProcessPaymentWebhookUseCase } from '../../../src/modules/payment/application/process-payment-webhook.use-case.js';
import { InMemoryPaymentRepository } from '../../../src/modules/payment/infrastructure/in-memory-payment.repository.js';
import { HmacSignatureService } from '../../../src/modules/payment/infrastructure/hmac-signature.service.js';

// Ticketing
import { IssueTicketsUseCase } from '../../../src/modules/ticketing/application/issue-tickets.use-case.js';
import { VerifyTicketUseCase } from '../../../src/modules/ticketing/application/verify-ticket.use-case.js';
import { ListUserTicketsUseCase } from '../../../src/modules/ticketing/application/list-user-tickets.use-case.js';
import { GetTicketUseCase } from '../../../src/modules/ticketing/application/get-ticket.use-case.js';
import {
  OrderPaidEventHandler,
  type OrderPaidPayload,
} from '../../../src/modules/ticketing/application/order-paid-event.handler.js';
import { InMemoryTicketRepository } from '../../../src/modules/ticketing/infrastructure/in-memory-ticket.repository.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** Lightweight in-process UserRepository – no DB required. */
class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();
  private readonly byEmail = new Map<string, User>();
  private readonly byUsername = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }
  async findByEmail(email: string): Promise<User | null> {
    return this.byEmail.get(email.toLowerCase()) ?? null;
  }
  async findByUsername(username: string): Promise<User | null> {
    return this.byUsername.get(username.toLowerCase()) ?? null;
  }
  async create(user: User): Promise<void> {
    this.byId.set(user.id, user);
    this.byEmail.set(user.email, user);
    this.byUsername.set(user.username, user);
  }
}

/** Plain-text hasher – avoids slow Argon2 in unit tests. */
class PlainPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> { return `hashed:${plain}`; }
  async verify(plain: string, hash: string): Promise<boolean> { return hash === `hashed:${plain}`; }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_ID          = '01935b30-0000-7000-8000-000000000001';
const CATEGORY_ID       = 'cat-vip-01';
const WEBHOOK_SECRET    = 'super-secret-webhook-hmac-key-for-tests-2026';
const JWT_ACCESS_SECRET = 'super-secret-access-token-key-which-is-long-enough';
const JWT_REFRESH_SECRET= 'super-secret-refresh-token-key-which-is-long-enough';
const WAITING_ROOM_SECRET = 'super-secret-waiting-room-jwt-key-which-is-long';
const TOTAL_SEATS       = 10;
const WAR_PARTICIPANTS  = 10;
const PASSWORD          = 'SecurePass@2026';

// ---------------------------------------------------------------------------
// TestSystem – wired in-memory
// ---------------------------------------------------------------------------

interface TestSystem {
  registerUseCase: RegisterUseCase;
  loginUseCase: LoginUseCase;
  tokenService: JwtTokenService;
  joinQueueUseCase: JoinQueueUseCase;
  admitQueueUseCase: AdmitQueueUseCase;
  admissionTokenService: JwtAdmissionTokenService;
  waitingRoomRepo: InMemoryWaitingRoomRepository;
  holdSpecificSeatsUseCase: HoldSpecificSeatsUseCase;
  inventoryRepo: InMemoryInventoryRepository;
  createOrderUseCase: CreateOrderUseCase;
  orderRepo: InMemoryOrderRepository;
  processWebhookUseCase: ProcessPaymentWebhookUseCase;
  hmacService: HmacSignatureService;
  issueTicketsUseCase: IssueTicketsUseCase;
  verifyTicketUseCase: VerifyTicketUseCase;
  listUserTicketsUseCase: ListUserTicketsUseCase;
  getTicketUseCase: GetTicketUseCase;
  orderPaidHandler: OrderPaidEventHandler;
  ticketRepo: InMemoryTicketRepository;
}

function buildSystem(): TestSystem {
  const clock  = new SystemClock();
  const idGen  = new UuidV7Generator();

  // Identity
  const userRepo         = new InMemoryUserRepository();
  const refreshTokenRepo = new InMemoryRefreshTokenRepository();
  const hasher           = new PlainPasswordHasher();
  const tokenService     = new JwtTokenService(JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, '15m', '7d');
  const registerUseCase  = new RegisterUseCase(userRepo, hasher, idGen, clock);
  const loginUseCase     = new LoginUseCase(userRepo, refreshTokenRepo, hasher, tokenService, idGen, clock);

  // Waiting Room
  const waitingRoomRepo      = new InMemoryWaitingRoomRepository();
  const admissionTokenService = new JwtAdmissionTokenService(WAITING_ROOM_SECRET);
  const joinQueueUseCase     = new JoinQueueUseCase(waitingRoomRepo, { admissionRate: 50, admissionIntervalMs: 5000 });
  const admitQueueUseCase    = new AdmitQueueUseCase(waitingRoomRepo, admissionTokenService, { defaultBatchSize: WAR_PARTICIPANTS, tokenTtlSeconds: 600 });

  // Inventory – seed 10 VIP seats
  const inventoryRepo = new InMemoryInventoryRepository();
  for (let i = 1; i <= TOTAL_SEATS; i++) {
    const seat: StoredSeat = {
      id: `seat-${String(i).padStart(3, '0')}`,
      eventId: EVENT_ID,
      categoryId: CATEGORY_ID,
      categoryName: 'VIP',
      seatNumber: `VIP-${String(i).padStart(2, '0')}`,
      price: 1_500_000,
      status: 'AVAILABLE',
      heldBy: null,
      expiresAt: null,
      version: 1,
    };
    inventoryRepo.addSeat(seat);
  }
  const holdSpecificSeatsUseCase = new HoldSpecificSeatsUseCase(inventoryRepo);

  // Order
  const orderRepo          = new InMemoryOrderRepository();
  const createOrderUseCase = new CreateOrderUseCase(orderRepo, idGen, clock);

  // Payment
  const paymentRepo         = new InMemoryPaymentRepository(orderRepo);
  const hmacService         = new HmacSignatureService(WEBHOOK_SECRET, clock);
  const processWebhookUseCase = new ProcessPaymentWebhookUseCase(paymentRepo, hmacService);

  // Ticketing
  const ticketRepo            = new InMemoryTicketRepository();
  const inboxRepo             = new InMemoryInboxRepository();
  const inboxService          = new IdempotentInboxService(inboxRepo);
  const issueTicketsUseCase   = new IssueTicketsUseCase(orderRepo, ticketRepo);
  const verifyTicketUseCase   = new VerifyTicketUseCase(ticketRepo);
  const listUserTicketsUseCase= new ListUserTicketsUseCase(ticketRepo);
  const getTicketUseCase      = new GetTicketUseCase(ticketRepo);
  const orderPaidHandler      = new OrderPaidEventHandler(issueTicketsUseCase, inboxService);

  return {
    registerUseCase, loginUseCase, tokenService,
    joinQueueUseCase, admitQueueUseCase, admissionTokenService, waitingRoomRepo,
    holdSpecificSeatsUseCase, inventoryRepo,
    createOrderUseCase, orderRepo,
    processWebhookUseCase, hmacService,
    issueTicketsUseCase, verifyTicketUseCase, listUserTicketsUseCase, getTicketUseCase,
    orderPaidHandler, ticketRepo,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function registerAndLogin(
  system: TestSystem,
  index: number,
  role: 'user' | 'organizer' | 'admin' = 'user',
): Promise<{ userId: string; accessToken: string }> {
  const email    = `participant${index}@ticketin.test`;
  const username = `participant${index}`;
  const registered = await system.registerUseCase.execute({ email, username, password: PASSWORD, role });
  const loggedIn   = await system.loginUseCase.execute({ identifier: email, password: PASSWORD });
  return { userId: registered.id, accessToken: loggedIn.tokens.accessToken };
}

async function simulatePaymentWebhook(system: TestSystem, orderId: string): Promise<void> {
  const timestamp    = Math.floor(Date.now() / 1000);
  const webhookPayload = { orderId, externalId: `ext-${randomUUID()}`, status: 'SUCCESS' as const, amount: 1_500_000, timestamp };
  const signature    = system.hmacService.generateSignature(webhookPayload, timestamp);
  await system.processWebhookUseCase.execute({ signature, timestamp, payload: webhookPayload });
}

async function dispatchOutboxEvent(system: TestSystem, orderId: string, userId: string): Promise<void> {
  const envelope: KafkaEnvelope<OrderPaidPayload> = {
    id: `outbox-${orderId}`,
    eventType: 'order.paid',
    aggregateType: 'ORDER',
    aggregateId: orderId,
    payload: { orderId, userId },
    timestamp: new Date().toISOString(),
  };
  await system.orderPaidHandler.handle(envelope);
}

/** Bridge: populate InMemoryOrderRepository with a hold+seat from the inventory layer. */
function bridgeHoldToOrder(
  sys: TestSystem,
  holdId: string,
  userId: string,
  seatId: string,
  expiresAt: Date,
): void {
  const invSeat = (sys.inventoryRepo as any)['seats'].find((s: StoredSeat) => s.id === seatId)!;
  const orderHold: InMemoryHoldRecord = {
    id: holdId, userId, eventId: EVENT_ID,
    status: 'ACTIVE', expiresAt, seatIds: [seatId],
  };
  const orderSeat: InMemorySeatRecord = {
    id: invSeat.id, eventId: invSeat.eventId, seatNumber: invSeat.seatNumber,
    categoryName: invSeat.categoryName, price: invSeat.price, status: 'HELD',
  };
  sys.orderRepo.setHold(orderHold);
  sys.orderRepo.setSeat(orderSeat);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 12 - End-to-End Ticket War Simulation', () => {
  let sys: TestSystem;

  beforeEach(() => {
    sys = buildSystem();
  });

  // -------------------------------------------------------------------------
  // Scenario 1: Happy-path single user - full lifecycle
  // -------------------------------------------------------------------------
  describe('Scenario 1: Single-user full lifecycle (Register to CheckIn)', () => {
    it('completes the entire ticket journey end-to-end for one user', async () => {
      // 1. Register & Login
      const { userId, accessToken } = await registerAndLogin(sys, 1);
      const jwtPayload = sys.tokenService.verifyAccessToken(accessToken);
      expect(jwtPayload.sub).toBe(userId);

      // 2. Join waiting room queue
      const queuePos = await sys.joinQueueUseCase.execute(EVENT_ID, userId);
      expect(queuePos.status).toBe('QUEUED');
      expect(queuePos.rank).toBe(1);

      // 3. Admit user (organizer batch admission)
      const admitResult = await sys.admitQueueUseCase.execute(EVENT_ID, 10);
      expect(admitResult.admittedCount).toBeGreaterThanOrEqual(1);
      expect(admitResult.userIds).toContain(userId);

      const admittedStatus = await sys.waitingRoomRepo.getQueueStatus(EVENT_ID, userId);
      expect(admittedStatus.status).toBe('ADMITTED');
      const admissionToken = admittedStatus.admissionToken!;
      expect(typeof admissionToken).toBe('string');

      const tokenPayload = sys.admissionTokenService.verifyToken(admissionToken, EVENT_ID, userId);
      expect(tokenPayload.sub).toBe(userId);
      expect(tokenPayload.eventId).toBe(EVENT_ID);

      // 4. Hold a seat
      const holdResult = await sys.holdSpecificSeatsUseCase.execute({
        eventId: EVENT_ID, userId, seatIds: ['seat-001'],
      });
      expect(holdResult.holds).toHaveLength(1);
      const hold = holdResult.holds[0]!;
      expect(hold.userId).toBe(userId);
      expect(hold.status).toBe('ACTIVE');

      // 5. Create order
      bridgeHoldToOrder(sys, hold.id, userId, 'seat-001', hold.expiresAt);
      const order = await sys.createOrderUseCase.execute({ userId, holdId: hold.id });
      expect(order.status).toBe('PENDING');
      expect(order.items).toHaveLength(1);
      expect(order.items[0]!.seatId).toBe('seat-001');

      // 6. Payment webhook (SUCCESS)
      await simulatePaymentWebhook(sys, order.id);
      const paidOrder = await sys.orderRepo.findById(order.id);
      expect(paidOrder!.status).toBe('PAID');

      // 7. Async ticket issuance via Outbox -> Inbox
      await dispatchOutboxEvent(sys, order.id, userId);
      const tickets = await sys.ticketRepo.findByOrderId(order.id);
      expect(tickets).toHaveLength(1);
      expect(tickets[0]!.status).toBe('ISSUED');
      expect(tickets[0]!.userId).toBe(userId);
      expect(tickets[0]!.seatId).toBe('seat-001');
      expect(tickets[0]!.ticketCode).toMatch(/^TIX-\d{8}-[0-9A-F]{10}$/);

      // 8. User retrieves their tickets
      const userTickets = await sys.listUserTicketsUseCase.execute({ userId });
      expect(userTickets).toHaveLength(1);
      expect(userTickets[0]!.id).toBe(tickets[0]!.id);

      // 9. Get individual ticket (IDOR: own ticket accessible)
      const fetchedTicket = await sys.getTicketUseCase.execute({ ticketId: tickets[0]!.id, requestingUserId: userId });
      expect(fetchedTicket).not.toBeNull();
      expect(fetchedTicket!.id).toBe(tickets[0]!.id);

      // 10. Organizer gate check-in
      const checkedIn = await sys.verifyTicketUseCase.execute({
        ticketIdOrCode: tickets[0]!.id, verifierRole: 'organizer',
      });
      expect(checkedIn.status).toBe('CHECKED_IN');

      const finalTicket = await sys.ticketRepo.findById(tickets[0]!.id);
      expect(finalTicket!.status).toBe('CHECKED_IN');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Concurrent ticket war – 10 participants vs 10 seats
  // -------------------------------------------------------------------------
  describe('Scenario 2: Concurrent ticket war - 10 participants race for 10 seats', () => {
    it('allocates every seat exactly once (zero overselling)', async () => {
      const participants = await Promise.all(
        Array.from({ length: WAR_PARTICIPANTS }, (_, i) => registerAndLogin(sys, i + 1)),
      );

      await Promise.all(participants.map(({ userId }) => sys.joinQueueUseCase.execute(EVENT_ID, userId)));
      await sys.admitQueueUseCase.execute(EVENT_ID, WAR_PARTICIPANTS);

      const seatIds = Array.from({ length: TOTAL_SEATS }, (_, i) => `seat-${String(i + 1).padStart(3, '0')}`);

      const holdResults = await Promise.allSettled(
        participants.map(({ userId }, idx) =>
          sys.holdSpecificSeatsUseCase.execute({ eventId: EVENT_ID, userId, seatIds: [seatIds[idx]!] }),
        ),
      );
      expect(holdResults.filter((r) => r.status === 'fulfilled')).toHaveLength(WAR_PARTICIPANTS);

      type PCtx = { userId: string; holdId: string; seatId: string; orderId?: string; ticketId?: string };
      const contexts: PCtx[] = participants.map(({ userId }, idx) => {
        const r = holdResults[idx];
        if (!r || r.status !== 'fulfilled') throw new Error('Hold unexpectedly failed');
        const hold = r.value.holds[0]!;
        return { userId, holdId: hold.id, seatId: hold.seatId };
      });

      for (const ctx of contexts) {
        bridgeHoldToOrder(sys, ctx.holdId, ctx.userId, ctx.seatId, new Date(Date.now() + 600_000));
      }

      const orderResults = await Promise.all(
        contexts.map((ctx) => sys.createOrderUseCase.execute({ userId: ctx.userId, holdId: ctx.holdId })),
      );
      for (let i = 0; i < contexts.length; i++) contexts[i]!.orderId = orderResults[i]!.id;

      await Promise.all(contexts.map((ctx) => simulatePaymentWebhook(sys, ctx.orderId!)));

      const paidOrders = await Promise.all(contexts.map((ctx) => sys.orderRepo.findById(ctx.orderId!)));
      for (const o of paidOrders) expect(o!.status).toBe('PAID');

      await Promise.all(contexts.map((ctx) => dispatchOutboxEvent(sys, ctx.orderId!, ctx.userId)));

      const allTicketLists = await Promise.all(contexts.map((ctx) => sys.ticketRepo.findByOrderId(ctx.orderId!)));
      const allTickets = allTicketLists.flat();

      // Invariant 1: Zero overselling
      expect(allTickets).toHaveLength(WAR_PARTICIPANTS);
      const uniqueSeatIds = new Set(allTickets.map((t) => t.seatId));
      expect(uniqueSeatIds.size).toBe(WAR_PARTICIPANTS);

      // Invariant 2: Zero duplicate tickets
      expect(new Set(allTickets.map((t) => t.id)).size).toBe(WAR_PARTICIPANTS);
      expect(new Set(allTickets.map((t) => t.ticketCode)).size).toBe(WAR_PARTICIPANTS);

      // Invariant 3: Quota enforcement
      for (const ctx of contexts) {
        const ut = await sys.listUserTicketsUseCase.execute({ userId: ctx.userId });
        expect(ut).toHaveLength(1);
        expect(ut.length).toBeLessThanOrEqual(MAX_SEATS_PER_USER_PER_EVENT);
      }

      // Gate check-in for all participants
      for (let i = 0; i < contexts.length; i++) contexts[i]!.ticketId = allTicketLists[i]![0]!.id;
      const checkIns = await Promise.all(
        contexts.map((ctx) =>
          sys.verifyTicketUseCase.execute({ ticketIdOrCode: ctx.ticketId!, verifierRole: 'organizer' }),
        ),
      );
      for (const ci of checkIns) expect(ci.status).toBe('CHECKED_IN');

      // All seats ended up SOLD
      for (const ctx of contexts) {
        const s = sys.orderRepo.getSeat(ctx.seatId);
        expect(s!.status).toBe('SOLD');
      }
    });

    it('issues 0 extra tickets when duplicate order.paid events arrive (inbox idempotency)', async () => {
      const { userId } = await registerAndLogin(sys, 100);
      await sys.joinQueueUseCase.execute(EVENT_ID, userId);
      await sys.admitQueueUseCase.execute(EVENT_ID, 10);

      const holdResult = await sys.holdSpecificSeatsUseCase.execute({ eventId: EVENT_ID, userId, seatIds: ['seat-001'] });
      const hold = holdResult.holds[0]!;
      bridgeHoldToOrder(sys, hold.id, userId, 'seat-001', hold.expiresAt);

      const order = await sys.createOrderUseCase.execute({ userId, holdId: hold.id });
      await simulatePaymentWebhook(sys, order.id);

      const envelope: KafkaEnvelope<OrderPaidPayload> = {
        id: `dup-event-${order.id}`,
        eventType: 'order.paid',
        aggregateType: 'ORDER',
        aggregateId: order.id,
        payload: { orderId: order.id, userId },
        timestamp: new Date().toISOString(),
      };

      // First delivery -> tickets issued
      const first = await sys.orderPaidHandler.handle(envelope);
      expect(first.executed).toBe(true);
      expect(await sys.ticketRepo.findByOrderId(order.id)).toHaveLength(1);

      // Second delivery -> skipped
      const second = await sys.orderPaidHandler.handle(envelope);
      expect(second.executed).toBe(false);
      expect(await sys.ticketRepo.findByOrderId(order.id)).toHaveLength(1);

      // 20 concurrent duplicates -> still 1 ticket
      await Promise.all(Array.from({ length: 20 }, () => sys.orderPaidHandler.handle(envelope)));
      expect(await sys.ticketRepo.findByOrderId(order.id)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Quota enforcement – max 4 seats per user
  // -------------------------------------------------------------------------
  describe('Scenario 3: Quota enforcement - max 4 seats per user per event', () => {
    it('rejects a hold request when the user already has 4 active holds', async () => {
      const { userId } = await registerAndLogin(sys, 200);
      await sys.joinQueueUseCase.execute(EVENT_ID, userId);
      await sys.admitQueueUseCase.execute(EVENT_ID, 10);

      const batch = await sys.holdSpecificSeatsUseCase.execute({
        eventId: EVENT_ID, userId,
        seatIds: ['seat-001', 'seat-002', 'seat-003', 'seat-004'],
      });
      expect(batch.holds).toHaveLength(4);

      await expect(
        sys.holdSpecificSeatsUseCase.execute({ eventId: EVENT_ID, userId, seatIds: ['seat-005'] }),
      ).rejects.toThrow(/exceeds the maximum limit/);
    });

    it('prevents holding more than MAX_SEATS_PER_USER_PER_EVENT in a single request', async () => {
      const { userId } = await registerAndLogin(sys, 201);
      await sys.joinQueueUseCase.execute(EVENT_ID, userId);
      await sys.admitQueueUseCase.execute(EVENT_ID, 10);

      await expect(
        sys.holdSpecificSeatsUseCase.execute({
          eventId: EVENT_ID, userId,
          seatIds: ['seat-001', 'seat-002', 'seat-003', 'seat-004', 'seat-005'],
        }),
      ).rejects.toThrow(/Cannot reserve more than/);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: IDOR protection
  // -------------------------------------------------------------------------
  describe('Scenario 4: IDOR protection - ticket ownership enforcement', () => {
    it('returns null when a different user requests a ticket they do not own', async () => {
      const owner    = await registerAndLogin(sys, 300);
      const intruder = await registerAndLogin(sys, 301);

      await sys.joinQueueUseCase.execute(EVENT_ID, owner.userId);
      await sys.admitQueueUseCase.execute(EVENT_ID, 10);

      const holdResult = await sys.holdSpecificSeatsUseCase.execute({
        eventId: EVENT_ID, userId: owner.userId, seatIds: ['seat-001'],
      });
      const hold = holdResult.holds[0]!;
      bridgeHoldToOrder(sys, hold.id, owner.userId, 'seat-001', hold.expiresAt);

      const order = await sys.createOrderUseCase.execute({ userId: owner.userId, holdId: hold.id });
      await simulatePaymentWebhook(sys, order.id);
      await dispatchOutboxEvent(sys, order.id, owner.userId);

      const ownerTickets = await sys.listUserTicketsUseCase.execute({ userId: owner.userId });
      expect(ownerTickets).toHaveLength(1);
      const ticketId = ownerTickets[0]!.id;

      // Owner can read own ticket
      const ownedTicket = await sys.getTicketUseCase.execute({ ticketId, requestingUserId: owner.userId });
      expect(ownedTicket).not.toBeNull();
      expect(ownedTicket!.userId).toBe(owner.userId);

      // Intruder gets ForbiddenError (IDOR blocked)
      await expect(
        sys.getTicketUseCase.execute({ ticketId, requestingUserId: intruder.userId }),
      ).rejects.toThrow(ForbiddenError);

      // Intruder ticket list is empty
      const intruderTickets = await sys.listUserTicketsUseCase.execute({ userId: intruder.userId });
      expect(intruderTickets).toHaveLength(0);
    });

    it('prevents a plain user role from checking in tickets (role guard)', async () => {
      const owner = await registerAndLogin(sys, 302);
      await sys.joinQueueUseCase.execute(EVENT_ID, owner.userId);
      await sys.admitQueueUseCase.execute(EVENT_ID, 10);

      const holdResult = await sys.holdSpecificSeatsUseCase.execute({
        eventId: EVENT_ID, userId: owner.userId, seatIds: ['seat-001'],
      });
      const hold = holdResult.holds[0]!;
      bridgeHoldToOrder(sys, hold.id, owner.userId, 'seat-001', hold.expiresAt);

      const order = await sys.createOrderUseCase.execute({ userId: owner.userId, holdId: hold.id });
      await simulatePaymentWebhook(sys, order.id);
      await dispatchOutboxEvent(sys, order.id, owner.userId);

      const tickets = await sys.ticketRepo.findByOrderId(order.id);
      const ticketId = tickets[0]!.id;

      // 'user' role is blocked
      await expect(
        sys.verifyTicketUseCase.execute({ ticketIdOrCode: ticketId, verifierRole: 'user' }),
      ).rejects.toThrow(ForbiddenError);

      // 'organizer' role succeeds
      const checkedIn = await sys.verifyTicketUseCase.execute({ ticketIdOrCode: ticketId, verifierRole: 'organizer' });
      expect(checkedIn.status).toBe('CHECKED_IN');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Double check-in prevention
  // -------------------------------------------------------------------------
  describe('Scenario 5: Double check-in prevention at the gate', () => {
    it('throws ConflictError when the same ticket is scanned a second time', async () => {
      const { userId } = await registerAndLogin(sys, 400);
      await sys.joinQueueUseCase.execute(EVENT_ID, userId);
      await sys.admitQueueUseCase.execute(EVENT_ID, 10);

      const holdResult = await sys.holdSpecificSeatsUseCase.execute({ eventId: EVENT_ID, userId, seatIds: ['seat-001'] });
      const hold = holdResult.holds[0]!;
      bridgeHoldToOrder(sys, hold.id, userId, 'seat-001', hold.expiresAt);

      const order = await sys.createOrderUseCase.execute({ userId, holdId: hold.id });
      await simulatePaymentWebhook(sys, order.id);
      await dispatchOutboxEvent(sys, order.id, userId);

      const tickets = await sys.ticketRepo.findByOrderId(order.id);
      const ticketId = tickets[0]!.id;

      // First scan succeeds
      const first = await sys.verifyTicketUseCase.execute({ ticketIdOrCode: ticketId, verifierRole: 'organizer' });
      expect(first.status).toBe('CHECKED_IN');

      // Second scan throws ConflictError
      await expect(
        sys.verifyTicketUseCase.execute({ ticketIdOrCode: ticketId, verifierRole: 'organizer' }),
      ).rejects.toThrow(ConflictError);

      // 10 concurrent duplicate scans – all rejected
      const scans = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          sys.verifyTicketUseCase.execute({ ticketIdOrCode: ticketId, verifierRole: 'organizer' }),
        ),
      );
      expect(scans.filter((r) => r.status === 'rejected')).toHaveLength(10);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: No-show – ticket stays ISSUED
  // -------------------------------------------------------------------------
  describe('Scenario 6: Issued ticket remains accessible without check-in (no-show)', () => {
    it('keeps the ticket in ISSUED state until explicitly verified', async () => {
      const { userId } = await registerAndLogin(sys, 500);
      await sys.joinQueueUseCase.execute(EVENT_ID, userId);
      await sys.admitQueueUseCase.execute(EVENT_ID, 10);

      const holdResult = await sys.holdSpecificSeatsUseCase.execute({ eventId: EVENT_ID, userId, seatIds: ['seat-001'] });
      const hold = holdResult.holds[0]!;
      bridgeHoldToOrder(sys, hold.id, userId, 'seat-001', hold.expiresAt);

      const order = await sys.createOrderUseCase.execute({ userId, holdId: hold.id });
      await simulatePaymentWebhook(sys, order.id);
      await dispatchOutboxEvent(sys, order.id, userId);

      const tickets = await sys.listUserTicketsUseCase.execute({ userId });
      expect(tickets).toHaveLength(1);
      expect(tickets[0]!.status).toBe('ISSUED');

      const fetched = await sys.getTicketUseCase.execute({ ticketId: tickets[0]!.id, requestingUserId: userId });
      expect(fetched).not.toBeNull();
      expect(fetched!.status).toBe('ISSUED');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Failed payment – no ticket issued
  // -------------------------------------------------------------------------
  describe('Scenario 7: Failed payment produces no ticket', () => {
    it('does not issue tickets when the payment webhook reports FAILED', async () => {
      const { userId } = await registerAndLogin(sys, 600);
      await sys.joinQueueUseCase.execute(EVENT_ID, userId);
      await sys.admitQueueUseCase.execute(EVENT_ID, 10);

      const holdResult = await sys.holdSpecificSeatsUseCase.execute({ eventId: EVENT_ID, userId, seatIds: ['seat-001'] });
      const hold = holdResult.holds[0]!;
      bridgeHoldToOrder(sys, hold.id, userId, 'seat-001', hold.expiresAt);

      const order = await sys.createOrderUseCase.execute({ userId, holdId: hold.id });

      // Simulate FAILED payment webhook
      const localClock = new SystemClock();
      const localHmac  = new HmacSignatureService(WEBHOOK_SECRET, localClock);
      const timestamp  = Math.floor(Date.now() / 1000);
      const failedPayload = { orderId: order.id, externalId: `ext-failed-${randomUUID()}`, status: 'FAILED' as const, timestamp };
      const sig = localHmac.generateSignature(failedPayload, timestamp);
      await sys.processWebhookUseCase.execute({ signature: sig, timestamp, payload: failedPayload });

      const cancelledOrder = await sys.orderRepo.findById(order.id);
      expect(cancelledOrder!.status).toBe('CANCELLED');

      // No tickets for a cancelled order (IssueTicketsUseCase guards non-PAID orders)
      const tickets = await sys.ticketRepo.findByOrderId(order.id);
      expect(tickets).toHaveLength(0);
    });
  });
});