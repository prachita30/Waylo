import { brand } from '@waylo/shared';
import { LifeBuoy, Mail, Siren } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { useMe } from '@/lib/auth';

/** Public help entry point. Signed-in users manage tickets from the Support centre. */
export default function SupportInfo() {
  const { data: me } = useMe();
  return (
    <div className="container-page max-w-3xl py-10 sm:py-16">
      <p className="t-meta">Help</p>
      <h1 className="t-title mt-2">How can we help?</h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardSection>
            <LifeBuoy className="size-6 text-primary" aria-hidden />
            <h2 className="mt-3 font-semibold">Booking or ride issue</h2>
            <p className="t-body mt-1 text-sm">Open a support request linked to your trip so we have the details straight away.</p>
            <Button asChild className="mt-4" size="sm">
              <Link to={me ? '/support/tickets' : '/login?next=%2Fsupport%2Ftickets'}>{me ? 'Open support centre' : 'Sign in for support'}</Link>
            </Button>
          </CardSection>
        </Card>
        <Card>
          <CardSection>
            <Mail className="size-6 text-primary" aria-hidden />
            <h2 className="mt-3 font-semibold">Email us</h2>
            <p className="t-body mt-1 text-sm">For anything else, including partnership and press enquiries.</p>
            <Button asChild variant="secondary" className="mt-4" size="sm">
              <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
            </Button>
          </CardSection>
        </Card>
      </div>
      <div className="mt-4 flex items-start gap-3 rounded-card bg-danger-soft p-5">
        <Siren className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <p className="text-sm">
          <strong>In an emergency, call 112.</strong> For a safety concern during a ride, use “Report a safety issue” on your trip and it is escalated to our team as a
          priority.
        </p>
      </div>
    </div>
  );
}
