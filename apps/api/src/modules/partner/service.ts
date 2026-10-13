import { randomUUID } from 'node:crypto';
import { type partnerOfferSchema, zonedTimeToUtc } from '@waylo/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Request } from 'express';
import type { z } from 'zod';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { airlines, airports, auditEvents, flightBookings, flightOffers, flights, partnerMembers, partnerRoutes, partners, payments, refunds } from '../../db/schema';
import { currentUser } from '../../http/auth';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../http/errors';
import { recordAudit } from '../../lib/audit';
import { remainingSeats } from '../flights/service';

export type PartnerRow = typeof partners.$inferSelect;
type OfferInput = z.output<typeof partnerOfferSchema>;
type OfferStatus = (typeof flightOffers.$inferSelect)['status'];

export async function partnerFor(db: DbOrTx, userId: string) {
  const [m] = await db.select({ partner: partners }).from(partnerMembers).innerJoin(partners, eq(partners.id, partnerMembers.partnerId)).where(eq(partnerMembers.userId, userId));
  return m?.partner ?? null;
}

export async function requirePartner(db: DbOrTx, req: Request, opts: { approved?: boolean } = {}) {
  const user = currentUser(req);
  if (user.role !== 'partner') throw forbidden();
  const p = await partnerFor(db, user.id);
  if (!p) throw new AppError(403, 'not_onboarded', 'Set up your partner account first.');
  if (opts.approved && p.status !== 'approved') throw new AppError(403, 'partner_not_approved', p.status === 'suspended' ? 'Your partner account is suspended.' : 'Your partner account is awaiting approval.');
  return p;
}

const tzOf = async (db: DbOrTx, code: string) => {
  const [a] = await db.select({ tz: airports.timezone }).from(airports).where(eq(airports.code, code));
  if (!a) throw badRequest(`Unknown airport ${code}.`);
  return a.tz;
};

/** Validates and stores a partner offer on one of the partner's routes and authorised airlines. */
export async function createOffer(ctx: AppContext, partner: PartnerRow, actorId: string, v: OfferInput, now = new Date()) {
  if (!partner.authorisedAirlines.includes(v.airlineCode)) throw forbidden(`You are not authorised to sell ${v.airlineCode} fares.`);
  const [route] = await ctx.db
    .select()
    .from(partnerRoutes)
    .where(and(eq(partnerRoutes.partnerId, partner.id), eq(partnerRoutes.origin, v.origin), eq(partnerRoutes.destination, v.destination), eq(partnerRoutes.active, true)));
  if (!route) throw badRequest('Add this route to your network before publishing offers on it.', [{ path: 'destination', message: 'Route not configured.' }]);
  const departAt = zonedTimeToUtc(v.departDate, v.departTime, await tzOf(ctx.db, v.origin));
  const arriveAt = zonedTimeToUtc(v.arriveDate, v.arriveTime, await tzOf(ctx.db, v.destination));
  if (arriveAt <= departAt) throw badRequest('Arrival must be after departure.', [{ path: 'arriveTime', message: 'Arrival must be after departure.' }]);
  if (departAt <= now) throw badRequest('Departure must be in the future.', [{ path: 'departDate', message: 'Departure must be in the future.' }]);
  const validUntil = new Date(v.validUntil);
  if (validUntil > departAt) throw badRequest('The offer must close before departure.', [{ path: 'validUntil', message: 'Must be before departure.' }]);
  const flightNumber = `${v.airlineCode}${v.flightDigits}`;

  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx.select().from(flights).where(and(eq(flights.airlineCode, v.airlineCode), eq(flights.flightNumber, flightNumber), eq(flights.departAt, departAt)));
    if (existing && (existing.origin !== v.origin || existing.destination !== v.destination || existing.arriveAt.getTime() !== arriveAt.getTime())) {
      throw conflict('schedule_conflict', `${flightNumber} at this time is already scheduled with a different route or arrival.`);
    }
    const flight =
      existing ?? (await tx.insert(flights).values({ airlineCode: v.airlineCode, flightNumber, origin: v.origin, destination: v.destination, departAt, arriveAt }).returning())[0]!;
    const [offer] = await tx
      .insert(flightOffers)
      .values({
        flightId: flight.id,
        source: 'partner',
        externalRef: `P-${partner.id.slice(0, 8)}-${randomUUID()}`,
        partnerId: partner.id,
        cabin: v.cabin,
        fareMinor: v.fareMinor,
        taxesMinor: v.taxesMinor,
        referenceFareMinor: v.referenceFareMinor ?? null,
        referenceSource: v.referenceSource ?? null,
        baggageCabinKg: v.baggageCabinKg,
        baggageCheckedKg: v.baggageCheckedKg,
        refundable: v.refundable,
        changeFeeMinor: v.changeFeeMinor,
        cancelFeeMinor: v.cancelFeeMinor,
        fareRules: v.fareRules,
        eligibility: { maxPassengers: v.maxPassengers, minAdvanceHours: v.minAdvanceHours, notes: v.eligibilityNotes },
        seatsAvailable: null,
        inventoryCap: v.inventoryCap,
        validFrom: new Date(v.validFrom),
        validUntil,
        status: v.publish ? 'published' : 'draft',
      })
      .returning();
    await recordAudit(tx, { actorUserId: actorId, actorRole: 'partner', action: v.publish ? 'offer.published' : 'offer.created', entityType: 'offer', entityId: offer!.id, metadata: { partnerId: partner.id, flightNumber, fareMinor: v.fareMinor } });
    return offer!;
  });
}

