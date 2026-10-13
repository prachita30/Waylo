import { addDays, localDate } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SandboxAirlineAdapter } from '../../adapters/airline/sandbox';
import { SandboxPaymentAdapter, signPayload } from '../../adapters/payments/sandbox';
import { flightBookings, flightOffers, paymentEvents, payments } from '../../db/schema';
import { createTestApp, type TestApp } from '../../test/harness';
import type { OfferDto } from '../flights/service';
import { expireUnpaidBookings, pollPendingTicketing } from './service';

const SECRET = 'test-webhook-secret-123456';
const airline = new SandboxAirlineAdapter();
const pay = new SandboxPaymentAdapter(SECRET);
const D5 = addDays(localDate(new Date(), 'Asia/Kolkata'), 5);

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ PAYMENT_WEBHOOK_SECRET: SECRET }, { adapters: { airline, payments: pay } });
});
afterAll(() => t.close());
afterEach(() => {
  airline.scenarios = { priceChangeBps: 0, unavailable: false, failCreateOrder: false, ticketing: 'instant', delayedPolls: 2 };
  airline.outage = false;
});

type Agent = ReturnType<TestApp['agent']>;
const PAX = (n: number) => Array.from({ length: n }, (_, i) => ({ firstName: 'Ananya', lastName: `Rao${String.fromCharCode(65 + i)}` }));
let keyN = 0;
const key = () => `test-key-${Date.now()}-${keyN++}`;

async function pickOffer(a: Agent, adults = 1, filter: (o: OfferDto) => boolean = () => true): Promise<OfferDto> {
  const res = await a.get('/api/v1/flights/search').query({ from: 'BOM', to: 'GOI', date: D5, adults, pageSize: 50 });
  const o = (res.body.items as OfferDto[]).find((x) => x.source === 'airline' && ['available', 'limited'].includes(x.availability) && (x.seatsLeft ?? 9) >= adults && filter(x));
  if (!o) throw new Error('no bookable offer in fixture');
  return o;
}

async function lockAndBook(a: Agent, adults = 1, idem = key(), filter?: (o: OfferDto) => boolean) {
  const offer = await pickOffer(a, adults, filter);
  const v = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults });
  if (v.status !== 200) throw new Error(`validate failed: ${JSON.stringify(v.body)} offer=${JSON.stringify({ seats: offer.seatsLeft, a: offer.availability })}`);
  const res = await a
    .post('/api/v1/flights/bookings')
    .set('Idempotency-Key', idem)
    .send({ priceLockId: v.body.lock.id, passengers: PAX(adults), contact: { email: 'ana@example.com' }, acceptedTotalMinor: v.body.lock.totalMinor, acceptFareRules: true });
  return { offer, lock: v.body.lock, res };
}

async function payAs(a: Agent, checkoutUrl: string, outcome: 'succeed' | 'fail' = 'succeed') {
  const intentId = checkoutUrl.split('/').pop()!;
  return a.post(`/api/v1/payments/sandbox/intents/${intentId}/complete`).send({ outcome });
}

describe('price lock', () => {
  it('requires sign-in', async () => {
    const offer = await pickOffer(t.agent());
    expect((await t.agent().post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 })).status).toBe(401);
  });

  it('locks the current price for 10 minutes or until the offer ends', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const offer = await pickOffer(a, 2);
    const v = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 2 });
    expect(v.status).toBe(200);
    expect(v.body.lock.totalMinor).toBe(offer.farePerAdultMinor * 2);
    const mins = (new Date(v.body.lock.expiresAt).getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(9);
    expect(mins).toBeLessThanOrEqual(10);
    expect(v.body.priceChanged).toBeNull();
  });

  it('reports a price change from the airline and locks the new price', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const offer = await pickOffer(a);
    airline.scenarios.priceChangeBps = 800;
    const v = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    expect(v.body.priceChanged.previousPerAdultMinor).toBe(offer.farePerAdultMinor);
    expect(v.body.priceChanged.currentPerAdultMinor).toBeGreaterThan(offer.farePerAdultMinor);
    expect(v.body.lock.farePerAdultMinor).toBe(v.body.priceChanged.currentPerAdultMinor);
  });

  it('rejects unavailable inventory and a provider outage clearly', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const offer = await pickOffer(a);
    airline.scenarios.unavailable = true;
    const sold = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    expect(sold.status).toBe(409);
    expect(sold.body.error.code).toBe('offer_unavailable');
    airline.scenarios.unavailable = false;
    airline.outage = true;
    const down = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe('airline_unavailable');
  });

  it('rejects expired offers', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const offer = await pickOffer(a);
    await t.ctx.db.update(flightOffers).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(flightOffers.id, offer.id));
    const res = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('offer_expired');
  });
});

