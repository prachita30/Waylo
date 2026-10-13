import { formatMoney } from '@waylo/shared';
import { ArrowLeft, Briefcase, CircleAlert, Luggage, RotateCcw, ShieldCheck } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { RouteLine } from '@/components/brand/Route';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { AirlineMark, OfferExpiry } from '@/components/travel/FlightCard';
import { PriceBreakdown } from '@/components/travel/PriceBreakdown';
import { formatDate, formatDuration, formatTime } from '@/lib/dates';
import { isApiError } from '@/lib/api';
import { availabilityLabel, CABIN_LABEL, isBookable, useOffer } from '@/lib/flights';

export default function OfferDetail() {
  const { offerId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const adults = Math.min(9, Math.max(1, Number(params.get('adults') ?? 1)));
  const { data: offer, isPending, error, refetch } = useOffer(offerId, adults);

  if (isPending) return <div className="container-page max-w-3xl py-10"><SkeletonList count={3} /></div>;
  if (error) {
    return (
      <div className="container-page max-w-3xl py-10">
        <ErrorState title={isApiError(error, 'not_found') ? 'This offer is no longer available' : 'We could not load this offer'} error={error} onRetry={isApiError(error, 'not_found') ? undefined : () => refetch()} />
      </div>
    );
  }

  const tzFrom = offer.originAirport.timezone;
  const tzTo = offer.destinationAirport.timezone;
  const bookable = isBookable(offer);
  const fees = (m: number | null) => (m === null ? 'Not permitted' : m === 0 ? 'Free' : formatMoney(m));

  return (
    <div className="container-page max-w-5xl py-6 sm:py-10">
      <button type="button" onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Back to results
      </button>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardSection>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AirlineMark airline={offer.airline} />
                  <div>
                    <h1 className="text-lg font-bold">
                      {offer.originAirport.city} to {offer.destinationAirport.city}
                    </h1>
                    <p className="text-sm text-ink-3">
                      {offer.airline.name} {offer.flightNumber} · {CABIN_LABEL[offer.cabin]} · {formatDate(offer.departAt, tzFrom)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {offer.sandbox && <Badge tone="coral">Sandbox offer</Badge>}
                  {offer.source === 'partner' && <Badge tone="lavender">Partner offer</Badge>}
                </div>
              </div>
              <RouteLine
                className="mt-6"
                from={offer.origin}
                to={offer.destination}
                fromLabel={formatTime(offer.departAt, tzFrom)}
                toLabel={formatTime(offer.arriveAt, tzTo)}
                middle={`${formatDuration(offer.durationMinutes)} · Non-stop`}
              />
              <div className="mt-2 flex justify-between text-xs text-ink-3">
                <span className="max-w-[45%]">{offer.originAirport.name}</span>
                <span className="max-w-[45%] text-right">{offer.destinationAirport.name}</span>
              </div>
              <p className="mt-4 text-xs text-ink-3">Times are local to each airport.</p>
            </CardSection>
          </Card>

          <Card>
            <CardSection>
              <h2 className="t-section">Baggage & fare conditions</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Fact icon={<Briefcase className="size-4" aria-hidden />} label="Cabin bag" value={`${offer.baggage.cabinKg} kg`} />
                <Fact icon={<Luggage className="size-4" aria-hidden />} label="Checked bag" value={offer.baggage.checkedKg ? `${offer.baggage.checkedKg} kg` : 'Not included'} />
                <Fact icon={<RotateCcw className="size-4" aria-hidden />} label="Refundable" value={offer.conditions.refundable ? 'Yes' : 'No'} />
              </div>
              <dl className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
                <div className="flex justify-between rounded-xl bg-surface-2 px-3 py-2">
                  <dt className="text-ink-2">Change fee</dt>
                  <dd className="font-semibold">{fees(offer.conditions.changeFeeMinor)}</dd>
                </div>
                <div className="flex justify-between rounded-xl bg-surface-2 px-3 py-2">
                  <dt className="text-ink-2">Cancellation fee</dt>
                  <dd className="font-semibold">{offer.conditions.refundable ? fees(offer.conditions.cancelFeeMinor) : 'Non-refundable'}</dd>
                </div>
              </dl>
              <h3 className="mt-5 text-sm font-semibold">Fare rules from the airline</h3>
              <p className="t-body mt-1 text-sm">{offer.conditions.rules}</p>
              {offer.eligibility.notes && <Notice tone="info" className="mt-4">{offer.eligibility.notes}</Notice>}
            </CardSection>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardSection className="space-y-4">
              <PriceBreakdown
                lines={[
                  { label: `Base fare × ${adults}`, amountMinor: (offer.farePerAdultMinor - offer.taxesPerAdultMinor) * adults },
                  { label: `Taxes & airport fees × ${adults}`, amountMinor: offer.taxesPerAdultMinor * adults },
                ]}
                totalMinor={offer.totalMinor}
                note="The price is re-confirmed with the airline before you pay."
              />
              {offer.saving && (
                <div className="rounded-2xl bg-mint-soft p-3 text-sm">
                  <p className="font-semibold text-mint">
                    {formatMoney(offer.saving.amountMinor * adults)} less than the regular fare
                  </p>
                  <p className="mt-0.5 text-xs text-ink-2">
                    Regular fare {formatMoney(offer.saving.referenceFareMinor)} per adult. Source: {offer.saving.source}.
                  </p>
                </div>
              )}
              <OfferExpiry expiresAt={offer.expiresAt} />
              {bookable ? (
                <Button asChild block size="lg">
                  <Link to={`/flights/offers/${offer.id}/book?adults=${adults}`}>Continue to passenger details</Link>
                </Button>
              ) : (
                <Notice tone="warning" title={availabilityLabel(offer)}>
                  {offer.availability === 'insufficient' ? 'Try fewer travellers or another flight.' : 'Please choose another flight.'}
                </Notice>
              )}
              <p className="flex items-start gap-2 text-xs text-ink-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden />
                Your booking is confirmed only after the airline issues a ticket.
              </p>
              {offer.sandbox && (
                <p className="flex items-start gap-2 text-xs text-coral">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Sandbox airline. Bookings are simulated and no real ticket is issued.
                </p>
              )}
            </CardSection>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-3">
        {icon} {label}
      </p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
