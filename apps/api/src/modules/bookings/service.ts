import { randomBytes } from 'node:crypto';
import type { CreateBookingInput } from '@waylo/shared';
import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import type { DbOrTx, Tx } from '../../db/client';
import { bookingPassengers, flightBookings, flightOffers, flights, payments, priceLocks } from '../../db/schema';
import type { AuthUser } from '../../http/auth';
import { AppError, conflict, gone, notFound, unavailable } from '../../http/errors';
import { recordAudit } from '../../lib/audit';
import { getOffer, remainingSeats } from '../flights/service';
import { type DomainEvent, emit } from '../../lib/events';
import { refundDto, refundsForPayment, requestRefund } from '../payments/refunds';
import { checkoutUrlFor, createPayment, latestPaymentFor, registerPaymentPurpose } from '../payments/service';

/** The captured payment for a booking, if any. */
async function capturedPayment(tx: DbOrTx, bookingId: string) {
  const rows = await tx.select().from(payments).where(and(eq(payments.purpose, 'flight_booking'), eq(payments.referenceId, bookingId)));
  return rows.find((p) => p.status === 'succeeded' || p.status === 'partially_refunded');
}
import { deletionBlockers } from '../users/service';

export const LOCK_MINUTES = 10;
/** Time to complete payment after the booking is created. */
export const PAYMENT_WINDOW_MINUTES = 20;
const TICKETING_BACKOFF_SECONDS = [15, 30, 60, 120, 300, 600];
const MAX_TICKETING_ATTEMPTS = 12;

