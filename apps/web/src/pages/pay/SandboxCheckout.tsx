import { formatMoney } from '@waylo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, FlaskConical, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api } from '@/lib/api';

interface SandboxPayment {
  id: string;
  purpose: string;
  referenceId: string;
  amountMinor: number;
  currency: string;
  status: string;
  failureReason: string | null;
}

export const destinationFor = (p: Pick<SandboxPayment, 'purpose' | 'referenceId'>) =>
  p.purpose === 'flight_booking' ? `/trips/flights/${p.referenceId}` : `/trips/rides/${p.referenceId}`;

/**
 * Stand-in for a payment provider's hosted checkout. It never asks for card details: the
 * customer picks an outcome, and the result reaches WAYLO through the provider's signed webhook.
 */
export default function SandboxCheckout() {
  const { intentId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['sandbox-intent', intentId],
    queryFn: () => api.get<{ payment: SandboxPayment }>(`/payments/sandbox/intents/${intentId}`).then((r) => r.payment),
  });
  const complete = useMutation({
    mutationFn: (outcome: 'succeed' | 'fail') => api.post<{ payment: SandboxPayment }>(`/payments/sandbox/intents/${intentId}/complete`, { outcome }).then((r) => r.payment),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ['booking', p.referenceId] });
      await qc.invalidateQueries({ queryKey: ['bookings'] });
      if (p.status === 'succeeded') navigate(destinationFor(p), { replace: true });
      else q.refetch();
    },
  });

  useEffect(() => {
    document.title = 'Sandbox checkout';
  }, []);

  if (q.isPending) return <div className="container-page max-w-md py-16"><SkeletonList count={2} /></div>;
  if (q.isError) return <div className="container-page max-w-md py-16"><ErrorState title="Checkout not found" error={q.error} /></div>;
  const p = q.data;
  if (p.status === 'succeeded') return <Navigate to={destinationFor(p)} replace />;

  return (
    <div className="container-page max-w-md py-10 sm:py-16">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between bg-[#0E1A2B] px-6 py-4 text-[#FAF7F2]">
          <Logo className="[&_span]:text-[#FAF7F2]" />
          <span className="flex items-center gap-1.5 rounded-full bg-[#F2705B] px-2.5 py-1 text-xs font-bold text-[#0E1A2B]">
            <FlaskConical className="size-3.5" aria-hidden /> Sandbox
          </span>
        </div>
        <CardSection className="space-y-5">
          <div>
            <h1 className="text-lg font-bold">Simulated payment</h1>
            <p className="t-body mt-1 text-sm">
              This checkout is part of the WAYLO sandbox. No card details are collected and no money moves. Choose an outcome to test the booking flow.
            </p>
          </div>
          <div className="rounded-2xl bg-surface-2 p-4">
            <p className="t-meta">Amount</p>
            <p className="t-price mt-1 text-3xl">{formatMoney(p.amountMinor, p.currency)}</p>
          </div>
          {p.status === 'failed' && (
            <Notice tone="danger" title="Payment declined">
              {p.failureReason ?? 'The payment did not go through.'} You can try again.
            </Notice>
          )}
          {p.status === 'cancelled' && <Notice tone="warning" title="Payment window closed">This booking expired before payment. Please search again.</Notice>}
          {complete.isError && <Notice tone="danger">{(complete.error as Error).message}</Notice>}
          {p.status !== 'cancelled' && (
            <div className="space-y-2">
              <Button block size="lg" loading={complete.isPending && complete.variables === 'succeed'} disabled={complete.isPending} onClick={() => complete.mutate('succeed')}>
                <CreditCard className="size-4" aria-hidden /> Simulate successful payment
              </Button>
              <Button block variant="secondary" disabled={complete.isPending} loading={complete.isPending && complete.variables === 'fail'} onClick={() => complete.mutate('fail')}>
                <XCircle className="size-4" aria-hidden /> Simulate declined payment
              </Button>
            </div>
          )}
          <Button variant="ghost" size="sm" block onClick={() => navigate(destinationFor(p))}>
            Back to booking
          </Button>
        </CardSection>
      </Card>
    </div>
  );
}
