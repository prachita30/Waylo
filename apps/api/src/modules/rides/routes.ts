import { rideRequestSchema } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { airports, flights } from '../../db/schema';
import { currentUser, requireAuth, requireRole } from '../../http/auth';
import { badRequest, notFound, unavailable } from '../../http/errors';
import { limiter } from '../../http/rateLimit';
import { body, params, query } from '../../http/validate';
import { SandboxFlightStatusAdapter } from '../../adapters/flightStatus/sandbox';
import { recordAudit } from '../../lib/audit';
import { ridePaymentCheckout } from '../payments/ridePayments';
import { updateFlightStatus } from './flightAware';
import { findMatches, joinGroup, leaveGroup, loadGroupForUser, READINESS, setReadiness, startGroup, toGroupDto } from './groups';
import { cancelOpenRequest, createRideRequest, listRideRequests, loadRideRequest, lookupArrival, SERVICE_RADIUS_KM, serviceAreas, toRideRequestDto } from './requests';

export function ridesRouter(ctx: AppContext): Router {
  const r = Router();
  const placesLimit = limiter({ windowMs: 60_000, limit: 60, name: 'places' });
  const idParam = z.object({ requestId: z.string().uuid() });
  const groupParam = z.object({ groupId: z.string().uuid() });
  const writeLimit = limiter({ windowMs: 60_000, limit: Math.max(20, Math.floor(ctx.config.API_RATE_LIMIT / 10)), name: 'ride-writes' });

  r.get('/rides/service-areas', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300').json({ items: await serviceAreas(ctx.db), radiusKm: SERVICE_RADIUS_KM });
  });

  /** Destination search near an airport. The maps provider key never leaves the server. */
  r.get('/places/search', placesLimit, async (req, res) => {
    const q = query(req, z.object({ q: z.string().trim().min(2).max(80), airport: z.string().regex(/^[A-Z]{3}$/) }));
    const [a] = await ctx.db.select({ lat: airports.lat, lng: airports.lng }).from(airports).where(eq(airports.code, q.airport));
    if (!a) throw badRequest('Unknown airport.');
    try {
      res.json({ items: await ctx.adapters.maps.searchPlaces(q.q, a, SERVICE_RADIUS_KM) });
    } catch {
      throw unavailable('maps_unavailable', 'Place search is unavailable right now. Please try again shortly.');
    }
  });

  r.get('/rides/flight-lookup', requireAuth, async (req, res) => {
    const q = query(
      req,
      z.object({
        flight: z.string().trim().toUpperCase().transform((s) => s.replace(/\s+/g, '')).pipe(z.string().regex(/^[A-Z0-9]{2}\d{1,4}$/)),
        airport: z.string().regex(/^[A-Z]{3}$/),
        around: z.string().datetime({ offset: true }),
      }),
    );
    const f = await lookupArrival(ctx.db, q.flight, q.airport, new Date(q.around));
    if (!f) throw notFound('Flight');
    res.json({
      flight: {
        flightNumber: q.flight,
        origin: f.origin,
        scheduledArrivalAt: f.arriveAt.toISOString(),
        estimatedArrivalAt: f.estimatedArriveAt?.toISOString() ?? null,
        status: f.status,
      },
    });
  });

  r.post('/rides/requests', requireAuth, async (req, res) => {
    const input = body(req, rideRequestSchema);
    const row = await createRideRequest(ctx, currentUser(req), input);
    res.status(201).json({ request: await toRideRequestDto(ctx.db, row) });
  });

  r.get('/rides/requests', requireAuth, async (req, res) => {
    res.json({ items: await listRideRequests(ctx, currentUser(req)) });
  });

  r.get('/rides/requests/:requestId', requireAuth, async (req, res) => {
    const { requestId } = params(req, idParam);
    const row = await loadRideRequest(ctx.db, currentUser(req), requestId);
    res.json({ request: await toRideRequestDto(ctx.db, row) });
  });

  // ---- matching & groups

  r.get('/rides/requests/:requestId/matches', requireAuth, async (req, res) => {
    const { requestId } = params(req, idParam);
    res.json(await findMatches(ctx, currentUser(req), requestId));
  });

  r.post('/rides/groups', requireAuth, writeLimit, async (req, res) => {
    const input = body(
      req,
      z.object({
        requestId: z.string().uuid(),
        soloOk: z.boolean(),
        splitMethod: z.enum(['equal_per_seat', 'distance_weighted']).optional(),
        acceptedMaxTotalMinor: z.number().int().positive(),
      }),
    );
    const g = await startGroup(ctx, currentUser(req), input);
    res.status(201).json({ group: await toGroupDto(ctx, g, currentUser(req).id) });
  });

  r.post('/rides/groups/:groupId/join', requireAuth, writeLimit, async (req, res) => {
    const { groupId } = params(req, groupParam);
    const input = body(req, z.object({ requestId: z.string().uuid(), acceptedMaxTotalMinor: z.number().int().positive() }));
    await joinGroup(ctx, currentUser(req), groupId, input);
    const g = await loadGroupForUser(ctx.db, currentUser(req), groupId);
    res.json({ group: await toGroupDto(ctx, g, currentUser(req).id) });
  });

  r.get('/rides/groups/:groupId', requireAuth, async (req, res) => {
    const { groupId } = params(req, groupParam);
    const g = await loadGroupForUser(ctx.db, currentUser(req), groupId);
    res.json({ group: await toGroupDto(ctx, g, currentUser(req).id) });
  });

  r.post('/rides/groups/:groupId/leave', requireAuth, writeLimit, async (req, res) => {
    const { groupId } = params(req, groupParam);
    const { cancelRequest } = body(req, z.object({ cancelRequest: z.boolean().default(false) }));
    res.json(await leaveGroup(ctx, currentUser(req), groupId, { cancelRequest }));
  });

  /** Checkout for the rider's seat once the group has locked. */
  r.post('/rides/groups/:groupId/pay', requireAuth, async (req, res) => {
    const { groupId } = params(req, groupParam);
    res.json(await ridePaymentCheckout(ctx, currentUser(req).id, groupId));
  });

  r.post('/rides/groups/:groupId/readiness', requireAuth, async (req, res) => {
    const { groupId } = params(req, groupParam);
    const { readiness } = body(req, z.object({ readiness: z.enum(READINESS) }));
    await setReadiness(ctx, currentUser(req), groupId, readiness);
    const g = await loadGroupForUser(ctx.db, currentUser(req), groupId);
    res.json({ group: await toGroupDto(ctx, g, currentUser(req).id) });
  });

  /**
   * Sandbox control (administrators only): simulate a delay or cancellation for a flight and apply
   * it to linked rides immediately. Not available with a live flight-status provider.
   */
  r.post('/sandbox/flights/:flightId/status', requireRole('admin'), async (req, res) => {
    const { flightId } = params(req, z.object({ flightId: z.string().uuid() }));
    const input = body(req, z.object({ delayMinutes: z.number().int().min(0).max(720).default(0), cancelled: z.boolean().default(false) }));
    if (!(ctx.adapters.flightStatus instanceof SandboxFlightStatusAdapter)) throw notFound('Sandbox control');
    const [f] = await ctx.db.select().from(flights).where(eq(flights.id, flightId));
    if (!f) throw notFound('Flight');
    ctx.adapters.flightStatus.setOverride({ flightNumber: f.flightNumber, scheduledDepartAt: f.departAt }, input);
    await updateFlightStatus(ctx, f);
    await recordAudit(ctx.db, { actorUserId: currentUser(req).id, actorRole: 'admin', action: 'sandbox.flight_status_set', entityType: 'flight', entityId: f.id, metadata: input });
    const [after] = await ctx.db.select().from(flights).where(eq(flights.id, flightId));
    res.json({ flight: { id: after!.id, status: after!.status, estimatedArrivalAt: after!.estimatedArriveAt?.toISOString() ?? null } });
  });

  r.post('/rides/requests/:requestId/cancel', requireAuth, async (req, res) => {
    const { requestId } = params(req, idParam);
    const row = await cancelOpenRequest(ctx, currentUser(req), requestId);
    res.json({ request: await toRideRequestDto(ctx.db, row) });
  });

  return r;
}
