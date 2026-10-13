import { Bell } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';
import { useMarkRead, useNotifications } from '@/lib/notifications';

export default function Notifications() {
  const q = useNotifications(100);
  const markRead = useMarkRead();
  return (
    <div className="container-page max-w-2xl py-8 sm:py-12">
      <div className="mb-6 flex items-end justify-between gap-3">
        <h1 className="t-title">Notifications</h1>
        {!!q.data?.unread && (
          <Button variant="secondary" size="sm" onClick={() => markRead.mutate('all')}>
            Mark all read
          </Button>
        )}
      </div>
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={<Bell className="size-6" aria-hidden />} title="No notifications yet" body="Booking, ride and support updates will appear here." />
      ) : (
        <ul className="space-y-2">
          {q.data.items.map((n) => {
            const inner = (
              <>
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-line' : 'bg-primary')} aria-hidden />
                <span>
                  <span className="block font-semibold">
                    {n.title}
                    {!n.readAt && <span className="sr-only"> (unread)</span>}
                  </span>
                  <span className="block text-sm text-ink-2">{n.body}</span>
                  <span className="block text-xs text-ink-3">{formatDateTime(n.createdAt)}</span>
                </span>
              </>
            );
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link to={n.link} onClick={() => !n.readAt && markRead.mutate([n.id])} className="flex gap-3 rounded-card border border-line bg-surface p-4 shadow-card hover:border-ink-3/40">
                    {inner}
                  </Link>
                ) : (
                  <div className="flex gap-3 rounded-card border border-line bg-surface p-4">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