async function ownOffer(db: DbOrTx, partnerId: string, offerId: string) {
  const [o] = await db.select().from(flightOffers).where(eq(flightOffers.id, offerId));
  if (!o || o.partnerId !== partnerId) throw notFound('Offer');
  return o;
}

const TRANSITIONS: Record<OfferStatus, OfferStatus[]> = {
  draft: ['published', 'withdrawn'],
  published: ['paused', 'withdrawn'],
  paused: ['published', 'withdrawn'],
  expired: [],
  withdrawn: [],
};

export async function setOfferStatus(ctx: AppContext, partner: PartnerRow, actorId: string, offerId: string, to: OfferStatus) {
  const o = await ownOffer(ctx.db, partner.id, offerId);
  if (!TRANSITIONS[o.status].includes(to)) throw conflict('invalid_transition', `A ${o.status} offer cannot be ${to}.`);
  if (to === 'published' && o.validUntil <= new Date()) throw conflict('offer_expired', 'This offer has already ended. Create a new one.');
  const [updated] = await ctx.db.update(flightOffers).set({ status: to }).where(eq(flightOffers.id, offerId)).returning();
  await recordAudit(ctx.db, { actorUserId: actorId, actorRole: 'partner', action: `offer.${to}`, entityType: 'offer', entityId: offerId, metadata: { partnerId: partner.id, from: o.status } });
  return updated!;
}

/** Edits apply to future sales only; existing bookings keep the itinerary and price they bought. */
export async function updateOffer(ctx: AppContext, partner: PartnerRow, actorId: string, offerId: string, patch: { fareMinor?: number; taxesMinor?: number; inventoryCap?: number; validUntil?: string; fareRules?: string }) {
  const o = await ownOffer(ctx.db, partner.id, offerId);
  if (o.status === 'withdrawn' || o.status === 'expired') throw conflict('offer_closed', 'Closed offers cannot be edited.');
  const fare = patch.fareMinor ?? o.fareMinor;
  const taxes = patch.taxesMinor ?? o.taxesMinor;
  if (taxes > fare) throw badRequest('Taxes cannot exceed the all-inclusive fare.');
  if (o.referenceFareMinor !== null && fare >= o.referenceFareMinor) throw badRequest('The fare must stay below the regular fare you referenced.');
  if (patch.inventoryCap !== undefined && patch.inventoryCap < o.seatsSold) throw conflict('cap_below_sold', `${o.seatsSold} seats are already sold at this fare.`);
  if (patch.validUntil) {
    const [f] = await ctx.db.select().from(flights).where(eq(flights.id, o.flightId));
    if (new Date(patch.validUntil) > f!.departAt) throw badRequest('The offer must close before departure.');
  }
  const [updated] = await ctx.db
    .update(flightOffers)
    .set({ fareMinor: fare, taxesMinor: taxes, inventoryCap: patch.inventoryCap ?? o.inventoryCap, validUntil: patch.validUntil ? new Date(patch.validUntil) : o.validUntil, fareRules: patch.fareRules ?? o.fareRules })
    .where(eq(flightOffers.id, offerId))
    .returning();
  await recordAudit(ctx.db, { actorUserId: actorId, actorRole: 'partner', action: 'offer.updated', entityType: 'offer', entityId: offerId, metadata: { partnerId: partner.id, changes: patch } });
  return updated!;
}

export async function listPartnerOffers(ctx: AppContext, partnerId: string) {
  const rows = await ctx.db
    .select({ o: flightOffers, f: flights })
    .from(flightOffers)
    .innerJoin(flights, eq(flights.id, flightOffers.flightId))
    .where(eq(flightOffers.partnerId, partnerId))
    .orderBy(desc(flights.departAt))
    .limit(300);
  return rows.map(({ o, f }) => ({
    id: o.id,
    status: o.validUntil <= new Date() && o.status === 'published' ? 'expired' : o.status,
    flightNumber: f.flightNumber,
    airlineCode: f.airlineCode,
    origin: f.origin,
    destination: f.destination,
    departAt: f.departAt.toISOString(),
    arriveAt: f.arriveAt.toISOString(),
    cabin: o.cabin,
    fareMinor: o.fareMinor,
    taxesMinor: o.taxesMinor,
    referenceFareMinor: o.referenceFareMinor,
    inventoryCap: o.inventoryCap,
    seatsSold: o.seatsSold,
    seatsRemaining: remainingSeats(o),
    refundable: o.refundable,
    validFrom: o.validFrom.toISOString(),
    validUntil: o.validUntil.toISOString(),
    fareRules: o.fareRules,
  }));
}

