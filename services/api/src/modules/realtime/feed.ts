import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import type { RealtimeHub } from './hub.js';

/** Rows committed late (long transactions) can carry an earlier timestamp: look back this far. */
const LOOKBACK_MS = 15_000;
const BATCH = 500;

type Cursor = { since: Date; seen: Map<string, number> };

/**
 * Turns committed database changes into "refetch" hints for connected clients. It reads the
 * append-only tables the business logic already writes (order status history, delivery events,
 * offers, notifications), so no service has to remember to publish, events only go out after
 * commit, and it works the same on every API instance. Latency is one poll interval (1 s).
 */
export class ChangeFeed {
  private readonly cursors: Record<'history' | 'events' | 'offers' | 'notifications', Cursor>;

  constructor(
    private readonly db: Db,
    private readonly hub: RealtimeHub,
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: Logger,
  ) {
    const start = new Date(this.now().getTime() - 1000);
    const c = (): Cursor => ({ since: start, seen: new Map() });
    this.cursors = { history: c(), events: c(), offers: c(), notifications: c() };
  }

  /** Returns rows newer than the cursor (minus the look-back) that haven't been published yet. */
  private fresh<T extends { id: string; at: Date }>(cursor: Cursor, rows: T[]): T[] {
    const out = rows.filter((r) => !cursor.seen.has(r.id));
    const nowMs = this.now().getTime();
    for (const r of out) cursor.seen.set(r.id, r.at.getTime());
    const newest = rows.reduce((m, r) => Math.max(m, r.at.getTime()), cursor.since.getTime());
    cursor.since = new Date(Math.min(newest, nowMs));
    for (const [id, at] of cursor.seen) if (at < cursor.since.getTime() - LOOKBACK_MS * 2) cursor.seen.delete(id);
    return out;
  }

  private from(cursor: Cursor) {
    return new Date(cursor.since.getTime() - LOOKBACK_MS);
  }

  /** Last error per source (diagnostics); a failing source never blocks the others. */
  readonly lastErrors: Partial<Record<string, string>> = {};

  async poll(): Promise<number> {
    let published = 0;
    for (const [name, run] of [['history', () => this.history()], ['events', () => this.deliveryEvents()], ['offers', () => this.offers()], ['notifications', () => this.notifications()]] as const) {
      try {
        published += await run();
        delete this.lastErrors[name];
      } catch (err) {
        this.lastErrors[name] = err instanceof Error ? err.message.slice(0, 300) : 'error';
        this.logger?.error({ err, source: name }, 'realtime feed source failed');
      }
    }
    return published;
  }

  private async history() {
    const rows = await this.db.orderStatusHistory.findMany({
      where: { createdAt: { gte: this.from(this.cursors.history) } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true, createdAt: true, toStatus: true, order: { select: { id: true, customerId: true, visibleToVendorAt: true, restaurant: { select: { id: true, ownerId: true } }, delivery: { select: { currentRider: { select: { userId: true } } } } } } },
    });
    const fresh = this.fresh(this.cursors.history, rows.map((r) => ({ ...r, at: r.createdAt })));
    for (const r of fresh) {
      const o = r.order;
      const event = { type: 'order.updated' as const, orderId: o.id, restaurantId: o.restaurant.id, status: r.toStatus };
      this.hub.toUsers([o.customerId, o.visibleToVendorAt ? o.restaurant.ownerId : null, o.delivery?.currentRider?.userId], event);
      this.hub.toStaff(event);
    }
    return fresh.length;
  }

  private async deliveryEvents() {
    const rows = await this.db.deliveryEvent.findMany({
      where: { createdAt: { gte: this.from(this.cursors.events) } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true, createdAt: true, type: true, deliveryId: true, rider: { select: { userId: true } }, delivery: { select: { currentRider: { select: { userId: true } }, order: { select: { id: true, customerId: true, restaurant: { select: { id: true, ownerId: true } } } } } } },
    });
    const fresh = this.fresh(this.cursors.events, rows.map((r) => ({ ...r, at: r.createdAt })));
    for (const r of fresh) {
      const o = r.delivery.order;
      const riders = [r.rider?.userId, r.delivery.currentRider?.userId];
      this.hub.toUsers([o.customerId, o.restaurant.ownerId], { type: 'delivery.updated', orderId: o.id, restaurantId: o.restaurant.id, deliveryId: r.deliveryId, event: r.type });
      this.hub.toUsers(riders, { type: 'work.updated', deliveryId: r.deliveryId });
      this.hub.toStaff({ type: 'dispatch.updated' });
    }
    return fresh.length;
  }

  private async offers() {
    const rows = await this.db.deliveryOffer.findMany({
      where: { offeredAt: { gte: this.from(this.cursors.offers) } },
      orderBy: { offeredAt: 'asc' },
      take: BATCH,
      select: { id: true, offeredAt: true, deliveryId: true, rider: { select: { userId: true } } },
    });
    const fresh = this.fresh(this.cursors.offers, rows.map((r) => ({ ...r, at: r.offeredAt })));
    for (const r of fresh) {
      this.hub.toUsers([r.rider.userId], { type: 'work.updated', deliveryId: r.deliveryId });
      this.hub.toStaff({ type: 'dispatch.updated' });
    }
    return fresh.length;
  }

  private async notifications() {
    const rows = await this.db.notification.findMany({
      where: { createdAt: { gte: this.from(this.cursors.notifications) } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true, createdAt: true, userId: true, type: true, orderId: true },
    });
    const fresh = this.fresh(this.cursors.notifications, rows.map((r) => ({ ...r, at: r.createdAt })));
    for (const r of fresh) this.hub.toUsers([r.userId], { type: 'notification.new', notificationId: r.id, notificationType: r.type, orderId: r.orderId });
    return fresh.length;
  }
}
