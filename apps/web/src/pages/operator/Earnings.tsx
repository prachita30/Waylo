import { formatMoney } from '@waylo/shared';
import { useQuery } from '@tanstack/react-query';
import { CarFront, IndianRupee, Percent } from 'lucide-react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { StatusBadge } from '@/components/ui/Badge';
import { SectionHeader } from '@/components/ui/Card';
import { DataTable, MetricCard } from '@/components/ui/DataTable';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { useMembership } from '@/lib/operator';

interface Settlement {
  id: string;
  periodEnd: string;
  tripsCount: number;
  payoutMinor: number;
  status: string;
  payoutReference: string | null;
}

interface EarningsData {
  totalEarningMinor: number;
  trips: { groupId: string; completedAt: string | null; earning: number | null; commission: number | null; fare: number }[];
}

export default function Earnings() {
  const { data: m } = useMembership();
  const q = useQuery({ queryKey: ['operator-earnings'], queryFn: () => api.get<EarningsData>('/operator/earnings') });
  const settlements = useQuery({
    queryKey: ['operator-settlements'],
    queryFn: () => api.get<{ items: Settlement[] }>('/operator/settlements').then((r) => r.items),
  });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const commission = q.data.trips.reduce((s, t) => s + (t.commission ?? 0), 0);
  return (
    <>
      <PageHeader title="Earnings" description="Your earning per trip is the vehicle fare minus WAYLO's commission. Payouts are made in settlement batches." />
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total earned" value={formatMoney(q.data.totalEarningMinor)} icon={<IndianRupee className="size-4" aria-hidden />} tone="mint" />
        <MetricCard label="Completed trips" value={q.data.trips.length} icon={<CarFront className="size-4" aria-hidden />} tone="primary" />
        <MetricCard label="Commission" value={formatMoney(commission)} hint={m ? `${m.operator.commissionBps / 100}% of vehicle fare` : undefined} icon={<Percent className="size-4" aria-hidden />} />
      </div>
      <SectionHeader title="Settlements" />
      <div className="mb-10">
        <DataTable
          caption="Settlements"
          rows={settlements.data ?? []}
          rowKey={(s) => s.id}
          empty="Settlements are created in weekly batches"
          columns={[
            { key: 'period', header: 'Up to', cell: (s) => formatDateTime(s.periodEnd) },
            { key: 'trips', header: 'Trips', cell: (s) => s.tripsCount },
            { key: 'payout', header: 'Payout', cell: (s) => <span className="t-price">{formatMoney(s.payoutMinor)}</span> },
            { key: 'status', header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
            { key: 'ref', header: 'Reference', cell: (s) => s.payoutReference ?? '—', hideOnMobile: true },
          ]}
        />
      </div>
      <SectionHeader title="Completed trips" />
      <DataTable
        caption="Completed trips"
        rows={q.data.trips}
        rowKey={(t) => t.groupId}
        empty="Completed trips will appear here"
        columns={[
          { key: 'date', header: 'Completed', cell: (t) => (t.completedAt ? formatDateTime(t.completedAt) : '—') },
          { key: 'fare', header: 'Vehicle fare', cell: (t) => formatMoney(t.fare) },
          { key: 'commission', header: 'Commission', cell: (t) => formatMoney(t.commission ?? 0) },
          { key: 'earning', header: 'Your earning', cell: (t) => <span className="t-price">{formatMoney(t.earning ?? 0)}</span> },
        ]}
      />
    </>
  );
}
