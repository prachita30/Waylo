import { applyBps, distanceToPathMeters } from '@waylo/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import type { Tx } from '../../db/client';
import { drivers, operators, pickupZones, rideGroups, rideParticipants, rideRequests, rideTrips, tripReleases, users, vehicles } from '../../db/schema';
import { AppError, conflict, notFound } from '../../http/errors';
import { recordAudit } from '../../lib/audit';
import { type DomainEvent, emit } from '../../lib/events';
import { getRideSettings } from '../../lib/settings';
import type { Membership } from './access';

type GroupRow = typeof rideGroups.$inferSelect;
const ACTIVE_PARTICIPANT = ['joined', 'payment_due', 'confirmed'] as const;
/** Driver can't hold two trips whose pickups are closer than this. */
const DRIVER_BUFFER_MS = 2 * 3_600_000;
/** A driver more than this far from the planned route is flagged for review. */
const OFF_ROUTE_METERS = 2_500;

async function needsAccessible(db: AppContext['db'] | Tx, groupId: string) {
  const rows = await db
    .select({ wheelchair: rideRequests.wheelchair })
    .from(rideParticipants)
    .innerJoin(rideRequests, eq(rideRequests.id, rideParticipants.requestId))
    .where(and(eq(rideParticipants.groupId, groupId), inArray(rideParticipants.status, [...ACTIVE_PARTICIPANT])));
  return rows.some((r) => r.wheelchair);
}

export function vehicleFits(v: typeof vehicles.$inferSelect, g: Pick<GroupRow, 'seatsTaken' | 'luggageTaken'>, accessible: boolean) {
  return v.status === 'approved' && v.seats >= g.seatsTaken && v.luggageUnits >= g.luggageTaken && (!accessible || v.wheelchairAccessible);
}

/** Locked, unassigned groups at airports this operator serves, that its approved fleet can carry. */
export async function listOffers(ctx: AppContext, m: Membership) {
  const assigned = ctx.db.select({ id: rideTrips.groupId }).from(rideTrips);
  const groups = await ctx.db
    .select({ g: rideGroups, zone: pickupZones })
    .from(rideGroups)
    .innerJoin(pickupZones, eq(pickupZones.id, rideGroups.pickupZoneId))
    .where(and(eq(rideGroups.status, 'locked'), notInArray(rideGroups.id, assigned), inArray(rideGroups.airportCode, m.operator.airports.length ? m.operator.airports : ['---'])))
    .orderBy(asc(rideGroups.plannedPickupAt));
  const fleet = await ctx.db.select().from(vehicles).where(eq(vehicles.operatorId, m.operator.id));
  const out = [];
  for (const { g, zone } of groups) {
    const accessible = await needsAccessible(ctx.db, g.id);
    if (!fleet.some((v) => vehicleFits(v, g, accessible))) continue;
    out.push({ ...tripSummary(g, zone, m.operator.commissionBps), wheelchairAccessibleRequired: accessible });
  }
  return out;
}

function tripSummary(g: GroupRow, zone: typeof pickupZones.$inferSelect, commissionBps: number) {
  const commission = applyBps(g.vehicleFareMinor, commissionBps);
  return {
    groupId: g.id,
    status: g.status,
    airport: g.airportCode,
    pickupZone: { name: zone.name, terminal: zone.terminal, instructions: zone.instructions, lat: zone.lat, lng: zone.lng },
    plannedPickupAt: g.plannedPickupAt.toISOString(),
    vehicleClass: g.vehicleClass,
    seatsTaken: g.seatsTaken,
    luggageTaken: g.luggageTaken,
    parties: g.parties,
    routeDistanceMeters: g.routeDistanceMeters,
    routeDurationSeconds: g.routeDurationSeconds,
    vehicleFareMinor: g.vehicleFareMinor,
    estimatedEarningMinor: g.vehicleFareMinor - commission,
  };
}

