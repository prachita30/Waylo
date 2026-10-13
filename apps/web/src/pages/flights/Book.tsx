import { zodResolver } from '@hookform/resolvers/zod';
import { emailSchema, formatMoney, passengerSchema, phoneSchema } from '@waylo/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock, ShieldCheck, TimerReset } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import { RouteLine } from '@/components/brand/Route';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { Checkbox, Input } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { AirlineMark, useNow } from '@/components/travel/FlightCard';
import { PriceBreakdown } from '@/components/travel/PriceBreakdown';
import { api, ApiError, isApiError, newIdempotencyKey } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { goToCheckout, type Booking, type LockResponse } from '@/lib/bookings';
import { formatDate, formatTime } from '@/lib/dates';
import { CABIN_LABEL } from '@/lib/flights';

const formSchema = z.object({
  passengers: z.array(passengerSchema),
  email: emailSchema,
  phone: phoneSchema.optional().or(z.literal('')),
  acceptFareRules: z.boolean().refine((v) => v, 'Please accept the fare rules to continue.'),
});
type FormValues = z.input<typeof formSchema>;

/** Stable per price lock, so a retry after a dropped connection cannot create a second booking. */
function useIdempotencyKey(lockId: string | undefined) {
  return useMemo(() => {
    if (!lockId) return undefined;
    const k = `waylo.idem.${lockId}`;
    try {
      const existing = sessionStorage.getItem(k);
      if (existing) return existing;
      const fresh = newIdempotencyKey();
      sessionStorage.setItem(k, fresh);
      return fresh;
    } catch {
      return newIdempotencyKey();
    }
  }, [lockId]);
}

