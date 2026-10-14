import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderRoutes } from '@/test/render';
import Analytics from './Analytics';

afterEach(() => vi.unstubAllGlobals());

const summary = {
  range: { from: '2026-09-15', to: '2026-10-14', timeZone: 'Asia/Kolkata' },
  flights: {
    searches: 120,
    searchesWithResults: 110,
    priceLocks: 30,
    bookingsStarted: 20,
    bookingsPaid: 15,
    bookingsTicketed: 14,
    seatsTicketed: 22,
    grossBookingValueMinor: 6_543_200,
    cancelledAfterTicketing: 1,
    ticketingFailed: 1,
    partnerShare: 0.25,
    conversion: { searchToLock: 0.25, lockToBooking: 0.667, bookingToPaid: 0.75 },
    savings: { bookingsWithSourcedSaving: 9, totalMinor: 1_250_000, averagePercent: 31.4 },
  },
  rides: { requests: 40, matched: 28, noMatch: 6, expired: 2, cancelled: 4, matchRate: 0.778, completedTrips: 12, averageSeatFill: 0.854, averagePartiesPerTrip: 2.4, platformSubsidyMinor: 18_000, ridersCompleted: 29, riderRevenueMinor: 2_100_000, riderSavingsVsSoloMinor: 900_000, averageSavingVsSoloPercent: 30 },
  refunds: { succeeded: 2, amountMinor: 450_000, failed: 0 },
};
const days = Array.from({ length: 30 }, (_, i) => ({ day: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, searches: i, bookingsTicketed: i % 3, grossBookingValueMinor: (i % 3) * 400_000, rideRequests: 1, ridesCompleted: 0 }));

describe('admin analytics', () => {
  it('shows real-aggregate metrics, withheld route figures and CSV links for the chosen period', async () => {
    const { calls } = mockApi({
      'GET /admin/analytics/summary': () => ({ body: summary }),
      'GET /admin/analytics/daily': () => ({ body: { items: days } }),
      'GET /admin/analytics/routes': () => ({
        body: {
          minCohort: 5,
          items: [
            { origin: 'BOM', destination: 'GOI', searches: 100, searchesWithResults: 95, bookings: 12, grossBookingValueMinor: 5_000_000, savingsMinor: 900_000, suppressed: false },
            { origin: 'BOM', destination: 'DEL', searches: 20, searchesWithResults: 15, bookings: null, grossBookingValueMinor: null, savingsMinor: null, suppressed: true },
          ],
        },
      }),
      'GET /admin/analytics/partners': () => ({ body: { items: [] } }),
      'GET /admin/analytics/operators': () => ({ body: { items: [] } }),
    });
    renderRoutes([{ path: '/', element: <Analytics /> }]);
    expect(await screen.findByText('₹65,432')).toBeInTheDocument();
    expect(screen.getByText(/31.4% below the sourced regular fare, 9 bookings/)).toBeInTheDocument();
    expect(screen.getByText('77.8%')).toBeInTheDocument();
    expect(screen.getByText(/85.4% seats filled/)).toBeInTheDocument();
    expect(screen.getByText('1 bookings in this period could not be ticketed.')).toBeInTheDocument();
    expect((await screen.findAllByText('Fewer than 5')).length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /Booking value per day/ })).toBeInTheDocument();

    const csv = screen.getAllByRole('link', { name: 'CSV' }).map((l) => l.getAttribute('href'));
    expect(csv).toHaveLength(4);
    expect(csv[0]).toMatch(/^\/api\/v1\/admin\/analytics\/export\?report=daily&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);

    await userEvent.click(screen.getByRole('radio', { name: '7 days' }));
    await waitFor(() => {
      const q = calls.filter((c) => c.path === '/admin/analytics/summary');
      expect(q.length).toBeGreaterThan(1);
    });
  });
});
