import { useState } from 'react';
import { DestinationArt, type Scene } from '@/components/brand/DestinationArt';
import { Logo, LogoMark } from '@/components/brand/Logo';
import { AirportChip, RouteLine } from '@/components/brand/Route';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection, SectionHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Checkbox, Input, Segmented, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui/States';

/** Development-only reference of the WAYLO design system (not routed in production builds). */
export default function DesignSystem() {
  const [cabin, setCabin] = useState<'economy' | 'premium' | 'business'>('economy');
  const [confirm, setConfirm] = useState(false);
  const scenes: Scene[] = ['coast', 'city', 'desert', 'heritage', 'hills', 'airport'];
  return (
    <div className="container-page space-y-12 py-10">
      <header>
        <p className="t-meta">Internal</p>
        <h1 className="t-title">Design system</h1>
      </header>

      <section>
        <SectionHeader title="Brand" />
        <div className="flex flex-wrap items-center gap-6">
          <Logo />
          <LogoMark className="size-16" />
          <AirportChip code="BOM" />
          <AirportChip code="GOI" />
        </div>
      </section>

      <section>
        <SectionHeader title="Typography" />
        <p className="t-display">Your next journey, for less.</p>
        <p className="t-title mt-4">Page title</p>
        <p className="t-section mt-2">Section heading</p>
        <p className="t-body mt-2">Body copy for descriptions and supporting explanations.</p>
        <p className="t-meta mt-2">Metadata label</p>
        <p className="t-price mt-2 text-3xl text-mint">₹2,499</p>
      </section>

      <section>
        <SectionHeader title="Buttons & badges" />
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="mint">Savings</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Destructive
          </Button>
          <Button loading>Loading</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {['confirmed', 'pending_payment', 'ticketing_failed', 'open', 'locked', 'refunded'].map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
          <Badge tone="coral" dot>
            Live match
          </Badge>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardSection className="space-y-4">
            <Input label="Full name" placeholder="As on government ID" hint="Must match your ID exactly." />
            <Input label="Email" error="Enter a valid email address." defaultValue="ananya@" />
            <Select label="Cabin" defaultValue="economy">
              <option value="economy">Economy</option>
              <option value="business">Business</option>
            </Select>
            <Segmented
              label="Cabin class"
              value={cabin}
              onChange={setCabin}
              options={[
                { value: 'economy', label: 'Economy' },
                { value: 'premium', label: 'Premium' },
                { value: 'business', label: 'Business' },
              ]}
            />
            <Checkbox label="I accept the fare rules" description="Non-refundable after check-in opens." />
          </CardSection>
        </Card>
        <Card>
          <CardSection className="space-y-4">
            <RouteLine from="BOM" to="GOI" fromLabel="06:10" toLabel="07:25" middle="1h 15m · Non-stop" />
            <Notice tone="info" title="Price locked for 10 minutes">
              Complete passenger details before the lock expires.
            </Notice>
            <Notice tone="warning" title="Fare changed">
              The airline updated this fare from ₹2,499 to ₹2,699.
            </Notice>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
          </CardSection>
        </Card>
      </section>

      <section>
        <SectionHeader title="Illustrations" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {scenes.map((s) => (
            <div key={s} className="aspect-[4/5] overflow-hidden rounded-card">
              <DestinationArt scene={s} label={s} />
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <EmptyState title="No upcoming trips" body="Book a flight offer or a shared ride to see it here." action={<Button>Find flights</Button>} />
        <ErrorState error={new Error('We could not reach WAYLO. Check your connection and try again.')} onRetry={() => {}} />
      </section>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancel this ride?"
        description="Your seat will be released to other passengers. Cancellation fees may apply."
        confirmLabel="Cancel ride"
        tone="danger"
        onConfirm={() => new Promise((r) => setTimeout(r, 600))}
      />
    </div>
  );
}
