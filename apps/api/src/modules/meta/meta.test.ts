import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config';
import { assertAdaptersAllowed } from '../../context';
import { createTestApp, type TestApp } from '../../test/harness';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('foundation', () => {
  it('reports health with database connectivity', async () => {
    const res = await request(t.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: true });
  });

  it('exposes demo mode and brand metadata', async () => {
    const res = await request(t.app).get('/api/v1/meta');
    expect(res.status).toBe(200);
    expect(res.body.brand.name).toBe('WAYLO');
    expect(res.body.demo).toBe(true);
  });

  it('lists seeded airports with time zones', async () => {
    const res = await request(t.app).get('/api/v1/airports');
    expect(res.status).toBe(200);
    const bom = res.body.items.find((a: { code: string }) => a.code === 'BOM');
    expect(bom).toMatchObject({ city: 'Mumbai', timezone: 'Asia/Kolkata' });
  });

  it('returns consistent JSON errors for unknown routes', async () => {
    const res = await request(t.app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('route_not_found');
  });

  it('rejects unsafe requests without the client header (CSRF)', async () => {
    const res = await request(t.app).post('/api/v1/meta').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_rejected');
  });

  it('rejects unsafe requests from foreign origins', async () => {
    const res = await request(t.app)
      .post('/api/v1/meta')
      .set('X-Waylo-Client', 'web')
      .set('Origin', 'https://evil.example')
      .send({});
    expect(res.status).toBe(403);
  });

  it('does not leak the framework header', async () => {
    const res = await request(t.app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('configuration safety', () => {
  it('refuses production without DATABASE_URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  it('refuses production mode with sandbox integrations', () => {
    const config = loadConfig({ NODE_ENV: 'test', WAYLO_MODE: 'production' });
    expect(() =>
      assertAdaptersAllowed(config, { airline: { info: { kind: 'airline', provider: 'mock', mode: 'sandbox' } } }),
    ).toThrow(/sandbox-only/);
  });
});
