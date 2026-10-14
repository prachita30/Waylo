import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Readiness } from './rides';

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface Operator {
  id: string;
  name: string;
  phone: string;
  airports: string[];
  status: ReviewStatus;
  statusReason: string | null;
  commissionBps: number;
  isDemo: boolean;
}
export interface Membership {
  role: 'owner' | 'dispatcher' | 'driver';
  driverId: string | null;
  operator: Operator;
}
export interface Vehicle {
  id: string;
  vehicleClass: 'sedan' | 'suv' | 'van';
  makeModel: string;
  colour: string;
  registration: string;
  seats: number;
  luggageUnits: number;
  wheelchairAccessible: boolean;
  status: ReviewStatus;
  statusReason?: string | null;
}
export interface Driver {
  id: string;
  fullName: string;
  phone: string;
  licenceLast4: string;
  status: ReviewStatus;
  statusReason?: string | null;
  userId: string | null;
}
export interface FleetDocument {
  id: string;
  subjectType: 'operator' | 'driver' | 'vehicle';
  subjectId: string;
  docType: string;
  expiresOn: string | null;
  status: ReviewStatus;
  reviewNotes: string | null;
  createdAt: string;
}
export interface Shift {
  id: string;
  driverId: string;
  vehicleId: string;
  airportCode: string;
  startsAt: string;
  endsAt: string;
}
export interface Fleet {
  vehicles: Vehicle[];
  drivers: Driver[];
  documents: FleetDocument[];
  availability: Shift[];
}

export interface TripSummary {
  groupId: string;
  status: string;
  airport: string;
  pickupZone: { name: string; terminal: string; instructions: string; lat: number; lng: number };
  plannedPickupAt: string;
  vehicleClass: 'sedan' | 'suv' | 'van';
  seatsTaken: number;
  luggageTaken: number;
  parties: number;
  routeDistanceMeters: number;
  routeDurationSeconds: number;
  vehicleFareMinor: number;
  estimatedEarningMinor: number;
  wheelchairAccessibleRequired?: boolean;
}
export interface TripRider {
  participantId: string;
  firstName: string;
  status: string;
  seats: number;
  luggage: { cabin: number; medium: number; large: number };
  wheelchair: boolean;
  notes: string | null;
  readiness: Readiness;
  flightNumber: string | null;
  expectedArrivalAt: string;
  dropoffOrder: number;
  dropoff: { area: string; label: string; lat: number; lng: number };
  boardedAt: string | null;
  droppedOffAt: string | null;
}
export interface Trip extends TripSummary {
  driver: { id: string; name: string };
  vehicle: { id: string; makeModel: string; colour: string; registration: string; vehicleClass: string };
  timestamps: { assignedAt: string; enRouteAt: string | null; arrivedAt: string | null; startedAt: string | null; completedAt: string | null };
  location: { lat: number; lng: number; at: string; offRoute: boolean } | null;
  earningMinor: number | null;
  commissionMinor: number | null;
  riders: TripRider[];
}

export function useMembership() {
  return useQuery({ queryKey: ['operator-me'], queryFn: () => api.get<{ membership: Membership | null }>('/operator/me').then((r) => r.membership) });
}
export function useFleet(enabled = true) {
  return useQuery({ queryKey: ['operator-fleet'], queryFn: () => api.get<Fleet>('/operator/fleet'), enabled });
}
export function useOperatorTrips(tab: 'offers' | 'active' | 'history', enabled = true) {
  return useQuery({
    queryKey: ['operator-trips', tab],
    queryFn: () => api.get<{ items: (Trip | TripSummary)[] }>('/operator/trips', { query: { tab } }).then((r) => r.items),
    enabled,
    refetchInterval: tab === 'history' ? false : 15_000,
  });
}
export function useTrip(groupId: string | undefined) {
  return useQuery({
    queryKey: ['operator-trip', groupId],
    queryFn: () => api.get<{ trip: Trip }>(`/operator/trips/${groupId}`).then((r) => r.trip),
    enabled: !!groupId,
    refetchInterval: 10_000,
  });
}

export const DOC_LABEL: Record<string, string> = {
  operator_permit: 'Operator permit',
  insurance: 'Insurance',
  vehicle_registration: 'Registration certificate',
  fitness_certificate: 'Fitness certificate',
  driving_licence: 'Driving licence',
  police_verification: 'Police verification',
};
