import { addDays, localDate, zonedTimeToUtc } from '@waylo/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SandboxAirlineAdapter } from '../../adapters/airline/sandbox';
import { SandboxPaymentAdapter } from '../../adapters/payments/sandbox';
import { payments, refunds, rideGroups, rideParticipants, rideRequests, settlements } from '../../db/schema';
import { createTestApp, type TestApp } from '../../test/harness';
import type { OfferDto } from '../flights/service';
import { lockGroup } from '../rides/groups';
import { processPendingRefunds, requestRefund } from './refunds';
import { releaseUnpaidSeats } from './ridePayments';

const SECRET = 'phase10-webhook-secret-00';
const pay = new SandboxPaymentAdapter(SECRET);
pay.inlineRefundWebhooks = true;
const airline = new SandboxAirlineAdapter();
let t: TestApp;
let zoneT2: string;
const D = addDays(localDate(new Date(), 'Asia/Kolkata'), 6);
beforeAll(async () => {
  t = await createTestApp({ PAYMENT_WEBHOOK_SECRET: SECRET }, { adapters: { payments: pay, airline } });
  const areas = (await t.agent().get('/api/v1/rides/service-areas')).body.items as { code: string; zones: { id: string; terminal: string }[] }[];
  zoneT2 = areas.find((a) => a.code === 'BOM')!.zones.find((z) => z.terminal === 'T2')!.id;
});
afterAll(() => t.close());
afterEach(() => {
  pay.failRefunds = false;
  airline.scenarios = { priceChangeBps: 0, unavailable: false, failCreateOrder: false, ticketing: 'instant', delayedPolls: 2 };
});

type Agent = ReturnType<TestApp['agent']>;
let n = 0;
async function account(): Promise<Agent> {
  const a = t.agent();
  const r = await a.post('/api/v1/auth/register').send({ fullName: `Payer ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(97 + Math.floor(n / 26))}x`, email: `payer${Date.now()}${n++}@example.com`, password: 'journey2026', acceptTerms: true });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return a;
}
const checkout = async (a: Agent, url: string, outcome: 'succeed' | 'fail' = 'succeed') => a.post(`/api/v1/payments/sandbox/intents/${url.split('/').pop()}/complete`).send({ outcome });

