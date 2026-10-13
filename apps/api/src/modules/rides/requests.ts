import { haversineKm, type RideRequestInput, type rideRequestSchema } from '@waylo/shared';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { airports, cities, flightBookings, flights, pickupZones, rideParticipants, rideRequests } from '../../db/schema';
import type { AuthUser } from '../../http/auth';
import { AppError, badRequest, conflict, notFound, unavailable } from '../../http/errors';
import { deletionBlockers } from '../users/service';

/** Destinations must be within this distance of the airport (service area). */
export const SERVICE_RADIUS_KM = 60;
const MAX_DAYS_AHEAD = 60;

export type RideRequestRow = typeof rideRequests.$inferSelect;
type ParsedRequest = z.output<typeof rideRequestSchema>;

export async function serviceAreas(db: DbOrTx) {
  const zones = await db
    .select({ zone: pickupZones, airportName: airports.name, city: cities.name, timezone: airports.timezone, airportLat: airports.lat, airportLng: airports.lng })
    .from(pickupZones)
    .innerJoin(airports, eq(airports.code, pickupZones.airportCode))
    .innerJoin(cities, eq(cities.id, airports.cityId))
    .where(eq(pickupZones.active, true))
    .orderBy(asc(pickupZones.airportCode), asc(pickupZones.terminal));
  const byAirport = new Map<string, { code: string; name: string; city: string; timezone: string; lat: number; lng: number; zones: { id: string; terminal: string; name: string; instructions: string }[] }>();
  for (const z of zones) {
    const a = byAirport.get(z.zone.airportCode) ?? { code: z.zone.airportCode, name: z.airportName, city: z.city, timezone: z.timezone, lat: z.airportLat, lng: z.airportLng, zones: [] };
    a.zones.push({ id: z.zone.id, terminal: z.zone.terminal, name: z.zone.name, instructions: z.zone.instructions });
    byAirport.set(a.code, a);
  }
  return [...byAirport.values()];
}

/** Finds a known scheduled flight arriving at `airport` near `around` (±12h). */
export async function lookupArrival(db: DbOrTx, flightNumber: string, airport: string, around: Date) {
  const window = 12 * 3_600_000;
  const rows = await db
    .select({ id: flights.id, arriveAt: flights.arriveAt, departAt: flights.departAt, origin: flights.origin, status: flights.status, estimatedArriveAt: flights.estimatedArriveAt })
    .from(flights)
    .where(
      and(
        // Stored flight numbers include the airline designator, e.g. "S1807".
        eq(flights.flightNumber, flightNumber),
        eq(flights.destination, airport),
        gte(flights.arriveAt, new Date(around.getTime() - window)),
        lte(flights.arriveAt, new Date(around.getTime() + window)),
      ),
    );
  return rows.sort((a, b) => Math.abs(a.arriveAt.getTime() - around.getTime()) - Math.abs(b.arriveAt.getTime() - around.getTime()))[0];
}

