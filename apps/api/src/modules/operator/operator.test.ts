import { addDays, localDate, zonedTimeToUtc } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { operators, rideGroups, rideParticipants, rideTrips, users } from '../../db/schema';
import { createTestApp, type TestApp } from '../../test/harness';
import { lockGroup } from '../rides/groups';
import { membershipFor } from './access';
import { riderAction } from './trips';

let t: TestApp;
let zoneT2: string;
const D = addDays(localDate(new Date(), 'Asia/Kolkata'), 5);
beforeAll(async () => {
  t = await createTestApp();
  const areas = (await t.agent().get('/api/v1/rides/service-areas')).body.items as { code: string; zones: { id: string; terminal: string }[] }[];
  zoneT2 = areas.find((a) => a.code === 'BOM')!.zones.find((z) => z.terminal === 'T2')!.id;
});
afterAll(() => t.close());

type Agent = ReturnType<TestApp['agent']>;
let n = 0;
const letters = () => String.fromCharCode(65 + (n % 26)) + String.fromCharCode(97 + Math.floor(n++ / 26));
async function account(accountType: 'passenger' | 'operator' = 'passenger'): Promise<Agent> {
  const a = t.agent();
  const r = await a.post('/api/v1/auth/register').send({ fullName: `Test ${letters()}person`, email: `op${Date.now()}${n}@example.com`, password: 'journey2026', acceptTerms: true, accountType });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return a;
}
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

/** Two riders in a locked group arriving at `time` on day D. */
async function lockedGroup(time: string) {
  const make = async (place: { area: string; lat: number; lng: number }) => {
    const a = await account();
    const req = await a.post('/api/v1/rides/requests').send({
      airport: 'BOM',
      pickupZoneId: zoneT2,
      arrivalAt: zonedTimeToUtc(D, time, 'Asia/Kolkata').toISOString(),
      destination: { placeId: `sbx:${place.area}`, label: place.area, ...place },
      passengers: 1,
      luggage: { cabin: 1, medium: 0, large: 0 },
      vehiclePreference: 'any',
      maxWaitMinutes: 30,
      maxDetourMinutes: 20,
      wheelchair: false,
    });
    if (req.status !== 201) throw new Error(JSON.stringify(req.body));
    return { a, requestId: req.body.request.id as string };
  };
  const ra = await make({ area: 'Colaba', lat: 18.9067, lng: 72.8147 });
  const rb = await make({ area: 'Churchgate', lat: 18.9322, lng: 72.8264 });
  const m = await ra.a.get(`/api/v1/rides/requests/${ra.requestId}/matches`);
  const g = (await ra.a.post('/api/v1/rides/groups').send({ requestId: ra.requestId, soloOk: false, acceptedMaxTotalMinor: m.body.newGroup.you.price.totalMinor })).body.group;
  const mb = await rb.a.get(`/api/v1/rides/requests/${rb.requestId}/matches`);
  const opt = mb.body.groups.find((x: { groupId: string }) => x.groupId === g.id);
  await rb.a.post(`/api/v1/rides/groups/${g.id}/join`).send({ requestId: rb.requestId, acceptedMaxTotalMinor: opt.you.price.totalMinor });
  await lockGroup(t.ctx, g.id);
  return { groupId: g.id as string, riderA: ra.a, riderB: rb.a };
}

async function demoFleet() {
  const owner = await t.loginAs('operator@demo.waylo.app');
  const fleet = (await owner.get('/api/v1/operator/fleet')).body;
  const driver = fleet.drivers.find((d: { fullName: string }) => d.fullName === 'Demo Driver');
  const sedan = fleet.vehicles.find((v: { vehicleClass: string }) => v.vehicleClass === 'sedan');
  return { owner, driverId: driver.id as string, sedanId: sedan.id as string, fleet };
}

