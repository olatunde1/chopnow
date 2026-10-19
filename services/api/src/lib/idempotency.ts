import { createHash } from 'node:crypto';
import type { Db } from '../db/client.js';
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from './errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;
/** A request still "in progress" after this long is assumed to have crashed and may be retried. */
const STALE_IN_PROGRESS_MS = 2 * 60 * 1000;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function requestHash(request: unknown): string {
  return createHash('sha256').update(stableStringify(request)).digest('hex');
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Runs `operation` at most once per (user, scope, key).
 * - Same key and same request → the stored response is replayed (no second order or charge).
 * - Same key, different request → 422 IDEMPOTENCY_KEY_REUSED.
 * - Same key while the first request is still running → 409 REQUEST_IN_PROGRESS.
 * - If the operation throws, the key is released so the client can retry with it.
 */
export async function withIdempotency<T>(
  db: Db,
  params: { userId: string; scope: string; key: string; request: unknown },
  operation: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  const hash = requestHash(params.request);
  const where = { userId_scope_key: { userId: params.userId, scope: params.scope, key: params.key } };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.idempotencyKey.create({
        data: { userId: params.userId, scope: params.scope, key: params.key, requestHash: hash, expiresAt: new Date(Date.now() + TTL_MS) },
      });
      break;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      const existing = await db.idempotencyKey.findUnique({ where });
      if (!existing) continue; // released between our insert and read; try again
      const expired = existing.expiresAt < new Date();
      const stale = existing.responseStatus === null && Date.now() - existing.createdAt.getTime() > STALE_IN_PROGRESS_MS;
      if (expired || stale) {
        await db.idempotencyKey.deleteMany({ where: { id: existing.id } });
        continue;
      }
      if (existing.requestHash !== hash) {
        throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request. Start a new checkout.');
      }
      if (existing.responseStatus === null) {
        throw new AppError(409, 'REQUEST_IN_PROGRESS', 'Your previous attempt is still being processed. Please wait a moment.');
      }
      return { status: existing.responseStatus, body: existing.responseBody as T, replayed: true };
    }
  }

  try {
    const result = await operation();
    await db.idempotencyKey.update({
      where,
      data: { responseStatus: result.status, responseBody: JSON.parse(JSON.stringify(result.body)) as Prisma.InputJsonValue },
    });
    return { ...result, replayed: false };
  } catch (err) {
    await db.idempotencyKey.deleteMany({ where: { userId: params.userId, scope: params.scope, key: params.key, responseStatus: null } });
    throw err;
  }
}
