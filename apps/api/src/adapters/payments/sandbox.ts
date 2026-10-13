import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AdapterInfo } from '../../context';
import { type CreateIntentInput, type PaymentAdapter, type PaymentEvent, type PaymentEventType, type PaymentIntent, WebhookSignatureError } from './types';

const TOLERANCE_SECONDS = 300;

/** Signature header format: "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>". */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

export function verifySignature(secret: string, body: Buffer, header: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!header) throw new WebhookSignatureError('Missing signature');
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) throw new WebhookSignatureError('Malformed signature');
  if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) throw new WebhookSignatureError('Signature timestamp outside tolerance');
  const expected = createHmac('sha256', secret).update(`${t}.${body.toString('utf8')}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new WebhookSignatureError();
}

interface SandboxIntent {
  intentId: string;
  paymentId: string;
  amountMinor: number;
  status: 'open' | 'succeeded' | 'failed';
  refundedMinor: number;
}

/**
 * Sandbox payment provider. "Checkout" is an in-app page clearly labelled as simulated; it asks
 * the API to complete the intent, and the provider then delivers a signed webhook exactly as a
 * real provider would. No money moves and no card details are ever collected.
 */
export class SandboxPaymentAdapter implements PaymentAdapter {
  readonly info: AdapterInfo = { kind: 'payments', provider: 'sandbox-payments', mode: 'sandbox' };
  private readonly intents = new Map<string, SandboxIntent>();
  private readonly byKey = new Map<string, string>();
  /** Test hook: refunds fail when true. */
  failRefunds = false;

  constructor(
    private readonly secret: string,
    /** Delivers a signed webhook to WAYLO (wired to the webhook handler at bootstrap). */
    public deliver: (rawBody: Buffer, signature: string) => Promise<void> = async () => undefined,
  ) {}

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    const existing = this.byKey.get(input.idempotencyKey);
    const intentId = existing ?? `sbx_pi_${randomUUID().replace(/-/g, '')}`;
    if (!existing) {
      this.intents.set(intentId, { intentId, paymentId: input.paymentId, amountMinor: input.amountMinor, status: 'open', refundedMinor: 0 });
      this.byKey.set(input.idempotencyKey, intentId);
    }
    return { intentId, checkoutUrl: `/pay/sandbox/${intentId}` };
  }

  parseWebhook(rawBody: Buffer, signatureHeader: string | undefined): PaymentEvent {
    verifySignature(this.secret, rawBody, signatureHeader);
    return JSON.parse(rawBody.toString('utf8')) as PaymentEvent;
  }

  /** Simulates the customer finishing (or failing) checkout. */
  async complete(intentId: string, outcome: 'succeed' | 'fail'): Promise<PaymentEvent> {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error('Unknown sandbox intent');
    if (intent.status === 'succeeded') throw new Error('Intent already paid');
    intent.status = outcome === 'succeed' ? 'succeeded' : 'failed';
    const event = this.event(outcome === 'succeed' ? 'payment.succeeded' : 'payment.failed', intent, {
      failureReason: outcome === 'fail' ? 'Card declined (sandbox simulation).' : undefined,
    });
    // A failed attempt can be retried on the same intent.
    if (outcome === 'fail') intent.status = 'open';
    await this.send(event);
    return event;
  }

  async refund(input: { intentId: string; paymentId: string; amountMinor: number; idempotencyKey: string }): Promise<{ refundId: string }> {
    const intent = this.intents.get(input.intentId);
    const refundId = `sbx_re_${randomUUID().replace(/-/g, '')}`;
    const base = intent ?? { intentId: input.intentId, paymentId: input.paymentId, amountMinor: input.amountMinor, status: 'succeeded' as const, refundedMinor: 0 };
    const ok = !this.failRefunds && base.refundedMinor + input.amountMinor <= base.amountMinor;
    if (ok && intent) intent.refundedMinor += input.amountMinor;
    const event = this.event(ok ? 'refund.succeeded' : 'refund.failed', base, {
      amountMinor: input.amountMinor,
      refundId,
      failureReason: ok ? undefined : 'Refund declined (sandbox simulation).',
    });
    // Deliver asynchronously, like a real provider.
    setTimeout(() => void this.send(event), 0);
    return { refundId };
  }

  private event(type: PaymentEventType, intent: SandboxIntent, extra: Partial<PaymentEvent>): PaymentEvent {
    return {
      id: `sbx_evt_${randomUUID().replace(/-/g, '')}`,
      type,
      intentId: intent.intentId,
      paymentId: intent.paymentId,
      amountMinor: intent.amountMinor,
      createdAt: new Date().toISOString(),
      ...extra,
    };
  }

  /** Sign and deliver; also exposed so tests can replay an identical event. */
  async send(event: PaymentEvent): Promise<void> {
    const body = JSON.stringify(event);
    await this.deliver(Buffer.from(body), signPayload(this.secret, body));
  }
}
