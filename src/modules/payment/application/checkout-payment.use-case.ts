import type { Clock } from '../../../platform/clock/clock.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../platform/errors/problem-details.js';
import type { IdGenerator } from '../../../platform/id/id-generator.js';
import type { OrderRepositoryPort } from '../../order/domain/order.repository.port.js';
import type { PaymentRecord } from '../domain/payment.entity.js';
import type { PaymentRepositoryPort } from '../domain/payment.repository.port.js';

export interface CheckoutPaymentCommand {
  orderId: string;
  userId: string;
}

export interface CheckoutPaymentResult {
  payment: PaymentRecord;
  checkoutUrl: string;
}

export class CheckoutPaymentUseCase {
  constructor(
    private readonly paymentRepository: PaymentRepositoryPort,
    private readonly orderRepository: OrderRepositoryPort,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: CheckoutPaymentCommand): Promise<CheckoutPaymentResult> {
    const order = await this.orderRepository.findById(command.orderId);
    if (!order) {
      throw new NotFoundError('Order not found.');
    }

    if (order.userId !== command.userId) {
      throw new ForbiddenError('You do not have access to this order.');
    }

    if (order.status !== 'PENDING') {
      throw new ConflictError(`Cannot pay order with status '${order.status}'.`);
    }

    const now = this.clock.now();
    if (order.expiresAt.getTime() <= now.getTime()) {
      throw new ConflictError('Order payment window has expired.');
    }

    const existingPayment = await this.paymentRepository.findByOrderId(order.id);
    if (existingPayment) {
      return {
        payment: existingPayment,
        checkoutUrl: `/api/v1/payments/simulator-gateway/${existingPayment.id}`,
      };
    }

    const paymentId = this.idGenerator.generate();
    const payment = await this.paymentRepository.initiatePayment({
      paymentId,
      orderId: order.id,
      amount: order.totalAmount,
      provider: 'simulator',
    });

    return {
      payment,
      checkoutUrl: `/api/v1/payments/simulator-gateway/${payment.id}`,
    };
  }
}
