import { addDays, localDate } from '@waylo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SandboxAirlineAdapter } from '../../adapters/airline/sandbox';
import { SandboxPaymentAdapter } from '../../adapters/payments/sandbox';
import { createTestApp, type TestApp } from '../../test/harness';
import type { OfferDto } from '../flights/service';
import { parseRange, toCsv } from './service';

const SECRET = 'test-webhook-secret-123456';
let t: TestApp;
let admin: ReturnType<TestApp['agent']>;
const D5 = addDays(localDate(new Date(), 'Asia/Kolkata'), 5);
const TODAY = localDate(new Date(), 'Asia/Kolkata');

let booked: { totalMinor: number; savingMinor: number };

beforeAll(async () => {
  t = await createTestApp({ PAYMENT_WEBHOOK_SECRET: SECRET }, { adapters: { airline: new SandboxAirlineAdapter(), payments: new SandboxPaymentAdapter(SECRET) } });
  admin = await t.loginAs('admin@demo.waylo.app');

  // Real activity: three searches, one price lock, one paid and ticketed booking.
  const a = await t.loginAs('passenger@demo.waylo.app');
  let offers: OfferDto[] = [];
  for (let i = 0; i < 3; i++) offers = (await a.get('/api/v1/flights/search').query({ from: 'BOM', to: 'GOI', date: D5, adults: 2, pageSize: 50 })).body.items;
  const offer = offers.find((o) => o.saving && ['available', 'limited'].includes(o.availability) && (o.seatsLeft ?? 9) >= 2);
  if (!offer) throw new Error('no offer with a sourced saving in the sandbox fixture');
  const v = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 2 });
  const res = await a
    .post('/api/v1/flights/bookings')
    .set('Idempotency-Key', `analytics-${Date.now()}`)
    .send({ priceLockId: v.body.lock.id, passengers: [{ firstName: 'Ananya', lastName: 'Raoa' }, { firstName: 'Kiran', lastName: 'Raob' }], contact: { email: 'ana@example.com' }, acceptedTotalMinor: v.body.lock.totalMinor, acceptFareRules: true });
  await a.post(`/api/v1/payments/sandbox/intents/${res.body.checkoutUrl.split('/').pop()}/complete`).send({ outcome: 'succeed' });
  const b = (await a.get(`/api/v1/flights/bookings/${res.body.booking.id}`)).body.booking;
  if (b.status !== 'confirmed') throw new Error(`booking not confirmed: ${b.status}`);
  booked = { totalMinor: v.body.lock.totalMinor, savingMinor: (offer.saving!.referenceFareMinor - v.body.lock.farePerAdultMinor) * 2 };
});
afterAll(() => t.close());

