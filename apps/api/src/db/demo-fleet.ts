import { and, eq } from 'drizzle-orm';
import type { Db } from './client';
import { availability, drivers, operatorMembers, operators, vehicles } from './schema';

/**
 * Demo fleet for local testing: an approved, clearly labelled demo operator with one vehicle per
 * class and standby availability at BOM. Registration numbers use a fictional "DM" series.
 */
export async function seedDemoFleet(db: Db, ids: Record<string, string>) {
  const ownerId = ids['operator@demo.waylo.app'];
  const driverUserId = ids['driver@demo.waylo.app'];
  if (!ownerId || !driverUserId) return;
  const [existing] = await db.select().from(operators).where(and(eq(operators.isDemo, true), eq(operators.name, 'WAYLO Demo Fleet')));
  if (existing) return;

  const [op] = await db
    .insert(operators)
    .values({ name: 'WAYLO Demo Fleet', phone: '+919800000010', airports: ['BOM', 'GOI'], status: 'approved', isDemo: true, reviewedAt: new Date() })
    .returning();
  await db.insert(operatorMembers).values([
    { operatorId: op!.id, userId: ownerId, role: 'owner' },
    { operatorId: op!.id, userId: driverUserId, role: 'driver' },
  ]);
  const ds = await db
    .insert(drivers)
    .values([
      { operatorId: op!.id, userId: driverUserId, fullName: 'Demo Driver', phone: '+919800000011', licenceLast4: 'D001', status: 'approved' },
      { operatorId: op!.id, fullName: 'Ravi Demo', phone: '+919800000012', licenceLast4: 'D002', status: 'approved' },
      { operatorId: op!.id, fullName: 'Sunita Demo', phone: '+919800000013', licenceLast4: 'D003', status: 'approved' },
    ])
    .returning();
  const vs = await db
    .insert(vehicles)
    .values([
      { operatorId: op!.id, vehicleClass: 'sedan', makeModel: 'Maruti Suzuki Dzire', colour: 'White', registration: 'MH 01 DM 1001', seats: 4, luggageUnits: 6, status: 'approved' },
      { operatorId: op!.id, vehicleClass: 'suv', makeModel: 'Toyota Innova Crysta', colour: 'Silver', registration: 'MH 01 DM 2002', seats: 6, luggageUnits: 10, status: 'approved' },
      { operatorId: op!.id, vehicleClass: 'van', makeModel: 'Force Urbania (ramp)', colour: 'Grey', registration: 'MH 01 DM 3003', seats: 8, luggageUnits: 14, wheelchairAccessible: true, status: 'approved' },
    ])
    .returning();
  // Long demo standby windows so matching has supply during local testing.
  const startsAt = new Date(Date.now() - 86_400_000);
  const endsAt = new Date(Date.now() + 45 * 86_400_000);
  await db.insert(availability).values(ds.map((d, i) => ({ operatorId: op!.id, driverId: d.id, vehicleId: vs[i]!.id, airportCode: 'BOM', startsAt, endsAt })));
}
