import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Input, Select } from '@/components/ui/Field';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { type AuditRow, useAdminList } from '@/lib/admin';
import { formatDateTime } from '@/lib/dates';

const ENTITY_TYPES = ['user', 'flight_booking', 'payment', 'refund', 'offer', 'partner', 'partner_route', 'operator', 'driver', 'vehicle', 'document', 'ride_group', 'support_ticket', 'incident', 'settlement', 'config', 'flight'];
const PAGE = 50;

export default function Audit() {
  const [entityType, setEntityType] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useAdminList<AuditRow>('/admin/audit', { entityType: entityType || undefined, action: action || undefined, limit: PAGE, offset });
  return (
    <>
      <PageHeader title="Audit log" description="Who did what, and when. Entries cannot be edited or deleted from the application." />
      <form
        className="mb-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setAction(actionInput.trim());
          setOffset(0);
        }}
      >
        <Select
          label="Record type"
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value);
            setOffset(0);
          }}
          wrapperClassName="w-48"
        >
          <option value="">All</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <Input label="Action starts with" placeholder="e.g. offer. or user.suspended" value={actionInput} onChange={(e) => setActionInput(e.target.value)} wrapperClassName="min-w-56 flex-1" />
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Audit events"
            rows={list.data}
            rowKey={(e) => e.id}
            empty="No events match"
            columns={[
              { key: 'when', header: 'When', cell: (e) => formatDateTime(e.createdAt) },
              { key: 'action', header: 'Action', cell: (e) => <span className="font-mono text-sm">{e.action}</span> },
              { key: 'who', header: 'By', cell: (e) => e.actorEmail ?? e.actorRole ?? 'system' },
              { key: 'entity', header: 'Record', cell: (e) => `${e.entityType.replace(/_/g, ' ')}${e.entityId ? ` ${e.entityId.slice(0, 8)}` : ''}`, hideOnMobile: true },
              { key: 'meta', header: 'Details', cell: (e) => <Details metadata={e.metadata} />, hideOnMobile: true },
            ]}
          />
          <div className="mt-4 flex justify-between">
            <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>
              Newer
            </Button>
            <Button variant="secondary" size="sm" disabled={list.data.length < PAGE} onClick={() => setOffset((o) => o + PAGE)}>
              Older
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function Details({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata ?? {});
  if (!entries.length) return <>—</>;
  return (
    <span className="t-note block max-w-md break-words">
      {entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}
    </span>
  );
}
