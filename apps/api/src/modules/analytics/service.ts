import { addDays, localDate, zonedDayRange } from '@waylo/shared';
import { and, eq, gte, isNotNull, lt, lte, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import {
  flightBookings,
  flightOffers,
  flights,
  operators,
  partners,
  payments,
  priceLocks,
  refunds,
  rideGroups,
  rideParticipants,
  rideRequests,
  rideTrips,
  safetyIncidents,
  searchStats,
} from '../../db/schema';
import { badRequest } from '../../http/errors';

/**
 * Business reporting from the transactional tables. Everything here is an aggregate: no names,
 * emails, phone numbers or passenger details are read or returned. Reporting days are India
 * Standard Time (UTC+05:30, no daylight saving), the home market's calendar.
 */
export const REPORT_TZ = 'Asia/Kolkata';
const IST_OFFSET = sql.raw(`interval '330 minutes'`);
/** Route-level rows with fewer bookings than this are suppressed so small groups cannot be singled out. */
export const MIN_COHORT = 5;
export const MAX_RANGE_DAYS = 366;

export interface Range {
  from: string;
  to: string;
  start: Date;
  end: Date;
}

export function parseRange(from: string | undefined, to: string | undefined, now = new Date()): Range {
  const today = localDate(now, REPORT_TZ);
  const t = to ?? today;
  const f = from ?? addDays(t, -29);
  if (f > t) throw badRequest('The start date must be on or before the end date.');
  const days = Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) throw badRequest(`Reports cover at most ${MAX_RANGE_DAYS} days.`);
  return { from: f, to: t, start: zonedDayRange(f, REPORT_TZ).start, end: zonedDayRange(t, REPORT_TZ).end };
}

/** Local reporting day of a timestamptz column, as yyyy-mm-dd. */
const dayOf = (col: unknown) => sql<string>`to_char((${col} at time zone 'UTC') + ${IST_OFFSET}, 'YYYY-MM-DD')`;
const int = (expr: ReturnType<typeof sql>) => sql<number>`coalesce(${expr}, 0)::bigint`;
const n = (v: unknown) => Number(v ?? 0);
const ratio = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);

const PAID = sql`exists (select 1 from ${payments} p where p.purpose = 'flight_booking' and p.reference_id = ${flightBookings.id} and p.status in ('succeeded', 'refunded', 'partially_refunded'))`;
/** Saving per adult against the sourced reference fare captured in the booking snapshot. */
const SAVING_PER_ADULT = sql`greatest(coalesce((${flightBookings.snapshot}->'saving'->>'referenceFareMinor')::int - (${flightBookings.snapshot}->>'farePerAdultMinor')::int, 0), 0)`;

