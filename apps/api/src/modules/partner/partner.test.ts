import { addDays, localDate } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flightOffers } from '../../db/schema';
import { createTestApp, type TestApp } from '../../test/harness';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

type Agent = ReturnType<TestApp['agent']>;
const D10 = addDays(localDate(new Date(), 'Asia/Kolkata'), 10);
let digits = 100;

const offerBody = (over: Record<string, unknown> = {}) => ({
  airlineCode: 'S1',
  flightDigits: String(digits++),
  origin: 'BOM',
  destination: 'GOI',
  departDate: D10,
  departTime: '09:15',
  arriveDate: D10,
  arriveTime: '10:30',
  cabin: 'economy',
  fareMinor: 350_000,
  taxesMinor: 60_000,
  referenceFareMinor: 520_000,
  referenceSource: 'Saffron Air published fare, same flight and cabin',
  baggageCabinKg: 7,
  baggageCheckedKg: 15,
  refundable: true,
  changeFeeMinor: 150_000,
  cancelFeeMinor: 200_000,
  fareRules: 'Changes up to 24 hours before departure for a fee. Cancellation refunds the fare less the fee.',
  inventoryCap: 4,
  validFrom: new Date(Date.now() - 60_000).toISOString(),
  validUntil: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  publish: true,
  ...over,
});

async function register(accountType: 'partner' | 'passenger'): Promise<Agent> {
  const a = t.agent();
  const r = await a
    .post('/api/v1/auth/register')
    .send({ fullName: 'Partner Tester', email: `p${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`, password: 'journey2026', acceptTerms: true, accountType });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return a;
}

describe('partner onboarding and approval', () => {
  it('new partners stay pending, cannot publish, and are authorised only for reviewed airlines', async () => {
    const a = await register('partner');
    expect((await a.get('/api/v1/partner/me')).body.partner).toBeNull();
    expect((await a.get('/api/v1/partner/offers')).status).toBe(403);

    const on = await a.post('/api/v1/partner/onboarding').send({ name: 'Konkan Jet Sales', kind: 'airline', phone: '+919811112222', airlines: [{ code: 's3', name: 'Konkan Jet' }] });
    expect(on.status).toBe(201);
    expect(on.body.partner).toMatchObject({ status: 'pending', authorisedAirlines: [], requestedAirlines: [{ code: 'S3', name: 'Konkan Jet' }] });
    expect((await a.post('/api/v1/partner/onboarding').send({ name: 'Again', kind: 'airline', phone: '+919811112222', airlines: [{ code: 'S3', name: 'Konkan Jet' }] })).status).toBe(409);

    expect((await a.post('/api/v1/partner/routes').send({ origin: 'BOM', destination: 'GOI' })).status).toBe(201);
    const blocked = await a.post('/api/v1/partner/offers').send(offerBody({ airlineCode: 'S3' }));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('partner_not_approved');

    const admin = await t.loginAs('admin@demo.waylo.app');
    const pending = (await admin.get('/api/v1/admin/review/pending')).body.partners as { id: string }[];
    expect(pending.some((p) => p.id === on.body.partner.id)).toBe(true);
    const ok = await admin.post(`/api/v1/admin/review/partner/${on.body.partner.id}`).send({ decision: 'approved' });
    expect(ok.status).toBe(200);
    expect((await a.get('/api/v1/partner/me')).body.partner).toMatchObject({ status: 'approved', authorisedAirlines: ['S3'] });

    // Approved for S3 only: other designators are refused.
    expect((await a.post('/api/v1/partner/offers').send(offerBody({ airlineCode: 'S2' }))).status).toBe(403);
    expect((await a.post('/api/v1/partner/offers').send(offerBody({ airlineCode: 'S3' }))).status).toBe(201);
  });

  it('only partner accounts reach the partner API', async () => {
    const p = await register('passenger');
    expect((await p.get('/api/v1/partner/me')).status).toBe(403);
    expect((await t.agent().get('/api/v1/partner/me')).status).toBe(401);
  });
});

