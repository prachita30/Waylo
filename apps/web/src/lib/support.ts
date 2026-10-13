import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type TicketStatus = 'open' | 'in_review' | 'awaiting_customer' | 'resolved' | 'closed';
export interface TicketSummary {
  id: string;
  reference: string;
  category: 'booking' | 'ride' | 'payment_refund' | 'account' | 'safety' | 'other';
  subject: string;
  status: TicketStatus;
  priority: 'normal' | 'high' | 'urgent';
  relatedBookingRef: string | null;
  relatedGroupId: string | null;
  lastActivityAt: string;
  createdAt: string;
}
export interface TicketMessage {
  id: string;
  author: string;
  authorRole: 'customer' | 'agent';
  body: string;
  internal: boolean;
  attachment: { name: string | null; type: string | null; url: string } | null;
  createdAt: string;
}
export interface Ticket extends TicketSummary {
  messages: TicketMessage[];
  incidentId: string | null;
}

export const CATEGORY_LABEL: Record<TicketSummary['category'], string> = {
  booking: 'Flight booking',
  ride: 'Shared ride',
  payment_refund: 'Payment or refund',
  account: 'Account',
  safety: 'Safety concern',
  other: 'Something else',
};

export function useTickets() {
  return useQuery({ queryKey: ['tickets'], queryFn: () => api.get<{ items: TicketSummary[] }>('/support/tickets').then((r) => r.items) });
}
export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get<{ ticket: Ticket }>(`/support/tickets/${id}`).then((r) => r.ticket),
    enabled: !!id,
    refetchInterval: 30_000,
  });
}