/** Accept an offer: first operator wins (group row locked); driver and vehicle must be approved and fit. */
export async function acceptTrip(ctx: AppContext, m: Membership, actorId: string, groupId: string, input: { driverId: string; vehicleId: string }) {
  const events: DomainEvent[] = [];
  await ctx.db.transaction(async (tx) => {
    const [g] = await tx.select().from(rideGroups).where(eq(rideGroups.id, groupId)).for('update');
    if (!g || !m.operator.airports.includes(g.airportCode)) throw notFound('Trip');
    if (g.status !== 'locked') throw conflict('trip_unavailable', 'This trip is no longer available.');
    const [existing] = await tx.select().from(rideTrips).where(eq(rideTrips.groupId, groupId));
    if (existing) throw conflict('trip_taken', 'Another operator has already accepted this trip.');
    const [d] = await tx.select().from(drivers).where(and(eq(drivers.id, input.driverId), eq(drivers.operatorId, m.operator.id)));
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, input.vehicleId), eq(vehicles.operatorId, m.operator.id)));
    if (!d || !v) throw notFound('Driver or vehicle');
    if (d.status !== 'approved') throw conflict('driver_not_approved', 'This driver is not approved yet.');
    if (!vehicleFits(v, g, await needsAccessible(tx, g.id))) throw conflict('vehicle_unsuitable', 'This vehicle cannot carry this group’s seats, luggage or accessibility needs.');
    const busy = await tx
      .select({ id: rideTrips.groupId })
      .from(rideTrips)
      .innerJoin(rideGroups, eq(rideGroups.id, rideTrips.groupId))
      .where(
        and(
          eq(rideTrips.driverId, d.id),
          isNull(rideTrips.completedAt),
          ne(rideGroups.status, 'cancelled'),
          gte(rideGroups.plannedPickupAt, new Date(g.plannedPickupAt.getTime() - DRIVER_BUFFER_MS)),
          lte(rideGroups.plannedPickupAt, new Date(g.plannedPickupAt.getTime() + DRIVER_BUFFER_MS)),
        ),
      );
    if (busy.length) throw conflict('driver_busy', 'This driver already has a trip close to this pickup time.');
    await tx.insert(rideTrips).values({ groupId, operatorId: m.operator.id, driverId: d.id, vehicleId: v.id });
    await tx.update(rideGroups).set({ status: 'assigned' }).where(eq(rideGroups.id, groupId));
    await recordAudit(tx, { actorUserId: actorId, actorRole: 'operator', action: 'trip.accepted', entityType: 'ride_group', entityId: groupId, metadata: { operatorId: m.operator.id } });
    const riders = await tx.select({ userId: rideParticipants.userId }).from(rideParticipants).where(and(eq(rideParticipants.groupId, groupId), inArray(rideParticipants.status, [...ACTIVE_PARTICIPANT])));
    events.push({ type: 'ride.driver_assigned', userIds: riders.map((r) => r.userId), groupId, driverName: d.fullName.split(' ')[0]!, vehicle: `${v.colour} ${v.makeModel} · ${v.registration}` });
  });
  await emit(ctx, events);
}

async function loadTripFor(tx: Tx, m: Membership, groupId: string) {
  const [t] = await tx.select().from(rideTrips).where(eq(rideTrips.groupId, groupId)).for('update');
  if (!t || t.operatorId !== m.operator.id) throw notFound('Trip');
  // Drivers can only act on their own trips.
  if (m.role === 'driver' && t.driverId !== m.driverId) throw notFound('Trip');
  const [g] = await tx.select().from(rideGroups).where(eq(rideGroups.id, groupId)).for('update');
  return { t, g: g! };
}