export type BookingRow = typeof flightBookings.$inferSelect;

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newReference = () => 'WY' + Array.from(randomBytes(6), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');

// ------------------------------------------------------------------ price lock

/**
 * Re-confirms price and availability with the airline and returns a short-lived lock.
 * If the airline's price changed, the lock carries the new price and the change is reported
 * so the customer can accept it explicitly.
 */
export async function lockPrice(ctx: AppContext, user: AuthUser, offerId: string, adults: number, now = new Date()) {
  const [row] = await ctx.db
    .select({ offer: flightOffers, departAt: flights.departAt })
    .from(flightOffers)
    .innerJoin(flights, eq(flights.id, flightOffers.flightId))
    .where(eq(flightOffers.id, offerId));
  if (!row || row.offer.status === 'draft') throw notFound('Offer');
  const { offer } = row;
  if (offer.status !== 'published' || offer.validUntil <= now || row.departAt <= now) {
    throw gone('offer_expired', 'This offer has expired. Please choose another flight.');
  }
  if (offer.validFrom > now) throw conflict('offer_not_open', 'This offer is not open for booking yet.');
  const maxPax = offer.eligibility?.maxPassengers;
  if (maxPax && adults > maxPax) throw conflict('eligibility_failed', `This fare allows up to ${maxPax} travellers per booking.`);
  const minAdvance = offer.eligibility?.minAdvanceHours;
  if (minAdvance && row.departAt.getTime() - now.getTime() < minAdvance * 3_600_000) {
    throw conflict('eligibility_failed', `This fare must be booked at least ${minAdvance} hours before departure.`);
  }
  const capLeft = remainingSeats({ seatsAvailable: null, inventoryCap: offer.inventoryCap, seatsSold: offer.seatsSold });
  if (capLeft !== null && capLeft < adults) throw conflict('offer_unavailable', capLeft === 0 ? 'This fare has sold out.' : `Only ${capLeft} seats are left at this fare.`);

  let result;
  try {
    result = await ctx.adapters.airline.validateOffer({
      externalRef: offer.externalRef,
      adults,
      known: { fareMinor: offer.fareMinor, taxesMinor: offer.taxesMinor, departAt: row.departAt, validUntil: offer.validUntil, seatsAvailable: offer.seatsAvailable },
    });
  } catch (err) {
    ctx.logger.warn({ err, offerId }, 'airline validation failed');
    throw unavailable('airline_unavailable', 'We could not confirm this fare with the airline right now. Please try again in a moment.');
  }

  if (!result.available) {
    if (result.reason === 'sold_out') await ctx.db.update(flightOffers).set({ seatsAvailable: 0 }).where(eq(flightOffers.id, offerId));
    if (result.reason === 'expired' || result.reason === 'withdrawn') {
      await ctx.db.update(flightOffers).set({ status: 'expired' }).where(eq(flightOffers.id, offerId));
      throw gone('offer_expired', 'This offer has expired. Please choose another flight.');
    }
    throw conflict('offer_unavailable', result.reason === 'insufficient_seats' ? 'There are not enough seats left at this fare for your group.' : 'This fare has sold out.');
  }

  const priceChanged = result.fareMinor !== offer.fareMinor ? { previousPerAdultMinor: offer.fareMinor, currentPerAdultMinor: result.fareMinor } : null;
  await ctx.db
    .update(flightOffers)
    .set({ fareMinor: result.fareMinor, taxesMinor: result.taxesMinor, seatsAvailable: result.seatsAvailable, validUntil: result.validUntil })
    .where(eq(flightOffers.id, offerId));

  const expiresAt = new Date(Math.min(now.getTime() + LOCK_MINUTES * 60_000, result.validUntil.getTime()));
  const [lock] = await ctx.db
    .insert(priceLocks)
    .values({
      offerId,
      userId: user.id,
      adults,
      farePerAdultMinor: result.fareMinor,
      taxesPerAdultMinor: result.taxesMinor,
      totalMinor: result.fareMinor * adults,
      currency: offer.currency,
      expiresAt,
    })
    .returning();
  return {
    lock: {
      id: lock!.id,
      adults,
      farePerAdultMinor: lock!.farePerAdultMinor,
      taxesPerAdultMinor: lock!.taxesPerAdultMinor,
      totalMinor: lock!.totalMinor,
      currency: lock!.currency,
      expiresAt: lock!.expiresAt.toISOString(),
    },
    priceChanged,
    offer: await getOffer(ctx, offerId, adults, now),
  };
}

// ------------------------------------------------------------------ create booking

async function releaseSeats(tx: DbOrTx, booking: BookingRow) {
  if (!booking.seatsHeld) return;
  await tx
    .update(flightOffers)
    .set({ seatsSold: sql`greatest(${flightOffers.seatsSold} - ${booking.adults}, 0)` })
    .where(and(eq(flightOffers.id, booking.offerId), isNotNull(flightOffers.inventoryCap)));
  await tx.update(flightBookings).set({ seatsHeld: false }).where(eq(flightBookings.id, booking.id));
}

/**
 * Creates a booking from a price lock. Safe against double submission:
 * - the same Idempotency-Key returns the original booking;
 * - one lock can back at most one booking (unique constraint);
 * - partner inventory is reserved under a row lock so concurrent buyers cannot oversell.
 * Seats are held at the airline after the database commit; if that fails the booking is
 * expired and the reservation released (compensation).
 */
export async function createBooking(ctx: AppContext, user: AuthUser, input: CreateBookingInput & { acceptFareRules: true }, idempotencyKey: string, now = new Date()) {
  const existing = await ctx.db
    .select()
    .from(flightBookings)
    .where(and(eq(flightBookings.userId, user.id), eq(flightBookings.idempotencyKey, idempotencyKey)))
    .then((r) => r[0]);
  if (existing) {
    if (existing.priceLockId !== input.priceLockId) throw new AppError(422, 'idempotency_key_reused', 'This request key was already used for a different booking.');
    return { booking: existing, replayed: true };
  }

  const booking = await ctx.db.transaction(async (tx) => {
    const [lock] = await tx.select().from(priceLocks).where(eq(priceLocks.id, input.priceLockId)).for('update');
    if (!lock || lock.userId !== user.id) throw notFound('Price lock');
    if (lock.consumedAt) throw conflict('lock_already_used', 'This fare confirmation was already used for a booking.');
    if (lock.expiresAt <= now) throw gone('lock_expired', 'Your price lock has expired. Please confirm the fare again.');
    if (input.passengers.length !== lock.adults) throw conflict('passenger_count_mismatch', `Enter details for exactly ${lock.adults} traveller${lock.adults > 1 ? 's' : ''}.`);
    if (input.acceptedTotalMinor !== lock.totalMinor) throw conflict('price_not_accepted', 'The fare changed. Please review and accept the current price.');

    const [offer] = await tx.select().from(flightOffers).where(eq(flightOffers.id, lock.offerId)).for('update');
    if (!offer || offer.status !== 'published') throw gone('offer_expired', 'This offer is no longer available.');
    const capLeft = remainingSeats({ seatsAvailable: null, inventoryCap: offer.inventoryCap, seatsSold: offer.seatsSold });
    if (capLeft !== null && capLeft < lock.adults) throw conflict('offer_unavailable', 'This fare sold out while you were booking.');
    if (offer.inventoryCap !== null) {
      await tx.update(flightOffers).set({ seatsSold: offer.seatsSold + lock.adults }).where(eq(flightOffers.id, offer.id));
    }
    await tx.update(priceLocks).set({ consumedAt: now }).where(eq(priceLocks.id, lock.id));

    const offerDto = await getOffer({ ...ctx, db: tx as never }, offer.id, lock.adults, now);
    const [b] = await tx
      .insert(flightBookings)
      .values({
        reference: newReference(),
        userId: user.id,
        offerId: offer.id,
        priceLockId: lock.id,
        idempotencyKey,
        adults: lock.adults,
        totalMinor: lock.totalMinor,
        currency: lock.currency,
        contactEmail: input.contact.email,
        contactPhone: input.contact.phone ?? null,
        snapshot: {
          ...offerDto,
          farePerAdultMinor: lock.farePerAdultMinor,
          taxesPerAdultMinor: lock.taxesPerAdultMinor,
          totalMinor: lock.totalMinor,
          seatsLeft: undefined,
          availability: undefined,
        },
        seatsHeld: offer.inventoryCap !== null,
        paymentDueAt: new Date(now.getTime() + PAYMENT_WINDOW_MINUTES * 60_000),
      })
      .returning();
    await tx.insert(bookingPassengers).values(input.passengers.map((p, position) => ({ bookingId: b!.id, position, firstName: p.firstName, lastName: p.lastName })));
    await recordAudit(tx, { actorUserId: user.id, actorRole: user.role, action: 'flight_booking.created', entityType: 'flight_booking', entityId: b!.id, metadata: { reference: b!.reference } });
    return { booking: b!, externalRef: offer.externalRef };
  });

  // Hold seats with the airline (external call, outside the transaction).
  try {
    const order = await ctx.adapters.airline.createOrder({
      externalRef: booking.externalRef,
      passengers: input.passengers,
      contact: input.contact,
      expectedTotalMinor: booking.booking.totalMinor,
      idempotencyKey: booking.booking.id,
    });
    await ctx.db.update(flightBookings).set({ airlineOrderRef: order.orderRef }).where(eq(flightBookings.id, booking.booking.id));
  } catch (err) {
    ctx.logger.warn({ err, bookingId: booking.booking.id }, 'airline hold failed; compensating');
    await ctx.db.transaction(async (tx) => {
      await tx.update(flightBookings).set({ status: 'expired', failureReason: 'The airline could not hold the seats.' }).where(eq(flightBookings.id, booking.booking.id));
      await releaseSeats(tx, booking.booking);
    });
    throw unavailable('airline_hold_failed', 'The airline could not hold these seats. You have not been charged. Please try again.');
  }

  await createPayment(ctx, {
    userId: user.id,
    purpose: 'flight_booking',
    referenceId: booking.booking.id,
    amountMinor: booking.booking.totalMinor,
    currency: booking.booking.currency,
    description: `Flight booking ${booking.booking.reference}`,
    idempotencyKey: `booking:${booking.booking.id}`,
  });
  const [fresh] = await ctx.db.select().from(flightBookings).where(eq(flightBookings.id, booking.booking.id));
  return { booking: fresh!, replayed: false };
}

// ------------------------------------------------------------------ payment outcomes & ticketing

async function bookingForPayment(tx: Tx, referenceId: string) {
  const [b] = await tx.select().from(flightBookings).where(eq(flightBookings.id, referenceId)).for('update');
  return b;
}

registerPaymentPurpose('flight_booking', {
  async onSucceeded(ctx, tx, payment) {
    const b = await bookingForPayment(tx, payment.referenceId);
    if (!b) return;
    if (b.status !== 'pending_payment' && b.status !== 'payment_failed') {
      // Paid after expiry or cancellation: the money must go back.
      await tx.update(flightBookings).set({ refundDueMinor: payment.amountMinor, failureReason: 'Payment arrived after the booking had closed.' }).where(eq(flightBookings.id, b.id));
      await requestRefund(tx, { paymentId: payment.id, amountMinor: payment.amountMinor, reason: 'late_payment', idempotencyKey: `booking:${b.id}:late_payment:${payment.id}` });
      return;
    }
    await tx.update(flightBookings).set({ status: 'ticketing', nextTicketingCheckAt: new Date() }).where(eq(flightBookings.id, b.id));
    await recordAudit(tx, { action: 'flight_booking.paid', entityType: 'flight_booking', entityId: b.id, metadata: { paymentId: payment.id } });
    return () => runTicketing(ctx, b.id);
  },
  async onFailed(_ctx, tx, payment, reason) {
    const b = await bookingForPayment(tx, payment.referenceId);
    if (!b || b.status !== 'pending_payment') return;
    await tx.update(flightBookings).set({ status: 'payment_failed', failureReason: reason }).where(eq(flightBookings.id, b.id));
  },
});

/**
 * Requests (or checks) ticket issuance. A booking becomes confirmed only when the airline
 * reports a ticket. Pending issuance is retried with backoff; failure triggers a full refund.
 */
export async function runTicketing(ctx: AppContext, bookingId: string, now = new Date()) {
  const events: DomainEvent[] = [];
  const [b] = await ctx.db.select().from(flightBookings).where(eq(flightBookings.id, bookingId));
  if (!b || b.status !== 'ticketing' || !b.airlineOrderRef) return;
  let result;
  try {
    result = b.ticketingAttempts === 0 ? await ctx.adapters.airline.issueTicket(b.airlineOrderRef) : await ctx.adapters.airline.getOrder(b.airlineOrderRef);
  } catch (err) {
    ctx.logger.warn({ err, bookingId }, 'ticketing call failed; will retry');
    result = { status: 'pending' as const };
  }
  await ctx.db.transaction(async (tx) => {
    const [cur] = await tx.select().from(flightBookings).where(eq(flightBookings.id, bookingId)).for('update');
    if (!cur || cur.status !== 'ticketing') return;
    const attempts = cur.ticketingAttempts + 1;
    if (result.status === 'ticketed') {
      await tx.update(flightBookings).set({ status: 'confirmed', pnr: result.pnr, ticketedAt: now, ticketingAttempts: attempts, nextTicketingCheckAt: null }).where(eq(flightBookings.id, bookingId));
      const pax = await tx.select().from(bookingPassengers).where(eq(bookingPassengers.bookingId, bookingId)).orderBy(asc(bookingPassengers.position));
      for (const [i, p] of pax.entries()) {
        await tx.update(bookingPassengers).set({ ticketNumber: result.ticketNumbers[i] ?? null }).where(eq(bookingPassengers.id, p.id));
      }
      await recordAudit(tx, { action: 'flight_booking.ticketed', entityType: 'flight_booking', entityId: bookingId, metadata: { pnr: result.pnr } });
      events.push({ type: 'flight_booking.confirmed', userId: cur.userId, bookingId, reference: cur.reference });
    } else if (result.status === 'failed' || attempts >= MAX_TICKETING_ATTEMPTS) {
      const reason = result.status === 'failed' ? result.reason : 'The airline did not issue a ticket in time.';
      await tx
        .update(flightBookings)
        .set({ status: 'ticketing_failed', failureReason: reason, ticketingAttempts: attempts, nextTicketingCheckAt: null, refundDueMinor: cur.totalMinor })
        .where(eq(flightBookings.id, bookingId));
      await releaseSeats(tx, cur);
      const paid = await capturedPayment(tx, bookingId);
      if (paid) await requestRefund(tx, { paymentId: paid.id, amountMinor: cur.totalMinor, reason: 'ticketing_failed', idempotencyKey: `booking:${bookingId}:ticketing_failed` });
      await recordAudit(tx, { action: 'flight_booking.ticketing_failed', entityType: 'flight_booking', entityId: bookingId, metadata: { reason } });
      events.push({ type: 'flight_booking.ticketing_failed', userId: cur.userId, bookingId, reference: cur.reference });
    } else {
      const delay = TICKETING_BACKOFF_SECONDS[Math.min(attempts - 1, TICKETING_BACKOFF_SECONDS.length - 1)]!;
      await tx.update(flightBookings).set({ ticketingAttempts: attempts, nextTicketingCheckAt: new Date(now.getTime() + delay * 1000) }).where(eq(flightBookings.id, bookingId));
    }
  });
  await emit(ctx, events);
}

/** Background job: re-checks bookings whose ticket issuance is still pending. */
export async function pollPendingTicketing(ctx: AppContext, now = new Date()) {
  const due = await ctx.db
    .select({ id: flightBookings.id })
    .from(flightBookings)
    .where(and(eq(flightBookings.status, 'ticketing'), lte(flightBookings.nextTicketingCheckAt, now)))
    .limit(50);
  for (const { id } of due) await runTicketing(ctx, id, now);
  return due.length;
}

/** Background job: closes bookings whose payment window passed and releases their seats. */
export async function expireUnpaidBookings(ctx: AppContext, now = new Date()) {
  const stale = await ctx.db
    .select()
    .from(flightBookings)
    .where(and(inArray(flightBookings.status, ['pending_payment', 'payment_failed']), lte(flightBookings.paymentDueAt, now)))
    .limit(100);
  for (const b of stale) {
    await ctx.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(flightBookings).where(eq(flightBookings.id, b.id)).for('update');
      if (!cur || (cur.status !== 'pending_payment' && cur.status !== 'payment_failed')) return;
      await tx.update(flightBookings).set({ status: 'expired', failureReason: 'Payment was not completed in time.' }).where(eq(flightBookings.id, b.id));
      await tx
        .update(payments)
        .set({ status: 'cancelled' })
        .where(and(eq(payments.purpose, 'flight_booking'), eq(payments.referenceId, b.id), inArray(payments.status, ['requires_payment', 'failed'])));
      await releaseSeats(tx, cur);
    });
    if (b.airlineOrderRef) await ctx.adapters.airline.cancelOrder(b.airlineOrderRef).catch((err) => ctx.logger.warn({ err, bookingId: b.id }, 'release hold failed'));
  }
  return stale.length;
}