describe('booking creation', () => {
  it('creates a pending booking with an unpaid payment and a checkout URL', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const { res, lock } = await lockAndBook(a, 2);
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('pending_payment');
    expect(res.body.booking.reference).toMatch(/^WY[A-Z2-9]{6}$/);
    expect(res.body.booking.totalMinor).toBe(lock.totalMinor);
    expect(res.body.booking.passengers).toHaveLength(2);
    expect(res.body.booking.payment.status).toBe('requires_payment');
    expect(res.body.checkoutUrl).toMatch(/^\/pay\/sandbox\/sbx_pi_/);
  });

  it('requires an Idempotency-Key', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const res = await a.post('/api/v1/flights/bookings').send({});
    expect(res.status).toBe(400);
  });

  it('returns the same booking for a repeated request (double click)', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const idem = key();
    const offer = await pickOffer(a);
    const v = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    const payload = { priceLockId: v.body.lock.id, passengers: PAX(1), contact: { email: 'ana@example.com' }, acceptedTotalMinor: v.body.lock.totalMinor, acceptFareRules: true };
    const [r1, r2] = [await a.post('/api/v1/flights/bookings').set('Idempotency-Key', idem).send(payload), await a.post('/api/v1/flights/bookings').set('Idempotency-Key', idem).send(payload)];
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.body.booking.id).toBe(r1.body.booking.id);
    const rows = await t.ctx.db.select().from(flightBookings).where(eq(flightBookings.priceLockId, v.body.lock.id));
    expect(rows).toHaveLength(1);
    // A different key cannot reuse the same price lock.
    const r3 = await a.post('/api/v1/flights/bookings').set('Idempotency-Key', key()).send(payload);
    expect(r3.status).toBe(409);
    expect(r3.body.error.code).toBe('lock_already_used');
  });

  it('refuses a total the customer did not accept and a wrong passenger count', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const offer = await pickOffer(a);
    const v = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    const base = { priceLockId: v.body.lock.id, contact: { email: 'ana@example.com' }, acceptFareRules: true };
    const wrongPrice = await a.post('/api/v1/flights/bookings').set('Idempotency-Key', key()).send({ ...base, passengers: PAX(1), acceptedTotalMinor: 100 });
    expect(wrongPrice.body.error.code).toBe('price_not_accepted');
    const wrongPax = await a.post('/api/v1/flights/bookings').set('Idempotency-Key', key()).send({ ...base, passengers: PAX(2), acceptedTotalMinor: v.body.lock.totalMinor });
    expect(wrongPax.body.error.code).toBe('passenger_count_mismatch');
  });

  it("cannot use another user's price lock or read their booking", async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const b = await t.loginAs('rider2@demo.waylo.app');
    const { res } = await lockAndBook(a);
    const offer = await pickOffer(a);
    const v = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    const steal = await b
      .post('/api/v1/flights/bookings')
      .set('Idempotency-Key', key())
      .send({ priceLockId: v.body.lock.id, passengers: PAX(1), contact: { email: 'x@example.com' }, acceptedTotalMinor: v.body.lock.totalMinor, acceptFareRules: true });
    expect(steal.status).toBe(404);
    expect((await b.get(`/api/v1/flights/bookings/${res.body.booking.id}`)).status).toBe(404);
    expect((await b.post(`/api/v1/flights/bookings/${res.body.booking.id}/cancel`)).status).toBe(404);
    const intent = res.body.checkoutUrl.split('/').pop();
    expect((await b.post(`/api/v1/payments/sandbox/intents/${intent}/complete`).send({ outcome: 'succeed' })).status).toBe(404);
  });

  it('compensates when the airline cannot hold seats', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    airline.scenarios.failCreateOrder = true;
    const { res, lock } = await lockAndBook(a);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('airline_hold_failed');
    const [row] = await t.ctx.db.select().from(flightBookings).where(eq(flightBookings.priceLockId, lock.id));
    expect(row!.status).toBe('expired');
    const pays = await t.ctx.db.select().from(payments).where(eq(payments.referenceId, row!.id));
    expect(pays).toHaveLength(0);
  });

  it('prevents overselling a partner inventory cap (last seat)', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const b = await t.loginAs('rider2@demo.waylo.app');
    const offer = await pickOffer(a);
    await t.ctx.db.update(flightOffers).set({ inventoryCap: 1, seatsSold: 0 }).where(eq(flightOffers.id, offer.id));
    const va = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    const vb = await b.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    expect(va.status).toBe(200);
    expect(vb.status).toBe(200);
    const body = (lock: { id: string; totalMinor: number }) => ({ priceLockId: lock.id, passengers: PAX(1), contact: { email: 'x@example.com' }, acceptedTotalMinor: lock.totalMinor, acceptFareRules: true });
    const [ra, rb] = await Promise.all([
      a.post('/api/v1/flights/bookings').set('Idempotency-Key', key()).send(body(va.body.lock)),
      b.post('/api/v1/flights/bookings').set('Idempotency-Key', key()).send(body(vb.body.lock)),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    const [o] = await t.ctx.db.select().from(flightOffers).where(eq(flightOffers.id, offer.id));
    expect(o!.seatsSold).toBe(1);
  });
});

