import { formatMoney } from '@waylo/shared';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Input, Select } from '@/components/ui/Field';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { type AdminBooking, useAdminList } from '@/lib/admin';
import { formatDateTime } from '@/lib/dates';

const STATUSES = ['pending_payment', 'ticketing', 'confirmed', 'ticketing_failed', 'payment_failed', 'cancelled', 'expired'];

export default function AdminBookings() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = useAdminList<AdminBooking>('/admin/bookings', { q: q || undefined, status: status || undefined, limit: 100 });
  return (
    <>
      <PageHeader title="Flight bookings" description="Find a booking by WAYLO reference, PNR or contact email." />
      <form
        className="mb-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search.trim());
        }}
      >
        <Input label="Reference, PNR or email" value={search} onChange={(e) => setSearch(e.target.value)} wrapperClassName="min-w-56 flex-1" />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} wrapperClassName="w-48">
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          caption="Bookings"
          rows={list.data}
          rowKey={(b) => b.id}
          empty="No bookings match"
          columns={[
            { key: 'ref', header: 'Reference', cell: (b) => <span className="font-mono text-sm">{b.reference}</span> },
            { key: 'flight', header: 'Flight', cell: (b) => `${b.flightNumber} ${b.origin}→${b.destination}` },
            { key: 'depart', header: 'Departs', cell: (b) => formatDateTime(b.departAt), hideOnMobile: true },
            { key: 'who', header: 'Contact', cell: (b) => <span className="break-all">{b.contactEmail}</span>, hideOnMobile: true },
            { key: 'total', header: 'Total', cell: (b) => <span className="t-price">{formatMoney(b.totalMinor)}</span> },
            {
              key: 'status',
              header: 'Status',
              cell: (b) => (
                <span className="flex flex-col items-start gap-1">
                  <StatusBadge status={b.status} />
                  {b.failureReason && <span className="t-note max-w-56">{b.failureReason}</span>}
                  {b.refundDueMinor ? <span className="t-note">Refund due {formatMoney(b.refundDueMinor)}</span> : null}
                </span>
              ),
            },
            { key: 'pnr', header: 'PNR', cell: (b) => b.pnr ?? '—', hideOnMobile: true },
          ]}
        />
      )}
    </>
  );
}
