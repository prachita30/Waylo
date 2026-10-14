import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { useAdminAction } from '@/lib/admin';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/dates';
import { DOC_LABEL, type Driver, type FleetDocument, type Operator, type Vehicle } from '@/lib/operator';
import type { Partner } from '@/lib/partner';
import { ReasonDialog } from './AdminShell';

type Kind = 'operator' | 'driver' | 'vehicle' | 'document' | 'partner';
interface Pending {
  operators: (Operator & { createdAt: string })[];
  drivers: (Driver & { operatorId: string; createdAt: string })[];
  vehicles: (Vehicle & { operatorId: string; createdAt: string })[];
  documents: FleetDocument[];
  partners: (Partner & { createdAt: string })[];
}

export default function Review() {
  const q = useQuery({ queryKey: ['admin', 'review'], queryFn: () => api.get<Pending>('/admin/review/pending') });
  const [rejecting, setRejecting] = useState<{ kind: Kind; id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = useAdminAction(({ kind, id, decision, reason }: { kind: Kind; id: string; decision: 'approved' | 'rejected'; reason?: string }) =>
    api.post(`/admin/review/${kind}/${id}`, { decision, reason }),
  );
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const total = p.operators.length + p.drivers.length + p.vehicles.length + p.documents.length + p.partners.length;
  const approve = (kind: Kind, id: string) =>
    decide.mutate({ kind, id, decision: 'approved' }, { onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the decision.'), onSuccess: () => setError(null) });
  const actions = (kind: Kind, name: (r: { id: string }) => string) => (r: { id: string }) => (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="mint" onClick={() => approve(kind, r.id)} aria-label={`Approve ${name(r)}`}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setRejecting({ kind, id: r.id, name: name(r) })} aria-label={`Reject ${name(r)}`}>
        Reject
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader title="Review queue" description={total ? `${total} items waiting. Approve only after checking the documents and authorisations.` : 'Nothing is waiting for review.'} />
      {error && (
        <Notice tone="danger" className="mb-4">
          {error}
        </Notice>
      )}

      <Section title="Airline and distribution partners" count={p.partners.length}>
        <DataTable
          caption="Partners awaiting review"
          rows={p.partners}
          rowKey={(r) => r.id}
          empty="No partner applications"
          columns={[
            { key: 'name', header: 'Company', cell: (r) => <span className="font-semibold">{r.name}</span> },
            { key: 'kind', header: 'Type', cell: (r) => (r.kind === 'airline' ? 'Airline' : 'Distributor') },
            { key: 'airlines', header: 'Wants to sell', cell: (r) => r.requestedAirlines.map((a) => `${a.name} (${a.code})`).join(', ') },
            { key: 'phone', header: 'Phone', cell: (r) => r.phone, hideOnMobile: true },
            { key: 'at', header: 'Applied', cell: (r) => formatDateTime(r.createdAt), hideOnMobile: true },
          ]}
          actions={actions('partner', (r) => (r as Partner).name)}
        />
      </Section>

      <Section title="Fleet operators" count={p.operators.length}>
        <DataTable
          caption="Operators awaiting review"
          rows={p.operators}
          rowKey={(r) => r.id}
          empty="No operator applications"
          columns={[
            { key: 'name', header: 'Company', cell: (r) => <span className="font-semibold">{r.name}</span> },
            { key: 'airports', header: 'Airports', cell: (r) => r.airports.join(', ') },
            { key: 'phone', header: 'Phone', cell: (r) => r.phone, hideOnMobile: true },
            { key: 'at', header: 'Applied', cell: (r) => formatDateTime(r.createdAt), hideOnMobile: true },
          ]}
          actions={actions('operator', (r) => (r as Operator).name)}
        />
      </Section>

      <Section title="Documents" count={p.documents.length}>
        <DataTable
          caption="Documents awaiting review"
          rows={p.documents}
          rowKey={(r) => r.id}
          empty="No documents to check"
          columns={[
            { key: 'type', header: 'Document', cell: (r) => DOC_LABEL[r.docType] ?? r.docType },
            { key: 'for', header: 'For', cell: (r) => r.subjectType },
            { key: 'expires', header: 'Expires', cell: (r) => (r.expiresOn ? formatDate(`${r.expiresOn}T00:00:00Z`) : '—') },
            {
              key: 'file',
              header: 'File',
              cell: (r) => (
                <a href={`/api/v1/admin/review/documents/${r.id}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                  Open <ExternalLink className="size-3.5" aria-hidden />
                </a>
              ),
            },
          ]}
          actions={actions('document', (r) => DOC_LABEL[(r as FleetDocument).docType] ?? 'document')}
        />
      </Section>

      <Section title="Drivers" count={p.drivers.length}>
        <DataTable
          caption="Drivers awaiting review"
          rows={p.drivers}
          rowKey={(r) => r.id}
          empty="No drivers to check"
          columns={[
            { key: 'name', header: 'Name', cell: (r) => r.fullName },
            { key: 'licence', header: 'Licence', cell: (r) => `••••${r.licenceLast4}` },
            { key: 'phone', header: 'Phone', cell: (r) => r.phone, hideOnMobile: true },
          ]}
          actions={actions('driver', (r) => (r as Driver).fullName)}
        />
      </Section>

      <Section title="Vehicles" count={p.vehicles.length}>
        <DataTable
          caption="Vehicles awaiting review"
          rows={p.vehicles}
          rowKey={(r) => r.id}
          empty="No vehicles to check"
          columns={[
            { key: 'reg', header: 'Registration', cell: (r) => <span className="font-mono">{r.registration}</span> },
            { key: 'model', header: 'Vehicle', cell: (r) => `${r.makeModel} · ${r.colour}` },
            { key: 'class', header: 'Class', cell: (r) => `${r.vehicleClass}, ${r.seats} seats${r.wheelchairAccessible ? ', accessible' : ''}` },
          ]}
          actions={actions('vehicle', (r) => (r as Vehicle).registration)}
        />
      </Section>

      <ReasonDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.name ?? ''}?`}
        description="Saved with the decision and shown to the applicant in their portal, so they know what to fix."
        confirmLabel="Reject"
        onSubmit={(reason) => decide.mutateAsync({ kind: rejecting!.kind, id: rejecting!.id, decision: 'rejected', reason })}
      />
    </>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <SectionHeader title={`${title}${count ? ` (${count})` : ''}`} />
      {children}
    </section>
  );
}
