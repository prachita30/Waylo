import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PortalLayout';
import { DataTable } from '@/components/ui/DataTable';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import type { AuditEntry } from '@/lib/partner';

const ACTION_LABEL: Record<string, string> = {
  'partner.onboarded': 'Account created',
  'partner.approved': 'Approved by WAYLO',
  'partner.rejected': 'Rejected by WAYLO',
  'partner.suspended': 'Suspended by WAYLO',
  'route.added': 'Route added',
  'route.deactivated': 'Route deactivated',
  'offer.created': 'Draft offer created',
  'offer.published': 'Offer published',
  'offer.paused': 'Offer paused',
  'offer.withdrawn': 'Offer withdrawn',
  'offer.updated': 'Offer edited',
};

export default function Activity() {
  const q = useQuery({ queryKey: ['partner-audit'], queryFn: () => api.get<{ items: AuditEntry[] }>('/partner/audit').then((r) => r.items) });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <PageHeader title="Activity" description="Every change to your account, routes and offers, including WAYLO review decisions." />
      <DataTable
        caption="Activity"
        rows={q.data}
        rowKey={(e) => e.id}
        empty="No activity yet"
        columns={[
          { key: 'when', header: 'When', cell: (e) => formatDateTime(e.createdAt) },
          { key: 'what', header: 'What', cell: (e) => ACTION_LABEL[e.action] ?? e.action },
          { key: 'by', header: 'By', cell: (e) => (e.actorRole === 'admin' ? 'WAYLO' : 'Your team') },
          { key: 'detail', header: 'Detail', cell: (e) => detail(e), hideOnMobile: true },
        ]}
      />
    </>
  );
}

function detail(e: AuditEntry) {
  const m = e.metadata;
  if (typeof m.reason === 'string') return m.reason;
  if (typeof m.flightNumber === 'string') return m.flightNumber;
  if (typeof m.origin === 'string') return `${m.origin} → ${String(m.destination)}`;
  return '—';
}
