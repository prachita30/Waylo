import { DEFAULT_FARE_CONFIG, DEFAULT_MATCH_WEIGHTS, type FareConfig, type MatchWeights, type SplitMethod } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { appConfig } from '../db/schema';
import { AppError } from '../http/errors';

/** Operational settings stored in app_config (editable by admins), with code defaults. */
export interface RideSettings {
  fare: FareConfig;
  weights: MatchWeights;
  /** Planning allowance from landing to being at the pickup point. An estimate, shown as such. */
  exitBufferMinutes: number;
  /** Groups lock this long before planned pickup. */
  lockLeadMinutes: number;
  maxParties: number;
  defaultSplitMethod: SplitMethod;
  /** Cancellation after lock: percentage of the rider's total. */
  lateCancelPercent: number;
  /** Within this many minutes of pickup, cancelling costs the full price. */
  fullChargeWithinMinutes: number;
  /** Driver waits this long after the planned pickup before a rider is a no-show. */
  pickupGraceMinutes: number;
}

export const DEFAULT_RIDE_SETTINGS: RideSettings = {
  fare: DEFAULT_FARE_CONFIG,
  weights: DEFAULT_MATCH_WEIGHTS,
  exitBufferMinutes: 30,
  lockLeadMinutes: 45,
  maxParties: 4,
  defaultSplitMethod: 'equal_per_seat',
  lateCancelPercent: 25,
  fullChargeWithinMinutes: 30,
  pickupGraceMinutes: 15,
};

export const RIDE_SETTINGS_KEY = 'rides.settings';

export async function getRideSettings(db: DbOrTx): Promise<RideSettings> {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, RIDE_SETTINGS_KEY));
  const stored = (row?.value ?? {}) as Partial<RideSettings>;
  return {
    ...DEFAULT_RIDE_SETTINGS,
    ...stored,
    fare: { ...DEFAULT_RIDE_SETTINGS.fare, ...stored.fare, rates: { ...DEFAULT_RIDE_SETTINGS.fare.rates, ...stored.fare?.rates } },
    weights: { ...DEFAULT_RIDE_SETTINGS.weights, ...stored.weights },
  };
}

/**
 * Platform switches an administrator can flip without a deploy. They gate the server-side entry
 * point of each feature (not just the UI), and are exposed read-only through /meta.
 */
export interface FeatureFlags {
  /** New flight price locks and bookings. Existing bookings, cancellations and refunds keep working. */
  flightBooking: boolean;
  /** New shared-ride requests and groups. Existing rides keep running. */
  rideRequests: boolean;
  partnerOnboarding: boolean;
  operatorOnboarding: boolean;
}

export const DEFAULT_FEATURES: FeatureFlags = { flightBooking: true, rideRequests: true, partnerOnboarding: true, operatorOnboarding: true };
export const FEATURES_KEY = 'platform.features';

export async function getFeatures(db: DbOrTx): Promise<FeatureFlags> {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, FEATURES_KEY));
  return { ...DEFAULT_FEATURES, ...((row?.value ?? {}) as Partial<FeatureFlags>) };
}

const FEATURE_MESSAGE: Record<keyof FeatureFlags, string> = {
  flightBooking: 'Flight booking is paused right now. Existing bookings are not affected.',
  rideRequests: 'New shared rides are paused right now. Existing rides are not affected.',
  partnerOnboarding: 'New partner applications are paused right now.',
  operatorOnboarding: 'New operator applications are paused right now.',
};

export async function requireFeature(db: DbOrTx, key: keyof FeatureFlags): Promise<void> {
  if (!(await getFeatures(db))[key]) throw new AppError(503, 'feature_disabled', FEATURE_MESSAGE[key]);
}
