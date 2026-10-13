import { and, eq, inArray, lte } from 'drizzle-orm';
import type { AppContext } from '../../context';
import type { Tx } from '../../db/client';
import { payments, rideGroups, rideParticipants, rideRequests } from '../../db/schema';
import { conflict, notFound } from '../../http/errors';
import { recordAudit } from '../../lib/audit';
import { type DomainEvent, emit, subscribe } from '../../lib/events';
import { requestRefund } from './refunds';
import { checkoutUrlFor, createPayment, latestPaymentFor, registerPaymentPurpose } from './service';

type Participant = typeof rideParticipants.$inferSelect;

async function paymentFor(ctx: AppContext, p: Participant) {
  const existing = await latestPaymentFor(ctx.db, 'ride', p.id);
  if (existing && existing.status !== 'cancelled') return existing;
  const { payment } = await createPayment(ctx, {
    userId: p.userId,
    purpose: 'ride',
    referenceId: p.id,
    amountMinor: p.finalTotalMinor ?? p.currentTotalMinor,
    currency: 'INR',
    description: 'Shared airport ride',
    idempotencyKey: `ride:${p.id}`,
  });
  return payment!;
}

/** Creates payment intents for every rider whose seat is awaiting payment in a locked group. */
export async function createRidePayments(ctx: AppContext, groupId: string) {
  const due = await ctx.db.select().from(rideParticipants).where(and(eq(rideParticipants.groupId, groupId), eq(rideParticipants.status, 'payment_due')));
  for (const p of due) {
    try {
      await paymentFor(ctx, p);
    } catch (err) {
      ctx.logger.error({ err, participantId: p.id }, 'could not create ride payment; rider can retry from the app');
    }
  }
}

/** Checkout link for the signed-in rider's seat (creates the intent if it is missing). */
export async function ridePaymentCheckout(ctx: AppContext, userId: string, groupId: string) {
  const [p] = await ctx.db.select().from(rideParticipants).where(and(eq(rideParticipants.groupId, groupId), eq(rideParticipants.userId, userId), inArray(rideParticipants.status, ['payment_due'])));
  if (!p) throw conflict('not_payable', 'There is nothing to pay for this ride.');
  if (p.paymentDueAt && p.paymentDueAt <= new Date()) throw conflict('payment_window_closed', 'The payment window for this seat has closed.');
  const payment = await paymentFor(ctx, p);
  return { checkoutUrl: checkoutUrlFor(payment), amountMinor: payment.amountMinor, dueAt: p.paymentDueAt?.toISOString() ?? null };
}

registerPaymentPurpose('ride', {
  async onSucceeded(_ctx, tx, payment) {
    const [p] = await tx.select().from(rideParticipants).where(eq(rideParticipants.id, payment.referenceId)).for('update');
    if (!p) return;
    if (p.status === 'payment_due') {
      await tx.update(rideParticipants).set({ status: 'confirmed' }).where(eq(rideParticipants.id, p.id));
      await recordAudit(tx, { action: 'ride.seat_paid', entityType: 'ride_participant', entityId: p.id, metadata: { paymentId: payment.id } });
    } else {
      // The seat was released before the payment arrived: return the money in full.
      await requestRefund(tx, { paymentId: payment.id, amountMinor: payment.amountMinor, reason: 'ride_payment_after_release', idempotencyKey: `participant:${p.id}:late_payment:${payment.id}` });
    }
  },
  async onFailed() {
    // The rider can retry until the payment deadline.
  },
});

/** Refund or close a rider's payment when they leave a locked group (fee kept) or are removed (no fee). */
export async function settleDepartingRider(tx: Tx, p: Participant, reason: 'ride_left_after_lock' | 'ride_removed', feeMinor: number) {
  const rows = await tx.select().from(payments).where(and(eq(payments.purpose, 'ride'), eq(payments.referenceId, p.id)));
  for (const pay of rows) {
    if (pay.status === 'requires_payment' || pay.status === 'failed') {
      await tx.update(payments).set({ status: 'cancelled' }).where(eq(payments.id, pay.id));
    } else if (pay.status === 'succeeded') {
      const amount = pay.amountMinor - (reason === 'ride_removed' ? 0 : feeMinor);
      if (amount > 0) await requestRefund(tx, { paymentId: pay.id, amountMinor: amount, reason, idempotencyKey: `participant:${p.id}:${reason}` });
    }
  }
}

/**
 * Background job: riders who did not pay by the deadline lose their seat. Remaining riders keep
 * their prices; if nobody paid, the group is cancelled.
 */
export async function releaseUnpaidSeats(ctx: AppContext, now = new Date()) {
  const overdue = await ctx.db.select().from(rideParticipants).where(and(eq(rideParticipants.status, 'payment_due'), lte(rideParticipants.paymentDueAt, now))).limit(100);
  const events: DomainEvent[] = [];
  for (const p of overdue) {
    await ctx.db.transaction(async (tx) => {
      const [g] = await tx.select().from(rideGroups).where(eq(rideGroups.id, p.groupId)).for('update');
      const [cur] = await tx.select().from(rideParticipants).where(eq(rideParticipants.id, p.id)).for('update');
      if (!g || !cur || cur.status !== 'payment_due') return;
      await tx.update(rideParticipants).set({ status: 'removed', removedReason: 'payment_timeout', leftAt: now }).where(eq(rideParticipants.id, p.id));
      await tx.update(rideRequests).set({ status: 'cancelled', closedReason: 'payment_timeout', cancelledAt: now }).where(eq(rideRequests.id, p.requestId));
      await settleDepartingRider(tx, cur, 'ride_removed', 0);
      const remaining = await tx.select().from(rideParticipants).where(and(eq(rideParticipants.groupId, g.id), inArray(rideParticipants.status, ['payment_due', 'confirmed'])));
      if (remaining.length === 0) {
        await tx.update(rideGroups).set({ status: 'cancelled', cancelledAt: now, cancelReason: 'No rider completed payment.', parties: 0, seatsTaken: 0, luggageTaken: 0 }).where(eq(rideGroups.id, g.id));
      } else {
        await tx
          .update(rideGroups)
          .set({
            seatsTaken: g.seatsTaken - cur.seats,
            luggageTaken: g.luggageTaken - cur.luggageUnits,
            parties: remaining.length,
            platformSubsidyMinor: g.platformSubsidyMinor + (cur.finalTotalMinor ?? cur.currentTotalMinor),
          })
          .where(eq(rideGroups.id, g.id));
      }
      await recordAudit(tx, { action: 'ride.seat_released_unpaid', entityType: 'ride_participant', entityId: p.id });
      events.push({ type: 'ride.rider_removed', userId: p.userId, requestId: p.requestId, groupId: g.id, reason: 'payment_timeout' });
    });
  }
  await emit(ctx, events);
  return overdue.length;
}

let registered = false;
export function registerRidePayments() {
  if (registered) return;
  registered = true;
  subscribe(async (ctx, e) => {
    if (e.type === 'ride.group_locked') await createRidePayments(ctx, e.groupId);
  });
}

export async function ridePaymentFor(ctx: AppContext, participantId: string) {
  const p = await latestPaymentFor(ctx.db, 'ride', participantId);
  if (!p) throw notFound('Payment');
  return p;
}
