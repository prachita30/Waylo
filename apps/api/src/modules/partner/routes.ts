import { partnerOfferSchema, partnerOfferUpdateSchema, partnerOnboardingSchema } from '@waylo/shared';
import { and, asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { requireFeature } from '../../lib/settings';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { airports, partnerMembers, partnerRoutes, partners } from '../../db/schema';
import { currentUser, requireAuth, requireRole } from '../../http/auth';
import { badRequest, conflict, notFound } from '../../http/errors';
import { body, params } from '../../http/validate';
import { recordAudit } from '../../lib/audit';
import { createOffer, listPartnerOffers, partnerAudit, partnerBookings, partnerFor, partnerStats, requirePartner, setOfferStatus, updateOffer } from './service';

export function partnerRouter(ctx: AppContext): Router {
  const r = Router();
  r.use('/partner', requireAuth, requireRole('partner'));
  const uuid = z.string().uuid();

  r.get('/partner/me', async (req, res) => {
    res.json({ partner: await partnerFor(ctx.db, currentUser(req).id) });
  });

  r.post('/partner/onboarding', async (req, res) => {
    await requireFeature(ctx.db, 'partnerOnboarding');
    const user = currentUser(req);
    if (await partnerFor(ctx.db, user.id)) throw conflict('already_onboarded', 'You already belong to a partner account.');
    const input = body(req, partnerOnboardingSchema);
    const partner = await ctx.db.transaction(async (tx) => {
      const [p] = await tx.insert(partners).values({ name: input.name, kind: input.kind, phone: input.phone, requestedAirlines: input.airlines }).returning();
      await tx.insert(partnerMembers).values({ partnerId: p!.id, userId: user.id, role: 'owner' });
      await recordAudit(tx, { actorUserId: user.id, actorRole: 'partner', action: 'partner.onboarded', entityType: 'partner', entityId: p!.id, metadata: { partnerId: p!.id } });
      return p!;
    });
    res.status(201).json({ partner });
  });

  // ---- routes
  r.get('/partner/routes', async (req, res) => {
    const p = await requirePartner(ctx.db, req);
    res.json({ items: await ctx.db.select().from(partnerRoutes).where(eq(partnerRoutes.partnerId, p.id)).orderBy(asc(partnerRoutes.origin), asc(partnerRoutes.destination)) });
  });

  r.post('/partner/routes', async (req, res) => {
    const p = await requirePartner(ctx.db, req);
    const { origin, destination } = body(req, z.object({ origin: z.string().regex(/^[A-Z]{3}$/), destination: z.string().regex(/^[A-Z]{3}$/) }));
    if (origin === destination) throw badRequest('Origin and destination must differ.');
    const known = await ctx.db.select({ code: airports.code }).from(airports);
    if (![origin, destination].every((c) => known.some((k) => k.code === c))) throw badRequest('Unknown airport.');
    const [route] = await ctx.db
      .insert(partnerRoutes)
      .values({ partnerId: p.id, origin, destination })
      .onConflictDoUpdate({ target: [partnerRoutes.partnerId, partnerRoutes.origin, partnerRoutes.destination], set: { active: true } })
      .returning();
    await recordAudit(ctx.db, { actorUserId: currentUser(req).id, actorRole: 'partner', action: 'route.added', entityType: 'partner_route', entityId: route!.id, metadata: { partnerId: p.id, origin, destination } });
    res.status(201).json({ route });
  });

  r.delete('/partner/routes/:id', async (req, res) => {
    const p = await requirePartner(ctx.db, req);
    const { id } = params(req, z.object({ id: uuid }));
    const [route] = await ctx.db.update(partnerRoutes).set({ active: false }).where(and(eq(partnerRoutes.id, id), eq(partnerRoutes.partnerId, p.id))).returning();
    if (!route) throw notFound('Route');
    await recordAudit(ctx.db, { actorUserId: currentUser(req).id, actorRole: 'partner', action: 'route.deactivated', entityType: 'partner_route', entityId: id, metadata: { partnerId: p.id } });
    res.status(204).end();
  });

  // ---- offers
  r.get('/partner/offers', async (req, res) => {
    const p = await requirePartner(ctx.db, req);
    res.json({ items: await listPartnerOffers(ctx, p.id) });
  });

  r.post('/partner/offers', async (req, res) => {
    const p = await requirePartner(ctx.db, req, { approved: true });
    const offer = await createOffer(ctx, p, currentUser(req).id, body(req, partnerOfferSchema));
    res.status(201).json({ offer });
  });

  r.patch('/partner/offers/:id', async (req, res) => {
    const p = await requirePartner(ctx.db, req, { approved: true });
    const { id } = params(req, z.object({ id: uuid }));
    res.json({ offer: await updateOffer(ctx, p, currentUser(req).id, id, body(req, partnerOfferUpdateSchema)) });
  });

  r.post('/partner/offers/:id/status', async (req, res) => {
    const p = await requirePartner(ctx.db, req, { approved: true });
    const { id } = params(req, z.object({ id: uuid }));
    const { status } = body(req, z.object({ status: z.enum(['published', 'paused', 'withdrawn']) }));
    res.json({ offer: await setOfferStatus(ctx, p, currentUser(req).id, id, status) });
  });

  // ---- reporting
  r.get('/partner/stats', async (req, res) => {
    const p = await requirePartner(ctx.db, req);
    res.json(await partnerStats(ctx, p.id));
  });

  r.get('/partner/bookings', async (req, res) => {
    const p = await requirePartner(ctx.db, req);
    res.json({ items: await partnerBookings(ctx, p.id) });
  });

  r.get('/partner/audit', async (req, res) => {
    const p = await requirePartner(ctx.db, req);
    res.json({ items: await partnerAudit(ctx, p.id) });
  });

  return r;
}
