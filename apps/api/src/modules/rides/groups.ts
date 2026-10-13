import {
  DEFAULT_MATCH_OPTIONS,
  type GroupPlan,
  haversineEstimator,
  luggageUnits,
  type MatchOptions,
  type MatchRider,
  planGroup,
  type SplitMethod,
  type VehicleClass,
  type Violation,
} from '@waylo/shared';
import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import type { DbOrTx, Tx } from '../../db/client';
import { pickupZones, rideGroups, rideParticipants, rideRequests, users } from '../../db/schema';
import type { AuthUser } from '../../http/auth';
import { AppError, conflict, notFound } from '../../http/errors';
import { recordAudit } from '../../lib/audit';
import { getRideSettings, type RideSettings } from '../../lib/settings';
import { riderTripView } from '../operator/trips';
import type { RideRequestRow } from './requests';

export type GroupRow = typeof rideGroups.$inferSelect;
export type ParticipantRow = typeof rideParticipants.$inferSelect;
const ACTIVE: ParticipantRow['status'][] = ['joined', 'payment_due', 'confirmed'];

/** Operator supply by vehicle class. Phase 9 replaces this with approved operators' live availability. */
export type SupplyFn = (ctx: AppContext, db: DbOrTx, airport: string, at: Date) => Promise<VehicleClass[]>;
let supply: SupplyFn = async () => ['sedan', 'suv', 'van'];
export function setSupplyProvider(fn: SupplyFn) {
  supply = fn;
}

export function toRider(r: RideRequestRow, maxTotalMinor?: number): MatchRider {
  return {
    id: r.id,
    pickupZoneId: r.pickupZoneId,
    arrivalAt: r.expectedArrivalAt.getTime(),
    maxWaitMinutes: r.maxWaitMinutes,
    maxDetourMinutes: r.maxDetourMinutes,
    passengers: r.passengers,
    luggage: { cabin: r.luggageCabin, medium: r.luggageMedium, large: r.luggageLarge },
    vehiclePreference: r.vehiclePreference,
    wheelchair: r.wheelchair,
    destination: { lat: r.destinationLat, lng: r.destinationLng },
    directDistanceMeters: r.directDistanceMeters,
    directDurationSeconds: r.directDurationSeconds,
    maxTotalMinor,
  };
}

export async function matchOptions(ctx: AppContext, db: DbOrTx, s: RideSettings, zoneId: string, airport: string, at: Date, splitMethod: SplitMethod): Promise<MatchOptions> {
  const [zone] = await db.select().from(pickupZones).where(eq(pickupZones.id, zoneId));
  return {
    ...DEFAULT_MATCH_OPTIONS,
    pickup: { lat: zone!.lat, lng: zone!.lng },
    exitBufferMinutes: s.exitBufferMinutes,
    maxParties: s.maxParties,
    availableClasses: await supply(ctx, db, airport, at),
    splitMethod,
    fare: s.fare,
    weights: s.weights,
    estimate: haversineEstimator(),
  };
}

export async function activeMembers(db: DbOrTx, groupId: string) {
  return db
    .select({ p: rideParticipants, r: rideRequests })
    .from(rideParticipants)
    .innerJoin(rideRequests, eq(rideRequests.id, rideParticipants.requestId))
    .where(and(eq(rideParticipants.groupId, groupId), inArray(rideParticipants.status, ACTIVE)))
    .orderBy(asc(rideParticipants.joinedAt));
}

const lockTime = (plannedPickupAt: number, s: RideSettings, now: Date) =>
  new Date(Math.min(plannedPickupAt, Math.max(now.getTime() + 5 * 60_000, plannedPickupAt - s.lockLeadMinutes * 60_000)));

