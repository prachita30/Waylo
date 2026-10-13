import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useMe } from './auth';

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function useNotifications(limit = 30) {
  const { data: me } = useMe();
  return useQuery({
    queryKey: ['notifications', limit],
    queryFn: () => api.get<{ items: AppNotification[]; unread: number }>('/notifications', { query: { limit } }),
    enabled: !!me,
    refetchInterval: 30_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[] | 'all') => api.post('/notifications/read', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