export async function summary(ctx: AppContext, r: Range) {
  const inRange = (col: Parameters<typeof gte>[0]) => and(gte(col, r.start), lt(col, r.end));
  const [search] = await ctx.db
    .select({ searches: int(sql`sum(${searchStats.searches})`), withResults: int(sql`sum(${searchStats.withResults})`) })
    .from(searchStats)
    .where(and(gte(searchStats.day, r.from), lte(searchStats.day, r.to)));
  // Search counting began with the search_stats table; earlier demand is unknown, not zero.
  const [since] = await ctx.db.select({ day: sql<string | null>`min(${searchStats.day})::text` }).from(searchStats);
  const [locks] = await ctx.db.select({ n: sql<number>`count(*)` }).from(priceLocks).where(inRange(priceLocks.createdAt));
  const [started] = await ctx.db
    .select({ started: sql<number>`count(*)`, paid: sql<number>`count(*) filter (where ${PAID})` })
    .from(flightBookings)
    .where(inRange(flightBookings.createdAt));
  const [ticketed] = await ctx.db
    .select({
      bookings: sql<number>`count(*)`,
      seats: int(sql`sum(${flightBookings.adults})`),
      gbv: int(sql`sum(${flightBookings.totalMinor})`),
      cancelled: sql<number>`count(*) filter (where ${flightBookings.status} = 'cancelled')`,
      withSaving: sql<number>`count(*) filter (where ${SAVING_PER_ADULT} > 0)`,
      savings: int(sql`sum(${SAVING_PER_ADULT} * ${flightBookings.adults})`),
      referenceTotal: int(sql`sum(((${flightBookings.snapshot}->'saving'->>'referenceFareMinor')::int) * ${flightBookings.adults}) filter (where ${SAVING_PER_ADULT} > 0)`),
      partnerBookings: sql<number>`count(*) filter (where ${flightOffers.source} = 'partner')`,
    })
    .from(flightBookings)
    .innerJoin(flightOffers, eq(flightOffers.id, flightBookings.offerId))
    .where(and(isNotNull(flightBookings.ticketedAt), inRange(flightBookings.ticketedAt)));
  const [failed] = await ctx.db.select({ n: sql<number>`count(*)` }).from(flightBookings).where(and(eq(flightBookings.status, 'ticketing_failed'), inRange(flightBookings.createdAt)));

  const [req] = await ctx.db
    .select({
      requests: sql<number>`count(*)`,
      matched: sql<number>`count(*) filter (where ${rideRequests.status} in ('matched', 'completed'))`,
      noMatch: sql<number>`count(*) filter (where ${rideRequests.status} = 'no_match')`,
      expired: sql<number>`count(*) filter (where ${rideRequests.status} = 'expired')`,
      cancelled: sql<number>`count(*) filter (where ${rideRequests.status} = 'cancelled')`,
    })
    .from(rideRequests)
    .where(inRange(rideRequests.createdAt));
  const [groups] = await ctx.db
    .select({
      completed: sql<number>`count(*)`,
      avgFill: sql<number>`avg(${rideGroups.seatsTaken}::float / nullif(${rideGroups.seatCapacity}, 0))`,
      avgParties: sql<number>`avg(${rideGroups.parties})`,
      subsidy: int(sql`sum(${rideGroups.platformSubsidyMinor})`),
    })
    .from(rideGroups)
    .innerJoin(rideTrips, eq(rideTrips.groupId, rideGroups.id))
    .where(and(eq(rideGroups.status, 'completed'), isNotNull(rideTrips.completedAt), inRange(rideTrips.completedAt)));
  const [riders] = await ctx.db
    .select({
      riders: sql<number>`count(*)`,
      revenue: int(sql`sum(${rideParticipants.finalTotalMinor})`),
      soloTotal: int(sql`sum(${rideParticipants.soloTotalMinor})`),
      saved: int(sql`sum(greatest(${rideParticipants.soloTotalMinor} - ${rideParticipants.finalTotalMinor}, 0))`),
    })
    .from(rideParticipants)
    .innerJoin(rideTrips, eq(rideTrips.groupId, rideParticipants.groupId))
    .where(and(eq(rideParticipants.status, 'completed'), isNotNull(rideParticipants.finalTotalMinor), isNotNull(rideTrips.completedAt), inRange(rideTrips.completedAt)));

  const [ref] = await ctx.db
    .select({
      succeeded: sql<number>`count(*) filter (where ${refunds.status} = 'succeeded')`,
      amount: int(sql`sum(${refunds.amountMinor}) filter (where ${refunds.status} = 'succeeded')`),
      failed: sql<number>`count(*) filter (where ${refunds.status} = 'failed')`,
    })
    .from(refunds)
    .where(inRange(refunds.createdAt));

  const s = { searches: n(search?.searches), withResults: n(search?.withResults) };
  const resolved = n(req!.matched) + n(req!.noMatch) + n(req!.expired);
  return {
    range: { from: r.from, to: r.to, timeZone: REPORT_TZ },
    flights: {
      searches: s.searches,
      searchesWithResults: s.withResults,
      searchesRecordedSince: since?.day ?? null,
      priceLocks: n(locks!.n),
      bookingsStarted: n(started!.started),
      bookingsPaid: n(started!.paid),
      bookingsTicketed: n(ticketed!.bookings),
      seatsTicketed: n(ticketed!.seats),
      grossBookingValueMinor: n(ticketed!.gbv),
      cancelledAfterTicketing: n(ticketed!.cancelled),
      ticketingFailed: n(failed!.n),
      partnerShare: ratio(n(ticketed!.partnerBookings), n(ticketed!.bookings)),
      // Conversion is reported between steps we actually observe; searches are anonymous counts.
      conversion: {
        searchToLock: ratio(n(locks!.n), s.searches),
        lockToBooking: ratio(n(started!.started), n(locks!.n)),
        bookingToPaid: ratio(n(started!.paid), n(started!.started)),
      },
      savings: {
        bookingsWithSourcedSaving: n(ticketed!.withSaving),
        totalMinor: n(ticketed!.savings),
        averagePercent: n(ticketed!.referenceTotal) > 0 ? Math.round((n(ticketed!.savings) / n(ticketed!.referenceTotal)) * 1000) / 10 : null,
      },
    },
    rides: {
      requests: n(req!.requests),
      matched: n(req!.matched),
      noMatch: n(req!.noMatch),
      expired: n(req!.expired),
      cancelled: n(req!.cancelled),
      matchRate: ratio(n(req!.matched), resolved),
      completedTrips: n(groups!.completed),
      averageSeatFill: groups!.avgFill === null ? null : Math.round(Number(groups!.avgFill) * 1000) / 1000,
      averagePartiesPerTrip: groups!.avgParties === null ? null : Math.round(Number(groups!.avgParties) * 10) / 10,
      platformSubsidyMinor: n(groups!.subsidy),
      ridersCompleted: n(riders!.riders),
      riderRevenueMinor: n(riders!.revenue),
      riderSavingsVsSoloMinor: n(riders!.saved),
      averageSavingVsSoloPercent: n(riders!.soloTotal) > 0 ? Math.round((n(riders!.saved) / n(riders!.soloTotal)) * 1000) / 10 : null,
    },
    refunds: { succeeded: n(ref!.succeeded), amountMinor: n(ref!.amount), failed: n(ref!.failed) },
  };
}