async function lockedPair(time: string) {
  const mk = async (place: { area: string; lat: number; lng: number }) => {
    const a = await account();
    const r = await a.post('/api/v1/rides/requests').send({
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
    return { a, requestId: r.body.request.id as string };
  };
  const A = await mk({ area: 'Colaba', lat: 18.9067, lng: 72.8147 });
  const B = await mk({ area: 'Churchgate', lat: 18.9322, lng: 72.8264 });
  const m = await A.a.get(`/api/v1/rides/requests/${A.requestId}/matches`);
  const g = (await A.a.post('/api/v1/rides/groups').send({ requestId: A.requestId, soloOk: false, acceptedMaxTotalMinor: m.body.newGroup.you.price.totalMinor })).body.group;
  const opt = (await B.a.get(`/api/v1/rides/requests/${B.requestId}/matches`)).body.groups.find((x: { groupId: string }) => x.groupId === g.id);
  await B.a.post(`/api/v1/rides/groups/${g.id}/join`).send({ requestId: B.requestId, acceptedMaxTotalMinor: opt.you.price.totalMinor });
  await lockGroup(t.ctx, g.id);
  return { groupId: g.id as string, A, B };
}

describe('ride payments', () => {
  it('asks every rider to pay their final price when the group locks', async () => {
    const { groupId, A, B } = await lockedPair('09:00');
    const view = (await A.a.get(`/api/v1/rides/groups/${groupId}`)).body.group.me;
    expect(view.status).toBe('payment_due');
    expect(view.payment).toMatchObject({ status: 'requires_payment', amountMinor: view.finalTotalMinor });
    expect(new Date(view.paymentDueAt).getTime()).toBeGreaterThan(Date.now());

    const { checkoutUrl, amountMinor } = (await A.a.post(`/api/v1/rides/groups/${groupId}/pay`)).body;
    expect(amountMinor).toBe(view.finalTotalMinor);
    const done = await checkout(A.a, checkoutUrl);
    expect(done.body.payment.returnPath).toBe(`/trips/rides/${A.requestId}`);
    expect((await A.a.get(`/api/v1/rides/groups/${groupId}`)).body.group.me.status).toBe('confirmed');
    expect((await A.a.post(`/api/v1/rides/groups/${groupId}/pay`)).body.error.code).toBe('not_payable');
    // The other rider cannot pay for (or see) someone else's seat payment.
    expect((await checkout(B.a, checkoutUrl)).status).toBe(404);
  });

  it('releases unpaid seats at the deadline; paid riders keep their price', async () => {
    const { groupId, A, B } = await lockedPair('11:00');
    const { checkoutUrl } = (await A.a.post(`/api/v1/rides/groups/${groupId}/pay`)).body;
    await checkout(A.a, checkoutUrl);
    const before = (await A.a.get(`/api/v1/rides/groups/${groupId}`)).body.group.me.finalTotalMinor;
    await releaseUnpaidSeats(t.ctx, new Date(Date.now() + 2 * 3_600_000));
    const [pb] = await t.ctx.db.select().from(rideParticipants).where(eq(rideParticipants.requestId, B.requestId));
    expect(pb).toMatchObject({ status: 'removed', removedReason: 'payment_timeout' });
    const [rb] = await t.ctx.db.select().from(rideRequests).where(eq(rideRequests.id, B.requestId));
    expect(rb).toMatchObject({ status: 'cancelled', closedReason: 'payment_timeout' });
    const bPayments = await t.ctx.db.select().from(payments).where(and(eq(payments.purpose, 'ride'), eq(payments.referenceId, pb!.id)));
    expect(bPayments.every((p) => p.status === 'cancelled')).toBe(true);
    const g = (await A.a.get(`/api/v1/rides/groups/${groupId}`)).body.group;
    expect(g.status).toBe('locked');
    expect(g.me.finalTotalMinor).toBe(before);
  });

  it('cancels the group when nobody pays', async () => {
    const { groupId } = await lockedPair('13:00');
    await releaseUnpaidSeats(t.ctx, new Date(Date.now() + 2 * 3_600_000));
    const [g] = await t.ctx.db.select().from(rideGroups).where(eq(rideGroups.id, groupId));
    expect(g!.status).toBe('cancelled');
  });

  it('refunds a leaver after lock minus the late-cancellation fee', async () => {
    const { groupId, B } = await lockedPair('15:00');
    const { checkoutUrl } = (await B.a.post(`/api/v1/rides/groups/${groupId}/pay`)).body;
    await checkout(B.a, checkoutUrl);
    const me = (await B.a.get(`/api/v1/rides/groups/${groupId}`)).body.group.me;
    const left = (await B.a.post(`/api/v1/rides/groups/${groupId}/leave`).send({})).body;
    expect(left.feeMinor).toBe(Math.round(me.finalTotalMinor * 0.25));
    await processPendingRefunds(t.ctx);
    const [p] = await t.ctx.db.select().from(payments).where(and(eq(payments.purpose, 'ride'), eq(payments.referenceId, me.participantId)));
    expect(p!.refundedMinor).toBe(me.finalTotalMinor - left.feeMinor);
    expect(p!.status).toBe('partially_refunded');
  });
});

describe('refund ledger', () => {
  async function paidBooking(a: Agent) {
    const search = await a.get('/api/v1/flights/search').query({ from: 'BOM', to: 'GOI', date: D, adults: 1, pageSize: 50 });
    const offer = (search.body.items as OfferDto[]).find((o) => o.source === 'airline' && ['available', 'limited'].includes(o.availability) && !o.conditions.refundable)!;
    const v = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    const b = await a
      .post('/api/v1/flights/bookings')
      .set('Idempotency-Key', `refund-test-${Date.now()}-${n++}`)
      .send({ priceLockId: v.body.lock.id, passengers: [{ firstName: 'Ana', lastName: 'Rao' }], contact: { email: 'ana@example.com' }, acceptedTotalMinor: v.body.lock.totalMinor, acceptFareRules: true });
    await checkout(a, b.body.checkoutUrl);
    return b.body.booking.id as string;
  }

  it('refunds a cancelled flight through the provider and records it on the booking', async () => {
    const a = await account();
    const id = await paidBooking(a);
    const c = await a.post(`/api/v1/flights/bookings/${id}/cancel`);
    expect(c.body.booking.refunds).toEqual([expect.objectContaining({ status: 'pending', reason: 'flight_cancellation', amountMinor: c.body.booking.refundDueMinor })]);
    await processPendingRefunds(t.ctx);
    const after = (await a.get(`/api/v1/flights/bookings/${id}`)).body.booking;
    expect(after.refunds[0].status).toBe('succeeded');
    expect(after.payment.refundedMinor).toBe(after.refundDueMinor);
    expect(after.payment.status).toBe('partially_refunded');
  });

  it('refunds the full amount when the airline cannot issue a ticket', async () => {
    const a = await account();
    airline.scenarios.ticketing = 'fail';
    const id = await paidBooking(a);
    await processPendingRefunds(t.ctx);
    const b = (await a.get(`/api/v1/flights/bookings/${id}`)).body.booking;
    expect(b.status).toBe('ticketing_failed');
    expect(b.refunds[0]).toMatchObject({ reason: 'ticketing_failed', status: 'succeeded', amountMinor: b.totalMinor });
    expect(b.payment.status).toBe('refunded');
  });

  it('is idempotent and never refunds more than was paid', async () => {
    const a = await account();
    const id = await paidBooking(a);
    const [p] = await t.ctx.db.select().from(payments).where(and(eq(payments.purpose, 'flight_booking'), eq(payments.referenceId, id)));
    await t.ctx.db.transaction(async (tx) => {
      const first = await requestRefund(tx, { paymentId: p!.id, amountMinor: 10_000_000, reason: 'admin_goodwill', idempotencyKey: `goodwill:${id}` });
      const again = await requestRefund(tx, { paymentId: p!.id, amountMinor: 50, reason: 'admin_goodwill', idempotencyKey: `goodwill:${id}` });
      expect(first!.amountMinor).toBe(p!.amountMinor); // capped at the payment
      expect(again!.id).toBe(first!.id);
      const extra = await requestRefund(tx, { paymentId: p!.id, amountMinor: 100, reason: 'admin_goodwill', idempotencyKey: `goodwill2:${id}` });
      expect(extra).toBeNull(); // nothing left to refund
    });
  });

  it('marks a failed refund for review without retrying, and an admin retry succeeds', async () => {
    const a = await account();
    const id = await paidBooking(a);
    pay.failRefunds = true;
    await a.post(`/api/v1/flights/bookings/${id}/cancel`);
    await processPendingRefunds(t.ctx);
    const [failed] = await t.ctx.db.select().from(refunds).where(eq(refunds.idempotencyKey, `booking:${id}:cancel`));
    expect(failed!.status).toBe('failed');
    await processPendingRefunds(t.ctx);
    expect((await t.ctx.db.select().from(refunds).where(eq(refunds.id, failed!.id)))[0]!.attempts).toBe(1);

    pay.failRefunds = false;
    const admin = await t.loginAs('admin@demo.waylo.app');
    expect((await a.post(`/api/v1/admin/refunds/${failed!.id}/retry`)).status).toBe(403);
    expect((await admin.post(`/api/v1/admin/refunds/${failed!.id}/retry`)).body.refund.status).toBe('pending');
    await processPendingRefunds(t.ctx);
    expect((await t.ctx.db.select().from(refunds).where(eq(refunds.id, failed!.id)))[0]!.status).toBe('succeeded');
  });
});

describe('operator settlements', () => {
  it('settles completed trips once and records the payout reference', async () => {
    const { groupId, A, B } = await lockedPair('19:00');
    for (const r of [A, B]) {
      const { checkoutUrl } = (await r.a.post(`/api/v1/rides/groups/${groupId}/pay`)).body;
      await checkout(r.a, checkoutUrl);
    }
    const owner = await t.loginAs('operator@demo.waylo.app');
    const driver = await t.loginAs('driver@demo.waylo.app');
    const fleet = (await owner.get('/api/v1/operator/fleet')).body;
    const d = fleet.drivers.find((x: { fullName: string }) => x.fullName === 'Demo Driver');
    const v = fleet.vehicles.find((x: { vehicleClass: string }) => x.vehicleClass === 'sedan');
    await owner.post(`/api/v1/operator/trips/${groupId}/accept`).send({ driverId: d.id, vehicleId: v.id });
    for (const s of ['en_route', 'arrived']) await driver.post(`/api/v1/operator/trips/${groupId}/status`).send({ status: s });
    let trip = (await driver.get(`/api/v1/operator/trips/${groupId}`)).body.trip;
    for (const r of trip.riders) await driver.post(`/api/v1/operator/trips/${groupId}/riders/${r.participantId}`).send({ action: 'boarded' });
    await driver.post(`/api/v1/operator/trips/${groupId}/status`).send({ status: 'in_progress' });
    for (const r of trip.riders) trip = (await driver.post(`/api/v1/operator/trips/${groupId}/riders/${r.participantId}`).send({ action: 'dropped_off' })).body.trip;
    expect(trip.status).toBe('completed');

    const admin = await t.loginAs('admin@demo.waylo.app');
    const run = await admin.post('/api/v1/admin/settlements/run').send({});
    const mine = run.body.items.find((s: { operatorId: string }) => s.operatorId === (fleet.vehicles[0] ? (fleet.vehicles[0] as { operatorId: string }).operatorId : ''));
    expect(mine.payoutMinor).toBe(mine.grossFareMinor - mine.commissionMinor);
    expect(mine.tripsCount).toBeGreaterThanOrEqual(1);
    // Running again does not settle the same trips twice.
    const again = await admin.post('/api/v1/admin/settlements/run').send({});
    expect(again.body.items.find((s: { operatorId: string }) => s.operatorId === mine.operatorId)).toBeUndefined();

    const paid = await admin.post(`/api/v1/admin/settlements/${mine.id}/paid`).send({ reference: 'NEFT-DEMO-0001' });
    expect(paid.body.settlement).toMatchObject({ status: 'paid', payoutReference: 'NEFT-DEMO-0001' });
    expect((await admin.post(`/api/v1/admin/settlements/${mine.id}/paid`).send({ reference: 'AGAIN-0002' })).status).toBe(409);
    const ownerView = (await owner.get('/api/v1/operator/settlements')).body.items;
    expect(ownerView.some((s: { id: string }) => s.id === mine.id)).toBe(true);
    expect((await driver.get('/api/v1/operator/settlements')).status).toBe(404);
    expect((await t.ctx.db.select().from(settlements)).length).toBeGreaterThanOrEqual(1);
  });
});