/** Writes a plan onto the group and its active participants. Prices never exceed what each rider agreed to. */
export async function applyPlan(tx: Tx, group: GroupRow, plan: GroupPlan, s: RideSettings, now: Date) {
  const members = await activeMembers(tx, group.id);
  let plannedSum = 0;
  let cappedSum = 0;
  for (const { p } of members) {
    const m = plan.members[p.requestId]!;
    const current = Math.min(m.price.totalMinor, p.maxTotalMinor);
    plannedSum += m.price.totalMinor;
    cappedSum += current;
    await tx
      .update(rideParticipants)
      .set({
        dropoffOrder: m.dropoffOrder,
        waitMinutes: m.waitMinutes,
        detourMinutes: m.detourMinutes,
        estimatedDropoffAt: new Date(m.dropoffAt),
        fareShareMinor: m.price.fareShareMinor,
        platformFeeMinor: m.price.platformFeeMinor,
        taxMinor: m.price.taxMinor,
        currentTotalMinor: current,
        soloTotalMinor: m.solo.totalMinor,
      })
      .where(eq(rideParticipants.id, p.id));
  }
  await tx
    .update(rideGroups)
    .set({
      vehicleClass: plan.vehicleClass,
      seatCapacity: plan.capacity.seats,
      luggageCapacity: plan.capacity.luggageUnits,
      seatsTaken: plan.seatsUsed,
      luggageTaken: plan.luggageUsed,
      parties: members.length,
      plannedPickupAt: new Date(plan.pickupAt),
      lockAt: lockTime(plan.pickupAt, s, now),
      route: { order: plan.order, legs: plan.route.legs },
      routeDistanceMeters: plan.route.distanceMeters,
      routeDurationSeconds: plan.route.durationSeconds,
      fare: { ...plan.fare },
      vehicleFareMinor: plan.fare.totalMinor,
      platformSubsidyMinor: plannedSum - cappedSum,
      version: sql`${rideGroups.version} + 1`,
    })
    .where(eq(rideGroups.id, group.id));
}

/**
 * Moves pickup and drop-off estimates after an arrival change without touching prices.
 * Used for locked/assigned groups, whose prices are final.
 */
export async function reschedule(tx: Tx, group: GroupRow, plan: GroupPlan, s: RideSettings, now: Date) {
  const members = await activeMembers(tx, group.id);
  for (const { p } of members) {
    const m = plan.members[p.requestId];
    if (!m) continue;
    await tx
      .update(rideParticipants)
      .set({ waitMinutes: m.waitMinutes, detourMinutes: m.detourMinutes, estimatedDropoffAt: new Date(m.dropoffAt), dropoffOrder: m.dropoffOrder })
      .where(eq(rideParticipants.id, p.id));
  }
  await tx
    .update(rideGroups)
    .set({
      plannedPickupAt: new Date(plan.pickupAt),
      lockAt: group.status === 'forming' ? lockTime(plan.pickupAt, s, now) : group.lockAt,
      route: { order: plan.order, legs: plan.route.legs },
      routeDistanceMeters: plan.route.distanceMeters,
      routeDurationSeconds: plan.route.durationSeconds,
      version: sql`${rideGroups.version} + 1`,
    })
    .where(eq(rideGroups.id, group.id));
}

// ------------------------------------------------------------------ matches

const VIOLATION_TEXT: Record<Violation, string> = {
  too_many_parties: 'Group is full',
  different_pickup: 'Different pickup point',
  arrival_window: 'Arrival times too far apart',
  vehicle: 'No vehicle suits everyone',
  seats: 'Not enough seats',
  luggage: 'Not enough luggage space',
  operator_unavailable: 'No vehicle available',
  detour: 'Route detour too long',
  no_saving: 'Sharing would not save money',
  price_cap: 'Would raise another rider’s agreed price',
};
export const violationText = (v: Violation) => VIOLATION_TEXT[v];