/** Operator hands a trip back before the driver sets off; it is re-offered to operators. */
export async function releaseTrip(ctx: AppContext, m: Membership, actorId: string, groupId: string, reason: string) {
  await ctx.db.transaction(async (tx) => {
    const { g } = await loadTripFor(tx, m, groupId);
    if (g.status !== 'assigned') throw conflict('cannot_release', 'Trips can only be released before the driver sets off. Contact WAYLO support.');
    await tx.delete(rideTrips).where(eq(rideTrips.groupId, groupId));
    await tx.insert(tripReleases).values({ groupId, operatorId: m.operator.id, reason });
    await tx.update(rideGroups).set({ status: 'locked' }).where(eq(rideGroups.id, groupId));
    await recordAudit(tx, { actorUserId: actorId, actorRole: 'operator', action: 'trip.released', entityType: 'ride_group', entityId: groupId, metadata: { reason } });
  });
}

const NEXT: Record<string, GroupRow['status'][]> = {
  assigned: ['en_route'],
  en_route: ['arrived'],
  arrived: ['in_progress'],
};

/** Trip progress: assigned → en_route → arrived → in_progress. Completion happens through drop-offs. */
export async function advanceTrip(ctx: AppContext, m: Membership, actorId: string, groupId: string, to: 'en_route' | 'arrived' | 'in_progress', now = new Date()) {
  const events: DomainEvent[] = [];
  await ctx.db.transaction(async (tx) => {
    const { g } = await loadTripFor(tx, m, groupId);
    if (!NEXT[g.status]?.includes(to)) throw conflict('invalid_transition', `A trip that is ${g.status.replace('_', ' ')} cannot move to ${to.replace('_', ' ')}.`);
    if (to === 'in_progress') {
      const boarded = await tx
        .select({ id: rideParticipants.id })
        .from(rideParticipants)
        .where(and(eq(rideParticipants.groupId, groupId), inArray(rideParticipants.status, [...ACTIVE_PARTICIPANT]), sql`${rideParticipants.boardedAt} is not null`));
      if (!boarded.length) throw conflict('nobody_boarded', 'Mark at least one rider as boarded before starting.');
      const waiting = await tx
        .select({ id: rideParticipants.id })
        .from(rideParticipants)
        .where(and(eq(rideParticipants.groupId, groupId), inArray(rideParticipants.status, [...ACTIVE_PARTICIPANT]), isNull(rideParticipants.boardedAt)));
      if (waiting.length) throw conflict('riders_pending', 'Mark every rider as boarded or no-show before starting.');
    }
    const stamp = to === 'en_route' ? { enRouteAt: now } : to === 'arrived' ? { arrivedAt: now } : { startedAt: now };
    await tx.update(rideTrips).set(stamp).where(eq(rideTrips.groupId, groupId));
    await tx.update(rideGroups).set({ status: to }).where(eq(rideGroups.id, groupId));
    await recordAudit(tx, { actorUserId: actorId, actorRole: 'operator', action: `trip.${to}`, entityType: 'ride_group', entityId: groupId });
    const riders = await tx.select({ userId: rideParticipants.userId }).from(rideParticipants).where(and(eq(rideParticipants.groupId, groupId), inArray(rideParticipants.status, [...ACTIVE_PARTICIPANT])));
    events.push({ type: 'ride.status_changed', userIds: riders.map((r) => r.userId), groupId, status: to });
  });
  await emit(ctx, events);
}

