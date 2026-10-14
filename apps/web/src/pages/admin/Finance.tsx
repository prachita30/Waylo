import { formatMoney } from '@waylo/shared';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Segmented } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { type PaymentRow, type RefundRow, type SettlementRow, useAdminAction, useAdminList } from '@/lib/admin';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/dates';

type Tab = 'refunds' | 'payments' | 'settlements';

export default function Finance() {
  const [tab, setTab] = useState<Tab>('refunds');
  return (
    <>
      <PageHeader title="Finance" description="Payments, refunds and operator settlements. Amounts come from the payment ledger; nothing here moves money outside the payment provider." />
      <Segmented
        label="Show"
        className="mb-6 max-w-md"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'refunds', label: 'Refunds' },
          { value: 'payments', label: 'Payments' },
          { value: 'settlements', label: 'Settlements' },
        ]}
      />
      {tab === 'refunds' ? <Refunds /> : tab === 'payments' ? <Payments /> : <Settlements />}
    </>
  );
}

function Refunds() {
  const [failedOnly, setFailedOnly] = useState(true);
  const list = useAdminList<RefundRow>('/admin/refunds', { status: failedOnly ? 'failed' : undefined });
  const [error, setError] = useState<string | null>(null);
  const retry = useAdminAction((id: string) => api.post(`/admin/refunds/${id}/retry`));
  if (list.isPending) return <SkeletonList />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => setFailedOnly((v) => !v)}>
          {failedOnly ? 'Show all refunds' : 'Show failed only'}
        </Button>
      </div>
      {error && (
        <Notice tone="danger" className="mb-4">
          {error}
        </Notice>
      )}
      <DataTable
        caption="Refunds"
        rows={list.data}
        rowKey={(r) => r.id}
        empty={failedOnly ? 'No failed refunds' : 'No refunds yet'}
        columns={[
          { key: 'at', header: 'Requested', cell: (r) => formatDateTime(r.createdAt) },
          { key: 'amount', header: 'Amount', cell: (r) => <span className="t-price">{formatMoney(r.amountMinor)}</span> },
          { key: 'reason', header: 'Reason', cell: (r) => r.reason.replace(/_/g, ' ') },
          { key: 'by', header: 'Requested by', cell: (r) => r.requestedBy, hideOnMobile: true },
          { key: 'attempts', header: 'Attempts', cell: (r) => r.attempts, hideOnMobile: true },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <span className="flex flex-col items-start gap-1">
                <StatusBadge status={r.status} />
                {r.failureReason && <span className="t-note max-w-56">{r.failureReason}</span>}
              </span>
            ),
          },
        ]}
        actions={(r) =>
          r.status === 'failed' ? (
            <Button
              size="sm"
              onClick={() => retry.mutate(r.id, { onError: (e) => setError(e instanceof ApiError ? e.message : 'Retry failed.'), onSuccess: () => setError(null) })}
              aria-label={`Retry refund of ${formatMoney(r.amountMinor)}`}
            >
              Retry
            </Button>
          ) : null
        }
      />
    </>
  );
}

function Payments() {
  const list = useAdminList<PaymentRow>('/admin/payments');
  if (list.isPending) return <SkeletonList />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <DataTable
      caption="Payments"
      rows={list.data}
      rowKey={(p) => p.id}
      empty="No payments yet"
      columns={[
        { key: 'at', header: 'Created', cell: (p) => formatDateTime(p.createdAt) },
        { key: 'for', header: 'For', cell: (p) => (p.purpose === 'flight_booking' ? 'Flight' : 'Ride') },
        { key: 'amount', header: 'Amount', cell: (p) => <span className="t-price">{formatMoney(p.amountMinor)}</span> },
        { key: 'refunded', header: 'Refunded', cell: (p) => (p.refundedMinor ? formatMoney(p.refundedMinor) : '—') },
        { key: 'provider', header: 'Provider', cell: (p) => p.provider, hideOnMobile: true },
        { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
      ]}
    />
  );
}

function Settlements() {
  const list = useAdminList<SettlementRow>('/admin/settlements');
  const run = useAdminAction(() => api.post('/admin/settlements/run', {}));
  const [paying, setPaying] = useState<SettlementRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (list.isPending) return <SkeletonList />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="t-body text-sm">A settlement run batches every completed, unsettled trip per operator up to now.</p>
        <Button
          size="sm"
          loading={run.isPending}
          onClick={() =>
            run.mutate(undefined, {
              onSuccess: (r) => setMessage(`${(r as { items: unknown[] }).items.length} settlements created.`),
              onError: (e) => setMessage(e instanceof ApiError ? e.message : 'Settlement run failed.'),
            })
          }
        >
          Run settlements
        </Button>
      </div>
      {message && (
        <Notice tone="info" className="mb-4">
          {message}
        </Notice>
      )}
      <DataTable
        caption="Settlements"
        rows={list.data}
        rowKey={(s) => s.id}
        empty="No settlements yet"
        columns={[
          { key: 'op', header: 'Operator', cell: (s) => <span className="font-semibold">{s.operatorName}</span> },
          { key: 'period', header: 'Period', cell: (s) => `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}` },
          { key: 'trips', header: 'Trips', cell: (s) => s.tripsCount },
          { key: 'gross', header: 'Gross', cell: (s) => formatMoney(s.grossFareMinor), hideOnMobile: true },
          { key: 'commission', header: 'Commission', cell: (s) => formatMoney(s.commissionMinor), hideOnMobile: true },
          { key: 'payout', header: 'Payout', cell: (s) => <span className="t-price">{formatMoney(s.payoutMinor)}</span> },
          { key: 'status', header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
          { key: 'ref', header: 'Reference', cell: (s) => s.payoutReference ?? '—', hideOnMobile: true },
        ]}
        actions={(s) =>
          s.status === 'pending' ? (
            <Button size="sm" variant="secondary" onClick={() => setPaying(s)} aria-label={`Record payout to ${s.operatorName}`}>
              Record payout
            </Button>
          ) : null
        }
      />
      {paying && <RecordPayout settlement={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

function RecordPayout({ settlement, onClose }: { settlement: SettlementRow; onClose: () => void }) {
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useAdminAction((ref: string) => api.post(`/admin/settlements/${settlement.id}/paid`, { reference: ref }));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Record payout to ${settlement.operatorName}`}
      description={`Only record this after ${formatMoney(settlement.payoutMinor)} has actually been sent. WAYLO does not send the transfer from here.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              if (reference.trim().length < 4) return setError('Enter the bank or payout reference.');
              save.mutate(reference.trim(), { onSuccess: onClose, onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save.') });
            }}
          >
            Mark as paid
          </Button>
        </>
      }
    >
      <Input label="Payout reference" value={reference} onChange={(e) => setReference(e.target.value)} error={error ?? undefined} />
    </Dialog>
  );
}