/** One row per reporting day in the range, including days with no activity. */
export async function daily(ctx: AppContext, r: Range) {
  const inRange = (col: Parameters<typeof gte>[0]) => and(gte(col, r.start), lt(col, r.end));
  const [searches, bookings, requests, trips] = await Promise.all([
    ctx.db
      .select({ day: searchStats.day, n: int(sql`sum(${searchStats.searches})`) })
      .from(searchStats)
      .where(and(gte(searchStats.day, r.from), lte(searchStats.day, r.to)))
      .groupBy(searchStats.day),
    ctx.db
      .select({ day: dayOf(flightBookings.ticketedAt), n: sql<number>`count(*)`, gbv: int(sql`sum(${flightBookings.totalMinor})`) })
      .from(flightBookings)
      .where(and(isNotNull(flightBookings.ticketedAt), inRange(flightBookings.ticketedAt)))
      .groupBy(dayOf(flightBookings.ticketedAt)),
    ctx.db.select({ day: dayOf(rideRequests.createdAt), n: sql<number>`count(*)` }).from(rideRequests).where(inRange(rideRequests.createdAt)).groupBy(dayOf(rideRequests.createdAt)),
    ctx.db
      .select({ day: dayOf(rideTrips.completedAt), n: sql<number>`count(*)` })
      .from(rideTrips)
      .where(and(isNotNull(rideTrips.completedAt), inRange(rideTrips.completedAt)))
      .groupBy(dayOf(rideTrips.completedAt)),
  ]);
  const by = <T extends { day: string }>(rows: T[]) => new Map(rows.map((x) => [x.day, x]));
  const [s, b, q, t] = [by(searches), by(bookings), by(requests), by(trips)];
  const out = [];
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
    out.push({
      day: d,
      searches: n(s.get(d)?.n),
      bookingsTicketed: n(b.get(d)?.n),
      grossBookingValueMinor: n(b.get(d)?.gbv),
      rideRequests: n(q.get(d)?.n),
      ridesCompleted: n(t.get(d)?.n),
    });
  }
  return out;
}

