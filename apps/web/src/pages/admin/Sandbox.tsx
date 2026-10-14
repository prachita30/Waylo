import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Toggle } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { type AdminFlight, type OutboxMessage, useAdminAction } from '@/lib/admin';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';

export default function Sandbox() {
  return (
    <>
      <PageHeader title="Sandbox tools" description="Test controls for the simulated integrations. Nothing here reaches a real airline, payment provider or phone." />
      <Notice tone="info" className="mb-8">
        These tools only work while the server runs sandbox integrations, and are hidden in production mode.
      </Notice>
      <Flights />
      <Outbox />
    </>
  );
}

function Flights() {
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['admin', 'flights', search], queryFn: () => api.get<{ items: AdminFlight[]; sandboxControls: boolean }>('/admin/flights', { query: { q: search || undefined } }) });
  const [editing, setEditing] = useState<AdminFlight | null>(null);
  return (
    <section className="mb-10">
      <SectionHeader title="Flight status" />
      <p className="t-body mb-4 text-sm">Simulate a delay or cancellation. Linked shared rides are re-planned straight away, exactly as they would be for a real status change.</p>
      <Input label="Flight number" value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())} wrapperClassName="mb-4 w-48" />
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          caption="Flights in the next four days"
          rows={q.data.items}
          rowKey={(f) => f.id}
          empty="No flights in the window"
          columns={[
            { key: 'flight', header: 'Flight', cell: (f) => <span className="font-semibold">{f.flightNumber}</span> },
            { key: 'route', header: 'Route', cell: (f) => `${f.origin} → ${f.destination}` },
            { key: 'arrive', header: 'Scheduled arrival', cell: (f) => formatDateTime(f.arriveAt) },
            { key: 'eta', header: 'Expected', cell: (f) => (f.estimatedArriveAt ? formatDateTime(f.estimatedArriveAt) : '—'), hideOnMobile: true },
            { key: 'status', header: 'Status', cell: (f) => <StatusBadge status={f.status} /> },
          ]}
          actions={(f) =>
            q.data.sandboxControls ? (
              <Button size="sm" variant="secondary" onClick={() => setEditing(f)} aria-label={`Simulate status for ${f.flightNumber}`}>
                Simulate
              </Button>
            ) : null
          }
        />
      )}
      {editing && <SimulateStatus flight={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function SimulateStatus({ flight, onClose }: { flight: AdminFlight; onClose: () => void }) {
  const [delay, setDelay] = useState('45');
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = useAdminAction((v: { delayMinutes: number; cancelled: boolean }) => api.post(`/sandbox/flights/${flight.id}/status`, v));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Simulate ${flight.flightNumber}`}
      description="Applies to the sandbox flight-status feed and to rides linked to this flight."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={apply.isPending}
            onClick={() => {
              const n = Number(delay);
              if (!cancelled && (!Number.isInteger(n) || n < 0 || n > 720)) return setError('Delay must be 0–720 minutes.');
              apply.mutate({ delayMinutes: cancelled ? 0 : n, cancelled }, { onSuccess: onClose, onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not apply.') });
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <Toggle label="Cancelled" checked={cancelled} onChange={setCancelled} />
      {!cancelled && <Input label="Delay (minutes, 0 for on time)" inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value)} error={error ?? undefined} />}
      {cancelled && error && <p className="text-sm text-danger">{error}</p>}
    </Dialog>
  );
}

function Outbox() {
  const q = useQuery({ queryKey: ['admin', 'outbox'], queryFn: () => api.get<{ items: OutboxMessage[] }>('/admin/sandbox/outbox').then((r) => r.items), refetchInterval: 15_000 });
  const [open, setOpen] = useState<OutboxMessage | null>(null);
  return (
    <section>
      <SectionHeader title="Message outbox" />
      <p className="t-body mb-4 text-sm">Emails, SMS and push notifications the platform would have sent. The most recent 100 since the server started.</p>
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          caption="Sandbox outbox"
          rows={q.data}
          rowKey={(m) => `${m.at}-${m.channel}-${m.to}-${m.subject}`}
          empty="Nothing sent since the server started"
          columns={[
            { key: 'at', header: 'Sent', cell: (m) => formatDateTime(m.at) },
            { key: 'channel', header: 'Channel', cell: (m) => <Badge tone="lavender">{m.channel.toUpperCase()}</Badge> },
            { key: 'to', header: 'To', cell: (m) => <span className="break-all">{m.to}</span> },
            { key: 'subject', header: 'Subject', cell: (m) => m.subject },
          ]}
          actions={(m) =>
            m.html ? (
              <Button size="sm" variant="ghost" onClick={() => setOpen(m)} aria-label={`Preview ${m.subject}`}>
                Preview
              </Button>
            ) : null
          }
        />
      )}
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)} title={open.subject} description={`To ${open.to}`} className="max-w-3xl">
          {/* Sandboxed iframe: the email HTML is rendered without scripts or same-origin access. */}
          <iframe title="Email preview" sandbox="" srcDoc={open.html ?? ''} className="h-[60vh] w-full rounded-lg border border-line bg-white" />
        </Dialog>
      )}
    </section>
  );
}
