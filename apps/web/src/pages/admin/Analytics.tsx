import { formatMoney } from '@waylo/shared';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { Card, CardSection, SectionHeader } from '@/components/ui/Card';
import { DataTable, MetricCard } from '@/components/ui/DataTable';
import { Input, Segmented } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api } from '@/lib/api';
import { isoDate } from '@/lib/dates';

interface Summary {
  range: { from: string; to: string; timeZone: string };
  flights: {
    searches: number;
    searchesWithResults: number;
    searchesRecordedSince: string | null;
    priceLocks: number;
    bookingsStarted: number;
    bookingsPaid: number;
    bookingsTicketed: number;
    seatsTicketed: number;
    grossBookingValueMinor: number;
    cancelledAfterTicketing: number;
    ticketingFailed: number;
    partnerShare: number | null;
    conversion: { searchToLock: number | null; lockToBooking: number | null; bookingToPaid: number | null };
    savings: { bookingsWithSourcedSaving: number; totalMinor: number; averagePercent: number | null };
  };
  rides: {
    requests: number;
    matched: number;
    noMatch: number;
    expired: number;
    cancelled: number;
    matchRate: number | null;
    completedTrips: number;
    averageSeatFill: number | null;
    averagePartiesPerTrip: number | null;
    platformSubsidyMinor: number;
    ridersCompleted: number;
    riderRevenueMinor: number;
    riderSavingsVsSoloMinor: number;
    averageSavingVsSoloPercent: number | null;
  };
  refunds: { succeeded: number; amountMinor: number; failed: number };
}
interface Day {
  day: string;
  searches: number;
  bookingsTicketed: number;
  grossBookingValueMinor: number;
  rideRequests: number;
  ridesCompleted: number;
}
interface RouteRow {
  origin: string;
  destination: string;
  searches: number;
  searchesWithResults: number;
  bookings: number | null;
  grossBookingValueMinor: number | null;
  savingsMinor: number | null;
  suppressed: boolean;
}
interface PartnerRow {
  partnerId: string;
  name: string;
  status: string;
  liveOffers: number;
  bookingsTicketed: number;
  seatsTicketed: number;
  grossBookingValueMinor: number;
  cancellations: number;
  ticketingFailures: number;
}
interface OperatorRow {
  operatorId: string;
  name: string;
  status: string;
  tripsCompleted: number;
  operatorEarningsMinor: number;
  commissionMinor: number;
  tripsWithOffRouteAlert: number;
  incidents: number;
}

