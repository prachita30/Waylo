import { formatMoney } from '@waylo/shared';
import { RotateCcw } from 'lucide-react';
import { StatusBadge } from '@/components/ui/Badge';
import { formatDateTime } from '@/lib/dates';

export interface Refund {
  id: string;
  amountMinor: number;
  reason: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  failureReason: string | null;
  createdAt: string;
  processedAt: string | null;
}

const REASON: Record<string, string> = {
  flight_cancellation: 'Booking cancelled',
  ticketing_failed: 'Ticket not issued',
  late_payment: 'Payment after booking closed',
  ride_left_after_lock: 'Left the ride (less fee)',
  ride_removed: 'Removed from the ride',
  ride_payment_after_release: 'Payment after seat was released',
  admin_goodwill: 'Goodwill refund',
};

const STATUS: Record<Refund['status'], string> = { pending: 'refund_pending', processing: 'refund_pending', succeeded: 'refunded', failed: 'in_review' };

/** Refund history for a booking or ride, with honest status (pending until the provider confirms). */
export function RefundList({ refunds }: { refunds: Refund[] }) {
  if (!refunds.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <RotateCcw className="size-4" aria-hidden /> Refunds
      </h3>
      <ul className="space-y-2">
        {refunds.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <span>
              <span className="t-price font-semibold">{formatMoney(r.amountMinor)}</span>
              <span className="block text-xs text-ink-3">
                {REASON[r.reason] ?? r.reason} · {formatDateTime(r.processedAt ?? r.createdAt)}
              </span>
            </span>
            <StatusBadge status={STATUS[r.status]} />
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-3">Refunds go back to your original payment method. Banks usually take 5–7 working days to show them.</p>
    </div>
  );
}
