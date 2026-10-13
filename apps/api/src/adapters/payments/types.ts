import type { Adapter } from '../../context';

export interface CreateIntentInput {
  amountMinor: number;
  currency: string;
  /** WAYLO payment id, echoed back in webhooks. */
  paymentId: string;
  description: string;
  idempotencyKey: string;
}

export interface PaymentIntent {
  intentId: string;
  /** Where the browser completes payment (hosted page or in-app sandbox checkout). */
  checkoutUrl: string;
}

export type PaymentEventType = 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'refund.failed';

export interface PaymentEvent {
  id: string;
  type: PaymentEventType;
  intentId: string;
  paymentId: string;
  amountMinor: number;
  refundId?: string;
  failureReason?: string;
  createdAt: string;
}

/**
 * Payment-provider boundary. WAYLO never handles card data: the provider collects it on
 * its own page and reports results through signed webhooks.
 */
export interface PaymentAdapter extends Adapter {
  createIntent(input: CreateIntentInput): Promise<PaymentIntent>;
  /** Verifies the signature and parses the event. Throws WebhookSignatureError when invalid. */
  parseWebhook(rawBody: Buffer, signatureHeader: string | undefined): PaymentEvent;
  /** Requests a refund; the outcome arrives as a refund.* webhook. */
  refund(input: { intentId: string; paymentId: string; amountMinor: number; idempotencyKey: string }): Promise<{ refundId: string }>;
}

export class WebhookSignatureError extends Error {
  constructor(message = 'Invalid webhook signature') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}
