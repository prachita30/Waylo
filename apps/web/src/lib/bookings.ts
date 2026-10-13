import { useQuery } from '@tanstack/react-query';
import type { Refund } from '@/components/travel/RefundList';
import { api } from './api';
import type { OfferDetail } from './flights';

export type BookingStatus = 'pending_payment' | 'payment_failed' | 'ticketing' | 'confirmed' | 'ticketing_failed' | 'cancelled' | 'expired';

export interface PriceLock {
  id: string;
  adults: number;
  farePerAdultMinor: number;
  taxesPerAdultMinor: number;
  totalMinor: number;
  currency: string;
  expiresAt: string;
}

export interface LockResponse {
  lock: PriceLock;
  priceChanged: { previousPerAdultMinor: number; currentPerAdultMinor: number } | null;
  offer: OfferDetail;
}

export interface Booking {
  id: string;
  reference: string;
  status: BookingStatus;
  adults: number;
  totalMinor: number;
  currency: string;
  contact: { email: string; phone: string | null };
  itinerary: OfferDetail;
  passengers: { firstName: string; lastName: string; ticketNumber: string | null }[];
  pnr: string | null;
  ticketedAt: string | null;
  paymentDueAt: string;
  failureReason: string | null;
  cancelledAt: string | null;
  refundDueMinor: number | null;
  payment: { id: string; status: string; amountMinor: number; refundedMinor: number; failureReason: string | null; checkoutUrl: string | null } | null;
  refunds: Refund[];
  createdAt: string;
}

export type CancellationQuote = { cancellable: true; refundMinor: number; refundable: boolean } | { cancellable: false; reason: string };

/** Statuses that change without user action; the detail page polls while in them. */
export const LIVE_STATUSES: BookingStatus[] = ['pending_payment', 'ticketing'];

export function useBooking(id: string | undefined) {
  return useQuery({
    queryKey: ['booking', id],
    queryFn: () => api.get<{ booking: Booking; cancellation: CancellationQuote }>(`/flights/bookings/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && LIVE_STATUSES.includes(q.state.data.booking.status) ? 3000 : false),
  });
}

export function useBookings() {
  return useQuery({ queryKey: ['bookings'], queryFn: () => api.get<{ items: Booking[] }>('/flights/bookings').then((r) => r.items) });
}

/** Follows a provider checkout URL: in-app for the sandbox, full navigation for hosted pages. */
export function goToCheckout(url: string, navigate: (to: string) => void) {
  if (url.startsWith('/')) navigate(url);
  else window.location.assign(url);
}
