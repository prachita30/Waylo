import { formatMoney } from '@waylo/shared';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PortalLayout';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import type { PartnerBooking } from '@/lib/partner';

export default function Bookings() {
  const q = useQuery({ queryKey: ['partner-bookings'], queryFn: () => api.get<{ items: PartnerBooking[] }>('/partner/bookings').then((r) => r.items) });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <PageHeader title="Bookings" description="Bookings made on your fares. Traveller personal details are not shown in the partner portal." />
      <DataTable
        caption="Bookings"
        rows={q.data}
        rowKey={(b) => b.reference}
        empty="Bookings on your fares will appear here"
        columns={[
          { key: 'ref', header: 'Reference', cell: (b) => <span className="font-mono text-sm">{b.reference}</span> },
          { key: 'flight', header: 'Flight', cell: (b) => `${b.flightNumber} · ${formatDateTime(b.departAt)}` },
          { key: 'seats', header: 'Seats', cell: (b) => b.seats },
          { key: 'total', header: 'Total', cell: (b) => <span className="t-price">{formatMoney(b.totalMinor)}</span> },
          { key: 'pnr', header: 'PNR', cell: (b) => b.pnr ?? '—', hideOnMobile: true },
          { key: 'booked', header: 'Booked', cell: (b) => formatDateTime(b.createdAt), hideOnMobile: true },
          { key: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
        ]}
      />
    </>
  );
}
