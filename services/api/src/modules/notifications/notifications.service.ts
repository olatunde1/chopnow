import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import type { DevicePlatform } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import type { Principal } from '../auth/auth.service.js';
import { EXPO_TOKEN, PushTransientError, type PushProvider } from './push.js';

const MAX_ATTEMPTS = 5;
/** A notification not pushed within this time is no longer worth a buzz (it stays in the in-app list). */
const STALE_MS = 30 * 60_000;

/**
 * In-app notification list, push-token registry, and the push sender. The sender is safe to run on
 * several instances: rows are claimed with SKIP LOCKED and the provider is called outside any
 * transaction; a crash between claim and send means at most one extra attempt later.
 */
export class NotificationsService {
  constructor(
    private readonly db: Db,
    private readonly push: PushProvider,
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: Logger,
  ) {}

  async list(principal: Principal, page: number, pageSize: number, unreadOnly: boolean) {
    const where = { userId: principal.userId, ...(unreadOnly ? { readAt: null } : {}) };
    const [total, unread, rows] = await Promise.all([
      this.db.notification.count({ where }),
      this.db.notification.count({ where: { userId: principal.userId, readAt: null } }),
      this.db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return {
      page, pageSize, total, unreadCount: unread,
      items: rows.map((n) => {
        const { _push: _ignored, ...data } = (n.data ?? {}) as Record<string, unknown>;
        return { id: n.id, type: n.type, title: n.title, body: n.body, orderId: n.orderId, data, readAt: n.readAt, createdAt: n.createdAt };
      }),
    };
  }

  async markRead(principal: Principal, input: { ids?: string[]; all?: boolean }) {
    const res = await this.db.notification.updateMany({
      where: { userId: principal.userId, readAt: null, ...(input.all ? {} : { id: { in: input.ids ?? [] } }) },
      data: { readAt: this.now() },
    });
    return { updated: res.count };
  }

  /** A device's token belongs to whoever signed in on it last. */
  async registerToken(principal: Principal, token: string, platform: DevicePlatform) {
    if (!EXPO_TOKEN.test(token)) throw new AppError(400, 'INVALID_PUSH_TOKEN', 'That is not an Expo push token.');
    await this.db.pushToken.upsert({
      where: { token },
      create: { token, platform, userId: principal.userId, lastUsedAt: this.now() },
      update: { userId: principal.userId, platform, disabledAt: null, lastUsedAt: this.now() },
    });
    return { ok: true as const };
  }

  async removeToken(principal: Principal, token: string) {
    await this.db.pushToken.updateMany({ where: { token, userId: principal.userId }, data: { disabledAt: this.now() } });
    return { ok: true as const };
  }

  /** One sweep: claim pending notifications, push them, record the outcome. Returns how many were handled. */
  async deliverPending(limit = 100): Promise<{ handled: number; sent: number }> {
    const now = this.now();
    const claimed = await this.db.$queryRaw<{ id: string; userId: string; type: string; title: string; body: string; orderId: string | null; data: unknown; createdAt: Date; pushAttempts: number }[]>`
      UPDATE notifications SET "pushAttempts" = "pushAttempts" + 1
      WHERE id IN (
        SELECT id FROM notifications WHERE "pushedAt" IS NULL AND "pushAttempts" < ${MAX_ATTEMPTS}
        ORDER BY "createdAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "userId", type, title, body, "orderId", data, "createdAt", "pushAttempts"`;
    if (!claimed.length) return { handled: 0, sent: 0 };

    const done = async (ids: string[], error: string | null) => {
      if (ids.length) await this.db.notification.updateMany({ where: { id: { in: ids } }, data: { pushedAt: now, pushError: error } });
    };
    const stale = claimed.filter((n) => now.getTime() - new Date(n.createdAt).getTime() > STALE_MS);
    await done(stale.map((n) => n.id), 'stale: not pushed');
    const fresh = claimed.filter((n) => !stale.includes(n));

    const tokens = await this.db.pushToken.findMany({ where: { userId: { in: [...new Set(fresh.map((n) => n.userId))] }, disabledAt: null } });
    const byUser = new Map<string, string[]>();
    for (const t of tokens) byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), t.token]);
    const noDevice = fresh.filter((n) => !byUser.has(n.userId));
    await done(noDevice.map((n) => n.id), null);

    const toSend = fresh.filter((n) => byUser.has(n.userId));
    const messages = toSend.flatMap((n) => {
      const meta = ((n.data as Record<string, unknown> | null)?._push ?? {}) as { priority?: 'default' | 'high'; ttlSeconds?: number };
      return byUser.get(n.userId)!.map((to) => ({
        to, title: n.title, body: n.body,
        data: { notificationId: n.id, type: n.type, ...(n.orderId ? { orderId: n.orderId } : {}) },
        priority: meta.priority ?? 'default',
        ...(meta.ttlSeconds ? { ttlSeconds: meta.ttlSeconds } : {}),
      }));
    });
    if (!messages.length) return { handled: stale.length + noDevice.length, sent: 0 };

    try {
      const results = await this.push.send(messages);
      const dead = results.filter((r) => r.invalidToken).map((r) => r.to);
      if (dead.length) await this.db.pushToken.updateMany({ where: { token: { in: dead } }, data: { disabledAt: now } });
      const okTokens = new Set(results.filter((r) => r.ok).map((r) => r.to));
      if (okTokens.size) await this.db.pushToken.updateMany({ where: { token: { in: [...okTokens] } }, data: { lastUsedAt: now } });
      const failed = results.filter((r) => !r.ok && !r.invalidToken);
      await done(toSend.map((n) => n.id), failed.length ? `some devices failed: ${[...new Set(failed.map((f) => f.error))].join(', ')}`.slice(0, 300) : null);
      return { handled: claimed.length, sent: okTokens.size };
    } catch (err) {
      // Provider unavailable: leave them pending (attempt already counted) unless out of attempts.
      const message = err instanceof PushTransientError ? err.message : 'push failed';
      const last = toSend.filter((n) => n.pushAttempts >= MAX_ATTEMPTS).map((n) => n.id);
      await this.db.notification.updateMany({ where: { id: { in: toSend.map((n) => n.id) } }, data: { pushError: message.slice(0, 300) } });
      await done(last, `gave up: ${message}`.slice(0, 300));
      this.logger?.warn({ err, count: toSend.length }, 'push delivery failed; will retry');
      return { handled: stale.length + noDevice.length + last.length, sent: 0 };
    }
  }
}
