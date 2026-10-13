import { formatMoney } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, LifeBuoy, Ticket } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { RouteLine } from '@/components/brand/Route';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { BookingTimeline, type TimelineStep } from '@/components/travel/BookingTimeline';
import { AirlineMark, useNow } from '@/components/travel/FlightCard';
import { PriceBreakdown } from '@/components/travel/PriceBreakdown';
import { api, isApiError } from '@/lib/api';
import { type Booking, goToCheckout, useBooking } from '@/lib/bookings';
import { formatDate, formatDateTime, formatDuration, formatTime, relativeTime } from '@/lib/dates';
import { CABIN_LABEL } from '@/lib/flights';

export function timelineFor(b: Booking): TimelineStep[] {
  const paid = b.payment?.status === 'succeeded' || ['ticketing', 'confirmed', 'ticketing_failed', 'cancelled'].includes(b.status);
  const steps: TimelineStep[] = [{ label: 'Booking created', detail: formatDateTime(b.createdAt), state: 'done' }];
  if (b.status === 'expired' && !paid) {
    steps.push({ label: 'Payment not completed', detail: 'The payment window closed and the seats were released.', state: 'failed' });
    return steps;
  }
  steps.push(
    b.status === 'payment_failed'
      ? { label: 'Payment declined', detail: b.payment?.failureReason ?? undefined, state: 'failed' }
      : { label: 'Payment', detail: paid ? 'Received' : 'Waiting for payment', state: paid ? 'done' : 'current' },
  );
  if (b.status === 'ticketing_failed') {
    steps.push({ label: 'Ticket not issued', detail: b.failureReason ?? undefined, state: 'failed' });
    return steps;
  }
  steps.push({
    label: 'Airline issues ticket',
    detail: b.ticketedAt ? formatDateTime(b.ticketedAt) : b.status === 'ticketing' ? 'Waiting for the airline' : undefined,
    state: b.ticketedAt ? 'done' : b.status === 'ticketing' ? 'current' : 'pending',
  });
  if (b.status === 'cancelled') steps.push({ label: 'Cancelled', detail: b.cancelledAt ? formatDateTime(b.cancelledAt) : undefined, state: 'failed' });
  else steps.push({ label: 'Confirmed', detail: b.pnr ? `Airline reference ${b.pnr}` : undefined, state: b.status === 'confirmed' ? 'done' : 'pending' });
  return steps;
}

