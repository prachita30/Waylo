import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Booking } from '@/lib/bookings';
import { ME, mockApi, renderRoutes } from '@/test/render';
import SandboxCheckout from '../pay/SandboxCheckout';
import FlightBookingDetail, { timelineFor } from '../trips/FlightBookingDetail';
import Book from './Book';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const offer = {
  id: 'o1',
  airline: { code: 'S1', name: 'Saffron Air', color: '#E8743B', sandbox: true },
  flightNumber: 'S1807',
  origin: 'BOM',
  destination: 'GOI',
  departAt: '2026-10-20T11:10:00Z',
  arriveAt: '2026-10-20T12:14:00Z',
  durationMinutes: 64,
  cabin: 'economy',
  currency: 'INR',
  farePerAdultMinor: 120_000,
  taxesPerAdultMinor: 50_000,
  totalMinor: 240_000,
  saving: null,
  baggage: { cabinKg: 7, checkedKg: 15 },
  conditions: { refundable: false, changeFeeMinor: 300_000, cancelFeeMinor: null, rules: 'Non-refundable. Taxes refundable on cancellation.' },
  eligibility: {},
  seatsLeft: 4,
  availability: 'limited',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  source: 'airline',
  sandbox: true,
  flightStatus: 'scheduled',
  originAirport: { code: 'BOM', name: 'CSMIA', city: 'Mumbai', timezone: 'Asia/Kolkata' },
  destinationAirport: { code: 'GOI', name: 'Dabolim', city: 'Goa', timezone: 'Asia/Kolkata' },
};
const lock = (fare = 120_000) => ({
  id: '11111111-1111-1111-1111-111111111111',
  adults: 2,
  farePerAdultMinor: fare,
  taxesPerAdultMinor: 50_000,
  totalMinor: fare * 2,
  currency: 'INR',
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
});

