import { addDays, haversineKm, zonedTimeToUtc } from '@waylo/shared';
import type { AdapterInfo } from '../../context';
import {
  type AirlineAdapter,
  type AirlineInfo,
  type AirlineOffer,
  type AirlineSearchQuery,
  AirlineUnavailableError,
  type CabinClass,
} from './types';

/** Fictional airlines. They exist only in the sandbox and are labelled as such everywhere. */
export const SANDBOX_AIRLINES: AirlineInfo[] = [
  { code: 'S1', name: 'Saffron Air', brandColor: '#E8743B', isSandbox: true },
  { code: 'S2', name: 'Monsoon Airways', brandColor: '#13A88A', isSandbox: true },
  { code: 'S3', name: 'Konkan Jet', brandColor: '#2648E8', isSandbox: true },
];

const SLOTS = ['06:10', '07:45', '09:30', '11:55', '14:20', '16:40', '18:15', '20:35', '22:50'];
const CABIN_MULTIPLIER: Record<CabinClass, number> = { economy: 1, premium_economy: 1.6, business: 3.1 };
const REFERENCE_SOURCE = 'Airline-published regular fare for this flight (sandbox data)';

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const roundTo = (minor: number, step: number) => Math.round(minor / step) * step;

export interface SandboxAirlineOptions {
  /** Clock override for tests. */
  now?: () => Date;
}

/**
 * Deterministic sandbox airline integration. The same route, date and cabin always produce the
 * same flights and fares, so tests and demos are reproducible. It never claims to be live inventory.
 */
export class SandboxAirlineAdapter implements AirlineAdapter {
  readonly info: AdapterInfo = { kind: 'airline', provider: 'sandbox-airline', mode: 'sandbox' };
  /** Test hook: when true, every call fails like an outage. */
  outage = false;
  private readonly now: () => Date;

  constructor(opts: SandboxAirlineOptions = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  airlines() {
    return SANDBOX_AIRLINES;
  }

  async searchOffers(q: AirlineSearchQuery): Promise<AirlineOffer[]> {
    if (this.outage) throw new AirlineUnavailableError();
    if (q.origin.code === q.destination.code) return [];
    const km = haversineKm(q.origin, q.destination);
    const blockMinutes = Math.round((km / 760) * 60 + 30);
    const standardRupees = 1800 + km * 5.2;
    const now = this.now();
    const offers: AirlineOffer[] = [];

    for (const airline of SANDBOX_AIRLINES) {
      const route = rng(`${airline.code}|${q.origin.code}|${q.destination.code}`);
      const flightBase = 100 + Math.floor(route() * 800);
      const slotCount = 2 + Math.floor(route() * 3);
      const slotIdx = new Set<number>();
      while (slotIdx.size < slotCount) slotIdx.add(Math.floor(route() * SLOTS.length));

      for (const i of [...slotIdx].sort((a, b) => a - b)) {
        const slot = SLOTS[i]!;
        const departAt = zonedTimeToUtc(q.date, slot, q.origin.timezone);
        if (departAt.getTime() <= now.getTime()) continue;
        const arriveAt = new Date(departAt.getTime() + blockMinutes * 60_000);
        const r = rng(`${airline.code}|${q.origin.code}|${q.destination.code}|${q.date}|${slot}|${q.cabin}`);
        const flightNumber = `${airline.code}${flightBase + i * 2}`;
        const standard = roundTo(standardRupees * CABIN_MULTIPLIER[q.cabin] * (0.9 + r() * 0.35) * 100, 100);
        const hoursOut = (departAt.getTime() - now.getTime()) / 3_600_000;

        // Business hypothesis under test: a share of near-departure economy seats released at ₹500–₹1,000 base fare.
        const lastMinuteRoll = r();
        const lastMinute = q.cabin === 'economy' && hoursOut <= 72 && lastMinuteRoll < 0.45;
        const withReference = lastMinute || r() < 0.55;
        const discountFactor = 0.72 + r() * 0.22;
        const baseFare = lastMinute ? roundTo((500 + Math.floor(r() * 501)) * 100, 100) : roundTo(standard * discountFactor * 0.82, 100);
        const taxes = roundTo(45_000 + baseFare * 0.05, 100);
        const fare = baseFare + taxes;
        const refundable = !lastMinute && r() < 0.35;
        const soldOut = r() < 0.1;
        const seats = soldOut ? 0 : 1 + Math.floor(r() * 9);

        // Last-minute offers are released 72h before departure; all offers close 2–6h before.
        const validFrom = lastMinute ? new Date(departAt.getTime() - 72 * 3_600_000) : new Date(departAt.getTime() - 120 * 86_400_000);
        const validUntil = new Date(departAt.getTime() - (2 + Math.floor(r() * 5)) * 3_600_000);

        offers.push({
          externalRef: `SBX-${flightNumber}-${q.date}-${q.cabin}${lastMinute ? '-LM' : ''}`,
          airlineCode: airline.code,
          flightNumber,
          origin: q.origin.code,
          destination: q.destination.code,
          departAt,
          arriveAt,
          cabin: q.cabin,
          fareMinor: fare,
          taxesMinor: taxes,
          referenceFareMinor: withReference && standard > fare ? standard : null,
          referenceSource: withReference && standard > fare ? REFERENCE_SOURCE : null,
          currency: 'INR',
          baggageCabinKg: 7,
          baggageCheckedKg: q.cabin === 'business' ? 35 : lastMinute ? 0 : 15,
          refundable,
          changeFeeMinor: refundable ? 150_000 : lastMinute ? null : 300_000,
          cancelFeeMinor: refundable ? 200_000 : null,
          fareRules: lastMinute
            ? 'Last-minute fare. Non-refundable and non-changeable. Cabin bag only (7 kg); checked baggage can be added at the airport for a fee.'
            : refundable
              ? 'Refundable up to 4 hours before departure, less the cancellation fee. Changes allowed for a fee plus any fare difference.'
              : 'Non-refundable. Changes allowed up to 24 hours before departure for a fee plus any fare difference. Taxes refundable on cancellation.',
          seatsAvailable: seats,
          validFrom,
          validUntil,
        });
      }
    }
    return offers;
  }
}

/** Dates a flexible-date search covers: the requested date ± `span` days, never in the past. */
export function flexibleDates(date: string, span: number, today: string): string[] {
  const out: string[] = [];
  for (let d = -span; d <= span; d++) {
    const day = addDays(date, d);
    if (day >= today) out.push(day);
  }
  return out;
}
