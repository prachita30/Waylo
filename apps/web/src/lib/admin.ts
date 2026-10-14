import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

type Query = Record<string, string | number | boolean | undefined | null>;

/** Admin list endpoints all return `{ items }`; the query object is part of the cache key. */
export function useAdminList<T>(path: string, query: Query = {}, opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: ['admin', path, query],
    queryFn: () => api.get<{ items: T[] }>(path, { query }).then((r) => r.items),
    refetchInterval: opts.refetchInterval,
  });
}

/** Mutation that refreshes every admin query when it succeeds. */
export function useAdminAction<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }) });
}

export interface FeatureFlags {
  flightBooking: boolean;
  rideRequests: boolean;
  partnerOnboarding: boolean;
  operatorOnboarding: boolean;
}

export interface Overview {
  generatedAt: string;
  usersByRole: Record<string, number>;
  last24h: { bookingsByStatus: Record<string, number>; rideGroupsByStatus: Record<string, number>; ticketingFailed: number; failedDeliveries: number };
  attention: {
    pendingReviews: { operators: number; drivers: number; vehicles: number; documents: number; partners: number };
    openTickets: number;
    urgentTickets: number;
    openIncidents: number;
    criticalIncidents: number;
    failedRefunds: number;
  };
  features: FeatureFlags;
}
export function useOverview() {
  return useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<Overview>('/admin/overview'), refetchInterval: 30_000 });
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: 'passenger' | 'operator' | 'partner' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  isDemo: boolean;
  suspendedReason: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminOffer {
  id: string;
  status: string;
  source: string;
  partner: string | null;
  flightNumber: string;
  origin: string;
  destination: string;
  departAt: string;
  fareMinor: number;
  referenceFareMinor: number | null;
  referenceSource: string | null;
  seatsSold: number;
  inventoryCap: number | null;
  validUntil: string;
  adminHold: boolean;
  adminHoldReason: string | null;
}

export interface AdminBooking {
  id: string;
  reference: string;
  status: string;
  adults: number;
  totalMinor: number;
  contactEmail: string;
  pnr: string | null;
  failureReason: string | null;
  refundDueMinor: number | null;
  flightNumber: string;
  origin: string;
  destination: string;
  departAt: string;
  source: string;
  createdAt: string;
}

export interface AdminGroup {
  id: string;
  status: string;
  airportCode: string;
  vehicleClass: string;
  seatsTaken: number;
  seatCapacity: number;
  parties: number;
  plannedPickupAt: string;
  vehicleFareMinor: number;
  platformSubsidyMinor: number;
  routeDistanceMeters: number;
}
export interface AdminRideRequest {
  id: string;
  status: string;
  airportCode: string;
  flightNumber: string | null;
  expectedArrivalAt: string;
  destinationArea: string;
  passengers: number;
  createdAt: string;
}

export interface AdminIncident {
  id: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  status: 'open' | 'investigating' | 'resolved';
  resolution: string | null;
  reporterRole: string;
  reporter: { fullName: string; email: string };
  operatorName: string | null;
  groupId: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorRole: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PaymentRow {
  id: string;
  purpose: string;
  referenceId: string;
  amountMinor: number;
  refundedMinor: number;
  status: string;
  provider: string;
  failureReason: string | null;
  createdAt: string;
}
export interface RefundRow {
  id: string;
  paymentId: string;
  amountMinor: number;
  reason: string;
  status: string;
  failureReason: string | null;
  attempts: number;
  requestedBy: string;
  createdAt: string;
}
export interface SettlementRow {
  id: string;
  operatorName: string;
  periodStart: string;
  periodEnd: string;
  tripsCount: number;
  grossFareMinor: number;
  commissionMinor: number;
  payoutMinor: number;
  status: string;
  payoutReference: string | null;
}

export interface AdminFlight {
  id: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departAt: string;
  arriveAt: string;
  status: string;
  estimatedArriveAt: string | null;
}

export interface OutboxMessage {
  channel: 'email' | 'sms' | 'push';
  at: string;
  to: string;
  subject: string;
  html: string | null;
}

export const ROLE_LABEL: Record<AdminUser['role'], string> = { passenger: 'Passenger', operator: 'Operator', partner: 'Partner', admin: 'Admin' };
