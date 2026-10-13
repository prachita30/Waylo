import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RideRequest } from '@/lib/rides';
import { mockApi, renderRoutes } from '@/test/render';
import RideRequestDetail from '../trips/RideRequestDetail';
import NewRide from './NewRide';

afterEach(() => vi.unstubAllGlobals());

const AREAS = {
  radiusKm: 60,
  items: [
    {
      code: 'BOM',
      name: 'CSMIA',
      city: 'Mumbai',
      timezone: 'Asia/Kolkata',
      lat: 19.09,
      lng: 72.87,
      zones: [
        { id: '6f1c2c1e-8b1a-4c1e-9a1e-1c1e8b1a4c11', terminal: 'T1', name: 'T1 Arrivals', instructions: 'Cross to lane opposite gate 8.' },
        { id: '6f1c2c1e-8b1a-4c1e-9a1e-1c1e8b1a4c22', terminal: 'T2', name: 'T2 Arrivals', instructions: 'Follow signs for app-based cabs.' },
      ],
    },
  ],
};
const PLACES = { items: [{ placeId: 'sbx:bandra-west', label: 'Bandra West, Mumbai', area: 'Bandra West', lat: 19.0596, lng: 72.8295 }] };

const POLICY = { beforeLock: 'Free to leave until the group locks.', afterLock: 'After lock 25%.', waiting: 'Driver waits 15 minutes.', priceGuarantee: 'You never pay more than the price you agree to.' };
const MATCHES = { requestId: 'r1', groups: [], newGroup: null, newGroupBlockedBy: null, compatibleOpenRequests: 0, policy: POLICY };

const request = (over: Partial<RideRequest> = {}): RideRequest => ({
  id: 'r1',
  status: 'open',
  groupId: null,
  airport: 'BOM',
  pickupZone: AREAS.items[0]!.zones[1]!,
  flightNumber: 'S1807',
  flightLinked: true,
  flight: { status: 'scheduled', scheduledArrivalAt: '2026-10-20T11:10:00Z', estimatedArrivalAt: '2026-10-20T11:10:00Z', delayMinutes: 0, updatedAt: null },
  closedReason: null,
  flightBookingId: null,
  scheduledArrivalAt: '2026-10-20T11:10:00Z',
  expectedArrivalAt: '2026-10-20T11:10:00Z',
  destination: PLACES.items[0]!,
  direct: { distanceMeters: 9_800, durationSeconds: 1_700 },
  passengers: 2,
  luggage: { cabin: 2, medium: 1, large: 0 },
  vehiclePreference: 'any',
  maxWaitMinutes: 20,
  maxDetourMinutes: 15,
  wheelchair: false,
  notes: null,
  cancelledAt: null,
  createdAt: '2026-10-13T10:00:00Z',
  ...over,
});

