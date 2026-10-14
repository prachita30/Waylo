import { and, desc, eq, gte, ilike, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { SandboxFlightStatusAdapter } from '../../adapters/flightStatus/sandbox';
import type { AppContext } from '../../context';
import {
  auditEvents,
  flightBookings,
  flightOffers,
  flights,
  notificationDeliveries,
  operatorDocuments,
  operators,
  partners,
  refunds,
  rideGroups,
  rideRequests,
  safetyIncidents,
  sessions,
  supportTickets,
  users,
  vehicles,
  drivers,
  appConfig,
} from '../../db/schema';
import { currentUser, requireRole } from '../../http/auth';
import { badRequest, conflict, notFound } from '../../http/errors';
import { body, params, query } from '../../http/validate';
import { recordAudit } from '../../lib/audit';
import { DEFAULT_FEATURES, FEATURES_KEY, getFeatures, getRideSettings, RIDE_SETTINGS_KEY } from '../../lib/settings';

const uuid = z.string().uuid();
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).max(10_000).default(0) };
const count = sql<number>`count(*)::int`;

/** Back-office views and controls. Every write is audited with the acting administrator. */
export function adminConsoleRouter(ctx: AppContext): Router {
  const r = Router();
  r.use('/admin', requireRole('admin'));

  r.get('/admin/overview', async (_req, res) => {
    const since = new Date(Date.now() - 86_400_000);
    const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
    const [usersByRole, bookingsByStatus, groupsByStatus] = await Promise.all([
      ctx.db.select({ role: users.role, n: count }).from(users).where(eq(users.status, 'active')).groupBy(users.role),
      ctx.db.select({ status: flightBookings.status, n: count }).from(flightBookings).where(gte(flightBookings.createdAt, since)).groupBy(flightBookings.status),
      ctx.db.select({ status: rideGroups.status, n: count }).from(rideGroups).where(gte(rideGroups.plannedPickupAt, since)).groupBy(rideGroups.status),
    ]);
    const pending = await Promise.all([
      n(ctx.db.select({ n: count }).from(operators).where(eq(operators.status, 'pending'))),
      n(ctx.db.select({ n: count }).from(drivers).where(eq(drivers.status, 'pending'))),
      n(ctx.db.select({ n: count }).from(vehicles).where(eq(vehicles.status, 'pending'))),
      n(ctx.db.select({ n: count }).from(operatorDocuments).where(eq(operatorDocuments.status, 'pending'))),
      n(ctx.db.select({ n: count }).from(partners).where(eq(partners.status, 'pending'))),
    ]);
    const [openTickets, urgentTickets, openIncidents, criticalIncidents, failedRefunds, failedDeliveries, ticketingFailed] = await Promise.all([
      n(ctx.db.select({ n: count }).from(supportTickets).where(sql`${supportTickets.status} in ('open', 'in_review')`)),
      n(ctx.db.select({ n: count }).from(supportTickets).where(and(eq(supportTickets.priority, 'urgent'), sql`${supportTickets.status} not in ('resolved', 'closed')`))),
      n(ctx.db.select({ n: count }).from(safetyIncidents).where(sql`${safetyIncidents.status} <> 'resolved'`)),
      n(ctx.db.select({ n: count }).from(safetyIncidents).where(and(eq(safetyIncidents.severity, 'critical'), sql`${safetyIncidents.status} <> 'resolved'`))),
      n(ctx.db.select({ n: count }).from(refunds).where(eq(refunds.status, 'failed'))),
      n(ctx.db.select({ n: count }).from(notificationDeliveries).where(and(eq(notificationDeliveries.status, 'failed'), gte(notificationDeliveries.createdAt, since)))),
      n(ctx.db.select({ n: count }).from(flightBookings).where(and(eq(flightBookings.status, 'ticketing_failed'), gte(flightBookings.createdAt, since)))),
    ]);
    res.json({
      generatedAt: new Date().toISOString(),
      usersByRole: Object.fromEntries(usersByRole.map((u) => [u.role, Number(u.n)])),
      last24h: {
        bookingsByStatus: Object.fromEntries(bookingsByStatus.map((b) => [b.status, Number(b.n)])),
        rideGroupsByStatus: Object.fromEntries(groupsByStatus.map((g) => [g.status, Number(g.n)])),
        ticketingFailed,
        failedDeliveries,
      },
      attention: {
        pendingReviews: { operators: pending[0], drivers: pending[1], vehicles: pending[2], documents: pending[3], partners: pending[4] },
        openTickets,
        urgentTickets,
        openIncidents,
        criticalIncidents,
        failedRefunds,
      },
      features: await getFeatures(ctx.db),
    });
  });

  // ---------------------------------------------------------------- users

  r.get('/admin/users', async (req, res) => {
    const q = query(req, z.object({ q: z.string().trim().max(120).optional(), role: z.enum(['passenger', 'operator', 'partner', 'admin']).optional(), status: z.enum(['active', 'suspended', 'deleted']).optional(), ...page }));
    const where: SQL[] = [];
    if (q.q) where.push(or(ilike(users.email, `%${q.q}%`), ilike(users.fullName, `%${q.q}%`))!);
    if (q.role) where.push(eq(users.role, q.role));
    if (q.status) where.push(eq(users.status, q.status));
    const rows = await ctx.db
      .select({ id: users.id, email: users.email, fullName: users.fullName, phone: users.phone, role: users.role, status: users.status, isDemo: users.isDemo, suspendedReason: users.suspendedReason, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
      .from(users)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    res.json({ items: rows });
  });

  r.patch('/admin/users/:id', async (req, res) => {
    const { id } = params(req, z.object({ id: uuid }));
    const { status, reason } = body(req, z.object({ status: z.enum(['active', 'suspended']), reason: z.string().trim().min(5).max(300).optional() }));
    const admin = currentUser(req);
    if (id === admin.id) throw conflict('self_action', 'You cannot change the status of your own account.');
    if (status === 'suspended' && !reason) throw badRequest('Give a reason for the suspension.', [{ path: 'reason', message: 'Required when suspending.' }]);
    const updated = await ctx.db.transaction(async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, id));
      if (!u || u.status === 'deleted') throw notFound('User');
      const [row] = await tx.update(users).set({ status, suspendedReason: status === 'suspended' ? reason! : null }).where(eq(users.id, id)).returning({ id: users.id, status: users.status, suspendedReason: users.suspendedReason });
      // Suspension signs the user out everywhere immediately.
      if (status === 'suspended') await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
      return row!;
    });
    await recordAudit(ctx.db, { actorUserId: admin.id, actorRole: 'admin', action: `user.${status === 'suspended' ? 'suspended' : 'reactivated'}`, entityType: 'user', entityId: id, metadata: reason ? { reason } : {} });
    res.json({ user: updated });
  });

  // ---------------------------------------------------------------- offers

  r.get('/admin/offers', async (req, res) => {
    const q = query(req, z.object({ status: z.enum(['draft', 'published', 'paused', 'expired', 'withdrawn']).optional(), source: z.enum(['partner', 'adapter']).optional(), q: z.string().trim().max(12).optional(), held: z.enum(['true']).optional(), ...page }));
    const where: SQL[] = [gte(flights.departAt, new Date())];
    if (q.status) where.push(eq(flightOffers.status, q.status));
    if (q.source === 'partner') where.push(eq(flightOffers.source, 'partner'));
    if (q.source === 'adapter') where.push(sql`${flightOffers.source} <> 'partner'`);
    if (q.q) where.push(ilike(flights.flightNumber, `%${q.q.toUpperCase()}%`));
    if (q.held) where.push(eq(flightOffers.adminHold, true));
    const rows = await ctx.db
      .select({
        id: flightOffers.id,
        status: flightOffers.status,
        source: flightOffers.source,
        partner: partners.name,
        flightNumber: flights.flightNumber,
        origin: flights.origin,
        destination: flights.destination,
        departAt: flights.departAt,
        fareMinor: flightOffers.fareMinor,
        referenceFareMinor: flightOffers.referenceFareMinor,
        referenceSource: flightOffers.referenceSource,
        seatsSold: flightOffers.seatsSold,
        inventoryCap: flightOffers.inventoryCap,
        validUntil: flightOffers.validUntil,
        adminHold: flightOffers.adminHold,
        adminHoldReason: flightOffers.adminHoldReason,
      })
      .from(flightOffers)
      .innerJoin(flights, eq(flights.id, flightOffers.flightId))
      .leftJoin(partners, eq(partners.id, flightOffers.partnerId))
      .where(and(...where))
      .orderBy(flights.departAt)
      .limit(q.limit)
      .offset(q.offset);
    res.json({ items: rows });
  });

  r.post('/admin/offers/:id/hold', async (req, res) => {
    const { id } = params(req, z.object({ id: uuid }));
    const { reason } = body(req, z.object({ reason: z.string().trim().min(5).max(300) }));
    const [o] = await ctx.db
      .update(flightOffers)
      .set({ adminHold: true, adminHoldReason: reason, status: sql`case when ${flightOffers.status} = 'published' then 'paused'::offer_status else ${flightOffers.status} end` })
      .where(eq(flightOffers.id, id))
      .returning();
    if (!o) throw notFound('Offer');
    await recordAudit(ctx.db, { actorUserId: currentUser(req).id, actorRole: 'admin', action: 'offer.held', entityType: 'offer', entityId: id, metadata: { reason, ...(o.partnerId ? { partnerId: o.partnerId } : {}) } });
    res.json({ offer: o });
  });

  r.post('/admin/offers/:id/release', async (req, res) => {
    const { id } = params(req, z.object({ id: uuid }));
    const [cur] = await ctx.db.select().from(flightOffers).where(eq(flightOffers.id, id));
    if (!cur) throw notFound('Offer');
    if (!cur.adminHold) throw conflict('not_held', 'This offer is not on hold.');
    // Released offers return to "paused"; the partner (or the next airline refresh) decides when to sell again.
    const [o] = await ctx.db.update(flightOffers).set({ adminHold: false, adminHoldReason: null }).where(eq(flightOffers.id, id)).returning();
    await recordAudit(ctx.db, { actorUserId: currentUser(req).id, actorRole: 'admin', action: 'offer.released', entityType: 'offer', entityId: id, metadata: cur.partnerId ? { partnerId: cur.partnerId } : {} });
    res.json({ offer: o });
  });

  // ---------------------------------------------------------------- bookings and rides

  r.get('/admin/bookings', async (req, res) => {
    const q = query(req, z.object({ status: z.string().max(32).optional(), q: z.string().trim().max(254).optional(), ...page }));
    const where: SQL[] = [];
    if (q.status) where.push(sql`${flightBookings.status}::text = ${q.status}`);
    if (q.q) where.push(or(eq(flightBookings.reference, q.q.toUpperCase()), ilike(flightBookings.contactEmail, `%${q.q}%`), eq(flightBookings.pnr, q.q.toUpperCase()))!);
    const rows = await ctx.db
      .select({
        id: flightBookings.id,
        reference: flightBookings.reference,
        status: flightBookings.status,
        adults: flightBookings.adults,
        totalMinor: flightBookings.totalMinor,
        contactEmail: flightBookings.contactEmail,
        pnr: flightBookings.pnr,
        failureReason: flightBookings.failureReason,
        refundDueMinor: flightBookings.refundDueMinor,
        flightNumber: flights.flightNumber,
        origin: flights.origin,
        destination: flights.destination,
        departAt: flights.departAt,
        source: flightOffers.source,
        createdAt: flightBookings.createdAt,
      })
      .from(flightBookings)
      .innerJoin(flightOffers, eq(flightOffers.id, flightBookings.offerId))
      .innerJoin(flights, eq(flights.id, flightOffers.flightId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(flightBookings.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    res.json({ items: rows });
  });

  r.get('/admin/rides/groups', async (req, res) => {
    const q = query(req, z.object({ status: z.enum(['forming', 'locked', 'assigned', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled']).optional(), ...page }));
    const rows = await ctx.db
      .select({
        id: rideGroups.id,
        status: rideGroups.status,
        airportCode: rideGroups.airportCode,
        vehicleClass: rideGroups.vehicleClass,
        seatsTaken: rideGroups.seatsTaken,
        seatCapacity: rideGroups.seatCapacity,
        parties: rideGroups.parties,
        plannedPickupAt: rideGroups.plannedPickupAt,
        vehicleFareMinor: rideGroups.vehicleFareMinor,
        platformSubsidyMinor: rideGroups.platformSubsidyMinor,
        routeDistanceMeters: rideGroups.routeDistanceMeters,
      })
      .from(rideGroups)
      .where(q.status ? eq(rideGroups.status, q.status) : gte(rideGroups.plannedPickupAt, new Date(Date.now() - 2 * 86_400_000)))
      .orderBy(desc(rideGroups.plannedPickupAt))
      .limit(q.limit)
      .offset(q.offset);
    res.json({ items: rows });
  });

  r.get('/admin/rides/requests', async (req, res) => {
    const q = query(req, z.object({ status: z.enum(['open', 'matched', 'cancelled', 'expired', 'no_match', 'completed']).optional(), ...page }));
    const rows = await ctx.db
      .select({
        id: rideRequests.id,
        status: rideRequests.status,
        airportCode: rideRequests.airportCode,
        flightNumber: rideRequests.flightNumber,
        expectedArrivalAt: rideRequests.expectedArrivalAt,
        destinationArea: rideRequests.destinationArea,
        passengers: rideRequests.passengers,
        createdAt: rideRequests.createdAt,
      })
      .from(rideRequests)
      .where(q.status ? eq(rideRequests.status, q.status) : undefined)
      .orderBy(desc(rideRequests.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    res.json({ items: rows });
  });

  // ---------------------------------------------------------------- incidents

  r.get('/admin/incidents', async (req, res) => {
    const q = query(req, z.object({ status: z.enum(['open', 'investigating', 'resolved']).optional(), ...page }));
    const rows = await ctx.db
      .select({ incident: safetyIncidents, reporter: { fullName: users.fullName, email: users.email }, operator: operators.name })
      .from(safetyIncidents)
      .innerJoin(users, eq(users.id, safetyIncidents.reporterUserId))
      .leftJoin(operators, eq(operators.id, safetyIncidents.operatorId))
      .where(q.status ? eq(safetyIncidents.status, q.status) : undefined)
      .orderBy(sql`case ${safetyIncidents.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(safetyIncidents.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    res.json({ items: rows.map((r) => ({ ...r.incident, reporter: r.reporter, operatorName: r.operator })) });
  });

  r.patch('/admin/incidents/:id', async (req, res) => {
    const { id } = params(req, z.object({ id: uuid }));
    const input = body(req, z.object({ status: z.enum(['open', 'investigating', 'resolved']), resolution: z.string().trim().min(10).max(2000).optional() }));
    if (input.status === 'resolved' && !input.resolution) throw badRequest('Describe how the incident was resolved.', [{ path: 'resolution', message: 'Required to resolve.' }]);
    const [row] = await ctx.db
      .update(safetyIncidents)
      .set({ status: input.status, ...(input.resolution ? { resolution: input.resolution } : {}) })
      .where(eq(safetyIncidents.id, id))
      .returning();
    if (!row) throw notFound('Incident');
    await recordAudit(ctx.db, { actorUserId: currentUser(req).id, actorRole: 'admin', action: `incident.${input.status}`, entityType: 'incident', entityId: id, metadata: input.resolution ? { resolution: input.resolution } : {} });
    res.json({ incident: row });
  });

  // ---------------------------------------------------------------- flights (sandbox status controls)

  r.get('/admin/flights', async (req, res) => {
    const q = query(req, z.object({ q: z.string().trim().max(8).optional() }));
    const now = Date.now();
    const rows = await ctx.db
      .select({ id: flights.id, flightNumber: flights.flightNumber, origin: flights.origin, destination: flights.destination, departAt: flights.departAt, arriveAt: flights.arriveAt, status: flights.status, estimatedArriveAt: flights.estimatedArriveAt })
      .from(flights)
      .where(and(gte(flights.arriveAt, new Date(now - 6 * 3_600_000)), lt(flights.departAt, new Date(now + 4 * 86_400_000)), q.q ? ilike(flights.flightNumber, `%${q.q.toUpperCase()}%`) : undefined))
      .orderBy(flights.arriveAt)
      .limit(100);
    res.json({ items: rows, sandboxControls: ctx.adapters.flightStatus instanceof SandboxFlightStatusAdapter });
  });

  // ---------------------------------------------------------------- configuration

  r.get('/admin/config', async (_req, res) => {
    res.json({ features: await getFeatures(ctx.db), rides: await getRideSettings(ctx.db), adapters: Object.values(ctx.adapters).map((a) => a.info), mode: ctx.config.WAYLO_MODE });
  });

  r.put('/admin/config/features', async (req, res) => {
    const patch = body(req, z.object(Object.fromEntries(Object.keys(DEFAULT_FEATURES).map((k) => [k, z.boolean().optional()]))).strict()) as Record<string, boolean | undefined>;
    const before = await getFeatures(ctx.db);
    const next = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    await upsertConfig(ctx, FEATURES_KEY, next, 'Platform feature switches.');
    await recordAudit(ctx.db, { actorUserId: currentUser(req).id, actorRole: 'admin', action: 'config.features_updated', entityType: 'config', entityId: FEATURES_KEY, metadata: { before, after: next } });
    res.json({ features: next });
  });

  r.put('/admin/config/rides', async (req, res) => {
    const patch = body(
      req,
      z
        .object({
          exitBufferMinutes: z.number().int().min(0).max(120),
          lockLeadMinutes: z.number().int().min(10).max(240),
          maxParties: z.number().int().min(2).max(6),
          defaultSplitMethod: z.enum(['equal_per_seat', 'distance_weighted']),
          lateCancelPercent: z.number().int().min(0).max(100),
          fullChargeWithinMinutes: z.number().int().min(0).max(240),
          pickupGraceMinutes: z.number().int().min(5).max(60),
        })
        .partial()
        .strict(),
    );
    const [row] = await ctx.db.select().from(appConfig).where(eq(appConfig.key, RIDE_SETTINGS_KEY));
    const stored = (row?.value ?? {}) as Record<string, unknown>;
    const before = await getRideSettings(ctx.db);
    await upsertConfig(ctx, RIDE_SETTINGS_KEY, { ...stored, ...patch }, 'Shared-ride operating settings.');
    const after = await getRideSettings(ctx.db);
    await recordAudit(ctx.db, { actorUserId: currentUser(req).id, actorRole: 'admin', action: 'config.rides_updated', entityType: 'config', entityId: RIDE_SETTINGS_KEY, metadata: { changes: patch, before: pick(before, Object.keys(patch)) } });
    res.json({ rides: after });
  });

  // ---------------------------------------------------------------- audit log

  r.get('/admin/audit', async (req, res) => {
    const q = query(req, z.object({ entityType: z.string().max(32).optional(), entityId: z.string().max(64).optional(), action: z.string().max(64).optional(), actorUserId: uuid.optional(), ...page }));
    const where: SQL[] = [];
    if (q.entityType) where.push(eq(auditEvents.entityType, q.entityType));
    if (q.entityId) where.push(eq(auditEvents.entityId, q.entityId));
    if (q.action) where.push(ilike(auditEvents.action, `${q.action}%`));
    if (q.actorUserId) where.push(eq(auditEvents.actorUserId, q.actorUserId));
    const rows = await ctx.db
      .select({ event: auditEvents, actorEmail: users.email })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditEvents.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    res.json({ items: rows.map((r) => ({ ...r.event, actorEmail: r.actorEmail })) });
  });

  return r;
}

async function upsertConfig(ctx: AppContext, key: string, value: unknown, description: string) {
  await ctx.db.insert(appConfig).values({ key, value, description }).onConflictDoUpdate({ target: appConfig.key, set: { value } });
}

function pick<T extends object>(o: T, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k]]));
}
