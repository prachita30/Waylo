import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'primary' | 'mint' | 'coral' | 'amber' | 'danger' | 'lavender';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  primary: 'bg-primary-soft text-primary',
  mint: 'bg-mint-soft text-mint',
  coral: 'bg-coral-soft text-coral',
  amber: 'bg-amber-soft text-amber',
  danger: 'bg-danger-soft text-danger',
  lavender: 'bg-lavender text-ink',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {dot && <span className="live-dot size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/** Maps any domain status string to a tone and human label. Unknown statuses fall back to neutral. */
const STATUS: Record<string, { tone: Tone; label: string }> = {
  // flight bookings
  pending_payment: { tone: 'amber', label: 'Awaiting payment' },
  ticketing: { tone: 'amber', label: 'Ticketing in progress' },
  confirmed: { tone: 'mint', label: 'Confirmed' },
  ticketing_failed: { tone: 'danger', label: 'Ticketing failed' },
  payment_failed: { tone: 'danger', label: 'Payment failed' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  refund_pending: { tone: 'amber', label: 'Refund pending' },
  refunded: { tone: 'mint', label: 'Refunded' },
  expired: { tone: 'neutral', label: 'Expired' },
  // rides
  open: { tone: 'primary', label: 'Looking for riders' },
  matched: { tone: 'primary', label: 'Matched' },
  forming: { tone: 'primary', label: 'Group forming' },
  locked: { tone: 'lavender', label: 'Group locked' },
  assigned: { tone: 'mint', label: 'Driver assigned' },
  en_route: { tone: 'mint', label: 'Driver en route' },
  arrived: { tone: 'mint', label: 'Driver at pickup' },
  in_progress: { tone: 'mint', label: 'On the way' },
  completed: { tone: 'neutral', label: 'Completed' },
  no_match: { tone: 'neutral', label: 'No match found' },
  // generic
  pending: { tone: 'amber', label: 'Pending' },
  approved: { tone: 'mint', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Rejected' },
  suspended: { tone: 'danger', label: 'Suspended' },
  active: { tone: 'mint', label: 'Active' },
  draft: { tone: 'neutral', label: 'Draft' },
  published: { tone: 'mint', label: 'Published' },
  paused: { tone: 'amber', label: 'Paused' },
  succeeded: { tone: 'mint', label: 'Succeeded' },
  failed: { tone: 'danger', label: 'Failed' },
  resolved: { tone: 'mint', label: 'Resolved' },
  closed: { tone: 'neutral', label: 'Closed' },
  in_review: { tone: 'amber', label: 'In review' },
  awaiting_customer: { tone: 'lavender', label: 'Awaiting your reply' },
  escalated: { tone: 'coral', label: 'Escalated' },
};

export function statusLabel(status: string) {
  return STATUS[status]?.label ?? status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { tone: 'neutral' as Tone, label: statusLabel(status) };
  return (
    <Badge tone={s.tone} className={className}>
      {s.label}
    </Badge>
  );
}
