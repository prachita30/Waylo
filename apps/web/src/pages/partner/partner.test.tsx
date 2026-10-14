import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Partner, type PartnerOffer, rupeesToPaise } from '@/lib/partner';
import { mockApi, renderRoutes } from '@/test/render';
import NewOffer from './NewOffer';
import Offers from './Offers';
import { PartnerOutlet } from './PartnerShell';

afterEach(() => vi.unstubAllGlobals());

const partner = (over: Partial<Partner> = {}): Partner => ({
  id: 'p1',
  name: 'Saffron Air Demo Desk',
  kind: 'airline',
  phone: '+919800000020',
  requestedAirlines: [{ code: 'S1', name: 'Saffron Air' }],
  authorisedAirlines: ['S1'],
  status: 'approved',
  statusReason: null,
  isDemo: true,
  ...over,
});
const offer = (over: Partial<PartnerOffer> = {}): PartnerOffer => ({
  id: 'o1',
  status: 'published',
  flightNumber: 'S1412',
  airlineCode: 'S1',
  origin: 'BOM',
  destination: 'GOI',
  departAt: '2026-10-28T03:45:00Z',
  arriveAt: '2026-10-28T05:00:00Z',
  cabin: 'economy',
  fareMinor: 350_000,
  taxesMinor: 60_000,
  referenceFareMinor: 520_000,
  inventoryCap: 4,
  seatsSold: 1,
  seatsRemaining: 3,
  refundable: true,
  validFrom: '2026-10-13T00:00:00Z',
  validUntil: '2026-10-27T00:00:00Z',
  fareRules: 'Changes allowed for a fee up to 24 hours before departure.',
  ...over,
});

describe('rupeesToPaise', () => {
  it('converts typed rupee amounts exactly, without floating point error', () => {
    expect(rupeesToPaise('3,499.50')).toBe(349_950);
    expect(rupeesToPaise('₹ 1200')).toBe(120_000);
    expect(rupeesToPaise('0.07')).toBe(7);
    expect(rupeesToPaise('1.234')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
  });
});

describe('partner onboarding', () => {
  it('collects the airlines a new partner is authorised to sell', async () => {
    const { calls } = mockApi({ 'GET /partner/me': () => ({ body: { partner: null } }), 'POST /partner/onboarding': () => ({ status: 201, body: { partner: partner({ status: 'pending' }) } }) });
    renderRoutes([{ path: '/', element: <PartnerOutlet />, children: [{ index: true, element: <p>portal</p> }] }]);
    await userEvent.type(await screen.findByLabelText('Company name'), 'Konkan Jet Sales');
    await userEvent.type(screen.getByLabelText('Commercial contact phone'), '+919811112222');
    await userEvent.type(screen.getByLabelText('Airline 1 code'), 's3');
    await userEvent.type(screen.getByLabelText('Airline 1 name'), 'Konkan Jet');
    await userEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Konkan Jet Sales', kind: 'airline', phone: '+919811112222', airlines: [{ code: 'S3', name: 'Konkan Jet' }] }),
    );
  });
});

