import { addDays, localDate, zonedTimeToUtc } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SandboxMapsAdapter } from '../../adapters/maps/sandbox';
import { airlines, flights, rideRequests } from '../../db/schema';
import { createTestApp, type TestApp } from '../../test/harness';
import { expireUnmatchedRequests } from './requests';

const maps = new SandboxMapsAdapter();
let t: TestApp;
let zoneT2: string;
let zoneGoa: string;
beforeAll(async () => {
  t = await createTestApp({}, { adapters: { maps } });
  const areas = (await t.agent().get('/api/v1/rides/service-areas')).body.items as { code: string; zones: { id: string; terminal: string }[] }[];
  zoneT2 = areas.find((a) => a.code === 'BOM')!.zones.find((z) => z.terminal === 'T2')!.id;
  zoneGoa = areas.find((a) => a.code === 'GOI')!.zones[0]!.id;
});
afterAll(() => t.close());

const D3 = addDays(localDate(new Date(), 'Asia/Kolkata'), 3);
const COLABA = { placeId: 'sbx:colaba', label: 'Colaba, Mumbai', area: 'Colaba', lat: 18.9067, lng: 72.8147 };
const req = (over: Record<string, unknown> = {}) => ({
  airport: 'BOM',
  pickupZoneId: zoneT2,
  arrivalAt: zonedTimeToUtc(D3, '16:40', 'Asia/Kolkata').toISOString(),
  destination: COLABA,
  passengers: 2,
  luggage: { cabin: 2, medium: 1, large: 0 },
  vehiclePreference: 'any',
  maxWaitMinutes: 20,
  maxDetourMinutes: 15,
  wheelchair: false,
  ...over,
});

describe('service areas and places', () => {
  it('lists airports with pickup zones', async () => {
    const res = await t.agent().get('/api/v1/rides/service-areas');
    const bom = res.body.items.find((a: { code: string }) => a.code === 'BOM');
    expect(bom.zones.map((z: { terminal: string }) => z.terminal).sort()).toEqual(['T1', 'T2']);
    expect(res.body.radiusKm).toBe(60);
  });

  it('searches places near the airport by area or landmark', async () => {
    const res = await t.agent().get('/api/v1/places/search').query({ q: 'bandra', airport: 'BOM' });
    expect(res.status).toBe(200);
    expect(res.body.items[0].area).toMatch(/Bandra/);
    const landmark = await t.agent().get('/api/v1/places/search').query({ q: 'gateway', airport: 'BOM' });
    expect(landmark.body.items[0]).toMatchObject({ area: 'Colaba' });
    // Goa places are out of range from Mumbai.
    const far = await t.agent().get('/api/v1/places/search').query({ q: 'panaji', airport: 'BOM' });
    expect(far.body.items).toEqual([]);
  });

  it('reports a maps outage clearly', async () => {
    maps.outage = true;
    try {
      const res = await t.agent().get('/api/v1/places/search').query({ q: 'worli', airport: 'BOM' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('maps_unavailable');
    } finally {
      maps.outage = false;
    }
  });
});

describe('POST /rides/requests', () => {
  it('requires sign-in', async () => {
    expect((await t.agent().post('/api/v1/rides/requests').send(req())).status).toBe(401);
  });

  it('creates an open request with a direct-route estimate', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const res = await a.post('/api/v1/rides/requests').send(req());
    expect(res.status).toBe(201);
    const r = res.body.request;
    expect(r.status).toBe('open');
    expect(r.pickupZone.terminal).toBe('T2');
    expect(r.direct.distanceMeters).toBeGreaterThan(15_000);
    expect(r.direct.durationSeconds).toBeGreaterThan(20 * 60);
    expect(r.destination.area).toBe('Colaba');
  });

  it('prevents a duplicate active request for the same arrival', async () => {
    const a = await t.loginAs('rider2@demo.waylo.app');
    const body = req({ arrivalAt: zonedTimeToUtc(D3, '18:15', 'Asia/Kolkata').toISOString() });
    expect((await a.post('/api/v1/rides/requests').send(body)).status).toBe(201);
    const dup = await a.post('/api/v1/rides/requests').send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_request');
  });

  it('uses the scheduled arrival of a known flight', async () => {
    await t.ctx.db.insert(airlines).values({ code: 'S9', name: 'Test Air', isSandbox: true }).onConflictDoNothing();
    const arriveAt = zonedTimeToUtc(D3, '21:05', 'Asia/Kolkata');
    await t.ctx.db.insert(flights).values({ airlineCode: 'S9', flightNumber: 'S9123', origin: 'DEL', destination: 'BOM', departAt: new Date(arriveAt.getTime() - 2 * 3_600_000), arriveAt });
    const a = await t.loginAs('rider3@demo.waylo.app');
    const lookup = await a.get('/api/v1/rides/flight-lookup').query({ flight: 's9 123', airport: 'BOM', around: zonedTimeToUtc(D3, '20:00', 'Asia/Kolkata').toISOString() });
    expect(lookup.body.flight.scheduledArrivalAt).toBe(arriveAt.toISOString());

    const res = await a.post('/api/v1/rides/requests').send(req({ flightNumber: 'S9 123', arrivalAt: zonedTimeToUtc(D3, '20:30', 'Asia/Kolkata').toISOString() }));
    expect(res.status).toBe(201);
    expect(res.body.request.flightLinked).toBe(true);
    expect(res.body.request.scheduledArrivalAt).toBe(arriveAt.toISOString());
  });

  it('rejects a pickup zone from another airport, past arrivals and far destinations', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const wrongZone = await a.post('/api/v1/rides/requests').send(req({ pickupZoneId: zoneGoa }));
    expect(wrongZone.status).toBe(400);
    const past = await a.post('/api/v1/rides/requests').send(req({ arrivalAt: new Date(Date.now() - 3_600_000).toISOString() }));
    expect(past.status).toBe(400);
    expect(past.body.error.details[0].path).toBe('arrivalAt');
    const far = await a.post('/api/v1/rides/requests').send(req({ destination: { placeId: 'x', label: 'Pune', area: 'Pune', lat: 18.52, lng: 73.85 } }));
    expect(far.status).toBe(400);
    expect(far.body.error.code).toBe('outside_service_area');
  });

  it('rejects excess luggage and incompatible accessibility choices', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const bags = await a.post('/api/v1/rides/requests').send(req({ passengers: 6, luggage: { cabin: 0, medium: 0, large: 6 } }));
    expect(bags.status).toBe(400);
    expect(bags.body.error.details.map((d: { path: string }) => d.path)).toContain('luggage');
    const wc = await a.post('/api/v1/rides/requests').send(req({ wheelchair: true, vehiclePreference: 'sedan' }));
    expect(wc.status).toBe(400);
  });

  it('fails safely when routing is unavailable', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    maps.outage = true;
    try {
      const res = await a.post('/api/v1/rides/requests').send(req({ arrivalAt: zonedTimeToUtc(D3, '07:00', 'Asia/Kolkata').toISOString() }));
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('routing_unavailable');
    } finally {
      maps.outage = false;
    }
  });
});

