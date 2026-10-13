import { addDays, localDate, localHour, zonedTimeToUtc } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SandboxAirlineAdapter } from '../../adapters/airline/sandbox';
import { airlines, flightOffers, flights } from '../../db/schema';
import { createTestApp, type TestApp } from '../../test/harness';
import { remainingSeats, type OfferDto } from './service';

const TZ = 'Asia/Kolkata';
const today = localDate(new Date(), TZ);
const D10 = addDays(today, 10);
const airline = new SandboxAirlineAdapter();

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({}, { adapters: { airline } });
});
afterAll(() => t.close());

const search = (q: Record<string, string | number>) =>
  t.agent().get('/api/v1/flights/search').query({ from: 'BOM', to: 'GOI', date: D10, ...q });

async function addPartnerOffer(over: Partial<typeof flightOffers.$inferInsert> = {}, departTime = '12:00', date = D10) {
  await t.ctx.db.insert(airlines).values({ code: 'P9', name: 'Partner Test Air', isSandbox: true }).onConflictDoNothing();
  const departAt = zonedTimeToUtc(date, departTime, TZ);
  const [f] = await t.ctx.db
    .insert(flights)
    .values({ airlineCode: 'P9', flightNumber: `P9${Math.floor(Math.random() * 900 + 100)}`, origin: 'BOM', destination: 'GOI', departAt, arriveAt: new Date(departAt.getTime() + 75 * 60_000) })
    .returning();
  const [o] = await t.ctx.db
    .insert(flightOffers)
    .values({
      flightId: f!.id,
      source: 'partner',
      externalRef: `test-${Math.random()}`,
      cabin: 'economy',
      fareMinor: 99_900,
      taxesMinor: 20_000,
      validUntil: new Date(departAt.getTime() - 3_600_000),
      ...over,
    })
    .returning();
  return o!;
}

describe('sandbox airline adapter', () => {
  it('is deterministic for the same query', async () => {
    const q = { origin: { code: 'BOM', lat: 19.09, lng: 72.87, timezone: TZ }, destination: { code: 'GOI', lat: 15.38, lng: 73.83, timezone: TZ }, date: D10, cabin: 'economy' as const, adults: 1 };
    const a = await airline.searchOffers(q);
    const b = await airline.searchOffers(q);
    expect(a.length).toBeGreaterThan(3);
    expect(a).toEqual(b);
  });

  it('only releases last-minute fares within 72 hours of departure', async () => {
    const q = { origin: { code: 'BOM', lat: 19.09, lng: 72.87, timezone: TZ }, destination: { code: 'DEL', lat: 28.56, lng: 77.1, timezone: TZ }, date: D10, cabin: 'economy' as const, adults: 1 };
    const far = await airline.searchOffers(q);
    expect(far.some((o) => o.externalRef.endsWith('-LM'))).toBe(false);
  });
});

