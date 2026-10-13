import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PaymentEvent } from '../../adapters/payments/types';
import type { AppContext } from '../../context';
import type { DbOrTx, Tx } from '../../db/client';
import { payments, refunds } from '../../db/schema';
import { recordAudit } from '../../lib/audit';
import { type DomainEvent, emit } from '../../lib/events';

export type RefundRow = typeof refunds.$inferSelect;
export type RefundReason =
  | 'flight_cancellation'
  | 'ticketing_failed'
  | 'late_payment'
  | 'ride_left_after_lock'
  | 'ride_removed'
  | 'ride_payment_after_release'
  | 'admin_goodwill';

/**
 * Records a refund owed to the customer. Safe to call repeatedly: the idempotency key returns the
 * existing refund, and the amount is capped at what has been paid and not yet refunded or queued.
 * Must run inside a transaction so the payment row lock covers the cap check.
 */
export async function requestRefund(
  tx: Tx,
  input: { paymentId: string; amountMinor: number; reason: RefundReason; idempotencyKey: string; requestedBy?: 'system' | 'admin' | 'customer' },
): Promise<RefundRow | null> {
  const [existing] = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey));
  if (existing) return existing;
  const [p] = await tx.select().from(payments).where(eq(payments.id, input.paymentId)).for('update');
  if (!p || (p.status !== 'succeeded' && p.status !== 'partially_refunded')) return null;
  const [{ queued } = { queued: 0 }] = await tx
    .select({ queued: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.paymentId, p.id), inArray(refunds.status, ['pending', 'processing'])));
  const available = p.amountMinor - p.refundedMinor - Number(queued);
  const amount = Math.min(input.amountMinor, available);
  if (amount <= 0) return null;
  const [row] = await tx
    .insert(refunds)
    .values({ paymentId: p.id, userId: p.userId, amountMinor: amount, reason: input.reason, idempotencyKey: input.idempotencyKey, requestedBy: input.requestedBy ?? 'system' })
    .returning();
  await recordAudit(tx, { action: 'refund.requested', entityType: 'refund', entityId: row!.id, metadata: { paymentId: p.id, amountMinor: amount, reason: input.reason } });
  return row!;
}

/**
 * Background job: sends pending refunds to the payment provider. A provider error marks the refund
 * failed for a person to review; financial operations are never retried automatically.
 */
export async function processPendingRefunds(ctx: AppContext, limit = 20) {
  const pending = await ctx.db.select().from(refunds).where(eq(refunds.status, 'pending')).orderBy(asc(refunds.createdAt)).limit(limit);
  for (const r of pending) {
    const [claimed] = await ctx.db
      .update(refunds)
      .set({ status: 'processing', attempts: r.attempts + 1 })
      .where(and(eq(refunds.id, r.id), eq(refunds.status, 'pending')))
      .returning();
    if (!claimed) continue;
    const [p] = await ctx.db.select().from(payments).where(eq(payments.id, r.paymentId));
    try {
      const out = await ctx.adapters.payments.refund({ intentId: p!.providerIntentId, paymentId: p!.id, amountMinor: r.amountMinor, idempotencyKey: r.id });
      await ctx.db.update(refunds).set({ providerRefundId: out.refundId }).where(eq(refunds.id, r.id));
    } catch (err) {
      ctx.logger.error({ err, refundId: r.id }, 'refund request failed; needs review');
      await ctx.db.update(refunds).set({ status: 'failed', failureReason: (err as Error).message.slice(0, 500) }).where(eq(refunds.id, r.id));
    }
  }
  return pending.length;
}

/** Applies a provider refund outcome (called from the verified webhook transaction). */
export async function applyRefundEvent(tx: Tx, event: PaymentEvent): Promise<DomainEvent[]> {
  if (!event.reference) return [];
  const [r] = await tx.select().from(refunds).where(eq(refunds.id, event.reference)).for('update');
  if (!r || r.status === 'succeeded' || r.status === 'failed') return [];
  if (event.type === 'refund.failed') {
    await tx.update(refunds).set({ status: 'failed', failureReason: event.failureReason ?? 'Refund failed', providerRefundId: event.refundId ?? r.providerRefundId }).where(eq(refunds.id, r.id));
    return [{ type: 'refund.processed', userId: r.userId, amountMinor: r.amountMinor, reference: r.id, succeeded: false }];
  }
  const [p] = await tx.select().from(payments).where(eq(payments.id, r.paymentId)).for('update');
  const refunded = p!.refundedMinor + r.amountMinor;
  await tx.update(payments).set({ refundedMinor: refunded, status: refunded >= p!.amountMinor ? 'refunded' : 'partially_refunded' }).where(eq(payments.id, p!.id));
  await tx.update(refunds).set({ status: 'succeeded', processedAt: new Date(), providerRefundId: event.refundId ?? r.providerRefundId }).where(eq(refunds.id, r.id));
  return [{ type: 'refund.processed', userId: r.userId, amountMinor: r.amountMinor, reference: r.id, succeeded: true }];
}

/** Administrator retry of a failed refund (explicit, audited). */
export async function retryRefund(ctx: AppContext, refundId: string, actorId: string) {
  const [r] = await ctx.db.update(refunds).set({ status: 'pending', failureReason: null }).where(and(eq(refunds.id, refundId), eq(refunds.status, 'failed'))).returning();
  if (r) await recordAudit(ctx.db, { actorUserId: actorId, actorRole: 'admin', action: 'refund.retried', entityType: 'refund', entityId: refundId });
  return r ?? null;
}

export async function refundsForPayment(db: DbOrTx, paymentId: string) {
  return db.select().from(refunds).where(eq(refunds.paymentId, paymentId)).orderBy(asc(refunds.createdAt));
}

export const refundDto = (r: RefundRow) => ({
  id: r.id,
  amountMinor: r.amountMinor,
  reason: r.reason,
  status: r.status,
  failureReason: r.status === 'failed' ? 'We are looking into this refund.' : null,
  createdAt: r.createdAt.toISOString(),
  processedAt: r.processedAt?.toISOString() ?? null,
});

export { emit };