describe('request lifecycle', () => {
  it("lists, reads and cancels my requests but not other people's", async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const b = await t.loginAs('rider2@demo.waylo.app');
    const created = (await a.post('/api/v1/rides/requests').send(req({ arrivalAt: zonedTimeToUtc(D3, '09:00', 'Asia/Kolkata').toISOString() }))).body.request;
    expect((await a.get('/api/v1/rides/requests')).body.items.some((r: { id: string }) => r.id === created.id)).toBe(true);
    expect((await b.get(`/api/v1/rides/requests/${created.id}`)).status).toBe(404);
    expect((await b.post(`/api/v1/rides/requests/${created.id}/cancel`)).status).toBe(404);
    const c = await a.post(`/api/v1/rides/requests/${created.id}/cancel`);
    expect(c.body.request.status).toBe('cancelled');
    expect((await a.post(`/api/v1/rides/requests/${created.id}/cancel`)).status).toBe(409);
    // A cancelled request no longer blocks a new one for the same arrival.
    expect((await a.post('/api/v1/rides/requests').send(req({ arrivalAt: zonedTimeToUtc(D3, '09:00', 'Asia/Kolkata').toISOString() }))).status).toBe(201);
  });

  it('marks requests as no_match after the waiting window', async () => {
    const a = await t.loginAs('rider3@demo.waylo.app');
    const created = (await a.post('/api/v1/rides/requests').send(req({ arrivalAt: zonedTimeToUtc(D3, '11:00', 'Asia/Kolkata').toISOString() }))).body.request;
    await expireUnmatchedRequests(t.ctx, new Date(new Date(created.expectedArrivalAt).getTime() + 21 * 60_000));
    const [row] = await t.ctx.db.select().from(rideRequests).where(eq(rideRequests.id, created.id));
    expect(row!.status).toBe('no_match');
  });

  it('blocks account deletion while a request is active', async () => {
    const a = t.agent();
    const email = `rd${Date.now()}@example.com`;
    await a.post('/api/v1/auth/register').send({ fullName: 'Ride Tester', email, password: 'journey2026', acceptTerms: true });
    await a.post('/api/v1/rides/requests').send(req({ arrivalAt: zonedTimeToUtc(D3, '13:00', 'Asia/Kolkata').toISOString() }));
    const del = await a.delete('/api/v1/users/me').send({ password: 'journey2026', confirm: 'DELETE' });
    expect(del.status).toBe(409);
  });
});
