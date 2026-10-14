import { brand } from '@waylo/shared';
import { Building2, CarFront, CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DestinationArt } from '@/components/brand/DestinationArt';
import { Button } from '@/components/ui/Button';

export default function Partners() {
  return (
    <div className="container-page py-10 sm:py-16">
      <div className="max-w-2xl">
        <p className="t-meta">Partners</p>
        <h1 className="t-display mt-3">Fill seats and vehicles that would otherwise run empty.</h1>
        <p className="t-body mt-5 text-lg">
          {brand.name} works with airlines, authorised distribution partners and licensed fleet operators. You stay in control of pricing, inventory and eligibility.
        </p>
      </div>
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <PartnerCard
          icon={<Building2 className="size-5" aria-hidden />}
          title="Airlines & distribution partners"
          scene="airport"
          points={[
            'Publish offers on the routes and dates you choose, with your own fare rules',
            'Set validity windows, eligibility and inventory caps',
            'Bookings are checked against your fare, seat cap and eligibility rules before payment',
            'Booking, cancellation and refund reporting with an audit log',
          ]}
          cta={{ to: '/register?as=partner', label: 'Apply as a partner' }}
        />
        <PartnerCard
          icon={<CarFront className="size-5" aria-hidden />}
          title="Fleet operators & drivers"
          scene="city"
          points={[
            'Receive pre-matched airport groups sized to your vehicles',
            'Flight-aware pickup times with configurable grace periods',
            'Clear trip status updates and incident reporting',
            'Transparent earnings and settlement tracking',
          ]}
          cta={{ to: '/register?as=operator', label: 'Apply as an operator' }}
        />
      </div>
      <p className="t-body mt-10 text-sm">
        Interested in partnering? Write to{' '}
        <a className="font-semibold text-primary" href={`mailto:${brand.supportEmail}?subject=Partnership`}>
          {brand.supportEmail}
        </a>
        .
      </p>
    </div>
  );
}

function PartnerCard({
  icon,
  title,
  scene,
  points,
  cta,
}: {
  icon: ReactNode;
  title: string;
  scene: 'airport' | 'city';
  points: string[];
  cta: { to: string; label: string };
}) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="aspect-[16/7]">
        <DestinationArt scene={scene} seed={`partners-${scene}`} />
      </div>
      <div className="p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-lavender text-primary">{icon}</span>
          <h2 className="t-section">{title}</h2>
        </div>
        <ul className="mt-5 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex gap-3 text-sm text-ink-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden /> {p}
            </li>
          ))}
        </ul>
        <Button asChild variant="secondary" className="mt-6">
          <Link to={cta.to}>{cta.label}</Link>
        </Button>
      </div>
    </section>
  );
}
