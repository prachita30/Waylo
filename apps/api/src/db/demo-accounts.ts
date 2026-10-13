import type { Role } from '@waylo/shared';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/password';
import type { Db } from './client';
import { userPreferences, users } from './schema';

/**
 * Clearly labelled demo accounts for local testing. Seeded only in demo mode and flagged
 * is_demo so the UI can mark them. The shared password is a development fixture, not a secret.
 */
export const DEMO_PASSWORD = 'waylo-demo-2026';

export const DEMO_ACCOUNTS: { email: string; fullName: string; role: Role; phone?: string; homeAirport?: string }[] = [
  { email: 'passenger@demo.waylo.app', fullName: 'Demo Passenger', role: 'passenger', phone: '+919800000001', homeAirport: 'BOM' },
  { email: 'rider2@demo.waylo.app', fullName: 'Demo Rider Two', role: 'passenger', phone: '+919800000002', homeAirport: 'BOM' },
  { email: 'rider3@demo.waylo.app', fullName: 'Demo Rider Three', role: 'passenger', phone: '+919800000003', homeAirport: 'BOM' },
  { email: 'operator@demo.waylo.app', fullName: 'Demo Fleet Operator', role: 'operator', phone: '+919800000010' },
  { email: 'driver@demo.waylo.app', fullName: 'Demo Driver', role: 'operator', phone: '+919800000011' },
  { email: 'partner@demo.waylo.app', fullName: 'Demo Airline Partner', role: 'partner' },
  { email: 'admin@demo.waylo.app', fullName: 'Demo Administrator', role: 'admin' },
];

export async function seedDemoAccounts(db: Db): Promise<Record<string, string>> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const ids: Record<string, string> = {};
  for (const a of DEMO_ACCOUNTS) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, a.email));
    if (existing) {
      ids[a.email] = existing.id;
      continue;
    }
    const [u] = await db
      .insert(users)
      .values({ ...a, passwordHash, isDemo: true })
      .returning({ id: users.id });
    await db.insert(userPreferences).values({ userId: u!.id }).onConflictDoNothing();
    ids[a.email] = u!.id;
  }
  return ids;
}