/** Per-rider actions: boarded and no_show at pickup, dropped_off during the trip. */
export async function riderAction(ctx: AppContext, m: Membership, actorId: string, groupId: string, participantId: string, action: 'boarded' | 'no_show' | 'dropped_off', now = new Date()) {
  const s = await getRideSettings(ctx.db);
  const events: DomainEvent[] = [];
  await ctx.db.transaction(async (tx) => {
    const { t, g } = await loadTripFor(tx, m, groupId);
    const [p] = await tx.select().from(rideParticipants).where(and(eq(rideParticipants.id, participantId), eq(rideParticipants.groupId, groupId)));
    if (!p || !(ACTIVE_PARTICIPANT as readonly string[]).includes(p.status)) throw notFound('Rider');

    if (action === 'boarded') {
      if (g.status !== 'arrived') throw conflict('invalid_transition', 'Riders board once the driver is at the pickup point.');
      await tx.update(rideParticipants).set({ boardedAt: now }).where(eq(rideParticipants.id, p.id));
    } else if (action === 'no_show') {
      if (g.status !== 'arrived') throw conflict('invalid_transition', 'No-shows can only be recorded at the pickup point.');
      const graceEnds = Math.max(g.plannedPickupAt.getTime(), t.arrivedAt?.getTime() ?? 0) + s.pickupGraceMinutes * 60_000;
      if (now.getTime() < graceEnds) {
        throw new AppError(409, 'grace_period', `Please wait until ${new Date(graceEnds).toISOString()} (the ${s.pickupGraceMinutes}-minute grace period) before marking a no-show.`);
      }
      if (p.boardedAt) throw conflict('already_boarded', 'This rider has boarded.');
      await tx.update(rideParticipants).set({ status: 'no_show', leftAt: now, cancellationFeeMinor: p.finalTotalMinor ?? p.currentTotalMinor }).where(eq(rideParticipants.id, p.id));
      await tx.update(rideRequests).set({ status: 'cancelled', closedReason: 'no_show', cancelledAt: now }).where(eq(rideRequests.id, p.requestId));
      events.push({ type: 'ride.rider_removed', userId: p.userId, requestId: p.requestId, groupId, reason: 'no_show' });
    } else {
      if (g.status !== 'in_progress') throw conflict('invalid_transition', 'Drop-offs happen during the trip.');
      if (!p.boardedAt) throw conflict('not_boarded', 'This rider did not board.');
      await tx.update(rideParticipants).set({ status: 'completed', droppedOffAt: now }).where(eq(rideParticipants.id, p.id));
      await tx.update(rideRequests).set({ status: 'completed' }).where(eq(rideRequests.id, p.requestId));
      const remaining = await tx
        .select({ id: rideParticipants.id })
        .from(rideParticipants)
        .where(and(eq(rideParticipants.groupId, groupId), inArray(rideParticipants.status, [...ACTIVE_PARTICIPANT])));
      if (remaining.length === 0) {
        const [op] = await tx.select().from(operators).where(eq(operators.id, t.operatorId));
        const commission = applyBps(g.vehicleFareMinor, op!.commissionBps);
        await tx.update(rideTrips).set({ completedAt: now, commissionMinor: commission, operatorEarningMinor: g.vehicleFareMinor - commission }).where(eq(rideTrips.groupId, groupId));
        await tx.update(rideGroups).set({ status: 'completed' }).where(eq(rideGroups.id, groupId));
        const all = await tx.select({ userId: rideParticipants.userId }).from(rideParticipants).where(and(eq(rideParticipants.groupId, groupId), eq(rideParticipants.status, 'completed')));
        events.push({ type: 'ride.status_changed', userIds: all.map((r) => r.userId), groupId, status: 'completed' });
      }
    }
    await recordAudit(tx, { actorUserId: actorId, actorRole: 'operator', action: `trip.rider_${action}`, entityType: 'ride_group', entityId: groupId, metadata: { participantId } });
  });
  await emit(ctx, events);
}

/** Driver location update. During the trip, positions far from the planned route are flagged. */
export async function recordLocation(ctx: AppContext, m: Membership, groupId: string, point: { lat: number; lng: number }, now = new Date()) {
  return ctx.db.transaction(async (tx) => {
    const { t, g } = await loadTripFor(tx, m, groupId);
    if (!['en_route', 'arrived', 'in_progress'].includes(g.status)) throw conflict('not_tracking', 'Location is shared only while the trip is active.');
    let offRoute = false;
    if (g.status === 'in_progress') {
      const [zone] = await tx.select().from(pickupZones).where(eq(pickupZones.id, g.pickupZoneId));
      const stops = await tx
        .select({ lat: rideRequests.destinationLat, lng: rideRequests.destinationLng, order: rideParticipants.dropoffOrder })
        .from(rideParticipants)
        .innerJoin(rideRequests, eq(rideRequests.id, rideParticipants.requestId))
        .where(and(eq(rideParticipants.groupId, groupId), inArray(rideParticipants.status, ['confirmed', 'completed', 'joined', 'payment_due'])))
        .orderBy(asc(rideParticipants.dropoffOrder));
      offRoute = distanceToPathMeters(point, [{ lat: zone!.lat, lng: zone!.lng }, ...stops]) > OFF_ROUTE_METERS;
    }
    await tx
      .update(rideTrips)
      .set({ lastLat: point.lat, lastLng: point.lng, lastLocationAt: now, offRoute, offRouteSince: offRoute ? (t.offRouteSince ?? now) : null })
      .where(eq(rideTrips.groupId, groupId));
    return { offRoute };
  });
}

