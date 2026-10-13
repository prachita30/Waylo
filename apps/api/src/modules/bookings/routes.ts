import { createBookingSchema, validateOfferSchema } from '@waylo/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { currentUser, requireAuth } from '../../http/auth';
import { badRequest, conflict } from '../../http/errors';
import { limiter } from '../../http/rateLimit';
import { body, params } from '../../http/validate';
import { checkoutUrlFor, latestPaymentFor } from '../payments/service';
import { cancelBooking, createBooking, listBookings, loadBooking, lockPrice, refundQuote, toBookingDto } from './service';

const idParam = z.object({ bookingId: z.string().uuid() });
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

export function bookingsRouter(ctx: AppContext): Router {
  const r = Router();
  const writeLimit = limiter({ windowMs: 60_000, limit: Math.max(20, Math.floor(ctx.config.API_RATE_LIMIT / 10)), name: 'booking-writes' });

  r.post('/flights/offers/:offerId/validate', requireAuth, writeLimit, async (req, res) => {
    const { offerId } = params(req, z.object({ offerId: z.string().uuid() }));
    const { adults } = body(req, validateOfferSchema);
    res.json(await lockPrice(ctx, currentUser(req), offerId, adults));
  });

  r.post('/flights/bookings', requireAuth, writeLimit, async (req, res) => {
    const key = req.get('idempotency-key');
    if (!key || !IDEMPOTENCY_KEY.test(key)) throw badRequest('An Idempotency-Key header (8–64 characters) is required.');
    const input = body(req, createBookingSchema);
    const { booking, replayed } = await createBooking(ctx, currentUser(req), input, key);
    const dto = await toBookingDto(ctx.db, booking);
    res.status(replayed ? 200 : 201).json({ booking: dto, checkoutUrl: dto.payment?.checkoutUrl ?? null });
  });

  r.get('/flights/bookings', requireAuth, async (req, res) => {
    res.json({ items: await listBookings(ctx, currentUser(req)) });
  });

  r.get('/flights/bookings/:bookingId', requireAuth, async (req, res) => {
    const { bookingId } = params(req, idParam);
    const b = await loadBooking(ctx.db, currentUser(req), bookingId);
    res.json({ booking: await toBookingDto(ctx.db, b), cancellation: refundQuote(b) });
  });

  /** Returns where to complete (or retry) payment while the payment window is open. */
  r.post('/flights/bookings/:bookingId/pay', requireAuth, async (req, res) => {
    const { bookingId } = params(req, idParam);
    const b = await loadBooking(ctx.db, currentUser(req), bookingId);
    if (!['pending_payment', 'payment_failed'].includes(b.status) || b.paymentDueAt <= new Date()) {
      throw conflict('not_payable', 'This booking can no longer be paid. Please search again.');
    }
    const payment = await latestPaymentFor(ctx.db, 'flight_booking', b.id);
    res.json({ checkoutUrl: payment ? checkoutUrlFor(payment) : null });
  });

  r.post('/flights/bookings/:bookingId/cancel', requireAuth, writeLimit, async (req, res) => {
    const { bookingId } = params(req, idParam);
    const updated = await cancelBooking(ctx, currentUser(req), bookingId);
    res.json({ booking: await toBookingDto(ctx.db, updated) });
  });

  return r;
}