function optionDto(plan: GroupPlan, me: string, members: { requestId: string; firstName: string; area: string; seats: number; avatarUrl: string | null }[]) {
  const m = plan.members[me]!;
  return {
    vehicleClass: plan.vehicleClass,
    capacity: plan.capacity,
    seatsUsed: plan.seatsUsed,
    luggageUsed: plan.luggageUsed,
    plannedPickupAt: new Date(plan.pickupAt).toISOString(),
    route: plan.order.map((id, i) => ({ order: i + 1, area: id === me ? 'You' : (members.find((x) => x.requestId === id)?.area ?? ''), isMe: id === me })),
    routeDistanceMeters: plan.route.distanceMeters,
    routeDurationSeconds: plan.route.durationSeconds,
    members: members.map((x) => ({ firstName: x.firstName, area: x.area, seats: x.seats, avatarUrl: x.avatarUrl })),
    you: {
      waitMinutes: m.waitMinutes,
      detourMinutes: m.detourMinutes,
      rideMinutes: m.rideMinutes,
      dropoffAt: new Date(m.dropoffAt).toISOString(),
      dropoffOrder: m.dropoffOrder,
      price: m.price,
      solo: m.solo,
      savingsPercent: m.savingsPercent,
    },
    vehicleFare: plan.fare,
    score: plan.score,
  };
}

const firstName = (full: string) => full.split(/\s+/)[0] ?? full;

export async function findMatches(ctx: AppContext, user: AuthUser, requestId: string, now = new Date()) {
  const [req] = await ctx.db.select().from(rideRequests).where(eq(rideRequests.id, requestId));
  if (!req || req.userId !== user.id) throw notFound('Ride request');
  if (req.status !== 'open') throw conflict('request_not_open', 'This request is not looking for a group.');
  const s = await getRideSettings(ctx.db);
  const me = toRider(req);
  const arrival = req.expectedArrivalAt.getTime();

  const groups = await ctx.db
    .select()
    .from(rideGroups)
    .where(
      and(
        eq(rideGroups.pickupZoneId, req.pickupZoneId),
        eq(rideGroups.status, 'forming'),
        gte(rideGroups.plannedPickupAt, new Date(arrival - 90 * 60_000)),
        lte(rideGroups.plannedPickupAt, new Date(arrival + (req.maxWaitMinutes + s.exitBufferMinutes + 90) * 60_000)),
        sql`${rideGroups.lockAt} > ${now}`,
      ),
    );

  const options = [];
  const rejected: { groupId: string; reasons: string[] }[] = [];
  for (const g of groups) {
    const members = await activeMembers(ctx.db, g.id);
    if (members.some((m) => m.r.userId === user.id)) continue;
    const o = await matchOptions(ctx, ctx.db, s, g.pickupZoneId, g.airportCode, g.plannedPickupAt, g.splitMethod);
    const plan = planGroup([...members.map((m) => toRider(m.r, m.p.maxTotalMinor)), me], o);
    if (!plan.ok) {
      rejected.push({ groupId: g.id, reasons: plan.violations.map(violationText) });
      continue;
    }
    const people = await Promise.all(
      members.map(async (m) => {
        const [u] = await ctx.db.select({ fullName: users.fullName, avatarFile: users.avatarFile }).from(users).where(eq(users.id, m.p.userId));
        return { requestId: m.r.id, firstName: firstName(u?.fullName ?? 'Rider'), area: m.r.destinationArea, seats: m.p.seats, avatarUrl: u?.avatarFile ? `/api/v1/avatars/${u.avatarFile}` : null };
      }),
    );
    options.push({ groupId: g.id, splitMethod: g.splitMethod, lockAt: g.lockAt.toISOString(), ...optionDto(plan, me.id, people) });
  }
  options.sort((a, b) => b.score - a.score || a.you.price.totalMinor - b.you.price.totalMinor || a.groupId.localeCompare(b.groupId));

  // Starting a new group: the first rider's price is the solo price; it only drops as others join.
  const newOpts = await matchOptions(ctx, ctx.db, s, req.pickupZoneId, req.airportCode, req.expectedArrivalAt, s.defaultSplitMethod);
  const solo = planGroup([me], newOpts);

  // How many other open requests could share with this rider (demand signal, no personal data).
  const others = await ctx.db
    .select()
    .from(rideRequests)
    .where(
      and(
        eq(rideRequests.pickupZoneId, req.pickupZoneId),
        eq(rideRequests.status, 'open'),
        ne(rideRequests.userId, user.id),
        gte(rideRequests.expectedArrivalAt, new Date(arrival - 60 * 60_000)),
        lte(rideRequests.expectedArrivalAt, new Date(arrival + 60 * 60_000)),
      ),
    );
  const compatibleOpenRequests = others.filter((o) => planGroup([me, toRider(o)], newOpts).ok).length;

  return {
    requestId,
    groups: options.slice(0, 5),
    newGroup: solo.ok ? { splitMethod: s.defaultSplitMethod, ...optionDto(solo, me.id, []) } : null,
    newGroupBlockedBy: solo.ok ? null : solo.violations.map(violationText),
    compatibleOpenRequests,
    unmatchedGroups: rejected.length,
    policy: policyText(s),
  };
}

