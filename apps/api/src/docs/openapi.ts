import * as shared from '@waylo/shared';
import { z } from 'zod';
import { accessFor, listRoutes, type RouteDef } from '../test/routes';

type Json = Record<string, unknown>;

const TAG_NAMES: Record<string, string> = {
  admin: 'Administration',
  airports: 'Reference data',
  auth: 'Authentication',
  avatars: 'Profiles',
  flights: 'Flights',
  health: 'Platform',
  incidents: 'Safety',
  meta: 'Platform',
  notifications: 'Notifications',
  operator: 'Fleet operators',
  partner: 'Airline partners',
  payments: 'Payments',
  places: 'Rides',
  rides: 'Rides',
  sandbox: 'Sandbox',
  support: 'Support',
  users: 'Profiles',
};

const ACCESS_TEXT: Record<ReturnType<typeof accessFor>, string> = {
  public: 'Public.',
  'signed-in': 'Requires a signed-in account; results are limited to the caller’s own records.',
  admin: 'Administrators only.',
  partner: 'Airline or distribution partner accounts only.',
  operator: 'Fleet operator accounts only (owners, dispatchers or drivers as noted by the endpoint).',
};

const err = (description: string) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });

/**
 * OpenAPI 3.1 description generated from the route source and the shared zod schemas, so it
 * cannot drift from the code. Response bodies are described generically; request bodies use the
 * exact validation schemas the server applies.
 */
export function buildOpenApi(version: string): Json {
  const routes = listRoutes();
  const schemas: Json = {
    Error: {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', examples: ['validation_error', 'unauthorized', 'forbidden', 'not_found', 'rate_limited', 'feature_disabled'] },
            message: { type: 'string' },
            details: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } },
          },
        },
      },
    },
  };
  const paths: Record<string, Json> = {};

  for (const r of routes) {
    const access = accessFor(r);
    const isHealth = r.path === '/health';
    const openPath = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const params = [...r.path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: ['provider', 'kind', 'file', 'slug'].includes(m[1]!) ? { type: 'string' } : { type: 'string', format: 'uuid' },
    }));
    const segment = r.path.split('/')[1] ?? '';
    const op: Json = {
      operationId: opId(r),
      tags: [TAG_NAMES[segment] ?? segment],
      summary: `${r.method} ${r.path}`,
      description: `${ACCESS_TEXT[access]}${r.method !== 'GET' && access !== 'public' ? ' State-changing requests must send the X-Waylo-Client header.' : ''}`,
      'x-waylo-access': access,
      ...(params.length ? { parameters: params } : {}),
      security: access === 'public' ? [] : [{ sessionCookie: [], ...(r.method !== 'GET' ? { clientHeader: [] } : {}) }],
      responses: {
        [r.method === 'POST' ? '2XX' : '200']: { description: 'Success. JSON body (or 204 with no body for deletions and acknowledgements).' },
        '400': err('Invalid input. `details` lists the failing fields.'),
        ...(access !== 'public' ? { '401': err('Not signed in.'), '403': err('Signed in, but not allowed (role, ownership or CSRF check).') } : {}),
        '404': err('Not found, or not visible to the caller.'),
        '429': err('Rate limited.'),
      },
    };
    if (r.path === '/payments/webhooks/:provider') {
      op.security = [{ webhookSignature: [] }];
      op.description = 'Payment provider webhook. Authenticated by the Waylo-Signature HMAC over the raw body; duplicate event ids are ignored.';
    }
    if (r.bodySchema) {
      const schema = (shared as Record<string, unknown>)[r.bodySchema];
      if (schema instanceof z.ZodType) {
        schemas[r.bodySchema] ??= z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
        op.requestBody = { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${r.bodySchema}` } } } };
      }
    }
    if (isHealth) op.servers = [{ url: '/' }];
    paths[openPath] = { ...(paths[openPath] ?? {}), [r.method.toLowerCase()]: op };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'WAYLO API',
      version,
      description:
        'Flights from airline-authorised partners and shared airport rides. Money is integer paise (INR minor units); timestamps are UTC ISO 8601. ' +
        'In demo mode every integration (airline, payments, maps, flight status, messaging) is a labelled sandbox: no real tickets, payments or rides.',
    },
    servers: [{ url: '/api/v1' }],
    tags: [...new Set(Object.values(TAG_NAMES))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'waylo_session', description: 'Opaque HttpOnly session cookie set by /auth/login or /auth/register.' },
        clientHeader: { type: 'apiKey', in: 'header', name: 'X-Waylo-Client', description: 'CSRF defence: any non-empty value; required on state-changing requests.' },
        webhookSignature: { type: 'apiKey', in: 'header', name: 'Waylo-Signature', description: 'Format "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${raw body}`>" with the shared webhook secret; stale timestamps are rejected.' },
      },
      schemas,
    },
  };
}

function opId(r: RouteDef) {
  const words = r.path
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith(':') ? `by-${s.slice(1)}` : s))
    .join('-');
  return `${r.method.toLowerCase()}-${words || 'root'}`.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''));
}
