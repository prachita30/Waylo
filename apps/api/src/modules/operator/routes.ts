import { availabilitySchema, driverSchema, incidentSchema, onboardingSchema, VEHICLE_CLASSES, vehicleSchema } from '@waylo/shared';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { requireFeature } from '../../lib/settings';
import multer from 'multer';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { airports, availability, drivers, operatorMembers, operators, rideParticipants, rideTrips, safetyIncidents } from '../../db/schema';
import { currentUser, requireAuth, requireRole } from '../../http/auth';
import { badRequest, conflict, notFound } from '../../http/errors';
import { body, params, query } from '../../http/validate';
import { recordAudit } from '../../lib/audit';
import { membershipFor, requireMembership } from './access';
import { addAvailability, addDriver, addVehicle, fleetOverview, readDocument, storeDocument } from './fleet';
import { acceptTrip, advanceTrip, earnings, getTrip, listOffers, listTrips, recordLocation, releaseTrip, riderAction } from './trips';

const uuid = z.string().uuid();

export function operatorRouter(ctx: AppContext): Router {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  r.use('/operator', requireAuth, requireRole('operator'));

  r.get('/operator/me', async (req, res) => {
    const m = await membershipFor(ctx.db, currentUser(req).id);
    res.json({ membership: m ? { role: m.role, driverId: m.driverId, operator: m.operator } : null });
  });

  r.post('/operator/onboarding', async (req, res) => {
    await requireFeature(ctx.db, 'operatorOnboarding');
    const user = currentUser(req);
    if (await membershipFor(ctx.db, user.id)) throw conflict('already_onboarded', 'You already belong to an operator.');
    const input = body(req, onboardingSchema);
    const known = await ctx.db.select({ code: airports.code }).from(airports);
    if (input.airports.some((a) => !known.some((k) => k.code === a))) throw badRequest('Unknown airport in service area.');
    const operator = await ctx.db.transaction(async (tx) => {
      const [op] = await tx.insert(operators).values({ name: input.name, phone: input.phone, airports: input.airports }).returning();
      await tx.insert(operatorMembers).values({ operatorId: op!.id, userId: user.id, role: 'owner' });
      await recordAudit(tx, { actorUserId: user.id, actorRole: 'operator', action: 'operator.onboarded', entityType: 'operator', entityId: op!.id });
      return op!;
    });
    res.status(201).json({ operator });
  });

  // ---- fleet
  r.get('/operator/fleet', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { manage: true });
    res.json(await fleetOverview(ctx, m.operator.id));
  });

  r.post('/operator/vehicles', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { manage: true });
    const v = body(req, vehicleSchema);
    const spec = VEHICLE_CLASSES[v.vehicleClass];
    if (v.seats < spec.seats - 1) throw badRequest(`A ${spec.label.toLowerCase()} should have at least ${spec.seats - 1} passenger seats.`);
    res.status(201).json({ vehicle: await addVehicle(ctx, m.operator.id, currentUser(req).id, { ...v, operatorId: m.operator.id }) });
  });

  r.post('/operator/drivers', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { manage: true });
    res.status(201).json({ driver: await addDriver(ctx, m.operator.id, currentUser(req).id, body(req, driverSchema)) });
  });

  r.post('/operator/documents', (req, res, next) => {
    upload.single('file')(req, res, async (err: unknown) => {
      try {
        if (err instanceof multer.MulterError) throw badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'Documents must be 5 MB or smaller.' : 'Upload failed.');
        if (err) throw err;
        const m = await requireMembership(ctx.db, req, { manage: true });
        const meta = z
          .object({
            subjectType: z.enum(['operator', 'driver', 'vehicle']),
            subjectId: uuid,
            docType: z.enum(['operator_permit', 'insurance', 'vehicle_registration', 'fitness_certificate', 'driving_licence', 'police_verification']),
            expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
          })
          .parse(req.body);
        if (!req.file) throw badRequest('Choose a file to upload.');
        const doc = await storeDocument(ctx, { ...meta, operatorId: m.operator.id, uploadedBy: currentUser(req).id, file: req.file.buffer });
        const { fileName: _f, ...safe } = doc;
        res.status(201).json({ document: safe });
      } catch (e) {
        next(e);
      }
    });
  });

  r.get('/operator/documents/:docId/file', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { manage: true });
    const { docId } = params(req, z.object({ docId: uuid }));
    const { doc, data } = await readDocument(ctx, docId, m.operator.id);
    res.set({ 'Content-Type': doc.contentType, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(data);
  });

  r.post('/operator/availability', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { manage: true, approved: true });
    res.status(201).json({ availability: await addAvailability(ctx, m.operator.id, body(req, availabilitySchema)) });
  });

  r.delete('/operator/availability/:id', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { manage: true });
    const { id } = params(req, z.object({ id: uuid }));
    const deleted = await ctx.db.delete(availability).where(and(eq(availability.id, id), eq(availability.operatorId, m.operator.id))).returning();
    if (!deleted.length) throw notFound('Shift');
    res.status(204).end();
  });

  // ---- trips
  r.get('/operator/trips', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { approved: true });
    const { tab } = query(req, z.object({ tab: z.enum(['offers', 'active', 'history']).default('active') }));
    if (tab === 'offers') {
      if (m.role === 'driver') throw badRequest('Drivers see their assigned trips only.');
      res.json({ items: await listOffers(ctx, m) });
    } else res.json({ items: await listTrips(ctx, m, tab) });
  });

  r.get('/operator/trips/:groupId', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { approved: true });
    const { groupId } = params(req, z.object({ groupId: uuid }));
    res.json({ trip: await getTrip(ctx, m, groupId) });
  });

  r.post('/operator/trips/:groupId/accept', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { manage: true, approved: true });
    const { groupId } = params(req, z.object({ groupId: uuid }));
    await acceptTrip(ctx, m, currentUser(req).id, groupId, body(req, z.object({ driverId: uuid, vehicleId: uuid })));
    res.json({ trip: await getTrip(ctx, m, groupId) });
  });

  r.post('/operator/trips/:groupId/release', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { manage: true, approved: true });
    const { groupId } = params(req, z.object({ groupId: uuid }));
    const { reason } = body(req, z.object({ reason: z.string().trim().min(5).max(500) }));
    await releaseTrip(ctx, m, currentUser(req).id, groupId, reason);
    res.status(204).end();
  });

  r.post('/operator/trips/:groupId/status', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { approved: true });
    const { groupId } = params(req, z.object({ groupId: uuid }));
    const { status } = body(req, z.object({ status: z.enum(['en_route', 'arrived', 'in_progress']) }));
    await advanceTrip(ctx, m, currentUser(req).id, groupId, status);
    res.json({ trip: await getTrip(ctx, m, groupId) });
  });

  r.post('/operator/trips/:groupId/riders/:participantId', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { approved: true });
    const { groupId, participantId } = params(req, z.object({ groupId: uuid, participantId: uuid }));
    const { action } = body(req, z.object({ action: z.enum(['boarded', 'no_show', 'dropped_off']) }));
    await riderAction(ctx, m, currentUser(req).id, groupId, participantId, action);
    res.json({ trip: await getTrip(ctx, m, groupId) });
  });

  r.post('/operator/trips/:groupId/location', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { approved: true });
    const { groupId } = params(req, z.object({ groupId: uuid }));
    const point = body(req, z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }));
    res.json(await recordLocation(ctx, m, groupId, point));
  });

  r.get('/operator/earnings', async (req, res) => {
    const m = await requireMembership(ctx.db, req, { manage: true });
    res.json(await earnings(ctx, m));
  });

  r.get('/operator/drivers/me', async (req, res) => {
    const m = await requireMembership(ctx.db, req);
    if (!m.driverId) throw notFound('Driver profile');
    const [d] = await ctx.db.select().from(drivers).where(eq(drivers.id, m.driverId));
    res.json({ driver: d });
  });

  return r;
}

