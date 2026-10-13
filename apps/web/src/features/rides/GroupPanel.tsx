import { formatMoney } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, CarFront, LogOut, MapPin, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Checkbox } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { BookingTimeline, type TimelineStep } from '@/components/travel/BookingTimeline';
import { PriceBreakdown } from '@/components/travel/PriceBreakdown';
import { CapacityMeter, vehicleFareLines } from '@/components/travel/RideMatchCard';
import { api, ApiError } from '@/lib/api';
import { formatTime } from '@/lib/dates';
import { READINESS_LABEL, type Readiness, type RideGroup, useGroup, VEHICLE_LABEL } from '@/lib/rides';
import { RouteMap } from '@/components/travel/RouteMap';
import { Select } from '@/components/ui/Field';

const ORDER: RideGroup['status'][] = ['forming', 'locked', 'assigned', 'en_route', 'arrived', 'in_progress', 'completed'];

export function groupTimeline(g: RideGroup): TimelineStep[] {
  const idx = ORDER.indexOf(g.status);
  const step = (label: string, at: RideGroup['status'], detail?: string): TimelineStep => {
    const i = ORDER.indexOf(at);
    return { label, detail, state: g.status === 'cancelled' ? 'pending' : idx > i ? 'done' : idx === i ? (at === 'completed' ? 'done' : 'current') : 'pending' };
  };
  const steps = [
    step('Group forming', 'forming', g.status === 'forming' ? `Locks at ${formatTime(g.lockAt)}` : undefined),
    step('Group confirmed', 'locked'),
    step('Driver assigned', 'assigned'),
    step('Driver on the way', 'en_route'),
    step('Pickup', 'arrived', `Planned around ${formatTime(g.plannedPickupAt)}`),
    step('On the way', 'in_progress'),
    step('Completed', 'completed'),
  ];
  if (g.status === 'cancelled') steps.push({ label: 'Group cancelled', detail: g.cancelReason ?? undefined, state: 'failed' });
  return steps;
}