/** Trips for the operator's dashboard (all), or a driver's own trips. */
export async function listTrips(ctx: AppContext, m: Membership, scope: 'active' | 'history') {
  const statuses: GroupRow['status'][] = scope === 'active' ? ['assigned', 'en_route', 'arrived', 'in_progress'] : ['completed', 'cancelled'];
  const rows = await ctx.db
    .select({ t: rideTrips, g: rideGroups, zone: pickupZones, d: drivers, v: vehicles })
    .from(rideTrips)
    .innerJoin(rideGroups, eq(rideGroups.id, rideTrips.groupId))
    .innerJoin(pickupZones, eq(pickupZones.id, rideGroups.pickupZoneId))
    .innerJoin(drivers, eq(drivers.id, rideTrips.driverId))
    .innerJoin(vehicles, eq(vehicles.id, rideTrips.vehicleId))
    .where(and(eq(rideTrips.operatorId, m.operator.id), inArray(rideGroups.status, statuses), m.role === 'driver' ? eq(rideTrips.driverId, m.driverId ?? '00000000-0000-0000-0000-000000000000') : sql`true`))
    .orderBy(scope === 'active' ? asc(rideGroups.plannedPickupAt) : desc(rideGroups.plannedPickupAt))
    .limit(100);
  return Promise.all(rows.map((r) => tripDetail(ctx, r, m.operator.commissionBps)));
}

export async function getTrip(ctx: AppContext, m: Membership, groupId: string) {
  const [r] = await ctx.db
    .select({ t: rideTrips, g: rideGroups, zone: pickupZones, d: drivers, v: vehicles })
    .from(rideTrips)
    .innerJoin(rideGroups, eq(rideGroups.id, rideTrips.groupId))
    .innerJoin(pickupZones, eq(pickupZones.id, rideGroups.pickupZoneId))
    .innerJoin(drivers, eq(drivers.id, rideTrips.driverId))
    .innerJoin(vehicles, eq(vehicles.id, rideTrips.vehicleId))
    .where(eq(rideTrips.groupId, groupId));
  if (!r || r.t.operatorId !== m.operator.id || (m.role === 'driver' && r.t.driverId !== m.driverId)) throw notFound('Trip');
  return tripDetail(ctx, r, m.operator.commissionBps);
}