describe('Book page', () => {
  it('requires accepting a changed price, prefills contact, and submits with an idempotency key', async () => {
    const headers: (string | null)[] = [];
    const { calls, fetchMock } = mockApi({
      'GET /users/me': () => ({ body: { ...ME, user: { ...ME.user, phone: '+919800000001' } } }),
      'POST /flights/offers/o1/validate': () => ({ body: { lock: lock(129_600), priceChanged: { previousPerAdultMinor: 120_000, currentPerAdultMinor: 129_600 }, offer } }),
      'POST /flights/bookings': () => ({ status: 201, body: { booking: { id: 'b1' }, checkoutUrl: '/pay/sandbox/sbx_pi_abc' } }),
    });
    const { router } = renderRoutes(
      [
        { path: '/flights/offers/:offerId/book', element: <Book /> },
        { path: '/pay/sandbox/:intentId', element: <p>checkout</p> },
      ],
      '/flights/offers/o1/book?adults=2',
    );
    expect(await screen.findByText('The airline updated this fare')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /Continue to payment/ });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Accept new price' }));
    expect(submit).toBeEnabled();

    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveValue('ana@example.com'));
    const firsts = screen.getAllByLabelText('First and middle names');
    expect(firsts[0]).toHaveValue('Ananya');
    await userEvent.type(firsts[1]!, 'Kabir');
    await userEvent.type(screen.getAllByLabelText('Last name')[1]!, 'Shah');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(submit);

    await waitFor(() => expect(router.state.location.pathname).toBe('/pay/sandbox/sbx_pi_abc'));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/flights/bookings')!;
    expect(post.body).toMatchObject({ priceLockId: lock().id, acceptedTotalMinor: 259_200, passengers: [{ firstName: 'Ananya', lastName: 'Rao' }, { firstName: 'Kabir', lastName: 'Shah' }] });
    const init = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/flights/bookings') && i?.method === 'POST')![1]!;
    headers.push((init.headers as Record<string, string>)['Idempotency-Key'] ?? null);
    expect(headers[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('explains an unavailable fare', async () => {
    mockApi({
      'GET /users/me': () => ({ body: ME }),
      'POST /flights/offers/o1/validate': () => ({ status: 409, body: { error: { code: 'offer_unavailable', message: 'This fare has sold out.' } } }),
    });
    renderRoutes([{ path: '/flights/offers/:offerId/book', element: <Book /> }], '/flights/offers/o1/book?adults=1');
    expect(await screen.findByText('This fare is no longer available')).toBeInTheDocument();
    expect(screen.getByText('This fare has sold out.')).toBeInTheDocument();
  });
});

describe('Sandbox checkout', () => {
  it('labels the sandbox and completes payment through the API', async () => {
    const { calls } = mockApi({
      'GET /payments/sandbox/intents/sbx_pi_abc': () => ({ body: { payment: { id: 'p1', purpose: 'flight_booking', referenceId: 'b1', amountMinor: 259_200, currency: 'INR', status: 'requires_payment', failureReason: null, returnPath: '/trips/flights/b1' } } }),
      'POST /payments/sandbox/intents/sbx_pi_abc/complete': () => ({ body: { payment: { id: 'p1', purpose: 'flight_booking', referenceId: 'b1', status: 'succeeded', returnPath: '/trips/flights/b1' } } }),
    });
    const { router } = renderRoutes(
      [
        { path: '/pay/sandbox/:intentId', element: <SandboxCheckout /> },
        { path: '/trips/flights/:id', element: <p>booking</p> },
      ],
      '/pay/sandbox/sbx_pi_abc',
    );
    expect(await screen.findByText('Simulated payment')).toBeInTheDocument();
    expect(screen.getByText('₹2,592')).toBeInTheDocument();
    expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Simulate successful payment/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/trips/flights/b1'));
    expect(calls.find((c) => c.path.endsWith('/complete'))?.body).toEqual({ outcome: 'succeed' });
  });
});

const booking = (over: Partial<Booking> = {}): Booking => ({
  id: 'b1',
  reference: 'WYABC234',
  status: 'confirmed',
  adults: 1,
  totalMinor: 170_000,
  currency: 'INR',
  contact: { email: 'ana@example.com', phone: null },
  itinerary: offer as unknown as Booking['itinerary'],
  passengers: [{ firstName: 'Ananya', lastName: 'Rao', ticketNumber: '99912345670' }],
  pnr: 'K7XQ2P',
  ticketedAt: '2026-10-13T10:00:00Z',
  paymentDueAt: new Date(Date.now() + 600_000).toISOString(),
  failureReason: null,
  cancelledAt: null,
  refundDueMinor: null,
  payment: { id: 'p1', status: 'succeeded', amountMinor: 170_000, refundedMinor: 0, failureReason: null, checkoutUrl: '/pay/sandbox/sbx_pi_abc' },
  refunds: [],
  createdAt: '2026-10-13T09:58:00Z',
  ...over,
});

describe('Booking detail', () => {
  it('shows the PNR, tickets and a cancellation quote for confirmed bookings', async () => {
    mockApi({ 'GET /flights/bookings/b1': () => ({ body: { booking: booking(), cancellation: { cancellable: true, refundMinor: 50_000, refundable: false } } }) });
    renderRoutes([{ path: '/trips/flights/:bookingId', element: <FlightBookingDetail /> }], '/trips/flights/b1');
    expect(await screen.findByText('K7XQ2P')).toBeInTheDocument();
    expect(screen.getByText(/99912345670/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByText(/you will be refunded ₹500 of ₹1,700/)).toBeInTheDocument();
  });

  it('shows refund progress on a cancelled booking', async () => {
    mockApi({
      'GET /flights/bookings/b1': () => ({
        body: {
          booking: booking({ status: 'cancelled', cancelledAt: '2026-10-14T10:00:00Z', refundDueMinor: 50_000, refunds: [{ id: 'r1', amountMinor: 50_000, reason: 'flight_cancellation', status: 'succeeded', failureReason: null, createdAt: '2026-10-14T10:00:00Z', processedAt: '2026-10-14T10:05:00Z' }] }),
          cancellation: { cancellable: false, reason: 'Only confirmed bookings can be cancelled.' },
        },
      }),
    });
    renderRoutes([{ path: '/trips/flights/:bookingId', element: <FlightBookingDetail /> }], '/trips/flights/b1');
    expect(await screen.findByText(/Booking cancelled ·/)).toBeInTheDocument();
    expect(screen.getByText('Refunded')).toBeInTheDocument();
  });

  it('never presents a ticketing booking as confirmed', async () => {
    mockApi({ 'GET /flights/bookings/b1': () => ({ body: { booking: booking({ status: 'ticketing', pnr: null, ticketedAt: null, passengers: [{ firstName: 'A', lastName: 'R', ticketNumber: null }] }), cancellation: { cancellable: false, reason: 'x' } } }) });
    renderRoutes([{ path: '/trips/flights/:bookingId', element: <FlightBookingDetail /> }], '/trips/flights/b1');
    expect(await screen.findByText('Waiting for the airline to issue your ticket')).toBeInTheDocument();
    expect(screen.queryByText('Airline booking reference (PNR)')).not.toBeInTheDocument();
    expect(screen.getByText('Ticket pending')).toBeInTheDocument();
  });

  it('builds the timeline for failure paths', () => {
    expect(timelineFor(booking({ status: 'ticketing_failed', pnr: null, ticketedAt: null })).at(-1)).toMatchObject({ label: 'Ticket not issued', state: 'failed' });
    expect(timelineFor(booking({ status: 'expired', payment: null, pnr: null, ticketedAt: null })).at(-1)).toMatchObject({ state: 'failed' });
    expect(timelineFor(booking({ status: 'payment_failed', pnr: null, ticketedAt: null }))[1]).toMatchObject({ label: 'Payment declined' });
  });
});
