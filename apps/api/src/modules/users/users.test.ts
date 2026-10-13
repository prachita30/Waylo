import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditEvents, users } from '../../db/schema';
import { createTestApp, type TestApp } from '../../test/harness';
import { sniffImage } from './routes';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function freshUser() {
  const a = t.agent();
  const email = `u${Math.random().toString(36).slice(2, 9)}@example.com`;
  const res = await a.post('/api/v1/auth/register').send({ fullName: 'Kabir Shah', email, password: 'journey2026', acceptTerms: true });
  return { a, id: res.body.user.id as string, email };
}

describe('profile', () => {
  it('requires authentication', async () => {
    expect((await t.agent().get('/api/v1/users/me')).status).toBe(401);
    expect((await t.agent().patch('/api/v1/users/me').send({ fullName: 'X Y' })).status).toBe(401);
  });

  it('updates name, phone and home airport, and cannot change role', async () => {
    const { a } = await freshUser();
    const res = await a.patch('/api/v1/users/me').send({ fullName: 'Kabir S', phone: '+919812345678', homeAirport: 'BOM', role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ fullName: 'Kabir S', phone: '+919812345678', homeAirport: 'BOM', role: 'passenger' });
  });

  it('rejects unknown airports', async () => {
    const { a } = await freshUser();
    expect((await a.patch('/api/v1/users/me').send({ homeAirport: 'ZZZ' })).status).toBe(400);
  });

  it('saves notification preferences', async () => {
    const { a } = await freshUser();
    const prefs = { notifyEmail: false, notifySms: true, notifyPush: false, marketingOptIn: true };
    expect((await a.put('/api/v1/users/me/preferences').send(prefs)).body.preferences).toEqual(prefs);
    expect((await a.get('/api/v1/users/me')).body.preferences).toEqual(prefs);
  });

  it('saves and removes destinations idempotently', async () => {
    const { a } = await freshUser();
    expect((await a.put('/api/v1/users/me/saved-destinations/goa')).status).toBe(204);
    expect((await a.put('/api/v1/users/me/saved-destinations/goa')).status).toBe(204);
    expect((await a.put('/api/v1/users/me/saved-destinations/atlantis')).status).toBe(404);
    let list = await a.get('/api/v1/users/me/saved-destinations');
    expect(list.body.items.map((i: { cityId: string }) => i.cityId)).toEqual(['goa']);
    await a.delete('/api/v1/users/me/saved-destinations/goa');
    list = await a.get('/api/v1/users/me/saved-destinations');
    expect(list.body.items).toEqual([]);
  });
});

describe('avatar upload', () => {
  it('sniffs real image types', () => {
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniffImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });

  it('accepts a PNG and serves it only to signed-in users', async () => {
    const { a } = await freshUser();
    const res = await a.post('/api/v1/users/me/avatar').attach('avatar', PNG, { filename: 'me.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    const url: string = res.body.user.avatarUrl;
    expect(url).toMatch(/^\/api\/v1\/avatars\/[0-9a-f-]{36}\.png$/);
    const img = await a.get(url);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect((await t.agent().get(url)).status).toBe(401);
  });

  it('rejects a non-image disguised with an image MIME type', async () => {
    const { a } = await freshUser();
    const res = await a.post('/api/v1/users/me/avatar').attach('avatar', Buffer.from('<html>'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('rejects oversized uploads', async () => {
    const { a } = await freshUser();
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const res = await a.post('/api/v1/users/me/avatar').attach('avatar', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/2 MB/);
  });

  it('rejects path traversal in avatar names', async () => {
    const { a } = await freshUser();
    expect((await a.get('/api/v1/avatars/..%2F..%2Fsecret.png')).status).toBe(400);
  });
});

describe('password change', () => {
  it('requires the current password and signs out other devices', async () => {
    const { a, email } = await freshUser();
    const other = t.agent();
    await other.post('/api/v1/auth/login').send({ email, password: 'journey2026' });
    expect((await other.get('/api/v1/users/me')).status).toBe(200);

    const bad = await a.post('/api/v1/users/me/password').send({ currentPassword: 'nope', newPassword: 'newjourney2026' });
    expect(bad.status).toBe(400);

    const ok = await a.post('/api/v1/users/me/password').send({ currentPassword: 'journey2026', newPassword: 'newjourney2026' });
    expect(ok.status).toBe(204);
    expect((await a.get('/api/v1/users/me')).status).toBe(200);
    expect((await other.get('/api/v1/users/me')).status).toBe(401);
  });
});

describe('account deletion', () => {
  it('requires the password and the DELETE confirmation', async () => {
    const { a } = await freshUser();
    expect((await a.delete('/api/v1/users/me').send({ password: 'journey2026', confirm: 'yes' })).status).toBe(400);
    expect((await a.delete('/api/v1/users/me').send({ password: 'wrong', confirm: 'DELETE' })).status).toBe(400);
  });

  it('erases personal data, revokes sessions, frees the email and records an audit event', async () => {
    const { a, id, email } = await freshUser();
    await a.put('/api/v1/users/me/saved-destinations/goa');
    const res = await a.delete('/api/v1/users/me').send({ password: 'journey2026', confirm: 'DELETE' });
    expect(res.status).toBe(204);
    expect((await a.get('/api/v1/users/me')).status).toBe(401);

    const [row] = await t.ctx.db.select().from(users).where(eq(users.id, id));
    expect(row).toMatchObject({ status: 'deleted', fullName: 'Deleted user', phone: null });
    expect(row!.email).not.toBe(email);

    const login = await t.agent().post('/api/v1/auth/login').send({ email, password: 'journey2026' });
    expect(login.status).toBe(401);
    const again = await t.agent().post('/api/v1/auth/register').send({ fullName: 'New Person', email, password: 'journey2026', acceptTerms: true });
    expect(again.status).toBe(201);

    const audit = await t.ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    expect(audit.map((e) => e.action)).toContain('user.deleted');
  });
});