export default function FlightBookingDetail() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isPending, error, refetch } = useBooking(bookingId);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const now = useNow(1000);
  const pay = useMutation({
    mutationFn: () => api.post<{ checkoutUrl: string | null }>(`/flights/bookings/${bookingId}/pay`),
    onSuccess: (r) => r.checkoutUrl && goToCheckout(r.checkoutUrl, navigate),
  });

  if (isPending) return <div className="container-page max-w-4xl py-10"><SkeletonList count={3} /></div>;
  if (error) return <div className="container-page max-w-4xl py-10"><ErrorState title={isApiError(error, 'not_found') ? 'Booking not found' : 'We could not load this booking'} error={error} onRetry={() => refetch()} /></div>;

  const { booking: b, cancellation } = data;
  const it = b.itinerary;
  const tz = it.originAirport?.timezone ?? 'Asia/Kolkata';
  const payable = (b.status === 'pending_payment' || b.status === 'payment_failed') && new Date(b.paymentDueAt).getTime() > now;

  return (
    <div className="container-page max-w-4xl py-6 sm:py-10">
      <Link to="/trips" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> My trips
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="t-meta">Booking {b.reference}</p>
          <h1 className="t-title mt-1">
            {it.originAirport?.city ?? it.origin} to {it.destinationAirport?.city ?? it.destination}
          </h1>
          <p className="text-sm text-ink-3">{formatDate(it.departAt, tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex gap-2">
          {it.sandbox && <Badge tone="coral">Sandbox</Badge>}
          <StatusBadge status={b.status} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {b.status === 'ticketing' && (
            <Notice tone="info" title="Waiting for the airline to issue your ticket">
              Your payment is received. This page updates automatically. Your booking is not confirmed until the ticket is issued.
            </Notice>
          )}
          {b.status === 'ticketing_failed' && (
            <Notice tone="danger" title="The airline could not issue your ticket">
              {b.failureReason} A full refund of {formatMoney(b.refundDueMinor ?? b.totalMinor)} is being returned to your original payment method.
            </Notice>
          )}
          {payable && (
            <Notice tone={b.status === 'payment_failed' ? 'danger' : 'warning'} title={b.status === 'payment_failed' ? 'Payment declined' : 'Payment pending'}>
              <p>Complete payment {relativeTime(b.paymentDueAt, now)} to keep these seats.</p>
              <Button size="sm" className="mt-2" loading={pay.isPending} onClick={() => pay.mutate()}>
                {b.status === 'payment_failed' ? 'Try payment again' : 'Complete payment'}
              </Button>
            </Notice>
          )}
          {b.status === 'expired' && <Notice tone="warning" title="Booking expired">{b.failureReason ?? 'Payment was not completed in time.'} You were not charged.</Notice>}
          {b.status === 'cancelled' && (
            <Notice tone="info" title="Booking cancelled">
              {b.refundDueMinor ? `A refund of ${formatMoney(b.refundDueMinor)} is being processed to your original payment method.` : 'This fare had no refundable amount.'}
            </Notice>
          )}

          <Card>
            <CardSection>
              <div className="flex items-center gap-3">
                <AirlineMark airline={it.airline} />
                <div>
                  <p className="font-semibold">
                    {it.airline.name} {it.flightNumber}
                  </p>
                  <p className="text-sm text-ink-3">
                    {CABIN_LABEL[it.cabin]} · {formatDuration(it.durationMinutes)} · Non-stop
                  </p>
                </div>
              </div>
              <RouteLine className="mt-5" from={it.origin} to={it.destination} fromLabel={formatTime(it.departAt, tz)} toLabel={formatTime(it.arriveAt, it.destinationAirport?.timezone ?? tz)} />
              {b.pnr && (
                <div className="mt-5 flex items-center justify-between rounded-2xl bg-mint-soft p-4">
                  <div>
                    <p className="t-meta">Airline booking reference (PNR)</p>
                    <p className="font-mono text-2xl font-bold tracking-[0.2em]">{b.pnr}</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(b.pnr!);
                      setCopied(true);
                    }}
                  >
                    <Copy className="size-4" aria-hidden /> {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              )}
            </CardSection>
          </Card>

          <Card>
            <CardSection>
              <h2 className="t-section">Travellers</h2>
              <ul className="mt-3 divide-y divide-line">
                {b.passengers.map((p, i) => (
                  <li key={i} className="flex items-center justify-between py-3 text-sm">
                    <span className="font-semibold">
                      {p.firstName} {p.lastName}
                    </span>
                    <span className="flex items-center gap-1.5 text-ink-3">
                      <Ticket className="size-4" aria-hidden /> {p.ticketNumber ?? 'Ticket pending'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-3">
                Baggage: cabin {it.baggage.cabinKg} kg · {it.baggage.checkedKg ? `checked ${it.baggage.checkedKg} kg` : 'no checked bag'}. {it.conditions.rules}
              </p>
            </CardSection>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardSection>
              <h2 className="mb-4 font-semibold">Status</h2>
              <BookingTimeline steps={timelineFor(b)} />
            </CardSection>
          </Card>
          <Card>
            <CardSection className="space-y-4">
              <PriceBreakdown
                lines={[
                  { label: `Fare × ${b.adults}`, amountMinor: (it.farePerAdultMinor - it.taxesPerAdultMinor) * b.adults },
                  { label: `Taxes & fees × ${b.adults}`, amountMinor: it.taxesPerAdultMinor * b.adults },
                ]}
                totalLabel={b.payment?.status === 'succeeded' ? 'Paid' : 'Total'}
                totalMinor={b.totalMinor}
              />
              {cancellation.cancellable ? (
                <Button variant="secondary" block onClick={() => setCancelOpen(true)}>
                  Cancel booking
                </Button>
              ) : (
                b.status === 'confirmed' && <p className="text-xs text-ink-3">{cancellation.reason}</p>
              )}
              <Button asChild variant="ghost" block size="sm">
                <Link to={`/support/tickets?booking=${b.reference}`}>
                  <LifeBuoy className="size-4" aria-hidden /> Get help with this booking
                </Link>
              </Button>
            </CardSection>
          </Card>
        </aside>
      </div>

      {cancellation.cancellable && (
        <ConfirmDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title="Cancel this booking?"
          description={
            cancellation.refundMinor > 0
              ? `Under the fare rules you will be refunded ${formatMoney(cancellation.refundMinor)} of ${formatMoney(b.totalMinor)}. The airline confirms the final amount.`
              : 'This fare has no refundable amount.'
          }
          confirmLabel="Cancel booking"
          tone="danger"
          onConfirm={async () => {
            await api.post(`/flights/bookings/${b.id}/cancel`);
            await qc.invalidateQueries({ queryKey: ['booking', b.id] });
            await qc.invalidateQueries({ queryKey: ['bookings'] });
          }}
        />
      )}
    </div>
  );
}
