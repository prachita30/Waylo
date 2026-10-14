import { addDays, localDate } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flightOffers, users } from '../../db/schema';
import { createTestApp, type TestApp } from '../../test/harness';

let t: TestApp;
let admin: ReturnType<TestApp['agent']>;
beforeAll(async () => {
  t = await createTestApp();
  admin = await t.loginAs('admin@demo.waylo.app');
});
afterAll(() => t.close());

const D6 = addDays(localDate(new Date(), 'Asia/Kolkata'), 6);

async function register(name = 'Console Tester') {
  const a = t.agent();
  const email = `c${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`;
  const r = await a.post('/api/v1/auth/register').send({ fullName: name, email, password: 'journey2026', acceptTerms: true });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { a, email, id: r.body.user.id as string };
}

describe('admin console access', () => {
  it('is closed to everyone but administrators', async () => {
    const passenger = await t.loginAs('passenger@demo.waylo.app');
    const partner = await t.loginAs('partner@demo.waylo.app');
    for (const path of ['/api/v1/admin/overview', '/api/v1/admin/users', '/api/v1/admin/config', '/api/v1/admin/audit']) {
      expect((await t.agent().get(path)).status).toBe(401);
      expect((await passenger.get(path)).status).toBe(403);
      expect((await partner.get(path)).status).toBe(403);
    }
    expect((await passenger.put('/api/v1/admin/config/features').send({ flightBooking: false })).status).toBe(403);
  });

  it('reports real counts on the overview', async () => {
    const res = await admin.get('/api/v1/admin/overview');
    expect(res.status).toBe(200);
    // Seeded demo accounts: 3 passengers + new registrations, 2 operator accounts, 1 partner, 1 admin.
    expect(res.body.usersByRole.admin).toBe(1);
    expect(res.body.usersByRole.partner).toBeGreaterThanOrEqual(1);
    expect(res.body.attention.pendingReviews).toMatchObject({ operators: expect.any(Number), partners: expect.any(Number) });
    expect(res.body.features).toEqual({ flightBooking: true, rideRequests: true, partnerOnboarding: true, operatorOnboarding: true });
  });
});

describe('user management', () => {
  it('suspends a user with a reason, signs them out, and can reactivate them', async () => {
    const u = await register('Suspend Subject');
    expect((await u.a.get('/api/v1/users/me')).status).toBe(200);

    const list = await admin.get('/api/v1/admin/users').query({ q: u.email });
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).not.toHaveProperty('passwordHash');

    expect((await admin.patch(`/api/v1/admin/users/${u.id}`).send({ status: 'suspended' })).status).toBe(400);
    const s = await admin.patch(`/api/v1/admin/users/${u.id}`).send({ status: 'suspended', reason: 'Chargeback investigation' });
    expect(s.body.user).toMatchObject({ status: 'suspended', suspendedReason: 'Chargeback investigation' });
    expect((await u.a.get('/api/v1/users/me')).status).toBe(401);

    const back = await admin.patch(`/api/v1/admin/users/${u.id}`).send({ status: 'active' });
    expect(back.body.user).toMatchObject({ status: 'active', suspendedReason: null });
    const audit = await admin.get('/api/v1/admin/audit').query({ entityType: 'user', entityId: u.id });
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(['user.reactivated', 'user.suspended', 'user.registered']);
    expect(audit.body.items[0].actorEmail).toBe('admin@demo.waylo.app');
  });

  it('will not let an administrator suspend themselves', async () => {
    const [me] = await t.ctx.db.select().from(users).where(eq(users.email, 'admin@demo.waylo.app'));
    expect((await admin.patch(`/api/v1/admin/users/${me!.id}`).send({ status: 'suspended', reason: 'Testing self lockout' })).status).toBe(409);
  });
});

