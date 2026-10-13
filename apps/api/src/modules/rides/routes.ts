import { rideRequestSchema } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { airports } from '../../db/schema';
import { currentUser, requireAuth } from '../../http/auth';
import { badRequest, notFound, unavailable } from '../../http/errors';
import { limiter } from '../../http/rateLimit';
import { body, params, query } from '../../http/validate';
import { cancelOpenRequest, createRideRequest, listRideRequests, loadRideRequest, lookupArrival, SERVICE_RADIUS_KM, serviceAreas, toRideRequestDto } from './requests';

export function ridesRouter(ctx: AppContext): Router {
  const r = Router();
  const placesLimit = limiter({ windowMs: 60_000, limit: 60, name: 'places' });
  const idParam = z.object({ requestId: z.string().uuid() });

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

  r.post('/rides/requests/:requestId/cancel', requireAuth, async (req, res) => {
    const { requestId } = params(req, idParam);
    const row = await cancelOpenRequest(ctx, currentUser(req), requestId);
    res.json({ request: await toRideRequestDto(ctx.db, row) });
  });

  return r;
}
