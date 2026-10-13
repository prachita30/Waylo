import { and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { drivers, flightOffers, operatorDocuments, operators, partners, vehicles } from '../../db/schema';
import { currentUser, requireRole } from '../../http/auth';
import { notFound } from '../../http/errors';
import { body, params } from '../../http/validate';
import { recordAudit } from '../../lib/audit';
import { readDocument } from '../operator/fleet';
import { authoriseAirlines } from '../partner/service';

const TABLES = { operator: operators, driver: drivers, vehicle: vehicles, document: operatorDocuments, partner: partners } as const;

/**
 * Verification decisions for operators, drivers, vehicles, their documents, and airline or
 * distribution partners. Only approved operators, drivers and vehicles can take passenger trips;
 * only approved partners can publish fares, and only for the airlines authorised here.
 */
export function reviewRouter(ctx: AppContext): Router {
  const r = Router();
  r.use('/admin/review', requireRole('admin'));

  r.get('/admin/review/pending', async (_req, res) => {
    const [ops, ds, vs, docs, ps] = await Promise.all([
      ctx.db.select().from(operators).where(eq(operators.status, 'pending')).orderBy(desc(operators.createdAt)),
      ctx.db.select().from(drivers).where(eq(drivers.status, 'pending')).orderBy(desc(drivers.createdAt)),
      ctx.db.select().from(vehicles).where(eq(vehicles.status, 'pending')).orderBy(desc(vehicles.createdAt)),
      ctx.db.select().from(operatorDocuments).where(eq(operatorDocuments.status, 'pending')).orderBy(desc(operatorDocuments.createdAt)),
      ctx.db.select().from(partners).where(eq(partners.status, 'pending')).orderBy(desc(partners.createdAt)),
    ]);
    res.json({ operators: ops, drivers: ds, vehicles: vs, documents: docs.map(({ fileName: _f, ...d }) => d), partners: ps });
  });

  r.post('/admin/review/:kind/:id', async (req, res) => {
    const { kind, id } = params(req, z.object({ kind: z.enum(['operator', 'driver', 'vehicle', 'document', 'partner']), id: z.string().uuid() }));
    const { decision, reason } = body(req, z.object({ decision: z.enum(['approved', 'rejected', 'suspended']), reason: z.string().trim().max(500).optional() }));
    const admin = currentUser(req);
    const table = TABLES[kind];
    const set =
      kind === 'document'
        ? { status: decision, reviewNotes: reason ?? null, reviewedBy: admin.id, reviewedAt: new Date() }
        : kind === 'operator' || kind === 'partner'
          ? { status: decision, statusReason: reason ?? null, reviewedBy: admin.id, reviewedAt: new Date() }
          : { status: decision, statusReason: reason ?? null };
    const updated = await ctx.db.transaction(async (tx) => {
      const rows = await tx
        .update(table)
        .set(set as never)
        .where(eq(table.id, id))
        .returning();
      if (kind === 'partner' && rows[0]) {
        const p = rows[0] as typeof partners.$inferSelect;
        if (decision === 'approved') await authoriseAirlines(tx, p, ctx.config.WAYLO_MODE === 'demo');
        // Rejection or suspension takes the partner's live fares off sale; sold bookings are unaffected.
        else await tx.update(flightOffers).set({ status: 'paused' }).where(and(eq(flightOffers.partnerId, p.id), eq(flightOffers.status, 'published')));
      }
      return rows;
    });
    if (!updated.length) throw notFound(kind);
    const metadata = { ...(reason ? { reason } : {}), ...(kind === 'partner' ? { partnerId: id } : {}) };
    await recordAudit(ctx.db, { actorUserId: admin.id, actorRole: 'admin', action: `${kind}.${decision}`, entityType: kind, entityId: id, metadata });
    res.json({ item: updated[0] });
  });

  r.get('/admin/review/documents/:id/file', async (req, res) => {
    const { id } = params(req, z.object({ id: z.string().uuid() }));
    const { doc, data } = await readDocument(ctx, id, null);
    await recordAudit(ctx.db, { actorUserId: currentUser(req).id, actorRole: 'admin', action: 'document.viewed', entityType: 'document', entityId: id });
    res.set({ 'Content-Type': doc.contentType, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(data);
  });

  return r;
}