describe('New ride request', () => {
  it('validates required fields, then submits a complete request', async () => {
    const { calls } = mockApi({
      'GET /rides/service-areas': () => ({ body: AREAS }),
      'GET /places/search': () => ({ body: PLACES }),
      'POST /rides/requests': () => ({ status: 201, body: { request: request() } }),
    });
    const { router } = renderRoutes(
      [
        { path: '/rides/new', element: <NewRide /> },
        { path: '/trips/rides/:id', element: <p>detail</p> },
      ],
      '/rides/new?airport=BOM&date=2026-10-20&flight=S1807',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Find riders' }));
    expect(await screen.findByText('Enter your arrival date and time.')).toBeInTheDocument();
    expect(screen.getByText('Choose where you are going.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await userEvent.type(screen.getByLabelText('Scheduled arrival (local time)'), '16:40');
    await userEvent.click(screen.getByLabelText('T2'));
    const combo = screen.getByRole('combobox', { name: 'Going to' });
    await userEvent.type(combo, 'band');
    await screen.findByRole('option', { name: /Bandra West/ });
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('Bandra West, Mumbai')).toBeInTheDocument();
    expect(screen.getByText(/Co-riders only see the area/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Increase Travellers' }));
    await userEvent.click(screen.getByRole('button', { name: 'Find riders' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/trips/rides/r1'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({
      airport: 'BOM',
      pickupZoneId: AREAS.items[0]!.zones[1]!.id,
      flightNumber: 'S1807',
      arrivalAt: '2026-10-20T11:10:00.000Z',
      passengers: 2,
      destination: { area: 'Bandra West' },
    });
  });

  it('blocks submission when luggage cannot fit any shared vehicle', async () => {
    mockApi({ 'GET /rides/service-areas': () => ({ body: AREAS }) });
    renderRoutes([{ path: '/rides/new', element: <NewRide /> }], '/rides/new');
    const more = await screen.findByRole('button', { name: 'Increase Large suitcases' });
    for (let i = 0; i < 5; i++) await userEvent.click(more);
    expect(screen.getByText(/will not fit in a shared vehicle/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find riders' })).toBeDisabled();
  });

  it('explains wheelchair + sedan is not possible', async () => {
    mockApi({ 'GET /rides/service-areas': () => ({ body: AREAS }) });
    renderRoutes([{ path: '/rides/new', element: <NewRide /> }], '/rides/new');
    await userEvent.click(await screen.findByLabelText('Sedan'));
    await userEvent.click(screen.getByRole('checkbox', { name: /wheelchair/ }));
    expect(screen.getByText(/Wheelchair-accessible trips need a van/)).toBeInTheDocument();
  });
});

describe('Ride request detail', () => {
  it('shows matching window, preferences and lets the owner cancel', async () => {
    let status: RideRequest['status'] = 'open';
    const { calls } = mockApi({
      'GET /rides/requests/r1': () => ({ body: { request: request({ status }) } }),
      'GET /rides/requests/r1/matches': () => ({ body: MATCHES }),
      'POST /rides/requests/r1/cancel': () => {
        status = 'cancelled';
        return { body: { request: request({ status }) } };
      },
    });
    renderRoutes([{ path: '/trips/rides/:requestId', element: <RideRequestDetail /> }], '/trips/rides/r1');
    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent('Looking for riders');
    expect(screen.getByText(/Wait up to 20 min · detour up to 15 min/)).toBeInTheDocument();
    expect(screen.getByText('On time')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/rides/requests/r1/cancel')).toBe(true));
    expect(await screen.findByText('Request cancelled')).toBeInTheDocument();
  });

  it('explains a flight delay and a cancelled flight', async () => {
    mockApi({
      'GET /rides/requests/r1': () => ({ body: { request: request({ status: 'open', expectedArrivalAt: '2026-10-20T11:50:00Z', flight: { status: 'delayed', scheduledArrivalAt: '2026-10-20T11:10:00Z', estimatedArrivalAt: '2026-10-20T11:50:00Z', delayMinutes: 40, updatedAt: null } }) } }),
      'GET /rides/requests/r1/matches': () => ({ body: MATCHES }),
    });
    const v = renderRoutes([{ path: '/trips/rides/:requestId', element: <RideRequestDetail /> }], '/trips/rides/r1');
    expect(await screen.findByText('Flight delayed by 40 min')).toBeInTheDocument();
    expect(screen.getByText('Delayed 40 min')).toBeInTheDocument();
    v.unmount();
    mockApi({ 'GET /rides/requests/r1': () => ({ body: { request: request({ status: 'cancelled', closedReason: 'flight_cancelled' }) } }) });
    renderRoutes([{ path: '/trips/rides/:requestId', element: <RideRequestDetail /> }], '/trips/rides/r1');
    expect(await screen.findByText('Your flight was cancelled')).toBeInTheDocument();
  });

  it('explains when no match was found', async () => {
    mockApi({ 'GET /rides/requests/r1': () => ({ body: { request: request({ status: 'no_match' }) } }) });
    renderRoutes([{ path: '/trips/rides/:requestId', element: <RideRequestDetail /> }], '/trips/rides/r1');
    expect(await screen.findByText('No compatible riders found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
  });
});
