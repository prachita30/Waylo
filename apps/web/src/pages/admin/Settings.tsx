import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection, SectionHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Input, Select, Toggle } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { type FeatureFlags, useAdminAction } from '@/lib/admin';
import { api, ApiError } from '@/lib/api';
import type { AdapterInfo } from '@/lib/meta';

interface RideSettings {
  exitBufferMinutes: number;
  lockLeadMinutes: number;
  maxParties: number;
  defaultSplitMethod: 'equal_per_seat' | 'distance_weighted';
  lateCancelPercent: number;
  fullChargeWithinMinutes: number;
  pickupGraceMinutes: number;
}
interface Config {
  features: FeatureFlags;
  rides: RideSettings;
  adapters: AdapterInfo[];
  mode: 'demo' | 'production';
}

const FEATURES: { key: keyof FeatureFlags; label: string; description: string }[] = [
  { key: 'flightBooking', label: 'Flight booking', description: 'New price locks and bookings. Search, existing bookings, cancellations and refunds keep working when off.' },
  { key: 'rideRequests', label: 'New shared rides', description: 'New ride requests and groups. Rides already matched keep running.' },
  { key: 'partnerOnboarding', label: 'Partner applications', description: 'New airline and distributor applications.' },
  { key: 'operatorOnboarding', label: 'Operator applications', description: 'New fleet operator applications.' },
];

const RIDE_FIELDS: { key: Exclude<keyof RideSettings, 'defaultSplitMethod'>; label: string; hint: string; min: number; max: number }[] = [
  { key: 'exitBufferMinutes', label: 'Landing-to-kerb allowance (min)', hint: 'Planning estimate from landing to reaching the pickup point.', min: 0, max: 120 },
  { key: 'lockLeadMinutes', label: 'Lock groups before pickup (min)', hint: 'Groups stop changing this long before the planned pickup.', min: 10, max: 240 },
  { key: 'maxParties', label: 'Max parties per vehicle', hint: 'Separate bookings sharing one vehicle.', min: 2, max: 6 },
  { key: 'pickupGraceMinutes', label: 'Driver waiting time (min)', hint: 'After this, a rider who has not arrived is a no-show.', min: 5, max: 60 },
  { key: 'lateCancelPercent', label: 'Late cancellation charge (%)', hint: 'Charged when a rider cancels after the group locks.', min: 0, max: 100 },
  { key: 'fullChargeWithinMinutes', label: 'Full charge within (min of pickup)', hint: 'Cancelling this close to pickup costs the full share.', min: 0, max: 240 },
];

export default function Settings() {
  const q = useQuery({ queryKey: ['admin', 'config'], queryFn: () => api.get<Config>('/admin/config') });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <PageHeader title="Settings" description="Changes apply immediately and are recorded in the audit log." />
      <Features features={q.data.features} />
      <Rides key={JSON.stringify(q.data.rides)} rides={q.data.rides} />
      <Card>
        <CardSection>
          <SectionHeader title="Integrations" />
          <p className="t-body mb-4 text-sm">
            Mode: <strong>{q.data.mode}</strong>. Integrations are chosen by server configuration at start-up and cannot be switched here. In production mode the server refuses to start with sandbox integrations.
          </p>
          <ul className="divide-y divide-line">
            {q.data.adapters.map((a) => (
              <li key={`${a.kind}-${a.provider}`} className="flex items-center justify-between gap-4 py-3">
                <span>
                  <span className="font-semibold capitalize">{a.kind.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                  <span className="t-note block">{a.provider}</span>
                </span>
                <Badge tone={a.mode === 'sandbox' ? 'amber' : 'mint'}>{a.mode === 'sandbox' ? 'Sandbox' : 'Live'}</Badge>
              </li>
            ))}
          </ul>
        </CardSection>
      </Card>
    </>
  );
}

function Features({ features }: { features: FeatureFlags }) {
  const save = useAdminAction((patch: Partial<FeatureFlags>) => api.put('/admin/config/features', patch));
  const [confirmOff, setConfirmOff] = useState<(typeof FEATURES)[number] | null>(null);
  return (
    <Card className="mb-6">
      <CardSection>
        <SectionHeader title="Features" />
        <div className="divide-y divide-line">
          {FEATURES.map((f) => (
            <Toggle
              key={f.key}
              label={f.label}
              description={f.description}
              checked={features[f.key]}
              disabled={save.isPending}
              onChange={(on) => (on ? save.mutate({ [f.key]: true }) : setConfirmOff(f))}
            />
          ))}
        </div>
      </CardSection>
      <ConfirmDialog
        open={!!confirmOff}
        onOpenChange={(o) => !o && setConfirmOff(null)}
        title={`Switch off ${confirmOff?.label.toLowerCase() ?? ''}?`}
        description={confirmOff?.description}
        confirmLabel="Switch off"
        tone="danger"
        onConfirm={async () => {
          await save.mutateAsync({ [confirmOff!.key]: false });
          setConfirmOff(null);
        }}
      />
    </Card>
  );
}

function Rides({ rides }: { rides: RideSettings }) {
  const [form, setForm] = useState(() => Object.fromEntries(RIDE_FIELDS.map((f) => [f.key, String(rides[f.key])])) as Record<string, string>);
  const [split, setSplit] = useState(rides.defaultSplitMethod);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const save = useAdminAction((patch: Partial<RideSettings>) => api.put('/admin/config/rides', patch));
  return (
    <Card className="mb-6">
      <CardSection>
        <SectionHeader title="Shared-ride rules" />
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const next: Record<string, string> = {};
            const patch: Partial<RideSettings> = { defaultSplitMethod: split };
            for (const f of RIDE_FIELDS) {
              const n = Number(form[f.key]);
              if (!Number.isInteger(n) || n < f.min || n > f.max) next[f.key] = `Whole number from ${f.min} to ${f.max}.`;
              else (patch as Record<string, number>)[f.key] = n;
            }
            setErrors(next);
            setSaved(false);
            if (Object.keys(next).length) return;
            save.mutate(patch, {
              onSuccess: () => setSaved(true),
              onError: (err) => setErrors({ form: err instanceof ApiError ? err.message : 'Could not save.' }),
            });
          }}
        >
          {RIDE_FIELDS.map((f) => (
            <Input key={f.key} label={f.label} hint={f.hint} inputMode="numeric" value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} error={errors[f.key]} />
          ))}
          <Select label="Default fare split" value={split} onChange={(e) => setSplit(e.target.value as RideSettings['defaultSplitMethod'])}>
            <option value="equal_per_seat">Equal per seat</option>
            <option value="distance_weighted">Weighted by distance</option>
          </Select>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" loading={save.isPending}>
              Save ride rules
            </Button>
            {saved && <span className="text-sm text-mint" role="status">Saved</span>}
          </div>
          {errors.form && <Notice tone="danger" className="sm:col-span-2">{errors.form}</Notice>}
          <p className="t-note sm:col-span-2">Fare rates and matching weights stay at their code defaults and are not editable here yet.</p>
        </form>
      </CardSection>
    </Card>
  );
}
