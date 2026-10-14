import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrap } from '../bootstrap';
import { loadConfig } from '../config';
import { users } from '../db/schema';
import { seed } from '../db/seed';

describe('production fail-safes', () => {
  it('loads reference data but never demo accounts, partners or fleets outside demo mode', async () => {
    const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', UPLOAD_DIR: mkdtempSync(path.join(tmpdir(), 'waylo-prod-')) });
    const ctx = await bootstrap({ config, pgliteDir: 'memory://' });
    try {
      await seed(ctx.db, { demo: false });
      expect(await ctx.db.select().from(users)).toHaveLength(0);
    } finally {
      await ctx.dbHandle.close();
    }
  });

  it('requires a webhook secret and a managed database in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db.example:5432/waylo' })).toThrow(/PAYMENT_WEBHOOK_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', PAYMENT_WEBHOOK_SECRET: 'x'.repeat(32) })).toThrow(/DATABASE_URL/);
    const ok = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db.example:5432/waylo', PAYMENT_WEBHOOK_SECRET: 'x'.repeat(32) });
    expect(ok.cookieSecure).toBe(true);
  });

  it('refuses to start production mode with sandbox integrations', async () => {
    const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', WAYLO_MODE: 'production' });
    await expect(bootstrap({ config, pgliteDir: 'memory://' })).rejects.toThrow(/sandbox-only/);
  });
});
