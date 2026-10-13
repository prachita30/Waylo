import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../../context';
import type { DbOrTx, Tx } from '../../db/client';
import { paymentEvents, payments } from '../../db/schema';
import { emit } from '../../lib/events';
import { applyRefundEvent } from './refunds';

export type PaymentRow = typeof payments.$inferSelect;
type AfterCommit = () => Promise<void>;

/**
 * Each payment purpose (flight booking, ride) registers how to react to provider outcomes.
 * Handlers run inside the webhook transaction and may return work to run after commit
 * (for example calling the airline to issue a ticket).
 */
export interface PaymentPurposeHandler {
  onSucceeded(ctx: AppContext, tx: Tx, payment: PaymentRow): Promise<AfterCommit | void>;
  onFailed(ctx: AppContext, tx: Tx, payment: PaymentRow, reason: string): Promise<AfterCommit | void>;
}
const handlers = new Map<string, PaymentPurposeHandler>();
export function registerPaymentPurpose(purpose: string, handler: PaymentPurposeHandler) {
  handlers.set(purpose, handler);
}

export async function createPayment(
  ctx: AppContext,
  input: { userId: string; purpose: string; referenceId: string; amountMinor: number; currency: string; description: string; idempotencyKey: string },
) {
  const id = randomUUID();
  const intent = await ctx.adapters.payments.createIntent({
    amountMinor: input.amountMinor,
    currency: input.currency,
    paymentId: id,
    description: input.description,
    idempotencyKey: input.idempotencyKey,
  });
  const [row] = await ctx.db
    .insert(payments)
    .values({
      id,
      userId: input.userId,
      purpose: input.purpose,
      referenceId: input.referenceId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      provider: ctx.adapters.payments.info.provider,
      providerIntentId: intent.intentId,
    })
    .onConflictDoNothing({ target: [payments.provider, payments.providerIntentId] })
    .returning();
  // Same intent already recorded (idempotent retry): return the existing row.
  const payment =
    row ??
    (await ctx.db
      .select()
      .from(payments)
      .where(and(eq(payments.provider, ctx.adapters.payments.info.provider), eq(payments.providerIntentId, intent.intentId)))
      .then((r) => r[0]!));
  return { payment, checkoutUrl: intent.checkoutUrl };
}

export async function latestPaymentFor(db: DbOrTx, purpose: string, referenceId: string) {
  const rows = await db.select().from(payments).where(and(eq(payments.purpose, purpose), eq(payments.referenceId, referenceId)));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

export function checkoutUrlFor(payment: PaymentRow) {
  return payment.provider === 'sandbox-payments' ? `/pay/sandbox/${payment.providerIntentId}` : null;
}

export type WebhookOutcome = { status: 'processed' | 'duplicate' | 'ignored'; eventId: string };

/**
 * Verifies, records and applies a provider event exactly once. Replays of the same event id are
 * acknowledged without side effects. Payment results are never taken from the browser.
 */
export async function handleWebhook(ctx: AppContext, rawBody: Buffer, signature: string | undefined): Promise<WebhookOutcome> {
  const event = ctx.adapters.payments.parseWebhook(rawBody, signature);
  const provider = ctx.adapters.payments.info.provider;
  const after: AfterCommit[] = [];

  const outcome = await ctx.db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(paymentEvents)
      .values({ provider, providerEventId: event.id, type: event.type, payload: event })
      .onConflictDoNothing({ target: [paymentEvents.provider, paymentEvents.providerEventId] })
      .returning({ id: paymentEvents.id });
    if (!inserted) return 'duplicate' as const;

    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.providerIntentId, event.intentId)))
      .for('update');
    if (!payment) {
      ctx.logger.warn({ eventId: event.id }, 'webhook for unknown payment');
      return 'ignored' as const;
    }
    const handler = handlers.get(payment.purpose);

    if (event.type === 'payment.succeeded') {
      if (payment.status === 'succeeded') return 'ignored' as const;
      if (event.amountMinor !== payment.amountMinor) {
        ctx.logger.error({ eventId: event.id, paymentId: payment.id }, 'payment amount mismatch; not applying');
        return 'ignored' as const;
      }
      const [updated] = await tx.update(payments).set({ status: 'succeeded', failureReason: null }).where(eq(payments.id, payment.id)).returning();
      const next = await handler?.onSucceeded(ctx, tx, updated!);
      if (next) after.push(next);
    } else if (event.type === 'payment.failed') {
      if (payment.status !== 'requires_payment' && payment.status !== 'failed') return 'ignored' as const;
      const [updated] = await tx
        .update(payments)
        .set({ status: 'failed', failureReason: event.failureReason ?? 'Payment failed' })
        .where(eq(payments.id, payment.id))
        .returning();
      const next = await handler?.onFailed(ctx, tx, updated!, event.failureReason ?? 'Payment failed');
      if (next) after.push(next);
    } else {
      // refund.succeeded / refund.failed: settle the matching refund in the ledger.
      const events = await applyRefundEvent(tx, event);
      if (events.length) after.push(() => emit(ctx, events));
    }
    await tx.update(paymentEvents).set({ processedAt: new Date() }).where(eq(paymentEvents.id, inserted.id));
    return 'processed' as const;
  });

  for (const job of after) {
    try {
      await job();
    } catch (err) {
      // Post-commit work is retried by background jobs; the webhook itself succeeded.
      ctx.logger.error({ err, eventId: event.id }, 'post-commit payment work failed');
    }
  }
  return { status: outcome, eventId: event.id };
}
