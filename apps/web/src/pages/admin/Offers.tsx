import { formatMoney } from '@waylo/shared';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Input, Segmented } from '@/components/ui/Field';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { type AdminOffer, useAdminAction, useAdminList } from '@/lib/admin';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { ReasonDialog } from './AdminShell';

type View = 'published' | 'held' | 'partner' | 'all';

export default function AdminOffers() {
  const [view, setView] = useState<View>('published');
  const [flight, setFlight] = useState('');
  const query = { status: view === 'published' ? 'published' : undefined, held: view === 'held' ? 'true' : undefined, source: view === 'partner' ? 'partner' : undefined, q: flight || undefined, limit: 200 };
  const list = useAdminList<AdminOffer>('/admin/offers', query);
  const [holding, setHolding] = useState<AdminOffer | null>(null);
  const hold = useAdminAction(({ id, reason }: { id: string; reason: string }) => api.post(`/admin/offers/${id}/hold`, { reason }));
  const release = useAdminAction((id: string) => api.post(`/admin/offers/${id}/release`));

  return (
    <>
      <PageHeader title="Offers" description="Upcoming fares from airline integrations and partners. A hold takes a fare off sale until you release it; airline refreshes and partners cannot override a hold." />
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <Segmented
          label="Show"
          value={view}
          onChange={setView}
          className="max-w-lg flex-1"
          options={[
            { value: 'published', label: 'On sale' },
            { value: 'held', label: 'On hold' },
            { value: 'partner', label: 'Partner fares' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Input label="Flight number" value={flight} onChange={(e) => setFlight(e.target.value.toUpperCase())} wrapperClassName="w-40" />
      </div>
      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          caption="Offers"
          rows={list.data}
          rowKey={(o) => o.id}
          empty="No offers match"
          columns={[
            { key: 'flight', header: 'Flight', cell: (o) => <span className="font-semibold">{o.flightNumber}</span> },
            { key: 'route', header: 'Route', cell: (o) => `${o.origin} → ${o.destination}` },
            { key: 'depart', header: 'Departs', cell: (o) => formatDateTime(o.departAt) },
            { key: 'seller', header: 'Seller', cell: (o) => (o.partner ? o.partner : <Badge tone="lavender">Airline feed</Badge>) },
            {
              key: 'fare',
              header: 'Fare',
              cell: (o) => (
                <span className="flex flex-col">
                  <span className="t-price">{formatMoney(o.fareMinor)}</span>
                  {o.referenceFareMinor && <span className="t-note" title={o.referenceSource ?? undefined}>vs {formatMoney(o.referenceFareMinor)}</span>}
                </span>
              ),
            },
            { key: 'sold', header: 'Sold', cell: (o) => `${o.seatsSold}${o.inventoryCap ? ` / ${o.inventoryCap}` : ''}`, hideOnMobile: true },
            {
              key: 'status',
              header: 'Status',
              cell: (o) => (
                <span className="flex flex-col items-start gap-1">
                  {o.adminHold ? <Badge tone="danger">On hold</Badge> : <StatusBadge status={o.status} />}
                  {o.adminHoldReason && <span className="t-note max-w-56">{o.adminHoldReason}</span>}
                </span>
              ),
            },
          ]}
          actions={(o) =>
            o.adminHold ? (
              <Button size="sm" variant="secondary" onClick={() => release.mutate(o.id)} aria-label={`Release ${o.flightNumber}`}>
                Release
              </Button>
            ) : o.status === 'withdrawn' || o.status === 'expired' ? null : (
              <Button size="sm" variant="ghost" onClick={() => setHolding(o)} aria-label={`Hold ${o.flightNumber}`}>
                Hold
              </Button>
            )
          }
        />
      )}
      <ReasonDialog
        open={!!holding}
        onClose={() => setHolding(null)}
        title={`Take ${holding?.flightNumber ?? ''} off sale?`}
        description="Travellers can no longer book this fare. Existing bookings are not affected. Partners see your reason."
        confirmLabel="Put on hold"
        onSubmit={(reason) => hold.mutateAsync({ id: holding!.id, reason })}
      />
    </>
  );
}
