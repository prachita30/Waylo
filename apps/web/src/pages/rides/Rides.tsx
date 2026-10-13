import { CarFront, ChevronRight, Luggage, ShieldCheck, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DestinationArt } from '@/components/brand/DestinationArt';
import { AirportChip } from '@/components/brand/Route';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { useMe } from '@/lib/auth';
import { formatDateTime } from '@/lib/dates';
import { type RideRequest, useRideRequests } from '@/lib/rides';

export default function Rides() {
  const { data: me } = useMe();
  return (
    <div className="container-page py-8 sm:py-12">
      <section className="grid items-center gap-8 overflow-hidden rounded-[2rem] bg-mint-soft p-6 sm:p-10 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="t-meta">Shared airport rides</p>
          <h1 className="t-display mt-3 max-w-xl text-4xl sm:text-5xl">Land, meet your group, split the cab.</h1>
          <p className="t-body mt-4 max-w-lg">Tell us when you land and where you are going. We group travellers on compatible routes and show everyone their share before anything is confirmed.</p>
          <Button asChild size="lg" variant="mint" className="mt-6">
            <Link to="/rides/new">
              <CarFront className="size-5" aria-hidden /> Request a shared ride
            </Link>
          </Button>
        </div>
        <div className="hidden aspect-[4/3] overflow-hidden rounded-3xl lg:block" aria-hidden>
          <DestinationArt scene="city" seed="rides-hero" />
        </div>
      </section>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Feature icon={<Luggage className="size-5" aria-hidden />} title="Luggage-aware">Groups are sized so everyone’s bags fit the vehicle.</Feature>
        <Feature icon={<Timer className="size-5" aria-hidden />} title="Your limits">You choose the longest wait and the extra travel time you accept.</Feature>
        <Feature icon={<ShieldCheck className="size-5" aria-hidden />} title="Approved operators">Only verified fleet operators and drivers can take shared trips.</Feature>
      </div>

      {me && <MyRequests />}
    </div>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-card bg-surface-2 p-5">
      <span className="grid size-10 place-items-center rounded-xl bg-surface text-mint shadow-card">{icon}</span>
      <h2 className="mt-3 font-semibold">{title}</h2>
      <p className="t-body mt-1 text-sm">{children}</p>
    </div>
  );
}

function MyRequests() {
  const q = useRideRequests();
  return (
    <section className="mt-12">
      <SectionHeader title="Your ride requests" />
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={<CarFront className="size-6" aria-hidden />} title="No ride requests yet" body="Request a shared ride for your next arrival." />
      ) : (
        <div className="space-y-3">
          {q.data.map((r) => (
            <RideRequestRow key={r.id} r={r} />
          ))}
        </div>
      )}
    </section>
  );
}

export function RideRequestRow({ r }: { r: RideRequest }) {
  return (
    <Link to={`/trips/rides/${r.id}`} className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card transition hover:border-ink-3/40">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mint-soft text-mint">
        <CarFront className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <AirportChip code={r.airport} />
          <span className="text-ink-3" aria-hidden>
            →
          </span>
          <span className="truncate font-semibold">{r.destination.area}</span>
        </div>
        <p className="mt-1 truncate text-sm text-ink-2">
          Arriving {formatDateTime(r.expectedArrivalAt)} · {r.passengers} traveller{r.passengers > 1 ? 's' : ''}
          {r.flightNumber ? ` · ${r.flightNumber}` : ''}
        </p>
      </div>
      <StatusBadge status={r.status} />
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}
