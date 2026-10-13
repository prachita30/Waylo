import { ArrowLeftRight, CarFront, Plane, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { isoDate } from '@/lib/dates';
import { useAirports } from '@/lib/meta';

export type Cabin = 'economy' | 'premium_economy' | 'business';
export const CABINS: { value: Cabin; label: string }[] = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium economy' },
  { value: 'business', label: 'Business' },
];

export interface FlightSearchValues {
  from: string;
  to: string;
  date: string;
  adults: number;
  cabin: Cabin;
}

export function flightSearchToParams(v: FlightSearchValues) {
  return new URLSearchParams({ from: v.from, to: v.to, date: v.date, adults: String(v.adults), cabin: v.cabin });
}

/** Flight search fields. Used on the homepage hero and at the top of the results page. */
export function FlightSearchForm({
  initial,
  onSearch,
  compact,
}: {
  initial?: Partial<FlightSearchValues>;
  onSearch?: (v: FlightSearchValues) => void;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const airports = useAirports();
  const [v, setV] = useState<FlightSearchValues>({
    from: initial?.from ?? 'BOM',
    to: initial?.to ?? '',
    date: initial?.date ?? isoDate(1),
    adults: initial?.adults ?? 1,
    cabin: initial?.cabin ?? 'economy',
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FlightSearchValues>(k: K, val: FlightSearchValues[K]) => setV((p) => ({ ...p, [k]: val }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!v.to) return setError('Choose where you are flying to.');
    if (v.from === v.to) return setError('Origin and destination must be different.');
    if (v.date < isoDate(0)) return setError('Choose today or a future date.');
    setError(null);
    if (onSearch) onSearch(v);
    else navigate(`/flights?${flightSearchToParams(v)}`);
  };

  const options = airports.data?.map((a) => (
    <option key={a.code} value={a.code}>
      {a.city} ({a.code})
    </option>
  ));

  return (
    <form onSubmit={submit} noValidate aria-label="Search flights">
      <div className={cn('grid grid-cols-2 gap-3', compact ? 'lg:grid-cols-[1fr_1fr_10rem_8rem_11rem_auto]' : 'sm:grid-cols-6')}>
        <div className={cn('relative col-span-2 grid grid-cols-2 gap-3', compact ? 'lg:col-span-2' : 'sm:col-span-6')}>
          <Select label="From" value={v.from} onChange={(e) => set('from', e.target.value)}>
            {options}
          </Select>
          <Select label="To" value={v.to} onChange={(e) => set('to', e.target.value)} error={error && !v.to ? error : undefined}>
            <option value="">Where to?</option>
            {options}
          </Select>
          <button
            type="button"
            onClick={() => setV((p) => ({ ...p, from: p.to || p.from, to: p.from }))}
            className="absolute top-[2.15rem] left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-ink-2 shadow-card hover:text-ink"
            aria-label="Swap origin and destination"
          >
            <ArrowLeftRight className="size-3.5" aria-hidden />
          </button>
        </div>
        <Input
          label="Departure"
          type="date"
          min={isoDate(0)}
          max={isoDate(330)}
          value={v.date}
          onChange={(e) => set('date', e.target.value)}
          wrapperClassName={compact ? undefined : 'col-span-2 sm:col-span-6'}
        />
        <Select label="Travellers" value={v.adults} onChange={(e) => set('adults', Number(e.target.value))} wrapperClassName={compact ? undefined : 'sm:col-span-3'}>
          {Array.from({ length: 9 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1} adult{i ? 's' : ''}
            </option>
          ))}
        </Select>
        <Select
          label="Cabin"
          value={v.cabin}
          onChange={(e) => set('cabin', e.target.value as Cabin)}
          wrapperClassName={compact ? 'col-span-2 sm:col-span-1' : 'sm:col-span-3'}
        >
          {CABINS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        {compact && (
          <Button type="submit" className="col-span-2 h-12 self-end sm:col-span-1">
            <Search className="size-4" aria-hidden /> Search
          </Button>
        )}
      </div>
      {error && v.to && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {!compact && (
        <Button type="submit" size="lg" block className="mt-4">
          <Search className="size-4" aria-hidden /> Search flight offers
        </Button>
      )}
    </form>
  );
}

function RideSearchForm() {
  const navigate = useNavigate();
  const airports = useAirports();
  const [airport, setAirport] = useState('BOM');
  const [date, setDate] = useState(isoDate(1));
  const [flight, setFlight] = useState('');
  return (
    <form
      aria-label="Find a shared ride"
      onSubmit={(e) => {
        e.preventDefault();
        const p = new URLSearchParams({ airport, date });
        if (flight.trim()) p.set('flight', flight.trim().toUpperCase().replace(/\s+/g, ''));
        navigate(`/rides/new?${p}`);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Arriving at" value={airport} onChange={(e) => setAirport(e.target.value)}>
          {airports.data?.map((a) => (
            <option key={a.code} value={a.code}>
              {a.city} ({a.code})
            </option>
          ))}
        </Select>
        <Input label="Arrival date" type="date" min={isoDate(0)} value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Flight number (optional)" placeholder="e.g. 6E 5321" value={flight} onChange={(e) => setFlight(e.target.value)} maxLength={10} />
      </div>
      <Button type="submit" size="lg" block variant="mint" className="mt-4">
        <CarFront className="size-4" aria-hidden /> Find people to share with
      </Button>
    </form>
  );
}

/** Tabbed search entry: flight offers or shared airport rides. */
export function SearchPanel({ className }: { className?: string }) {
  const [tab, setTab] = useState<'flights' | 'rides'>('flights');
  const tabs = [
    { id: 'flights' as const, label: 'Flight offers', icon: Plane },
    { id: 'rides' as const, label: 'Shared airport ride', icon: CarFront },
  ];
  return (
    <div className={cn('rounded-[1.75rem] border border-line bg-surface p-4 shadow-float sm:p-6', className)}>
      <div role="tablist" aria-label="What are you looking for?" className="mb-5 flex gap-1 rounded-full bg-surface-2 p-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2.5 text-sm font-semibold transition',
              tab === id ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink',
            )}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'flights' ? <FlightSearchForm /> : <RideSearchForm />}
      </div>
    </div>
  );
}