/** Aggregates for the partner dashboard. Only bookings on this partner's offers are counted. */
export async function partnerStats(ctx: AppContext, partnerId: string) {
  const offerIds = (await ctx.db.select({ id: flightOffers.id }).from(flightOffers).where(eq(flightOffers.partnerId, partnerId))).map((r) => r.id);
  if (!offerIds.length) return { offers: 0, published: 0, bookings: 0, confirmed: 0, seatsSold: 0, grossBookingValueMinor: 0, cancelled: 0, refundedMinor: 0, ticketingFailed: 0 };
  const [b] = await ctx.db
    .select({
      bookings: sql<number>`count(*)::int`,
      confirmed: sql<number>`count(*) filter (where ${flightBookings.status} = 'confirmed')::int`,
      seats: sql<number>`coalesce(sum(${flightBookings.adults}) filter (where ${flightBookings.status} = 'confirmed'), 0)::int`,
      gbv: sql<number>`coalesce(sum(${flightBookings.totalMinor}) filter (where ${flightBookings.status} in ('confirmed', 'cancelled')), 0)::int`,
      cancelled: sql<number>`count(*) filter (where ${flightBookings.status} = 'cancelled')::int`,
      failed: sql<number>`count(*) filter (where ${flightBookings.status} = 'ticketing_failed')::int`,
    })
    .from(flightBookings)
    .where(inArray(flightBookings.offerId, offerIds));
  const [r] = await ctx.db
    .select({ refunded: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::int` })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .innerJoin(flightBookings, eq(flightBookings.id, payments.referenceId))
    .where(and(eq(payments.purpose, 'flight_booking'), eq(refunds.status, 'succeeded'), inArray(flightBookings.offerId, offerIds)));
  const [o] = await ctx.db
    .select({ total: sql<number>`count(*)::int`, published: sql<number>`count(*) filter (where ${flightOffers.status} = 'published' and ${flightOffers.validUntil} > now())::int` })
    .from(flightOffers)
    .where(eq(flightOffers.partnerId, partnerId));
  return {
    offers: Number(o!.total),
    published: Number(o!.published),
    bookings: Number(b!.bookings),
    confirmed: Number(b!.confirmed),
    seatsSold: Number(b!.seats),
    grossBookingValueMinor: Number(b!.gbv),
    cancelled: Number(b!.cancelled),
    refundedMinor: Number(r!.refunded),
    ticketingFailed: Number(b!.failed),
  };
}

/** Bookings on the partner's offers: references, status and seats, without passenger personal data. */
export async function partnerBookings(ctx: AppContext, partnerId: string) {
  const rows = await ctx.db
    .select({ b: flightBookings, f: flights })
    .from(flightBookings)
    .innerJoin(flightOffers, eq(flightOffers.id, flightBookings.offerId))
    .innerJoin(flights, eq(flights.id, flightOffers.flightId))
    .where(eq(flightOffers.partnerId, partnerId))
    .orderBy(desc(flightBookings.createdAt))
    .limit(300);
  return rows.map(({ b, f }) => ({
    reference: b.reference,
    status: b.status,
    seats: b.adults,
    totalMinor: b.totalMinor,
    pnr: b.pnr,
    flightNumber: f.flightNumber,
    departAt: f.departAt.toISOString(),
    createdAt: b.createdAt.toISOString(),
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    refundDueMinor: b.refundDueMinor,
  }));
}

export async function partnerAudit(ctx: AppContext, partnerId: string) {
  return ctx.db
    .select()
    .from(auditEvents)
    .where(sql`${auditEvents.metadata}->>'partnerId' = ${partnerId}`)
    .orderBy(desc(auditEvents.createdAt))
    .limit(200);
}

/** On approval, authorise the requested airlines and make sure they exist for display. */
export async function authoriseAirlines(db: DbOrTx, partner: PartnerRow, sandbox: boolean) {
  for (const a of partner.requestedAirlines) {
    await db.insert(airlines).values({ code: a.code, name: a.name, isSandbox: sandbox }).onConflictDoNothing();
  }
  await db.update(partners).set({ authorisedAirlines: partner.requestedAirlines.map((a) => a.code) }).where(eq(partners.id, partner.id));
}
