import type { OrderStatus, OrderWithItems } from './order.entity.js';

export interface CreateOrderParams {
  orderId: string;
  userId: string;
  holdId?: string | undefined;
  holdIds?: string[] | undefined;
  expiresAt: Date;
}

export interface OrderRepositoryPort {
  /**
   * Atomically verifies the hold (ACTIVE, unexpired, owned by user),
   * transitions hold status to CONVERTED_TO_ORDER,
   * transitions seats from HELD to RESERVED,
   * creates the order and order_items records,
   * and inserts an outbox event 'order.created'.
   */
  createOrderFromHold(params: CreateOrderParams): Promise<OrderWithItems>;

  /**
   * Finds an order with its items by ID.
   */
  findById(orderId: string): Promise<OrderWithItems | null>;

  /**
   * Finds all orders belonging to a specific user, ordered newest first.
   */
  findByUserId(userId: string): Promise<OrderWithItems[]>;

  /**
   * Cancels orders that have passed their expiration timestamp.
   * Releases associated seats back to AVAILABLE.
   * Returns the count of cancelled orders.
   */
  cancelExpiredOrders(now: Date): Promise<number>;

  /**
   * Updates an order status with validation.
   */
  updateStatus(orderId: string, status: OrderStatus): Promise<void>;
}
