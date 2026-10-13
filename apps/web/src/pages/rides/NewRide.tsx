import { acceptableVehicles, LUGGAGE_UNITS, luggageUnits, partyFits, rideRequestSchema, zonedTimeToUtc } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Accessibility, Backpack, Briefcase, CarFront, Clock, Luggage, PlaneLanding, Route, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { Checkbox, Input, Segmented, Select, Textarea } from '@/components/ui/Field';
import { Notice, SkeletonList } from '@/components/ui/States';
import { Stepper } from '@/components/ui/Stepper';
import { PlaceSearch } from '@/components/travel/PlaceSearch';
import { api, ApiError, isApiError } from '@/lib/api';
import { useBooking } from '@/lib/bookings';
import { formatTime, isoDate } from '@/lib/dates';
import { type Place, type RideRequest, useServiceAreas } from '@/lib/rides';

type Pref = 'any' | 'sedan' | 'suv' | 'van';

/** Airport-local date + time → UTC ISO string, or null while incomplete. */
function toArrivalIso(date: string, time: string, tz: string): string | null {
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return null;
  try {
    return zonedTimeToUtc(date, time, tz).toISOString();
  } catch {
    return null;
  }
}

export default function NewRide() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const areas = useServiceAreas();
  const linked = useBooking(params.get('booking') ?? undefined);

  const [airport, setAirport] = useState(params.get('airport') ?? 'BOM');
  const [zoneChoice, setZoneId] = useState('');
  const [flightNumber, setFlightNumber] = useState(params.get('flight') ?? '');
  const [date, setDate] = useState(params.get('date') ?? isoDate(1));
  const [time, setTime] = useState('');
  const [destination, setDestination] = useState<Place | null>(null);
  const [passengers, setPassengers] = useState(1);
  const [luggage, setLuggage] = useState({ cabin: 1, medium: 1, large: 0 });
  const [pref, setPref] = useState<Pref>('any');
  const [maxWait, setMaxWait] = useState(20);
  const [maxDetour, setMaxDetour] = useState(15);
  const [wheelchair, setWheelchair] = useState(false);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const area = areas.data?.items.find((a) => a.code === airport);
  const tz = area?.timezone ?? 'Asia/Kolkata';
  // Fall back to the airport's first pickup point when the choice does not belong to it.
  const zoneId = area?.zones.some((z) => z.id === zoneChoice) ? zoneChoice : (area?.zones[0]?.id ?? '');

  // Prefill once from a confirmed WAYLO flight booking (state adjusted during render, not in an effect).
  const booking = linked.data?.booking;
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null);
  if (booking && booking.status === 'confirmed' && prefilledFrom !== booking.id) {
    setPrefilledFrom(booking.id);
    const it = booking.itinerary;
    const arrTz = it.destinationAirport?.timezone ?? 'Asia/Kolkata';
    setAirport(it.destination);
    setFlightNumber(it.flightNumber);
    setDate(new Intl.DateTimeFormat('en-CA', { timeZone: arrTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(it.arriveAt)));
    setTime(formatTime(it.arriveAt, arrTz));
    setPassengers(booking.adults);
  }

  const classes = acceptableVehicles(pref, wheelchair);
  const fits = classes.length > 0 && partyFits(passengers, luggage, classes);

  const arrivalIso = toArrivalIso(date, time, tz);

  const create = useMutation({
    mutationFn: (payload: unknown) => api.post<{ request: RideRequest }>('/rides/requests', payload),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['ride-requests'] });
      navigate(`/trips/rides/${r.request.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors());
        setFormError(Object.keys(e.fieldErrors()).length ? null : e.message);
        if (isApiError(e, 'duplicate_request') && (e.details as { requestId?: string } | undefined)?.requestId) {
          setFormError(`${e.message} Open it from My trips.`);
        }
      } else setFormError('Something went wrong. Please try again.');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const payload = {
      airport,
      pickupZoneId: zoneId,
      flightNumber: flightNumber || undefined,
      arrivalAt: arrivalIso ?? '',
      destination: destination ?? undefined,
      passengers,
      luggage,
      vehiclePreference: pref,
      maxWaitMinutes: maxWait,
      maxDetourMinutes: maxDetour,
      wheelchair,
      notes: notes || undefined,
      flightBookingId: booking?.status === 'confirmed' ? booking.id : undefined,
    };
    const parsed = rideRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const key = i.path[0] === 'arrivalAt' ? 'arrivalAt' : String(i.path[0]);
        map[key] ??= key === 'arrivalAt' ? 'Enter your arrival date and time.' : key === 'destination' ? 'Choose where you are going.' : i.message;
      }
      setErrors(map);
      return;
    }
    setErrors({});
    create.mutate(payload);
  };

  if (areas.isPending) return <div className="container-page max-w-4xl py-10"><SkeletonList count={3} /></div>;

  const windowEnd = arrivalIso ? new Date(new Date(arrivalIso).getTime() + maxWait * 60_000).toISOString() : null;

  return (
    <div className="container-page max-w-5xl py-6 sm:py-10">
      <p className="t-meta">Shared airport ride</p>
      <h1 className="t-title mt-1">Where are you headed after landing?</h1>
      <p className="t-body mt-2 max-w-2xl">We match you with travellers arriving around the same time and going your way. You confirm the price before anything is booked.</p>

      <form onSubmit={submit} noValidate className="mt-8 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardSection className="space-y-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <PlaneLanding className="size-5 text-primary" aria-hidden /> Your arrival
              </h2>
              {booking?.status === 'confirmed' && (
                <Notice tone="success">
                  Linked to your booking {booking.reference} ({booking.itinerary.flightNumber}). We will follow this flight.
                </Notice>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Airport" value={airport} onChange={(e) => setAirport(e.target.value)} error={errors.airport}>
                  {areas.data?.items.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.city} ({a.code})
                    </option>
                  ))}
                </Select>
                <Input label="Flight number (optional)" placeholder="e.g. 6E 5321" value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} maxLength={10} error={errors.flightNumber} hint="Lets us move your pickup if the flight is late." />
                <Input label="Arrival date" type="date" min={isoDate(0)} value={date} onChange={(e) => setDate(e.target.value)} />
                <Input label="Scheduled arrival (local time)" type="time" value={time} onChange={(e) => setTime(e.target.value)} error={errors.arrivalAt} />
              </div>
              {area && area.zones.length > 1 && (
                <Segmented label="Pickup point" value={zoneId} onChange={setZoneId} options={area.zones.map((z) => ({ value: z.id, label: z.terminal }))} />
              )}
              {area?.zones.find((z) => z.id === zoneId) && <p className="text-xs text-ink-3">{area.zones.find((z) => z.id === zoneId)!.instructions}</p>}
            </CardSection>
          </Card>

          <Card>
            <CardSection className="space-y-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <Route className="size-5 text-coral" aria-hidden /> Destination
              </h2>
              <PlaceSearch airport={airport} value={destination} onChange={setDestination} error={errors.destination} />
            </CardSection>
          </Card>

          <Card>
            <CardSection>
              <h2 className="mb-2 flex items-center gap-2 font-semibold">
                <Users className="size-5 text-mint" aria-hidden /> Travellers & luggage
              </h2>
              <div className="divide-y divide-line">
                <Stepper label="Travellers" hint="Including you" value={passengers} min={1} max={6} onChange={setPassengers} icon={<Users className="size-4" aria-hidden />} />
                <Stepper label="Cabin bags" hint="Backpacks, small trolleys" value={luggage.cabin} max={12} onChange={(v) => setLuggage((l) => ({ ...l, cabin: v }))} icon={<Backpack className="size-4" aria-hidden />} />
                <Stepper label="Medium suitcases" hint="Up to 23 kg" value={luggage.medium} max={12} onChange={(v) => setLuggage((l) => ({ ...l, medium: v }))} icon={<Briefcase className="size-4" aria-hidden />} />
                <Stepper label="Large suitcases" hint="Over 23 kg or oversized" value={luggage.large} max={12} onChange={(v) => setLuggage((l) => ({ ...l, large: v }))} icon={<Luggage className="size-4" aria-hidden />} />
              </div>
              {!fits && (
                <Notice tone="warning" className="mt-3">
                  {classes.length === 0 ? 'Wheelchair-accessible trips need a van. Choose “Any” or “Van”.' : 'This much luggage will not fit in a shared vehicle. Reduce bags or book a private ride.'}
                </Notice>
              )}
              {errors.luggage && <p role="alert" className="mt-2 text-sm text-danger">{errors.luggage}</p>}
            </CardSection>
          </Card>

          <Card>
            <CardSection className="space-y-5">
              <h2 className="flex items-center gap-2 font-semibold">
                <CarFront className="size-5 text-primary" aria-hidden /> Preferences
              </h2>
              <Segmented
                label="Vehicle"
                value={pref}
                onChange={setPref}
                options={[
                  { value: 'any', label: 'Any' },
                  { value: 'sedan', label: 'Sedan' },
                  { value: 'suv', label: 'SUV' },
                  { value: 'van', label: 'Van' },
                ]}
              />
              {errors.vehiclePreference && <p role="alert" className="text-sm text-danger">{errors.vehiclePreference}</p>}
              <RangeField label="Longest I will wait after landing" value={maxWait} min={10} max={60} step={5} onChange={setMaxWait} unit="min" />
              <RangeField label="Extra travel time I accept for shared stops" value={maxDetour} min={5} max={30} step={5} onChange={setMaxDetour} unit="min" />
              <Checkbox
                checked={wheelchair}
                onChange={(e) => setWheelchair(e.target.checked)}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <Accessibility className="size-4" aria-hidden /> I need a wheelchair-accessible vehicle
                  </span>
                }
              />
              <Textarea label="Notes for the driver (optional)" maxLength={280} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. travelling with a child seat" />
            </CardSection>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardSection className="space-y-4">
              <h2 className="font-semibold">Summary</h2>
              <dl className="space-y-2 text-sm">
                <Row icon={<Clock className="size-4" aria-hidden />} label="Matching window">
                  {arrivalIso ? `${formatTime(arrivalIso, tz)}–${formatTime(windowEnd!, tz)}` : 'Add your arrival time'}
                </Row>
                <Row icon={<Users className="size-4" aria-hidden />} label="Party">
                  {passengers} traveller{passengers > 1 ? 's' : ''} · {luggageUnits(luggage)} bag units
                </Row>
                <Row icon={<Route className="size-4" aria-hidden />} label="Destination">
                  {destination?.area ?? '—'}
                </Row>
              </dl>
              <p className="text-xs text-ink-3">
                Bag units: cabin {LUGGAGE_UNITS.cabin}, medium {LUGGAGE_UNITS.medium}, large {LUGGAGE_UNITS.large}. Vehicles are matched to fit everyone’s luggage.
              </p>
              {formError && <Notice tone="danger">{formError}</Notice>}
              <Button type="submit" block size="lg" variant="mint" loading={create.isPending} disabled={!fits}>
                Find riders
              </Button>
              <p className="text-xs text-ink-3">
                No charge now. You will see the price split before you confirm a group. <Badge tone="lavender">Free to cancel before confirming</Badge>
              </p>
            </CardSection>
          </Card>
        </aside>
      </form>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-ink-3">
        {icon} {label}
      </dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}

function RangeField({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  return (
    <div>
      <label htmlFor={id} className="flex justify-between text-sm font-semibold">
        <span>{label}</span>
        <span className="text-primary tabular-nums">
          {value} {unit}
        </span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[var(--primary)]" />
    </div>
  );
}
