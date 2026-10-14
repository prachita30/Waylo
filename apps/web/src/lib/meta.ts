import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface AdapterInfo {
  kind: string;
  provider: string;
  mode: 'sandbox' | 'live';
}
export interface Meta {
  brand: { name: string; tagline: string; supportEmail: string };
  mode: 'demo' | 'production';
  demo: boolean;
  adapters: AdapterInfo[];
  /** Admin-controlled switches; the server enforces them, this is for messaging only. */
  features?: { flightBooking: boolean; rideRequests: boolean; partnerOnboarding: boolean; operatorOnboarding: boolean };
  demoLogin: { password: string; accounts: { email: string; fullName: string; role: string }[] } | null;
}

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: 5 * 60_000 });
}

export interface Airport {
  code: string;
  name: string;
  city: string;
  cityId: string;
  state: string;
  timezone: string;
  lat: number;
  lng: number;
}

export function useAirports() {
  return useQuery({
    queryKey: ['airports'],
    queryFn: () => api.get<{ items: Airport[] }>('/airports').then((r) => r.items),
    staleTime: 60 * 60_000,
  });
}
