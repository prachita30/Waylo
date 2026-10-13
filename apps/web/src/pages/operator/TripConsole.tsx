import { formatMoney, luggageUnits } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Accessibility, ArrowLeft, Crosshair, LocateFixed, MapPin, Navigation, StickyNote } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { RouteMap, type MapPoint } from '@/components/travel/RouteMap';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatTime } from '@/lib/dates';
import { useMeta } from '@/lib/meta';
import { type Trip, useMembership, useTrip } from '@/lib/operator';
import { READINESS_LABEL } from '@/lib/rides';

const STEP: Record<string, { next: 'en_route' | 'arrived' | 'in_progress'; label: string } | undefined> = {
  assigned: { next: 'en_route', label: 'Start driving to pickup' },
  en_route: { next: 'arrived', label: 'I have arrived at pickup' },
  arrived: { next: 'in_progress', label: 'Start trip' },
};

/** Next point the driver is heading to, for the demo location simulator. */
function target(t: Trip) {
  if (t.status === 'en_route' || t.status === 'assigned') return t.pickupZone;
  const next = t.riders.filter((r) => r.boardedAt && !r.droppedOffAt).sort((a, b) => a.dropoffOrder - b.dropoffOrder)[0];
  return next?.dropoff ?? null;
}

export default function TripConsole() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useTrip(groupId);
  const { data: m } = useMembership();
  const { data: meta } = useMeta();
  const [err, setErr] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [reason, setReason] = useState('');
  const watchId = useRef<number | null>(null);

  const refresh = (trip?: Trip) => (trip ? qc.setQueryData(['operator-trip', groupId], trip) : qc.invalidateQueries({ queryKey: ['operator-trip', groupId] }));
  const onError = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Something went wrong.');
  const advance = useMutation({ mutationFn: (status: string) => api.post<{ trip: Trip }>(`/operator/trips/${groupId}/status`, { status }), onSuccess: (r) => refresh(r.trip), onError });
  const rider = useMutation({
    mutationFn: (v: { participantId: string; action: 'boarded' | 'no_show' | 'dropped_off' }) => api.post<{ trip: Trip }>(`/operator/trips/${groupId}/riders/${v.participantId}`, { action: v.action }),
    onSuccess: (r) => refresh(r.trip),
    onError,
  });
  const location = useMutation({
    mutationFn: (p: { lat: number; lng: number }) => api.post<{ offRoute: boolean }>(`/operator/trips/${groupId}/location`, p),
    onSuccess: () => refresh(),
    onError,
  });

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
  }, []);

  if (q.isPending) return <SkeletonList count={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;
  const step = STEP[t.status];
  const live = ['en_route', 'arrived', 'in_progress'].includes(t.status);
  const manager = m?.role !== 'driver';

  const shareLocation = () => {
    if (!navigator.geolocation) return setErr('Location is not available on this device.');
    setSharing(true);
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => location.mutate({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setSharing(false);
        setErr('Location permission was denied.');
      },
      { enableHighAccuracy: true, maximumAge: 15_000 },
    );
  };
  const simulate = () => {
    const to = target(t);
    if (!to) return;
    const from = t.location ?? { lat: to.lat + 0.08, lng: to.lng + 0.04 };
    location.mutate({ lat: from.lat + (to.lat - from.lat) * 0.5, lng: from.lng + (to.lng - from.lng) * 0.5 });
  };

  const points: MapPoint[] = [
    { lat: t.pickupZone.lat, lng: t.pickupZone.lng, label: `Pickup ${t.pickupZone.terminal}`, kind: 'pickup' },
    ...[...t.riders].sort((a, b) => a.dropoffOrder - b.dropoffOrder).map((r) => ({ lat: r.dropoff.lat, lng: r.dropoff.lng, label: `${r.dropoffOrder}. ${r.firstName} · ${r.dropoff.area}`, kind: 'stop' as const })),
    ...(t.location ? [{ lat: t.location.lat, lng: t.location.lng, label: `Driver (${formatTime(t.location.at)})`, kind: 'driver' as const }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/operator" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Trips
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="t-title">Pickup {formatDateTime(t.plannedPickupAt)}</h1>
          <p className="text-sm text-ink-3">
            {t.driver.name} · {t.vehicle.colour} {t.vehicle.makeModel} · {t.vehicle.registration}
          </p>
        </div>
        <div className="flex gap-2">
          {t.location?.offRoute && <Badge tone="danger">Off planned route</Badge>}
          <StatusBadge status={t.status} />
        </div>
      </div>

      {err && (
        <Notice tone="danger" className="mb-4">
          {err}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-6">
          {step && (
            <Button size="lg" block onClick={() => { setErr(null); advance.mutate(step.next); }} loading={advance.isPending}>
              <Navigation className="size-5" aria-hidden /> {step.label}
            </Button>
          )}
          {t.status === 'completed' && <Notice tone="success" title="Trip completed">Earning {formatMoney(t.earningMinor ?? 0)} after {formatMoney(t.commissionMinor ?? 0)} commission.</Notice>}

          <Card>
            <CardSection>
              <h2 className="font-semibold">Riders</h2>
              <ul className="mt-3 divide-y divide-line">
                {t.riders.map((r) => (
                  <li key={r.participantId} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">
                          {r.dropoffOrder}. {r.firstName}
                          {r.seats > 1 && <span className="font-normal text-ink-3"> +{r.seats - 1}</span>}
                          {r.wheelchair && <Accessibility className="ml-1 inline size-4 text-coral" aria-label="Wheelchair user" />}
                        </p>
                        <p className="text-xs text-ink-3">
                          {r.flightNumber ? `${r.flightNumber} · ` : ''}lands {formatTime(r.expectedArrivalAt)} · {READINESS_LABEL[r.readiness]} · {luggageUnits(r.luggage)} bag units
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-2">
                          <MapPin className="size-3.5" aria-hidden /> {r.dropoff.label}
                        </p>
                        {r.notes && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-2">
                            <StickyNote className="size-3.5" aria-hidden /> {r.notes}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {r.status === 'no_show' ? (
                          <Badge tone="danger">No-show</Badge>
                        ) : r.droppedOffAt ? (
                          <Badge tone="mint">Dropped off</Badge>
                        ) : t.status === 'arrived' && !r.boardedAt ? (
                          <>
                            <Button size="sm" onClick={() => rider.mutate({ participantId: r.participantId, action: 'boarded' })}>
                              Boarded
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => rider.mutate({ participantId: r.participantId, action: 'no_show' })}>
                              No-show
                            </Button>
                          </>
                        ) : t.status === 'in_progress' && r.boardedAt ? (
                          <Button size="sm" variant="mint" onClick={() => rider.mutate({ participantId: r.participantId, action: 'dropped_off' })}>
                            Dropped off
                          </Button>
                        ) : r.boardedAt ? (
                          <Badge tone="mint">Boarded</Badge>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardSection>
          </Card>

          <RouteMap points={points} caption="Pickup, drop-offs and your last shared position" />
        </div>

        <aside className="space-y-4">
          <Card>
            <CardSection className="space-y-3 text-sm">
              <h2 className="font-semibold">Pickup point</h2>
              <p className="font-medium">{t.pickupZone.name}</p>
              <p className="text-ink-2">{t.pickupZone.instructions}</p>
            </CardSection>
          </Card>
          {live && (
            <Card>
              <CardSection className="space-y-2">
                <h2 className="font-semibold">Location</h2>
                <p className="text-xs text-ink-3">Riders see your position while the trip is active.</p>
                <Button block variant="secondary" onClick={shareLocation} disabled={sharing}>
                  <LocateFixed className="size-4" aria-hidden /> {sharing ? 'Sharing location' : 'Share my location'}
                </Button>
                {meta?.demo && (
                  <Button block variant="ghost" size="sm" onClick={simulate} loading={location.isPending}>
                    <Crosshair className="size-4" aria-hidden /> Simulate movement (demo)
                  </Button>
                )}
              </CardSection>
            </Card>
          )}
          {manager && t.status === 'assigned' && (
            <Button block variant="ghost" onClick={() => setReleaseOpen(true)}>
              Release this trip
            </Button>
          )}
          <Button asChild block variant="ghost" size="sm">
            <Link to={`/operator/incidents?trip=${t.groupId}`}>Report an incident</Link>
          </Button>
        </aside>
      </div>

      <ConfirmDialog
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        title="Release this trip?"
        description="The riders stay confirmed and the trip is offered to other operators."
        confirmLabel="Release trip"
        tone="danger"
        onConfirm={async () => {
          await api.post(`/operator/trips/${t.groupId}/release`, { reason });
          await qc.invalidateQueries({ queryKey: ['operator-trips'] });
          navigate('/operator');
        }}
      >
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. vehicle breakdown" />
      </ConfirmDialog>
    </div>
  );
}
