import * as Tabs from '@radix-ui/react-tabs';
import { formatMoney } from '@waylo/shared';
import { ChevronRight, Plane } from 'lucide-react';
import { Link } from 'react-router';
import { AirportChip } from '@/components/brand/Route';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { AirlineMark, useNow } from '@/components/travel/FlightCard';
import { type Booking, useBookings } from '@/lib/bookings';
import { formatDate, formatTime } from '@/lib/dates';
import { type RideRequest, useRideRequests } from '@/lib/rides';
import { RideRequestRow } from '../rides/Rides';

const UPCOMING = new Set(['pending_payment', 'payment_failed', 'ticketing', 'confirmed']);

function isUpcoming(b: Booking, now: number) {
  return UPCOMING.has(b.status) && new Date(b.itinerary.arriveAt).getTime() > now;
}

export default function Trips() {
  const now = useNow(60_000);
  const flights = useBookings();
  const rides = useRideRequests();
  const all = flights.data ?? [];
  const allRides = rides.data ?? [];
  const activeRide = (r: RideRequest) => (r.status === 'open' || r.status === 'matched') && new Date(r.expectedArrivalAt).getTime() + r.maxWaitMinutes * 60_000 > now;
  const upcomingRides = allRides.filter(activeRide);
  const pastRides = allRides.filter((r) => !activeRide(r));
  const upcoming = all.filter((b) => isUpcoming(b, now)).sort((a, b) => a.itinerary.departAt.localeCompare(b.itinerary.departAt));
  const past = all.filter((b) => !isUpcoming(b, now));

  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <h1 className="t-title">My trips</h1>
      <Tabs.Root defaultValue="upcoming" className="mt-6">
        <Tabs.List className="flex gap-1 rounded-full bg-surface-2 p-1" aria-label="Trips">
          {[
            ['upcoming', `Upcoming${upcoming.length + upcomingRides.length ? ` (${upcoming.length + upcomingRides.length})` : ''}`],
            ['past', 'Past & cancelled'],
          ].map(([v, l]) => (
            <Tabs.Trigger key={v} value={v!} className="flex-1 rounded-full px-4 py-2 text-sm font-semibold text-ink-2 data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-card">
              {l}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {flights.isPending ? (
          <SkeletonList className="mt-6" />
        ) : flights.isError ? (
          <ErrorState className="mt-6" error={flights.error} onRetry={() => flights.refetch()} />
        ) : (
          <>
            <Tabs.Content value="upcoming" className="mt-6 space-y-3">
              {upcomingRides.map((r) => (
                <RideRequestRow key={r.id} r={r} />
              ))}
              {upcoming.length === 0 && upcomingRides.length === 0 ? (
                <EmptyState
                  icon={<Plane className="size-6" aria-hidden />}
                  title="No upcoming trips"
                  body="Book a flight offer or a shared airport ride to see it here."
                  action={
                    <Button asChild>
                      <Link to="/flights">Find flight offers</Link>
                    </Button>
                  }
                />
              ) : (
                upcoming.map((b) => <TripRow key={b.id} b={b} />)
              )}
            </Tabs.Content>
            <Tabs.Content value="past" className="mt-6 space-y-3">
              {past.length + pastRides.length === 0 ? (
                <EmptyState title="Nothing here yet" body="Completed, cancelled and expired trips appear here." />
              ) : (
                <>
                  {pastRides.map((r) => (
                    <RideRequestRow key={r.id} r={r} />
                  ))}
                  {past.map((b) => (
                    <TripRow key={b.id} b={b} />
                  ))}
                </>
              )}
            </Tabs.Content>
          </>
        )}
      </Tabs.Root>
    </div>
  );
}

function TripRow({ b }: { b: Booking }) {
  const it = b.itinerary;
  const tz = it.originAirport?.timezone ?? 'Asia/Kolkata';
  return (
    <Link to={`/trips/flights/${b.id}`} className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card transition hover:border-ink-3/40">
      <AirlineMark airline={it.airline} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <AirportChip code={it.origin} />
          <span className="text-ink-3" aria-hidden>
            →
          </span>
          <AirportChip code={it.destination} />
          {it.sandbox && <Badge tone="coral">Sandbox</Badge>}
        </div>
        <p className="mt-1.5 truncate text-sm text-ink-2">
          {formatDate(it.departAt, tz)} · {formatTime(it.departAt, tz)} · {it.airline.name} {it.flightNumber} · {b.reference}
        </p>
      </div>
      <div className="hidden text-right sm:block">
        <StatusBadge status={b.status} />
        <p className="t-price mt-1 text-sm">{formatMoney(b.totalMinor)}</p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}
