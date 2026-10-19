import type { DbOrTx } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuditEntry {
  actorUserId: string | null;
  /** Role at the time of the action, or 'SYSTEM'. */
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/** Writes an append-only audit record. Pass the transaction client so the audit commits with the change. */
export async function writeAudit(db: DbOrTx, entry: AuditEntry, ctx: RequestContext = {}): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before,
      after: entry.after,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent?.slice(0, 300),
      requestId: ctx.requestId,
    },
  });
}
