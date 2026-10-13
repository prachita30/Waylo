import request from 'supertest';
import { createApp } from '../app';
import { bootstrap } from '../bootstrap';
import { loadConfig } from '../config';
import type { AppContext } from '../context';
import { seed } from '../db/seed';

export const TEST_ORIGIN = 'http://localhost:5173';

/** Fresh in-memory PostgreSQL (PGlite), migrated and seeded, plus a supertest agent. */
export async function createTestApp(env: Record<string, string> = {}) {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', WEB_ORIGIN: TEST_ORIGIN, ...env });
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
    close: () => ctx.dbHandle.close(),
  };
}
export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