// ------------------------------------------------------------------ read & cancel

export async function loadBooking(db: DbOrTx, user: AuthUser, id: string) {
  const [b] = await db.select().from(flightBookings).where(eq(flightBookings.id, id));
  // Other users' bookings are indistinguishable from missing ones.
  if (!b || (b.userId !== user.id && user.role !== 'admin')) throw notFound('Booking');
  return b;
}

export async function toBookingDto(db: DbOrTx, b: BookingRow) {
  const [pax, payment] = await Promise.all([
    db.select().from(bookingPassengers).where(eq(bookingPassengers.bookingId, b.id)).orderBy(asc(bookingPassengers.position)),
    latestPaymentFor(db, 'flight_booking', b.id),
  ]);
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    adults: b.adults,
    totalMinor: b.totalMinor,
    currency: b.currency,
    contact: { email: b.contactEmail, phone: b.contactPhone },
    itinerary: b.snapshot,
    passengers: pax.map((p) => ({ firstName: p.firstName, lastName: p.lastName, ticketNumber: p.ticketNumber })),
    pnr: b.pnr,
    ticketedAt: b.ticketedAt?.toISOString() ?? null,
    paymentDueAt: b.paymentDueAt.toISOString(),
    failureReason: b.failureReason,
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    refundDueMinor: b.refundDueMinor,
    payment: payment
      ? { id: payment.id, status: payment.status, amountMinor: payment.amountMinor, refundedMinor: payment.refundedMinor, failureReason: payment.failureReason, checkoutUrl: checkoutUrlFor(payment) }
      : null,
    refunds: payment ? (await refundsForPayment(db, payment.id)).map(refundDto) : [],
    createdAt: b.createdAt.toISOString(),
  };
}

