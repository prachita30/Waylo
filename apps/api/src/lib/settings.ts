import { DEFAULT_FARE_CONFIG, DEFAULT_MATCH_WEIGHTS, type FareConfig, type MatchWeights, type SplitMethod } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { appConfig } from '../db/schema';

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
