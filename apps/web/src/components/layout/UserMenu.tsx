import * as Menu from '@radix-ui/react-dropdown-menu';
import { Building2, LayoutDashboard, LogOut, Plane, Ticket, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useLogout, useMe } from '@/lib/auth';

const item =
  'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink outline-none data-[highlighted]:bg-surface-2';

export function UserMenu() {
  const { data, isPending } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  if (isPending) return <span className="size-10 animate-pulse rounded-full bg-surface-2" aria-hidden />;
  if (!data) {
    return (
      <Button asChild size="sm">
        <Link to="/login">Sign in</Link>
      </Button>
    );
  }
  const { user } = data;
  const portal =
    user.role === 'operator'
      ? { to: '/operator', label: 'Operator portal', icon: LayoutDashboard }
      : user.role === 'partner'
        ? { to: '/partner', label: 'Partner portal', icon: Building2 }
        : user.role === 'admin'
          ? { to: '/admin', label: 'Admin dashboard', icon: LayoutDashboard }
          : null;

  return (
    <Menu.Root>
      <Menu.Trigger className="rounded-full" aria-label="Account menu">
        <Avatar name={user.fullName} src={user.avatarUrl} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className="z-50 w-64 rounded-2xl border border-line bg-surface p-1.5 shadow-float">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-semibold">{user.fullName}</p>
            <p className="truncate text-xs text-ink-3">{user.email}</p>
            {user.isDemo && (
              <Badge tone="coral" className="mt-2">
                Demo account
              </Badge>
            )}
          </div>
          <Menu.Separator className="my-1 h-px bg-line" />
          {portal && (
            <Menu.Item className={item} onSelect={() => navigate(portal.to)}>
              <portal.icon className="size-4 text-ink-3" aria-hidden /> {portal.label}
            </Menu.Item>
          )}
          <Menu.Item className={item} onSelect={() => navigate('/trips')}>
            <Ticket className="size-4 text-ink-3" aria-hidden /> My trips
          </Menu.Item>
          <Menu.Item className={item} onSelect={() => navigate('/flights')}>
            <Plane className="size-4 text-ink-3" aria-hidden /> Find flights
          </Menu.Item>
          <Menu.Item className={item} onSelect={() => navigate('/account')}>
            <UserRound className="size-4 text-ink-3" aria-hidden /> Profile & settings
          </Menu.Item>
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item
            className={item}
            onSelect={() =>
              logout.mutate(undefined, {
                onSettled: () => navigate('/'),
              })
            }
          >
            <LogOut className="size-4 text-ink-3" aria-hidden /> Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
