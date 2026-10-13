import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { cities, savedDestinations, userPreferences, users } from '../../db/schema';

export type UserRow = typeof users.$inferSelect;

/** The only shape of a user ever sent to its owner. Never includes the password hash. */
export function toPublicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    role: u.role,
    status: u.status,
    homeAirport: u.homeAirport,
    avatarUrl: u.avatarFile ? `/api/v1/avatars/${u.avatarFile}` : null,
    isDemo: u.isDemo,
    createdAt: u.createdAt.toISOString(),
  };
}
export type PublicUser = ReturnType<typeof toPublicUser>;

export async function getUserById(db: DbOrTx, id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return u;
}

export async function getUserByEmail(db: DbOrTx, email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return u;
}

export async function getPreferences(db: DbOrTx, userId: string) {
  const [p] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return {
    notifyEmail: p?.notifyEmail ?? true,
    notifySms: p?.notifySms ?? true,
    notifyPush: p?.notifyPush ?? true,
    marketingOptIn: p?.marketingOptIn ?? false,
  };
}

export async function listSavedDestinations(db: DbOrTx, userId: string) {
  return db
    .select({ cityId: cities.id, name: cities.name, state: cities.state, savedAt: savedDestinations.createdAt })
    .from(savedDestinations)
    .innerJoin(cities, eq(cities.id, savedDestinations.cityId))
    .where(eq(savedDestinations.userId, userId))
    .orderBy(asc(cities.name));
}

/**
 * Reasons an account cannot be deleted right now (e.g. a trip in progress).
 * Booking and ride modules add their checks here so deletion never orphans an active trip.
 */
export type DeletionBlocker = (db: DbOrTx, userId: string) => Promise<string | null>;
export const deletionBlockers: DeletionBlocker[] = [];

export async function findDeletionBlockers(db: DbOrTx, userId: string): Promise<string[]> {
  const results = await Promise.all(deletionBlockers.map((b) => b(db, userId)));
  return results.filter((r): r is string => !!r);
}
