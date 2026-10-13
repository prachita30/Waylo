import { Check, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface TimelineStep {
  label: string;
  detail?: string;
  state: 'done' | 'current' | 'pending' | 'failed';
}

/** Vertical status timeline shared by flight bookings and rides. */
export function BookingTimeline({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  return (
    <ol className={cn('relative space-y-5', className)}>
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex gap-3">
          {i < steps.length - 1 && (
            <span aria-hidden className={cn('absolute top-7 left-[13px] h-[calc(100%-4px)] w-0.5', s.state === 'done' ? 'bg-mint' : 'bg-line')} />
          )}
          <span
            className={cn(
              'relative z-10 grid size-7 shrink-0 place-items-center rounded-full border-2',
              s.state === 'done' && 'border-mint bg-mint text-white',
              s.state === 'current' && 'border-primary bg-primary-soft text-primary',
              s.state === 'pending' && 'border-line bg-surface text-ink-3',
              s.state === 'failed' && 'border-danger bg-danger text-white',
            )}
            aria-hidden
          >
            {s.state === 'done' ? <Check className="size-4" /> : s.state === 'failed' ? <X className="size-4" /> : s.state === 'current' ? <Loader2 className="size-4 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
          </span>
          <div className="pt-0.5">
            <p className={cn('text-sm font-semibold', s.state === 'pending' && 'text-ink-3')}>
              {s.label}
              <span className="sr-only"> ({s.state})</span>
            </p>
            {s.detail && <p className="text-xs text-ink-3">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
