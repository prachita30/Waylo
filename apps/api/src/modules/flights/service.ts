import { addDays, localDate, localHour, zonedDayRange } from '@waylo/shared';
import { and, eq, gt, gte, inArray, lt, lte, notInArray, sql } from 'drizzle-orm';
import type { AirlineAirport, AirlineOffer, CabinClass } from '../../adapters/airline/types';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { airlines, airports, cities, flightOffers, flights } from '../../db/schema';
import { badRequest, notFound } from '../../http/errors';

export type DepartureWindow = 'early' | 'morning' | 'afternoon' | 'evening' | 'night';
/** Local-hour ranges [from, to) for departure-time filters. */
export const WINDOWS: Record<DepartureWindow, [number, number]> = {
  early: [0, 6],
  morning: [6, 12],
  afternoon: [12, 17],
  evening: [17, 21],
  night: [21, 24],
};

export interface SearchParams {
  from: string;
  to: string;
  date: string;
  adults: number;
  cabin: CabinClass;
  maxPrice?: number;
  windows?: DepartureWindow[];
  sort: 'price' | 'departure' | 'duration';
  flex: boolean;
  refundableOnly?: boolean;
  page: number;
  pageSize: number;
}

async function loadAirport(db: DbOrTx, code: string): Promise<AirlineAirport & { city: string; name: string }> {
  const [a] = await db
    .select({ code: airports.code, lat: airports.lat, lng: airports.lng, timezone: airports.timezone, city: cities.name, name: airports.name })
    .from(airports)
    .innerJoin(cities, eq(cities.id, airports.cityId))
    .where(eq(airports.code, code));
  if (!a) throw badRequest(`Unknown airport ${code}.`);
  return a;
}

const synced = new WeakSet<AppContext>();
/** Registers the adapter's airlines once per app instance (idempotent). */
export async function syncAirlines(ctx: AppContext) {
  if (synced.has(ctx)) return;
  const list = ctx.adapters.airline.airlines();
  if (list.length) {
    await ctx.db
      .insert(airlines)
      .values(list.map((a) => ({ code: a.code, name: a.name, isSandbox: a.isSandbox, brandColor: a.brandColor })))
      .onConflictDoUpdate({ target: airlines.code, set: { name: sql`excluded.name`, isSandbox: sql`excluded.is_sandbox`, brandColor: sql`excluded.brand_color` } });
  }
  synced.add(ctx);
}

/**
 * Stores adapter results as the local offer cache. Adapter-sourced offers for the same route, day
 * and cabin that the airline no longer returns are withdrawn, so stale fares are never shown.
 */
export async function upsertAdapterOffers(ctx: AppContext, list: AirlineOffer[], scope: { origin: string; destination: string; dayStart: Date; dayEnd: Date; cabin: CabinClass }) {
  const source = ctx.adapters.airline.info.provider;
  await ctx.db.transaction(async (tx) => {
    const keep: string[] = [];
    for (const o of list) {
      const [flight] = await tx
        .insert(flights)
        .values({ airlineCode: o.airlineCode, flightNumber: o.flightNumber, origin: o.origin, destination: o.destination, departAt: o.departAt, arriveAt: o.arriveAt })
        .onConflictDoUpdate({ target: [flights.airlineCode, flights.flightNumber, flights.departAt], set: { arriveAt: o.arriveAt } })
        .returning({ id: flights.id });
      const values = {
        flightId: flight!.id,
        source,
        externalRef: o.externalRef,
        cabin: o.cabin,
        fareMinor: o.fareMinor,
        taxesMinor: o.taxesMinor,
        referenceFareMinor: o.referenceFareMinor,
        referenceSource: o.referenceSource,
        currency: o.currency,
        baggageCabinKg: o.baggageCabinKg,
        baggageCheckedKg: o.baggageCheckedKg,
        refundable: o.refundable,
        changeFeeMinor: o.changeFeeMinor,
        cancelFeeMinor: o.cancelFeeMinor,
        fareRules: o.fareRules,
        seatsAvailable: o.seatsAvailable,
        validFrom: o.validFrom,
        validUntil: o.validUntil,
        status: 'published' as const,
      };
      const { flightId: _f, source: _s, externalRef: _e, ...updatable } = values;
      await tx.insert(flightOffers).values(values).onConflictDoUpdate({ target: [flightOffers.source, flightOffers.externalRef], set: updatable });
      keep.push(o.externalRef);
    }
    const stale = tx
      .select({ id: flightOffers.id })
      .from(flightOffers)
      .innerJoin(flights, eq(flights.id, flightOffers.flightId))
      .where(
        and(
          eq(flightOffers.source, source),
          eq(flightOffers.cabin, scope.cabin),
          eq(flightOffers.status, 'published'),
          eq(flights.origin, scope.origin),
          eq(flights.destination, scope.destination),
          gte(flights.departAt, scope.dayStart),
          lt(flights.departAt, scope.dayEnd),
          keep.length ? notInArray(flightOffers.externalRef, keep) : sql`true`,
        ),
      );
    await tx.update(flightOffers).set({ status: 'withdrawn' }).where(inArray(flightOffers.id, stale));
  });
}