describe('GET /flights/search', () => {
  it('returns offers sorted by price with totals for all travellers', async () => {
    const res = await search({ adults: 2 });
    expect(res.status).toBe(200);
    const items: OfferDto[] = res.body.items;
    expect(items.length).toBeGreaterThan(3);
    const bookable = items.filter((o) => !['sold_out', 'insufficient'].includes(o.availability));
    const prices = bookable.map((o) => o.farePerAdultMinor);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    for (const o of items) {
      expect(o.totalMinor).toBe(o.farePerAdultMinor * 2);
      expect(Number.isInteger(o.totalMinor)).toBe(true);
      expect(o.sandbox).toBe(true);
      expect(o.origin).toBe('BOM');
      expect(localDate(new Date(o.departAt), TZ)).toBe(D10);
    }
    expect(res.body.query.origin.city).toBe('Mumbai');
  });

  it('shows a saving only when a sourced reference fare exists', async () => {
    const res = await search({});
    for (const o of res.body.items as OfferDto[]) {
      if (o.saving) {
        expect(o.saving.source).toBeTruthy();
        expect(o.saving.referenceFareMinor).toBeGreaterThan(o.farePerAdultMinor);
        expect(o.saving.amountMinor).toBe(o.saving.referenceFareMinor - o.farePerAdultMinor);
      }
    }
    const partner = await addPartnerOffer({ referenceFareMinor: 500_000, referenceSource: null });
    const again = await search({ sort: 'departure' });
    const found = (again.body.items as OfferDto[]).find((o) => o.id === partner.id)!;
    expect(found.saving).toBeNull();
  });

  it('filters by max price, departure window and refundability', async () => {
    const all: OfferDto[] = (await search({ pageSize: 50 })).body.items;
    const median = [...all].map((o) => o.farePerAdultMinor).sort((a, b) => a - b)[Math.floor(all.length / 2)]!;
    const cheap: OfferDto[] = (await search({ maxPrice: median, pageSize: 50 })).body.items;
    expect(cheap.length).toBeGreaterThan(0);
    expect(cheap.every((o) => o.farePerAdultMinor <= median)).toBe(true);

    const morning: OfferDto[] = (await search({ windows: 'morning', pageSize: 50 })).body.items;
    expect(morning.every((o) => { const h = localHour(new Date(o.departAt), TZ); return h >= 6 && h < 12; })).toBe(true);

    const refundable: OfferDto[] = (await search({ refundableOnly: 1, pageSize: 50 })).body.items;
    expect(refundable.every((o) => o.conditions.refundable)).toBe(true);
  });

  it('sorts by departure and duration', async () => {
    const byDep: OfferDto[] = (await search({ sort: 'departure', pageSize: 50 })).body.items.filter((o: OfferDto) => !['sold_out', 'insufficient'].includes(o.availability));
    const times = byDep.map((o) => o.departAt);
    expect(times).toEqual([...times].sort());
    const byDur: OfferDto[] = (await search({ sort: 'duration', pageSize: 50 })).body.items.filter((o: OfferDto) => !['sold_out', 'insufficient'].includes(o.availability));
    const durs = byDur.map((o) => o.durationMinutes);
    expect(durs).toEqual([...durs].sort((a, b) => a - b));
  });

  it('paginates', async () => {
    const first = await search({ pageSize: 2, page: 1 });
    const second = await search({ pageSize: 2, page: 2 });
    expect(first.body.items).toHaveLength(2);
    expect(first.body.total).toBeGreaterThan(2);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
  });

  it('returns cheapest fares for flexible dates', async () => {
    const res = await search({ flex: 1 });
    const flex = res.body.flexibleDates as { date: string; cheapestMinor: number | null }[];
    expect(flex.map((f) => f.date)).toEqual([-3, -2, -1, 0, 1, 2, 3].map((d) => addDays(D10, d)));
    expect(flex.some((f) => f.cheapestMinor !== null)).toBe(true);
  });

  it('never offers past dates in the flexible strip', async () => {
    const res = await search({ date: addDays(today, 1), flex: 1 });
    expect(res.status).toBe(200);
    expect((res.body.flexibleDates as { date: string }[]).every((f) => f.date >= today)).toBe(true);
  });

  it('validates input', async () => {
    expect((await search({ to: 'BOM' })).status).toBe(400);
    expect((await search({ to: 'ZZZ' })).status).toBe(400);
    expect((await search({ date: addDays(today, -1) })).status).toBe(400);
    expect((await search({ adults: 12 })).status).toBe(400);
    expect((await search({ windows: 'brunch' })).status).toBe(400);
  });

  it('marks offers with too few seats for the party and keeps them last', async () => {
    const res = await search({ adults: 9, pageSize: 50 });
    const items: OfferDto[] = res.body.items;
    const firstBad = items.findIndex((o) => o.availability === 'insufficient' || o.availability === 'sold_out');
    if (firstBad >= 0) expect(items.slice(firstBad).every((o) => o.availability === 'insufficient' || o.availability === 'sold_out')).toBe(true);
  });

  it('excludes expired and paused offers and enforces partner inventory caps', async () => {
    const expired = await addPartnerOffer({ validUntil: new Date(Date.now() - 60_000) }, '13:00');
    const paused = await addPartnerOffer({ status: 'paused' }, '13:30');
    const capped = await addPartnerOffer({ inventoryCap: 2, seatsSold: 2 }, '14:00');
    const items: OfferDto[] = (await search({ pageSize: 50, sort: 'departure' })).body.items;
    const ids = items.map((o) => o.id);
    expect(ids).not.toContain(expired.id);
    expect(ids).not.toContain(paused.id);
    expect(items.find((o) => o.id === capped.id)?.availability).toBe('sold_out');
  });

  it('falls back to partner-published offers when the airline system is down', async () => {
    const partner = await addPartnerOffer({}, '15:00', addDays(today, 12));
    airline.outage = true;
    try {
      const res = await search({ date: addDays(today, 12) });
      expect(res.status).toBe(200);
      expect(res.body.warnings).toContain('airline_unavailable');
      expect((res.body.items as OfferDto[]).map((o) => o.id)).toContain(partner.id);
    } finally {
      airline.outage = false;
    }
  });

  it('withdraws cached adapter offers the airline no longer returns', async () => {
    await search({ date: addDays(today, 15) });
    const [cached] = await t.ctx.db.select().from(flightOffers).where(eq(flightOffers.source, 'sandbox-airline')).limit(1);
    await t.ctx.db.update(flightOffers).set({ externalRef: 'GHOST-REF' }).where(eq(flightOffers.id, cached!.id));
    // Refresh the day that offer belongs to.
    const [f] = await t.ctx.db.select().from(flights).where(eq(flights.id, cached!.flightId));
    await search({ date: localDate(f!.departAt, TZ), cabin: cached!.cabin });
    const [after] = await t.ctx.db.select().from(flightOffers).where(eq(flightOffers.id, cached!.id));
    expect(after!.status).toBe('withdrawn');
  });
});

describe('GET /flights/offers/:id', () => {
  it('returns full details including fare rules and airports', async () => {
    const { body } = await search({});
    const id = (body.items as OfferDto[]).find((o) => o.source === 'airline')!.id;
    const res = await t.agent().get(`/api/v1/flights/offers/${id}`).query({ adults: 3 });
    expect(res.status).toBe(200);
    expect(res.body.offer.conditions.rules.length).toBeGreaterThan(10);
    expect(res.body.offer.originAirport).toMatchObject({ code: 'BOM', timezone: TZ });
    expect(res.body.offer.totalMinor).toBe(res.body.offer.farePerAdultMinor * 3);
  });

  it('404s for unknown offers and 400s for malformed ids', async () => {
    expect((await t.agent().get('/api/v1/flights/offers/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await t.agent().get('/api/v1/flights/offers/not-a-uuid')).status).toBe(400);
  });
});

describe('remainingSeats', () => {
  it('takes the lower of airline seats and partner cap', () => {
    expect(remainingSeats({ seatsAvailable: 5, inventoryCap: 3, seatsSold: 1 })).toBe(2);
    expect(remainingSeats({ seatsAvailable: 1, inventoryCap: 10, seatsSold: 0 })).toBe(1);
    expect(remainingSeats({ seatsAvailable: null, inventoryCap: null, seatsSold: 0 })).toBeNull();
    expect(remainingSeats({ seatsAvailable: null, inventoryCap: 2, seatsSold: 5 })).toBe(0);
  });
});