export async function createRideRequest(ctx: AppContext, user: AuthUser, input: ParsedRequest, now = new Date()) {
  const [zone] = await ctx.db
    .select({ zone: pickupZones, airportLat: airports.lat, airportLng: airports.lng })
    .from(pickupZones)
    .innerJoin(airports, eq(airports.code, pickupZones.airportCode))
    .where(eq(pickupZones.id, input.pickupZoneId));
  if (!zone || !zone.zone.active || zone.zone.airportCode !== input.airport) {
    throw badRequest('Choose a pickup point at your arrival airport.', [{ path: 'pickupZoneId', message: 'Choose a pickup point at your arrival airport.' }]);
  }

  let scheduledArrival = new Date(input.arrivalAt);
  let flightId: string | null = null;
  let flightBookingId: string | null = null;

  if (input.flightBookingId) {
    const [b] = await ctx.db.select().from(flightBookings).where(eq(flightBookings.id, input.flightBookingId));
    const snap = b?.snapshot as { destination?: string; arriveAt?: string } | undefined;
    if (!b || b.userId !== user.id || b.status !== 'confirmed' || snap?.destination !== input.airport) {
      throw badRequest('That flight booking cannot be linked to this ride.');
    }
    flightBookingId = b.id;
    scheduledArrival = new Date(snap.arriveAt!);
  }
  if (input.flightNumber) {
    const f = await lookupArrival(ctx.db, input.flightNumber, input.airport, scheduledArrival);
    if (f) {
      flightId = f.id;
      scheduledArrival = f.arriveAt;
    }
  }

  if (scheduledArrival.getTime() < now.getTime() - 15 * 60_000) {
    throw badRequest('Your arrival time is in the past.', [{ path: 'arrivalAt', message: 'Your arrival time is in the past.' }]);
  }
  if (scheduledArrival.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) {
    throw badRequest(`Ride requests open ${MAX_DAYS_AHEAD} days before arrival.`, [{ path: 'arrivalAt', message: `Ride requests open ${MAX_DAYS_AHEAD} days before arrival.` }]);
  }

  const km = haversineKm({ lat: zone.airportLat, lng: zone.airportLng }, input.destination);
  if (km > SERVICE_RADIUS_KM) {
    throw new AppError(400, 'outside_service_area', `Shared rides currently cover destinations within ${SERVICE_RADIUS_KM} km of the airport.`, [
      { path: 'destination', message: `Choose a destination within ${SERVICE_RADIUS_KM} km of the airport.` },
    ]);
  }

  const existing = await ctx.db
    .select({ id: rideRequests.id })
    .from(rideRequests)
    .where(and(eq(rideRequests.userId, user.id), eq(rideRequests.airportCode, input.airport), eq(rideRequests.scheduledArrivalAt, scheduledArrival), inArray(rideRequests.status, ['open', 'matched'])));
  if (existing.length) throw conflict('duplicate_request', 'You already have an active ride request for this arrival.', { requestId: existing[0]!.id });

  let route;
  try {
    route = await ctx.adapters.maps.estimateRoute([{ lat: zone.zone.lat, lng: zone.zone.lng }, input.destination], scheduledArrival);
  } catch (err) {
    ctx.logger.warn({ err }, 'route estimate failed');
    throw unavailable('routing_unavailable', 'We could not calculate the route right now. Please try again in a moment.');
  }

  try {
    const [row] = await ctx.db
      .insert(rideRequests)
      .values({
        userId: user.id,
        airportCode: input.airport,
        pickupZoneId: zone.zone.id,
        flightNumber: input.flightNumber ?? null,
        flightId,
        flightBookingId,
        scheduledArrivalAt: scheduledArrival,
        expectedArrivalAt: scheduledArrival,
        destinationPlaceId: input.destination.placeId,
        destinationLabel: input.destination.label,
        destinationArea: input.destination.area,
        destinationLat: input.destination.lat,
        destinationLng: input.destination.lng,
        directDistanceMeters: route.distanceMeters,
        directDurationSeconds: route.durationSeconds,
        passengers: input.passengers,
        luggageCabin: input.luggage.cabin,
        luggageMedium: input.luggage.medium,
        luggageLarge: input.luggage.large,
        vehiclePreference: input.vehiclePreference,
        maxWaitMinutes: input.maxWaitMinutes,
        maxDetourMinutes: input.maxDetourMinutes,
        wheelchair: input.wheelchair,
        notes: input.notes ?? null,
      })
      .returning();
    return row!;
  } catch (err) {
    // Lost a race with a concurrent identical submission (partial unique index).
    if (String((err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code) === '23505') {
      throw conflict('duplicate_request', 'You already have an active ride request for this arrival.');
    }
    throw err;
  }
}

export async function loadRideRequest(db: DbOrTx, user: AuthUser, id: string) {
  const [r] = await db.select().from(rideRequests).where(eq(rideRequests.id, id));
  if (!r || (r.userId !== user.id && user.role !== 'admin')) throw notFound('Ride request');
  return r;
}

export async function toRideRequestDto(db: DbOrTx, r: RideRequestRow) {
  const [zone] = await db.select().from(pickupZones).where(eq(pickupZones.id, r.pickupZoneId));
  const [participation] = await db
    .select({ groupId: rideParticipants.groupId, status: rideParticipants.status })
    .from(rideParticipants)
    .where(eq(rideParticipants.requestId, r.id))
    .orderBy(desc(rideParticipants.joinedAt))
    .limit(1);
  const [flight] = r.flightId ? await db.select().from(flights).where(eq(flights.id, r.flightId)) : [];
  return {
    id: r.id,
    status: r.status,
    groupId: participation && ['joined', 'payment_due', 'confirmed', 'completed'].includes(participation.status) ? participation.groupId : null,
    airport: r.airportCode,
    pickupZone: zone ? { id: zone.id, terminal: zone.terminal, name: zone.name, instructions: zone.instructions } : null,
    flightNumber: r.flightNumber,
    flightLinked: !!r.flightId,
    flight: flight
      ? {
          status: flight.status,
          scheduledArrivalAt: flight.arriveAt.toISOString(),
          estimatedArrivalAt: flight.estimatedArriveAt?.toISOString() ?? null,
          delayMinutes: flight.estimatedArriveAt ? Math.round((flight.estimatedArriveAt.getTime() - flight.arriveAt.getTime()) / 60_000) : 0,
          updatedAt: flight.statusUpdatedAt?.toISOString() ?? null,
        }
      : null,
    closedReason: r.closedReason,
    flightBookingId: r.flightBookingId,
    scheduledArrivalAt: r.scheduledArrivalAt.toISOString(),
    expectedArrivalAt: r.expectedArrivalAt.toISOString(),
    destination: { placeId: r.destinationPlaceId, label: r.destinationLabel, area: r.destinationArea, lat: r.destinationLat, lng: r.destinationLng },
    direct: { distanceMeters: r.directDistanceMeters, durationSeconds: r.directDurationSeconds },
    passengers: r.passengers,
    luggage: { cabin: r.luggageCabin, medium: r.luggageMedium, large: r.luggageLarge },
    vehiclePreference: r.vehiclePreference,
    maxWaitMinutes: r.maxWaitMinutes,
    maxDetourMinutes: r.maxDetourMinutes,
    wheelchair: r.wheelchair,
    notes: r.notes,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
export type RideRequestDto = Awaited<ReturnType<typeof toRideRequestDto>>;

export async function listRideRequests(ctx: AppContext, user: AuthUser) {
  const rows = await ctx.db.select().from(rideRequests).where(eq(rideRequests.userId, user.id)).orderBy(desc(rideRequests.createdAt)).limit(100);
  return Promise.all(rows.map((r) => toRideRequestDto(ctx.db, r)));
}

/** Cancels a request that has not joined a group yet. Leaving a group is handled by the matching module. */
export async function cancelOpenRequest(ctx: AppContext, user: AuthUser, id: string, now = new Date()) {
  return ctx.db.transaction(async (tx) => {
    const [r] = await tx.select().from(rideRequests).where(eq(rideRequests.id, id)).for('update');
    if (!r || r.userId !== user.id) throw notFound('Ride request');
    if (r.status !== 'open') throw conflict('not_cancellable', r.status === 'matched' ? 'Leave your ride group to cancel this request.' : 'This request is no longer active.');
    const [updated] = await tx.update(rideRequests).set({ status: 'cancelled', cancelledAt: now }).where(eq(rideRequests.id, id)).returning();
    return updated!;
  });
}

/** Background job: open requests whose waiting window has passed without a match. */
export async function expireUnmatchedRequests(ctx: AppContext, now = new Date()) {
  const rows = await ctx.db
    .update(rideRequests)
    .set({ status: 'no_match' })
    .where(and(eq(rideRequests.status, 'open'), sql`${rideRequests.expectedArrivalAt} + make_interval(mins => ${rideRequests.maxWaitMinutes}) < ${now}`))
    .returning({ id: rideRequests.id });
  return rows.length;
}

deletionBlockers.push(async (db, userId) => {
  const [active] = await db
    .select({ id: rideRequests.id })
    .from(rideRequests)
    .where(and(eq(rideRequests.userId, userId), inArray(rideRequests.status, ['open', 'matched'])))
    .limit(1);
  return active ? 'You have an active shared-ride request.' : null;
});

export type { RideRequestInput };
