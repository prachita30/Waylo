import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Availability = 'available' | 'limited' | 'sold_out' | 'insufficient' | 'expired';

export interface Offer {
  id: string;
  airline: { code: string; name: string; color: string; sandbox: boolean };
  flightNumber: string;
  origin: string;
  destination: string;
  departAt: string;
  arriveAt: string;
  durationMinutes: number;
  cabin: 'economy' | 'premium_economy' | 'business';
  currency: string;
  farePerAdultMinor: number;
  taxesPerAdultMinor: number;
  totalMinor: number;
  saving: { referenceFareMinor: number; amountMinor: number; percent: number; source: string } | null;
  baggage: { cabinKg: number; checkedKg: number };
  conditions: { refundable: boolean; changeFeeMinor: number | null; cancelFeeMinor: number | null; rules: string };
  eligibility: { maxPassengers?: number; minAdvanceHours?: number; notes?: string };
  seatsLeft: number | null;
  availability: Availability;
  expiresAt: string;
  source: 'airline' | 'partner';
  sandbox: boolean;
  flightStatus: string;
}

export interface OfferDetail extends Offer {
  originAirport: { code: string; name: string; city: string; timezone: string };
  destinationAirport: { code: string; name: string; city: string; timezone: string };
}

export interface SearchResult {
  query: { origin: { code: string; city: string }; destination: { code: string; city: string }; adults: number; date: string };
  items: Offer[];
  total: number;
  page: number;
  pageSize: number;
  priceRange: { minMinor: number; maxMinor: number } | null;
  flexibleDates: { date: string; cheapestMinor: number | null }[] | null;
  warnings: string[];
}

export function useFlightSearch(params: URLSearchParams, enabled: boolean) {
  const query = Object.fromEntries(params.entries());
  return useQuery({
    queryKey: ['flight-search', query],
    queryFn: ({ signal }) => api.get<SearchResult>('/flights/search', { query, signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useOffer(id: string | undefined, adults: number) {
  return useQuery({
    queryKey: ['offer', id, adults],
    queryFn: () => api.get<{ offer: OfferDetail }>(`/flights/offers/${id}`, { query: { adults } }).then((r) => r.offer),
    enabled: !!id,
  });
}

export const CABIN_LABEL: Record<Offer['cabin'], string> = { economy: 'Economy', premium_economy: 'Premium economy', business: 'Business' };

export function availabilityLabel(o: Pick<Offer, 'availability' | 'seatsLeft'>): string {
  switch (o.availability) {
    case 'sold_out':
      return 'Sold out';
    case 'insufficient':
      return o.seatsLeft !== null ? `Only ${o.seatsLeft} seat${o.seatsLeft === 1 ? '' : 's'} left` : 'Not enough seats';
    case 'expired':
      return 'Offer expired';
    case 'limited':
      return `${o.seatsLeft} seat${o.seatsLeft === 1 ? '' : 's'} left at this fare`;
    default:
      return 'Available';
  }
}

export const isBookable = (o: Pick<Offer, 'availability'>) => o.availability === 'available' || o.availability === 'limited';