/** Seats WAYLO can still sell at this fare: the lower of airline-reported seats and the partner cap. */
export function remainingSeats(o: { seatsAvailable: number | null; inventoryCap: number | null; seatsSold: number }): number | null {
  const fromCap = o.inventoryCap === null ? null : Math.max(0, o.inventoryCap - o.seatsSold);
  if (o.seatsAvailable === null) return fromCap;
  return fromCap === null ? o.seatsAvailable : Math.min(o.seatsAvailable, fromCap);
}

const offerColumns = {
  id: flightOffers.id,
  source: flightOffers.source,
  cabin: flightOffers.cabin,
  fareMinor: flightOffers.fareMinor,
  taxesMinor: flightOffers.taxesMinor,
  referenceFareMinor: flightOffers.referenceFareMinor,
  referenceSource: flightOffers.referenceSource,
  currency: flightOffers.currency,
  baggageCabinKg: flightOffers.baggageCabinKg,
  baggageCheckedKg: flightOffers.baggageCheckedKg,
  refundable: flightOffers.refundable,
  changeFeeMinor: flightOffers.changeFeeMinor,
  cancelFeeMinor: flightOffers.cancelFeeMinor,
  fareRules: flightOffers.fareRules,
  eligibility: flightOffers.eligibility,
  seatsAvailable: flightOffers.seatsAvailable,
  inventoryCap: flightOffers.inventoryCap,
  seatsSold: flightOffers.seatsSold,
  validUntil: flightOffers.validUntil,
  status: flightOffers.status,
  flightId: flights.id,
  airlineCode: flights.airlineCode,
  airlineName: airlines.name,
  airlineColor: airlines.brandColor,
  airlineSandbox: airlines.isSandbox,
  flightNumber: flights.flightNumber,
  origin: flights.origin,
  destination: flights.destination,
  departAt: flights.departAt,
  arriveAt: flights.arriveAt,
  flightStatus: flights.status,
};
type OfferRow = { [K in keyof typeof offerColumns]: (typeof offerColumns)[K]['_']['data'] } & { eligibility: { maxPassengers?: number; minAdvanceHours?: number; notes?: string } };

