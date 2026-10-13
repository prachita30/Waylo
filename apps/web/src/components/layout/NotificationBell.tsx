import * as Popover from '@radix-ui/react-dropdown-menu';
import { Bell, CheckCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/dates';
import { useMarkRead, useNotifications } from '@/lib/notifications';

/** Header bell: unread count, latest notifications, mark as read on open. */
export function NotificationBell() {
  const { data: me } = useMe();
  const q = useNotifications(8);
  const markRead = useMarkRead();
  const navigate = useNavigate();
  if (!me) return null;
  const unread = q.data?.unread ?? 0;
  return (
    <Popover.Root>
      <Popover.Trigger className="relative grid size-10 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-coral px-1 text-[0.6rem] font-bold text-white" aria-hidden>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(92vw,22rem)] rounded-2xl border border-line bg-surface p-1.5 shadow-float">
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" className="flex items-center gap-1 text-xs font-semibold text-primary" onClick={() => markRead.mutate('all')}>
                <CheckCheck className="size-3.5" aria-hidden /> Mark all read
              </button>
            )}
          </div>
          {q.data?.items.length ? (
            q.data.items.map((n) => (
              <Popover.Item
                key={n.id}
                onSelect={() => {
                  if (!n.readAt) markRead.mutate([n.id]);
                  if (n.link) navigate(n.link);
                }}
                className={cn('flex cursor-pointer gap-3 rounded-xl px-3 py-2.5 outline-none data-[highlighted]:bg-surface-2', !n.readAt && 'bg-primary-soft/40')}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{n.title}</span>
                  <span className="line-clamp-2 block text-xs text-ink-2">{n.body}</span>
                  <span className="mt-0.5 block text-[0.7rem] text-ink-3">{relativeTime(n.createdAt)}</span>
                </span>
              </Popover.Item>
            ))
          ) : (
            <p className="px-3 py-6 text-center text-sm text-ink-3">You are all caught up.</p>
          )}
          <Popover.Separator className="my-1 h-px bg-line" />
          <Popover.Item asChild className="block rounded-xl px-3 py-2 text-center text-sm font-semibold text-primary outline-none data-[highlighted]:bg-surface-2">
            <Link to="/notifications">See all</Link>
          </Popover.Item>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