export function policyText(s: RideSettings) {
  return {
    beforeLock: 'Free to leave until the group locks.',
    afterLock: `After the group locks, leaving costs ${s.lateCancelPercent}% of your price, or 100% within ${s.fullChargeWithinMinutes} minutes of pickup.`,
    waiting: `The driver waits ${s.pickupGraceMinutes} minutes after the planned pickup. After that, waiting is charged to the late rider at ₹${s.fare.waitingPerMinuteMinor / 100}/min, or the group may leave.`,
    priceGuarantee: 'You never pay more than the price you agree to. It can only go down as others join.',
  };
}

// ------------------------------------------------------------------ start / join

async function lockOpenRequest(tx: Tx, userId: string, requestId: string) {
  const [r] = await tx.select().from(rideRequests).where(eq(rideRequests.id, requestId)).for('update');
  if (!r || r.userId !== userId) throw notFound('Ride request');
  if (r.status !== 'open') throw conflict('request_not_open', 'This request already has a group or is closed.');
  return r;
}

function priceGuard(plan: GroupPlan, requestId: string, acceptedMaxTotalMinor: number) {
  const price = plan.members[requestId]!.price.totalMinor;
  if (price > acceptedMaxTotalMinor) {
    throw new AppError(409, 'price_changed', 'The price for this group changed. Please review the new price.', { currentTotalMinor: price });
  }
  return price;
}

function planFailure(violations: Violation[]): never {
  const full = violations.some((v) => v === 'seats' || v === 'luggage' || v === 'too_many_parties');
  throw new AppError(409, full ? 'group_full' : 'group_incompatible', full ? 'This group just filled up.' : 'This group is no longer a match for your trip.', violations.map(violationText));
}

export async function startGroup(ctx: AppContext, user: AuthUser, input: { requestId: string; soloOk: boolean; splitMethod?: SplitMethod; acceptedMaxTotalMinor: number }, now = new Date()) {
  const s = await getRideSettings(ctx.db);
  return ctx.db.transaction(async (tx) => {
    const req = await lockOpenRequest(tx, user.id, input.requestId);
    const split = input.splitMethod ?? s.defaultSplitMethod;
    const o = await matchOptions(ctx, tx, s, req.pickupZoneId, req.airportCode, req.expectedArrivalAt, split);
    const plan = planGroup([toRider(req)], o);
    if (!plan.ok) planFailure(plan.violations);
    const price = priceGuard(plan, req.id, input.acceptedMaxTotalMinor);
    const m = plan.members[req.id]!;
    const [g] = await tx
      .insert(rideGroups)
      .values({
        airportCode: req.airportCode,
        pickupZoneId: req.pickupZoneId,
        vehicleClass: plan.vehicleClass,
        seatCapacity: plan.capacity.seats,
        luggageCapacity: plan.capacity.luggageUnits,
        seatsTaken: plan.seatsUsed,
        luggageTaken: plan.luggageUsed,
        parties: 1,
        splitMethod: split,
        plannedPickupAt: new Date(plan.pickupAt),
        lockAt: lockTime(plan.pickupAt, s, now),
        route: { order: plan.order, legs: plan.route.legs },
        routeDistanceMeters: plan.route.distanceMeters,
        routeDurationSeconds: plan.route.durationSeconds,
        fare: { ...plan.fare },
        vehicleFareMinor: plan.fare.totalMinor,
        createdBy: user.id,
      })
      .returning();
    await tx.insert(rideParticipants).values({
      groupId: g!.id,
      requestId: req.id,
      userId: user.id,
      seats: req.passengers,
      luggageUnits: luggageUnits({ cabin: req.luggageCabin, medium: req.luggageMedium, large: req.luggageLarge }),
      soloOk: input.soloOk,
      dropoffOrder: 1,
      estimatedDropoffAt: new Date(m.dropoffAt),
      maxTotalMinor: price,
      fareShareMinor: m.price.fareShareMinor,
      platformFeeMinor: m.price.platformFeeMinor,
      taxMinor: m.price.taxMinor,
      currentTotalMinor: price,
      soloTotalMinor: m.solo.totalMinor,
    });
    await tx.update(rideRequests).set({ status: 'matched' }).where(eq(rideRequests.id, req.id));
    await recordAudit(tx, { actorUserId: user.id, actorRole: user.role, action: 'ride_group.created', entityType: 'ride_group', entityId: g!.id });
    return g!;
  });
}