/** Demand and sales per route. Booking figures under the minimum cohort size are withheld. */
export async function routes(ctx: AppContext, r: Range) {
  const [demand, sales] = await Promise.all([
    ctx.db
      .select({ origin: searchStats.origin, destination: searchStats.destination, searches: int(sql`sum(${searchStats.searches})`), withResults: int(sql`sum(${searchStats.withResults})`) })
      .from(searchStats)
      .where(and(gte(searchStats.day, r.from), lte(searchStats.day, r.to)))
      .groupBy(searchStats.origin, searchStats.destination),
    ctx.db
      .select({
        origin: flights.origin,
        destination: flights.destination,
        bookings: sql<number>`count(*)`,
        gbv: int(sql`sum(${flightBookings.totalMinor})`),
        savings: int(sql`sum(${SAVING_PER_ADULT} * ${flightBookings.adults})`),
      })
      .from(flightBookings)
      .innerJoin(flightOffers, eq(flightOffers.id, flightBookings.offerId))
      .innerJoin(flights, eq(flights.id, flightOffers.flightId))
      .where(and(isNotNull(flightBookings.ticketedAt), gte(flightBookings.ticketedAt, r.start), lt(flightBookings.ticketedAt, r.end)))
      .groupBy(flights.origin, flights.destination),
  ]);
  const key = (o: string, d: string) => `${o}-${d}`;
  const rows = new Map<string, { origin: string; destination: string; searches: number; searchesWithResults: number; bookings: number | null; grossBookingValueMinor: number | null; savingsMinor: number | null; suppressed: boolean }>();
  for (const x of demand) rows.set(key(x.origin, x.destination), { origin: x.origin, destination: x.destination, searches: n(x.searches), searchesWithResults: n(x.withResults), bookings: 0, grossBookingValueMinor: 0, savingsMinor: 0, suppressed: false });
  for (const x of sales) {
    const k = key(x.origin, x.destination);
    const row = rows.get(k) ?? { origin: x.origin, destination: x.destination, searches: 0, searchesWithResults: 0, bookings: 0, grossBookingValueMinor: 0, savingsMinor: 0, suppressed: false };
    Object.assign(row, { bookings: n(x.bookings), grossBookingValueMinor: n(x.gbv), savingsMinor: n(x.savings) });
    rows.set(k, row);
  }
  return [...rows.values()]
    .map((row) => (row.bookings !== null && row.bookings > 0 && row.bookings < MIN_COHORT ? { ...row, bookings: null, grossBookingValueMinor: null, savingsMinor: null, suppressed: true } : row))
    .sort((a, b) => b.searches - a.searches || a.origin.localeCompare(b.origin) || a.destination.localeCompare(b.destination));
}

