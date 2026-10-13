import { DEFAULT_FARE_CONFIG, type FareConfig, type PassengerPrice, passengerPrice, soloPrice, type SplitMethod, splitFare, type VehicleFare, vehicleFare } from './fares';
import { acceptableVehicles, type Luggage, luggageUnits, VEHICLE_CLASSES, type VehicleClass, type VehiclePreference } from './rides';
import { haversineKm, localHour } from './time';

export interface LatLng {
  lat: number;
  lng: number;
}

/** One ride request (a party travelling together) as seen by the matching engine. */
export interface MatchRider {
  id: string;
  pickupZoneId: string;
  /** Expected arrival, epoch milliseconds. */
  arrivalAt: number;
  maxWaitMinutes: number;
  maxDetourMinutes: number;
  passengers: number;
  luggage: Luggage;
  vehiclePreference: VehiclePreference;
  wheelchair: boolean;
  destination: LatLng;
  directDistanceMeters: number;
  directDurationSeconds: number;
  /** Most this party has agreed to pay (existing group members). Prices may only go down. */
  maxTotalMinor?: number;
}

export type TravelEstimator = (from: LatLng, to: LatLng, departAtMs: number) => { distanceMeters: number; durationSeconds: number };

export interface MatchWeights {
  savings: number;
  detour: number;
  wait: number;
  occupancy: number;
}
export const DEFAULT_MATCH_WEIGHTS: MatchWeights = { savings: 0.4, detour: 0.25, wait: 0.2, occupancy: 0.15 };

export interface MatchOptions {
  pickup: LatLng;
  /** Planning allowance from landing to being ready at the pickup point. An estimate, not a promise. */
  exitBufferMinutes: number;
  maxParties: number;
  /** Vehicle classes operators can currently supply (operator availability). */
  availableClasses: VehicleClass[];
  splitMethod: SplitMethod;
  fare: FareConfig;
  weights: MatchWeights;
  estimate: TravelEstimator;
  /**
   * When false, saving and price-cap checks are skipped. Used only to re-plan an existing group
   * after someone leaves; remaining members are then protected by their agreed maximum price.
   */
  enforcePricing?: boolean;
}

export const DEFAULT_MATCH_OPTIONS: Omit<MatchOptions, 'pickup' | 'estimate'> = {
  exitBufferMinutes: 30,
  maxParties: 4,
  availableClasses: ['sedan', 'suv', 'van'],
  splitMethod: 'equal_per_seat',
  fare: DEFAULT_FARE_CONFIG,
  weights: DEFAULT_MATCH_WEIGHTS,
};

export type Violation =
  | 'too_many_parties'
  | 'different_pickup'
  | 'arrival_window'
  | 'vehicle'
  | 'seats'
  | 'luggage'
  | 'operator_unavailable'
  | 'detour'
  | 'no_saving'
  | 'price_cap';

export interface MemberPlan {
  seats: number;
  waitMinutes: number;
  rideMinutes: number;
  detourMinutes: number;
  dropoffAt: number;
  dropoffOrder: number;
  price: PassengerPrice;
  solo: PassengerPrice;
  savingsPercent: number;
}

export interface GroupPlan {
  ok: true;
  vehicleClass: VehicleClass;
  capacity: { seats: number; luggageUnits: number };
  seatsUsed: number;
  luggageUsed: number;
  pickupAt: number;
  order: string[];
  route: { distanceMeters: number; durationSeconds: number; legs: { to: string; distanceMeters: number; durationSeconds: number }[] };
  fare: VehicleFare;
  members: Record<string, MemberPlan>;
  score: number;
}
export type PlanResult = GroupPlan | { ok: false; violations: Violation[] };

/** Same assumptions as the sandbox maps provider: road factor and time-of-day city speeds. */
export const ROAD_FACTOR = 1.4;
export function citySpeedKmh(hour: number): number {
  if ((hour >= 8 && hour < 11) || (hour >= 17 && hour < 21)) return 17;
  if (hour >= 23 || hour < 6) return 34;
  return 24;
}
export function haversineEstimator(timeZone = 'Asia/Kolkata'): TravelEstimator {
  return (from, to, at) => {
    const km = haversineKm(from, to) * ROAD_FACTOR;
    const speed = citySpeedKmh(localHour(new Date(at), timeZone));
    return { distanceMeters: Math.round(km * 1000), durationSeconds: Math.round((km / speed) * 3600) };
  };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) out.push([item, ...rest]);
  });
  return out;
}

/** Smallest vehicle (by seats, then luggage) in `classes` that fits the load. */
function smallestFitting(classes: VehicleClass[], seats: number, units: number): VehicleClass | undefined {
  return [...classes]
    .sort((a, b) => VEHICLE_CLASSES[a].seats - VEHICLE_CLASSES[b].seats || VEHICLE_CLASSES[a].luggageUnits - VEHICLE_CLASSES[b].luggageUnits)
    .find((c) => seats <= VEHICLE_CLASSES[c].seats && units <= VEHICLE_CLASSES[c].luggageUnits);
}

/**
 * Plans a shared ride for `riders` (all of them, or nothing). Hard constraints are checked first and
 * reported as violations; the score only ranks plans that already satisfy every constraint.
 * Deterministic: the same input always yields the same plan.
 */
