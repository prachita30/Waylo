import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { vi } from 'vitest';

type Handler = (body: unknown, url: URL) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>;

/**
 * Minimal API mock: keys are "METHOD /path" (path without /api/v1, no query string).
 * Unmatched requests fail loudly so tests never silently hit the network.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ method, path, body });
    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`Unmocked request: ${method} ${path}`);
    const res = await handler(body, url);
    const status = res.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(res.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function renderRoutes(routes: RouteObject[], initialPath = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, qc };
}

export function renderWithClient(ui: ReactNode) {
  return renderRoutes([{ path: '*', element: ui }]);
}

export const META = {
  brand: { name: 'WAYLO', tagline: 't', supportEmail: 's@x' },
  mode: 'demo',
  demo: true,
  adapters: [],
  demoLogin: { password: 'demo-pass-1', accounts: [{ email: 'passenger@demo.waylo.app', fullName: 'Demo Passenger', role: 'passenger' }] },
};

export const ME = {
  user: {
    id: 'u1',
    email: 'ana@example.com',
    fullName: 'Ananya Rao',
    phone: null,
    role: 'passenger',
    status: 'active',
    homeAirport: null,
    avatarUrl: null,
    isDemo: false,
    createdAt: '2026-10-01T00:00:00Z',
  },
  preferences: { notifyEmail: true, notifySms: true, notifyPush: true, marketingOptIn: false },
  savedDestinations: [],
};
