import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TEST_ORIGIN, type TestApp } from '../test/harness';
import { listRoutes, PUBLIC_ROUTES, ROLE_PREFIXES, type RouteDef, samplePath } from '../test/routes';

/**
 * Authorisation matrix over every declared route. Adding a route forces a decision here: it is
 * either deliberately public, or it must reject anonymous callers.
 */
const PUBLIC = PUBLIC_ROUTES;
const EMAILS = { admin: 'admin@demo.waylo.app', partner: 'partner@demo.waylo.app', operator: 'operator@demo.waylo.app', passenger: 'passenger@demo.waylo.app' } as const;
const ROLE_SCOPES = ROLE_PREFIXES.map(({ prefix, role }) => ({ prefix, allowed: role, others: Object.entries(EMAILS).filter(([r]) => r !== role).map(([, e]) => e) }));

const key = (r: RouteDef) => `${r.method} ${r.path}`;
const urlFor = (r: RouteDef) => (r.path === '/health' ? '/health' : `/api/v1${samplePath(r.path)}`);
type Agent = ReturnType<TestApp['agent']>;
const send = (a: Agent | ReturnType<typeof request>, r: RouteDef) =>
  (a as unknown as Record<string, (u: string) => { send: (b: unknown) => Promise<{ status: number; body: { error?: { code: string } } }> }>)[r.method.toLowerCase()]!(urlFor(r)).send({});

let t: TestApp;
const routes = listRoutes();
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('route inventory', () => {
  it('finds every module route', () => {
    expect(routes.length).toBeGreaterThan(100);
    for (const p of PUBLIC) expect(routes.map(key)).toContain(p);
  });
});

describe('anonymous access', () => {
  it('rejects anonymous callers on every route that is not deliberately public', async () => {
    let checked = 0;
    const leaks: string[] = [];
    for (const r of routes) {
      if (PUBLIC.has(key(r))) continue;
      const res = await send(t.agent(), r);
      checked++;
      if (res.status !== 401) leaks.push(`${key(r)} → ${res.status}`);
    }
    expect(checked).toBeGreaterThan(100);
    expect(leaks).toEqual([]);
  });
});

describe('role separation', () => {
  for (const { prefix, allowed, others } of ROLE_SCOPES) {
    it(`only ${allowed} accounts reach ${prefix}*`, async () => {
      const scoped = routes.filter((r) => r.path.startsWith(prefix));
      expect(scoped.length).toBeGreaterThan(0);
      const leaks: string[] = [];
      for (const email of others) {
        const a = await t.loginAs(email);
        for (const r of scoped) {
          const res = await send(a, r);
          if (res.status !== 403) leaks.push(`${email} ${key(r)} → ${res.status}`);
        }
      }
      expect(leaks).toEqual([]);
    });
  }
});

describe('CSRF', () => {
  it('rejects every state-changing request without the client header or from a foreign origin', async () => {
    // A valid admin session cookie, replayed on raw requests that omit the CSRF protections.
    const login = await request(t.app).post('/api/v1/auth/login').set('X-Waylo-Client', 'web').set('Origin', TEST_ORIGIN).send({ email: 'admin@demo.waylo.app', password: 'waylo-demo-2026' });
    const jar = ([] as string[]).concat(login.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
    expect(jar).toMatch(/^waylo_session=/);
    expect((await request(t.app).get('/api/v1/users/me').set('Cookie', jar)).status).toBe(200);
    const unsafe = routes.filter((r) => r.method !== 'GET' && !r.path.startsWith('/payments/webhooks'));
    expect(unsafe.length).toBeGreaterThan(50);
    const leaks: string[] = [];
    for (const r of unsafe) {
      const noHeader = await (request(t.app) as unknown as Record<string, (u: string) => request.Test>)[r.method.toLowerCase()]!(urlFor(r)).set('Cookie', jar).send({});
      if (noHeader.status !== 403 || noHeader.body?.error?.code !== 'csrf_rejected') leaks.push(`no header ${key(r)} → ${noHeader.status}`);
      const foreign = await (request(t.app) as unknown as Record<string, (u: string) => request.Test>)[r.method.toLowerCase()]!(urlFor(r))
        .set('Cookie', jar)
        .set('X-Waylo-Client', 'web')
        .set('Origin', 'https://evil.example')
        .send({});
      if (foreign.status !== 403 || foreign.body?.error?.code !== 'csrf_rejected') leaks.push(`foreign origin ${key(r)} → ${foreign.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('does not grant CORS to foreign origins', async () => {
    const res = await request(t.app).options('/api/v1/users/me').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const ok = await request(t.app).options('/api/v1/users/me').set('Origin', TEST_ORIGIN).set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('transport and session hardening', () => {
  it('sets protective headers and never advertises the framework', async () => {
    const res = await request(t.app).get('/api/v1/meta');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('issues an HttpOnly, SameSite session cookie and stores only its hash', async () => {
    const res = await t.agent().post('/api/v1/auth/login').send({ email: 'passenger@demo.waylo.app', password: 'waylo-demo-2026' });
    const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = set.find((c) => /^waylo_session=/.test(c)) ?? set[0]!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    const token = decodeURIComponent(session.split(';')[0]!.split('=')[1]!);
    const { sessions } = await import('../db/schema');
    const rows = await t.ctx.db.select().from(sessions);
    expect(rows.some((s) => s.tokenHash === token)).toBe(false);
    expect(rows.every((s) => /^[0-9a-f]{64}$/.test(s.tokenHash))).toBe(true);
  });

  it('keeps internal errors and malformed input from leaking details', async () => {
    const bad = await t.agent().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at \w+ \(|node_modules|\.ts:/);
    const huge = await t.agent().post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(300_000) });
    expect(huge.status).toBe(413);
  });
});
