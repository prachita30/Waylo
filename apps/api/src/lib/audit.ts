import type { DbOrTx } from '../db/client';
import { auditEvents } from '../db/schema';

export interface AuditInput {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Append-only record of privileged or security-relevant actions. Never store secrets in metadata. */
export async function recordAudit(db: DbOrTx, input: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorUserId: input.actorUserId ?? null,
    actorRole: input.actorRole ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? {},
    ip: input.ip ?? null,
  });
}
