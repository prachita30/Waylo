import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sessions, users } from '../../db/schema';
import { createTestApp, TEST_ORIGIN, type TestApp } from '../../test/harness';
import { hashPassword, verifyPassword } from '../../lib/password';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const newUser = (email = `ana${Math.random().toString(36).slice(2, 8)}@example.com`) => ({
  fullName: 'Ananya Rao',
  email,
  password: 'journey2026',
  acceptTerms: true,
});

describe('password hashing', () => {
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('journey2026');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('journey2026', h)).toBe(true);
    expect(await verifyPassword('Journey2026', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('registration and login', () => {
  it('registers, sets an HttpOnly session cookie and never returns the hash', async () => {
    const a = t.agent();
    const res = await a.post('/api/v1/auth/register').send(newUser());
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('passenger');
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|password/i);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/waylo_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await a.get('/api/v1/users/me');
    expect(me.status).toBe(200);
    expect(me.body.preferences.notifyEmail).toBe(true);
  });

  it('stores only a hash of the session token', async () => {
    const a = t.agent();
    const res = await a.post('/api/v1/auth/register').send(newUser());
    const token = /waylo_session=([^;]+)/.exec(String(res.headers['set-cookie']))![1]!;
    const rows = await t.ctx.db.select().from(sessions).where(eq(sessions.userId, res.body.user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toHaveLength(64);
  });

  it('ignores a client-supplied role on registration', async () => {
    const res = await t.agent().post('/api/v1/auth/register').send({ ...newUser(), role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('passenger');
  });

  it('rejects duplicate emails case-insensitively', async () => {
    const u = newUser('dupe@example.com');
    expect((await t.agent().post('/api/v1/auth/register').send(u)).status).toBe(201);
    const res = await t.agent().post('/api/v1/auth/register').send({ ...u, email: 'DUPE@Example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_taken');
  });

  it('validates input with field-level errors', async () => {
    const res = await t.agent().post('/api/v1/auth/register').send({ fullName: 'A', email: 'nope', password: 'short', acceptTerms: false });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['fullName', 'email', 'password', 'acceptTerms']));
  });

  it('uses one generic message for unknown email and wrong password', async () => {
    const a = await t.agent().post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'whatever1' });
    const b = await t.agent().post('/api/v1/auth/login').send({ email: 'passenger@demo.waylo.app', password: 'wrong-pass-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('logs in and out; the old cookie stops working after logout', async () => {
    const a = await t.loginAs('passenger@demo.waylo.app');
    expect((await a.get('/api/v1/users/me')).status).toBe(200);
    expect((await a.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await a.get('/api/v1/users/me')).status).toBe(401);
  });

  it('blocks suspended accounts from signing in and from existing sessions', async () => {
    const a = t.agent();
    const reg = await a.post('/api/v1/auth/register').send(newUser());
    await t.ctx.db.update(users).set({ status: 'suspended' }).where(eq(users.id, reg.body.user.id));
    expect((await a.get('/api/v1/users/me')).status).toBe(401);
    const login = await t.agent().post('/api/v1/auth/login').send({ email: reg.body.user.email, password: 'journey2026' });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('account_suspended');
  });

  it('requires the CSRF client header for login', async () => {
    const res = await request(t.app).post('/api/v1/auth/login').set('Origin', TEST_ORIGIN).send({ email: 'x@y.z', password: 'a' });
    expect(res.status).toBe(403);
  });
});

describe('rate limiting', () => {
  it('limits repeated login attempts', async () => {
    const limited = await createTestApp({ AUTH_RATE_LIMIT: '3' });
    try {
      const a = limited.agent();
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        codes.push((await a.post('/api/v1/auth/login').send({ email: 'x@example.com', password: 'bad-pass-1' })).status);
      }
      expect(codes).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.close();
    }
  });
});
