import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { payments, refunds } from '../../db/schema';
import { currentUser, requireRole } from '../../http/auth';
import { notFound } from '../../http/errors';
import { body, params, query } from '../../http/validate';
import { membershipFor } from '../operator/access';
import { retryRefund } from './refunds';
import { listSettlements, markSettlementPaid, runSettlements } from './settlements';

/** Finance operations: payments, refunds and operator settlements. */
export function financeRouter(ctx: AppContext): Router {
  const r = Router();

  r.get('/admin/payments', requireRole('admin'), async (req, res) => {
    const { status } = query(req, z.object({ status: z.string().optional() }));
    const rows = await ctx.db
      .select()
      .from(payments)
      .where(status ? eq(payments.status, status as (typeof payments.$inferSelect)['status']) : undefined)
      .orderBy(desc(payments.createdAt))
      .limit(200);
    res.json({ items: rows });
  });

  r.get('/admin/refunds', requireRole('admin'), async (req, res) => {
    const { status } = query(req, z.object({ status: z.enum(['pending', 'processing', 'succeeded', 'failed']).optional() }));
    const rows = await ctx.db.select().from(refunds).where(status ? eq(refunds.status, status) : undefined).orderBy(desc(refunds.createdAt)).limit(200);
    res.json({ items: rows });
  });

  r.post('/admin/refunds/:id/retry', requireRole('admin'), async (req, res) => {
    const { id } = params(req, z.object({ id: z.string().uuid() }));
    const refund = await retryRefund(ctx, id, currentUser(req).id);
    if (!refund) throw notFound('Failed refund');
    res.json({ refund });
  });

  r.get('/admin/settlements', requireRole('admin'), async (_req, res) => {
    res.json({ items: await listSettlements(ctx) });
  });

  r.post('/admin/settlements/run', requireRole('admin'), async (req, res) => {
    const { periodEnd } = body(req, z.object({ periodEnd: z.string().datetime({ offset: true }).optional() }));
    const created = await runSettlements(ctx, periodEnd ? new Date(periodEnd) : new Date(), currentUser(req).id);
    res.status(201).json({ items: created });
  });

  r.post('/admin/settlements/:id/paid', requireRole('admin'), async (req, res) => {
    const { id } = params(req, z.object({ id: z.string().uuid() }));
    const { reference } = body(req, z.object({ reference: z.string().trim().min(4).max(80) }));
    res.json({ settlement: await markSettlementPaid(ctx, id, reference, currentUser(req).id) });
  });

  r.get('/operator/settlements', requireRole('operator'), async (req, res) => {
    const m = await membershipFor(ctx.db, currentUser(req).id);
    if (!m || m.role === 'driver') throw notFound('Settlements');
    res.json({ items: await listSettlements(ctx, m.operator.id) });
  });

  return r;
}
