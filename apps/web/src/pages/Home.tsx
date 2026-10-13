import { brand, formatMoney, splitEvenly } from '@waylo/shared';
import { ArrowRight, BadgeCheck, CarFront, Clock3, Luggage, Plane, ShieldCheck, Ticket, Users, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DestinationArt } from '@/components/brand/DestinationArt';
import { AirportChip } from '@/components/brand/Route';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Card';
import { DESTINATIONS, TRIP_IDEAS } from '@/content/destinations';
import { DestinationCard } from '@/features/discovery/DestinationCard';
import { SearchPanel } from '@/features/search/SearchPanel';
import { isoDate } from '@/lib/dates';

/** Illustrative fare-split figures for the explainer. Real fares are computed by the API. */
const EXAMPLE_VEHICLE_FARE = 120_000;
const EXAMPLE_RIDERS = 4;

export default function Home() {
  const share = splitEvenly(EXAMPLE_VEHICLE_FARE, EXAMPLE_RIDERS)[0]!;
  return (
    <>
      <Hero />

      <section className="container-page mt-20" aria-labelledby="destinations">
        <SectionHeader
          eyebrow="Discover"
          title="Where could you go from Mumbai?"
          action={
            <Link to="/flights" className="hidden items-center gap-1 text-sm font-semibold text-primary hover:underline sm:inline-flex">
              All flight offers <ArrowRight className="size-4" aria-hidden />
            </Link>
          }
        />
        <h2 id="destinations" className="sr-only">
          Featured destinations
        </h2>
        <div className="columns-2 gap-4 md:columns-3 lg:columns-4">
          {DESTINATIONS.map((d) => (
            <DestinationCard key={d.cityId} d={d} />
          ))}
        </div>
      </section>

      <section className="container-page mt-20" aria-labelledby="how">
        <SectionHeader eyebrow="How it works" title="Two ways WAYLO makes a trip cost less" />
        <h2 id="how" className="sr-only">
          How it works
        </h2>
        <div className="grid gap-5 lg:grid-cols-2">
          <HowCard
            tone="primary"
            icon={<Plane className="size-5" aria-hidden />}
            title="Airline-authorised flight offers"
            steps={[
              ['Search', 'See fares airlines or their authorised partners have chosen to publish, often close to departure.'],
              ['Check the rules', 'Baggage, change and refund conditions are shown before you pay. Prices are re-confirmed with the airline.'],
              ['Book', 'Your booking is confirmed only after the airline issues a ticket. You will never see a confirmation before that.'],
            ]}
          />
          <HowCard
            tone="mint"
            icon={<CarFront className="size-5" aria-hidden />}
            title="Shared airport rides"
            steps={[
              ['Tell us your arrival', 'Flight number or arrival time, where you are heading, how many bags.'],
              ['Get matched', 'We group you with travellers going the same way, within the detour and wait limits you set.'],
              ['Split the fare', 'The vehicle fare is shared transparently. You see your share, fees and cancellation terms before confirming.'],
            ]}
          />
        </div>
      </section>

      <section className="container-page mt-20" aria-labelledby="split">
        <div className="grid items-center gap-8 overflow-hidden rounded-[2rem] bg-[#0E1A2B] p-6 text-[#FAF7F2] sm:p-10 lg:grid-cols-2">
          <div>
            <Badge tone="mint">Illustrative example</Badge>
            <h2 id="split" className="mt-4 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
              One cab. Four travellers. Everyone pays less.
            </h2>
            <p className="mt-4 max-w-md text-[#FAF7F2]/75">
              If a vehicle to South Mumbai costs {formatMoney(EXAMPLE_VEHICLE_FARE)} and four matched passengers share it, each pays {formatMoney(share)} before
              any platform fee. Your actual fare, tolls, fees and taxes are always shown before you confirm.
            </p>
            <Button asChild variant="mint" size="lg" className="mt-6">
              <Link to={`/rides/new?airport=BOM&date=${isoDate(1)}`}>Plan a shared ride</Link>
            </Button>
          </div>
          <div className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
            <div className="flex items-center justify-between text-sm text-[#FAF7F2]/70">
              <span className="flex items-center gap-2">
                <AirportChip code="BOM" tone="inverse" /> T2 arrivals
              </span>
              <span className="flex items-center gap-1.5">
                <span className="live-dot size-2 rounded-full bg-[#3FD1AD]" aria-hidden /> Group forming
              </span>
            </div>
            <ul className="mt-5 space-y-3">
              {['Riya · Colaba', 'Arjun · Churchgate', 'Meera · Marine Lines', 'You · Fort'].map((p, i) => (
                <li key={p} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <span className="flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-full bg-white/10 text-xs font-bold">{p[0]}</span>
                    <span className="text-sm font-medium">{p}</span>
                  </span>
                  <span className="t-price text-sm text-[#3FD1AD]">{formatMoney(splitEvenly(EXAMPLE_VEHICLE_FARE, EXAMPLE_RIDERS)[i]!)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4 text-sm">
              <span className="text-[#FAF7F2]/70">Vehicle fare (example)</span>
              <span className="t-price">{formatMoney(EXAMPLE_VEHICLE_FARE)}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="container-page mt-20" aria-labelledby="ideas">
        <SectionHeader eyebrow="Inspiration" title="Trip ideas for your next long weekend" />
        <h2 id="ideas" className="sr-only">
          Trip ideas
        </h2>
        <div className="grid gap-5 md:grid-cols-3">
          {TRIP_IDEAS.map((t) => (
            <Link
              key={t.id}
              to={`/flights?${new URLSearchParams({ from: 'BOM', to: t.airport, date: isoDate(7), adults: '1', cabin: 'economy' })}`}
              className="group overflow-hidden rounded-card border border-line bg-surface shadow-card"
            >
              <div className="aspect-[16/10] overflow-hidden">
                <div className="size-full transition duration-500 group-hover:scale-105">
                  <DestinationArt scene={t.scene} seed={`idea-${t.id}`} />
                </div>
              </div>
              <div className="p-5">
                <p className="t-meta">{t.kicker}</p>
                <h3 className="mt-1.5 text-lg leading-snug font-semibold">{t.title}</h3>
                <p className="t-body mt-2 line-clamp-3 text-sm">{t.body}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  See offers to {t.airport} <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="container-page mt-20" aria-labelledby="trust">
        <SectionHeader eyebrow="Trust & safety" title="Built to be straightforward about what you are buying" />
        <h2 id="trust" className="sr-only">
          Trust and safety
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TrustItem icon={<BadgeCheck className="size-5" aria-hidden />} title="Authorised inventory only">
            Offers come from airlines or their authorised distribution partners, never from guessing at empty seats.
          </TrustItem>
          <TrustItem icon={<Wallet className="size-5" aria-hidden />} title="Full price up front">
            Fares, fees, tolls and taxes are itemised before payment. Discounts are only labelled when there is a real reference price.
          </TrustItem>
          <TrustItem icon={<ShieldCheck className="size-5" aria-hidden />} title="Verified operators">
            Only approved fleet operators with checked vehicles and drivers can accept shared rides.
          </TrustItem>
          <TrustItem icon={<Clock3 className="size-5" aria-hidden />} title="Honest timing">
            Pickup times follow live flight status where available. We never promise baggage or exit times we cannot know.
          </TrustItem>
        </div>
      </section>

      <section className="container-page mt-20">
        <div className="relative overflow-hidden rounded-[2rem] bg-lavender p-8 sm:p-12">
          <div className="relative z-10 max-w-xl">
            <h2 className="t-title">Ready when your next trip is.</h2>
            <p className="t-body mt-3">Create a free account to save destinations, track bookings and get matched for airport rides.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/register">Create free account</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/partners">For airlines & operators</Link>
              </Button>
            </div>
          </div>
          <div className="pointer-events-none absolute -right-10 -bottom-16 hidden h-72 w-72 rotate-6 overflow-hidden rounded-[2rem] opacity-90 md:block" aria-hidden>
            <DestinationArt scene="airport" seed="cta" />
          </div>
        </div>
      </section>
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden" aria-labelledby="hero-title">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_85%_10%,var(--lavender),transparent_70%),radial-gradient(40%_40%_at_10%_90%,var(--sky),transparent_70%)]" />
      <div className="container-page grid items-center gap-10 pt-10 pb-6 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <div>
          <p className="t-meta flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-mint" aria-hidden /> Now in {brand.homeMarket.city}
          </p>
          <h1 id="hero-title" className="t-display mt-4 max-w-xl">
            Your next journey, <span className="text-primary">for less.</span>
          </h1>
          <p className="t-body mt-5 max-w-lg text-lg">
            Airline-authorised flight offers and shared rides from the airport, in one simple app.
          </p>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
            <li className="flex items-center gap-2">
              <Ticket className="size-4 text-primary" aria-hidden /> Fare rules before you pay
            </li>
            <li className="flex items-center gap-2">
              <Users className="size-4 text-mint" aria-hidden /> Split airport cabs
            </li>
            <li className="flex items-center gap-2">
              <Luggage className="size-4 text-coral" aria-hidden /> Luggage-aware matching
            </li>
          </ul>
        </div>
        <SearchPanel />
      </div>
    </section>
  );
}

function HowCard({ icon, title, steps, tone }: { icon: ReactNode; title: string; steps: [string, string][]; tone: 'primary' | 'mint' }) {
  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
      <div className={tone === 'primary' ? 'grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary' : 'grid size-11 place-items-center rounded-2xl bg-mint-soft text-mint'}>
        {icon}
      </div>
      <h3 className="mt-4 text-xl font-semibold tracking-tight">{title}</h3>
      <ol className="mt-5 space-y-4">
        {steps.map(([h, b], i) => (
          <li key={h} className="flex gap-4">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-ink-2">{i + 1}</span>
            <div>
              <p className="font-semibold">{h}</p>
              <p className="t-body text-sm">{b}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TrustItem({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-card bg-surface-2 p-5">
      <div className="grid size-10 place-items-center rounded-xl bg-surface text-ink shadow-card">{icon}</div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="t-body mt-1.5 text-sm">{children}</p>
    </div>
  );
}