/** What the driver needs: riders (first name, party size, bags, readiness, drop-off area and point), not contact details. */
async function tripDetail(
  ctx: AppContext,
  r: { t: typeof rideTrips.$inferSelect; g: GroupRow; zone: typeof pickupZones.$inferSelect; d: typeof drivers.$inferSelect; v: typeof vehicles.$inferSelect },
  commissionBps: number,
) {
  const riders = await ctx.db
    .select({ p: rideParticipants, req: rideRequests })
    .from(rideParticipants)
    .innerJoin(rideRequests, eq(rideRequests.id, rideParticipants.requestId))
    .where(and(eq(rideParticipants.groupId, r.g.id), inArray(rideParticipants.status, ['joined', 'payment_due', 'confirmed', 'completed', 'no_show'])))
    .orderBy(asc(rideParticipants.dropoffOrder));
  const people = riders.length
    ? await ctx.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, riders.map((x) => x.p.userId)))
    : [];
  const userNames = new Map(people.map((u) => [u.id, u.fullName.split(' ')[0]!]));
  return {
    ...tripSummary(r.g, r.zone, commissionBps),
    driver: { id: r.d.id, name: r.d.fullName },
    vehicle: { id: r.v.id, makeModel: r.v.makeModel, colour: r.v.colour, registration: r.v.registration, vehicleClass: r.v.vehicleClass },
    timestamps: { assignedAt: r.t.assignedAt.toISOString(), enRouteAt: r.t.enRouteAt?.toISOString() ?? null, arrivedAt: r.t.arrivedAt?.toISOString() ?? null, startedAt: r.t.startedAt?.toISOString() ?? null, completedAt: r.t.completedAt?.toISOString() ?? null },
    location: r.t.lastLat !== null ? { lat: r.t.lastLat, lng: r.t.lastLng!, at: r.t.lastLocationAt!.toISOString(), offRoute: r.t.offRoute } : null,
    earningMinor: r.t.operatorEarningMinor,
    commissionMinor: r.t.commissionMinor,
    riders: riders.map((x) => ({
      participantId: x.p.id,
      firstName: userNames.get(x.p.userId)!,
      status: x.p.status,
      seats: x.p.seats,
      luggage: { cabin: x.req.luggageCabin, medium: x.req.luggageMedium, large: x.req.luggageLarge },
      wheelchair: x.req.wheelchair,
      notes: x.req.notes,
      readiness: x.p.readiness,
      flightNumber: x.req.flightNumber,
      expectedArrivalAt: x.req.expectedArrivalAt.toISOString(),
      dropoffOrder: x.p.dropoffOrder,
      dropoff: { area: x.req.destinationArea, label: x.req.destinationLabel, lat: x.req.destinationLat, lng: x.req.destinationLng },
      boardedAt: x.p.boardedAt?.toISOString() ?? null,
      droppedOffAt: x.p.droppedOffAt?.toISOString() ?? null,
    })),
  };
}

export async function earnings(ctx: AppContext, m: Membership) {
  const rows = await ctx.db
    .select({ groupId: rideTrips.groupId, completedAt: rideTrips.completedAt, earning: rideTrips.operatorEarningMinor, commission: rideTrips.commissionMinor, fare: rideGroups.vehicleFareMinor })
    .from(rideTrips)
    .innerJoin(rideGroups, eq(rideGroups.id, rideTrips.groupId))
    .where(and(eq(rideTrips.operatorId, m.operator.id), eq(rideGroups.status, 'completed')))
    .orderBy(desc(rideTrips.completedAt))
    .limit(200);
  const total = rows.reduce((s, r) => s + (r.earning ?? 0), 0);
  return { totalEarningMinor: total, trips: rows.map((r) => ({ ...r, completedAt: r.completedAt?.toISOString() ?? null })) };
}

/** For riders: who is coming and where they are (driver first name, vehicle, last location while active). */
export async function riderTripView(ctx: AppContext, groupId: string) {
  const [r] = await ctx.db
    .select({ t: rideTrips, d: drivers, v: vehicles })
    .from(rideTrips)
    .innerJoin(drivers, eq(drivers.id, rideTrips.driverId))
    .innerJoin(vehicles, eq(vehicles.id, rideTrips.vehicleId))
    .where(eq(rideTrips.groupId, groupId));
  if (!r) return null;
  const [g] = await ctx.db.select({ status: rideGroups.status }).from(rideGroups).where(eq(rideGroups.id, groupId));
  const live = g && ['en_route', 'arrived', 'in_progress'].includes(g.status);
  return {
    driverFirstName: r.d.fullName.split(' ')[0]!,
    vehicle: { makeModel: r.v.makeModel, colour: r.v.colour, registration: r.v.registration, vehicleClass: r.v.vehicleClass },
    assignedAt: r.t.assignedAt.toISOString(),
    location: live && r.t.lastLat !== null ? { lat: r.t.lastLat, lng: r.t.lastLng!, at: r.t.lastLocationAt!.toISOString() } : null,
  };
}