/** Public shape of an offer. Prices are per adult in minor units; totals are computed for `adults`. */
export function toOfferDto(o: OfferRow, adults: number, now = new Date()) {
  const seatsLeft = remainingSeats(o);
  const maxPassengers = o.eligibility?.maxPassengers;
  const durationMinutes = Math.round((o.arriveAt.getTime() - o.departAt.getTime()) / 60_000);
  const expired = o.validUntil.getTime() <= now.getTime();
  const availability: 'available' | 'limited' | 'sold_out' | 'insufficient' | 'expired' =
    expired || o.status !== 'published'
      ? 'expired'
      : seatsLeft === 0
        ? 'sold_out'
        : (seatsLeft !== null && seatsLeft < adults) || (maxPassengers !== undefined && adults > maxPassengers)
          ? 'insufficient'
          : seatsLeft !== null && seatsLeft <= 4
            ? 'limited'
            : 'available';
  // A saving is shown only against a real, sourced reference fare.
  const saving =
    o.referenceFareMinor && o.referenceSource && o.referenceFareMinor > o.fareMinor
      ? { referenceFareMinor: o.referenceFareMinor, amountMinor: o.referenceFareMinor - o.fareMinor, percent: Math.floor(((o.referenceFareMinor - o.fareMinor) / o.referenceFareMinor) * 100), source: o.referenceSource }
      : null;
  return {
    id: o.id,
    airline: { code: o.airlineCode, name: o.airlineName, color: o.airlineColor, sandbox: o.airlineSandbox },
    flightNumber: o.flightNumber,
    origin: o.origin,
    destination: o.destination,
    departAt: o.departAt.toISOString(),
    arriveAt: o.arriveAt.toISOString(),
    durationMinutes,
    cabin: o.cabin,
    currency: o.currency,
    farePerAdultMinor: o.fareMinor,
    taxesPerAdultMinor: o.taxesMinor,
    totalMinor: o.fareMinor * adults,
    saving,
    baggage: { cabinKg: o.baggageCabinKg, checkedKg: o.baggageCheckedKg },
    conditions: { refundable: o.refundable, changeFeeMinor: o.changeFeeMinor, cancelFeeMinor: o.cancelFeeMinor, rules: o.fareRules },
    eligibility: o.eligibility ?? {},
    seatsLeft,
    availability,
    expiresAt: o.validUntil.toISOString(),
    source: o.source === 'partner' ? 'partner' : 'airline',
    sandbox: o.airlineSandbox,
    flightStatus: o.flightStatus,
  };
}
export type OfferDto = ReturnType<typeof toOfferDto>;

export interface SearchResult {
  query: SearchParams & { origin: { code: string; city: string }; destination: { code: string; city: string } };
  items: OfferDto[];
  total: number;
  page: number;
  pageSize: number;
  priceRange: { minMinor: number; maxMinor: number } | null;
  flexibleDates: { date: string; cheapestMinor: number | null }[] | null;
  warnings: string[];
}