describe('offer moderation', () => {
  it('holds an airline offer so search refreshes cannot republish it, then releases it', async () => {
    const traveller = await t.loginAs('passenger@demo.waylo.app');
    const search = () => traveller.get('/api/v1/flights/search').query({ from: 'BOM', to: 'GOI', date: D6, adults: 1, pageSize: 50 });
    const first = (await search()).body.items.find((o: { source: string }) => o.source === 'airline');
    expect(first).toBeTruthy();

    expect((await admin.post(`/api/v1/admin/offers/${first.id}/hold`).send({ reason: 'x' })).status).toBe(400);
    const held = await admin.post(`/api/v1/admin/offers/${first.id}/hold`).send({ reason: 'Fare looks mis-filed; checking with airline' });
    expect(held.body.offer).toMatchObject({ status: 'paused', adminHold: true });

    // The adapter returns the same offer again on the next search; it must stay off sale.
    const again = (await search()).body.items.map((o: { id: string }) => o.id);
    expect(again).not.toContain(first.id);
    const [row] = await t.ctx.db.select().from(flightOffers).where(eq(flightOffers.id, first.id));
    expect(row).toMatchObject({ status: 'paused', adminHold: true });
    expect((await traveller.post(`/api/v1/flights/offers/${first.id}/validate`).send({ adults: 1 })).status).toBe(410);

    const listed = await admin.get('/api/v1/admin/offers').query({ held: 'true' });
    expect(listed.body.items.map((o: { id: string }) => o.id)).toContain(first.id);

    expect((await admin.post(`/api/v1/admin/offers/${first.id}/release`)).body.offer.adminHold).toBe(false);
    expect((await admin.post(`/api/v1/admin/offers/${first.id}/release`)).status).toBe(409);
    expect((await search()).body.items.map((o: { id: string }) => o.id)).toContain(first.id);
  });

  it('stops a partner from republishing a held offer', async () => {
    const partner = await t.loginAs('partner@demo.waylo.app');
    const created = await partner.post('/api/v1/partner/offers').send({
      airlineCode: 'S1', flightDigits: '901', origin: 'BOM', destination: 'GOI', departDate: D6, departTime: '13:00', arriveDate: D6, arriveTime: '14:15', cabin: 'economy',
      fareMinor: 300_000, taxesMinor: 50_000, baggageCabinKg: 7, baggageCheckedKg: 15, refundable: false, changeFeeMinor: null, cancelFeeMinor: null,
      fareRules: 'Non-refundable. No changes permitted on this fare.', inventoryCap: 3,
      validFrom: new Date(Date.now() - 60_000).toISOString(), validUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(), publish: true,
    });
    expect(created.status).toBe(201);
    await admin.post(`/api/v1/admin/offers/${created.body.offer.id}/hold`).send({ reason: 'Authorisation letter under review' });
    const retry = await partner.post(`/api/v1/partner/offers/${created.body.offer.id}/status`).send({ status: 'published' });
    expect(retry.status).toBe(409);
    expect(retry.body.error.message).toContain('Authorisation letter under review');
    const mine = (await partner.get('/api/v1/partner/offers')).body.items.find((o: { id: string }) => o.id === created.body.offer.id);
    expect(mine.adminHold).toEqual({ reason: 'Authorisation letter under review' });
    // Partner-scoped audit includes the hold so the partner can see who acted.
    expect((await partner.get('/api/v1/partner/audit')).body.items.map((e: { action: string }) => e.action)).toContain('offer.held');
  });
});

