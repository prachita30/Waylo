import { onboardingSchema } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CarFront, ClipboardList, IndianRupee, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router';
import { PageHeader, PortalLayout, type PortalNavItem } from '@/components/layout/PortalLayout';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { Checkbox, Input } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { useAirports } from '@/lib/meta';
import { type Membership, useMembership } from '@/lib/operator';

const MANAGER_NAV: PortalNavItem[] = [
  { to: '/operator', label: 'Trips', icon: ClipboardList, end: true },
  { to: '/operator/fleet', label: 'Fleet', icon: CarFront },
  { to: '/operator/availability', label: 'Shifts', icon: CalendarClock },
  { to: '/operator/earnings', label: 'Earnings', icon: IndianRupee },
  { to: '/operator/incidents', label: 'Incidents', icon: ShieldAlert },
];
const DRIVER_NAV: PortalNavItem[] = [
  { to: '/operator', label: 'My trips', icon: ClipboardList, end: true },
  { to: '/operator/incidents', label: 'Incidents', icon: ShieldAlert },
];

export default function OperatorShell() {
  const q = useMembership();
  const m = q.data;
  const banner =
    m && m.operator.status !== 'approved' ? (
      <Notice tone={m.operator.status === 'pending' ? 'info' : 'danger'} title={m.operator.status === 'pending' ? 'Awaiting verification' : `Account ${m.operator.status}`} className="mb-6">
        {m.operator.status === 'pending'
          ? 'Add your vehicles, drivers and documents. WAYLO reviews them before you can accept passenger trips.'
          : (m.operator.statusReason ?? 'Contact WAYLO support for details.')}
      </Notice>
    ) : null;
  return (
    <PortalLayout title="Operator" home="/operator" nav={m?.role === 'driver' ? DRIVER_NAV : MANAGER_NAV} banner={banner} />
  );
}

/** Gate for operator pages: loading → error → onboarding → page. */
export function OperatorGate({ children }: { children: (m: Membership) => React.ReactNode }) {
  const q = useMembership();
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Onboarding />;
  return <>{children(q.data)}</>;
}

export function OperatorOutlet() {
  return <OperatorGate>{() => <Outlet />}</OperatorGate>;
}

function Onboarding() {
  const qc = useQueryClient();
  const airports = useAirports();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [selected, setSelected] = useState<string[]>(['BOM']);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (v: unknown) => api.post('/operator/onboarding', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operator-me'] }),
    onError: (e) => e instanceof ApiError && setErrors({ ...e.fieldErrors(), form: e.message }),
  });
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Set up your fleet" description="Tell us about your company. You can add vehicles, drivers and documents next." />
      <Card>
        <CardSection>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const v = { name, phone, airports: selected };
              const p = onboardingSchema.safeParse(v);
              if (!p.success) return setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])));
              setErrors({});
              create.mutate(v);
            }}
          >
            <Input label="Company or fleet name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
            <Input label="Dispatch phone" type="tel" placeholder="+91" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Airports you serve</legend>
              <div className="grid grid-cols-2 gap-2">
                {airports.data?.map((a) => (
                  <Checkbox
                    key={a.code}
                    label={`${a.city} (${a.code})`}
                    checked={selected.includes(a.code)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, a.code] : s.filter((x) => x !== a.code)))}
                  />
                ))}
              </div>
              {errors.airports && <p role="alert" className="mt-1 text-sm text-danger">{errors.airports}</p>}
            </fieldset>
            {errors.form && <Notice tone="danger"><AlertTriangle className="mr-1 inline size-4" aria-hidden />{errors.form}</Notice>}
            <Button type="submit" block loading={create.isPending}>
              Submit for verification
            </Button>
          </form>
        </CardSection>
      </Card>
    </div>
  );
}