export async function searchFlights(ctx: AppContext, p: SearchParams, now = new Date()): Promise<SearchResult> {
  if (p.from === p.to) throw badRequest('Origin and destination must be different.');
  const [origin, destination] = await Promise.all([loadAirport(ctx.db, p.from), loadAirport(ctx.db, p.to)]);
  const today = localDate(now, origin.timezone);
  if (p.date < today) throw badRequest('Choose today or a future date.');
  if (p.date > addDays(today, 330)) throw badRequest('Flights can be searched up to 330 days ahead.');

  await syncAirlines(ctx);
  const dates = p.flex ? [-3, -2, -1, 0, 1, 2, 3].map((d) => addDays(p.date, d)).filter((d) => d >= today) : [p.date];
  const warnings: string[] = [];

  // Refresh the cache from the airline integration. An outage degrades to partner-published offers only.
  for (const date of dates) {
    const range = zonedDayRange(date, origin.timezone);
    try {
      const list = await ctx.adapters.airline.searchOffers({ origin, destination, date, cabin: p.cabin, adults: p.adults });
      await upsertAdapterOffers(ctx, list, { origin: origin.code, destination: destination.code, dayStart: range.start, dayEnd: range.end, cabin: p.cabin });
    } catch (err) {
      ctx.logger.warn({ err, provider: ctx.adapters.airline.info.provider }, 'airline search failed');
      if (!warnings.includes('airline_unavailable')) warnings.push('airline_unavailable');
    }
  }

  const span = { start: zonedDayRange(dates[0]!, origin.timezone).start, end: zonedDayRange(dates[dates.length - 1]!, origin.timezone).end };
  const rows = (await ctx.db
    .select(offerColumns)
    .from(flightOffers)
    .innerJoin(flights, eq(flights.id, flightOffers.flightId))
    .innerJoin(airlines, eq(airlines.code, flights.airlineCode))
    .where(
      and(
        eq(flights.origin, origin.code),
        eq(flights.destination, destination.code),
        gte(flights.departAt, span.start),
        lt(flights.departAt, span.end),
        gt(flights.departAt, now),
        eq(flightOffers.cabin, p.cabin),
        eq(flightOffers.status, 'published'),
        lte(flightOffers.validFrom, now),
        gt(flightOffers.validUntil, now),
      ),
    )) as OfferRow[];

  const all = rows.map((r) => toOfferDto(r, p.adults, now));
  const sellable = all.filter((o) => o.availability !== 'expired');

  const flexibleDates = p.flex
    ? dates.map((date) => {
        const prices = sellable
          .filter((o) => localDate(new Date(o.departAt), origin.timezone) === date && o.availability !== 'sold_out' && o.availability !== 'insufficient')
          .map((o) => o.farePerAdultMinor);
        return { date, cheapestMinor: prices.length ? Math.min(...prices) : null };
      })
    : null;

  const day = zonedDayRange(p.date, origin.timezone);
  let items = sellable.filter((o) => {
    const t = new Date(o.departAt).getTime();
    return t >= day.start.getTime() && t < day.end.getTime();
  });
  const priceRange = items.length ? { minMinor: Math.min(...items.map((o) => o.farePerAdultMinor)), maxMinor: Math.max(...items.map((o) => o.farePerAdultMinor)) } : null;

  if (p.maxPrice !== undefined) items = items.filter((o) => o.farePerAdultMinor <= p.maxPrice!);
  if (p.refundableOnly) items = items.filter((o) => o.conditions.refundable);
  if (p.windows?.length) {
    items = items.filter((o) => {
      const h = localHour(new Date(o.departAt), origin.timezone);
      return p.windows!.some((w) => h >= WINDOWS[w][0] && h < WINDOWS[w][1]);
    });
  }

  // Bookable offers first, then the requested order; ties broken deterministically.
  const rank = (o: OfferDto) => (o.availability === 'sold_out' || o.availability === 'insufficient' ? 1 : 0);
  const key: Record<SearchParams['sort'], (o: OfferDto) => number> = {
    price: (o) => o.farePerAdultMinor,
    departure: (o) => new Date(o.departAt).getTime(),
    duration: (o) => o.durationMinutes,
  };
  items.sort((a, b) => rank(a) - rank(b) || key[p.sort](a) - key[p.sort](b) || a.departAt.localeCompare(b.departAt) || a.id.localeCompare(b.id));

  const total = items.length;
  const start = (p.page - 1) * p.pageSize;
  return {
    query: { ...p, origin: { code: origin.code, city: origin.city }, destination: { code: destination.code, city: destination.city } },
    items: items.slice(start, start + p.pageSize),
    total,
    page: p.page,
    pageSize: p.pageSize,
    priceRange,
    flexibleDates,
    warnings,
  };
}

export async function getOffer(ctx: AppContext, id: string, adults = 1, now = new Date()) {
  const [row] = (await ctx.db
    .select(offerColumns)
    .from(flightOffers)
    .innerJoin(flights, eq(flights.id, flightOffers.flightId))
    .innerJoin(airlines, eq(airlines.code, flights.airlineCode))
    .where(eq(flightOffers.id, id))
    .limit(1)) as OfferRow[];
  // Drafts were never public; other closed offers stay viewable but show as no longer available.
  if (!row || row.status === 'draft') throw notFound('Offer');
  const [origin, destination] = await Promise.all([loadAirport(ctx.db, row.origin), loadAirport(ctx.db, row.destination)]);
  return {
    ...toOfferDto(row, adults, now),
    originAirport: { code: origin.code, name: origin.name, city: origin.city, timezone: origin.timezone },
    destinationAirport: { code: destination.code, name: destination.name, city: destination.city, timezone: destination.timezone },
  };
}
