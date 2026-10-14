import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Badge, StatusBadge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Segmented } from '@/components/ui/Field';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { type AdminIncident, useAdminAction, useAdminList } from '@/lib/admin';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { ReasonDialog } from './AdminShell';

const SEVERITY_TONE: Record<AdminIncident['severity'], Tone> = { critical: 'danger', high: 'coral', medium: 'amber', low: 'neutral' };

export default function Incidents() {
  const [view, setView] = useState<'open' | 'investigating' | 'resolved'>('open');
  const list = useAdminList<AdminIncident>('/admin/incidents', { status: view }, { refetchInterval: 30_000 });
  const [resolving, setResolving] = useState<AdminIncident | null>(null);
  const update = useAdminAction(({ id, status, resolution }: { id: string; status: AdminIncident['status']; resolution?: string }) => api.patch(`/admin/incidents/${id}`, { status, resolution }));
  return (
    <>
      <PageHeader title="Incidents" description="Safety and service incidents reported by riders, drivers and operators. Critical incidents are listed first." />
      <Segmented
        label="Show"
        className="mb-6 max-w-md"
        value={view}
        onChange={setView}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'investigating', label: 'Investigating' },
          { value: 'resolved', label: 'Resolved' },
        ]}
      />
      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          caption="Incidents"
          rows={list.data}
          rowKey={(i) => i.id}
          empty={view === 'resolved' ? 'No resolved incidents' : 'No incidents here'}
          columns={[
            { key: 'severity', header: 'Severity', cell: (i) => <Badge tone={SEVERITY_TONE[i.severity]}>{i.severity}</Badge> },
            {
              key: 'what',
              header: 'Report',
              cell: (i) => (
                <span className="flex flex-col">
                  <span className="font-semibold">{i.category.replace(/_/g, ' ')}</span>
                  <span className="t-body max-w-md text-sm">{i.description}</span>
                  {i.resolution && <span className="t-note mt-1">Resolution: {i.resolution}</span>}
                </span>
              ),
            },
            { key: 'who', header: 'Reported by', cell: (i) => `${i.reporter.fullName} (${i.reporterRole})`, hideOnMobile: true },
            { key: 'operator', header: 'Operator', cell: (i) => i.operatorName ?? '—', hideOnMobile: true },
            { key: 'at', header: 'Reported', cell: (i) => formatDateTime(i.createdAt) },
            { key: 'status', header: 'Status', cell: (i) => <StatusBadge status={i.status === 'open' ? 'open_ticket' : i.status} /> },
          ]}
          actions={(i) =>
            i.status === 'resolved' ? null : (
              <div className="flex flex-wrap gap-2">
                {i.status === 'open' && (
                  <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: i.id, status: 'investigating' })} aria-label={`Start investigating ${i.category}`}>
                    Investigate
                  </Button>
                )}
                <Button size="sm" onClick={() => setResolving(i)} aria-label={`Resolve ${i.category}`}>
                  Resolve
                </Button>
              </div>
            )
          }
        />
      )}
      <ReasonDialog
        open={!!resolving}
        onClose={() => setResolving(null)}
        title="Resolve incident"
        description="Describe what was done. This is kept with the incident record."
        label="Resolution"
        confirmLabel="Mark resolved"
        tone="primary"
        minLength={10}
        onSubmit={(resolution) => update.mutateAsync({ id: resolving!.id, status: 'resolved', resolution })}
      />
    </>
  );
}