type Preset = '7' | '30' | '90' | 'custom';
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`);

export default function Analytics() {
  const [preset, setPreset] = useState<Preset>('30');
  const [custom, setCustom] = useState({ from: isoDate(-29), to: isoDate(0) });
  const range = preset === 'custom' ? custom : { from: isoDate(-(Number(preset) - 1)), to: isoDate(0) };
  const load = <T,>(path: string) => api.get<T>(`/admin/analytics/${path}`, { query: range });
  const summary = useQuery({ queryKey: ['admin', 'analytics', 'summary', range], queryFn: () => load<Summary>('summary') });
  const daily = useQuery({ queryKey: ['admin', 'analytics', 'daily', range], queryFn: () => load<{ items: Day[] }>('daily').then((r) => r.items) });
  const routes = useQuery({ queryKey: ['admin', 'analytics', 'routes', range], queryFn: () => load<{ items: RouteRow[]; minCohort: number }>('routes') });
  const partners = useQuery({ queryKey: ['admin', 'analytics', 'partners', range], queryFn: () => load<{ items: PartnerRow[] }>('partners').then((r) => r.items) });
  const operators = useQuery({ queryKey: ['admin', 'analytics', 'operators', range], queryFn: () => load<{ items: OperatorRow[] }>('operators').then((r) => r.items) });
  const exportHref = (report: string) => `/api/v1/admin/analytics/export?${new URLSearchParams({ report, ...range })}`;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Aggregates computed from bookings, payments, rides and anonymous search counts. Days are India Standard Time; amounts are in rupees."
      />
      <div className="mb-8 flex flex-wrap items-end gap-4">
        <Segmented
          label="Period"
          className="max-w-md flex-1"
          value={preset}
          onChange={setPreset}
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {preset === 'custom' && (
          <>
            <Input label="From" type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} wrapperClassName="w-44" />
            <Input label="To" type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} wrapperClassName="w-44" />
          </>
        )}
      </div>

      {summary.isPending ? (
        <SkeletonList />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <SummaryView s={summary.data} />
      )}

      <section className="mb-10">
        <SectionHeader title="Day by day" action={<ExportLink href={exportHref('daily')} />} />
        {daily.data ? <DailyChart days={daily.data} /> : daily.isError ? <ErrorState error={daily.error} onRetry={() => daily.refetch()} /> : <SkeletonList count={1} />}
      </section>

      <section className="mb-10">
        <SectionHeader title="Routes" action={<ExportLink href={exportHref('routes')} />} />
        {routes.data && (
          <>
            <p className="t-note mb-3">Booking figures for routes with fewer than {routes.data.minCohort} bookings in the period are withheld, so small groups of travellers cannot be singled out.</p>
            <DataTable
              caption="Route demand and sales"
              rows={routes.data.items}
              rowKey={(r) => `${r.origin}-${r.destination}`}
              empty="No searches or bookings in this period"
              columns={[
                { key: 'route', header: 'Route', cell: (r) => <span className="font-semibold">{`${r.origin} → ${r.destination}`}</span> },
                { key: 'searches', header: 'Searches', cell: (r) => r.searches },
                { key: 'found', header: 'Found offers', cell: (r) => (r.searches ? pct(r.searchesWithResults / r.searches) : '—'), hideOnMobile: true },
                { key: 'bookings', header: 'Bookings', cell: (r) => (r.suppressed ? <Badge tone="neutral">Fewer than {routes.data.minCohort}</Badge> : r.bookings) },
                { key: 'gbv', header: 'Booking value', cell: (r) => (r.grossBookingValueMinor === null ? '—' : formatMoney(r.grossBookingValueMinor)) },
                { key: 'saved', header: 'Traveller savings', cell: (r) => (r.savingsMinor === null ? '—' : formatMoney(r.savingsMinor)), hideOnMobile: true },
              ]}
            />
          </>
        )}
      </section>

      <section className="mb-10">
        <SectionHeader title="Partners" action={<ExportLink href={exportHref('partners')} />} />
        <DataTable
          caption="Partner performance"
          rows={partners.data ?? []}
          rowKey={(p) => p.partnerId}
          empty="No partners yet"
          columns={[
            { key: 'name', header: 'Partner', cell: (p) => <span className="font-semibold">{p.name}</span> },
            { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} />, hideOnMobile: true },
            { key: 'live', header: 'Live offers', cell: (p) => p.liveOffers },
            { key: 'bookings', header: 'Ticketed', cell: (p) => `${p.bookingsTicketed} (${p.seatsTicketed} seats)` },
            { key: 'gbv', header: 'Booking value', cell: (p) => formatMoney(p.grossBookingValueMinor) },
            { key: 'issues', header: 'Cancelled / failed', cell: (p) => `${p.cancellations} / ${p.ticketingFailures}`, hideOnMobile: true },
          ]}
        />
      </section>

      <section>
        <SectionHeader title="Fleet operators" action={<ExportLink href={exportHref('operators')} />} />
        <DataTable
          caption="Operator performance"
          rows={operators.data ?? []}
          rowKey={(o) => o.operatorId}
          empty="No operators yet"
          columns={[
            { key: 'name', header: 'Operator', cell: (o) => <span className="font-semibold">{o.name}</span> },
            { key: 'trips', header: 'Trips', cell: (o) => o.tripsCompleted },
            { key: 'earn', header: 'Operator earnings', cell: (o) => formatMoney(o.operatorEarningsMinor) },
            { key: 'commission', header: 'Commission', cell: (o) => formatMoney(o.commissionMinor), hideOnMobile: true },
            { key: 'offroute', header: 'Off-route alerts', cell: (o) => o.tripsWithOffRouteAlert, hideOnMobile: true },
            { key: 'incidents', header: 'Incidents', cell: (o) => o.incidents },
          ]}
        />
      </section>
    </>
  );
}

function SummaryView({ s }: { s: Summary }) {
  const f = s.flights;
  const r = s.rides;
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Booking value" value={formatMoney(f.grossBookingValueMinor)} hint={`${f.bookingsTicketed} ticketed bookings · ${f.seatsTicketed} seats`} tone="primary" />
        <MetricCard
          label="Traveller savings"
          value={formatMoney(f.savings.totalMinor)}
          hint={f.savings.averagePercent === null ? 'Only counted against a sourced regular fare' : `${f.savings.averagePercent}% below the sourced regular fare, ${f.savings.bookingsWithSourcedSaving} bookings`}
          tone="mint"
        />
        <MetricCard label="Shared rides completed" value={r.completedTrips} hint={r.averageSeatFill === null ? 'No completed trips' : `${pct(r.averageSeatFill)} seats filled · ${r.averagePartiesPerTrip} parties per trip`} />
        <MetricCard label="Refunded" value={formatMoney(s.refunds.amountMinor)} hint={`${s.refunds.succeeded} refunds${s.refunds.failed ? ` · ${s.refunds.failed} failed` : ''}`} tone="coral" />
      </div>
      {f.ticketingFailed > 0 && (
        <Notice tone="danger" className="mb-6">
          {f.ticketingFailed} bookings in this period could not be ticketed.
        </Notice>
      )}
      <div className="mb-10 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardSection>
            <SectionHeader title="Flight funnel" />
            <Funnel
              steps={[
                { label: 'Searches', value: f.searches, note: f.searchesRecordedSince ? `${f.searchesWithResults} found offers · counted since ${f.searchesRecordedSince}` : 'Not recorded yet' },
                { label: 'Price locks', value: f.priceLocks, rate: f.conversion.searchToLock },
                { label: 'Bookings started', value: f.bookingsStarted, rate: f.conversion.lockToBooking },
                { label: 'Paid', value: f.bookingsPaid, rate: f.conversion.bookingToPaid },
              ]}
            />
            <p className="t-note mt-3">
              Ticketed bookings are counted on the day they were ticketed, so they can include bookings started before the period. Partner fares: {pct(f.partnerShare)} of ticketed bookings.
            </p>
          </CardSection>
        </Card>
        <Card>
          <CardSection>
            <SectionHeader title="Shared rides" />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Stat label="Ride requests" value={r.requests} />
              <Stat label="Match rate" value={pct(r.matchRate)} hint="matched ÷ (matched + no match + expired)" />
              <Stat label="Riders carried" value={r.ridersCompleted} />
              <Stat label="Rider revenue" value={formatMoney(r.riderRevenueMinor)} />
              <Stat label="Saved vs riding solo" value={formatMoney(r.riderSavingsVsSoloMinor)} hint={r.averageSavingVsSoloPercent === null ? undefined : `${r.averageSavingVsSoloPercent}% on average`} />
              <Stat label="Platform subsidy" value={formatMoney(r.platformSubsidyMinor)} />
            </dl>
          </CardSection>
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="t-note">{hint}</dd>}
    </div>
  );
}

function Funnel({ steps }: { steps: { label: string; value: number; rate?: number | null; note?: string }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-semibold">{s.label}</span>
            <span className="tabular-nums">
              {s.value}
              {s.rate !== undefined && <span className="t-note ml-2">{pct(s.rate ?? null)} of previous</span>}
              {s.note && <span className="t-note ml-2">{s.note}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-2" aria-hidden>
            <div className="h-2 rounded-full bg-primary" style={{ width: `${(s.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Bar chart of daily booking value, with ticketed bookings and searches shown on hover/focus and in the table. */
function DailyChart({ days }: { days: Day[] }) {
  const [metric, setMetric] = useState<'grossBookingValueMinor' | 'bookingsTicketed' | 'searches' | 'rideRequests'>('grossBookingValueMinor');
  const max = Math.max(1, ...days.map((d) => d[metric]));
  const fmt = (v: number) => (metric === 'grossBookingValueMinor' ? formatMoney(v) : String(v));
  const label = { grossBookingValueMinor: 'Booking value', bookingsTicketed: 'Ticketed bookings', searches: 'Searches', rideRequests: 'Ride requests' }[metric];
  const w = 100 / days.length;
  return (
    <Card>
      <CardSection>
        <Segmented
          label="Show"
          className="mb-4 max-w-xl"
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'grossBookingValueMinor', label: 'Value' },
            { value: 'bookingsTicketed', label: 'Bookings' },
            { value: 'searches', label: 'Searches' },
            { value: 'rideRequests', label: 'Ride requests' },
          ]}
        />
        <figure>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-40 w-full min-w-0" role="img" aria-label={`${label} per day from ${days[0]?.day} to ${days[days.length - 1]?.day}`}>
            {days.map((d, i) => {
              const h = (d[metric] / max) * 38;
              return (
                <rect key={d.day} x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={Math.max(h, d[metric] ? 0.6 : 0.2)} rx={0.4} className={d[metric] ? 'fill-primary' : 'fill-line'}>
                  <title>{`${d.day}: ${fmt(d[metric])}`}</title>
                </rect>
              );
            })}
          </svg>
          <figcaption className="t-note mt-2 flex justify-between">
            <span>{days[0]?.day}</span>
            <span>
              Peak {fmt(Math.max(...days.map((d) => d[metric])))} · total {fmt(days.reduce((s, d) => s + d[metric], 0))}
            </span>
            <span>{days[days.length - 1]?.day}</span>
          </figcaption>
        </figure>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-primary">Show the numbers</summary>
          <div className="mt-3">
            <DataTable
              caption="Daily figures"
              rows={[...days].reverse()}
              rowKey={(d) => d.day}
              columns={[
                { key: 'day', header: 'Day', cell: (d) => d.day },
                { key: 'searches', header: 'Searches', cell: (d) => d.searches },
                { key: 'bookings', header: 'Ticketed', cell: (d) => d.bookingsTicketed },
                { key: 'gbv', header: 'Value', cell: (d) => formatMoney(d.grossBookingValueMinor) },
                { key: 'rides', header: 'Ride requests', cell: (d) => d.rideRequests, hideOnMobile: true },
                { key: 'done', header: 'Rides completed', cell: (d) => d.ridesCompleted, hideOnMobile: true },
              ]}
            />
          </div>
        </details>
      </CardSection>
    </Card>
  );
}

function ExportLink({ href }: { href: string }) {
  return (
    <a href={href} className={buttonClass('secondary', 'sm')} download>
      <Download className="size-4" aria-hidden /> CSV
    </a>
  );
}
