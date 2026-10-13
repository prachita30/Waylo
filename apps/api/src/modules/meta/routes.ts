import { brand } from '@waylo/shared';
import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import type { AppContext } from '../../context';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../db/demo-accounts';
import { airports, cities } from '../../db/schema';

export function healthRouter(ctx: AppContext): Router {
  const r = Router();
  r.get('/health', async (_req, res) => {
    let db: boolean;
    try {
      db = await ctx.dbHandle.ping();
    } catch {
      db = false;
    }
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db, uptimeSeconds: Math.round(process.uptime()) });
  });
  return r;
}

export function metaRouter(ctx: AppContext): Router {
  const r = Router();

  r.get('/meta', (_req, res) => {
    const adapters = Object.values(ctx.adapters).map((a) => a.info);
    res.json({
      brand: { name: brand.name, tagline: brand.tagline, supportEmail: brand.supportEmail },
      mode: ctx.config.WAYLO_MODE,
      demo: ctx.config.WAYLO_MODE === 'demo' || adapters.some((a) => a.mode === 'sandbox'),
      adapters,
      // Demo-mode only: publicly documented fixture accounts for testers. Never present in production mode.
      demoLogin:
        ctx.config.WAYLO_MODE === 'demo'
          ? { password: DEMO_PASSWORD, accounts: DEMO_ACCOUNTS.map(({ email, fullName, role }) => ({ email, fullName, role })) }
          : null,
    });
  });

  r.get('/airports', async (_req, res) => {
    const rows = await ctx.db
      .select({
        code: airports.code,
        name: airports.name,
        timezone: airports.timezone,
        lat: airports.lat,
        lng: airports.lng,
        cityId: cities.id,
        city: cities.name,
        state: cities.state,
      })
      .from(airports)
      .innerJoin(cities, eq(airports.cityId, cities.id))
      .orderBy(asc(cities.name));
    res.set('Cache-Control', 'public, max-age=300').json({ items: rows });
  });

  return r;
}