describe('feature switches', () => {
  it('gate the server entry points, show in /meta, and are audited', async () => {
    const traveller = await t.loginAs('passenger@demo.waylo.app');
    const search = await traveller.get('/api/v1/flights/search').query({ from: 'BOM', to: 'GOI', date: D6, adults: 1, pageSize: 50 });
    const offer = search.body.items.find((o: { source: string; availability: string }) => o.source === 'airline' && o.availability !== 'sold_out');

    expect((await admin.put('/api/v1/admin/config/features').send({ flightBooking: 'no' })).status).toBe(400);
    expect((await admin.put('/api/v1/admin/config/features').send({ teleport: true })).status).toBe(400);
    const off = await admin.put('/api/v1/admin/config/features').send({ flightBooking: false, partnerOnboarding: false });
    expect(off.body.features).toMatchObject({ flightBooking: false, rideRequests: true, partnerOnboarding: false });
    expect((await t.agent().get('/api/v1/meta')).body.features.flightBooking).toBe(false);

    const blocked = await traveller.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe('feature_disabled');
    // Search still works while booking is paused.
    expect((await traveller.get('/api/v1/flights/search').query({ from: 'BOM', to: 'GOI', date: D6, adults: 1 })).status).toBe(200);

    const p = t.agent();
    await p.post('/api/v1/auth/register').send({ fullName: 'Paused Partner', email: `pp${Date.now()}@example.com`, password: 'journey2026', acceptTerms: true, accountType: 'partner' });
    expect((await p.post('/api/v1/partner/onboarding').send({ name: 'Paused Ltd', kind: 'airline', phone: '+919844445555', airlines: [{ code: 'S2', name: 'Monsoon Airways' }] })).status).toBe(503);

    await admin.put('/api/v1/admin/config/features').send({ flightBooking: true, partnerOnboarding: true });
    expect((await traveller.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 })).status).toBe(200);
    const audit = await admin.get('/api/v1/admin/audit').query({ action: 'config.features' });
    expect(audit.body.items[0].metadata.after.flightBooking).toBe(true);
  });

  it('validates ride settings and keeps fare and weight defaults intact', async () => {
    expect((await admin.put('/api/v1/admin/config/rides').send({ maxParties: 12 })).status).toBe(400);
    expect((await admin.put('/api/v1/admin/config/rides').send({ fare: { platformFeeBps: 0 } })).status).toBe(400);
    const res = await admin.put('/api/v1/admin/config/rides').send({ pickupGraceMinutes: 20, lockLeadMinutes: 60 });
    expect(res.body.rides).toMatchObject({ pickupGraceMinutes: 20, lockLeadMinutes: 60, maxParties: 4 });
    expect(res.body.rides.fare.rates).toBeTruthy();
    const cfg = await admin.get('/api/v1/admin/config');
    expect(cfg.body.rides.pickupGraceMinutes).toBe(20);
    expect(cfg.body.adapters.every((a: { mode: string }) => a.mode === 'sandbox')).toBe(true);
  });
});

describe('incidents', () => {
  it('requires a resolution note to close an incident', async () => {
    const reporter = await t.loginAs('rider2@demo.waylo.app');
    const created = await reporter.post('/api/v1/incidents').send({ category: 'lost_item', severity: 'low', description: 'Left a blue backpack in the vehicle after drop-off.' });
    expect(created.status).toBe(201);
    const id = created.body.incident.id;
    const list = await admin.get('/api/v1/admin/incidents').query({ status: 'open' });
    expect(list.body.items.find((i: { id: string }) => i.id === id).reporter.email).toBe('rider2@demo.waylo.app');
    expect((await admin.patch(`/api/v1/admin/incidents/${id}`).send({ status: 'resolved' })).status).toBe(400);
    expect((await admin.patch(`/api/v1/admin/incidents/${id}`).send({ status: 'investigating' })).body.incident.status).toBe('investigating');
    const done = await admin.patch(`/api/v1/admin/incidents/${id}`).send({ status: 'resolved', resolution: 'Driver returned the backpack to the rider at T2.' });
    expect(done.body.incident).toMatchObject({ status: 'resolved', resolution: 'Driver returned the backpack to the rider at T2.' });
  });
});

describe('lists', () => {
  it('lists bookings, ride groups, requests and flights for operations', async () => {
    for (const path of ['/api/v1/admin/bookings', '/api/v1/admin/rides/groups', '/api/v1/admin/rides/requests']) {
      const res = await admin.get(path);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    }
    const f = await admin.get('/api/v1/admin/flights');
    expect(f.status).toBe(200);
    expect(f.body.sandboxControls).toBe(true);
    expect((await admin.get('/api/v1/admin/users').query({ limit: 500 })).status).toBe(400);
  });
});
