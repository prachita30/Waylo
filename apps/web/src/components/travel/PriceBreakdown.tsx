import { formatMoney } from '@waylo/shared';
import { cn } from '@/lib/cn';

export interface PriceLine {
  label: string;
  amountMinor: number;
  hint?: string;
  tone?: 'default' | 'saving' | 'muted';
}

/** Itemised price table used for flights, rides, receipts and refunds. Amounts are integer minor units. */
export function PriceBreakdown({
  lines,
  totalLabel = 'Total',
  totalMinor,
  currency = 'INR',
  note,
  className,
}: {
  lines: PriceLine[];
  totalLabel?: string;
  totalMinor: number;
  currency?: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl bg-surface-2 p-4', className)}>
      <dl className="space-y-2 text-sm">
        {lines.map((l) => (
          <div key={l.label} className="flex items-start justify-between gap-4">
            <dt className={cn(l.tone === 'muted' ? 'text-ink-3' : 'text-ink-2')}>
              {l.label}
              {l.hint && <span className="block text-xs text-ink-3">{l.hint}</span>}
            </dt>
            <dd className={cn('t-price shrink-0 font-semibold', l.tone === 'saving' && 'text-mint', l.tone === 'muted' && 'text-ink-3')}>
              {l.tone === 'saving' ? '−' : ''}
              {formatMoney(Math.abs(l.amountMinor), currency)}
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-line pt-3">
          <dt className="font-semibold">{totalLabel}</dt>
          <dd className="t-price text-xl">{formatMoney(totalMinor, currency)}</dd>
        </div>
      </dl>
      {note && <p className="mt-3 text-xs text-ink-3">{note}</p>}
    </div>
  );
}
