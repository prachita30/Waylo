import * as Tabs from '@radix-ui/react-tabs';
import { formatMoney } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Accessibility, Briefcase, ChevronRight, Clock, MapPin, Route, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/layout/PortalLayout';
import { AirportChip } from '@/components/brand/Route';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Field';
import { EmptyState, ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { type Membership, type Trip, type TripSummary, useFleet, useMembership, useOperatorTrips } from '@/lib/operator';
import { km, mins, VEHICLE_LABEL } from '@/lib/rides';

export default function OperatorTrips() {
  const { data: m } = useMembership();
  const manager = m?.role !== 'driver';
  const approved = m?.operator.status === 'approved';
  return (
    <>
      <PageHeader title={manager ? 'Trips' : 'My trips'} description={manager ? 'Accept shared airport trips and follow them through to drop-off.' : 'Trips assigned to you.'} />
      {!approved ? (
        <EmptyState title="Trips appear after verification" body="Once WAYLO approves your account, available airport trips show up here." />
      ) : (
        <Tabs.Root defaultValue={manager ? 'offers' : 'active'}>
          <Tabs.List className="mb-5 inline-flex gap-1 rounded-full bg-surface-2 p-1" aria-label="Trip lists">
            {(manager ? (['offers', 'active', 'history'] as const) : (['active', 'history'] as const)).map((t) => (
              <Tabs.Trigger key={t} value={t} className="rounded-full px-4 py-2 text-sm font-semibold text-ink-2 capitalize data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-card">
                {t === 'offers' ? 'Available' : t}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {manager && (
            <Tabs.Content value="offers">
              <Offers m={m!} />
            </Tabs.Content>
          )}
          <Tabs.Content value="active">
            <TripList tab="active" />
          </Tabs.Content>
          <Tabs.Content value="history">
            <TripList tab="history" />
          </Tabs.Content>
        </Tabs.Root>
      )}
    </>
  );
}

function TripFacts({ t }: { t: TripSummary }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      <li className="flex items-center gap-1">
        <Clock className="size-3.5" aria-hidden /> Pickup {formatDateTime(t.plannedPickupAt)}
      </li>
      <li className="flex items-center gap-1">
        <MapPin className="size-3.5" aria-hidden /> {t.pickupZone.name}
      </li>
      <li className="flex items-center gap-1">
        <Users className="size-3.5" aria-hidden /> {t.seatsTaken} seats · {t.parties} drop-off{t.parties > 1 ? 's' : ''}
      </li>
      <li className="flex items-center gap-1">
        <Briefcase className="size-3.5" aria-hidden /> {t.luggageTaken} bag units
      </li>
      <li className="flex items-center gap-1">
        <Route className="size-3.5" aria-hidden /> {km(t.routeDistanceMeters)} · {mins(t.routeDurationSeconds)}
      </li>
    </ul>
  );
}

function Offers({ m }: { m: Membership }) {
  const q = useOperatorTrips('offers');
  const [accepting, setAccepting] = useState<TripSummary | null>(null);
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState title="No trips waiting" body={`Confirmed groups at ${m.operator.airports.join(', ')} that your fleet can carry will appear here.`} />;
  return (
    <div className="space-y-3">
      {q.data.map((t) => (
        <article key={t.groupId} className="rounded-card border border-line bg-surface p-4 shadow-card sm:p-5" aria-label={`Trip from ${t.airport} at ${formatDateTime(t.plannedPickupAt)}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <AirportChip code={t.airport} />
              <Badge tone="lavender">{VEHICLE_LABEL[t.vehicleClass]} or larger</Badge>
              {t.wheelchairAccessibleRequired && (
                <Badge tone="coral">
                  <Accessibility className="size-3" aria-hidden /> Accessible vehicle
                </Badge>
              )}
            </div>
            <div className="text-right">
              <p className="t-price text-xl">{formatMoney(t.estimatedEarningMinor)}</p>
              <p className="text-xs text-ink-3">your earning · fare {formatMoney(t.vehicleFareMinor)}</p>
            </div>
          </div>
          <TripFacts t={t} />
          <div className="mt-4 flex justify-end">
            <Button onClick={() => setAccepting(t)}>Accept trip</Button>
          </div>
        </article>
      ))}
      {accepting && <AcceptDialog trip={accepting} onClose={() => setAccepting(null)} />}
    </div>
  );
}

function AcceptDialog({ trip, onClose }: { trip: TripSummary; onClose: () => void }) {
  const qc = useQueryClient();
  const fleet = useFleet();
  const drivers = fleet.data?.drivers.filter((d) => d.status === 'approved') ?? [];
  const vehicles = fleet.data?.vehicles.filter((v) => v.status === 'approved' && v.seats >= trip.seatsTaken && v.luggageUnits >= trip.luggageTaken && (!trip.wheelchairAccessibleRequired || v.wheelchairAccessible)) ?? [];
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const accept = useMutation({
    mutationFn: () => api.post(`/operator/trips/${trip.groupId}/accept`, { driverId, vehicleId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['operator-trips'] });
      onClose();
    },
    onError: () => qc.invalidateQueries({ queryKey: ['operator-trips', 'offers'] }),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Assign a driver and vehicle"
      description={`Pickup ${formatDateTime(trip.plannedPickupAt)} · ${trip.seatsTaken} seats, ${trip.luggageTaken} bag units`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!driverId || !vehicleId} loading={accept.isPending} onClick={() => accept.mutate()}>
            Accept trip
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="Driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Choose a driver</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </Select>
        <Select label="Vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} hint="Only approved vehicles that fit this group are listed.">
          <option value="">Choose a vehicle</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.makeModel} · {v.registration} ({VEHICLE_LABEL[v.vehicleClass]})
            </option>
          ))}
        </Select>
        {accept.isError && <Notice tone="danger">{accept.error instanceof ApiError ? accept.error.message : 'Could not accept this trip.'}</Notice>}
      </div>
    </Dialog>
  );
}

function TripList({ tab }: { tab: 'active' | 'history' }) {
  const q = useOperatorTrips(tab);
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState title={tab === 'active' ? 'No active trips' : 'No past trips yet'} />;
  return (
    <div className="space-y-3">
      {(q.data as Trip[]).map((t) => (
        <Link key={t.groupId} to={`/operator/trips/${t.groupId}`} className="block rounded-card border border-line bg-surface p-4 shadow-card transition hover:border-ink-3/40 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AirportChip code={t.airport} />
              <StatusBadge status={t.status} />
              {t.location?.offRoute && <Badge tone="danger">Off route</Badge>}
            </div>
            <span className="flex items-center gap-1 text-sm font-semibold text-ink-2">
              {t.driver.name} · {t.vehicle.registration} <ChevronRight className="size-4" aria-hidden />
            </span>
          </div>
          <TripFacts t={t} />
        </Link>
      ))}
    </div>
  );
}
