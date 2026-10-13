import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fleet, Membership, Trip, TripSummary } from '@/lib/operator';
import { mockApi, renderRoutes } from '@/test/render';
import FleetPage from './Fleet';
import { OperatorGate } from './OperatorShell';
import TripConsole from './TripConsole';
import OperatorTrips from './Trips';

afterEach(() => vi.unstubAllGlobals());

const membership = (over: Partial<Membership> = {}): Membership => ({
  role: 'owner',
  driverId: null,
  operator: { id: 'op1', name: 'Demo Fleet', phone: '+919800000010', airports: ['BOM'], status: 'approved', statusReason: null, commissionBps: 1500, isDemo: true },
  ...over,
});
const fleet: Fleet = {
  vehicles: [
    { id: 'v1', vehicleClass: 'sedan', makeModel: 'Dzire', colour: 'White', registration: 'MH 01 DM 1001', seats: 4, luggageUnits: 6, wheelchairAccessible: false, status: 'approved' },
    { id: 'v2', vehicleClass: 'sedan', makeModel: 'Aura', colour: 'Red', registration: 'MH 01 DM 1002', seats: 4, luggageUnits: 6, wheelchairAccessible: false, status: 'pending' },
  ],
  drivers: [{ id: 'd1', fullName: 'Demo Driver', phone: '+919800000011', licenceLast4: 'D001', status: 'approved', userId: 'u1' }],
  documents: [],
  availability: [],
};
const summary: TripSummary = {
  groupId: 'g1',
  status: 'locked',
  airport: 'BOM',
  pickupZone: { name: 'T2 Arrivals', terminal: 'T2', instructions: 'Follow signs.', lat: 19.0988, lng: 72.8742 },
  plannedPickupAt: '2026-10-20T09:30:00Z',
  vehicleClass: 'sedan',
  seatsTaken: 2,
  luggageTaken: 3,
  parties: 2,
  routeDistanceMeters: 30_000,
  routeDurationSeconds: 4_500,
  vehicleFareMinor: 110_000,
  estimatedEarningMinor: 93_500,
};
const trip = (over: Partial<Trip> = {}): Trip => ({
  ...summary,
  status: 'arrived',
  driver: { id: 'd1', name: 'Demo Driver' },
  vehicle: { id: 'v1', makeModel: 'Dzire', colour: 'White', registration: 'MH 01 DM 1001', vehicleClass: 'sedan' },
  timestamps: { assignedAt: '2026-10-20T08:00:00Z', enRouteAt: '2026-10-20T09:00:00Z', arrivedAt: '2026-10-20T09:25:00Z', startedAt: null, completedAt: null },
  location: null,
  earningMinor: null,
  commissionMinor: null,
  riders: [
    { participantId: 'p1', firstName: 'Riya', status: 'confirmed', seats: 1, luggage: { cabin: 1, medium: 0, large: 0 }, wheelchair: false, notes: 'Child seat please', readiness: 'at_pickup', flightNumber: 'S1807', expectedArrivalAt: '2026-10-20T09:00:00Z', dropoffOrder: 1, dropoff: { area: 'Churchgate', label: 'Churchgate, Mumbai', lat: 18.93, lng: 72.82 }, boardedAt: null, droppedOffAt: null },
  ],
  ...over,
});