export async function listBookings(ctx: AppContext, user: AuthUser) {
  const rows = await ctx.db.select().from(flightBookings).where(eq(flightBookings.userId, user.id)).orderBy(desc(flightBookings.createdAt)).limit(100);
  return Promise.all(rows.map((b) => toBookingDto(ctx.db, b)));
}

/** Refund the customer would receive if they cancelled now, per the fare rules sold. */
export function refundQuote(b: BookingRow, now = new Date()) {
  const s = b.snapshot as { conditions?: { refundable?: boolean; cancelFeeMinor?: number | null }; taxesPerAdultMinor?: number; departAt?: string };
  const departAt = s.departAt ? new Date(s.departAt) : null;
  if (b.status !== 'confirmed') return { cancellable: false as const, reason: 'Only confirmed bookings can be cancelled.' };
  if (departAt && departAt.getTime() - now.getTime() < 4 * 3_600_000) {
    return { cancellable: false as const, reason: 'Bookings can be cancelled online up to 4 hours before departure. Please contact the airline.' };
  }
  const refundMinor = s.conditions?.refundable
    ? Math.max(0, b.totalMinor - (s.conditions.cancelFeeMinor ?? 0) * b.adults)
    : Math.min(b.totalMinor, (s.taxesPerAdultMinor ?? 0) * b.adults);
  return { cancellable: true as const, refundMinor, refundable: !!s.conditions?.refundable };
}

