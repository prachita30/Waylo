import { planGroup } from '@waylo/shared';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { flights, rideGroups, rideParticipants, rideRequests } from '../../db/schema';
import { recordAudit } from '../../lib/audit';
import { type DomainEvent, emit } from '../../lib/events';
import { getRideSettings } from '../../lib/settings';
import { settleDepartingRider } from '../payments/ridePayments';
import { activeMembers, applyPlan, matchOptions, reschedule, toRider } from './groups';

type FlightRow = typeof flights.$inferSelect;

/**
 * Background job: refresh status for flights that active ride requests depend on, then move
 * those riders' expected arrival and reschedule their groups.
 */
export async function refreshFlightStatuses(ctx: AppContext, now = new Date()) {
  const linked = await ctx.db
    .selectDistinct({ f: flights })
    .from(flights)
    .innerJoin(rideRequests, eq(rideRequests.flightId, flights.id))
    .where(
      and(
        inArray(rideRequests.status, ['open', 'matched']),
        gte(rideRequests.scheduledArrivalAt, new Date(now.getTime() - 6 * 3_600_000)),
        lte(rideRequests.scheduledArrivalAt, new Date(now.getTime() + 72 * 3_600_000)),
      ),
    );
  let changed = 0;
  for (const { f } of linked) {
    try {
      if (await updateFlightStatus(ctx, f, now)) changed++;
    } catch (err) {
      // A provider outage leaves the last known estimate in place; riders keep their schedule.
      ctx.logger.warn({ err, flightId: f.id }, 'flight status refresh failed');
    }
  }
  return changed;
}

/** Fetches one flight's status; returns true when something changed. */
export async function updateFlightStatus(ctx: AppContext, f: FlightRow, now = new Date()) {
  const r = await ctx.adapters.flightStatus.getStatus({ airlineCode: f.airlineCode, flightNumber: f.flightNumber, scheduledDepartAt: f.departAt, scheduledArriveAt: f.arriveAt });
  const est = r.estimatedArriveAt;
  const same = f.status === r.status && (f.estimatedArriveAt?.getTime() ?? null) === (est?.getTime() ?? null);
  if (same) return false;
  await ctx.db.update(flights).set({ status: r.status, estimatedArriveAt: est, statusUpdatedAt: now }).where(eq(flights.id, f.id));
  await emit(ctx, {
    type: 'flight.status_changed',
    flightId: f.id,
    status: r.status,
    estimatedArrivalAt: est?.toISOString() ?? null,
    delayMinutes: est ? Math.round((est.getTime() - f.arriveAt.getTime()) / 60_000) : 0,
  });
  await applyFlightChange(ctx, f.id, now);
  return true;
}

/** Applies a flight's latest status to every active ride request linked to it. */
export async function applyFlightChange(ctx: AppContext, flightId: string, now = new Date()) {
  const [f] = await ctx.db.select().from(flights).where(eq(flights.id, flightId));
  if (!f) return;
  const requests = await ctx.db.select().from(rideRequests).where(and(eq(rideRequests.flightId, flightId), inArray(rideRequests.status, ['open', 'matched'])));
  for (const r of requests) {
    if (f.status === 'cancelled') {
      await releaseRider(ctx, r.id, 'flight_cancelled', now);
      continue;
    }
    const expected = f.estimatedArriveAt ?? f.arriveAt;
    if (Math.abs(expected.getTime() - r.expectedArrivalAt.getTime()) < 60_000) continue;
    await ctx.db.update(rideRequests).set({ expectedArrivalAt: expected }).where(eq(rideRequests.id, r.id));
    await emit(ctx, {
      type: 'ride.arrival_updated',
      userId: r.userId,
      requestId: r.id,
      expectedArrivalAt: expected.toISOString(),
      delayMinutes: Math.round((expected.getTime() - r.scheduledArrivalAt.getTime()) / 60_000),
    });
    if (r.status === 'matched') await rescheduleGroupFor(ctx, r.id, now);
  }
}

/**
 * Re-plans the group of a rider whose arrival moved. If everyone can still wait for them the pickup
 * moves; otherwise the late rider leaves the group at no cost and can be matched again.
 */
export async function rescheduleGroupFor(ctx: AppContext, requestId: string, now = new Date()) {
  const s = await getRideSettings(ctx.db);
  const events: DomainEvent[] = [];
  await ctx.db.transaction(async (tx) => {
    const [part] = await tx
      .select()
      .from(rideParticipants)
      .where(and(eq(rideParticipants.requestId, requestId), inArray(rideParticipants.status, ['joined', 'payment_due', 'confirmed'])));
    if (!part) return;
    const [g] = await tx.select().from(rideGroups).where(eq(rideGroups.id, part.groupId)).for('update');
    if (!g || !['forming', 'locked', 'assigned'].includes(g.status)) return;
    const members = await activeMembers(tx, g.id);
    const o = { ...(await matchOptions(ctx, tx, s, g.pickupZoneId, g.airportCode, g.plannedPickupAt, g.splitMethod)), enforcePricing: false };
    const plan = planGroup(members.map((m) => toRider(m.r, m.p.maxTotalMinor)), o);
    if (plan.ok) {
      if (g.status === 'forming') await applyPlan(tx, g, plan, s, now);
      else await reschedule(tx, g, plan, s, now);
      events.push({ type: 'ride.pickup_rescheduled', userIds: members.map((m) => m.p.userId), groupId: g.id, plannedPickupAt: new Date(plan.pickupAt).toISOString() });
      return;
    }
    const removed = await removeFromGroup(ctx, tx, g, part.id, 'flight_delay', now, s);
    events.push(...removed);
  });
  await emit(ctx, events);
}

