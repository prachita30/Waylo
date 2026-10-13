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
}

export class AirlineUnavailableError extends Error {
  constructor(message = 'Airline system unavailable') {
    super(message);
    this.name = 'AirlineUnavailableError';
  }
}