export async function cancelBooking(ctx: AppContext, user: AuthUser, id: string, now = new Date()) {
  const b = await loadBooking(ctx.db, user, id);
  const quote = refundQuote(b, now);
  if (!quote.cancellable) throw conflict('not_cancellable', quote.reason);
  let airlineRefund: number;
  try {
    airlineRefund = (await ctx.adapters.airline.cancelOrder(b.airlineOrderRef!)).refundableMinor;
  } catch {
    throw unavailable('airline_unavailable', 'We could not reach the airline to cancel. Your booking is unchanged; please try again shortly.');
  }
  // The airline decides the refundable amount; never more than was paid.
  const refundMinor = Math.min(airlineRefund, b.totalMinor);
  return ctx.db.transaction(async (tx) => {
    const [cur] = await tx.select().from(flightBookings).where(eq(flightBookings.id, id)).for('update');
    if (!cur || cur.status !== 'confirmed') throw conflict('not_cancellable', 'This booking can no longer be cancelled.');
    const [updated] = await tx
      .update(flightBookings)
      .set({ status: 'cancelled', cancelledAt: now, cancelledBy: 'customer', refundDueMinor: refundMinor > 0 ? refundMinor : null })
      .where(eq(flightBookings.id, id))
      .returning();
    await releaseSeats(tx, { ...cur, seatsHeld: cur.seatsHeld });
    const paid = await capturedPayment(tx, id);
    if (paid && refundMinor > 0) await requestRefund(tx, { paymentId: paid.id, amountMinor: refundMinor, reason: 'flight_cancellation', idempotencyKey: `booking:${id}:cancel` });
    await recordAudit(tx, { actorUserId: user.id, actorRole: user.role, action: 'flight_booking.cancelled', entityType: 'flight_booking', entityId: id, metadata: { refundMinor } });
    return updated!;
  }).then(async (updated) => {
    await emit(ctx, { type: 'flight_booking.cancelled', userId: updated.userId, bookingId: id, reference: updated.reference, refundMinor: updated.refundDueMinor });
    return updated;
  });
}

// Accounts with trips in progress cannot be deleted.
deletionBlockers.push(async (db, userId) => {
  const [active] = await db
    .select({ id: flightBookings.id })
    .from(flightBookings)
    .where(and(eq(flightBookings.userId, userId), inArray(flightBookings.status, ['pending_payment', 'ticketing'])))
    .limit(1);
  return active ? 'You have a flight booking that is still being processed.' : null;
});
deletionBlockers.push(async (db, userId) => {
  const [upcoming] = await db
    .select({ id: flightBookings.id })
    .from(flightBookings)
    .where(and(eq(flightBookings.userId, userId), eq(flightBookings.status, 'confirmed'), sql`(${flightBookings.snapshot}->>'departAt')::timestamptz > now()`))
    .limit(1);
  return upcoming ? 'You have an upcoming flight. Cancel it or wait until after travel to delete your account.' : null;
});
