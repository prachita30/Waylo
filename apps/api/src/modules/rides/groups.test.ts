import { addDays, localDate, zonedTimeToUtc } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refunds, rideGroups, rideRequests } from '../../db/schema';
import { createTestApp, type TestApp } from '../../test/harness';
import { lockGroup } from './groups';

let t: TestApp;
let zoneT2: string;
beforeAll(async () => {
  t = await createTestApp();
  const areas = (await t.agent().get('/api/v1/rides/service-areas')).body.items as { code: string; zones: { id: string; terminal: string }[] }[];
  zoneT2 = areas.find((a) => a.code === 'BOM')!.zones.find((z) => z.terminal === 'T2')!.id;
});
afterAll(() => t.close());

const D = addDays(localDate(new Date(), 'Asia/Kolkata'), 4);
const PLACES = {
  colaba: { placeId: 'sbx:colaba', label: 'Colaba, Mumbai', area: 'Colaba', lat: 18.9067, lng: 72.8147 },
  churchgate: { placeId: 'sbx:churchgate', label: 'Churchgate, Mumbai', area: 'Churchgate', lat: 18.9322, lng: 72.8264 },
  fort: { placeId: 'sbx:fort', label: 'Fort, Mumbai', area: 'Fort', lat: 18.9345, lng: 72.8356 },
  marine: { placeId: 'sbx:marine-lines', label: 'Marine Lines, Mumbai', area: 'Marine Lines', lat: 18.9447, lng: 72.8235 },
  borivali: { placeId: 'sbx:borivali', label: 'Borivali, Mumbai', area: 'Borivali', lat: 19.2307, lng: 72.8567 },
};

