import type { IdempotentInboxService } from '../../../platform/inbox/idempotent-inbox.service.js';
import type { KafkaEnvelope } from '../../../platform/messaging/kafka-client.interface.js';
import type { IssueTicketsUseCase } from './issue-tickets.use-case.js';

export interface OrderPaidPayload {
  orderId: string;
  userId?: string | undefined;
  eventId?: string | undefined;
  totalAmount?: number | undefined;
  seatIds?: string[] | undefined;
}

export class OrderPaidEventHandler {
  public static readonly CONSUMER_GROUP = 'ticketing-order-paid-consumer';

  constructor(
    private readonly issueTicketsUseCase: IssueTicketsUseCase,
    private readonly inboxService: IdempotentInboxService,
  ) {}

  async handle(envelope: KafkaEnvelope<OrderPaidPayload>): Promise<{ executed: boolean }> {
    return this.inboxService.process(
      envelope.id,
      OrderPaidEventHandler.CONSUMER_GROUP,
      async () => {
        await this.issueTicketsUseCase.execute({
          orderId: envelope.payload.orderId,
        });
      },
    );
  }
}
