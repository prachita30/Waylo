import { partnerOnboardingSchema } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, History, LayoutDashboard, Plus, Route, Tags, Ticket, X } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router';
import { PageHeader, PortalLayout, type PortalNavItem } from '@/components/layout/PortalLayout';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { Input, Segmented } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { type Partner, usePartner } from '@/lib/partner';

const NAV: PortalNavItem[] = [
  { to: '/partner', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/partner/offers', label: 'Offers', icon: Tags },
  { to: '/partner/routes', label: 'Routes', icon: Route },
  { to: '/partner/bookings', label: 'Bookings', icon: Ticket },
  { to: '/partner/activity', label: 'Activity', icon: History },
];

export default function PartnerShell() {
  const { data: p } = usePartner();
  const banner =
    p && p.status !== 'approved' ? (
      <Notice tone={p.status === 'pending' ? 'info' : 'danger'} title={p.status === 'pending' ? 'Awaiting verification' : `Account ${p.status}`} className="mb-6">
        {p.status === 'pending'
          ? 'WAYLO verifies that you are authorised to sell the airlines you listed. You can set up routes now; offers can be published once you are approved.'
          : (p.statusReason ?? 'Contact WAYLO partner support for details.')}
      </Notice>
    ) : null;
  return <PortalLayout title="Partner" home="/partner" nav={NAV} banner={banner} />;
}

/** Gate for partner pages: loading → error → onboarding → page. */
export function PartnerGate({ children }: { children: (p: Partner) => React.ReactNode }) {
  const q = usePartner();
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Onboarding />;
  return <>{children(q.data)}</>;
}

export function PartnerOutlet() {
  return <PartnerGate>{() => <Outlet />}</PartnerGate>;
}

function Onboarding() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<'airline' | 'distributor'>('airline');
  const [airlines, setAirlines] = useState([{ code: '', name: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (v: unknown) => api.post('/partner/onboarding', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-me'] }),
    onError: (e) => e instanceof ApiError && setErrors({ ...e.fieldErrors(), form: e.message }),
  });
  const setAirline = (i: number, patch: Partial<{ code: string; name: string }>) => setAirlines((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Set up your partner account" description="Tell us who you are and which airlines you are authorised to sell. WAYLO verifies this before any fare goes live." />
      <Card>
        <CardSection>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const v = { name, phone, kind, airlines };
              const p = partnerOnboardingSchema.safeParse(v);
              if (!p.success) return setErrors(Object.fromEntries(p.error.issues.map((i) => [i.path.join('.'), i.message])));
              setErrors({});
              create.mutate(p.data);
            }}
          >
            <Input label="Company name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
            <Segmented
              label="You are"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'airline', label: 'An airline' },
                { value: 'distributor', label: 'An authorised distributor' },
              ]}
            />
            <Input label="Commercial contact phone" type="tel" placeholder="+91" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold">Airlines you are authorised to sell</legend>
              {airlines.map((a, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Input
                    label="Code"
                    wrapperClassName="w-24"
                    maxLength={2}
                    value={a.code}
                    onChange={(e) => setAirline(i, { code: e.target.value.toUpperCase() })}
                    error={errors[`airlines.${i}.code`]}
                    aria-label={`Airline ${i + 1} code`}
                  />
                  <Input label="Airline name" wrapperClassName="flex-1" value={a.name} onChange={(e) => setAirline(i, { name: e.target.value })} error={errors[`airlines.${i}.name`]} aria-label={`Airline ${i + 1} name`} />
                  {airlines.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" aria-label={`Remove airline ${i + 1}`} onClick={() => setAirlines((l) => l.filter((_, j) => j !== i))}>
                      <X className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
              {errors.airlines && <p role="alert" className="text-sm text-danger">{errors.airlines}</p>}
              {airlines.length < 10 && (
                <Button type="button" variant="secondary" size="sm" onClick={() => setAirlines((l) => [...l, { code: '', name: '' }])}>
                  <Plus className="size-4" aria-hidden /> Add airline
                </Button>
              )}
            </fieldset>
            {errors.form && (
              <Notice tone="danger">
                <AlertTriangle className="mr-1 inline size-4" aria-hidden />
                {errors.form}
              </Notice>
            )}
            <Button type="submit" block loading={create.isPending}>
              Submit for verification
            </Button>
          </form>
        </CardSection>
      </Card>
    </div>
  );
}
