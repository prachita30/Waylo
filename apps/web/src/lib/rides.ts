import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';

export interface PickupZone {
  id: string;
  terminal: string;
  name: string;
  instructions: string;
}
export interface ServiceArea {
  code: string;
  name: string;
  city: string;
  timezone: string;
  lat: number;
  lng: number;
  zones: PickupZone[];
}
export interface Place {
  placeId: string;
  label: string;
  area: string;
  lat: number;
  lng: number;
}

export type RideRequestStatus = 'open' | 'matched' | 'cancelled' | 'expired' | 'no_match' | 'completed';

export interface RideRequest {
  id: string;
  status: RideRequestStatus;
  airport: string;
  pickupZone: PickupZone | null;
  flightNumber: string | null;
  flightLinked: boolean;
  flightBookingId: string | null;
  scheduledArrivalAt: string;
  expectedArrivalAt: string;
  destination: Place;
  direct: { distanceMeters: number; durationSeconds: number };
  passengers: number;
  luggage: { cabin: number; medium: number; large: number };
  vehiclePreference: 'any' | 'sedan' | 'suv' | 'van';
  maxWaitMinutes: number;
  maxDetourMinutes: number;
  wheelchair: boolean;
  notes: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export function useServiceAreas() {
  return useQuery({
    queryKey: ['service-areas'],
    queryFn: () => api.get<{ items: ServiceArea[]; radiusKm: number }>('/rides/service-areas'),
    staleTime: 10 * 60_000,
  });
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function usePlaceSearch(q: string, airport: string) {
  const term = useDebounced(q.trim(), 250);
  return useQuery({
    queryKey: ['places', airport, term],
    queryFn: ({ signal }) => api.get<{ items: Place[] }>('/places/search', { query: { q: term, airport }, signal }).then((r) => r.items),
    enabled: term.length >= 2 && !!airport,
    staleTime: 5 * 60_000,
  });
}

export function useRideRequests() {
  return useQuery({ queryKey: ['ride-requests'], queryFn: () => api.get<{ items: RideRequest[] }>('/rides/requests').then((r) => r.items) });
}

export function useRideRequest(id: string | undefined) {
  return useQuery({
    queryKey: ['ride-request', id],
    queryFn: () => api.get<{ request: RideRequest }>(`/rides/requests/${id}`).then((r) => r.request),
    enabled: !!id,
  });
}

export const VEHICLE_PREF_LABEL = { any: 'Any vehicle', sedan: 'Sedan', suv: 'SUV', van: 'Van' } as const;

export const km = (m: number) => `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
export const mins = (s: number) => `${Math.round(s / 60)} min`;
