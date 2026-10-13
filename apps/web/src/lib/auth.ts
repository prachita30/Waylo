import type { LoginInput, Preferences, RegisterInput, Role } from '@waylo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isApiError } from './api';

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  status: string;
  homeAirport: string | null;
  avatarUrl: string | null;
  isDemo: boolean;
  createdAt: string;
}
export interface SavedDestination {
  cityId: string;
  name: string;
  state: string;
  savedAt: string;
}
export interface Me {
  user: User;
  preferences: Preferences;
  savedDestinations: SavedDestination[];
}

export const ME_KEY = ['me'] as const;

/** Current session. Resolves to null when signed out (401), never throws for that case. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.get<Me>('/users/me');
      } catch (e) {
        if (isApiError(e) && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<{ user: User }>('/auth/login', input),
    onSuccess: async () => {
      qc.clear();
      await qc.fetchQuery({ queryKey: ME_KEY, queryFn: () => api.get<Me>('/users/me') });
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<{ user: User }>('/auth/register', input),
    onSuccess: async () => {
      qc.clear();
      await qc.fetchQuery({ queryKey: ME_KEY, queryFn: () => api.get<Me>('/users/me') });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(ME_KEY, null);
    },
  });
}

/** Updates the cached profile after a successful mutation. */
export function useUpdateMe() {
  const qc = useQueryClient();
  return (patch: Partial<Me>) => qc.setQueryData<Me | null>(ME_KEY, (old) => (old ? { ...old, ...patch } : old));
}

export function homeForRole(role: Role): string {
  switch (role) {
    case 'operator':
      return '/operator';
    case 'partner':
      return '/partner';
    case 'admin':
      return '/admin';
    default:
      return '/';
  }
}

/** Only allow same-site relative redirect targets (prevents open redirects via ?next=). */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
