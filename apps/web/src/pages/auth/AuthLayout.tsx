import { brand } from '@waylo/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DestinationArt } from '@/components/brand/DestinationArt';
import { Logo } from '@/components/brand/Logo';
import { AirportChip } from '@/components/brand/Route';
import { DemoBanner, ThemeToggle } from '@/components/layout/AppShell';

/** Split-screen layout for sign-in and registration: editorial illustration + focused form. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <div className="grid flex-1 lg:grid-cols-[1.05fr_1fr]">
        <aside className="relative hidden overflow-hidden lg:block" aria-hidden>
          <DestinationArt scene="coast" seed="auth-goa" />
          <div className="absolute inset-x-0 bottom-0 p-10 text-white">
            <div className="mb-4 flex items-center gap-2">
              <AirportChip code="BOM" tone="inverse" />
              <span className="h-px w-10 bg-white/60" />
              <AirportChip code="GOI" tone="inverse" />
            </div>
            <p className="max-w-md text-3xl leading-tight font-bold tracking-tight">{brand.tagline}</p>
          </div>
        </aside>
        <main id="main" className="flex flex-col px-5 py-6 sm:px-10">
          <div className="flex items-center justify-between">
            <Link to="/" aria-label={`${brand.name} home`} className="rounded-lg">
              <Logo />
            </Link>
            <ThemeToggle />
          </div>
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
            <h1 className="t-title">{title}</h1>
            <p className="t-body mt-2">{subtitle}</p>
            <div className="mt-8">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