describe('operator onboarding and approval', () => {
  it('self-registered operators start pending and cannot take trips until approved', async () => {
    const op = await account('operator');
    expect((await op.get('/api/v1/operator/fleet')).body.error.code).toBe('not_onboarded');
    const onboard = await op.post('/api/v1/operator/onboarding').send({ name: 'Konkan Cabs', phone: '+919811111111', airports: ['BOM'] });
    expect(onboard.status).toBe(201);
    expect(onboard.body.operator.status).toBe('pending');
    const offers = await op.get('/api/v1/operator/trips?tab=offers');
    expect(offers.status).toBe(403);
    expect(offers.body.error.code).toBe('operator_not_approved');

    const admin = await t.loginAs('admin@demo.waylo.app');
    const approve = await admin.post(`/api/v1/admin/review/operator/${onboard.body.operator.id}`).send({ decision: 'approved' });
    expect(approve.body.item.status).toBe('approved');
    expect((await op.get('/api/v1/operator/trips?tab=offers')).status).toBe(200);
  });

  it('passengers cannot use the operator portal or admin review', async () => {
    const p = await account();
    expect((await p.get('/api/v1/operator/me')).status).toBe(403);
    expect((await p.get('/api/v1/admin/review/pending')).status).toBe(403);
  });

  it('cannot self-register as an administrator', async () => {
    const r = await t.agent().post('/api/v1/auth/register').send({ fullName: 'Sneaky Person', email: `x${Date.now()}@example.com`, password: 'journey2026', acceptTerms: true, accountType: 'admin' });
    expect(r.status).toBe(400);
  });
});