describe('Operator trips', () => {
  it('lists available trips with earnings and accepts with an approved driver and fitting vehicle', async () => {
    const { calls } = mockApi({
      'GET /operator/me': () => ({ body: { membership: membership() } }),
      'GET /operator/trips': (_b, url) => ({ body: { items: url.searchParams.get('tab') === 'offers' ? [summary] : [] } }),
      'GET /operator/fleet': () => ({ body: fleet }),
      'POST /operator/trips/g1/accept': () => ({ body: { trip: trip({ status: 'assigned' }) } }),
    });
    renderRoutes([{ path: '/', element: <OperatorTrips /> }]);
    const card = await screen.findByRole('article');
    expect(within(card).getByText('₹935')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Accept trip' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: /MH 01 DM 1001/ })).toBeInTheDocument());
    expect(within(dialog).queryByRole('option', { name: /MH 01 DM 1002/ })).not.toBeInTheDocument(); // pending vehicle
    await userEvent.selectOptions(within(dialog).getByLabelText('Driver'), 'd1');
    await userEvent.selectOptions(within(dialog).getByLabelText('Vehicle'), 'v1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept trip' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ driverId: 'd1', vehicleId: 'v1' }));
  });

  it('explains that trips appear after verification', async () => {
    mockApi({ 'GET /operator/me': () => ({ body: { membership: membership({ operator: { ...membership().operator, status: 'pending' } }) } }) });
    renderRoutes([{ path: '/', element: <OperatorTrips /> }]);
    expect(await screen.findByText('Trips appear after verification')).toBeInTheDocument();
  });

  it('shows onboarding when the operator account has no company yet', async () => {
    mockApi({ 'GET /operator/me': () => ({ body: { membership: null } }), 'GET /airports': () => ({ body: { items: [] } }) });
    renderRoutes([{ path: '/', element: <OperatorGate>{() => <p>page</p>}</OperatorGate> }]);
    expect(await screen.findByRole('heading', { name: 'Set up your fleet' })).toBeInTheDocument();
  });
});

describe('Trip console', () => {
  it('lets the driver board riders and shows notes, readiness and flight', async () => {
    const { calls } = mockApi({
      'GET /operator/me': () => ({ body: { membership: membership({ role: 'driver', driverId: 'd1' }) } }),
      'GET /meta': () => ({ body: { demo: true, adapters: [], brand: {}, mode: 'demo', demoLogin: null } }),
      'GET /operator/trips/g1': () => ({ body: { trip: trip() } }),
      'POST /operator/trips/g1/riders/p1': () => ({ body: { trip: trip({ riders: [{ ...trip().riders[0]!, boardedAt: '2026-10-20T09:30:00Z' }] }) } }),
    });
    renderRoutes([{ path: '/operator/trips/:groupId', element: <TripConsole /> }], '/operator/trips/g1');
    expect(await screen.findByText(/Child seat please/)).toBeInTheDocument();
    expect(screen.getByText(/S1807/)).toBeInTheDocument();
    expect(screen.getByText(/At the pickup point/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start trip/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Boarded' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ action: 'boarded' }));
    expect(await screen.findByText('Boarded')).toBeInTheDocument();
    // Map text alternative lists pickup and stops.
    expect(within(screen.getByRole('figure')).getAllByText(/Churchgate/).length).toBeGreaterThan(0);
  });

  it('surfaces the grace-period refusal for an early no-show', async () => {
    mockApi({
      'GET /operator/me': () => ({ body: { membership: membership() } }),
      'GET /meta': () => ({ body: { demo: false, adapters: [], brand: {}, mode: 'demo', demoLogin: null } }),
      'GET /operator/trips/g1': () => ({ body: { trip: trip() } }),
      'POST /operator/trips/g1/riders/p1': () => ({ status: 409, body: { error: { code: 'grace_period', message: 'Please wait until the grace period ends.' } } }),
    });
    renderRoutes([{ path: '/operator/trips/:groupId', element: <TripConsole /> }], '/operator/trips/g1');
    await userEvent.click(await screen.findByRole('button', { name: 'No-show' }));
    expect(await screen.findByText('Please wait until the grace period ends.')).toBeInTheDocument();
  });
});

describe('Fleet', () => {
  it('validates a new vehicle before submitting', async () => {
    const { calls } = mockApi({ 'GET /operator/fleet': () => ({ body: fleet }) });
    renderRoutes([{ path: '/', element: <FleetPage /> }]);
    expect((await screen.findAllByText('MH 01 DM 1001')).length).toBeGreaterThan(0); // table + mobile card list
    await userEvent.click(screen.getByRole('button', { name: /Vehicle/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Registration'), 'not a plate');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit for review' }));
    expect(await within(dialog).findByText(/Use a registration like/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});