describe('analytics access and ranges', () => {
  it('is for administrators only', async () => {
    const p = await t.loginAs('partner@demo.waylo.app');
    expect((await p.get('/api/v1/admin/analytics/summary')).status).toBe(403);
    expect((await t.agent().get('/api/v1/admin/analytics/export').query({ report: 'daily' })).status).toBe(401);
  });

  it('validates the reporting window', async () => {
    expect((await admin.get('/api/v1/admin/analytics/summary').query({ from: '2026-10-10', to: '2026-10-01' })).status).toBe(400);
    expect((await admin.get('/api/v1/admin/analytics/summary').query({ from: '2024-01-01', to: '2026-01-01' })).status).toBe(400);
    expect((await admin.get('/api/v1/admin/analytics/summary').query({ from: '10/01/2026' })).status).toBe(400);
    const r = parseRange('2026-10-01', '2026-10-01');
    // One IST day is 24 h starting at 18:30 UTC the previous evening.
    expect(r.start.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(r.end.getTime() - r.start.getTime()).toBe(86_400_000);
  });
});

describe('figures come from recorded activity', () => {
  it('reports the funnel, value and sourced savings for the period', async () => {
    const s = (await admin.get('/api/v1/admin/analytics/summary')).body;
    expect(s.range).toMatchObject({ to: TODAY, timeZone: 'Asia/Kolkata' });
    expect(s.flights).toMatchObject({
      searches: 3,
      searchesWithResults: 3,
      searchesRecordedSince: TODAY,
      priceLocks: 1,
      bookingsStarted: 1,
      bookingsPaid: 1,
      bookingsTicketed: 1,
      seatsTicketed: 2,
      grossBookingValueMinor: booked.totalMinor,
      cancelledAfterTicketing: 0,
      ticketingFailed: 0,
    });
    expect(s.flights.conversion).toEqual({ searchToLock: 0.333, lockToBooking: 1, bookingToPaid: 1 });
    expect(s.flights.savings.bookingsWithSourcedSaving).toBe(1);
    expect(s.flights.savings.totalMinor).toBe(booked.savingMinor);
    expect(s.rides).toMatchObject({ requests: 0, matchRate: null, completedTrips: 0, averageSeatFill: null });
  });

  it('returns every day of the window, with zero days included', async () => {
    const items = (await admin.get('/api/v1/admin/analytics/daily')).body.items;
    expect(items).toHaveLength(30);
    expect(items[0].day).toBe(addDays(TODAY, -29));
    const today = items.find((d: { day: string }) => d.day === TODAY);
    expect(today).toMatchObject({ searches: 3, bookingsTicketed: 1, grossBookingValueMinor: booked.totalMinor });
    expect(items.filter((d: { searches: number }) => d.searches === 0)).toHaveLength(29);
  });

  it('withholds route sales below the minimum cohort but keeps demand counts', async () => {
    const res = (await admin.get('/api/v1/admin/analytics/routes')).body;
    expect(res.minCohort).toBe(5);
    const route = res.items.find((x: { origin: string; destination: string }) => x.origin === 'BOM' && x.destination === 'GOI');
    expect(route).toEqual({ origin: 'BOM', destination: 'GOI', searches: 3, searchesWithResults: 3, bookings: null, grossBookingValueMinor: null, savingsMinor: null, suppressed: true });
  });

  it('contains no personal data in any report', async () => {
    const bodies = await Promise.all(['summary', 'daily', 'routes', 'partners', 'operators'].map((p) => admin.get(`/api/v1/admin/analytics/${p}`).then((r) => JSON.stringify(r.body))));
    for (const b of bodies) {
      expect(b).not.toMatch(/@/);
      expect(b).not.toMatch(/Ananya|Raoa|Kiran/);
    }
  });
});

describe('CSV export', () => {
  it('downloads a report as CSV and audits the export', async () => {
    const res = await admin.get('/api/v1/admin/analytics/export').query({ report: 'daily' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="waylo-daily-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('day,searches,bookingsTicketed,grossBookingValueMinor,rideRequests,ridesCompleted');
    expect(lines).toHaveLength(31);
    expect(lines.find((l) => l.startsWith(TODAY))).toBe(`${TODAY},3,1,${booked.totalMinor},0,0`);
    const audit = await admin.get('/api/v1/admin/audit').query({ action: 'analytics.exported' });
    expect(audit.body.items[0]).toMatchObject({ entityId: 'daily', actorEmail: 'admin@demo.waylo.app' });
    expect((await admin.get('/api/v1/admin/analytics/export').query({ report: 'users' })).status).toBe(400);
  });

  it('quotes values and neutralises spreadsheet formulas', () => {
    const csv = toCsv([{ name: '=HYPERLINK("http://x")', note: 'a,b', n: 5, empty: null }, { name: '+1', note: 'say "hi"', n: 0, empty: undefined }], ['name', 'note', 'n', 'empty']);
    expect(csv).toBe(`name,note,n,empty\r\n"'=HYPERLINK(""http://x"")","a,b",5,\r\n'+1,"say ""hi""",0,\r\n`);
  });
});
