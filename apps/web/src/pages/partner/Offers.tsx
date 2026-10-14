import { formatMoney } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/layout/PortalLayout';
import { StatusBadge } from '@/components/ui/Badge';
import { Button, buttonClass } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Input, Segmented } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { CABIN_LABEL, type OfferStatus, type PartnerOffer, rupeesToPaise, usePartner, usePartnerOffers } from '@/lib/partner';

type Filter = 'live' | 'drafts' | 'closed' | 'all';
const FILTERS: Record<Filter, OfferStatus[]> = {
  live: ['published', 'paused'],
  drafts: ['draft'],
  closed: ['expired', 'withdrawn'],
  all: ['draft', 'published', 'paused', 'expired', 'withdrawn'],
};

export default function Offers() {
  const qc = useQueryClient();
  const { data: partner } = usePartner();
  const q = usePartnerOffers();
  const [filter, setFilter] = useState<Filter>('live');
  const [withdrawing, setWithdrawing] = useState<PartnerOffer | null>(null);
  const [editing, setEditing] = useState<PartnerOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'published' | 'paused' | 'withdrawn' }) => api.post(`/partner/offers/${id}/status`, { status }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['partner-offers'] });
      qc.invalidateQueries({ queryKey: ['partner-stats'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not update the offer.'),
  });
  const approved = partner?.status === 'approved';

  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data.filter((o) => FILTERS[filter].includes(o.status));

  return (
    <>
      <PageHeader
        title="Offers"
        description="Fares you publish appear in WAYLO search within their sale window. Changes apply to new bookings only."
        actions={
          approved && (
            <Link to="/partner/offers/new" className={buttonClass('primary', 'md')}>
              <Plus className="size-4" aria-hidden /> New offer
            </Link>
          )
        }
      />
      <Segmented
        label="Show"
        className="mb-6 max-w-md"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'live', label: 'On sale' },
          { value: 'drafts', label: 'Drafts' },
          { value: 'closed', label: 'Closed' },
          { value: 'all', label: 'All' },
        ]}
      />
      {error && (
        <Notice tone="danger" className="mb-4">
          {error}
        </Notice>
      )}
      <DataTable
        caption="Offers"
        rows={rows}
        rowKey={(o) => o.id}
        empty={filter === 'drafts' ? 'No drafts' : 'No offers here yet'}
        columns={[
          { key: 'flight', header: 'Flight', cell: (o) => <span className="font-semibold">{o.flightNumber}</span> },
          { key: 'route', header: 'Route', cell: (o) => `${o.origin} → ${o.destination}` },
          { key: 'depart', header: 'Departs', cell: (o) => formatDateTime(o.departAt) },
          { key: 'cabin', header: 'Cabin', cell: (o) => CABIN_LABEL[o.cabin], hideOnMobile: true },
          { key: 'fare', header: 'Fare', cell: (o) => <span className="t-price">{formatMoney(o.fareMinor)}</span> },
          { key: 'sold', header: 'Sold', cell: (o) => `${o.seatsSold}${o.inventoryCap ? ` / ${o.inventoryCap}` : ''}` },
          { key: 'until', header: 'On sale until', cell: (o) => formatDateTime(o.validUntil), hideOnMobile: true },
          { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
        ]}
        actions={(o) =>
          approved && !['expired', 'withdrawn'].includes(o.status) ? (
            <div className="flex flex-wrap gap-2">
              {o.status !== 'published' && (
                <Button size="sm" onClick={() => setStatus.mutate({ id: o.id, status: 'published' })} aria-label={`Publish ${o.flightNumber}`}>
                  {o.status === 'paused' ? 'Resume' : 'Publish'}
                </Button>
              )}
              {o.status === 'published' && (
                <Button size="sm" variant="secondary" onClick={() => setStatus.mutate({ id: o.id, status: 'paused' })} aria-label={`Pause ${o.flightNumber}`}>
                  Pause
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => setEditing(o)} aria-label={`Edit ${o.flightNumber}`}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setWithdrawing(o)} aria-label={`Withdraw ${o.flightNumber}`}>
                Withdraw
              </Button>
            </div>
          ) : null
        }
      />
      <ConfirmDialog
        open={!!withdrawing}
        onOpenChange={(o) => !o && setWithdrawing(null)}
        title="Withdraw this offer?"
        description="It is removed from sale permanently. Bookings already made on it are not affected."
        confirmLabel="Withdraw offer"
        tone="danger"
        onConfirm={async () => {
          await setStatus.mutateAsync({ id: withdrawing!.id, status: 'withdrawn' });
          setWithdrawing(null);
        }}
      />
      {editing && <EditOffer offer={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EditOffer({ offer, onClose }: { offer: PartnerOffer; onClose: () => void }) {
  const qc = useQueryClient();
  const [fare, setFare] = useState(String(offer.fareMinor / 100));
  const [cap, setCap] = useState(String(offer.inventoryCap ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (v: { fareMinor: number; inventoryCap: number }) => api.patch(`/partner/offers/${offer.id}`, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-offers'] });
      onClose();
    },
    onError: (e) => setErrors({ form: e instanceof ApiError ? e.message : 'Could not save changes.' }),
  });
  const submit = () => {
    const fareMinor = rupeesToPaise(fare);
    const inventoryCap = Number(cap);
    const next: Record<string, string> = {};
    if (!fareMinor) next.fare = 'Enter a fare in rupees.';
    if (!Number.isInteger(inventoryCap) || inventoryCap < 1) next.cap = 'Enter a whole number of seats.';
    else if (inventoryCap < offer.seatsSold) next.cap = `${offer.seatsSold} seats are already sold.`;
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate({ fareMinor: fareMinor!, inventoryCap });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit ${offer.flightNumber}`}
      description="New bookings use the updated fare and seat cap. Existing bookings keep what they paid."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="All-inclusive fare per adult (₹)" inputMode="decimal" value={fare} onChange={(e) => setFare(e.target.value)} error={errors.fare} />
        <Input label="Seats WAYLO may sell" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} error={errors.cap} hint={`${offer.seatsSold} sold so far`} />
        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
      </div>
    </Dialog>
  );
}
