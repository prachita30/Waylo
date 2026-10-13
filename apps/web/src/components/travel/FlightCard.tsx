import { formatMoney } from '@waylo/shared';
import { Briefcase, Clock, Luggage, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { RouteLine } from '@/components/brand/Route';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { formatDuration, formatTime, relativeTime } from '@/lib/dates';
import { availabilityLabel, CABIN_LABEL, isBookable, type Offer } from '@/lib/flights';

export function AirlineMark({ airline, size = 'md' }: { airline: Offer['airline']; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-xl font-mono font-bold text-white', size === 'sm' ? 'size-8 text-[0.7rem]' : 'size-10 text-xs')}
      style={{ background: airline.color }}
      aria-hidden
    >
      {airline.code}
    </span>
  );
}

/** Re-renders periodically so countdowns stay honest. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function OfferExpiry({ expiresAt, className }: { expiresAt: string; className?: string }) {
  const now = useNow();
  const ms = new Date(expiresAt).getTime() - now;
  const soon = ms < 3 * 3_600_000;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', soon ? 'text-coral' : 'text-ink-3', className)}>
      <Clock className="size-3.5" aria-hidden />
      {ms <= 0 ? 'Offer expired' : `Offer ends ${relativeTime(expiresAt, now)}`}
    </span>
  );
}

export function FlightCard({ offer, adults, timeZone, href }: { offer: Offer; adults: number; timeZone: string; href: string }) {
  const bookable = isBookable(offer);
  return (
    <article
      className={cn('rounded-card border border-line bg-surface p-4 shadow-card transition sm:p-5', bookable ? 'hover:border-ink-3/40' : 'opacity-70')}
      aria-label={`${offer.airline.name} ${offer.flightNumber}, ${formatTime(offer.departAt, timeZone)} to ${formatTime(offer.arriveAt, timeZone)}, ${formatMoney(offer.farePerAdultMinor)} per adult`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AirlineMark airline={offer.airline} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{offer.airline.name}</p>
            <p className="text-xs text-ink-3">
              {offer.flightNumber} · {CABIN_LABEL[offer.cabin]}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {offer.sandbox && <Badge tone="coral">Sandbox</Badge>}
          {offer.saving && <Badge tone="mint">Save {offer.saving.percent}%</Badge>}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <RouteLine
            from={offer.origin}
            to={offer.destination}
            fromLabel={formatTime(offer.departAt, timeZone)}
            toLabel={formatTime(offer.arriveAt, timeZone)}
            middle={`${formatDuration(offer.durationMinutes)} · Non-stop`}
          />
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            <li className="flex items-center gap-1">
              <Briefcase className="size-3.5" aria-hidden /> Cabin {offer.baggage.cabinKg} kg
            </li>
            <li className="flex items-center gap-1">
              <Luggage className="size-3.5" aria-hidden /> {offer.baggage.checkedKg ? `Checked ${offer.baggage.checkedKg} kg` : 'No checked bag'}
            </li>
            <li className="flex items-center gap-1">
              <RotateCcw className="size-3.5" aria-hidden /> {offer.conditions.refundable ? 'Refundable' : 'Non-refundable'}
            </li>
          </ul>
        </div>
        <div className="flex items-end justify-between gap-4 border-t border-line pt-3 sm:block sm:border-0 sm:pt-0 sm:text-right">
          <div>
            {offer.saving && (
              <p className="text-xs text-ink-3 line-through" aria-label={`Regular fare ${formatMoney(offer.saving.referenceFareMinor)}`}>
                {formatMoney(offer.saving.referenceFareMinor)}
              </p>
            )}
            <p className="t-price text-2xl">{formatMoney(offer.farePerAdultMinor)}</p>
            <p className="text-xs text-ink-3">{adults > 1 ? `per adult · ${formatMoney(offer.totalMinor)} total` : 'per adult, incl. taxes'}</p>
          </div>
          {bookable ? (
            <Link to={href} className={cn(buttonClass('primary', 'sm'), 'mt-2')}>
              Select
            </Link>
          ) : (
            <span className="mt-2 inline-block text-sm font-semibold text-ink-3">{availabilityLabel(offer)}</span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <OfferExpiry expiresAt={offer.expiresAt} />
        {offer.availability === 'limited' && <span className="text-xs font-semibold text-coral">{availabilityLabel(offer)}</span>}
      </div>
    </article>
  );
}
