import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { ReviewStatus } from './operator';

export interface Partner {
  id: string;
  name: string;
  kind: 'airline' | 'distributor';
  phone: string;
  requestedAirlines: { code: string; name: string }[];
  authorisedAirlines: string[];
  status: ReviewStatus;
  statusReason: string | null;
  isDemo: boolean;
}

export type OfferStatus = 'draft' | 'published' | 'paused' | 'expired' | 'withdrawn';

export interface PartnerOffer {
  id: string;
  status: OfferStatus;
  flightNumber: string;
  airlineCode: string;
  origin: string;
  destination: string;
  departAt: string;
  arriveAt: string;
  cabin: 'economy' | 'premium_economy' | 'business';
  fareMinor: number;
  taxesMinor: number;
  referenceFareMinor: number | null;
  inventoryCap: number | null;
  seatsSold: number;
  seatsRemaining: number | null;
  refundable: boolean;
  validFrom: string;
  validUntil: string;
  fareRules: string;
  /** Set when WAYLO has taken the fare off sale; only WAYLO can release it. */
  adminHold?: { reason: string | null } | null;
}

export interface PartnerRoute {
  id: string;
  origin: string;
  destination: string;
  active: boolean;
}

export interface PartnerStats {
  offers: number;
  published: number;
  bookings: number;
  confirmed: number;
  seatsSold: number;
  grossBookingValueMinor: number;
  cancelled: number;
  refundedMinor: number;
  ticketingFailed: number;
}

export interface PartnerBooking {
  reference: string;
  status: string;
  seats: number;
  totalMinor: number;
  pnr: string | null;
  flightNumber: string;
  departAt: string;
  createdAt: string;
  cancelledAt: string | null;
  refundDueMinor: number | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorRole: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function usePartner() {
  return useQuery({ queryKey: ['partner-me'], queryFn: () => api.get<{ partner: Partner | null }>('/partner/me').then((r) => r.partner) });
}
export function usePartnerOffers() {
  return useQuery({ queryKey: ['partner-offers'], queryFn: () => api.get<{ items: PartnerOffer[] }>('/partner/offers').then((r) => r.items) });
}
export function usePartnerRoutes() {
  return useQuery({ queryKey: ['partner-routes'], queryFn: () => api.get<{ items: PartnerRoute[] }>('/partner/routes').then((r) => r.items) });
}
export function usePartnerStats() {
  return useQuery({ queryKey: ['partner-stats'], queryFn: () => api.get<PartnerStats>('/partner/stats') });
}

/** Converts a rupee amount typed by the partner ("3,499.50") to paise; null when it is not a valid amount. */
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export const CABIN_LABEL = { economy: 'Economy', premium_economy: 'Premium economy', business: 'Business' } as const;
