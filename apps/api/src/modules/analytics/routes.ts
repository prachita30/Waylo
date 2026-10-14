import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { currentUser, requireRole } from '../../http/auth';
import { query } from '../../http/validate';
import { recordAudit } from '../../lib/audit';
import { daily, MIN_COHORT, operatorReport, parseRange, partnerReport, routes, summary, toCsv } from './service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd.');
const rangeQuery = z.object({ from: day.optional(), to: day.optional() });

const EXPORTS = {
  daily: { columns: ['day', 'searches', 'bookingsTicketed', 'grossBookingValueMinor', 'rideRequests', 'ridesCompleted'], load: daily },
  routes: { columns: ['origin', 'destination', 'searches', 'searchesWithResults', 'bookings', 'grossBookingValueMinor', 'savingsMinor', 'suppressed'], load: routes },
  partners: { columns: ['name', 'status', 'liveOffers', 'bookingsTicketed', 'seatsTicketed', 'grossBookingValueMinor', 'cancellations', 'ticketingFailures'], load: partnerReport },
  operators: { columns: ['name', 'status', 'tripsCompleted', 'operatorEarningsMinor', 'commissionMinor', 'tripsWithOffRouteAlert', 'incidents'], load: operatorReport },
} as const;

/** Administrator reporting. Aggregates only; money is in paise; days are IST. */
export function analyticsRouter(ctx: AppContext): Router {
  const r = Router();
  r.use('/admin/analytics', requireRole('admin'));

  r.get('/admin/analytics/summary', async (req, res) => {
    const q = query(req, rangeQuery);
    res.json(await summary(ctx, parseRange(q.from, q.to)));
  });

  r.get('/admin/analytics/daily', async (req, res) => {
    const q = query(req, rangeQuery);
    res.json({ items: await daily(ctx, parseRange(q.from, q.to)) });
  });

  r.get('/admin/analytics/routes', async (req, res) => {
    const q = query(req, rangeQuery);
    res.json({ items: await routes(ctx, parseRange(q.from, q.to)), minCohort: MIN_COHORT });
  });

  r.get('/admin/analytics/partners', async (req, res) => {
    const q = query(req, rangeQuery);
    res.json({ items: await partnerReport(ctx, parseRange(q.from, q.to)) });
  });

  r.get('/admin/analytics/operators', async (req, res) => {
    const q = query(req, rangeQuery);
    res.json({ items: await operatorReport(ctx, parseRange(q.from, q.to)) });
  });

  r.get('/admin/analytics/export', async (req, res) => {
    const q = query(req, rangeQuery.extend({ report: z.enum(['daily', 'routes', 'partners', 'operators']) }));
    const range = parseRange(q.from, q.to);
    const spec = EXPORTS[q.report];
    const rows = (await spec.load(ctx, range)) as unknown as Record<string, unknown>[];
    await recordAudit(ctx.db, { actorUserId: currentUser(req).id, actorRole: 'admin', action: 'analytics.exported', entityType: 'report', entityId: q.report, metadata: { from: range.from, to: range.to, rows: rows.length } });
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="waylo-${q.report}-${range.from}-to-${range.to}.csv"`,
        'Cache-Control': 'private, no-store',
      })
      .send(toCsv(rows, [...spec.columns]));
  });

  return r;
}
