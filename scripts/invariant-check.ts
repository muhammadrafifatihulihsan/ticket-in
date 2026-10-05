/**
 * @file invariant-check.ts
 *
 * Database Invariant Checker – ticket-in platform
 *
 * Validates the following four business invariants post-load:
 *   1. Zero Overselling    – No seat has more than one ISSUED ticket.
 *   2. Zero Orphan Holds   – No ACTIVE hold is expired beyond grace period.
 *   3. Paid Order Tickets  – Every PAID order has at least one ISSUED ticket.
 *   4. Financial Balance   – Issued ticket totals match PAID order totals.
 *
 * Exit codes:
 *   0 – All invariants pass.
 *   1 – One or more invariants violated (details logged to stderr).
 *
 * Usage:
 *   pnpm db:check-invariants
 *   tsx scripts/invariant-check.ts
 */

import { and, count, eq, lt, sql } from 'drizzle-orm';
import { db } from '../src/platform/db/client.js';
import { orderItems, orders, seatHolds, tickets } from '../src/platform/db/schema.js';

/* -------------------------------------------------------------------------- */
/* Types                                                                        */
/* -------------------------------------------------------------------------- */

interface InvariantResult {
  name: string;
  passed: boolean;
  detail: string;
  violationCount?: number;
}

/* -------------------------------------------------------------------------- */
/* Invariant Checks                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Invariant 1: Zero Overselling
 * No seat_id should appear on more than one ISSUED or CHECKED_IN ticket.
 */
async function checkZeroOverselling(): Promise<InvariantResult> {
  const rows = await db
    .select({ seatId: tickets.seatId, cnt: count(tickets.id).as('cnt') })
    .from(tickets)
    .where(sql`${tickets.status} IN ('ISSUED', 'CHECKED_IN')`)
    .groupBy(tickets.seatId)
    .having(sql`COUNT(${tickets.id}) > 1`);

  const passed = rows.length === 0;
  return {
    name: 'Zero Overselling',
    passed,
    violationCount: rows.length,
    detail: passed
      ? 'No seat has been issued more than once.'
      : `${rows.length} seat(s) have duplicate active tickets: ${rows.map((r) => r.seatId).join(', ')}`,
  };
}

/**
 * Invariant 2: Zero Orphan Holds
 * No seat_holds row with status ACTIVE should have expires_at older than
 * (NOW() - 30 seconds grace period).
 */
async function checkZeroOrphanHolds(): Promise<InvariantResult> {
  const gracePeriod = new Date(Date.now() - 30_000);

  const rows = await db
    .select({ id: seatHolds.id, expiresAt: seatHolds.expiresAt })
    .from(seatHolds)
    .where(and(eq(seatHolds.status, 'ACTIVE'), lt(seatHolds.expiresAt, gracePeriod)));

  const passed = rows.length === 0;
  return {
    name: 'Zero Orphan Holds',
    passed,
    violationCount: rows.length,
    detail: passed
      ? 'No orphan seat holds found.'
      : `${rows.length} active hold(s) are expired beyond the grace period.`,
  };
}

/**
 * Invariant 3: Consistency of Paid Orders
 * Every order with status PAID must have at least one associated ticket
 * with status ISSUED or CHECKED_IN.
 */
async function checkPaidOrdersHaveTickets(): Promise<InvariantResult> {
  const paidOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.status, 'PAID'));

  if (paidOrders.length === 0) {
    return {
      name: 'Paid Order Ticket Consistency',
      passed: true,
      detail: 'No PAID orders found to verify.',
    };
  }

  const violations: string[] = [];
  for (const order of paidOrders) {
    const ticketRows = await db
      .select({ cnt: count(tickets.id).as('cnt') })
      .from(tickets)
      .where(
        and(eq(tickets.orderId, order.id), sql`${tickets.status} IN ('ISSUED', 'CHECKED_IN')`),
      );
    const ticketCount = Number(ticketRows[0]?.cnt ?? 0);
    if (ticketCount === 0) {
      violations.push(order.id);
    }
  }

  const passed = violations.length === 0;
  return {
    name: 'Paid Order Ticket Consistency',
    passed,
    violationCount: violations.length,
    detail: passed
      ? `All ${paidOrders.length} PAID order(s) have issued tickets.`
      : `${violations.length} PAID order(s) have no issued tickets: ${violations.join(', ')}`,
  };
}

/**
 * Invariant 4: Financial Balance
 * The sum of ticket prices for each PAID order must equal the order total.
 * Compares tickets.price (IDR integer) vs orders.totalAmount.
 */
async function checkFinancialBalance(): Promise<InvariantResult> {
  const paidOrders = await db
    .select({ id: orders.id, totalAmount: orders.totalAmount })
    .from(orders)
    .where(eq(orders.status, 'PAID'));

  if (paidOrders.length === 0) {
    return {
      name: 'Financial Balance',
      passed: true,
      detail: 'No PAID orders to verify financial balance.',
    };
  }

  const violations: string[] = [];
  for (const order of paidOrders) {
    const ticketTotals = await db
      .select({ total: sql<number>`COALESCE(SUM(${orderItems.price}), 0)` })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    const ticketTotal = Number(ticketTotals[0]?.total ?? 0);
    const orderTotal = Number(order.totalAmount ?? 0);
    if (ticketTotal !== orderTotal) {
      violations.push(`${order.id} (expected ${orderTotal}, got ${ticketTotal})`);
    }
  }

  const passed = violations.length === 0;
  return {
    name: 'Financial Balance',
    passed,
    violationCount: violations.length,
    detail: passed
      ? `Financial balance verified across ${paidOrders.length} PAID order(s).`
      : `${violations.length} order(s) have mismatched financials: ${violations.join('; ')}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                       */
/* -------------------------------------------------------------------------- */

async function runInvariantCheck(): Promise<void> {
  console.info('\n  ticket-in Database Invariant Checker');
  console.info('  =====================================\n');

  const checks: Array<() => Promise<InvariantResult>> = [
    checkZeroOverselling,
    checkZeroOrphanHolds,
    checkPaidOrdersHaveTickets,
    checkFinancialBalance,
  ];

  const results: InvariantResult[] = [];
  for (const check of checks) {
    try {
      const result = await check();
      results.push(result);
    } catch (err) {
      results.push({
        name: 'Unknown',
        passed: false,
        detail: `Check threw an error: ${String(err)}`,
      });
    }
  }

  let allPassed = true;
  for (const result of results) {
    const icon = result.passed ? '  PASS' : '  FAIL';
    const color = result.passed ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    console.info(`${color}${icon}${reset}  [${result.name}]`);
    console.info(`        ${result.detail}\n`);
    if (!result.passed) allPassed = false;
  }

  console.info('  =====================================');
  if (allPassed) {
    console.info('\x1b[32m  All invariants PASSED.\x1b[0m\n');
    process.exit(0);
  } else {
    console.error(
      '\x1b[31m  One or more invariants FAILED. Data integrity is compromised.\x1b[0m\n',
    );
    process.exit(1);
  }
}

runInvariantCheck().catch((err) => {
  console.error('Fatal error during invariant check:', err);
  process.exit(1);
});
