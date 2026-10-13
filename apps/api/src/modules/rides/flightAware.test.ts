import { addDays, localDate, zonedTimeToUtc } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SandboxFlightStatusAdapter } from '../../adapters/flightStatus/sandbox';
import { airlines, flights, rideParticipants, rideRequests } from '../../db/schema';
import { subscribe, type DomainEvent } from '../../lib/events';
import { createTestApp, type TestApp } from '../../test/harness';
import { refreshFlightStatuses } from './flightAware';
import { lockGroup } from './groups';

const fs = new SandboxFlightStatusAdapter();
const events: DomainEvent[] = [];
subscribe((_ctx, e) => {
  events.push(e);
});

let t: TestApp;
let zoneT2: string;
const D = addDays(localDate(new Date(), 'Asia/Kolkata'), 2);
beforeAll(async () => {
  t = await createTestApp({}, { adapters: { flightStatus: fs } });
  const areas = (await t.agent().get('/api/v1/rides/service-areas')).body.items as { code: string; zones: { id: string; terminal: string }[] }[];
  zoneT2 = areas.find((a) => a.code === 'BOM')!.zones.find((z) => z.terminal === 'T2')!.id;
  await t.ctx.db.insert(airlines).values({ code: 'S7', name: 'Status Test Air', isSandbox: true }).onConflictDoNothing();
});
afterAll(() => t.close());

const override = (f: typeof flights.$inferSelect, o: { delayMinutes?: number; cancelled?: boolean }) =>
  fs.setOverride({ flightNumber: f.flightNumber, scheduledDepartAt: f.departAt }, o);

