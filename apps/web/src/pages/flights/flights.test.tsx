import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Offer, SearchResult } from '@/lib/flights';
import { mockApi, renderRoutes } from '@/test/render';
import FlightResults from './FlightResults';
import OfferDetail from './OfferDetail';

afterEach(() => vi.unstubAllGlobals());

const AIRPORTS = {
  items: [
    { code: 'BOM', name: 'CSMIA', city: 'Mumbai', cityId: 'mumbai', state: 'MH', timezone: 'Asia/Kolkata', lat: 0, lng: 0 },
    { code: 'GOI', name: 'Dabolim', city: 'Goa', cityId: 'goa', state: 'GA', timezone: 'Asia/Kolkata', lat: 0, lng: 0 },
  ],
};

const offer = (over: Partial<Offer> = {}): Offer => ({
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
  farePerAdultMinor: 107_100,
  taxesPerAdultMinor: 50_000,
  totalMinor: 214_200,
  saving: { referenceFareMinor: 453_500, amountMinor: 346_400, percent: 76, source: 'Airline regular fare' },
  baggage: { cabinKg: 7, checkedKg: 0 },
  conditions: { refundable: false, changeFeeMinor: null, cancelFeeMinor: null, rules: 'Last-minute fare. Non-refundable.' },
  eligibility: {},
  seatsLeft: 3,
  availability: 'limited',
  expiresAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
  source: 'airline',
  sandbox: true,
  flightStatus: 'scheduled',
  ...over,
});

const result = (items: Offer[], over: Partial<SearchResult> = {}): SearchResult => ({
  query: { origin: { code: 'BOM', city: 'Mumbai' }, destination: { code: 'GOI', city: 'Goa' }, adults: 2, date: '2026-10-20' },
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
  priceRange: { minMinor: 100_000, maxMinor: 500_000 },
  flexibleDates: [
    { date: '2026-10-19', cheapestMinor: 320_000 },
    { date: '2026-10-20', cheapestMinor: 107_100 },
    { date: '2026-10-21', cheapestMinor: null },
  ],
  warnings: [],
  ...over,
});

const URL_ = '/flights?from=BOM&to=GOI&date=2026-10-20&adults=2&cabin=economy';

describe('Flight results', () => {
  it('lists offers with sandbox labels, verified savings, totals and seats left', async () => {
    mockApi({ 'GET /airports': () => ({ body: AIRPORTS }), 'GET /flights/search': () => ({ body: result([offer(), offer({ id: 'o2', saving: null, availability: 'sold_out', seatsLeft: 0 })]) }) });
    renderRoutes([{ path: '/flights', element: <FlightResults /> }], URL_);
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    const first = within(cards[0]!);
    expect(first.getByText('Sandbox')).toBeInTheDocument();
    expect(first.getByText('Save 76%')).toBeInTheDocument();
    expect(first.getByText('per adult · ₹2,142 total')).toBeInTheDocument();
    expect(first.getByText('3 seats left at this fare')).toBeInTheDocument();
    expect(first.getByRole('link', { name: 'Select' })).toHaveAttribute('href', '/flights/offers/o1?adults=2');
    // Sold-out offers have no booking action.
    expect(within(cards[1]!).queryByRole('link', { name: 'Select' })).not.toBeInTheDocument();
    expect(within(cards[1]!).getByText('Sold out')).toBeInTheDocument();
  });

  it('sends filters to the API and changes date from the flexible strip', async () => {
    const { calls } = mockApi({ 'GET /airports': () => ({ body: AIRPORTS }), 'GET /flights/search': () => ({ body: result([offer()]) }) });
    const { router } = renderRoutes([{ path: '/flights', element: <FlightResults /> }], URL_);
    await screen.findAllByRole('article');
    await userEvent.click(screen.getAllByRole('button', { name: '6am–12pm' })[0]!);
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('windows')).toBe('morning'));
    await userEvent.click(screen.getByRole('button', { name: /19 Oct/ }));
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('date')).toBe('2026-10-19'));
    const last = calls.filter((c) => c.path === '/flights/search').at(-1)!;
    expect(last).toBeTruthy();
  });

  it('shows an empty state and a degraded-airline notice', async () => {
    mockApi({ 'GET /airports': () => ({ body: AIRPORTS }), 'GET /flights/search': () => ({ body: result([], { warnings: ['airline_unavailable'] }) }) });
    renderRoutes([{ path: '/flights', element: <FlightResults /> }], URL_);
    expect(await screen.findByText('No offers match')).toBeInTheDocument();
    expect(screen.getByText('Some airline offers could not be loaded')).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    let fail = true;
    mockApi({
      'GET /airports': () => ({ body: AIRPORTS }),
      'GET /flights/search': () => (fail ? { status: 400, body: { error: { code: 'bad_request', message: 'Choose today or a future date.' } } } : { body: result([offer()]) }),
    });
    renderRoutes([{ path: '/flights', element: <FlightResults /> }], URL_);
    expect(await screen.findByText('Choose today or a future date.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findAllByRole('article')).toHaveLength(1);
  });

  it('prompts for a search when no route is given', async () => {
    mockApi({ 'GET /airports': () => ({ body: AIRPORTS }) });
    renderRoutes([{ path: '/flights', element: <FlightResults /> }], '/flights');
    expect(await screen.findByText('Where would you like to fly?')).toBeInTheDocument();
  });
});

describe('Offer detail', () => {
  const detail = {
    ...offer(),
    originAirport: { code: 'BOM', name: 'Chhatrapati Shivaji Maharaj International Airport', city: 'Mumbai', timezone: 'Asia/Kolkata' },
    destinationAirport: { code: 'GOI', name: 'Dabolim Airport', city: 'Goa', timezone: 'Asia/Kolkata' },
  };

  it('shows fare rules, the price breakdown, the saving source and the booking action', async () => {
    mockApi({ 'GET /flights/offers/o1': () => ({ body: { offer: detail } }) });
    renderRoutes([{ path: '/flights/offers/:offerId', element: <OfferDetail /> }], '/flights/offers/o1?adults=2');
    expect(await screen.findByRole('heading', { name: 'Mumbai to Goa' })).toBeInTheDocument();
    expect(screen.getByText('Last-minute fare. Non-refundable.')).toBeInTheDocument();
    expect(screen.getByText('Base fare × 2')).toBeInTheDocument();
    expect(screen.getByText(/Source: Airline regular fare/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to passenger details' })).toHaveAttribute('href', '/flights/offers/o1/book?adults=2');
    expect(screen.getByText(/no real ticket is issued/)).toBeInTheDocument();
  });

  it('blocks booking for parties larger than the remaining seats', async () => {
    mockApi({ 'GET /flights/offers/o1': () => ({ body: { offer: { ...detail, availability: 'insufficient', seatsLeft: 1 } } }) });
    renderRoutes([{ path: '/flights/offers/:offerId', element: <OfferDetail /> }], '/flights/offers/o1?adults=2');
    expect(await screen.findByText('Only 1 seat left')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Continue/ })).not.toBeInTheDocument();
  });

  it('explains when an offer no longer exists', async () => {
    mockApi({ 'GET /flights/offers/o1': () => ({ status: 404, body: { error: { code: 'not_found', message: 'Offer not found.' } } }) });
    renderRoutes([{ path: '/flights/offers/:offerId', element: <OfferDetail /> }], '/flights/offers/o1');
    expect(await screen.findByText('This offer is no longer available')).toBeInTheDocument();
  });
});
