import { formatMoney } from '@waylo/shared';
import { IndianRupee, Plus, RotateCcw, Tags, Ticket } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/layout/PortalLayout';
import { StatusBadge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Card';
import { DataTable, MetricCard } from '@/components/ui/DataTable';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { formatDateTime } from '@/lib/dates';
import { usePartner, usePartnerOffers, usePartnerStats } from '@/lib/partner';

export default function Overview() {
  const { data: partner } = usePartner();
  const stats = usePartnerStats();
  const offers = usePartnerOffers();
  if (stats.isPending) return <SkeletonList />;
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => stats.refetch()} />;
  const s = stats.data;
  const live = (offers.data ?? []).filter((o) => o.status === 'published').slice(0, 6);
  return (
    <>
      <PageHeader
        title={partner?.name ?? 'Overview'}
        description={partner?.authorisedAirlines.length ? `Authorised to sell: ${partner.authorisedAirlines.join(', ')}` : 'No airlines authorised yet.'}
        actions={
          partner?.status === 'approved' && (
            <Link to="/partner/offers/new" className={buttonClass('primary', 'md')}>
              <Plus className="size-4" aria-hidden /> New offer
            </Link>
          )
        }
      />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Live offers" value={s.published} hint={`${s.offers} offers in total`} icon={<Tags className="size-4" aria-hidden />} tone="primary" />
        <MetricCard label="Confirmed bookings" value={s.confirmed} hint={`${s.seatsSold} seats ticketed`} icon={<Ticket className="size-4" aria-hidden />} tone="mint" />
        <MetricCard label="Gross booking value" value={formatMoney(s.grossBookingValueMinor)} hint="Confirmed and later-cancelled bookings" icon={<IndianRupee className="size-4" aria-hidden />} />
        <MetricCard label="Refunded" value={formatMoney(s.refundedMinor)} hint={`${s.cancelled} cancellations`} icon={<RotateCcw className="size-4" aria-hidden />} tone="coral" />
      </div>
      {s.ticketingFailed > 0 && (
        <Notice tone="danger" title="Ticketing failures" className="mb-8">
          {s.ticketingFailed} booking{s.ticketingFailed === 1 ? '' : 's'} on your fares could not be ticketed. WAYLO refunds those travellers in full; please check your inventory and schedule.
        </Notice>
      )}
      <SectionHeader title="Live offers" action={<Link to="/partner/offers" className="text-sm font-semibold text-primary hover:underline">All offers</Link>} />
      <DataTable
        caption="Live offers"
        rows={live}
        rowKey={(o) => o.id}
        empty="No offers are on sale right now"
        columns={[
          { key: 'flight', header: 'Flight', cell: (o) => <span className="font-semibold">{o.flightNumber}</span> },
          { key: 'route', header: 'Route', cell: (o) => `${o.origin} → ${o.destination}` },
          { key: 'depart', header: 'Departs', cell: (o) => formatDateTime(o.departAt) },
          { key: 'fare', header: 'Fare', cell: (o) => <span className="t-price">{formatMoney(o.fareMinor)}</span> },
          { key: 'sold', header: 'Sold', cell: (o) => `${o.seatsSold}${o.inventoryCap ? ` / ${o.inventoryCap}` : ''}` },
          { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} />, hideOnMobile: true },
        ]}
      />
    </>
  );
}
