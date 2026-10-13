import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../app';
import { bootstrap } from '../bootstrap';
import { loadConfig } from '../config';
import type { AppContext } from '../context';
import { DEMO_PASSWORD } from '../db/demo-accounts';
import { seed } from '../db/seed';

export const TEST_ORIGIN = 'http://localhost:5173';

/** Fresh in-memory PostgreSQL (PGlite), migrated and seeded, plus a supertest agent. */
export async function createTestApp(env: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    WEB_ORIGIN: TEST_ORIGIN,
    AUTH_RATE_LIMIT: '1000',
    API_RATE_LIMIT: '10000',
    UPLOAD_DIR: mkdtempSync(path.join(tmpdir(), 'waylo-test-')),
    ...env,
  });
  const ctx: AppContext = await bootstrap({ config, pgliteDir: 'memory://' });
  await seed(ctx.db);
  const app = createApp(ctx);
  return {
    ctx,
    app,
    /** A cookie-persisting client that sends the CSRF client header like the web app does. */
    agent: () => {
      const a = request.agent(app);
      a.set('X-Waylo-Client', 'web').set('Origin', TEST_ORIGIN);
      return a;
    },
    /** Signed-in agent for a seeded demo account. */
    loginAs: async (email: string) => {
      const a = request.agent(app);
      a.set('X-Waylo-Client', 'web').set('Origin', TEST_ORIGIN);
      const res = await a.post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD });
      if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
      return a;
    },
    close: () => ctx.dbHandle.close(),
  };
}
export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