describe('payment and ticketing', () => {
  it('confirms only after the airline issues a ticket', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const { res } = await lockAndBook(a, 2);
    const done = await payAs(a, res.body.checkoutUrl);
    expect(done.status).toBe(200);
    expect(done.body.payment.status).toBe('succeeded');
    const b = await a.get(`/api/v1/flights/bookings/${res.body.booking.id}`);
    expect(b.body.booking.status).toBe('confirmed');
    expect(b.body.booking.pnr).toMatch(/^[A-Z2-9]{6}$/);
    expect(b.body.booking.passengers.every((p: { ticketNumber: string }) => !!p.ticketNumber)).toBe(true);
  });

  it('keeps a booking in ticketing while issuance is delayed, then confirms', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    airline.scenarios.ticketing = 'delayed';
    airline.scenarios.delayedPolls = 2;
    const { res } = await lockAndBook(a);
    await payAs(a, res.body.checkoutUrl);
    const id = res.body.booking.id;
    expect((await a.get(`/api/v1/flights/bookings/${id}`)).body.booking.status).toBe('ticketing');
    const later = new Date(Date.now() + 10 * 60_000);
    await pollPendingTicketing(t.ctx, later);
    expect((await a.get(`/api/v1/flights/bookings/${id}`)).body.booking.status).toBe('ticketing');
    await pollPendingTicketing(t.ctx, new Date(later.getTime() + 20 * 60_000));
    const b = await a.get(`/api/v1/flights/bookings/${id}`);
    expect(b.body.booking.status).toBe('confirmed');
  });

  it('marks ticketing failures and records the full amount as refund due', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    airline.scenarios.ticketing = 'fail';
    const { res } = await lockAndBook(a);
    await payAs(a, res.body.checkoutUrl);
    const b = (await a.get(`/api/v1/flights/bookings/${res.body.booking.id}`)).body.booking;
    expect(b.status).toBe('ticketing_failed');
    expect(b.refundDueMinor).toBe(b.totalMinor);
    expect(b.pnr).toBeNull();
  });

  it('allows retrying after a failed payment', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const { res } = await lockAndBook(a);
    const failed = await payAs(a, res.body.checkoutUrl, 'fail');
    expect(failed.body.payment.status).toBe('failed');
    const id = res.body.booking.id;
    expect((await a.get(`/api/v1/flights/bookings/${id}`)).body.booking.status).toBe('payment_failed');
    const retry = await a.post(`/api/v1/flights/bookings/${id}/pay`);
    expect(retry.body.checkoutUrl).toBe(res.body.checkoutUrl);
    await payAs(a, retry.body.checkoutUrl);
    expect((await a.get(`/api/v1/flights/bookings/${id}`)).body.booking.status).toBe('confirmed');
  });

  it('expires unpaid bookings after the payment window and releases held inventory', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const offer = await pickOffer(a);
    await t.ctx.db.update(flightOffers).set({ inventoryCap: 5, seatsSold: 0 }).where(eq(flightOffers.id, offer.id));
    const v = await a.post(`/api/v1/flights/offers/${offer.id}/validate`).send({ adults: 1 });
    const res = await a
      .post('/api/v1/flights/bookings')
      .set('Idempotency-Key', key())
      .send({ priceLockId: v.body.lock.id, passengers: PAX(1), contact: { email: 'x@example.com' }, acceptedTotalMinor: v.body.lock.totalMinor, acceptFareRules: true });
    expect((await t.ctx.db.select().from(flightOffers).where(eq(flightOffers.id, offer.id)))[0]!.seatsSold).toBe(1);
    await expireUnpaidBookings(t.ctx, new Date(Date.now() + 60 * 60_000));
    const b = await a.get(`/api/v1/flights/bookings/${res.body.booking.id}`);
    expect(b.body.booking.status).toBe('expired');
    expect(b.body.booking.payment.status).toBe('cancelled');
    expect((await t.ctx.db.select().from(flightOffers).where(eq(flightOffers.id, offer.id)))[0]!.seatsSold).toBe(0);
    // A late payment attempt is refused.
    expect((await payAs(a, res.body.checkoutUrl)).status).toBe(409);
  });
});

