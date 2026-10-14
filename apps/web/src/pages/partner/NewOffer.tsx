import { formatMoney, partnerOfferSchema, zonedTimeToUtc } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { Input, Select, Textarea, Toggle } from '@/components/ui/Field';
import { EmptyState, Notice, SkeletonList } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { HOME_TZ, isoDate } from '@/lib/dates';
import { CABIN_LABEL, rupeesToPaise, usePartner, usePartnerRoutes } from '@/lib/partner';

type Form = Record<
  | 'airlineCode' | 'flightDigits' | 'route' | 'departDate' | 'departTime' | 'arriveDate' | 'arriveTime' | 'cabin'
  | 'fare' | 'taxes' | 'referenceFare' | 'referenceSource' | 'baggageCabinKg' | 'baggageCheckedKg' | 'changeFee' | 'cancelFee'
  | 'fareRules' | 'maxPassengers' | 'minAdvanceHours' | 'eligibilityNotes' | 'inventoryCap' | 'saleOpens' | 'saleCloses',
  string
> & { refundable: boolean };

/** Form fields → schema paths, so client and server errors land on the right input. */
const FIELD_FOR_PATH: Record<string, keyof Form> = {
  fareMinor: 'fare',
  taxesMinor: 'taxes',
  referenceFareMinor: 'referenceFare',
  changeFeeMinor: 'changeFee',
  cancelFeeMinor: 'cancelFee',
  validFrom: 'saleOpens',
  validUntil: 'saleCloses',
  origin: 'route',
  destination: 'route',
};

const optionalInt = (v: string) => (v.trim() === '' ? undefined : Number(v));
const optionalPaise = (v: string) => (v.trim() === '' ? undefined : (rupeesToPaise(v) ?? -1));
const istInstant = (local: string) => {
  const [date, time] = local.split('T');
  return date && time ? zonedTimeToUtc(date, time.slice(0, 5), HOME_TZ).toISOString() : '';
};

