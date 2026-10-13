import { applyBps, type Minor, splitByWeights } from './money';
import type { VehicleClass } from './rides';

/**
 * Shared-ride fare model. All amounts are integer paise. Rates are configuration (sandbox
 * defaults below) and must be replaced by contracted operator tariffs before launch.
 */
export interface VehicleRate {
  baseMinor: Minor;
  perKmMinor: Minor;
  perMinuteMinor: Minor;
}

export interface FareConfig {
  rates: Record<VehicleClass, VehicleRate>;
  /** Per additional drop-off after the first. */
  extraStopMinor: Minor;
  /** Airport pickup / parking access charge per vehicle. */
  airportAccessMinor: Minor;
  /** WAYLO service fee per seat. */
  platformFeePerSeatMinor: Minor;
  /** Tax on the passenger's fare share + fee, in basis points. Requires tax review before launch. */
  taxBps: number;
  /** Waiting charge disclosed to riders, charged to a late passenger beyond the grace period. */
  waitingPerMinuteMinor: Minor;
  waitingGraceMinutes: number;
}

export const DEFAULT_FARE_CONFIG: FareConfig = {
  rates: {
    sedan: { baseMinor: 15_000, perKmMinor: 1_800, perMinuteMinor: 150 },
    suv: { baseMinor: 20_000, perKmMinor: 2_400, perMinuteMinor: 200 },
    van: { baseMinor: 30_000, perKmMinor: 3_000, perMinuteMinor: 250 },
  },
  extraStopMinor: 5_000,
  airportAccessMinor: 15_000,
  platformFeePerSeatMinor: 4_900,
  taxBps: 500,
  waitingPerMinuteMinor: 200,
  waitingGraceMinutes: 10,
};

export interface VehicleFare {
  baseMinor: Minor;
  distanceMinor: Minor;
  timeMinor: Minor;
  extraStopsMinor: Minor;
  airportAccessMinor: Minor;
  tollsMinor: Minor;
  totalMinor: Minor;
}

/** Fare for the whole vehicle over a route. Distance is rounded to 0.1 km, time to whole minutes. */
export function vehicleFare(
  cls: VehicleClass,
  route: { distanceMeters: number; durationSeconds: number; dropoffs: number; tollsMinor?: Minor },
  cfg: FareConfig = DEFAULT_FARE_CONFIG,
): VehicleFare {
  const r = cfg.rates[cls];
  const tenthsKm = Math.round(route.distanceMeters / 100);
  const minutes = Math.round(route.durationSeconds / 60);
  const distanceMinor = Math.round((tenthsKm * r.perKmMinor) / 10);
  const timeMinor = minutes * r.perMinuteMinor;
  const extraStopsMinor = Math.max(0, route.dropoffs - 1) * cfg.extraStopMinor;
  const tollsMinor = route.tollsMinor ?? 0;
  const totalMinor = r.baseMinor + distanceMinor + timeMinor + extraStopsMinor + cfg.airportAccessMinor + tollsMinor;
  return { baseMinor: r.baseMinor, distanceMinor, timeMinor, extraStopsMinor, airportAccessMinor: cfg.airportAccessMinor, tollsMinor, totalMinor };
}

export type SplitMethod = 'equal_per_seat' | 'distance_weighted';

export interface SplitMember {
  id: string;
  seats: number;
  /** Direct (solo) distance to this member's destination; used by distance_weighted. */
  directDistanceMeters: number;
}

/**
 * Splits the vehicle fare across members. Shares always sum exactly to the vehicle total.
 * - equal_per_seat: every seat pays the same (a party of two pays two shares).
 * - distance_weighted: weight = seats × direct distance, so longer trips pay more. Only used
 *   when every member has agreed to it.
 */
export function splitFare(totalMinor: Minor, members: SplitMember[], method: SplitMethod): Map<string, Minor> {
  const weights =
    method === 'equal_per_seat'
      ? members.map((m) => m.seats)
      : members.map((m) => m.seats * Math.max(1, Math.round(m.directDistanceMeters / 100)));
  const shares = splitByWeights(totalMinor, weights);
  return new Map(members.map((m, i) => [m.id, shares[i]!]));
}

export interface PassengerPrice {
  fareShareMinor: Minor;
  platformFeeMinor: Minor;
  taxMinor: Minor;
  totalMinor: Minor;
}

/** What one member pays: their share of the vehicle fare + per-seat service fee + tax. */
export function passengerPrice(fareShareMinor: Minor, seats: number, cfg: FareConfig = DEFAULT_FARE_CONFIG): PassengerPrice {
  const platformFeeMinor = cfg.platformFeePerSeatMinor * seats;
  const taxMinor = applyBps(fareShareMinor + platformFeeMinor, cfg.taxBps);
  return { fareShareMinor, platformFeeMinor, taxMinor, totalMinor: fareShareMinor + platformFeeMinor + taxMinor };
}

/** The price this party would pay riding alone in the smallest vehicle that fits them. */
export function soloPrice(cls: VehicleClass, route: { distanceMeters: number; durationSeconds: number }, seats: number, cfg: FareConfig = DEFAULT_FARE_CONFIG): PassengerPrice {
  const fare = vehicleFare(cls, { ...route, dropoffs: 1 }, cfg);
  // Riding alone, the party pays the whole vehicle plus the same per-seat service fee.
  return passengerPrice(fare.totalMinor, seats, cfg);
}