describe('fleet management', () => {
  it('adds vehicles and drivers pending review, validates input, and stores licence last 4 only', async () => {
    const { owner } = await demoFleet();
    const v = await owner.post('/api/v1/operator/vehicles').send({ vehicleClass: 'suv', makeModel: 'Mahindra XUV700', colour: 'Black', registration: 'mh-02-xy-4321', seats: 6, luggageUnits: 10, wheelchairAccessible: false });
    expect(v.status).toBe(201);
    expect(v.body.vehicle).toMatchObject({ status: 'pending', registration: 'MH 02 XY 4321' });
    const dup = await owner.post('/api/v1/operator/vehicles').send({ vehicleClass: 'suv', makeModel: 'Other', colour: 'Red', registration: 'MH 02 XY 4321', seats: 6, luggageUnits: 10, wheelchairAccessible: false });
    expect(dup.status).toBe(409);
    const bad = await owner.post('/api/v1/operator/vehicles').send({ vehicleClass: 'van', makeModel: 'Tiny', colour: 'Red', registration: 'MH 02 XY 1', seats: 3, luggageUnits: 4, wheelchairAccessible: false });
    expect(bad.status).toBe(400);
    const d = await owner.post('/api/v1/operator/drivers').send({ fullName: 'Arjun Patil', phone: '+919822222222', licenceLast4: 'ab12' });
    expect(d.body.driver).toMatchObject({ status: 'pending', licenceLast4: 'AB12' });
  });

  it('only schedules approved drivers and vehicles, without overlapping shifts', async () => {
    const { owner, fleet } = await demoFleet();
    const pendingVehicle = (await owner.post('/api/v1/operator/vehicles').send({ vehicleClass: 'sedan', makeModel: 'Honda City', colour: 'Blue', registration: 'MH 04 QQ 1111', seats: 4, luggageUnits: 6, wheelchairAccessible: false })).body.vehicle;
    const driver = fleet.drivers[1];
    const start = new Date(Date.now() + 10 * 86_400_000);
    const slot = { driverId: driver.id, vehicleId: pendingVehicle.id, airport: 'BOM', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 8 * 3_600_000).toISOString() };
    expect((await owner.post('/api/v1/operator/availability').send(slot)).body.error.code).toBe('not_approved');
    const admin = await t.loginAs('admin@demo.waylo.app');
    await admin.post(`/api/v1/admin/review/vehicle/${pendingVehicle.id}`).send({ decision: 'approved' });
    // The demo driver already has a long standby window; a new overlapping shift is refused.
    expect((await owner.post('/api/v1/operator/availability').send(slot)).body.error.code).toBe('overlap');
    const tooLong = await owner.post('/api/v1/operator/availability').send({ ...slot, endsAt: new Date(start.getTime() + 20 * 3_600_000).toISOString() });
    expect(tooLong.status).toBe(400);
  });

  it('accepts PDF documents, rejects other files, and keeps them private to the operator and admins', async () => {
    const { owner, fleet } = await demoFleet();
    const vehicleId = fleet.vehicles[0].id;
    const up = await owner.post('/api/v1/operator/documents').field('subjectType', 'vehicle').field('subjectId', vehicleId).field('docType', 'insurance').field('expiresOn', '2027-03-31').attach('file', PDF, { filename: 'ins.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect(up.body.document).not.toHaveProperty('fileName');
    const evil = await owner.post('/api/v1/operator/documents').field('subjectType', 'vehicle').field('subjectId', vehicleId).field('docType', 'insurance').attach('file', Buffer.from('MZ\x90\x00'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(evil.status).toBe(400);
    const file = await owner.get(`/api/v1/operator/documents/${up.body.document.id}/file`);
    expect(file.headers['content-type']).toBe('application/pdf');

    const other = await account('operator');
    await other.post('/api/v1/operator/onboarding').send({ name: 'Other Cabs', phone: '+919833333333', airports: ['BOM'] });
    expect((await other.get(`/api/v1/operator/documents/${up.body.document.id}/file`)).status).toBe(404);
    // Cannot attach documents to another operator's vehicle.
    const cross = await other.post('/api/v1/operator/documents').field('subjectType', 'vehicle').field('subjectId', vehicleId).field('docType', 'insurance').attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(cross.status).toBe(404);

    const admin = await t.loginAs('admin@demo.waylo.app');
    expect((await admin.get(`/api/v1/admin/review/documents/${up.body.document.id}/file`)).status).toBe(200);
    const verified = await admin.post(`/api/v1/admin/review/document/${up.body.document.id}`).send({ decision: 'approved', reason: 'Valid until March 2027' });
    expect(verified.body.item.status).toBe('approved');
  });
});

describe('trip lifecycle', () => {
  it('offers a locked group, accepts it, shows the driver to riders, and completes it with earnings', async () => {
    const { groupId, riderA } = await lockedGroup('10:00');
    const { owner, driverId, sedanId } = await demoFleet();
    const offers = (await owner.get('/api/v1/operator/trips?tab=offers')).body.items;
    const offer = offers.find((o: { groupId: string }) => o.groupId === groupId);
    expect(offer).toBeTruthy();
    expect(offer.estimatedEarningMinor).toBe(offer.vehicleFareMinor - Math.round((offer.vehicleFareMinor * 1500) / 10_000));

    const acc = await owner.post(`/api/v1/operator/trips/${groupId}/accept`).send({ driverId, vehicleId: sedanId });
    expect(acc.status).toBe(200);
    expect(acc.body.trip.riders).toHaveLength(2);
    expect(JSON.stringify(acc.body.trip)).not.toMatch(/@example\.com|\+91/);

    const riderView = (await riderA.get(`/api/v1/rides/groups/${groupId}`)).body.group;
    expect(riderView.status).toBe('assigned');
    expect(riderView.trip).toMatchObject({ driverFirstName: 'Demo', vehicle: { registration: 'MH 01 DM 1001' }, location: null });

    const driver = await t.loginAs('driver@demo.waylo.app');
    expect((await driver.post(`/api/v1/operator/trips/${groupId}/status`).send({ status: 'arrived' })).status).toBe(409);
    expect((await driver.post(`/api/v1/operator/trips/${groupId}/status`).send({ status: 'en_route' })).body.trip.status).toBe('en_route');
    await driver.post(`/api/v1/operator/trips/${groupId}/location`).send({ lat: 19.09, lng: 72.87 });
    expect((await riderA.get(`/api/v1/rides/groups/${groupId}`)).body.group.trip.location).toMatchObject({ lat: 19.09, lng: 72.87 });
    await driver.post(`/api/v1/operator/trips/${groupId}/status`).send({ status: 'arrived' });

    const trip = (await driver.get(`/api/v1/operator/trips/${groupId}`)).body.trip;
    const [pa, pb] = trip.riders;
    // No-show is not allowed before the grace period ends.
    const early = await driver.post(`/api/v1/operator/trips/${groupId}/riders/${pb.participantId}`).send({ action: 'no_show' });
    expect(early.body.error.code).toBe('grace_period');
    await driver.post(`/api/v1/operator/trips/${groupId}/riders/${pa.participantId}`).send({ action: 'boarded' });
    expect((await driver.post(`/api/v1/operator/trips/${groupId}/status`).send({ status: 'in_progress' })).body.error.code).toBe('riders_pending');

    const [driverUser] = await t.ctx.db.select().from(users).where(eq(users.email, 'driver@demo.waylo.app'));
    const m = (await membershipFor(t.ctx.db, driverUser!.id))!;
    const [g] = await t.ctx.db.select().from(rideGroups).where(eq(rideGroups.id, groupId));
    await riderAction(t.ctx, m, driverUser!.id, groupId, pb.participantId, 'no_show', new Date(g!.plannedPickupAt.getTime() + 16 * 60_000));
    const [noShow] = await t.ctx.db.select().from(rideParticipants).where(eq(rideParticipants.id, pb.participantId));
    expect(noShow!.status).toBe('no_show');
    expect(noShow!.cancellationFeeMinor).toBe(noShow!.finalTotalMinor);

    expect((await driver.post(`/api/v1/operator/trips/${groupId}/status`).send({ status: 'in_progress' })).body.trip.status).toBe('in_progress');
    const onRoute = await driver.post(`/api/v1/operator/trips/${groupId}/location`).send({ lat: 19.0, lng: 72.84 });
    expect(onRoute.body.offRoute).toBe(false);
    const offRoute = await driver.post(`/api/v1/operator/trips/${groupId}/location`).send({ lat: 19.2307, lng: 72.8567 });
    expect(offRoute.body.offRoute).toBe(true);

    const done = await driver.post(`/api/v1/operator/trips/${groupId}/riders/${pa.participantId}`).send({ action: 'dropped_off' });
    expect(done.body.trip.status).toBe('completed');
    expect(done.body.trip.earningMinor).toBe(offer.estimatedEarningMinor);
    expect((await riderA.get(`/api/v1/rides/groups/${groupId}`)).body.group.status).toBe('completed');
    const earn = (await owner.get('/api/v1/operator/earnings')).body;
    expect(earn.trips.some((x: { groupId: string }) => x.groupId === groupId)).toBe(true);
  });

  it('lets exactly one operator accept a trip', async () => {
    const { groupId } = await lockedGroup('12:00');
    const { owner, driverId, sedanId } = await demoFleet();
    // A second approved operator with an approved sedan and driver.
    const other = await account('operator');
    const op = (await other.post('/api/v1/operator/onboarding').send({ name: 'Rival Cabs', phone: '+919844444444', airports: ['BOM'] })).body.operator;
    const v = (await other.post('/api/v1/operator/vehicles').send({ vehicleClass: 'sedan', makeModel: 'Hyundai Aura', colour: 'Red', registration: 'MH 03 RV 7777', seats: 4, luggageUnits: 6, wheelchairAccessible: false })).body.vehicle;
    const d = (await other.post('/api/v1/operator/drivers').send({ fullName: 'Rival Driver', phone: '+919855555555', licenceLast4: 'RV77' })).body.driver;
    const admin = await t.loginAs('admin@demo.waylo.app');
    for (const [kind, id] of [['operator', op.id], ['vehicle', v.id], ['driver', d.id]]) await admin.post(`/api/v1/admin/review/${kind}/${id}`).send({ decision: 'approved' });

    const [r1, r2] = await Promise.all([
      owner.post(`/api/v1/operator/trips/${groupId}/accept`).send({ driverId, vehicleId: sedanId }),
      other.post(`/api/v1/operator/trips/${groupId}/accept`).send({ driverId: d.id, vehicleId: v.id }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect((await t.ctx.db.select().from(rideTrips).where(eq(rideTrips.groupId, groupId)))).toHaveLength(1);
  });

  it('prevents double-booking a driver and lets an operator release a trip for re-offer', async () => {
    // Clear of other tests' trips (a driver may not hold trips within 2h of each other).
    const first = await lockedGroup('21:00');
    const second = await lockedGroup('21:30');
    const { owner, driverId, sedanId, fleet } = await demoFleet();
    expect((await owner.post(`/api/v1/operator/trips/${first.groupId}/accept`).send({ driverId, vehicleId: sedanId })).status).toBe(200);
    const suv = fleet.vehicles.find((x: { vehicleClass: string }) => x.vehicleClass === 'suv');
    const busy = await owner.post(`/api/v1/operator/trips/${second.groupId}/accept`).send({ driverId, vehicleId: suv.id });
    expect(busy.body.error.code).toBe('driver_busy');

    expect((await owner.post(`/api/v1/operator/trips/${first.groupId}/release`).send({ reason: 'Vehicle breakdown' })).status).toBe(204);
    const offers = (await owner.get('/api/v1/operator/trips?tab=offers')).body.items;
    expect(offers.some((o: { groupId: string }) => o.groupId === first.groupId)).toBe(true);
  });

  it('keeps drivers to their own trips', async () => {
    const { groupId } = await lockedGroup('16:00');
    const { owner, fleet, sedanId } = await demoFleet();
    const otherDriver = fleet.drivers.find((d: { fullName: string }) => d.fullName === 'Ravi Demo');
    await owner.post(`/api/v1/operator/trips/${groupId}/accept`).send({ driverId: otherDriver.id, vehicleId: sedanId });
    const driver = await t.loginAs('driver@demo.waylo.app');
    expect((await driver.get(`/api/v1/operator/trips/${groupId}`)).status).toBe(404);
    expect((await driver.post(`/api/v1/operator/trips/${groupId}/status`).send({ status: 'en_route' })).status).toBe(404);
    expect((await driver.get('/api/v1/operator/trips?tab=offers')).status).toBe(400);
  });
});

describe('supply and incidents', () => {
  it('reports no vehicle available when no approved operator serves the airport', async () => {
    const [demo] = await t.ctx.db.select().from(operators).where(eq(operators.name, 'WAYLO Demo Fleet'));
    const others = await t.ctx.db.select().from(operators);
    for (const o of others) await t.ctx.db.update(operators).set({ status: 'suspended' }).where(eq(operators.id, o.id));
    try {
      const a = await account();
      const req = await a.post('/api/v1/rides/requests').send({
        airport: 'BOM',
        pickupZoneId: zoneT2,
        arrivalAt: zonedTimeToUtc(addDays(D, 1), '09:00', 'Asia/Kolkata').toISOString(),
        destination: { placeId: 'sbx:colaba', label: 'Colaba', area: 'Colaba', lat: 18.9067, lng: 72.8147 },
        passengers: 1,
        luggage: { cabin: 1, medium: 0, large: 0 },
        vehiclePreference: 'any',
        maxWaitMinutes: 30,
        maxDetourMinutes: 20,
        wheelchair: false,
      });
      const m = await a.get(`/api/v1/rides/requests/${req.body.request.id}/matches`);
      expect(m.body.newGroup).toBeNull();
      expect(m.body.newGroupBlockedBy).toContain('No vehicle available');
    } finally {
      for (const o of others) await t.ctx.db.update(operators).set({ status: o.status }).where(eq(operators.id, o.id));
      expect(demo!.status).toBe('approved');
    }
  });

  it('accepts incident reports from riders of a ride and refuses outsiders', async () => {
    const { groupId, riderA } = await lockedGroup('18:00');
    const ok = await riderA.post('/api/v1/incidents').send({ groupId, category: 'safety', severity: 'high', description: 'Driver was driving unsafely on the sea link.' });
    expect(ok.status).toBe(201);
    const outsider = await account();
    expect((await outsider.post('/api/v1/incidents').send({ groupId, category: 'other', severity: 'low', description: 'I was not on this ride at all.' })).status).toBe(404);
    expect((await riderA.post('/api/v1/incidents').send({ category: 'other', severity: 'low', description: 'short' })).status).toBe(400);
  });
});
