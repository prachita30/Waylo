import { formatMoney } from '@waylo/shared';
import { PlaneTakeoff, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Select, Toggle } from '@/components/ui/Field';
import { EmptyState, ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { FlightCard } from '@/components/travel/FlightCard';
import { type Cabin, FlightSearchForm, flightSearchToParams } from '@/features/search/SearchPanel';
import { cn } from '@/lib/cn';
import { formatDate, HOME_TZ } from '@/lib/dates';
import { useFlightSearch } from '@/lib/flights';
import { useAirports } from '@/lib/meta';

const WINDOWS = [
  { id: 'early', label: 'Before 6am' },
  { id: 'morning', label: '6am–12pm' },
  { id: 'afternoon', label: '12–5pm' },
  { id: 'evening', label: '5–9pm' },
  { id: 'night', label: 'After 9pm' },
] as const;

export default function FlightResults() {
  const [params, setParams] = useSearchParams();
  const airports = useAirports();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const ready = !!(params.get('from') && params.get('to') && params.get('date'));
  const withFlex = new URLSearchParams(params);
  withFlex.set('flex', '1');
  const search = useFlightSearch(withFlex, ready);
  const adults = Number(params.get('adults') ?? 1);
  const tz = airports.data?.find((a) => a.code === params.get('from'))?.timezone ?? HOME_TZ;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    next.delete('page');
    setParams(next, { replace: false });
  };

  const windows = (params.get('windows') ?? '').split(',').filter(Boolean);
  const toggleWindow = (id: string) => {
    const set = new Set(windows);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    update({ windows: [...set].join(',') || null });
  };
  const activeFilters = windows.length + (params.get('maxPrice') ? 1 : 0) + (params.get('refundableOnly') ? 1 : 0);

  const filters = (
    <div className="space-y-6">
      <Select label="Sort by" value={params.get('sort') ?? 'price'} onChange={(e) => update({ sort: e.target.value })}>
        <option value="price">Lowest price</option>
        <option value="departure">Earliest departure</option>
        <option value="duration">Shortest duration</option>
      </Select>
      {search.data?.priceRange && (
        <BudgetFilter
          min={search.data.priceRange.minMinor}
          max={search.data.priceRange.maxMinor}
          value={params.get('maxPrice') ? Number(params.get('maxPrice')) : null}
          onChange={(v) => update({ maxPrice: v === null ? null : String(v) })}
        />
      )}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Departure time</legend>
        <div className="flex flex-wrap gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              aria-pressed={windows.includes(w.id)}
              onClick={() => toggleWindow(w.id)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                windows.includes(w.id) ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink-2 hover:text-ink',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </fieldset>
      <Toggle label="Refundable fares only" checked={params.get('refundableOnly') === '1'} onChange={(v) => update({ refundableOnly: v ? '1' : null })} />
      {activeFilters > 0 && (
        <Button variant="ghost" size="sm" onClick={() => update({ windows: null, maxPrice: null, refundableOnly: null })}>
          Clear filters
        </Button>
      )}
    </div>
  );

  return (
    <div className="container-page py-6 sm:py-10">
      <Card className="mb-6">
        <CardSection className="p-4 sm:p-5">
          <FlightSearchForm
            key={params.toString()}
            compact
            initial={{
              from: params.get('from') ?? 'BOM',
              to: params.get('to') ?? '',
              date: params.get('date') ?? undefined,
              adults,
              cabin: (params.get('cabin') as Cabin) ?? 'economy',
            }}
            onSearch={(v) => setParams(flightSearchToParams(v))}
          />
        </CardSection>
      </Card>

      {!ready ? (
        <EmptyState icon={<PlaneTakeoff className="size-6" aria-hidden />} title="Where would you like to fly?" body="Choose a destination and date to see airline-authorised offers." />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[17rem_1fr]">
          <aside className="hidden lg:block" aria-label="Filters">
            <div className="sticky top-24">{filters}</div>
          </aside>

          <section aria-labelledby="results-heading" aria-busy={search.isFetching}>
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h1 id="results-heading" className="t-section">
                  {search.data ? `${search.data.query.origin.city} to ${search.data.query.destination.city}` : 'Searching flights…'}
                </h1>
                <p className="text-sm text-ink-3">
                  {formatDate(`${params.get('date')}T12:00:00Z`, 'UTC')} · {adults} adult{adults > 1 ? 's' : ''}
                  {search.data && ` · ${search.data.total} offer${search.data.total === 1 ? '' : 's'}`}
                </p>
              </div>
              <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => setFiltersOpen(true)}>
                <SlidersHorizontal className="size-4" aria-hidden /> Filters{activeFilters ? ` (${activeFilters})` : ''}
              </Button>
            </div>

            {search.data?.flexibleDates && (
              <div className="-mx-4 mb-5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="group" aria-label="Flexible dates">
                <div className="flex gap-2">
                  {search.data.flexibleDates.map((d) => {
                    const active = d.date === params.get('date');
                    return (
                      <button
                        key={d.date}
                        type="button"
                        aria-pressed={active}
                        onClick={() => update({ date: d.date })}
                        className={cn(
                          'min-w-[6.5rem] shrink-0 rounded-2xl border px-3 py-2 text-left transition',
                          active ? 'border-ink bg-surface shadow-card' : 'border-line bg-surface/60 hover:border-ink-3/50',
                        )}
                      >
                        <span className="block text-xs font-semibold text-ink-3">{formatDate(`${d.date}T12:00:00Z`, 'UTC')}</span>
                        <span className={cn('t-price block text-sm', d.cheapestMinor === null ? 'text-ink-3' : 'text-ink')}>
                          {d.cheapestMinor === null ? '—' : formatMoney(d.cheapestMinor)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {search.data?.warnings.includes('airline_unavailable') && (
              <Notice tone="warning" title="Some airline offers could not be loaded" className="mb-4">
                We are showing offers we could confirm. Try again in a few minutes for the full list.
              </Notice>
            )}

            {search.isPending ? (
              <SkeletonList count={4} />
            ) : search.isError ? (
              <ErrorState title="We could not load offers" error={search.error} onRetry={() => search.refetch()} />
            ) : search.data.items.length === 0 ? (
              <EmptyState
                icon={<PlaneTakeoff className="size-6" aria-hidden />}
                title="No offers match"
                body={activeFilters ? 'Try removing a filter or choosing another date above.' : 'There are no published offers for this route and date. Try a nearby date above.'}
                action={activeFilters ? <Button variant="secondary" onClick={() => update({ windows: null, maxPrice: null, refundableOnly: null })}>Clear filters</Button> : undefined}
              />
            ) : (
              <div className={cn('space-y-3 transition-opacity', search.isPlaceholderData && 'opacity-60')}>
                {search.data.items.map((o) => (
                  <FlightCard key={o.id} offer={o} adults={adults} timeZone={tz} href={`/flights/offers/${o.id}?adults=${adults}`} />
                ))}
                {search.data.total > search.data.page * search.data.pageSize && (
                  <div className="pt-2 text-center">
                    <Button variant="secondary" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('page', String(search.data.page + 1)); return n; })}>
                      Next page
                    </Button>
                  </div>
                )}
                {search.data.page > 1 && (
                  <div className="text-center">
                    <Button variant="ghost" size="sm" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('page', String(search.data.page - 1)); return n; })}>
                      Previous page
                    </Button>
                  </div>
                )}
              </div>
            )}
            <p className="mt-6 text-xs text-ink-3">
              Prices are per adult and include taxes. Offers are published by airlines or their authorised partners and are re-confirmed before payment. “Save” badges
              compare against the airline’s published regular fare for the same flight.
            </p>
          </section>
        </div>
      )}

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen} title="Filters & sorting" footer={<Button onClick={() => setFiltersOpen(false)} block>Show results</Button>}>
        {filters}
      </Dialog>
    </div>
  );
}

function BudgetFilter({ min, max, value, onChange }: { min: number; max: number; value: number | null; onChange: (v: number | null) => void }) {
  const step = 10_000;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const [local, setLocal] = useState(value ?? hi);
  if (hi <= lo) return null;
  return (
    <div>
      <label htmlFor="budget" className="flex justify-between text-sm font-semibold">
        <span>Max price per adult</span>
        <span className="t-price text-primary">{formatMoney(local)}</span>
      </label>
      <input
        id="budget"
        type="range"
        min={lo}
        max={hi}
        step={step}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => onChange(local >= hi ? null : local)}
        onKeyUp={() => onChange(local >= hi ? null : local)}
        className="mt-3 w-full accent-[var(--primary)]"
      />
      <div className="mt-1 flex justify-between text-xs text-ink-3">
        <span>{formatMoney(lo)}</span>
        <span>{formatMoney(hi)}</span>
      </div>
    </div>
  );
}