describe('new offer form', () => {
  const api = () =>
    mockApi({
      'GET /partner/me': () => ({ body: { partner: partner() } }),
      'GET /partner/routes': () => ({ body: { items: [{ id: 'r1', origin: 'BOM', destination: 'GOI', active: true }] } }),
      'POST /partner/offers': () => ({ status: 201, body: { offer: { id: 'o9' } } }),
    });
  const render = () =>
    renderRoutes(
      [
        { path: '/partner', element: <PartnerOutlet />, children: [{ path: 'offers/new', element: <NewOffer /> }, { path: 'offers', element: <p>offers list</p> }] },
      ],
      '/partner/offers/new',
    );
  const fillRequired = async () => {
    await userEvent.type(await screen.findByLabelText(/Flight number/), '412');
    await userEvent.selectOptions(screen.getByLabelText('Route'), 'BOM-GOI');
    await userEvent.type(screen.getByLabelText('Departure time'), '09:15');
    await userEvent.type(screen.getByLabelText('Arrival time'), '10:30');
    await userEvent.type(screen.getByLabelText('All-inclusive fare per adult (₹)'), '3,499.50');
    await userEvent.type(screen.getByLabelText('Of which taxes and fees (₹)'), '600');
    await userEvent.type(screen.getByLabelText('Fare rules shown to travellers'), 'Non-refundable. Name changes are not permitted on this fare.');
    await userEvent.type(screen.getByLabelText('Seats WAYLO may sell'), '6');
  };

  it('sends prices in paise and the sale window as UTC instants', async () => {
    const { calls } = api();
    const { router } = render();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Publish offer' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/partner/offers'));
    const sent = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ airlineCode: 'S1', flightDigits: '412', origin: 'BOM', destination: 'GOI', fareMinor: 349_950, taxesMinor: 60_000, inventoryCap: 6, refundable: false, cancelFeeMinor: null, publish: true });
    // Sale opens at 00:00 IST, i.e. 18:30 UTC the previous day.
    expect(String(sent.validFrom)).toMatch(/T18:30:00\.000Z$/);
  });

  it('requires a source before showing a saving, and can save a draft', async () => {
    const { calls } = api();
    render();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/Regular fare for comparison/), '5200');
    expect(screen.getByText(/Travellers will see a saving of/)).toHaveTextContent('32%');
    await userEvent.click(screen.getByRole('button', { name: 'Publish offer' }));
    expect(await screen.findByText('Say where the regular fare comes from.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await userEvent.type(screen.getByLabelText('Source of the regular fare'), 'Saffron Air website, same flight and cabin');
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ referenceFareMinor: 520_000, publish: false }));
  });

  it('shows server errors on the matching field', async () => {
    mockApi({
      'GET /partner/me': () => ({ body: { partner: partner() } }),
      'GET /partner/routes': () => ({ body: { items: [{ id: 'r1', origin: 'BOM', destination: 'GOI', active: true }] } }),
      'POST /partner/offers': () => ({ status: 400, body: { error: { code: 'validation_error', message: 'The offer must close before departure.', details: [{ path: 'validUntil', message: 'Must be before departure.' }] } } }),
    });
    render();
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Publish offer' }));
    expect(await screen.findByText('Must be before departure.')).toBeInTheDocument();
  });
});

describe('offers list', () => {
  it('pauses a live offer and confirms before withdrawing', async () => {
    const { calls } = mockApi({
      'GET /partner/me': () => ({ body: { partner: partner() } }),
      'GET /partner/offers': () => ({ body: { items: [offer(), offer({ id: 'o2', flightNumber: 'S1500', status: 'draft' })] } }),
      'POST /partner/offers/o1/status': (b) => ({ body: { offer: offer({ status: (b as { status: PartnerOffer['status'] }).status }) } }),
      'GET /partner/stats': () => ({ body: {} }),
    });
    renderRoutes([{ path: '/', element: <Offers /> }]);
    await userEvent.click(await screen.findAllByRole('button', { name: 'Pause S1412' }).then((b) => b[0]!));
    await waitFor(() => expect(calls.find((c) => c.path === '/partner/offers/o1/status')?.body).toEqual({ status: 'paused' }));

    await userEvent.click(screen.getAllByRole('button', { name: 'Withdraw S1412' })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Bookings already made on it are not affected/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw offer' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/partner/offers/o1/status').map((c) => c.body)).toContainEqual({ status: 'withdrawn' }));
  });

  it('hides sale actions until the partner is approved', async () => {
    mockApi({
      'GET /partner/me': () => ({ body: { partner: partner({ status: 'pending', authorisedAirlines: [] }) } }),
      'GET /partner/offers': () => ({ body: { items: [offer({ status: 'paused' })] } }),
    });
    renderRoutes([{ path: '/', element: <Offers /> }]);
    expect((await screen.findAllByText('S1412')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Publish S1412/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New offer/ })).not.toBeInTheDocument();
  });
});
