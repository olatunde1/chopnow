import { distanceMeters } from '@chopnow/shared-utils';
import type { Logger } from 'pino';
import type { Db, DbOrTx, Tx } from '../../db/client.js';
import type { Order, RiderType, VehicleType } from '../../generated/prisma/client.js';
import { writeAudit } from '../audit/audit.js';
import { getBusinessRules, type BusinessRules } from '../settings/business-rules.js';
import { notifyOffer } from '../notifications/messages.js';

/** A rider counts as reachable if the app polled or sent a location within this window. */
export const RIDER_HEARTBEAT_MS = 90_000;
/** A rider whose offer for a delivery expired may be offered the same delivery again after this. */
const EXPIRED_OFFER_COOLDOWN_MS = 120_000;
/** Waiting deliveries read per query while a sweep walks the queue. */
const TICK_BATCH = 50;
export const ACTIVE_DELIVERY_STATUSES = ['ASSIGNED', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP'] as const;
const DISPATCHABLE_ORDER_STATUSES = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'] as const;

/** Cash each rider has collected and not yet handed over (collected − reconciled). */
export async function outstandingCashByRider(db: DbOrTx, riderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (riderIds.length === 0) return out;
  const rows = await db.cashCollection.groupBy({
    by: ['riderId'],
    where: { riderId: { in: riderIds }, reconciliationStatus: { in: ['OUTSTANDING', 'PARTIALLY_RECONCILED'] } },
    _sum: { amountCollectedKobo: true, amountReconciledKobo: true },
  });
  for (const r of rows) if (r.riderId) out.set(r.riderId, (r._sum.amountCollectedKobo ?? 0) - (r._sum.amountReconciledKobo ?? 0));
  return out;
}

/** Prisma select for `publicRider`. */
export const publicRiderSelect = {
  status: true,
  currentRider: { select: { vehicleType: true, user: { select: { fullName: true } } } },
} as const;

/** What customers and restaurants see about the rider: first name and vehicle, once one has accepted. */
export function publicRider(d: { status: string; currentRider: { vehicleType: VehicleType; user: { fullName: string } } | null } | null) {
  if (!d?.currentRider || d.status === 'CANCELLED') return null;
  return { firstName: d.currentRider.user.fullName.split(/\s+/)[0] ?? 'Rider', vehicleType: d.currentRider.vehicleType };
}

export const cashLimitFor =(rider: { cashLimitKoboOverride: number | null }, rules: BusinessRules) =>
  rider.cashLimitKoboOverride ?? rules.cashOnDelivery.riderOutstandingCashLimitKobo;

/**
 * Creates the delivery (and, for cash orders, the cash-collection record) for an order. Called in the
 * same transaction as the order status change that starts dispatch. Safe to call twice.
 */
export async function openDelivery(tx: Tx, order: Pick<Order, 'id' | 'paymentMethod' | 'totalKobo'>, now: Date): Promise<string> {
  const existing = await tx.delivery.findUnique({ where: { orderId: order.id }, select: { id: true } });
  if (existing) return existing.id;
  const cash = order.paymentMethod === 'CASH_ON_DELIVERY' ? order.totalKobo : 0;
  const delivery = await tx.delivery.create({
    data: { orderId: order.id, status: 'OFFERING', cashToCollectKobo: cash, dispatchStartedAt: now },
  });
  if (cash > 0) await tx.cashCollection.create({ data: { orderId: order.id, deliveryId: delivery.id, amountDueKobo: cash } });
  await tx.deliveryEvent.create({ data: { deliveryId: delivery.id, type: 'DISPATCH_STARTED', createdAt: now } });
  return delivery.id;
}

/**
 * Stops dispatch for an order that will not be delivered (cancelled by the customer, restaurant or
 * operations). Pending offers are withdrawn and an accepted one is released.
 */
export async function cancelDelivery(tx: Tx, orderId: string, reason: string, now: Date): Promise<void> {
  const d = await tx.delivery.findUnique({ where: { orderId } });
  if (!d || d.status === 'DELIVERED' || d.status === 'CANCELLED' || d.status === 'FAILED') return;
  await tx.delivery.update({ where: { id: d.id }, data: { status: 'CANCELLED', failureReason: reason } });
  await tx.deliveryOffer.updateMany({ where: { deliveryId: d.id, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: now } });
  await tx.deliveryOffer.updateMany({ where: { deliveryId: d.id, status: 'ACCEPTED' }, data: { status: 'RELEASED' } });
  await tx.cashCollection.updateMany({ where: { deliveryId: d.id, status: 'PENDING' }, data: { status: 'NOT_COLLECTED' } });
  await tx.deliveryEvent.create({ data: { deliveryId: d.id, riderId: d.currentRiderId, type: 'CANCELLED', note: reason, createdAt: now } });
}

/**
 * Offers deliveries to riders, one rider at a time.
 *
 * Order of preference: core riders only for the first `coreOnlyWindowSeconds`, then independent
 * riders too; within the allowed tiers the closest reachable rider to the restaurant (riders with no
 * known position last). A rider is eligible when approved, online, recently seen, not on another
 * delivery and not holding another pending offer. Riders who declined or released this delivery are
 * not asked again. Cash orders skip riders at or over their outstanding-cash limit. If nobody has
 * accepted after `alertOperationsAfterSeconds`, operations is alerted once (audit + log).
 *
 * Concurrency: each delivery is locked with SKIP LOCKED and each chosen rider row is locked before an
 * offer is created, so several API instances can run the sweep at once without double-offering.
 */
export class DispatchService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: Logger,
  ) {}

  /** Periodic sweep: expire stale offers, then make the next offer for every waiting delivery. */
  /**
   * One sweep: expire stale offers, offer waiting jobs oldest first, then alert operations about
   * jobs nobody has taken. The whole queue is walked (not just its head), so a run of jobs that the
   * free riders can't take (cash limit, already declined) never hides a later one they can. The
   * walk stops as soon as no rider is free, which keeps quiet periods and rush hours cheap.
   */
  async tick(): Promise<{ expired: number; offered: number }> {
    const expired = await this.expireOffers();
    let offered = 0;
    let after: { at: Date; id: string } | null = null;
    while ((await this.freeRiderCount()) > 0) {
      const batch: { id: string; dispatchStartedAt: Date | null }[] = await this.db.delivery.findMany({
        where: {
          status: { in: ['UNASSIGNED', 'OFFERING'] },
          order: { status: { in: [...DISPATCHABLE_ORDER_STATUSES] } },
          offers: { none: { status: 'PENDING' } },
          ...(after ? { OR: [{ dispatchStartedAt: { gt: after.at } }, { dispatchStartedAt: after.at, id: { gt: after.id } }] } : {}),
        },
        select: { id: true, dispatchStartedAt: true },
        orderBy: [{ dispatchStartedAt: 'asc' }, { id: 'asc' }],
        take: TICK_BATCH,
      });
      for (const d of batch) {
        try {
          if (await this.offerNext(d.id)) offered++;
        } catch (err) {
          this.logger?.error({ err, deliveryId: d.id }, 'dispatch offer failed');
        }
      }
      const last = batch.at(-1);
      if (batch.length < TICK_BATCH || !last?.dispatchStartedAt) break;
      after = { at: last.dispatchStartedAt, id: last.id };
    }
    await this.alertUnassigned();
    return { expired, offered };
  }

  /** Riders who could take an offer right now (approved, online and fresh, no job, no pending offer). */
  private freeRiderCount(): Promise<number> {
    const now = this.now();
    return this.db.rider.count({
      where: {
        verificationStatus: 'APPROVED',
        availability: 'ONLINE',
        lastSeenAt: { gte: new Date(now.getTime() - RIDER_HEARTBEAT_MS) },
        user: { status: 'ACTIVE' },
        deliveries: { none: { status: { in: [...ACTIVE_DELIVERY_STATUSES] } } },
        offers: { none: { status: 'PENDING', expiresAt: { gt: now } } },
      },
    });
  }

  /** Alerts operations once for each job that has waited past the threshold with no offer out. */
  private async alertUnassigned(): Promise<void> {
    const now = this.now();
    const rules = await getBusinessRules(this.db);
    const stale = await this.db.delivery.findMany({
      where: {
        status: { in: ['UNASSIGNED', 'OFFERING'] },
        order: { status: { in: [...DISPATCHABLE_ORDER_STATUSES] } },
        dispatchAlertAt: null,
        dispatchStartedAt: { lte: new Date(now.getTime() - rules.dispatch.alertOperationsAfterSeconds * 1000) },
        offers: { none: { status: 'PENDING', expiresAt: { gt: now } } },
      },
      select: { id: true, dispatchStartedAt: true, order: { select: { code: true } }, _count: { select: { offers: true } } },
      take: 100,
    });
    for (const d of stale) {
      // The conditional update makes the alert once-only even if two sweeps overlap.
      const claimed = await this.db.delivery.updateMany({ where: { id: d.id, dispatchAlertAt: null }, data: { dispatchAlertAt: now } });
      if (claimed.count === 0) continue;
      await writeAudit(this.db, {
        actorUserId: null,
        actorRole: 'SYSTEM',
        action: 'dispatch.unassigned_alert',
        entityType: 'Delivery',
        entityId: d.id,
        after: { orderCode: d.order.code, waitingSeconds: Math.round((now.getTime() - (d.dispatchStartedAt ?? now).getTime()) / 1000), offersMade: d._count.offers },
      });
      this.logger?.warn({ deliveryId: d.id, orderCode: d.order.code }, 'no rider has accepted this delivery; operations alerted');
    }
  }

  async expireOffers(): Promise<number> {
    const now = this.now();
    const stale = await this.db.deliveryOffer.findMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, select: { id: true, deliveryId: true, riderId: true } });
    let count = 0;
    for (const o of stale) {
      const res = await this.db.deliveryOffer.updateMany({ where: { id: o.id, status: 'PENDING' }, data: { status: 'EXPIRED', respondedAt: now } });
      if (res.count === 1) {
        count++;
        await this.db.deliveryEvent.create({ data: { deliveryId: o.deliveryId, riderId: o.riderId, type: 'OFFER_EXPIRED', createdAt: now } });
      }
    }
    return count;
  }

  /** Makes one offer for a delivery if it has none pending. Returns the rider offered, or null. */
  async offerNext(deliveryId: string): Promise<string | null> {
    return this.db.$transaction(async (tx) => {
      const now = this.now();
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM deliveries WHERE id = ${deliveryId}::uuid AND status IN ('UNASSIGNED', 'OFFERING') FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return null;
      const d = await tx.delivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: { order: { select: { id: true, code: true, status: true, riderEarningKobo: true, restaurant: { select: { name: true, latitude: true, longitude: true } } } }, offers: true },
      });
      if (!(DISPATCHABLE_ORDER_STATUSES as readonly string[]).includes(d.order.status)) return null;
      if (d.offers.some((o) => o.status === 'PENDING' && o.expiresAt > now)) return null;

      const rules = await getBusinessRules(tx);
      const started = (d.dispatchStartedAt ?? d.createdAt).getTime();
      const widened = now.getTime() - started >= rules.dispatch.coreOnlyWindowSeconds * 1000;
      const tiers: RiderType[] = widened ? ['CORE', 'INDEPENDENT'] : ['CORE'];
      if (widened && !d.widenedAt) await tx.delivery.update({ where: { id: d.id }, data: { widenedAt: now } });

      const excluded = new Set(
        d.offers
          .filter((o) => o.status === 'DECLINED' || o.status === 'RELEASED' || (o.status === 'EXPIRED' && now.getTime() - (o.respondedAt ?? o.expiresAt).getTime() < EXPIRED_OFFER_COOLDOWN_MS))
          .map((o) => o.riderId),
      );

      let candidates = await tx.rider.findMany({
        where: {
          id: { notIn: [...excluded] },
          verificationStatus: 'APPROVED',
          availability: 'ONLINE',
          riderType: { in: tiers },
          lastSeenAt: { gte: new Date(now.getTime() - RIDER_HEARTBEAT_MS) },
          user: { status: 'ACTIVE' },
          deliveries: { none: { status: { in: [...ACTIVE_DELIVERY_STATUSES] } } },
          offers: { none: { status: 'PENDING', expiresAt: { gt: now } } },
        },
        select: { id: true, lastLatitude: true, lastLongitude: true, lastSeenAt: true, cashLimitKoboOverride: true },
      });

      if (d.cashToCollectKobo > 0 && candidates.length) {
        const cash = await outstandingCashByRider(tx, candidates.map((c) => c.id));
        candidates = candidates.filter((c) => (cash.get(c.id) ?? 0) < cashLimitFor(c, rules));
      }

      const r = d.order.restaurant;
      const dist = (c: (typeof candidates)[number]) =>
        c.lastLatitude !== null && c.lastLongitude !== null && r.latitude !== null && r.longitude !== null
          ? distanceMeters({ latitude: c.lastLatitude, longitude: c.lastLongitude }, { latitude: r.latitude, longitude: r.longitude })
          : Number.POSITIVE_INFINITY;
      candidates.sort((a, b) => dist(a) - dist(b) || (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0));

      for (const c of candidates) {
        // Lock the rider so two deliveries (or two instances) cannot offer to them at the same moment.
        const free = await tx.$queryRaw<{ id: string }[]>`
          SELECT r.id FROM riders r WHERE r.id = ${c.id}::uuid
            AND NOT EXISTS (SELECT 1 FROM delivery_offers o WHERE o."riderId" = r.id AND o.status = 'PENDING' AND o."expiresAt" > ${now})
          FOR UPDATE OF r SKIP LOCKED`;
        if (free.length === 0) continue;
        const rider = await tx.rider.findUniqueOrThrow({ where: { id: c.id }, select: { riderType: true, userId: true } });
        const offer = await tx.deliveryOffer.create({
          data: { deliveryId: d.id, riderId: c.id, tier: rider.riderType, offeredAt: now, expiresAt: new Date(now.getTime() + rules.dispatch.offerTimeoutSeconds * 1000) },
        });
        await notifyOffer(tx, { offerId: offer.id, riderUserId: rider.userId, orderId: d.order.id, restaurantName: d.order.restaurant.name, earningKobo: d.order.riderEarningKobo, cashKobo: d.cashToCollectKobo, ttlSeconds: rules.dispatch.offerTimeoutSeconds }, now);
        if (d.status !== 'OFFERING') await tx.delivery.update({ where: { id: d.id }, data: { status: 'OFFERING' } });
        await tx.deliveryEvent.create({ data: { deliveryId: d.id, riderId: c.id, type: 'OFFERED', createdAt: now } });
        return c.id;
      }

      // Nobody can take it now; the sweep's alertUnassigned() tells operations if this goes on.
      return null;
    });
  }

  /**
   * Immediate offer after an event (order accepted, offer declined, job released). Never throws:
   * the caller's action has already succeeded, and the periodic sweep retries anything missed.
   */
  async kick(deliveryId: string): Promise<void> {
    try {
      await this.offerNext(deliveryId);
    } catch (err) {
      this.logger?.error({ err, deliveryId }, 'dispatch kick failed');
    }
  }
}