let fn = 100;
async function flight(time: string) {
  const arriveAt = zonedTimeToUtc(D, time, 'Asia/Kolkata');
  const [f] = await t.ctx.db
    .insert(flights)
    .values({ airlineCode: 'S7', flightNumber: `S7${fn++}`, origin: 'DEL', destination: 'BOM', departAt: new Date(arriveAt.getTime() - 2 * 3_600_000), arriveAt })
    .returning();
  return f!;
}
type Agent = ReturnType<TestApp['agent']>;
let n = 0;
async function rider(): Promise<Agent> {
  const a = t.agent();
  const r = await a.post('/api/v1/auth/register').send({ fullName: `Flyer ${String.fromCharCode(65 + n++)}`, email: `flyer${Date.now()}${n}@example.com`, password: 'journey2026', acceptTerms: true });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return a;
}
const DEST = {
  colaba: { placeId: 'sbx:colaba', label: 'Colaba', area: 'Colaba', lat: 18.9067, lng: 72.8147 },
  churchgate: { placeId: 'sbx:churchgate', label: 'Churchgate', area: 'Churchgate', lat: 18.9322, lng: 72.8264 },
};
async function requestFor(a: Agent, f: typeof flights.$inferSelect, dest: keyof typeof DEST, over: Record<string, unknown> = {}) {
  const res = await a.post('/api/v1/rides/requests').send({
    airport: 'BOM',
    pickupZoneId: zoneT2,
    flightNumber: f.flightNumber,
    arrivalAt: f.arriveAt.toISOString(),
    destination: DEST[dest],
    passengers: 1,
    luggage: { cabin: 1, medium: 0, large: 0 },
    vehiclePreference: 'any',
    maxWaitMinutes: 30,
    maxDetourMinutes: 20,
    wheelchair: false,
    ...over,
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  expect(res.body.request.flightLinked).toBe(true);
  return res.body.request.id as string;
}
async function pair(timeA: string, timeB: string) {
  const [fa, fb] = [await flight(timeA), await flight(timeB)];
  const [a, b] = [await rider(), await rider()];
  const ra = await requestFor(a, fa, 'colaba');
  const rb = await requestFor(b, fb, 'churchgate');
  const ma = await a.get(`/api/v1/rides/requests/${ra}/matches`);
  const g = (await a.post('/api/v1/rides/groups').send({ requestId: ra, soloOk: false, acceptedMaxTotalMinor: ma.body.newGroup.you.price.totalMinor })).body.group;
  const mb = await b.get(`/api/v1/rides/requests/${rb}/matches`);
  const opt = mb.body.groups.find((x: { groupId: string }) => x.groupId === g.id);
  const j = await b.post(`/api/v1/rides/groups/${g.id}/join`).send({ requestId: rb, acceptedMaxTotalMinor: opt.you.price.totalMinor });
  expect(j.status).toBe(200);
  return { fa, fb, a, b, ra, rb, groupId: g.id as string };
}

describe('flight-aware pickup', () => {
  it('moves the expected arrival and the group pickup when a flight is slightly late', async () => {
    const { fb, a, rb, groupId } = await pair('10:00', '10:10');
    const before = (await a.get(`/api/v1/rides/groups/${groupId}`)).body.group.plannedPickupAt;
    override(fb, { delayMinutes: 15 });
    expect(await refreshFlightStatuses(t.ctx)).toBeGreaterThanOrEqual(1);
    const req = (await t.ctx.db.select().from(rideRequests).where(eq(rideRequests.id, rb)))[0]!;
    expect(req.expectedArrivalAt.getTime() - fb.arriveAt.getTime()).toBe(15 * 60_000);
    const after = (await a.get(`/api/v1/rides/groups/${groupId}`)).body.group.plannedPickupAt;
    expect(new Date(after).getTime() - new Date(before).getTime()).toBe(15 * 60_000);
    expect(events.some((e) => e.type === 'ride.pickup_rescheduled' && e.groupId === groupId)).toBe(true);
    const view = await (await t.loginAs('passenger@demo.waylo.app')).get(`/api/v1/rides/requests/${rb}`);
    expect(view.status).toBe(404); // other users cannot see it
  });

  it('removes a rider free of charge when their delay exceeds what others can wait', async () => {
    const { fb, a, b, rb, groupId } = await pair('12:00', '12:00');
    override(fb, { delayMinutes: 90 });
    await refreshFlightStatuses(t.ctx);
    const [p] = await t.ctx.db.select().from(rideParticipants).where(eq(rideParticipants.requestId, rb));
    expect(p!.status).toBe('removed');
    expect(p!.removedReason).toBe('flight_delay');
    expect(p!.cancellationFeeMinor).toBeNull();
    const reqB = (await b.get(`/api/v1/rides/requests/${rb}`)).body.request;
    expect(reqB.status).toBe('open'); // free to be matched again
    expect(reqB.flight.delayMinutes).toBe(90);
    const g = (await a.get(`/api/v1/rides/groups/${groupId}`)).body.group;
    expect(g.members).toHaveLength(1);
    expect(g.me.price.totalMinor).toBeLessThanOrEqual(g.me.maxTotalMinor);
    expect(events.some((e) => e.type === 'ride.rider_removed' && e.reason === 'flight_delay')).toBe(true);
  });

  it('releases a rider whose flight is cancelled and closes the request', async () => {
    const { fb, b, rb } = await pair('14:00', '14:05');
    override(fb, { cancelled: true });
    await refreshFlightStatuses(t.ctx);
    const reqB = (await b.get(`/api/v1/rides/requests/${rb}`)).body.request;
    expect(reqB.status).toBe('cancelled');
    expect(reqB.closedReason).toBe('flight_cancelled');
    expect(reqB.flight.status).toBe('cancelled');
  });

  it('keeps final prices unchanged when a locked group’s pickup moves', async () => {
    const { fa, a, groupId } = await pair('16:00', '16:00');
    await lockGroup(t.ctx, groupId);
    const before = (await a.get(`/api/v1/rides/groups/${groupId}`)).body.group;
    override(fa, { delayMinutes: 10 });
    await refreshFlightStatuses(t.ctx);
    const after = (await a.get(`/api/v1/rides/groups/${groupId}`)).body.group;
    expect(after.status).toBe('locked');
    expect(after.me.finalTotalMinor).toBe(before.me.finalTotalMinor);
    expect(new Date(after.plannedPickupAt).getTime()).toBeGreaterThan(new Date(before.plannedPickupAt).getTime());
  });

  it('tolerates a flight-status outage without changing rides', async () => {
    await pair('18:00', '18:00');
    fs.outage = true;
    try {
      await expect(refreshFlightStatuses(t.ctx)).resolves.toBe(0);
    } finally {
      fs.outage = false;
    }
  });
});

describe('rider readiness', () => {
  it('lets riders report progress, visible to co-riders only', async () => {
    const { a, b, groupId } = await pair('19:00', '19:00');
    const res = await b.post(`/api/v1/rides/groups/${groupId}/readiness`).send({ readiness: 'at_baggage' });
    expect(res.status).toBe(200);
    expect(res.body.group.me.readiness).toBe('at_baggage');
    const seen = (await a.get(`/api/v1/rides/groups/${groupId}`)).body.group.members.find((m: { isMe: boolean }) => !m.isMe);
    expect(seen.readiness).toBe('at_baggage');
    const outsider = await rider();
    expect((await outsider.post(`/api/v1/rides/groups/${groupId}/readiness`).send({ readiness: 'ready' })).status).toBe(404);
    expect((await b.post(`/api/v1/rides/groups/${groupId}/readiness`).send({ readiness: 'teleported' })).status).toBe(400);
  });

  it('shares area-level map points, not exact co-rider coordinates', async () => {
    const { a, groupId } = await pair('20:00', '20:00');
    const g = (await a.get(`/api/v1/rides/groups/${groupId}`)).body.group;
    const other = g.map.stops.find((s: { isMe: boolean }) => !s.isMe);
    expect(other).toMatchObject({ area: 'Churchgate', lat: 18.93, lng: 72.83 });
  });
});

describe('sandbox flight control', () => {
  it('is restricted to administrators', async () => {
    const f = await flight('21:00');
    const passenger = await t.loginAs('passenger@demo.waylo.app');
    expect((await passenger.post(`/api/v1/sandbox/flights/${f.id}/status`).send({ delayMinutes: 30 })).status).toBe(403);
    const admin = await t.loginAs('admin@demo.waylo.app');
    const res = await admin.post(`/api/v1/sandbox/flights/${f.id}/status`).send({ delayMinutes: 30 });
    expect(res.status).toBe(200);
    expect(res.body.flight.status).toBe('delayed');
  });
});
