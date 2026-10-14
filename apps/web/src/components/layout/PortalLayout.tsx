import { type LucideIcon, MoreHorizontal } from 'lucide-react';
import { Suspense, type ReactNode, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { Badge } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';
import { DemoBanner, PageFallback, ThemeToggle } from './AppShell';
import { UserMenu } from './UserMenu';

export interface PortalNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Shared shell for the operator, partner and admin portals: sidebar on desktop, bottom bar on mobile. */
export function PortalLayout({ title, nav, home, banner }: { title: string; nav: PortalNavItem[]; home: string; banner?: ReactNode }) {
  // On phones the bottom bar holds five slots; longer menus show four plus a "More" sheet.
  const overflow = nav.length > 5;
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const inOverflow = overflow && nav.slice(4).some((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <DemoBanner />
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
          <Link to={home} className="flex items-center gap-3 rounded-lg">
            <Logo />
            <Badge tone="lavender">{title}</Badge>
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <nav aria-label={`${title} navigation`} className="hidden w-60 shrink-0 border-r border-line p-3 md:block">
          <ul className="sticky top-20 space-y-1">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition', isActive ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')
                  }
                >
                  <Icon className="size-4" aria-hidden /> {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-10">
          {banner}
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <nav aria-label={`${title} navigation`} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <ul className="flex justify-around">
          {(overflow ? nav.slice(0, 4) : nav).map(({ to, label, icon: Icon, end }) => (
            <li key={to} className="flex-1">
              <NavLink to={to} end={end} className={({ isActive }) => cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold', isActive ? 'text-primary' : 'text-ink-3')}>
                <Icon className="size-5" aria-hidden />
                {label}
              </NavLink>
            </li>
          ))}
          {overflow && (
            <li className="flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                className={cn('flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold', inOverflow ? 'text-primary' : 'text-ink-3')}
              >
                <MoreHorizontal className="size-5" aria-hidden />
                More
              </button>
            </li>
          )}
        </ul>
      </nav>
      {overflow && (
        <Dialog open={moreOpen} onOpenChange={setMoreOpen} title={`${title} sections`}>
          <ul className="grid grid-cols-2 gap-2">
            {nav.slice(4).map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) => cn('flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold', isActive ? 'bg-surface-2 text-primary' : 'text-ink-2 hover:bg-surface-2')}
                >
                  <Icon className="size-4" aria-hidden /> {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      <ScrollRestoration />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="t-title">{title}</h1>
        {description && <p className="t-body mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
