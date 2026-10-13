import { and, eq } from 'drizzle-orm';
import type { Db } from './client';
import { airlines, partnerMembers, partnerRoutes, partners } from './schema';

/**
 * Demo inventory partner for local testing: approved, clearly labelled, and authorised only for the
 * fictional sandbox airline S1 on two Mumbai routes. It has no offers; publish them from the portal.
 */
export async function seedDemoPartner(db: Db, ids: Record<string, string>) {
  const userId = ids['partner@demo.waylo.app'];
  if (!userId) return;
  const [existing] = await db.select().from(partners).where(and(eq(partners.isDemo, true), eq(partners.name, 'Saffron Air Demo Desk')));
  if (existing) return;
  await db.insert(airlines).values({ code: 'S1', name: 'Saffron Air', isSandbox: true }).onConflictDoNothing();
  const [p] = await db
    .insert(partners)
    .values({ name: 'Saffron Air Demo Desk', kind: 'airline', phone: '+919800000020', requestedAirlines: [{ code: 'S1', name: 'Saffron Air' }], authorisedAirlines: ['S1'], status: 'approved', isDemo: true, reviewedAt: new Date() })
    .returning();
  await db.insert(partnerMembers).values({ partnerId: p!.id, userId, role: 'owner' });
  await db.insert(partnerRoutes).values([
    { partnerId: p!.id, origin: 'BOM', destination: 'GOI' },
    { partnerId: p!.id, origin: 'BOM', destination: 'DEL' },
  ]);
}
