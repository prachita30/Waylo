import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path relative to /api/v1 (the health check is served from the root). */
  path: string;
  file: string;
  /** Name of the shared zod schema the handler validates its JSON body with, when there is one. */
  bodySchema?: string;
}

/** Routes that deliberately accept anonymous callers. Everything else must answer 401 without a session. */
export const PUBLIC_ROUTES = new Set([
  'GET /health',
  'GET /meta',
  'GET /airports',
  'POST /auth/login',
  'POST /auth/register',
  'POST /auth/logout',
  'GET /flights/search',
  'GET /flights/offers/:offerId',
  'GET /rides/service-areas',
  'GET /places/search',
  // Server-to-server; authenticated by HMAC signature instead of a session.
  'POST /payments/webhooks/:provider',
]);

/** Path prefixes reserved for one account role. */
export const ROLE_PREFIXES: { prefix: string; role: 'admin' | 'partner' | 'operator' }[] = [
  { prefix: '/admin/', role: 'admin' },
  { prefix: '/sandbox/', role: 'admin' },
  { prefix: '/partner/', role: 'partner' },
  { prefix: '/operator/', role: 'operator' },
];

const ROUTE = /\br\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
const BODY = /body\(\s*req,\s*([A-Za-z]+Schema)\s*\)/;

/**
 * Every route declared in the API modules, found by reading the source. Used by the authorisation
 * matrix test (so a new route cannot be added without being classified) and by the OpenAPI generator.
 */
export function listRoutes(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../modules')): RouteDef[] {
  const out: RouteDef[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        const src = readFileSync(full, 'utf8');
        const matches = [...src.matchAll(ROUTE)];
        matches.forEach((m, i) => {
          const p = m[2]!;
          // The payment webhook router is mounted at its own path in app.ts.
          const routePath = name === 'routes.ts' && dir.endsWith('payments') && p === '/' ? '/payments/webhooks/:provider' : p;
          const handler = src.slice(m.index, matches[i + 1]?.index ?? src.length);
          const bodySchema = handler.match(BODY)?.[1];
          out.push({ method: m[1]!.toUpperCase() as RouteDef['method'], path: routePath, file: path.relative(root, full).replace(/\\/g, '/'), ...(bodySchema ? { bodySchema } : {}) });
        });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export const routeKey = (r: Pick<RouteDef, 'method' | 'path'>) => `${r.method} ${r.path}`;

/** Who may call a route: 'public', 'signed-in', or a specific role. */
export function accessFor(r: RouteDef): 'public' | 'signed-in' | 'admin' | 'partner' | 'operator' {
  if (PUBLIC_ROUTES.has(routeKey(r))) return 'public';
  return ROLE_PREFIXES.find((p) => r.path.startsWith(p.prefix))?.role ?? 'signed-in';
}

/** Concrete URL for a route pattern, with a fresh UUID (or a plausible token) for each parameter. */
export function samplePath(p: string): string {
  return p.replace(/:([A-Za-z]+)/g, (_, name: string) => (name === 'provider' ? 'sandbox' : name === 'kind' ? 'operator' : name === 'file' ? 'nobody.png' : '00000000-0000-4000-8000-000000000000'));
}
