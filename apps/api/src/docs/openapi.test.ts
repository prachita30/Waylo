import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { listRoutes } from '../test/routes';
import { buildOpenApi } from './openapi';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/openapi.json');

describe('OpenAPI document', () => {
  const doc = buildOpenApi(pkg.version) as { paths: Record<string, Record<string, { security: unknown[]; requestBody?: unknown; 'x-waylo-access': string }>>; components: { schemas: Record<string, unknown> } };

  it('is up to date with the route source (run `npm run docs:openapi -w apps/api`)', () => {
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it('describes every route with its access level', () => {
    const ops = Object.entries(doc.paths).flatMap(([p, methods]) => Object.entries(methods).map(([m, op]) => ({ key: `${m.toUpperCase()} ${p}`, op })));
    expect(ops).toHaveLength(listRoutes().length);
    expect(ops.find((o) => o.key === 'GET /admin/overview')!.op['x-waylo-access']).toBe('admin');
    expect(ops.find((o) => o.key === 'GET /flights/search')!.op.security).toEqual([]);
    expect(ops.find((o) => o.key === 'POST /flights/bookings')!.op.security).toEqual([{ sessionCookie: [], clientHeader: [] }]);
  });

  it('uses the exact shared validation schemas for request bodies', () => {
    expect(doc.paths['/flights/bookings']!.post!.requestBody).toBeTruthy();
    const offer = doc.components.schemas.partnerOfferSchema as { properties: Record<string, unknown>; required: string[] };
    expect(offer.properties).toHaveProperty('fareMinor');
    expect(offer.required).toContain('fareRules');
    expect(Object.keys(doc.components.schemas).length).toBeGreaterThan(15);
  });
});
