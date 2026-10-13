import { Plane } from 'lucide-react';
import { cn } from '@/lib/cn';

export function AirportChip({ code, className, tone = 'default' }: { code: string; className?: string; tone?: 'default' | 'inverse' }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center rounded-lg px-2 font-mono text-[0.8rem] font-bold tracking-[0.08em]',
        tone === 'inverse' ? 'bg-white/15 text-white backdrop-blur' : 'bg-sky text-ink',
        className,
      )}
    >
      {code}
    </span>
  );
}

/** Origin → destination line with a dashed path and plane glyph. */
export function RouteLine({
  from,
  to,
  fromLabel,
  toLabel,
  middle,
  animated,
  className,
}: {
  from: string;
  to: string;
  fromLabel?: string;
  toLabel?: string;
  middle?: string;
  animated?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="min-w-0 text-left">
        <div className="text-xl font-bold tracking-tight tabular-nums">{fromLabel ?? from}</div>
        {fromLabel && <div className="text-xs font-semibold text-ink-3">{from}</div>}
      </div>
      <div className="flex min-w-14 flex-1 flex-col items-center gap-1">
        {middle && <span className="text-[0.7rem] font-semibold whitespace-nowrap text-ink-3">{middle}</span>}
        <div className="flex w-full items-center gap-1.5 text-ink-3" aria-hidden>
          <span className="size-1.5 shrink-0 rounded-full bg-current" />
          <svg className="h-1 w-0 min-w-0 flex-1" preserveAspectRatio="none" viewBox="0 0 100 2">
            <line x1="0" y1="1" x2="100" y2="1" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" className={animated ? 'route-animated' : undefined} />
          </svg>
          <Plane className="size-4 shrink-0 rotate-45 text-ink" />
          <svg className="h-1 w-0 min-w-0 flex-1" preserveAspectRatio="none" viewBox="0 0 100 2">
            <line x1="0" y1="1" x2="100" y2="1" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" className={animated ? 'route-animated' : undefined} />
          </svg>
          <span className="size-1.5 shrink-0 rounded-full bg-mint" />
        </div>
      </div>
      <div className="min-w-0 text-right">
        <div className="text-xl font-bold tracking-tight tabular-nums">{toLabel ?? to}</div>
        {toLabel && <div className="text-xs font-semibold text-ink-3">{to}</div>}
      </div>
    </div>
  );
}
