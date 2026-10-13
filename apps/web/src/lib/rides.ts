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
  groupId: string | null;
  airport: string;
  pickupZone: PickupZone | null;
  flightNumber: string | null;
  flightLinked: boolean;
  flight: { status: string; scheduledArrivalAt: string; estimatedArrivalAt: string | null; delayMinutes: number; updatedAt: string | null } | null;
  closedReason: string | null;
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

// ------------------------------------------------------------------ matching

export interface Price {
  fareShareMinor: number;
  platformFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
}
export interface VehicleFareBreakdown {
  baseMinor: number;
  distanceMinor: number;
  timeMinor: number;
  extraStopsMinor: number;
  airportAccessMinor: number;
  tollsMinor: number;
  totalMinor: number;
}
export interface MatchOption {
  groupId?: string;
  splitMethod: 'equal_per_seat' | 'distance_weighted';
  lockAt?: string;
  vehicleClass: 'sedan' | 'suv' | 'van';
  capacity: { seats: number; luggageUnits: number };
  seatsUsed: number;
  luggageUsed: number;
  plannedPickupAt: string;
  route: { order: number; area: string; isMe: boolean }[];
  routeDistanceMeters: number;
  routeDurationSeconds: number;
  members: { firstName: string; area: string; seats: number; avatarUrl: string | null }[];
  you: { waitMinutes: number; detourMinutes: number; rideMinutes: number; dropoffAt: string; dropoffOrder: number; price: Price; solo: Price; savingsPercent: number };
  vehicleFare: VehicleFareBreakdown;
  score: number;
}
export interface RidePolicy {
  beforeLock: string;
  afterLock: string;
  waiting: string;
  priceGuarantee: string;
}
export interface MatchesResponse {
  requestId: string;
  groups: (MatchOption & { groupId: string })[];
  newGroup: MatchOption | null;
  newGroupBlockedBy: string[] | null;
  compatibleOpenRequests: number;
  policy: RidePolicy;
}
export interface RideGroup {
  id: string;
  status: 'forming' | 'locked' | 'assigned' | 'en_route' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';
  airport: string;
  pickupZone: PickupZone | null;
  vehicleClass: 'sedan' | 'suv' | 'van';
  capacity: { seats: number; luggageUnits: number };
  seatsTaken: number;
  luggageTaken: number;
  splitMethod: 'equal_per_seat' | 'distance_weighted';
  plannedPickupAt: string;
  lockAt: string;
  lockedAt: string | null;
  route: { distanceMeters: number; durationSeconds: number };
  vehicleFare: VehicleFareBreakdown;
  members: { isMe: boolean; firstName: string; avatarUrl: string | null; area: string; seats: number; dropoffOrder: number; estimatedDropoffAt: string; readiness: Readiness }[];
  map: { pickup: { lat: number; lng: number } | null; stops: { order: number; area: string; isMe: boolean; lat: number; lng: number }[] };
  me: {
    participantId: string;
    requestId: string;
    status: string;
    seats: number;
    waitMinutes: number;
    detourMinutes: number;
    estimatedDropoffAt: string;
    price: Price;
    maxTotalMinor: number;
    finalTotalMinor: number | null;
    soloTotalMinor: number;
    soloOk: boolean;
    readiness: Readiness;
    removedReason: string | null;
    cancellationFeeMinor: number | null;
    leaveFeeNowMinor: number | null;
  } | null;
  trip: { driverFirstName: string; vehicle: { makeModel: string; colour: string; registration: string; vehicleClass: string }; assignedAt: string; location: { lat: number; lng: number; at: string } | null } | null;
  policy: RidePolicy;
  cancelReason: string | null;
}

export function useMatches(requestId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['ride-matches', requestId],
    queryFn: () => api.get<MatchesResponse>(`/rides/requests/${requestId}/matches`),
    enabled: !!requestId && enabled,
    refetchInterval: 20_000,
  });
}

export function useGroup(groupId: string | null | undefined) {
  return useQuery({
    queryKey: ['ride-group', groupId],
    queryFn: () => api.get<{ group: RideGroup }>(`/rides/groups/${groupId}`).then((r) => r.group),
    enabled: !!groupId,
    refetchInterval: (q) => (q.state.data && ['forming', 'locked', 'assigned', 'en_route', 'arrived', 'in_progress'].includes(q.state.data.status) ? 10_000 : false),
  });
}

export const VEHICLE_LABEL = { sedan: 'Sedan', suv: 'SUV', van: 'Van' } as const;

export type Readiness = 'not_landed' | 'landed' | 'at_baggage' | 'ready' | 'at_pickup';
export const READINESS_LABEL: Record<Readiness, string> = {
  not_landed: 'Not landed yet',
  landed: 'Landed',
  at_baggage: 'Waiting for bags',
  ready: 'Have bags, heading out',
  at_pickup: 'At the pickup point',
};