export default function Book() {
  const { offerId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const adults = Math.min(9, Math.max(1, Number(params.get('adults') ?? 1)));
  const { data: me } = useMe();
  const now = useNow(1000);

  const lockQuery = useQuery({
    queryKey: ['price-lock', offerId, adults],
    queryFn: () => api.post<LockResponse>(`/flights/offers/${offerId}/validate`, { adults }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const lock = lockQuery.data?.lock;
  const offer = lockQuery.data?.offer;
  const priceChanged = lockQuery.data?.priceChanged;
  const [acceptedChange, setAcceptedChange] = useState(false);
  const idemKey = useIdempotencyKey(lock?.id);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);

  const { register, control, handleSubmit, formState, reset } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      passengers: Array.from({ length: adults }, () => ({ firstName: '', lastName: '' })),
      email: '',
      phone: '',
      acceptFareRules: false,
    },
  });
  const { fields } = useFieldArray({ control, name: 'passengers' });

  // Prefill contact details once the profile loads.
  useEffect(() => {
    if (!me) return;
    const [first, ...rest] = me.user.fullName.split(' ');
    reset((v) => ({
      ...v,
      email: v.email || me.user.email,
      phone: v.phone || me.user.phone || '',
      passengers: v.passengers.map((p, i) => (i === 0 && !p.firstName && !p.lastName ? { firstName: first ?? '', lastName: rest.join(' ') } : p)),
    }));
  }, [me, reset]);

  if (lockQuery.isPending) {
    return (
      <div className="container-page max-w-5xl py-10">
        <p className="mb-4 flex items-center gap-2 text-sm text-ink-2">
          <Lock className="size-4" aria-hidden /> Confirming price and seats with the airline…
        </p>
        <SkeletonList count={3} />
      </div>
    );
  }
  if (lockQuery.isError) {
    const e = lockQuery.error;
    const title = isApiError(e, 'offer_expired')
      ? 'This offer has expired'
      : isApiError(e, 'offer_unavailable')
        ? 'This fare is no longer available'
        : isApiError(e, 'airline_unavailable')
          ? 'The airline is not responding'
          : 'We could not confirm this fare';
    return (
      <div className="container-page max-w-3xl py-10">
        <ErrorState title={title} error={e} onRetry={isApiError(e, 'airline_unavailable') ? () => lockQuery.refetch() : undefined} />
        <div className="mt-4 text-center">
          <Button asChild variant="secondary">
            <Link to="/flights">Search other flights</Link>
          </Button>
        </div>
      </div>
    );
  }

  const tz = offer!.originAirport.timezone;
  const lockMsLeft = new Date(lock!.expiresAt).getTime() - now;
  const lockExpired = lockMsLeft <= 0;
  const mm = Math.max(0, Math.floor(lockMsLeft / 60_000));
  const ss = Math.max(0, Math.floor((lockMsLeft % 60_000) / 1000));
  const needsAcceptance = !!priceChanged && !acceptedChange;

  const onSubmit = handleSubmit(async (v) => {
    setSubmitError(null);
    try {
      const res = await api.post<{ booking: Booking; checkoutUrl: string | null }>(
        '/flights/bookings',
        {
          priceLockId: lock!.id,
          passengers: v.passengers,
          contact: { email: v.email, phone: v.phone || undefined },
          acceptedTotalMinor: lock!.totalMinor,
          acceptFareRules: true,
        },
        { idempotencyKey: idemKey },
      );
      if (res.checkoutUrl) goToCheckout(`${res.checkoutUrl}`, navigate);
      else navigate(`/trips/flights/${res.booking.id}`);
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e : new ApiError(0, 'unknown', 'Something went wrong.'));
    }
  });

  return (
    <div className="container-page max-w-5xl py-6 sm:py-10">
      <Link to={`/flights/offers/${offerId}?adults=${adults}`} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Offer details
      </Link>
      <h1 className="t-title">Who is travelling?</h1>

      <form onSubmit={onSubmit} noValidate className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {priceChanged && (
            <Notice tone="warning" title="The airline updated this fare">
              <p>
                {formatMoney(priceChanged.previousPerAdultMinor)} → <strong>{formatMoney(priceChanged.currentPerAdultMinor)}</strong> per adult. New total{' '}
                {formatMoney(lock!.totalMinor)}.
              </p>
              {!acceptedChange && (
                <Button type="button" size="sm" className="mt-2" onClick={() => setAcceptedChange(true)}>
                  Accept new price
                </Button>
              )}
            </Notice>
          )}

          {fields.map((f, i) => (
            <Card key={f.id}>
              <CardSection>
                <h2 className="font-semibold">Traveller {i + 1} · Adult</h2>
                <p className="mb-4 text-sm text-ink-3">Enter names exactly as on the government ID used to travel.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="First and middle names" autoComplete={i === 0 ? 'given-name' : 'off'} error={formState.errors.passengers?.[i]?.firstName?.message} {...register(`passengers.${i}.firstName`)} />
                  <Input label="Last name" autoComplete={i === 0 ? 'family-name' : 'off'} error={formState.errors.passengers?.[i]?.lastName?.message} {...register(`passengers.${i}.lastName`)} />
                </div>
              </CardSection>
            </Card>
          ))}

          <Card>
            <CardSection>
              <h2 className="font-semibold">Contact details</h2>
              <p className="mb-4 text-sm text-ink-3">We send the confirmation and any schedule changes here.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Email" type="email" autoComplete="email" error={formState.errors.email?.message} {...register('email')} />
                <Input label="Mobile number" type="tel" autoComplete="tel" placeholder="+91" error={formState.errors.phone?.message} {...register('phone')} />
              </div>
            </CardSection>
          </Card>

          <Card>
            <CardSection>
              <h2 className="font-semibold">Fare rules</h2>
              <p className="t-body mt-2 text-sm">{offer!.conditions.rules}</p>
              <Controller
                control={control}
                name="acceptFareRules"
                render={({ field, fieldState }) => (
                  <div className="mt-4">
                    <Checkbox
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                      label="I have read and accept the fare rules and baggage allowance"
                      description={`Cabin ${offer!.baggage.cabinKg} kg · ${offer!.baggage.checkedKg ? `Checked ${offer!.baggage.checkedKg} kg` : 'No checked bag'} · ${offer!.conditions.refundable ? 'Refundable' : 'Non-refundable'}`}
                    />
                    {fieldState.error && (
                      <p role="alert" className="mt-1 text-sm text-danger">
                        {fieldState.error.message}
                      </p>
                    )}
                  </div>
                )}
              />
            </CardSection>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardSection className="space-y-4">
              <div className="flex items-center gap-3">
                <AirlineMark airline={offer!.airline} size="sm" />
                <div className="text-sm">
                  <p className="font-semibold">
                    {offer!.airline.name} {offer!.flightNumber}
                  </p>
                  <p className="text-ink-3">
                    {formatDate(offer!.departAt, tz)} · {CABIN_LABEL[offer!.cabin]}
                  </p>
                </div>
                {offer!.sandbox && <Badge tone="coral" className="ml-auto">Sandbox</Badge>}
              </div>
              <RouteLine from={offer!.origin} to={offer!.destination} fromLabel={formatTime(offer!.departAt, tz)} toLabel={formatTime(offer!.arriveAt, offer!.destinationAirport.timezone)} />
              <PriceBreakdown
                lines={[
                  { label: `Base fare × ${adults}`, amountMinor: (lock!.farePerAdultMinor - lock!.taxesPerAdultMinor) * adults },
                  { label: `Taxes & fees × ${adults}`, amountMinor: lock!.taxesPerAdultMinor * adults },
                ]}
                totalMinor={lock!.totalMinor}
              />
              <div className={lockExpired ? 'rounded-xl bg-amber-soft p-3 text-sm' : 'rounded-xl bg-sky p-3 text-sm'} role="status" aria-live="polite">
                {lockExpired ? (
                  <div className="flex items-center justify-between gap-2">
                    <span>Price lock expired.</span>
                    <Button type="button" size="sm" variant="secondary" onClick={() => { setAcceptedChange(false); void lockQuery.refetch(); }} loading={lockQuery.isFetching}>
                      <TimerReset className="size-4" aria-hidden /> Re-confirm price
                    </Button>
                  </div>
                ) : (
                  <span className="flex items-center gap-2">
                    <Lock className="size-4 text-primary" aria-hidden /> Price held for {mm}:{String(ss).padStart(2, '0')}
                  </span>
                )}
              </div>
              {submitError && (
                <Notice tone="danger" title={submitError.code === 'lock_expired' ? 'Your price lock expired' : 'Booking not completed'}>
                  {submitError.message}
                </Notice>
              )}
              <Button type="submit" block size="lg" loading={formState.isSubmitting} disabled={lockExpired || needsAcceptance}>
                Continue to payment · {formatMoney(lock!.totalMinor)}
              </Button>
              {needsAcceptance && <p className="text-center text-xs text-coral">Accept the updated fare to continue.</p>}
              <p className="flex items-start gap-2 text-xs text-ink-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden /> You will only see a confirmation after the airline issues your ticket.
              </p>
            </CardSection>
          </Card>
        </aside>
      </form>
    </div>
  );
}