type Tx = Parameters<Parameters<AppContext['db']['transaction']>[0]>[0];

/** Removes one participant through no fault of their own: no fee; others keep their agreed prices. */
async function removeFromGroup(ctx: AppContext, tx: Tx, g: typeof rideGroups.$inferSelect, participantId: string, reason: 'flight_delay' | 'flight_cancelled', now: Date, s: Awaited<ReturnType<typeof getRideSettings>>) {
  const events: DomainEvent[] = [];
  const members = await activeMembers(tx, g.id);
  const leaving = members.find((m) => m.p.id === participantId);
  if (!leaving) return events;
  await tx.update(rideParticipants).set({ status: 'removed', removedReason: reason, leftAt: now }).where(eq(rideParticipants.id, participantId));
  await settleDepartingRider(tx, leaving.p, 'ride_removed', 0);
  await tx
    .update(rideRequests)
    .set(reason === 'flight_cancelled' ? { status: 'cancelled', closedReason: 'flight_cancelled', cancelledAt: now } : { status: 'open' })
    .where(eq(rideRequests.id, leaving.r.id));
  events.push({ type: 'ride.rider_removed', userId: leaving.p.userId, requestId: leaving.r.id, groupId: g.id, reason });

  const remaining = members.filter((m) => m.p.id !== participantId);
  if (remaining.length === 0) {
    await tx.update(rideGroups).set({ status: 'cancelled', cancelledAt: now, cancelReason: 'The only rider’s flight changed.', parties: 0, seatsTaken: 0, luggageTaken: 0 }).where(eq(rideGroups.id, g.id));
  } else {
    const o = await matchOptions(ctx, tx, s, g.pickupZoneId, g.airportCode, g.plannedPickupAt, g.splitMethod);
    const plan = planGroup(remaining.map((m) => toRider(m.r, m.p.maxTotalMinor)), { ...o, enforcePricing: false });
    if (plan.ok && g.status === 'forming') await applyPlan(tx, g, plan, s, now);
    else if (plan.ok) {
      await reschedule(tx, g, plan, s, now);
      const vacated = leaving.p.finalTotalMinor ?? leaving.p.currentTotalMinor;
      await tx
        .update(rideGroups)
        .set({ seatsTaken: g.seatsTaken - leaving.p.seats, luggageTaken: g.luggageTaken - leaving.p.luggageUnits, parties: remaining.length, platformSubsidyMinor: g.platformSubsidyMinor + vacated })
        .where(eq(rideGroups.id, g.id));
    } else {
      await tx
        .update(rideGroups)
        .set({ seatsTaken: g.seatsTaken - leaving.p.seats, luggageTaken: g.luggageTaken - leaving.p.luggageUnits, parties: remaining.length })
        .where(eq(rideGroups.id, g.id));
    }
  }
  await recordAudit(tx, { action: 'ride_group.rider_removed', entityType: 'ride_group', entityId: g.id, metadata: { reason } });
  return events;
}

/** A cancelled flight releases the rider from any group and closes their request. */
async function releaseRider(ctx: AppContext, requestId: string, reason: 'flight_cancelled', now: Date) {
  const s = await getRideSettings(ctx.db);
  const events: DomainEvent[] = [];
  await ctx.db.transaction(async (tx) => {
    const [r] = await tx.select().from(rideRequests).where(eq(rideRequests.id, requestId)).for('update');
    if (!r || !['open', 'matched'].includes(r.status)) return;
    const [part] = await tx
      .select()
      .from(rideParticipants)
      .where(and(eq(rideParticipants.requestId, requestId), inArray(rideParticipants.status, ['joined', 'payment_due', 'confirmed'])));
    if (part) {
      const [g] = await tx.select().from(rideGroups).where(eq(rideGroups.id, part.groupId)).for('update');
      if (g) events.push(...(await removeFromGroup(ctx, tx, g, part.id, reason, now, s)));
    } else {
      await tx.update(rideRequests).set({ status: 'cancelled', closedReason: reason, cancelledAt: now }).where(eq(rideRequests.id, requestId));
      events.push({ type: 'ride.rider_removed', userId: r.userId, requestId, groupId: '', reason });
    }
  });
  await emit(ctx, events);
}
