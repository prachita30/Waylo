import { and, desc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { operators, rideGroups, rideTrips, settlements } from '../../db/schema';
import { conflict, notFound } from '../../http/errors';
import { recordAudit } from '../../lib/audit';

/**
 * Creates one settlement per operator for completed trips up to `periodEnd` that are not yet
 * settled. Each trip can belong to exactly one settlement. Payouts themselves happen outside
 * WAYLO (bank transfer or payout provider) and are recorded with markSettlementPaid.
 */
export async function runSettlements(ctx: AppContext, periodEnd: Date, actorId: string | null) {
  return ctx.db.transaction(async (tx) => {
    const trips = await tx
      .select({ t: rideTrips, fare: rideGroups.vehicleFareMinor })
      .from(rideTrips)
      .innerJoin(rideGroups, eq(rideGroups.id, rideTrips.groupId))
      .where(and(eq(rideGroups.status, 'completed'), isNotNull(rideTrips.completedAt), lte(rideTrips.completedAt, periodEnd), isNull(rideTrips.settlementId)))
      .for('update');
    const byOperator = new Map<string, typeof trips>();
    for (const row of trips) byOperator.set(row.t.operatorId, [...(byOperator.get(row.t.operatorId) ?? []), row]);
    const created = [];
    for (const [operatorId, rows] of byOperator) {
      const gross = rows.reduce((s, r) => s + r.fare, 0);
      const commission = rows.reduce((s, r) => s + (r.t.commissionMinor ?? 0), 0);
      const start = new Date(Math.min(...rows.map((r) => r.t.completedAt!.getTime())));
      const [settlement] = await tx
        .insert(settlements)
        .values({ operatorId, periodStart: start, periodEnd, tripsCount: rows.length, grossFareMinor: gross, commissionMinor: commission, payoutMinor: gross - commission, createdBy: actorId })
        .returning();
      for (const r of rows) await tx.update(rideTrips).set({ settlementId: settlement!.id }).where(eq(rideTrips.groupId, r.t.groupId));
      await recordAudit(tx, { actorUserId: actorId, actorRole: actorId ? 'admin' : null, action: 'settlement.created', entityType: 'settlement', entityId: settlement!.id, metadata: { operatorId, trips: rows.length, payoutMinor: gross - commission } });
      created.push(settlement!);
    }
    return created;
  });
}

export async function markSettlementPaid(ctx: AppContext, id: string, reference: string, actorId: string) {
  const [s] = await ctx.db.select().from(settlements).where(eq(settlements.id, id));
  if (!s) throw notFound('Settlement');
  if (s.status === 'paid') throw conflict('already_paid', 'This settlement is already marked as paid.');
  const [updated] = await ctx.db.update(settlements).set({ status: 'paid', payoutReference: reference, paidAt: new Date() }).where(eq(settlements.id, id)).returning();
  await recordAudit(ctx.db, { actorUserId: actorId, actorRole: 'admin', action: 'settlement.paid', entityType: 'settlement', entityId: id, metadata: { reference } });
  return updated!;
}

export async function listSettlements(ctx: AppContext, operatorId?: string) {
  const rows = await ctx.db
    .select({ s: settlements, operatorName: operators.name })
    .from(settlements)
    .innerJoin(operators, eq(operators.id, settlements.operatorId))
    .where(operatorId ? eq(settlements.operatorId, operatorId) : undefined)
    .orderBy(desc(settlements.createdAt))
    .limit(200);
  return rows.map(({ s, operatorName }) => ({ ...s, operatorName }));
}