/** Sales by airline or distribution partner (business entities, not individuals). */
export async function partnerReport(ctx: AppContext, r: Range) {
  const rows = await ctx.db
    .select({
      partnerId: partners.id,
      name: partners.name,
      status: partners.status,
      bookings: sql<number>`count(${flightBookings.id}) filter (where ${flightBookings.ticketedAt} >= ${r.start} and ${flightBookings.ticketedAt} < ${r.end})`,
      seats: int(sql`sum(${flightBookings.adults}) filter (where ${flightBookings.ticketedAt} >= ${r.start} and ${flightBookings.ticketedAt} < ${r.end})`),
      gbv: int(sql`sum(${flightBookings.totalMinor}) filter (where ${flightBookings.ticketedAt} >= ${r.start} and ${flightBookings.ticketedAt} < ${r.end})`),
      cancelled: sql<number>`count(${flightBookings.id}) filter (where ${flightBookings.status} = 'cancelled' and ${flightBookings.cancelledAt} >= ${r.start} and ${flightBookings.cancelledAt} < ${r.end})`,
      failed: sql<number>`count(${flightBookings.id}) filter (where ${flightBookings.status} = 'ticketing_failed' and ${flightBookings.createdAt} >= ${r.start} and ${flightBookings.createdAt} < ${r.end})`,
    })
    .from(partners)
    .leftJoin(flightOffers, eq(flightOffers.partnerId, partners.id))
    .leftJoin(flightBookings, eq(flightBookings.offerId, flightOffers.id))
    .groupBy(partners.id, partners.name, partners.status);
  const live = await ctx.db
    .select({ partnerId: flightOffers.partnerId, n: sql<number>`count(*)` })
    .from(flightOffers)
    .where(and(isNotNull(flightOffers.partnerId), eq(flightOffers.status, 'published'), gte(flightOffers.validUntil, new Date())))
    .groupBy(flightOffers.partnerId);
  const liveBy = new Map(live.map((l) => [l.partnerId, n(l.n)]));
  return rows
    .map((x) => ({
      partnerId: x.partnerId,
      name: x.name,
      status: x.status,
      liveOffers: liveBy.get(x.partnerId) ?? 0,
      bookingsTicketed: n(x.bookings),
      seatsTicketed: n(x.seats),
      grossBookingValueMinor: n(x.gbv),
      cancellations: n(x.cancelled),
      ticketingFailures: n(x.failed),
    }))
    .sort((a, b) => b.grossBookingValueMinor - a.grossBookingValueMinor || a.name.localeCompare(b.name));
}

/** Trip volume, earnings and service quality by fleet operator. */
export async function operatorReport(ctx: AppContext, r: Range) {
  const rows = await ctx.db
    .select({
      operatorId: operators.id,
      name: operators.name,
      status: operators.status,
      trips: sql<number>`count(${rideTrips.groupId}) filter (where ${rideTrips.completedAt} >= ${r.start} and ${rideTrips.completedAt} < ${r.end})`,
      earnings: int(sql`sum(${rideTrips.operatorEarningMinor}) filter (where ${rideTrips.completedAt} >= ${r.start} and ${rideTrips.completedAt} < ${r.end})`),
      commission: int(sql`sum(${rideTrips.commissionMinor}) filter (where ${rideTrips.completedAt} >= ${r.start} and ${rideTrips.completedAt} < ${r.end})`),
      offRoute: sql<number>`count(${rideTrips.groupId}) filter (where ${rideTrips.offRouteSince} is not null and ${rideTrips.completedAt} >= ${r.start} and ${rideTrips.completedAt} < ${r.end})`,
    })
    .from(operators)
    .leftJoin(rideTrips, eq(rideTrips.operatorId, operators.id))
    .groupBy(operators.id, operators.name, operators.status);
  const incidents = await ctx.db
    .select({ operatorId: safetyIncidents.operatorId, n: sql<number>`count(*)` })
    .from(safetyIncidents)
    .where(and(isNotNull(safetyIncidents.operatorId), gte(safetyIncidents.createdAt, r.start), lt(safetyIncidents.createdAt, r.end)))
    .groupBy(safetyIncidents.operatorId);
  const incBy = new Map(incidents.map((i) => [i.operatorId, n(i.n)]));
  return rows
    .map((x) => ({
      operatorId: x.operatorId,
      name: x.name,
      status: x.status,
      tripsCompleted: n(x.trips),
      operatorEarningsMinor: n(x.earnings),
      commissionMinor: n(x.commission),
      tripsWithOffRouteAlert: n(x.offRoute),
      incidents: incBy.get(x.operatorId) ?? 0,
    }))
    .sort((a, b) => b.tripsCompleted - a.tripsCompleted || a.name.localeCompare(b.name));
}

/**
 * CSV with RFC 4180 quoting. Cells that a spreadsheet would treat as a formula (= + - @, tab, CR)
 * are prefixed with an apostrophe so an exported file cannot execute anything when opened.
 */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}
