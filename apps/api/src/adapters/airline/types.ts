import type { Adapter } from '../../context';

export type CabinClass = 'economy' | 'premium_economy' | 'business';

export interface AirlineAirport {
  code: string;
  lat: number;
  lng: number;
  timezone: string;
}

export interface AirlineSearchQuery {
  origin: AirlineAirport;
  destination: AirlineAirport;
  /** Local calendar date at the origin airport, yyyy-mm-dd. */
  date: string;
  cabin: CabinClass;
  adults: number;
}

/** An offer exactly as the airline (or authorised distributor) returned it. */
export interface AirlineOffer {
  externalRef: string;
  airlineCode: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departAt: Date;
  arriveAt: Date;
  cabin: CabinClass;
  fareMinor: number;
  taxesMinor: number;
  referenceFareMinor: number | null;
  referenceSource: string | null;
  currency: string;
  baggageCabinKg: number;
  baggageCheckedKg: number;
  refundable: boolean;
  changeFeeMinor: number | null;
  cancelFeeMinor: number | null;
  fareRules: string;
  seatsAvailable: number | null;
  validFrom: Date;
  validUntil: Date;
}

export interface AirlineInfo {
  code: string;
  name: string;
  brandColor: string;
  isSandbox: boolean;
}

/**
 * Integration boundary with an airline or authorised distribution partner.
 * Implementations must reflect the partner's real capabilities and permissions:
 * an interface existing here does not mean any airline has granted access.
 */
export interface AirlineAdapter extends Adapter {
  /** Airlines this integration can sell. */
  airlines(): AirlineInfo[];
  searchOffers(query: AirlineSearchQuery): Promise<AirlineOffer[]>;
  /** Re-confirms price and availability immediately before booking. */
  validateOffer(input: ValidateInput): Promise<ValidateResult>;
  /** Creates an unpaid order that holds seats. Must be idempotent on `idempotencyKey`. */
  createOrder(input: CreateOrderInput): Promise<{ orderRef: string; holdUntil: Date }>;
  /** Requests ticket issuance for a paid order. May complete later ("pending"). */
  issueTicket(orderRef: string): Promise<TicketingResult>;
  /** Current ticketing state of an order (used to poll delayed issuance). */
  getOrder(orderRef: string): Promise<TicketingResult>;
  /** Cancels an order (held or ticketed). Returns what the airline will refund. */
  cancelOrder(orderRef: string): Promise<{ refundableMinor: number }>;
}

export interface ValidateInput {
  externalRef: string;
  adults: number;
  /** What WAYLO last saw for this offer; adapters that cannot look up by reference fall back to it. */
  known: { fareMinor: number; taxesMinor: number; departAt: Date; validUntil: Date; seatsAvailable: number | null };
}

export type ValidateResult =
  | { available: true; fareMinor: number; taxesMinor: number; seatsAvailable: number | null; validUntil: Date }
  | { available: false; reason: 'sold_out' | 'expired' | 'withdrawn' | 'insufficient_seats' };

export interface CreateOrderInput {
  externalRef: string;
  passengers: { firstName: string; lastName: string }[];
  contact: { email: string; phone?: string | null };
  expectedTotalMinor: number;
  idempotencyKey: string;
}

export type TicketingResult =
  | { status: 'ticketed'; pnr: string; ticketNumbers: string[] }
  | { status: 'pending' }
  | { status: 'failed'; reason: string };

export class AirlineUnavailableError extends Error {
  constructor(message = 'Airline system unavailable') {
    super(message);
    this.name = 'AirlineUnavailableError';
  }
}
