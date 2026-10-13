import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import type { DbOrTx } from '../../db/client';
import { drivers, operatorMembers, operators } from '../../db/schema';
import { currentUser } from '../../http/auth';
import { AppError, forbidden } from '../../http/errors';

export type OperatorRow = typeof operators.$inferSelect;
export interface Membership {
  operator: OperatorRow;
  role: 'owner' | 'dispatcher' | 'driver';
  driverId: string | null;
}

export async function membershipFor(db: DbOrTx, userId: string): Promise<Membership | null> {
  const [m] = await db
    .select({ operator: operators, role: operatorMembers.role })
    .from(operatorMembers)
    .innerJoin(operators, eq(operators.id, operatorMembers.operatorId))
    .where(eq(operatorMembers.userId, userId));
  if (!m) return null;
  const [d] = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.userId, userId));
  return { operator: m.operator, role: m.role, driverId: d?.id ?? null };
}

/**
 * Resolves the caller's operator membership. `manage` requires owner/dispatcher; `approved`
 * requires the operator to be approved (only approved operators may take passenger trips).
 */
export async function requireMembership(db: DbOrTx, req: Request, opts: { manage?: boolean; approved?: boolean } = {}): Promise<Membership> {
  const user = currentUser(req);
  if (user.role !== 'operator') throw forbidden();
  const m = await membershipFor(db, user.id);
  if (!m) throw new AppError(403, 'not_onboarded', 'Set up your operator account first.');
  if (opts.manage && m.role === 'driver') throw forbidden('Only the fleet owner or a dispatcher can do this.');
  if (opts.approved && m.operator.status !== 'approved') {
    throw new AppError(403, 'operator_not_approved', m.operator.status === 'suspended' ? 'Your operator account is suspended.' : 'Your operator account is awaiting approval.');
  }
  return m;
}