export function planGroup(riders: MatchRider[], o: MatchOptions): PlanResult {
  const violations = new Set<Violation>();
  if (riders.length === 0) return { ok: false, violations: ['seats'] };
  if (riders.length > o.maxParties) violations.add('too_many_parties');
  if (new Set(riders.map((r) => r.pickupZoneId)).size > 1) violations.add('different_pickup');

  // Everyone must be willing to wait for the last arrival.
  const lastArrival = Math.max(...riders.map((r) => r.arrivalAt));
  for (const r of riders) if ((lastArrival - r.arrivalAt) / 60_000 > r.maxWaitMinutes) violations.add('arrival_window');

  const seats = riders.reduce((s, r) => s + r.passengers, 0);
  const units = riders.reduce((s, r) => s + luggageUnits(r.luggage), 0);
  const acceptable = riders.map((r) => acceptableVehicles(r.vehiclePreference, r.wheelchair)).reduce((a, b) => a.filter((c) => b.includes(c)));
  let vehicleClass: VehicleClass | undefined;
  if (acceptable.length === 0) violations.add('vehicle');
  else {
    const anyFit = smallestFitting(acceptable, seats, units);
    if (!anyFit) {
      const maxSeats = Math.max(...acceptable.map((c) => VEHICLE_CLASSES[c].seats));
      violations.add(seats > maxSeats ? 'seats' : 'luggage');
    } else {
      vehicleClass = smallestFitting(acceptable.filter((c) => o.availableClasses.includes(c)), seats, units);
      if (!vehicleClass) violations.add('operator_unavailable');
    }
  }
  if (violations.size || !vehicleClass) return { ok: false, violations: [...violations] };

  const pickupAt = lastArrival + o.exitBufferMinutes * 60_000;
  // Direct baselines are re-estimated at the same pickup time so detours compare like with like.
  const direct = new Map(riders.map((r) => [r.id, o.estimate(o.pickup, r.destination, pickupAt)]));

  // Best drop-off order: every rider within their detour limit, then shortest total time.
  const ids = [...riders].sort((a, b) => a.id.localeCompare(b.id));
  let best: { order: MatchRider[]; legs: { to: string; distanceMeters: number; durationSeconds: number }[]; total: number } | undefined;
  for (const order of permutations(ids)) {
    let at = pickupAt;
    let from: LatLng = o.pickup;
    let elapsed = 0;
    const legs: { to: string; distanceMeters: number; durationSeconds: number }[] = [];
    let valid = true;
    for (const r of order) {
      const leg = o.estimate(from, r.destination, at);
      elapsed += leg.durationSeconds;
      at += leg.durationSeconds * 1000;
      from = r.destination;
      legs.push({ to: r.id, ...leg });
      if ((elapsed - direct.get(r.id)!.durationSeconds) / 60 > r.maxDetourMinutes) {
        valid = false;
        break;
      }
    }
    if (valid && (!best || elapsed < best.total)) best = { order, legs, total: elapsed };
  }
  if (!best) return { ok: false, violations: ['detour'] };

  const distanceMeters = best.legs.reduce((s, l) => s + l.distanceMeters, 0);
  const fare = vehicleFare(vehicleClass, { distanceMeters, durationSeconds: best.total, dropoffs: riders.length }, o.fare);
  const shares = splitFare(
    fare.totalMinor,
    ids.map((r) => ({ id: r.id, seats: r.passengers, directDistanceMeters: r.directDistanceMeters })),
    o.splitMethod,
  );

  const capacity = { seats: VEHICLE_CLASSES[vehicleClass].seats, luggageUnits: VEHICLE_CLASSES[vehicleClass].luggageUnits };
  const members: Record<string, MemberPlan> = {};
  let elapsed = 0;
  best.order.forEach((r, i) => {
    elapsed += best!.legs[i]!.durationSeconds;
    const price = passengerPrice(shares.get(r.id)!, r.passengers, o.fare);
    const soloClass = smallestFitting(acceptableVehicles(r.vehiclePreference, r.wheelchair), r.passengers, luggageUnits(r.luggage)) ?? vehicleClass!;
    const solo = soloPrice(soloClass, direct.get(r.id)!, r.passengers, o.fare);
    if (o.enforcePricing !== false) {
      if (riders.length > 1 && price.totalMinor >= solo.totalMinor) violations.add('no_saving');
      if (r.maxTotalMinor !== undefined && price.totalMinor > r.maxTotalMinor) violations.add('price_cap');
    }
    members[r.id] = {
      seats: r.passengers,
      waitMinutes: Math.round((lastArrival - r.arrivalAt) / 60_000),
      rideMinutes: Math.round(elapsed / 60),
      detourMinutes: Math.max(0, Math.round((elapsed - direct.get(r.id)!.durationSeconds) / 60)),
      dropoffAt: pickupAt + elapsed * 1000,
      dropoffOrder: i + 1,
      price,
      solo,
      savingsPercent: Math.max(0, Math.floor((1 - price.totalMinor / solo.totalMinor) * 100)),
    };
  });
  if (violations.size) return { ok: false, violations: [...violations] };

  const w = o.weights;
  const wsum = w.savings + w.detour + w.wait + w.occupancy || 1;
  const perMember = ids.map((r) => {
    const m = members[r.id]!;
    return (
      (w.savings * (m.savingsPercent / 100) +
        w.detour * (1 - m.detourMinutes / r.maxDetourMinutes) +
        w.wait * (1 - m.waitMinutes / r.maxWaitMinutes) +
        w.occupancy * (seats / capacity.seats)) /
      wsum
    );
  });
  const score = Math.round((perMember.reduce((a, b) => a + b, 0) / perMember.length) * 10_000) / 10_000;

  return {
    ok: true,
    vehicleClass,
    capacity,
    seatsUsed: seats,
    luggageUsed: units,
    pickupAt,
    order: best.order.map((r) => r.id),
    route: { distanceMeters, durationSeconds: best.total, legs: best.legs },
    fare,
    members,
    score,
  };
}
