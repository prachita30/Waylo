import { brand } from '@waylo/shared';
import { CarFront, Home, Moon, Plane, Sun, SunMoon, Ticket, UserRound } from 'lucide-react';
import { Suspense, type ReactNode } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { SkeletonList } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import { useMeta } from '@/lib/meta';
import { type ThemePref, useTheme } from '@/lib/theme';

export interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
}

export const PASSENGER_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/flights', label: 'Flights', icon: Plane },
  { to: '/rides', label: 'Rides', icon: CarFront },
  { to: '/trips', label: 'Trips', icon: Ticket },
  { to: '/account', label: 'Profile', icon: UserRound },
];

export function DemoBanner() {
  const { data } = useMeta();
  if (!data?.demo) return null;
  const sandboxed = data.adapters.filter((a) => a.mode === 'sandbox').map((a) => a.kind);
  return (
    <div className="bg-[#0E1A2B] text-[#FAF7F2]" role="note" aria-label="Demo mode">
      <div className="container-page flex items-center justify-center gap-2 py-1.5 text-center text-xs font-medium">
        <span className="rounded-full bg-[#F2705B] px-2 py-0.5 text-[0.65rem] font-bold tracking-wider text-[#0E1A2B] uppercase">Demo</span>
        <span>
          Simulated environment. Offers, payments{sandboxed.includes('maps') ? ', maps' : ''} and drivers are sandboxed. No real tickets or rides are booked.
        </span>
      </div>
    </div>
  );
}

const THEME_CYCLE: ThemePref[] = ['system', 'light', 'dark'];

export function ThemeToggle({ className }: { className?: string }) {
  const { pref, set } = useTheme();
  const Icon = pref === 'light' ? Sun : pref === 'dark' ? Moon : SunMoon;
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(pref) + 1) % THEME_CYCLE.length]!;
  return (
    <button
      type="button"
      onClick={() => set(next)}
      className={cn('grid size-10 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink', className)}
      aria-label={`Theme: ${pref}. Switch to ${next}.`}
      title={`Theme: ${pref}`}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

export function Header({ nav, right, home = '/' }: { nav: NavItem[]; right?: ReactNode; home?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/85 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link to={home} className="rounded-lg" aria-label={`${brand.name} home`}>
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'rounded-full px-4 py-2 text-sm font-semibold transition',
                  isActive ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink',
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {right}
        </div>
      </div>
    </header>
  );
}

export function BottomNav({ nav }: { nav: NavItem[] }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto flex max-w-md justify-around">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-semibold transition',
                  isActive ? 'text-primary' : 'text-ink-3',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="size-[22px]" strokeWidth={isActive ? 2.4 : 1.8} aria-hidden />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-20 border-t border-line pb-24 md:pb-0">
      <div className="container-page grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <Logo />
          <p className="t-body max-w-xs text-sm">{brand.tagline}</p>
        </div>
        <FooterCol
          title="Travel"
          links={[
            ['/flights', 'Flight offers'],
            ['/rides', 'Shared airport rides'],
            ['/trips', 'My trips'],
          ]}
        />
        <FooterCol
          title="Help"
          links={[
            ['/support', 'Support'],
            ['/legal/safety', 'Trust & safety'],
            ['/legal/refunds', 'Cancellations & refunds'],
          ]}
        />
        <FooterCol
          title="Legal"
          links={[
            ['/legal/terms', 'Terms of use'],
            ['/legal/privacy', 'Privacy policy'],
            ['/partners', 'For airlines & operators'],
          ]}
        />
      </div>
      <div className="container-page flex flex-col gap-2 border-t border-line py-6 text-xs text-ink-3 sm:flex-row sm:justify-between">
        <p>
          © {year} {brand.legalName}. Flight offers are published by airlines or authorised partners and are subject to their fare rules.
        </p>
        <p>
          <a className="hover:text-ink" href={`mailto:${brand.supportEmail}`}>
            {brand.supportEmail}
          </a>
        </p>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h3 className="t-meta mb-3">{title}</h3>
      <ul className="space-y-2 text-sm">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="text-ink-2 hover:text-ink">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PageFallback() {
  return (
    <div className="container-page py-10">
      <SkeletonList />
    </div>
  );
}

/** Passenger layout: demo banner, sticky header, page content, footer, mobile bottom navigation. */
export function PassengerLayout({ headerRight }: { headerRight?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <DemoBanner />
      <Header nav={PASSENGER_NAV} right={headerRight} />
      <main id="main" className="flex-1 pb-20 md:pb-0">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <BottomNav nav={PASSENGER_NAV} />
      <ScrollRestoration />
    </div>
  );
}