export default function NewOffer() {
  const { data: partner } = usePartner();
  const routes = usePartnerRoutes();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = isoDate(0);
  const [f, setF] = useState<Form>({
    airlineCode: partner?.authorisedAirlines[0] ?? '',
    flightDigits: '',
    route: '',
    departDate: isoDate(14),
    departTime: '',
    arriveDate: isoDate(14),
    arriveTime: '',
    cabin: 'economy',
    fare: '',
    taxes: '',
    referenceFare: '',
    referenceSource: '',
    baggageCabinKg: '7',
    baggageCheckedKg: '15',
    refundable: false,
    changeFee: '',
    cancelFee: '',
    fareRules: '',
    maxPassengers: '',
    minAdvanceHours: '',
    eligibilityNotes: '',
    inventoryCap: '',
    saleOpens: `${today}T00:00`,
    saleCloses: `${isoDate(13)}T23:59`,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof Form | 'form', string>>>({});
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  const create = useMutation({
    mutationFn: (body: unknown) => api.post('/partner/offers', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-offers'] });
      qc.invalidateQueries({ queryKey: ['partner-stats'] });
      navigate('/partner/offers');
    },
    onError: (e) => {
      if (!(e instanceof ApiError)) return setErrors({ form: 'Could not save the offer. Please try again.' });
      const fieldErrors = Object.fromEntries(Object.entries(e.fieldErrors()).map(([p, m]) => [FIELD_FOR_PATH[p] ?? p, m]));
      setErrors({ ...fieldErrors, form: e.message });
    },
  });

  if (routes.isPending) return <SkeletonList />;
  const active = (routes.data ?? []).filter((r) => r.active);
  if (!active.length) {
    return (
      <EmptyState
        title="Add a route first"
        body="Offers can only be published on routes in your network."
        action={
          <Link to="/partner/routes" className="font-semibold text-primary hover:underline">
            Manage routes
          </Link>
        }
      />
    );
  }

  const submit = (publish: boolean) => {
    const [origin, destination] = (f.route || '').split('-');
    const body = {
      airlineCode: f.airlineCode,
      flightDigits: f.flightDigits.trim(),
      origin,
      destination,
      departDate: f.departDate,
      departTime: f.departTime,
      arriveDate: f.arriveDate,
      arriveTime: f.arriveTime,
      cabin: f.cabin,
      fareMinor: rupeesToPaise(f.fare) ?? 0,
      taxesMinor: rupeesToPaise(f.taxes) ?? -1,
      referenceFareMinor: optionalPaise(f.referenceFare),
      referenceSource: f.referenceSource.trim() || undefined,
      baggageCabinKg: Number(f.baggageCabinKg),
      baggageCheckedKg: Number(f.baggageCheckedKg),
      refundable: f.refundable,
      changeFeeMinor: f.changeFee.trim() === '' ? null : (rupeesToPaise(f.changeFee) ?? -1),
      cancelFeeMinor: !f.refundable || f.cancelFee.trim() === '' ? null : (rupeesToPaise(f.cancelFee) ?? -1),
      fareRules: f.fareRules,
      maxPassengers: optionalInt(f.maxPassengers),
      minAdvanceHours: optionalInt(f.minAdvanceHours),
      eligibilityNotes: f.eligibilityNotes.trim() || undefined,
      inventoryCap: Number(f.inventoryCap),
      validFrom: istInstant(f.saleOpens),
      validUntil: istInstant(f.saleCloses),
      publish,
    };
    const parsed = partnerOfferSchema.safeParse(body);
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const i of parsed.error.issues) {
        const k = FIELD_FOR_PATH[String(i.path[0])] ?? (String(i.path[0]) as keyof Form);
        next[k] ??= i.message;
      }
      return setErrors(next);
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  const fareMinor = rupeesToPaise(f.fare);
  const refMinor = rupeesToPaise(f.referenceFare);
  const saving = fareMinor && refMinor && refMinor > fareMinor ? refMinor - fareMinor : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New offer" description="Times are local to each airport. Sale window times are India Standard Time. Prices are all-inclusive per adult." />
      <form
        noValidate
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit(true);
        }}
      >
        <Card>
          <CardSection className="grid gap-4 sm:grid-cols-2">
            <h2 className="t-section sm:col-span-2">Flight</h2>
            <Select label="Airline" value={f.airlineCode} onChange={(e) => set('airlineCode', e.target.value)} error={errors.airlineCode}>
              {partner?.authorisedAirlines.map((c) => (
                <option key={c} value={c}>
                  {partner.requestedAirlines.find((a) => a.code === c)?.name ?? c} ({c})
                </option>
              ))}
            </Select>
            <Input label="Flight number" hint={`Digits only, e.g. 412 for ${f.airlineCode}412`} inputMode="numeric" value={f.flightDigits} onChange={(e) => set('flightDigits', e.target.value)} error={errors.flightDigits} />
            <Select label="Route" value={f.route} onChange={(e) => set('route', e.target.value)} error={errors.route} wrapperClassName="sm:col-span-2">
              <option value="">Choose a route</option>
              {active.map((r) => (
                <option key={r.id} value={`${r.origin}-${r.destination}`}>
                  {r.origin} → {r.destination}
                </option>
              ))}
            </Select>
            <Input label="Departure date" type="date" min={today} value={f.departDate} onChange={(e) => set('departDate', e.target.value)} error={errors.departDate} />
            <Input label="Departure time" type="time" value={f.departTime} onChange={(e) => set('departTime', e.target.value)} error={errors.departTime} />
            <Input label="Arrival date" type="date" min={today} value={f.arriveDate} onChange={(e) => set('arriveDate', e.target.value)} error={errors.arriveDate} />
            <Input label="Arrival time" type="time" value={f.arriveTime} onChange={(e) => set('arriveTime', e.target.value)} error={errors.arriveTime} />
            <Select label="Cabin" value={f.cabin} onChange={(e) => set('cabin', e.target.value)}>
              {Object.entries(CABIN_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </CardSection>
        </Card>

        <Card>
          <CardSection className="grid gap-4 sm:grid-cols-2">
            <h2 className="t-section sm:col-span-2">Price</h2>
            <Input label="All-inclusive fare per adult (₹)" inputMode="decimal" value={f.fare} onChange={(e) => set('fare', e.target.value)} error={errors.fare} />
            <Input label="Of which taxes and fees (₹)" inputMode="decimal" value={f.taxes} onChange={(e) => set('taxes', e.target.value)} error={errors.taxes} />
            <Input
              label="Regular fare for comparison (₹, optional)"
              hint="Travellers only see a saving when you give a regular fare and its source."
              inputMode="decimal"
              value={f.referenceFare}
              onChange={(e) => set('referenceFare', e.target.value)}
              error={errors.referenceFare}
            />
            <Input label="Source of the regular fare" placeholder="e.g. Published fare on airline website, same flight and cabin" value={f.referenceSource} onChange={(e) => set('referenceSource', e.target.value)} error={errors.referenceSource} />
            {saving && (
              <p className="t-body text-sm sm:col-span-2" aria-live="polite">
                Travellers will see a saving of <strong>{formatMoney(saving)}</strong> ({Math.floor((saving / refMinor!) * 100)}%) against the regular fare.
              </p>
            )}
          </CardSection>
        </Card>

        <Card>
          <CardSection className="grid gap-4 sm:grid-cols-2">
            <h2 className="t-section sm:col-span-2">Fare rules</h2>
            <Input label="Cabin baggage (kg)" inputMode="numeric" value={f.baggageCabinKg} onChange={(e) => set('baggageCabinKg', e.target.value)} error={errors.baggageCabinKg} />
            <Input label="Checked baggage (kg)" inputMode="numeric" value={f.baggageCheckedKg} onChange={(e) => set('baggageCheckedKg', e.target.value)} error={errors.baggageCheckedKg} />
            <div className="sm:col-span-2">
              <Toggle label="Refundable" description="Cancelled bookings are refunded minus the cancellation fee." checked={f.refundable} onChange={(v) => set('refundable', v)} />
            </div>
            <Input label="Change fee (₹, blank if changes are not allowed)" inputMode="decimal" value={f.changeFee} onChange={(e) => set('changeFee', e.target.value)} error={errors.changeFee} />
            {f.refundable && <Input label="Cancellation fee (₹)" inputMode="decimal" value={f.cancelFee} onChange={(e) => set('cancelFee', e.target.value)} error={errors.cancelFee} />}
            <Textarea
              label="Fare rules shown to travellers"
              wrapperClassName="sm:col-span-2"
              rows={4}
              value={f.fareRules}
              onChange={(e) => set('fareRules', e.target.value)}
              error={errors.fareRules}
            />
          </CardSection>
        </Card>

        <Card>
          <CardSection className="grid gap-4 sm:grid-cols-2">
            <h2 className="t-section sm:col-span-2">Availability and eligibility</h2>
            <Input label="Seats WAYLO may sell" inputMode="numeric" value={f.inventoryCap} onChange={(e) => set('inventoryCap', e.target.value)} error={errors.inventoryCap} />
            <Input label="Max travellers per booking (optional)" inputMode="numeric" value={f.maxPassengers} onChange={(e) => set('maxPassengers', e.target.value)} error={errors.maxPassengers} />
            <Input label="Book at least this many hours ahead (optional)" inputMode="numeric" value={f.minAdvanceHours} onChange={(e) => set('minAdvanceHours', e.target.value)} error={errors.minAdvanceHours} />
            <Input label="Eligibility notes (optional)" value={f.eligibilityNotes} onChange={(e) => set('eligibilityNotes', e.target.value)} error={errors.eligibilityNotes} />
            <Input label="Sale opens (IST)" type="datetime-local" value={f.saleOpens} onChange={(e) => set('saleOpens', e.target.value)} error={errors.saleOpens} />
            <Input label="Sale closes (IST)" type="datetime-local" hint="Must be before departure." value={f.saleCloses} onChange={(e) => set('saleCloses', e.target.value)} error={errors.saleCloses} />
          </CardSection>
        </Card>

        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" disabled={create.isPending} onClick={() => submit(false)}>
            Save as draft
          </Button>
          <Button type="submit" loading={create.isPending}>
            Publish offer
          </Button>
        </div>
      </form>
    </div>
  );
}