/**
 * Adds a rider to a forming group. The group row is locked for the whole check-and-write, so two
 * riders racing for the last seat cannot both succeed. Existing members' agreed prices are passed
 * to the planner as caps, so a join can never make anyone pay more.
 */
export async function joinGroup(ctx: AppContext, user: AuthUser, groupId: string, input: { requestId: string; acceptedMaxTotalMinor: number }, now = new Date()) {
  const s = await getRideSettings(ctx.db);
  const group = await ctx.db.transaction(async (tx) => {
    const [g] = await tx.select().from(rideGroups).where(eq(rideGroups.id, groupId)).for('update');
    if (!g) throw notFound('Ride group');
    if (g.status !== 'forming' || g.lockAt <= now) throw conflict('group_closed', 'This group is no longer accepting riders.');
    const req = await lockOpenRequest(tx, user.id, input.requestId);
    if (req.pickupZoneId !== g.pickupZoneId) throw conflict('group_incompatible', 'This group picks up at a different point.');
    const members = await activeMembers(tx, g.id);
    if (members.some((m) => m.p.userId === user.id)) throw conflict('already_member', 'You are already in this group.');

    const o = await matchOptions(ctx, tx, s, g.pickupZoneId, g.airportCode, g.plannedPickupAt, g.splitMethod);
    const plan = planGroup([...members.map((m) => toRider(m.r, m.p.maxTotalMinor)), toRider(req)], o);
    if (!plan.ok) planFailure(plan.violations);
    const price = priceGuard(plan, req.id, input.acceptedMaxTotalMinor);
    const mine = plan.members[req.id]!;

    await tx.insert(rideParticipants).values({
      groupId: g.id,
      requestId: req.id,
      userId: user.id,
      seats: req.passengers,
      luggageUnits: luggageUnits({ cabin: req.luggageCabin, medium: req.luggageMedium, large: req.luggageLarge }),
      dropoffOrder: mine.dropoffOrder,
      estimatedDropoffAt: new Date(mine.dropoffAt),
      maxTotalMinor: price,
      fareShareMinor: mine.price.fareShareMinor,
      platformFeeMinor: mine.price.platformFeeMinor,
      taxMinor: mine.price.taxMinor,
      currentTotalMinor: price,
      soloTotalMinor: mine.solo.totalMinor,
    });
    await applyPlan(tx, g, plan, s, now);
    await tx.update(rideRequests).set({ status: 'matched' }).where(eq(rideRequests.id, req.id));
    await recordAudit(tx, { actorUserId: user.id, actorRole: user.role, action: 'ride_group.joined', entityType: 'ride_group', entityId: g.id });
    const [updated] = await tx.select().from(rideGroups).where(eq(rideGroups.id, g.id));
    return updated!;
  });
  // A full vehicle locks straight away.
  if (group.seatsTaken >= group.seatCapacity || group.parties >= s.maxParties) await lockGroup(ctx, group.id, now);
  return group;
}

// ------------------------------------------------------------------ leave / lock