/** Incident reports from riders, drivers and operators. Safety-critical reports are escalated. */
export function incidentsRouter(ctx: AppContext): Router {
  const r = Router();
  r.post('/incidents', requireAuth, async (req, res) => {
    const user = currentUser(req);
    const input = body(req, incidentSchema);
    let operatorId: string | null = null;
    if (user.role === 'operator') operatorId = (await membershipFor(ctx.db, user.id))?.operator.id ?? null;
    if (input.groupId) {
      const isRider = (await ctx.db.select().from(rideParticipants).where(and(eq(rideParticipants.groupId, input.groupId), eq(rideParticipants.userId, user.id)))).length > 0;
      const [trip] = await ctx.db.select().from(rideTrips).where(eq(rideTrips.groupId, input.groupId));
      const isOperator = !!operatorId && trip?.operatorId === operatorId;
      if (!isRider && !isOperator) throw notFound('Ride');
      operatorId ??= trip?.operatorId ?? null;
    }
    const [incident] = await ctx.db
      .insert(safetyIncidents)
      .values({ reporterUserId: user.id, reporterRole: user.role, groupId: input.groupId ?? null, operatorId, category: input.category, severity: input.severity, description: input.description })
      .returning();
    await recordAudit(ctx.db, { actorUserId: user.id, actorRole: user.role, action: 'incident.reported', entityType: 'incident', entityId: incident!.id, metadata: { severity: input.severity } });
    if (input.severity === 'critical' || input.category === 'safety' || input.category === 'accident') {
      ctx.logger.warn({ incidentId: incident!.id, severity: input.severity }, 'SAFETY ESCALATION: incident requires immediate review');
    }
    res.status(201).json({ incident });
  });

  r.get('/incidents/mine', requireAuth, async (req, res) => {
    const rows = await ctx.db.select().from(safetyIncidents).where(eq(safetyIncidents.reporterUserId, currentUser(req).id));
    res.json({ items: rows });
  });
  return r;
}
