import { formatMoney } from '@waylo/shared';
import { Briefcase, ChevronDown, Clock, CornerDownRight, MapPin, Users } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { AvatarStack } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/dates';
import { km, mins, type MatchOption, VEHICLE_LABEL, type VehicleFareBreakdown } from '@/lib/rides';
import { PriceBreakdown } from './PriceBreakdown';

export function CapacityMeter({ label, used, total, icon }: { label: string; used: number; total: number; icon: ReactNode }) {
  const pct = Math.min(100, Math.round((used / total) * 100));
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between text-xs text-ink-3">
        <span className="flex items-center gap-1">
          {icon} {label}
        </span>
        <span className="font-semibold text-ink-2 tabular-nums">
          {used}/{total}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={total}>
        <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-coral' : 'bg-mint')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function vehicleFareLines(f: VehicleFareBreakdown) {
  return [
    { label: 'Base fare', amountMinor: f.baseMinor },
    { label: 'Distance', amountMinor: f.distanceMinor },
    { label: 'Time', amountMinor: f.timeMinor },
    ...(f.extraStopsMinor ? [{ label: 'Extra drop-offs', amountMinor: f.extraStopsMinor }] : []),
    { label: 'Airport pickup access', amountMinor: f.airportAccessMinor },
    { label: 'Tolls (estimated)', amountMinor: f.tollsMinor },
  ];
}

/** One way to get home: an existing group to join, or a new group to start. */
export function RideMatchCard({ option, action, highlight }: { option: MatchOption; action: ReactNode; highlight?: boolean }) {
  const [open, setOpen] = useState(false);
  const isNew = option.members.length === 0;
  const p = option.you.price;
  return (
    <article className={cn('rounded-card border bg-surface p-4 shadow-card sm:p-5', highlight ? 'border-mint' : 'border-line')} aria-label={isNew ? 'Start a new group' : `Group of ${option.members.length + 1}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {isNew ? (
            <span className="grid size-10 place-items-center rounded-full bg-lavender text-primary">
              <Users className="size-5" aria-hidden />
            </span>
          ) : (
            <AvatarStack people={option.members.map((m) => ({ name: m.firstName, src: m.avatarUrl }))} size="md" />
          )}
          <div>
            <p className="font-semibold">{isNew ? 'Start a new group' : option.members.map((m) => `${m.firstName} · ${m.area}`).join(', ')}</p>
            <p className="text-xs text-ink-3">
              {VEHICLE_LABEL[option.vehicleClass]} · pickup about {formatTime(option.plannedPickupAt)} (estimate)
            </p>
          </div>
        </div>
        <div className="text-right">
          {option.you.savingsPercent > 0 && <Badge tone="mint">Save {option.you.savingsPercent}%</Badge>}
          <p className="t-price mt-1 text-2xl">{formatMoney(p.totalMinor)}</p>
          {option.you.savingsPercent > 0 ? (
            <p className="text-xs text-ink-3">
              vs <span className="line-through">{formatMoney(option.you.solo.totalMinor)}</span> alone
            </p>
          ) : (
            <p className="text-xs text-ink-3">drops as riders join</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-4">
        <CapacityMeter label="Seats" used={option.seatsUsed} total={option.capacity.seats} icon={<Users className="size-3.5" aria-hidden />} />
        <CapacityMeter label="Luggage" used={option.luggageUsed} total={option.capacity.luggageUnits} icon={<Briefcase className="size-3.5" aria-hidden />} />
      </div>

      <ol className="mt-4 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Drop-off order">
        <li className="flex items-center gap-1 rounded-full bg-sky px-2.5 py-1 font-semibold">
          <MapPin className="size-3" aria-hidden /> Airport
        </li>
        {option.route.map((s) => (
          <li key={s.order} className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold', s.isMe ? 'bg-primary text-primary-ink' : 'bg-surface-2 text-ink-2')}>
            <CornerDownRight className="size-3" aria-hidden /> {s.area}
          </li>
        ))}
      </ol>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-xl bg-surface-2 p-2">
          <dt className="text-ink-3">Your wait</dt>
          <dd className="font-semibold">{option.you.waitMinutes} min</dd>
        </div>
        <div className="rounded-xl bg-surface-2 p-2">
          <dt className="text-ink-3">Extra time</dt>
          <dd className="font-semibold">+{option.you.detourMinutes} min</dd>
        </div>
        <div className="rounded-xl bg-surface-2 p-2">
          <dt className="text-ink-3">Drop-off</dt>
          <dd className="font-semibold">~{formatTime(option.you.dropoffAt)}</dd>
        </div>
      </dl>

      <button type="button" className="mt-3 flex items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} aria-hidden /> Price breakdown
      </button>
      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <PriceBreakdown
            lines={[
              { label: `Your share of vehicle fare (${option.splitMethod === 'equal_per_seat' ? 'equal per seat' : 'by distance'})`, amountMinor: p.fareShareMinor },
              { label: 'WAYLO service fee', amountMinor: p.platformFeeMinor },
              { label: 'Taxes', amountMinor: p.taxMinor },
            ]}
            totalLabel="You pay"
            totalMinor={p.totalMinor}
          />
          <PriceBreakdown
            lines={vehicleFareLines(option.vehicleFare)}
            totalLabel="Whole vehicle"
            totalMinor={option.vehicleFare.totalMinor}
            note={`Route about ${km(option.routeDistanceMeters)}, ${mins(option.routeDurationSeconds)}. Estimates; tolls and parking per tariff.`}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="flex items-center gap-1 text-xs text-ink-3">
          <Clock className="size-3.5" aria-hidden /> {option.lockAt ? `Group locks ${formatTime(option.lockAt)}` : 'Others matching your trip can join'}
        </p>
        {action}
      </div>
    </article>
  );
}