export function cancellationFee(p: Pick<ParticipantRow, 'currentTotalMinor' | 'finalTotalMinor'>, g: Pick<GroupRow, 'status' | 'plannedPickupAt'>, s: RideSettings, now: Date) {
  if (g.status === 'forming') return 0;
  const total = p.finalTotalMinor ?? p.currentTotalMinor;
  const minsToPickup = (g.plannedPickupAt.getTime() - now.getTime()) / 60_000;
  return minsToPickup <= s.fullChargeWithinMinutes ? total : Math.round((total * s.lateCancelPercent) / 100);
}

export async function leaveGroup(ctx: AppContext, user: AuthUser, groupId: string, opts: { cancelRequest: boolean }, now = new Date()) {
  const s = await getRideSettings(ctx.db);
  return ctx.db.transaction(async (tx) => {
    const [g] = await tx.select().from(rideGroups).where(eq(rideGroups.id, groupId)).for('update');
    if (!g) throw notFound('Ride group');
    const members = await activeMembers(tx, g.id);
    const mine = members.find((m) => m.p.userId === user.id);
    if (!mine) throw notFound('Ride group');
    if (!['forming', 'locked', 'assigned'].includes(g.status)) throw conflict('not_cancellable', 'The ride has already started.');

    const fee = cancellationFee(mine.p, g, s, now);
    await tx.update(rideParticipants).set({ status: 'left', leftAt: now, cancellationFeeMinor: fee || null }).where(eq(rideParticipants.id, mine.p.id));
    // Before lock a rider may look for another group; after lock (or if asked) the request is closed.
    const reopen = g.status === 'forming' && !opts.cancelRequest && mine.r.expectedArrivalAt.getTime() + mine.r.maxWaitMinutes * 60_000 > now.getTime();
    await tx
      .update(rideRequests)
      .set(reopen ? { status: 'open' } : { status: 'cancelled', cancelledAt: now })
      .where(eq(rideRequests.id, mine.r.id));

    const remaining = members.filter((m) => m.p.id !== mine.p.id);
    if (remaining.length === 0) {
      await tx.update(rideGroups).set({ status: 'cancelled', cancelledAt: now, cancelReason: 'All riders left.', parties: 0, seatsTaken: 0, luggageTaken: 0 }).where(eq(rideGroups.id, g.id));
    } else if (g.status === 'forming') {
      const o = await matchOptions(ctx, tx, s, g.pickupZoneId, g.airportCode, g.plannedPickupAt, g.splitMethod);
      const plan = planGroup(
        remaining.map((m) => toRider(m.r, m.p.maxTotalMinor)),
        { ...o, enforcePricing: false },
      );
      if (plan.ok) await applyPlan(tx, g, plan, s, now);
      else {
        await tx
          .update(rideGroups)
          .set({ seatsTaken: g.seatsTaken - mine.p.seats, luggageTaken: g.luggageTaken - mine.p.luggageUnits, parties: remaining.length })
          .where(eq(rideGroups.id, g.id));
      }
    } else {
      // Locked: the vehicle and route are committed; free the seat, keep everyone else's price.
      const vacated = mine.p.finalTotalMinor ?? mine.p.currentTotalMinor;
      await tx
        .update(rideGroups)
        .set({
          seatsTaken: g.seatsTaken - mine.p.seats,
          luggageTaken: g.luggageTaken - mine.p.luggageUnits,
          parties: remaining.length,
          platformSubsidyMinor: g.platformSubsidyMinor + Math.max(0, vacated - fee),
        })
        .where(eq(rideGroups.id, g.id));
    }
    await recordAudit(tx, { actorUserId: user.id, actorRole: user.role, action: 'ride_group.left', entityType: 'ride_group', entityId: g.id, metadata: { feeMinor: fee } });
    return { feeMinor: fee, requestStatus: reopen ? 'open' : 'cancelled' };
  });
}

/** Hook so later modules (payments) can run when a group locks. */
type LockHook = (ctx: AppContext, tx: Tx, group: GroupRow, members: ParticipantRow[]) => Promise<void>;
const lockHooks: LockHook[] = [];
export function onGroupLocked(hook: LockHook) {
  lockHooks.push(hook);
}

/**
 * Closes a group to new riders and fixes final prices (never above what each rider agreed).
 * A lone rider who did not accept riding solo is released instead.
 */