describe('partner offers', () => {
  it('publishes a fare that travellers can find and book within its cap', async () => {
    const partner = await t.loginAs('partner@demo.waylo.app');
    const created = await partner.post('/api/v1/partner/offers').send(offerBody({ inventoryCap: 2, maxPassengers: 2 }));
    expect(created.status).toBe(201);
    expect(created.body.offer).toMatchObject({ source: 'partner', status: 'published', inventoryCap: 2 });

    const traveller = await t.loginAs('passenger@demo.waylo.app');
    const search = await traveller.get('/api/v1/flights/search').query({ from: 'BOM', to: 'GOI', date: D10, adults: 1, pageSize: 50 });
    const found = (search.body.items as { id: string; source: string; saving: unknown }[]).find((o) => o.id === created.body.offer.id);
    expect(found).toMatchObject({ source: 'partner' });
    expect(found!.saving).toMatchObject({ amountMinor: 170_000 });

    expect((await traveller.post(`/api/v1/flights/offers/${created.body.offer.id}/validate`).send({ adults: 3 })).body.error.code).toBe('eligibility_failed');
    const lock = await traveller.post(`/api/v1/flights/offers/${created.body.offer.id}/validate`).send({ adults: 2 });
    expect(lock.status).toBe(200);
    expect(lock.body.lock.totalMinor).toBe(700_000);
  });

  it('enforces the minimum advance-booking window', async () => {
    const partner = await t.loginAs('partner@demo.waylo.app');
    const created = await partner.post('/api/v1/partner/offers').send(offerBody({ minAdvanceHours: 720 }));
    expect(created.status).toBe(201);
    const traveller = await t.loginAs('passenger@demo.waylo.app');
    const res = await traveller.post(`/api/v1/flights/offers/${created.body.offer.id}/validate`).send({ adults: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('eligibility_failed');
  });

  it('validates schedule, route and offer window on the server', async () => {
    const partner = await t.loginAs('partner@demo.waylo.app');
    // Route not in the partner's network (BOM–BLR is not seeded for the demo partner).
    expect((await partner.post('/api/v1/partner/offers').send(offerBody({ destination: 'BLR' }))).status).toBe(400);
    expect((await partner.post('/api/v1/partner/offers').send(offerBody({ arriveTime: '08:00' }))).status).toBe(400);
    const past = addDays(localDate(new Date(), 'Asia/Kolkata'), -2);
    expect((await partner.post('/api/v1/partner/offers').send(offerBody({ departDate: past, arriveDate: past, validFrom: new Date(Date.now() - 5 * 86_400_000).toISOString(), validUntil: new Date(Date.now() - 4 * 86_400_000).toISOString() }))).status).toBe(400);
    expect((await partner.post('/api/v1/partner/offers').send(offerBody({ validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString() }))).status).toBe(400);
    // The browser cannot claim a saving against a reference fare without saying where it comes from.
    expect((await partner.post('/api/v1/partner/offers').send(offerBody({ referenceSource: undefined }))).status).toBe(400);
    expect((await partner.post('/api/v1/partner/offers').send(offerBody({ referenceFareMinor: 300_000 }))).status).toBe(400);
    // Same flight number and time with a different arrival conflicts with the stored schedule.
    const fd = String(digits++);
    expect((await partner.post('/api/v1/partner/offers').send(offerBody({ flightDigits: fd }))).status).toBe(201);
    expect((await partner.post('/api/v1/partner/offers').send(offerBody({ flightDigits: fd, arriveTime: '11:00' }))).status).toBe(409);
  });

  it('moves offers through draft, paused and withdrawn, and keeps them private to their partner', async () => {
    const partner = await t.loginAs('partner@demo.waylo.app');
    const draft = (await partner.post('/api/v1/partner/offers').send(offerBody({ publish: false }))).body.offer;
    expect(draft.status).toBe('draft');
    const traveller = await t.loginAs('passenger@demo.waylo.app');
    expect((await traveller.get(`/api/v1/flights/offers/${draft.id}`)).status).toBe(404);

    expect((await partner.post(`/api/v1/partner/offers/${draft.id}/status`).send({ status: 'paused' })).status).toBe(409);
    expect((await partner.post(`/api/v1/partner/offers/${draft.id}/status`).send({ status: 'published' })).body.offer.status).toBe('published');
    expect((await partner.post(`/api/v1/partner/offers/${draft.id}/status`).send({ status: 'paused' })).body.offer.status).toBe('paused');
    expect((await traveller.post(`/api/v1/flights/offers/${draft.id}/validate`).send({ adults: 1 })).status).toBe(410);
    expect((await partner.post(`/api/v1/partner/offers/${draft.id}/status`).send({ status: 'withdrawn' })).body.offer.status).toBe('withdrawn');
    expect((await partner.post(`/api/v1/partner/offers/${draft.id}/status`).send({ status: 'published' })).status).toBe(409);
    expect((await partner.patch(`/api/v1/partner/offers/${draft.id}`).send({ fareMinor: 300_000 })).status).toBe(409);

    // Another partner cannot see or change it.
    const other = await register('partner');
    await other.post('/api/v1/partner/onboarding').send({ name: 'Other Desk', kind: 'distributor', phone: '+919822223333', airlines: [{ code: 'S1', name: 'Saffron Air' }] });
    expect((await other.get('/api/v1/partner/offers')).body.items).toHaveLength(0);
  });

  it('edits apply to future sales and cannot undercut the sold count or the reference fare', async () => {
    const partner = await t.loginAs('partner@demo.waylo.app');
    const o = (await partner.post('/api/v1/partner/offers').send(offerBody())).body.offer;
    await t.ctx.db.update(flightOffers).set({ seatsSold: 3 }).where(eq(flightOffers.id, o.id));
    expect((await partner.patch(`/api/v1/partner/offers/${o.id}`).send({ inventoryCap: 2 })).body.error.code).toBe('cap_below_sold');
    expect((await partner.patch(`/api/v1/partner/offers/${o.id}`).send({ fareMinor: 600_000 })).status).toBe(400);
    const ok = await partner.patch(`/api/v1/partner/offers/${o.id}`).send({ fareMinor: 320_000, inventoryCap: 6 });
    expect(ok.body.offer).toMatchObject({ fareMinor: 320_000, inventoryCap: 6 });
    const listed = (await partner.get('/api/v1/partner/offers')).body.items.find((x: { id: string }) => x.id === o.id);
    expect(listed).toMatchObject({ seatsSold: 3, seatsRemaining: 3 });
  });

  it('suspension pauses the partner’s live fares; reports and audit stay available', async () => {
    const a = await register('partner');
    const p = (await a.post('/api/v1/partner/onboarding').send({ name: 'Suspend Me Ltd', kind: 'distributor', phone: '+919833334444', airlines: [{ code: 'S2', name: 'Monsoon Airways' }] })).body.partner;
    const admin = await t.loginAs('admin@demo.waylo.app');
    await admin.post(`/api/v1/admin/review/partner/${p.id}`).send({ decision: 'approved' });
    await a.post('/api/v1/partner/routes').send({ origin: 'BOM', destination: 'GOI' });
    const o = (await a.post('/api/v1/partner/offers').send(offerBody({ airlineCode: 'S2' }))).body.offer;
    expect(o.status).toBe('published');

    await admin.post(`/api/v1/admin/review/partner/${p.id}`).send({ decision: 'suspended', reason: 'Authorisation letter expired' });
    const [row] = await t.ctx.db.select().from(flightOffers).where(eq(flightOffers.id, o.id));
    expect(row!.status).toBe('paused');
    const blocked = await a.post(`/api/v1/partner/offers/${o.id}/status`).send({ status: 'published' });
    expect(blocked.body.error.code).toBe('partner_not_approved');

    const stats = (await a.get('/api/v1/partner/stats')).body;
    expect(stats).toMatchObject({ offers: 1, published: 0, bookings: 0, grossBookingValueMinor: 0 });
    const audit = (await a.get('/api/v1/partner/audit')).body.items.map((e: { action: string }) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['partner.onboarded', 'partner.approved', 'route.added', 'offer.published', 'partner.suspended']));
  });

  it('lists bookings on the partner’s fares without passenger personal data', async () => {
    const partner = await t.loginAs('partner@demo.waylo.app');
    const res = await partner.get('/api/v1/partner/bookings');
    expect(res.status).toBe(200);
    for (const b of res.body.items) {
      expect(Object.keys(b)).not.toEqual(expect.arrayContaining(['passengers', 'contactEmail', 'userId']));
    }
  });
});