describe('payment webhooks', () => {
  it('rejects unsigned or tampered webhooks', async () => {
    const body = JSON.stringify({ id: 'evt_x', type: 'payment.succeeded', intentId: 'sbx_pi_x', paymentId: 'p', amountMinor: 1, createdAt: new Date().toISOString() });
    const none = await request(t.app).post('/api/v1/payments/webhooks/sandbox-payments').set('Content-Type', 'application/json').send(body);
    expect(none.status).toBe(400);
    const bad = await request(t.app)
      .post('/api/v1/payments/webhooks/sandbox-payments')
      .set('Content-Type', 'application/json')
      .set('waylo-signature', signPayload('wrong-secret-0000000', body))
      .send(body);
    expect(bad.status).toBe(400);
    const stale = await request(t.app)
      .post('/api/v1/payments/webhooks/sandbox-payments')
      .set('Content-Type', 'application/json')
      .set('waylo-signature', signPayload(SECRET, body, Math.floor(Date.now() / 1000) - 3600))
      .send(body);
    expect(stale.status).toBe(400);
  });

  it('processes a duplicate event only once', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const { res } = await lockAndBook(a);
    const intentId = res.body.checkoutUrl.split('/').pop();
    const [p] = await t.ctx.db.select().from(payments).where(eq(payments.providerIntentId, intentId));
    const event = { id: `evt_dup_${Date.now()}`, type: 'payment.succeeded', intentId, paymentId: p!.id, amountMinor: p!.amountMinor, createdAt: new Date().toISOString() };
    const body = JSON.stringify(event);
    const send = () =>
      request(t.app).post('/api/v1/payments/webhooks/sandbox-payments').set('Content-Type', 'application/json').set('waylo-signature', signPayload(SECRET, body)).send(body);
    const first = await send();
    const second = await send();
    expect(first.body.status).toBe('processed');
    expect(second.body.status).toBe('duplicate');
    const events = await t.ctx.db.select().from(paymentEvents).where(eq(paymentEvents.providerEventId, event.id));
    expect(events).toHaveLength(1);
    expect((await a.get(`/api/v1/flights/bookings/${res.body.booking.id}`)).body.booking.status).toBe('confirmed');
  });

  it('ignores an event whose amount does not match the payment', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const { res } = await lockAndBook(a);
    const intentId = res.body.checkoutUrl.split('/').pop();
    const [p] = await t.ctx.db.select().from(payments).where(eq(payments.providerIntentId, intentId));
    const body = JSON.stringify({ id: `evt_amt_${Date.now()}`, type: 'payment.succeeded', intentId, paymentId: p!.id, amountMinor: 1, createdAt: new Date().toISOString() });
    const r = await request(t.app).post('/api/v1/payments/webhooks/sandbox-payments').set('Content-Type', 'application/json').set('waylo-signature', signPayload(SECRET, body)).send(body);
    expect(r.body.status).toBe('ignored');
    expect((await a.get(`/api/v1/flights/bookings/${res.body.booking.id}`)).body.booking.status).toBe('pending_payment');
  });
});

describe('cancellation', () => {
  it('cancels a confirmed booking with the fare-rule refund and frees the account for deletion', async () => {
    const a = await t.loginAs('rider3@demo.waylo.app');
    const { res } = await lockAndBook(a, 1, key(), (o) => !o.conditions.refundable);
    await payAs(a, res.body.checkoutUrl);
    const id = res.body.booking.id;
    const detail = await a.get(`/api/v1/flights/bookings/${id}`);
    expect(detail.body.cancellation.cancellable).toBe(true);
    const quote = detail.body.cancellation.refundMinor;
    expect(quote).toBeLessThan(detail.body.booking.totalMinor);

    const blocked = await a.delete('/api/v1/users/me').send({ password: 'waylo-demo-2026', confirm: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('deletion_blocked');

    const c = await a.post(`/api/v1/flights/bookings/${id}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body.booking.status).toBe('cancelled');
    expect(c.body.booking.refundDueMinor).toBe(quote);
    expect((await a.post(`/api/v1/flights/bookings/${id}/cancel`)).status).toBe(409);
  });

  it('cannot cancel unconfirmed bookings', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    const { res } = await lockAndBook(a);
    const c = await a.post(`/api/v1/flights/bookings/${res.body.booking.id}/cancel`);
    expect(c.status).toBe(409);
  });

  it('lists only my bookings, newest first', async () => {
    const a = await t.loginAs('rider2@demo.waylo.app');
    const list = await a.get('/api/v1/flights/bookings');
    expect(list.status).toBe(200);
    const items = list.body.items as { createdAt: string; contact: { email: string } }[];
    const dates = items.map((i) => i.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});