export async function lockGroup(ctx: AppContext, groupId: string, now = new Date()) {
  return ctx.db.transaction(async (tx) => {
    const [g] = await tx.select().from(rideGroups).where(eq(rideGroups.id, groupId)).for('update');
    if (!g || g.status !== 'forming') return null;
    const members = await activeMembers(tx, g.id);
    if (members.length === 0) {
      await tx.update(rideGroups).set({ status: 'cancelled', cancelledAt: now, cancelReason: 'No riders.' }).where(eq(rideGroups.id, g.id));
      return null;
    }
    if (members.length === 1 && !members[0]!.p.soloOk) {
      const only = members[0]!;
      await tx.update(rideParticipants).set({ status: 'removed', leftAt: now }).where(eq(rideParticipants.id, only.p.id));
      await tx.update(rideRequests).set({ status: 'no_match' }).where(eq(rideRequests.id, only.r.id));
      await tx.update(rideGroups).set({ status: 'cancelled', cancelledAt: now, cancelReason: 'No other riders joined.' }).where(eq(rideGroups.id, g.id));
      await recordAudit(tx, { action: 'ride_group.dissolved', entityType: 'ride_group', entityId: g.id });
      return null;
    }
    for (const { p } of members) {
      await tx.update(rideParticipants).set({ status: 'confirmed', finalTotalMinor: p.currentTotalMinor }).where(eq(rideParticipants.id, p.id));
    }
    const [locked] = await tx.update(rideGroups).set({ status: 'locked', lockedAt: now }).where(eq(rideGroups.id, g.id)).returning();
    const fresh = await tx.select().from(rideParticipants).where(and(eq(rideParticipants.groupId, g.id), inArray(rideParticipants.status, ACTIVE)));
    for (const hook of lockHooks) await hook(ctx, tx, locked!, fresh);
    await recordAudit(tx, { action: 'ride_group.locked', entityType: 'ride_group', entityId: g.id, metadata: { parties: members.length } });
    return locked!;
  });
}

/** Background job: lock groups whose lock time has come. */
export async function lockDueGroups(ctx: AppContext, now = new Date()) {
  const due = await ctx.db
    .select({ id: rideGroups.id })
    .from(rideGroups)
    .where(and(eq(rideGroups.status, 'forming'), lte(rideGroups.lockAt, now)))
    .limit(100);
  for (const { id } of due) await lockGroup(ctx, id, now);
  return due.length;
}

// ------------------------------------------------------------------ read

export async function loadGroupForUser(db: DbOrTx, user: AuthUser, groupId: string) {
  const [g] = await db.select().from(rideGroups).where(eq(rideGroups.id, groupId));
  if (!g) throw notFound('Ride group');
  if (user.role === 'admin') return g;
  const [membership] = await db
    .select({ id: rideParticipants.id })
    .from(rideParticipants)
    .where(and(eq(rideParticipants.groupId, groupId), eq(rideParticipants.userId, user.id)));
  if (!membership) throw notFound('Ride group');
  return g;
}

