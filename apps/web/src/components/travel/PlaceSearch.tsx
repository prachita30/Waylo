import { MapPin, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { type Place, usePlaceSearch } from '@/lib/rides';

/**
 * Destination combobox (WAI-ARIA combobox pattern). Text input is the accessible alternative to
 * picking a point on a map; results come from the server-side maps provider.
 */
export function PlaceSearch({
  airport,
  value,
  onChange,
  error,
}: {
  airport: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  error?: string;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = usePlaceSearch(q, airport);
  const items = results.data ?? [];

  const choose = (p: Place) => {
    onChange(p);
    setQ('');
    setOpen(false);
  };

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Going to</span>
        <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface px-3.5 py-3">
          <span className="flex min-w-0 items-center gap-2">
            <MapPin className="size-4 shrink-0 text-coral" aria-hidden />
            <span className="truncate text-[0.95rem]">{value.label}</span>
          </span>
          <button type="button" className="rounded-full p-1 text-ink-3 hover:text-ink" onClick={() => onChange(null)} aria-label="Change destination">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <p className="text-xs text-ink-3">Co-riders only see the area ({value.area}), never your exact address.</p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        Going to
      </label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          id={id}
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          autoComplete="off"
          placeholder="Area, landmark or neighbourhood"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && open && items[active]) {
              e.preventDefault();
              choose(items[active]!);
            } else if (e.key === 'Escape') setOpen(false);
          }}
          className={cn(
            'h-12 w-full rounded-control border border-line bg-surface pr-10 pl-10 text-[0.95rem] placeholder:text-ink-3 focus:border-primary focus:ring-3 focus:ring-primary/20 focus:outline-none',
            error && 'border-danger',
          )}
        />
        {results.isFetching && <Spinner className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-ink-3" />}
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {open && q.trim().length >= 2 && (
        <ul id={`${id}-list`} role="listbox" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-auto rounded-2xl border border-line bg-surface p-1 shadow-float">
          {results.isError ? (
            <li className="px-3 py-2.5 text-sm text-danger">Search is unavailable. Try again shortly.</li>
          ) : items.length === 0 && !results.isFetching ? (
            <li className="px-3 py-2.5 text-sm text-ink-3">No places found within the service area.</li>
          ) : (
            items.map((p, i) => (
              <li
                key={p.placeId}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn('flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-sm', i === active && 'bg-surface-2')}
              >
                <MapPin className="size-4 shrink-0 text-ink-3" aria-hidden /> {p.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
