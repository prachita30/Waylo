import { luggageUnits } from '@waylo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Accessibility, ArrowLeft, Backpack, Clock, MapPin, PlaneLanding, Route, Users } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AirportChip } from '@/components/brand/Route';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api, isApiError } from '@/lib/api';
import { formatDateTime, formatTime } from '@/lib/dates';
import { km, mins, type RideRequest, useRideRequest, VEHICLE_PREF_LABEL } from '@/lib/rides';

export default function RideRequestDetail() {
  const { requestId } = useParams();
  const q = useRideRequest(requestId);
  if (q.isPending) return <div className="container-page max-w-4xl py-10"><SkeletonList count={3} /></div>;
  if (q.isError) return <div className="container-page max-w-4xl py-10"><ErrorState title={isApiError(q.error, 'not_found') ? 'Ride request not found' : 'We could not load this request'} error={q.error} onRetry={() => q.refetch()} /></div>;
  return <RequestView r={q.data} />;
}

export function RequestView({ r, children }: { r: RideRequest; children?: ReactNode }) {
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="container-page max-w-4xl py-6 sm:py-10">
      <Link to="/trips" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> My trips
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="t-meta">Shared ride request</p>
          <h1 className="t-title mt-1 flex flex-wrap items-center gap-2">
            <AirportChip code={r.airport} /> to {r.destination.area}
          </h1>
          <p className="text-sm text-ink-3">Arriving {formatDateTime(r.expectedArrivalAt)}</p>
        </div>
        <StatusBadge status={r.status} />
      </div>

      {r.status === 'open' && (
        <Notice tone="info" title="Looking for riders" className="mb-6">
          We are grouping travellers arriving between {formatTime(r.expectedArrivalAt)} and {formatTime(new Date(new Date(r.expectedArrivalAt).getTime() + r.maxWaitMinutes * 60_000).toISOString())} who are heading your way.
        </Notice>
      )}
      {r.status === 'no_match' && (
        <Notice tone="warning" title="No compatible riders found" className="mb-6">
          We could not find a group within your limits. You were not charged. Try widening your waiting time or detour limit for your next trip.
        </Notice>
      )}
      {r.status === 'cancelled' && <Notice tone="info" title="Request cancelled" className="mb-6">You were not charged.</Notice>}

      {children}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardSection className="space-y-3 text-sm">
            <h2 className="font-semibold">Trip details</h2>
            <Detail icon={<PlaneLanding className="size-4" aria-hidden />} label="Arrival">
              {r.flightNumber ? `${r.flightNumber} · ` : ''}
              {formatDateTime(r.scheduledArrivalAt)}
              {r.flightLinked && <Badge tone="mint" className="ml-2">Flight tracked</Badge>}
            </Detail>
            <Detail icon={<MapPin className="size-4" aria-hidden />} label="Pickup">
              {r.pickupZone?.name}
            </Detail>
            <Detail icon={<Route className="size-4" aria-hidden />} label="Destination">
              {r.destination.label}
              <span className="block text-xs text-ink-3">
                Direct: about {km(r.direct.distanceMeters)}, {mins(r.direct.durationSeconds)} (estimate)
              </span>
            </Detail>
          </CardSection>
        </Card>
        <Card>
          <CardSection className="space-y-3 text-sm">
            <h2 className="font-semibold">Your preferences</h2>
            <Detail icon={<Users className="size-4" aria-hidden />} label="Travellers">
              {r.passengers}
            </Detail>
            <Detail icon={<Backpack className="size-4" aria-hidden />} label="Luggage">
              {r.luggage.cabin} cabin · {r.luggage.medium} medium · {r.luggage.large} large ({luggageUnits(r.luggage)} units)
            </Detail>
            <Detail icon={<Clock className="size-4" aria-hidden />} label="Limits">
              Wait up to {r.maxWaitMinutes} min · detour up to {r.maxDetourMinutes} min
            </Detail>
            <Detail icon={<Accessibility className="size-4" aria-hidden />} label="Vehicle">
              {VEHICLE_PREF_LABEL[r.vehiclePreference]}
              {r.wheelchair ? ' · wheelchair accessible' : ''}
            </Detail>
          </CardSection>
        </Card>
      </div>

      {r.status === 'open' && (
        <div className="mt-6">
          <Button variant="secondary" onClick={() => setCancelOpen(true)}>
            Cancel request
          </Button>
          <ConfirmDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            title="Cancel this ride request?"
            description="You have not joined a group yet, so there is no charge."
            confirmLabel="Cancel request"
            tone="danger"
            onConfirm={async () => {
              setErr(null);
              try {
                await api.post(`/rides/requests/${r.id}/cancel`);
              } catch (e) {
                setErr((e as Error).message);
                throw e;
              }
              await qc.invalidateQueries({ queryKey: ['ride-request', r.id] });
              await qc.invalidateQueries({ queryKey: ['ride-requests'] });
            }}
          >
            {err && <Notice tone="danger">{err}</Notice>}
          </ConfirmDialog>
        </div>
      )}
    </div>
  );
}

function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-ink-3">{icon}</span>
      <div>
        <p className="text-xs font-semibold text-ink-3">{label}</p>
        <div className="font-medium">{children}</div>
      </div>
    </div>
  );
}