/** Group as seen by one of its riders: co-riders appear by first name and area only. */
export async function toGroupDto(ctx: AppContext, g: GroupRow, viewerId: string) {
  const s = await getRideSettings(ctx.db);
  const rows = await ctx.db
    .select({ p: rideParticipants, r: rideRequests, fullName: users.fullName, avatarFile: users.avatarFile })
    .from(rideParticipants)
    .innerJoin(rideRequests, eq(rideRequests.id, rideParticipants.requestId))
    .innerJoin(users, eq(users.id, rideParticipants.userId))
    .where(eq(rideParticipants.groupId, g.id))
    .orderBy(asc(rideParticipants.dropoffOrder));
  const [zone] = await ctx.db.select().from(pickupZones).where(eq(pickupZones.id, g.pickupZoneId));
  const me = rows.find((x) => x.p.userId === viewerId && ACTIVE.includes(x.p.status)) ?? rows.find((x) => x.p.userId === viewerId);
  const active = rows.filter((x) => ACTIVE.includes(x.p.status));
  return {
    id: g.id,
    status: g.status,
    airport: g.airportCode,
    pickupZone: zone ? { id: zone.id, terminal: zone.terminal, name: zone.name, instructions: zone.instructions } : null,
    vehicleClass: g.vehicleClass,
    capacity: { seats: g.seatCapacity, luggageUnits: g.luggageCapacity },
    seatsTaken: g.seatsTaken,
    luggageTaken: g.luggageTaken,
    splitMethod: g.splitMethod,
    plannedPickupAt: g.plannedPickupAt.toISOString(),
    lockAt: g.lockAt.toISOString(),
    lockedAt: g.lockedAt?.toISOString() ?? null,
    route: { distanceMeters: g.routeDistanceMeters, durationSeconds: g.routeDurationSeconds },
    vehicleFare: g.fare,
    members: active.map((x) => ({
      isMe: x.p.userId === viewerId,
      firstName: firstName(x.fullName),
      avatarUrl: x.avatarFile ? `/api/v1/avatars/${x.avatarFile}` : null,
      area: x.r.destinationArea,
      seats: x.p.seats,
      dropoffOrder: x.p.dropoffOrder,
      estimatedDropoffAt: x.p.estimatedDropoffAt.toISOString(),
      readiness: x.p.readiness,
    })),
    // Map points: pickup exactly; drop-offs at area level (≈1 km) so co-riders never see addresses.
    map: {
      pickup: zone ? { lat: zone.lat, lng: zone.lng } : null,
      stops: active.map((x) => ({
        order: x.p.dropoffOrder,
        area: x.r.destinationArea,
        isMe: x.p.userId === viewerId,
        lat: Math.round(x.r.destinationLat * 100) / 100,
        lng: Math.round(x.r.destinationLng * 100) / 100,
      })),
    },
    me: me
      ? {
          participantId: me.p.id,
          requestId: me.r.id,
          status: me.p.status,
          seats: me.p.seats,
          waitMinutes: me.p.waitMinutes,
          detourMinutes: me.p.detourMinutes,
          estimatedDropoffAt: me.p.estimatedDropoffAt.toISOString(),
          price: { fareShareMinor: me.p.fareShareMinor, platformFeeMinor: me.p.platformFeeMinor, taxMinor: me.p.taxMinor, totalMinor: me.p.currentTotalMinor },
          maxTotalMinor: me.p.maxTotalMinor,
          finalTotalMinor: me.p.finalTotalMinor,
          soloTotalMinor: me.p.soloTotalMinor,
          soloOk: me.p.soloOk,
          readiness: me.p.readiness,
          removedReason: me.p.removedReason,
          cancellationFeeMinor: me.p.cancellationFeeMinor,
          leaveFeeNowMinor: ACTIVE.includes(me.p.status) ? cancellationFee(me.p, g, s, new Date()) : null,
        }
      : null,
    trip: await riderTripView(ctx, g.id),
    policy: policyText(s),
    cancelReason: g.cancelReason,
  };
}

/** Active group for a request, if any. */
export async function groupIdForRequest(db: DbOrTx, requestId: string) {
  const [p] = await db
    .select({ groupId: rideParticipants.groupId })
    .from(rideParticipants)
    .where(eq(rideParticipants.requestId, requestId))
    .orderBy(sql`${rideParticipants.joinedAt} desc`)
    .limit(1);
  return p?.groupId ?? null;
}

export const READINESS = ['not_landed', 'landed', 'at_baggage', 'ready', 'at_pickup'] as const;

/** Rider-reported progress after landing, shown to co-riders and the driver. */
export async function setReadiness(ctx: AppContext, user: AuthUser, groupId: string, readiness: (typeof READINESS)[number], now = new Date()) {
  const [p] = await ctx.db
    .select()
    .from(rideParticipants)
    .where(and(eq(rideParticipants.groupId, groupId), eq(rideParticipants.userId, user.id), inArray(rideParticipants.status, ACTIVE)));
  if (!p) throw notFound('Ride group');
  await ctx.db.update(rideParticipants).set({ readiness, readinessUpdatedAt: now }).where(eq(rideParticipants.id, p.id));
}
