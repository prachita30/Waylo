import { randomBytes } from 'node:crypto';
import { addDays, haversineKm, zonedTimeToUtc } from '@waylo/shared';
import type { AdapterInfo } from '../../context';
import {
  type AirlineAdapter,
  type AirlineInfo,
  type AirlineOffer,
  type AirlineSearchQuery,
  AirlineUnavailableError,
  type CabinClass,
  type CreateOrderInput,
  type TicketingResult,
  type ValidateInput,
  type ValidateResult,
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
 * Sandbox scenario controls. Tests set these directly; manual demos can trigger ticketing
 * scenarios with the documented magic surnames TICKETDELAY and TICKETFAIL.
 */
export interface SandboxScenarios {
  /** Basis points added to the fare on validation (e.g. 800 = +8%). */
  priceChangeBps: number;
  unavailable: boolean;
  failCreateOrder: boolean;
  ticketing: 'instant' | 'delayed' | 'fail';
  /** Polls needed before a delayed ticket is issued. */
  delayedPolls: number;
}

interface SandboxOrder {
  externalRef: string;
  passengers: { firstName: string; lastName: string }[];
  mode: SandboxScenarios['ticketing'];
  polls: number;
  status: 'held' | 'paid' | 'ticketed' | 'failed' | 'cancelled';
  result?: TicketingResult;
  totalMinor: number;
  refundableMinor: number;
}

const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const pnr = () => Array.from(randomBytes(6), (b) => PNR_ALPHABET[b % PNR_ALPHABET.length]).join('');

/**
 * Deterministic sandbox airline integration. The same route, date and cabin always produce the
 * same flights and fares, so tests and demos are reproducible. It never claims to be live inventory.
 */
export class SandboxAirlineAdapter implements AirlineAdapter {
  readonly info: AdapterInfo = { kind: 'airline', provider: 'sandbox-airline', mode: 'sandbox' };
  /** Test hook: when true, every call fails like an outage. */
  outage = false;
  scenarios: SandboxScenarios = { priceChangeBps: 0, unavailable: false, failCreateOrder: false, ticketing: 'instant', delayedPolls: 2 };
  private readonly now: () => Date;
  private readonly offers = new Map<string, AirlineOffer>();
  private readonly sold = new Map<string, number>();
  private readonly orders = new Map<string, SandboxOrder>();
  private readonly orderByKey = new Map<string, string>();

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
          seatsAvailable: this.remaining(`SBX-${flightNumber}-${q.date}-${q.cabin}${lastMinute ? '-LM' : ''}`, seats),
          validFrom,
          validUntil,
        });
        // Keep the airline's total seat count; sales are subtracted on read.
        const last = offers[offers.length - 1]!;
        this.offers.set(last.externalRef, { ...last, seatsAvailable: seats });
      }
    }
    return offers;
  }

  private remaining(ref: string, base: number | null) {
    return base === null ? null : Math.max(0, base - (this.sold.get(ref) ?? 0));
  }

  async validateOffer(input: ValidateInput): Promise<ValidateResult> {
    if (this.outage) throw new AirlineUnavailableError();
    const o = this.offers.get(input.externalRef);
    const validUntil = o?.validUntil ?? input.known.validUntil;
    if (validUntil.getTime() <= this.now().getTime()) return { available: false, reason: 'expired' };
    if (this.scenarios.unavailable) return { available: false, reason: 'sold_out' };
    const seats = this.remaining(input.externalRef, o ? o.seatsAvailable : input.known.seatsAvailable);
    if (seats === 0) return { available: false, reason: 'sold_out' };
    if (seats !== null && seats < input.adults) return { available: false, reason: 'insufficient_seats' };
    const baseFare = o?.fareMinor ?? input.known.fareMinor;
    const taxes = o?.taxesMinor ?? input.known.taxesMinor;
    const fareMinor = this.scenarios.priceChangeBps ? roundTo(baseFare + (baseFare * this.scenarios.priceChangeBps) / 10_000, 100) : baseFare;
    return { available: true, fareMinor, taxesMinor: taxes, seatsAvailable: seats, validUntil };
  }

  async createOrder(input: CreateOrderInput): Promise<{ orderRef: string; holdUntil: Date }> {
    if (this.outage || this.scenarios.failCreateOrder) throw new AirlineUnavailableError('Could not hold seats');
    const holdUntil = new Date(this.now().getTime() + 30 * 60_000);
    const existing = this.orderByKey.get(input.idempotencyKey);
    if (existing) return { orderRef: existing, holdUntil };
    const surnames = input.passengers.map((p) => p.lastName.toUpperCase());
    const mode: SandboxScenarios['ticketing'] = surnames.includes('TICKETFAIL') ? 'fail' : surnames.includes('TICKETDELAY') ? 'delayed' : this.scenarios.ticketing;
    const orderRef = `SBXO-${pnr()}`;
    this.sold.set(input.externalRef, (this.sold.get(input.externalRef) ?? 0) + input.passengers.length);
    const offer = this.offers.get(input.externalRef);
    const pax = input.passengers.length;
    const refundableMinor = offer?.refundable
      ? Math.max(0, input.expectedTotalMinor - (offer.cancelFeeMinor ?? 0) * pax)
      : Math.min(input.expectedTotalMinor, (offer?.taxesMinor ?? 0) * pax);
    this.orders.set(orderRef, { externalRef: input.externalRef, passengers: input.passengers, mode, polls: 0, status: 'held', totalMinor: input.expectedTotalMinor, refundableMinor });
    this.orderByKey.set(input.idempotencyKey, orderRef);
    return { orderRef, holdUntil };
  }

  private settle(order: SandboxOrder): TicketingResult {
    if (order.result && order.result.status !== 'pending') return order.result;
    if (order.mode === 'fail') {
      order.status = 'failed';
      order.result = { status: 'failed', reason: 'Airline declined ticket issuance (sandbox scenario).' };
    } else if (order.mode === 'delayed' && order.polls < this.scenarios.delayedPolls) {
      order.polls += 1;
      order.result = { status: 'pending' };
    } else {
      order.status = 'ticketed';
      const stem = String(Date.now()).slice(-7);
      order.result = { status: 'ticketed', pnr: pnr(), ticketNumbers: order.passengers.map((_, i) => `999${stem}${i}`) };
    }
    return order.result;
  }

  async issueTicket(orderRef: string): Promise<TicketingResult> {
    if (this.outage) throw new AirlineUnavailableError();
    const order = this.orders.get(orderRef);
    // Unknown orders are never assumed to be ticketed.
    if (!order) return { status: 'failed', reason: 'Order not found at airline.' };
    if (order.status === 'cancelled') return { status: 'failed', reason: 'Order was cancelled.' };
    if (order.status === 'held') order.status = 'paid';
    return this.settle(order);
  }

  async getOrder(orderRef: string): Promise<TicketingResult> {
    if (this.outage) throw new AirlineUnavailableError();
    const order = this.orders.get(orderRef);
    if (!order) return { status: 'failed', reason: 'Order not found at airline.' };
    if (order.status === 'held') return { status: 'pending' };
    return this.settle(order);
  }

  async cancelOrder(orderRef: string): Promise<{ refundableMinor: number }> {
    if (this.outage) throw new AirlineUnavailableError();
    const order = this.orders.get(orderRef);
    if (!order) return { refundableMinor: 0 };
    const wasTicketed = order.status === 'ticketed';
    if (order.status !== 'cancelled') {
      this.sold.set(order.externalRef, Math.max(0, (this.sold.get(order.externalRef) ?? 0) - order.passengers.length));
    }
    order.status = 'cancelled';
    return { refundableMinor: wasTicketed ? order.refundableMinor : order.totalMinor };
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
