import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchOption, MatchesResponse, RideGroup, RideRequest } from '@/lib/rides';
import { mockApi, renderRoutes } from '@/test/render';
import { GroupPanel, groupTimeline } from './GroupPanel';
import { MatchesPanel } from './MatchesPanel';

afterEach(() => vi.unstubAllGlobals());

const price = (total: number) => ({ fareShareMinor: total - 6_000, platformFeeMinor: 4_900, taxMinor: 1_100, totalMinor: total });
const fare = { baseMinor: 15_000, distanceMinor: 50_400, timeMinor: 10_500, extraStopsMinor: 5_000, airportAccessMinor: 15_000, tollsMinor: 0, totalMinor: 95_900 };
const option = (over: Partial<MatchOption> = {}): MatchOption => ({
  splitMethod: 'equal_per_seat',
  vehicleClass: 'sedan',
  capacity: { seats: 4, luggageUnits: 6 },
  seatsUsed: 2,
  luggageUsed: 3,
  plannedPickupAt: '2026-10-20T09:00:00Z',
  route: [
    { order: 1, area: 'Churchgate', isMe: false },
    { order: 2, area: 'You', isMe: true },
  ],
  routeDistanceMeters: 28_000,
  routeDurationSeconds: 4_200,
  members: [{ firstName: 'Riya', area: 'Churchgate', seats: 1, avatarUrl: null }],
  you: { waitMinutes: 5, detourMinutes: 6, rideMinutes: 70, dropoffAt: '2026-10-20T10:10:00Z', dropoffOrder: 2, price: price(56_000), solo: price(105_000), savingsPercent: 46 },
  vehicleFare: fare,
  score: 0.71,
  ...over,
});
const POLICY = { beforeLock: 'Free to leave until the group locks.', afterLock: 'After lock 25%.', waiting: 'Driver waits 15 minutes.', priceGuarantee: 'You never pay more than the price you agree to.' };
const matches = (over: Partial<MatchesResponse> = {}): MatchesResponse => ({
  requestId: 'r1',
  groups: [{ ...option(), groupId: 'g1', lockAt: '2026-10-20T08:15:00Z' }],
  newGroup: option({ members: [], seatsUsed: 1, route: [{ order: 1, area: 'You', isMe: true }], you: { ...option().you, price: price(105_000), savingsPercent: 0, waitMinutes: 0, detourMinutes: 0 } }),
  newGroupBlockedBy: null,
  compatibleOpenRequests: 2,
  policy: POLICY,
  ...over,
});
const req = { id: 'r1', status: 'open' } as RideRequest;