export function GroupPanel({ groupId, requestId }: { groupId: string; requestId: string }) {
  const qc = useQueryClient();
  const q = useGroup(groupId);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [cancelRequest, setCancelRequest] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const readiness = useMutation({
    mutationFn: (value: Readiness) => api.post<{ group: RideGroup }>(`/rides/groups/${groupId}/readiness`, { readiness: value }),
    onSuccess: (r) => qc.setQueryData(['ride-group', groupId], r.group),
  });
  const leave = useMutation({
    mutationFn: () => api.post<{ feeMinor: number; requestStatus: string }>(`/rides/groups/${groupId}/leave`, { cancelRequest }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['ride-request', requestId] });
      await qc.invalidateQueries({ queryKey: ['ride-requests'] });
      await qc.removeQueries({ queryKey: ['ride-group', groupId] });
    },
  });

  if (q.isPending) return <SkeletonList count={2} className="mb-6" />;
  if (q.isError) return <ErrorState className="mb-6" error={q.error} onRetry={() => q.refetch()} />;
  const g = q.data;
  const me = g.me;
  const active = me && ['joined', 'payment_due', 'confirmed'].includes(me.status);
  const fee = me?.leaveFeeNowMinor ?? 0;

  return (
    <section className="mb-8 grid gap-6 lg:grid-cols-[1fr_20rem]" aria-label="Your ride group">
      <div className="space-y-6">
        <Card>
          <CardSection>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <CarFront className="size-5 text-mint" aria-hidden /> Your group · {VEHICLE_LABEL[g.vehicleClass]}
              </h2>
              <StatusBadge status={g.status} />
            </div>
            <div className="mt-4 flex gap-4">
              <CapacityMeter label="Seats" used={g.seatsTaken} total={g.capacity.seats} icon={<Users className="size-3.5" aria-hidden />} />
              <CapacityMeter label="Luggage" used={g.luggageTaken} total={g.capacity.luggageUnits} icon={<Briefcase className="size-3.5" aria-hidden />} />
            </div>
            {g.map.pickup && (
              <RouteMap
                className="mt-5"
                caption="Route overview (schematic, drop-offs shown by area)"
                points={[
                  { ...g.map.pickup, label: `Pickup ${g.pickupZone?.terminal ?? ''}`.trim(), kind: 'pickup' as const },
                  ...[...g.map.stops].sort((a, b) => a.order - b.order).map((s) => ({ lat: s.lat, lng: s.lng, label: s.isMe ? `You · ${s.area}` : s.area, kind: s.isMe ? ('me' as const) : ('stop' as const) })),
                  ...(g.trip?.location ? [{ lat: g.trip.location.lat, lng: g.trip.location.lng, label: `${g.trip.driverFirstName} (${formatTime(g.trip.location.at)})`, kind: 'driver' as const }] : []),
                ]}
              />
            )}
            <ul className="mt-5 divide-y divide-line">
              {g.members.map((m) => (
                <li key={m.dropoffOrder + m.firstName} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex items-center gap-3">
                    <Avatar name={m.firstName} src={m.avatarUrl} size="sm" decorative />
                    <span>
                      <span className="block text-sm font-semibold">
                        {m.isMe ? 'You' : m.firstName}
                        {m.seats > 1 && <span className="font-normal text-ink-3"> +{m.seats - 1}</span>}
                      </span>
                      <span className="block text-xs text-ink-3">
                        Drop-off {m.dropoffOrder} · {m.area} · <span className={m.readiness === 'at_pickup' || m.readiness === 'ready' ? 'text-mint' : undefined}>{READINESS_LABEL[m.readiness]}</span>
                      </span>
                    </span>
                  </span>
                  <span className="text-xs text-ink-3">~{formatTime(m.estimatedDropoffAt)}</span>
                </li>
              ))}
            </ul>
            {g.pickupZone && (
              <div className="mt-4 rounded-2xl bg-sky p-4 text-sm">
                <p className="flex items-center gap-1.5 font-semibold">
                  <MapPin className="size-4" aria-hidden /> {g.pickupZone.name}
                </p>
                <p className="mt-1 text-ink-2">{g.pickupZone.instructions}</p>
                <p className="mt-2 text-xs text-ink-3">Planned pickup around {formatTime(g.plannedPickupAt)}. This is an estimate based on arrival times; it updates with flight status.</p>
              </div>
            )}
          </CardSection>
        </Card>
        {g.trip && (
          <Card>
            <CardSection className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Avatar name={g.trip.driverFirstName} size="md" decorative />
                <div>
                  <p className="font-semibold">{g.trip.driverFirstName} is your driver</p>
                  <p className="text-sm text-ink-2">
                    {g.trip.vehicle.colour} {g.trip.vehicle.makeModel}
                  </p>
                </div>
              </div>
              <span className="rounded-lg border-2 border-ink px-3 py-1 font-mono text-lg font-bold tracking-wider">{g.trip.vehicle.registration}</span>
              {g.trip.location && <p className="w-full text-xs text-ink-3">Last location shared at {formatTime(g.trip.location.at)}.</p>}
            </CardSection>
          </Card>
        )}
        {g.status === 'forming' && <Notice tone="info" title="More riders can still join">Your price only goes down from here. The group locks at {formatTime(g.lockAt)}.</Notice>}
        {g.status === 'cancelled' && <Notice tone="warning" title="This group was cancelled">{g.cancelReason}</Notice>}
      </div>

      <aside className="space-y-6">
        {me && (
          <Card>
            <CardSection className="space-y-3">
              <PriceBreakdown
                lines={[
                  { label: 'Your share of vehicle fare', amountMinor: me.price.fareShareMinor },
                  { label: 'WAYLO service fee', amountMinor: me.price.platformFeeMinor },
                  { label: 'Taxes', amountMinor: me.price.taxMinor },
                ]}
                totalLabel={me.finalTotalMinor !== null ? 'Final price' : 'Current price'}
                totalMinor={me.finalTotalMinor ?? me.price.totalMinor}
                note={`Agreed maximum ${formatMoney(me.maxTotalMinor)}. Riding alone would be ${formatMoney(me.soloTotalMinor)}.`}
              />
              <details className="text-xs text-ink-3">
                <summary className="cursor-pointer font-semibold text-ink-2">Whole-vehicle fare</summary>
                <PriceBreakdown className="mt-2" lines={vehicleFareLines(g.vehicleFare)} totalLabel="Vehicle total" totalMinor={g.vehicleFare.totalMinor} />
              </details>
              {me.soloOk && g.members.length === 1 && <Badge tone="lavender">Riding alone if nobody joins</Badge>}
              {active && ['forming', 'locked', 'assigned', 'en_route', 'arrived'].includes(g.status) && (
                <Select
                  label="Your status after landing"
                  hint="Shared with your co-riders and driver so pickup can be coordinated."
                  value={me.readiness}
                  onChange={(e) => readiness.mutate(e.target.value as Readiness)}
                  disabled={readiness.isPending}
                >
                  {(Object.keys(READINESS_LABEL) as Readiness[]).map((k) => (
                    <option key={k} value={k}>
                      {READINESS_LABEL[k]}
                    </option>
                  ))}
                </Select>
              )}
              {active && (
                <Button variant="secondary" block onClick={() => { setErr(null); setLeaveOpen(true); }}>
                  <LogOut className="size-4" aria-hidden /> Leave group
                </Button>
              )}
              {me.cancellationFeeMinor ? <p className="text-xs text-coral">Cancellation fee: {formatMoney(me.cancellationFeeMinor)}</p> : null}
            </CardSection>
          </Card>
        )}
        <Card>
          <CardSection>
            <h3 className="mb-4 font-semibold">Status</h3>
            <BookingTimeline steps={groupTimeline(g)} />
          </CardSection>
        </Card>
        <Button asChild variant="ghost" block size="sm">
          <Link to={`/report-incident?group=${g.id}`}>Report a safety issue</Link>
        </Button>
      </aside>

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Leave this group?"
        description={fee > 0 ? `A cancellation fee of ${formatMoney(fee)} applies because the group is confirmed.` : 'Leaving now is free. Other riders keep their agreed prices.'}
        confirmLabel={fee > 0 ? `Leave and pay ${formatMoney(fee)}` : 'Leave group'}
        tone="danger"
        onConfirm={async () => {
          setErr(null);
          try {
            await leave.mutateAsync();
          } catch (e) {
            setErr(e instanceof ApiError ? e.message : 'Something went wrong.');
            throw e;
          }
        }}
      >
        {g.status === 'forming' && <Checkbox checked={cancelRequest} onChange={(e) => setCancelRequest(e.target.checked)} label="Also cancel my ride request" description="Leave unticked to look for another group." />}
        {err && <Notice tone="danger" className="mt-3">{err}</Notice>}
      </ConfirmDialog>
    </section>
  );
}