type Agent = ReturnType<TestApp['agent']>;
let n = 0;
async function newRider(): Promise<Agent> {
  const a = t.agent();
  const suffix = String.fromCharCode(65 + (n % 26)) + String.fromCharCode(97 + Math.floor(n / 26)) + 'surname';
  const r = await a.post('/api/v1/auth/register').send({ fullName: `Rider ${suffix}`, email: `rider${Date.now()}${n++}@example.com`, password: 'journey2026', acceptTerms: true });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return a;
}
async function request(a: Agent, dest: keyof typeof PLACES, time: string, over: Record<string, unknown> = {}) {
  const res = await a.post('/api/v1/rides/requests').send({
    airport: 'BOM',
    pickupZoneId: zoneT2,
    arrivalAt: zonedTimeToUtc(D, time, 'Asia/Kolkata').toISOString(),
    destination: PLACES[dest],
    passengers: 1,
    luggage: { cabin: 1, medium: 0, large: 0 },
    vehiclePreference: 'any',
    maxWaitMinutes: 30,
    maxDetourMinutes: 20,
    wheelchair: false,
    ...over,
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.request.id as string;
}
async function start(a: Agent, requestId: string, soloOk = false) {
  const m = await a.get(`/api/v1/rides/requests/${requestId}/matches`);
  const res = await a.post('/api/v1/rides/groups').send({ requestId, soloOk, acceptedMaxTotalMinor: m.body.newGroup.you.price.totalMinor });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.group;
}
async function join(a: Agent, requestId: string, groupId?: string) {
  const m = await a.get(`/api/v1/rides/requests/${requestId}/matches`);
  const option = groupId ? m.body.groups.find((g: { groupId: string }) => g.groupId === groupId) : m.body.groups[0];
  if (!option) return { status: 0, body: { matches: m.body } };
  return a.post(`/api/v1/rides/groups/${option.groupId}/join`).send({ requestId, acceptedMaxTotalMinor: option.you.price.totalMinor });
}

describe('matches', () => {
  it('offers a new group at the solo price and counts compatible riders', async () => {
    const a = await newRider();
    const b = await newRider();
    const ra = await request(a, 'colaba', '14:00');
    await request(b, 'churchgate', '14:10');
    const m = await a.get(`/api/v1/rides/requests/${ra}/matches`);
    expect(m.status).toBe(200);
    expect(m.body.groups).toEqual([]);
    expect(m.body.newGroup.you.price.totalMinor).toBe(m.body.newGroup.you.solo.totalMinor);
    expect(m.body.compatibleOpenRequests).toBe(1);
    expect(m.body.policy.priceGuarantee).toMatch(/never pay more/);
  });

  it('only the owner can see matches for a request', async () => {
    const a = await newRider();
    const b = await newRider();
    const ra = await request(a, 'colaba', '14:20');
    expect((await b.get(`/api/v1/rides/requests/${ra}/matches`)).status).toBe(404);
  });
});

describe('forming a group', () => {
  it('starts a group, lets a compatible rider join, and lowers the first rider’s price', async () => {
    const a = await newRider();
    const b = await newRider();
    const ra = await request(a, 'colaba', '15:00');
    const rb = await request(b, 'churchgate', '15:05');
    const g = await start(a, ra);
    expect(g.status).toBe('forming');
    const firstPrice = g.me.price.totalMinor;

    const mb = await b.get(`/api/v1/rides/requests/${rb}/matches`);
    const option = mb.body.groups.find((x: { groupId: string }) => x.groupId === g.id);
    expect(option).toBeTruthy();
    expect(option.members).toEqual([expect.objectContaining({ firstName: 'Rider', area: 'Colaba', seats: 1 })]);
    expect(option.you.price.totalMinor).toBeLessThan(option.you.solo.totalMinor);

    const joined = await b.post(`/api/v1/rides/groups/${g.id}/join`).send({ requestId: rb, acceptedMaxTotalMinor: option.you.price.totalMinor });
    expect(joined.status).toBe(200);
    expect(joined.body.group.members).toHaveLength(2);

    const ga = await a.get(`/api/v1/rides/groups/${g.id}`);
    expect(ga.body.group.me.price.totalMinor).toBeLessThan(firstPrice);
    expect(ga.body.group.me.maxTotalMinor).toBe(firstPrice);
    const [reqB] = await t.ctx.db.select().from(rideRequests).where(eq(rideRequests.id, rb));
    expect(reqB!.status).toBe('matched');
  });

  it('refuses a join when the price rose above what the rider accepted', async () => {
    const a = await newRider();
    const b = await newRider();
    const ra = await request(a, 'colaba', '15:30');
    const rb = await request(b, 'fort', '15:30');
    const g = await start(a, ra);
    const res = await b.post(`/api/v1/rides/groups/${g.id}/join`).send({ requestId: rb, acceptedMaxTotalMinor: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('price_changed');
    expect(res.body.error.details.currentTotalMinor).toBeGreaterThan(100);
  });

  it('does not offer or allow joining an incompatible destination', async () => {
    const a = await newRider();
    const c = await newRider();
    const ra = await request(a, 'colaba', '16:00');
    const rc = await request(c, 'borivali', '16:00');
    const g = await start(a, ra);
    const m = await c.get(`/api/v1/rides/requests/${rc}/matches`);
    expect(m.body.groups.find((x: { groupId: string }) => x.groupId === g.id)).toBeUndefined();
    const forced = await c.post(`/api/v1/rides/groups/${g.id}/join`).send({ requestId: rc, acceptedMaxTotalMinor: 9_999_999 });
    expect(forced.status).toBe(409);
    expect(forced.body.error.code).toBe('group_incompatible');
    expect(forced.body.error.details).toContain('Route detour too long');
  });

  it('gives the last seat to exactly one of two concurrent riders', async () => {
    const a = await newRider();
    const ra = await request(a, 'colaba', '17:00', { passengers: 3 });
    const g = await start(a, ra);
    const [c, d] = [await newRider(), await newRider()];
    const rc = await request(c, 'churchgate', '17:00');
    const rd = await request(d, 'fort', '17:00');
    const [mc, md] = [await c.get(`/api/v1/rides/requests/${rc}/matches`), await d.get(`/api/v1/rides/requests/${rd}/matches`)];
    const oc = mc.body.groups.find((x: { groupId: string }) => x.groupId === g.id);
    const od = md.body.groups.find((x: { groupId: string }) => x.groupId === g.id);
    // Both see a sedan with one seat left (3 + 1 = 4). Force sedan-only so the vehicle cannot grow.
    expect(oc.capacity.seats).toBe(4);
    await t.ctx.db.update(rideRequests).set({ vehiclePreference: 'sedan' }).where(eq(rideRequests.id, ra));
    await t.ctx.db.update(rideRequests).set({ vehiclePreference: 'sedan' }).where(eq(rideRequests.id, rc));
    await t.ctx.db.update(rideRequests).set({ vehiclePreference: 'sedan' }).where(eq(rideRequests.id, rd));
    const results = await Promise.all([
      c.post(`/api/v1/rides/groups/${g.id}/join`).send({ requestId: rc, acceptedMaxTotalMinor: oc.you.price.totalMinor }),
      d.post(`/api/v1/rides/groups/${g.id}/join`).send({ requestId: rd, acceptedMaxTotalMinor: od.you.price.totalMinor }),
    ]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(['group_full', 'group_closed']).toContain(loser.body.error.code);
    const [row] = await t.ctx.db.select().from(rideGroups).where(eq(rideGroups.id, g.id));
    expect(row!.seatsTaken).toBe(4);
    // A full vehicle locks immediately.
    expect(row!.status).toBe('locked');
  });
});

describe('leaving and locking', () => {
  it('leaving before lock is free, reopens the request, and never raises others above their agreed price', async () => {
    const a = await newRider();
    const b = await newRider();
    const c = await newRider();
    const ra = await request(a, 'colaba', '18:00');
    const rb = await request(b, 'churchgate', '18:00');
    const rc = await request(c, 'marine', '18:00');
    const g = await start(a, ra);
    await join(b, rb, g.id);
    await join(c, rc, g.id);
    const before = (await a.get(`/api/v1/rides/groups/${g.id}`)).body.group.me;

    const left = await c.post(`/api/v1/rides/groups/${g.id}/leave`).send({});
    expect(left.body).toEqual({ feeMinor: 0, requestStatus: 'open' });
    const after = (await a.get(`/api/v1/rides/groups/${g.id}`)).body.group;
    expect(after.members).toHaveLength(2);
    expect(after.me.price.totalMinor).toBeGreaterThanOrEqual(before.price.totalMinor);
    expect(after.me.price.totalMinor).toBeLessThanOrEqual(after.me.maxTotalMinor);
    // The leaver can no longer see the group.
    expect((await c.get(`/api/v1/rides/requests/${rc}`)).body.request.status).toBe('open');
  });

  it('dissolves a lone group at lock time when solo was not accepted', async () => {
    const a = await newRider();
    const ra = await request(a, 'colaba', '19:00');
    const g = await start(a, ra, false);
    await lockGroup(t.ctx, g.id);
    const [row] = await t.ctx.db.select().from(rideGroups).where(eq(rideGroups.id, g.id));
    expect(row!.status).toBe('cancelled');
    expect((await a.get(`/api/v1/rides/requests/${ra}`)).body.request.status).toBe('no_match');
  });

  it('locks a lone rider who accepted riding solo at the agreed price', async () => {
    const a = await newRider();
    const ra = await request(a, 'fort', '19:30');
    const g = await start(a, ra, true);
    await lockGroup(t.ctx, g.id);
    const view = (await a.get(`/api/v1/rides/groups/${g.id}`)).body.group;
    expect(view.status).toBe('locked');
    expect(view.me.finalTotalMinor).toBe(view.me.maxTotalMinor);
  });

  it('charges a late-cancellation fee after lock and keeps others’ prices', async () => {
    const a = await newRider();
    const b = await newRider();
    const ra = await request(a, 'colaba', '20:00');
    const rb = await request(b, 'churchgate', '20:00');
    const g = await start(a, ra);
    await join(b, rb, g.id);
    await lockGroup(t.ctx, g.id);
    expect((await a.get(`/api/v1/rides/groups/${g.id}`)).body.group.me.status).toBe('payment_due');
    // Both riders pay their final price (sandbox checkout → signed webhook).
    for (const rider of [a, b]) {
      const { checkoutUrl } = (await rider.post(`/api/v1/rides/groups/${g.id}/pay`)).body;
      await rider.post(`/api/v1/payments/sandbox/intents/${checkoutUrl.split('/').pop()}/complete`).send({ outcome: 'succeed' });
    }
    const aBefore = (await a.get(`/api/v1/rides/groups/${g.id}`)).body.group.me;
    expect(aBefore.status).toBe('confirmed');
    const bView = (await b.get(`/api/v1/rides/groups/${g.id}`)).body.group.me;
    expect(bView.leaveFeeNowMinor).toBe(Math.round(bView.finalTotalMinor * 0.25));

    const left = await b.post(`/api/v1/rides/groups/${g.id}/leave`).send({});
    expect(left.body.feeMinor).toBe(Math.round(bView.finalTotalMinor * 0.25));
    expect(left.body.requestStatus).toBe('cancelled');
    const aAfter = (await a.get(`/api/v1/rides/groups/${g.id}`)).body.group.me;
    expect(aAfter.finalTotalMinor).toBe(aBefore.finalTotalMinor);
    const [row] = await t.ctx.db.select().from(rideGroups).where(eq(rideGroups.id, g.id));
    expect(row!.platformSubsidyMinor).toBeGreaterThan(0);
    // The leaver is refunded what they paid minus the fee.
    const [refund] = await t.ctx.db.select().from(refunds).where(eq(refunds.reason, 'ride_left_after_lock'));
    expect(refund!.amountMinor).toBe(bView.finalTotalMinor - Math.round(bView.finalTotalMinor * 0.25));
  });
});

describe('privacy and access', () => {
  it('shows co-riders by first name and area only, and hides the group from outsiders', async () => {
    const a = await newRider();
    const b = await newRider();
    const outsider = await newRider();
    const ra = await request(a, 'colaba', '21:00');
    const rb = await request(b, 'churchgate', '21:00');
    const g = await start(a, ra);
    await join(b, rb, g.id);
    const res = await a.get(`/api/v1/rides/groups/${g.id}`);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/@example\.com/);
    expect(text).not.toMatch(/Number\d/); // last names
    expect(text).not.toMatch(/18\.932/); // exact co-rider coordinates (area-level 18.93 is allowed)
    expect(res.body.group.members.map((m: { area: string }) => m.area).sort()).toEqual(['Churchgate', 'Colaba']);
    expect((await outsider.get(`/api/v1/rides/groups/${g.id}`)).status).toBe(404);
    expect((await outsider.post(`/api/v1/rides/groups/${g.id}/leave`).send({})).status).toBe(404);
  });
});