describe('Matches panel', () => {
  it('shows savings vs riding alone, capacity and route, and joins with the displayed price as consent', async () => {
    const { calls } = mockApi({
      'GET /rides/requests/r1/matches': () => ({ body: matches() }),
      'POST /rides/groups/g1/join': () => ({ body: { group: {} } }),
      'GET /rides/requests/r1': () => ({ body: { request: req } }),
      'GET /rides/requests': () => ({ body: { items: [] } }),
    });
    renderRoutes([{ path: '/', element: <MatchesPanel request={req} /> }]);
    const card = await screen.findByRole('article', { name: 'Group of 2' });
    expect(within(card).getByText('Save 46%')).toBeInTheDocument();
    expect(within(card).getByText('₹560')).toBeInTheDocument();
    expect(within(card).getByRole('meter', { name: 'Seats' })).toHaveAttribute('aria-valuenow', '2');
    expect(within(card).getByRole('list', { name: 'Drop-off order' })).toHaveTextContent('Churchgate');
    expect(screen.getByText('2 more heading your way')).toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: /Price breakdown/ }));
    expect(within(card).getByText('Whole vehicle')).toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: 'Join for ₹560' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/at most ₹560/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Join group' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ requestId: 'r1', acceptedMaxTotalMinor: 56_000 }));
  });

  it('starts a group with the solo opt-in', async () => {
    const { calls } = mockApi({
      'GET /rides/requests/r1/matches': () => ({ body: matches({ groups: [] }) }),
      'POST /rides/groups': () => ({ status: 201, body: { group: {} } }),
      'GET /rides/requests/r1': () => ({ body: { request: req } }),
      'GET /rides/requests': () => ({ body: { items: [] } }),
    });
    renderRoutes([{ path: '/', element: <MatchesPanel request={req} /> }]);
    expect(await screen.findByText('No groups to join yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start a group' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start group' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ requestId: 'r1', soloOk: true, acceptedMaxTotalMinor: 105_000 }));
  });

  it('keeps the dialog open and refreshes when the group filled up', async () => {
    let n = 0;
    mockApi({
      'GET /rides/requests/r1/matches': () => {
        n++;
        return { body: matches() };
      },
      'POST /rides/groups/g1/join': () => ({ status: 409, body: { error: { code: 'group_full', message: 'This group just filled up.' } } }),
    });
    renderRoutes([{ path: '/', element: <MatchesPanel request={req} /> }]);
    await userEvent.click(await screen.findByRole('button', { name: 'Join for ₹560' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Join group' }));
    expect(await within(dialog).findByText('This group just filled up.')).toBeInTheDocument();
    expect(n).toBeGreaterThan(1);
  });
});

const group = (over: Partial<RideGroup> = {}): RideGroup => ({
  id: 'g1',
  status: 'locked',
  airport: 'BOM',
  pickupZone: { id: 'z', terminal: 'T2', name: 'T2 Arrivals', instructions: 'Follow signs for app cabs.' },
  vehicleClass: 'sedan',
  capacity: { seats: 4, luggageUnits: 6 },
  seatsTaken: 2,
  luggageTaken: 3,
  splitMethod: 'equal_per_seat',
  plannedPickupAt: '2026-10-20T09:00:00Z',
  lockAt: '2026-10-20T08:15:00Z',
  lockedAt: '2026-10-20T08:15:00Z',
  route: { distanceMeters: 28_000, durationSeconds: 4_200 },
  vehicleFare: fare,
  members: [
    { isMe: false, firstName: 'Riya', avatarUrl: null, area: 'Churchgate', seats: 1, dropoffOrder: 1, estimatedDropoffAt: '2026-10-20T09:55:00Z' },
    { isMe: true, firstName: 'Ananya', avatarUrl: null, area: 'Colaba', seats: 1, dropoffOrder: 2, estimatedDropoffAt: '2026-10-20T10:10:00Z' },
  ],
  me: {
    participantId: 'p1',
    requestId: 'r1',
    status: 'confirmed',
    seats: 1,
    waitMinutes: 5,
    detourMinutes: 6,
    estimatedDropoffAt: '2026-10-20T10:10:00Z',
    price: price(56_000),
    maxTotalMinor: 60_000,
    finalTotalMinor: 56_000,
    soloTotalMinor: 105_000,
    soloOk: false,
    cancellationFeeMinor: null,
    leaveFeeNowMinor: 14_000,
  },
  policy: POLICY,
  cancelReason: null,
  ...over,
});

describe('Group panel', () => {
  it('shows members by first name, the final price and the late-cancellation fee before leaving', async () => {
    mockApi({ 'GET /rides/groups/g1': () => ({ body: { group: group() } }) });
    renderRoutes([{ path: '/', element: <GroupPanel groupId="g1" requestId="r1" /> }]);
    expect(await screen.findByText('Riya')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Final price')).toBeInTheDocument();
    expect(screen.getByText(/Agreed maximum ₹600/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Leave group/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cancellation fee of ₹140/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Leave and pay ₹140' })).toBeInTheDocument();
  });

  it('builds the status timeline', () => {
    const steps = groupTimeline(group({ status: 'assigned' }));
    expect(steps.find((s) => s.label === 'Group confirmed')?.state).toBe('done');
    expect(steps.find((s) => s.label === 'Driver assigned')?.state).toBe('current');
    expect(groupTimeline(group({ status: 'cancelled', cancelReason: 'No other riders joined.' })).at(-1)).toMatchObject({ state: 'failed' });
  });
});
