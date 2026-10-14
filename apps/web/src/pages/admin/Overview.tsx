import { AlertTriangle, LifeBuoy, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/layout/PortalLayout';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, CardSection, SectionHeader } from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/DataTable';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { ROLE_LABEL, useOverview } from '@/lib/admin';
import { relativeTime } from '@/lib/dates';

export default function AdminOverview() {
  const q = useOverview();
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const pr = o.attention.pendingReviews;
  const pendingTotal = pr.operators + pr.drivers + pr.vehicles + pr.documents + pr.partners;
  const paused = Object.entries(o.features).filter(([, on]) => !on);
  return (
    <>
      <PageHeader title="Overview" description={`Live figures from the database, updated ${relativeTime(o.generatedAt)}.`} />
      {paused.length > 0 && (
        <Notice tone="danger" title="Features switched off" className="mb-6">
          {paused.map(([k]) => FEATURE_NAME[k] ?? k).join(', ')}. <Link to="/admin/settings" className="font-semibold underline">Settings</Link>
        </Notice>
      )}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Attention to="/admin/review" label="Awaiting review" value={pendingTotal} hint={`${pr.operators} operators · ${pr.partners} partners · ${pr.drivers + pr.vehicles} drivers & vehicles · ${pr.documents} documents`} icon={<ShieldCheck className="size-4" aria-hidden />} />
        <Attention to="/admin/support" label="Open support requests" value={o.attention.openTickets} hint={o.attention.urgentTickets ? `${o.attention.urgentTickets} urgent` : 'None urgent'} urgent={o.attention.urgentTickets > 0} icon={<LifeBuoy className="size-4" aria-hidden />} />
        <Attention to="/admin/incidents" label="Unresolved incidents" value={o.attention.openIncidents} hint={o.attention.criticalIncidents ? `${o.attention.criticalIncidents} critical` : 'None critical'} urgent={o.attention.criticalIncidents > 0} icon={<ShieldAlert className="size-4" aria-hidden />} />
        <Attention to="/admin/finance" label="Failed refunds" value={o.attention.failedRefunds} hint="Need a retry or manual follow-up" urgent={o.attention.failedRefunds > 0} icon={<RotateCcw className="size-4" aria-hidden />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardSection>
            <SectionHeader title="Flight bookings, last 24 h" />
            <Breakdown counts={o.last24h.bookingsByStatus} empty="No bookings in the last 24 hours" />
            {o.last24h.ticketingFailed > 0 && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-danger">
                <AlertTriangle className="size-4" aria-hidden /> {o.last24h.ticketingFailed} ticketing failures
              </p>
            )}
          </CardSection>
        </Card>
        <Card>
          <CardSection>
            <SectionHeader title="Ride groups, last 24 h" />
            <Breakdown counts={o.last24h.rideGroupsByStatus} empty="No ride groups in the last 24 hours" />
          </CardSection>
        </Card>
        <Card>
          <CardSection>
            <SectionHeader title="Active accounts" />
            <dl className="space-y-2">
              {Object.entries(ROLE_LABEL).map(([role, label]) => (
                <div key={role} className="flex justify-between text-sm">
                  <dt className="text-ink-2">{label}</dt>
                  <dd className="font-semibold tabular-nums">{o.usersByRole[role] ?? 0}</dd>
                </div>
              ))}
            </dl>
            {o.last24h.failedDeliveries > 0 && <p className="t-note mt-3">{o.last24h.failedDeliveries} message deliveries failed in the last 24 h.</p>}
          </CardSection>
        </Card>
      </div>
    </>
  );
}

const FEATURE_NAME: Record<string, string> = {
  flightBooking: 'Flight booking',
  rideRequests: 'New shared rides',
  partnerOnboarding: 'Partner applications',
  operatorOnboarding: 'Operator applications',
};

function Attention({ to, label, value, hint, icon, urgent }: { to: string; label: string; value: number; hint: string; icon: ReactNode; urgent?: boolean }) {
  return (
    <Link to={to} className="rounded-card focus-visible:outline-2 focus-visible:outline-primary">
      <MetricCard label={label} value={value} hint={hint} icon={icon} tone={urgent ? 'coral' : value ? 'primary' : 'default'} />
    </Link>
  );
}

function Breakdown({ counts, empty }: { counts: Record<string, number>; empty: string }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p className="t-note">{empty}</p>;
  return (
    <ul className="space-y-2">
      {entries.map(([status, n]) => (
        <li key={status} className="flex items-center justify-between">
          <StatusBadge status={status} />
          <span className="font-semibold tabular-nums">{n}</span>
        </li>
      ))}
    </ul>
  );
}
