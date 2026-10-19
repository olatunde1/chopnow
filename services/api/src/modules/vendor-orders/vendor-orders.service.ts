import { REJECTION_REASONS } from '@chopnow/shared-schemas';
import type { Logger } from 'pino';
import type { Db, Tx } from '../../db/client.js';
import type { OrderStatus, Prisma } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import { lagosDate, lagosDayStartUtc } from '../../lib/lagos.js';
import { writeAudit, type RequestContext } from '../audit/audit.js';
import type { Principal } from '../auth/auth.service.js';
import { openDelivery, publicRider, publicRiderSelect, type DispatchService } from '../dispatch/dispatch.service.js';
import { closeUnfulfilledOrder } from '../orders/order-closure.js';
import { getBusinessRules } from '../settings/business-rules.js';
import { transitionOrder, type Actor } from '../orders/order-state.js';
import { notifyAccepted, notifyDelayed } from '../notifications/messages.js';

const VIEW_STATUSES: Record<'incoming' | 'active' | 'history', OrderStatus[]> = {
  incoming: ['PLACED'],
  active: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'],
  history: ['PICKED_UP', 'DELIVERED', 'CANCELLED', 'REJECTED', 'DELIVERY_EXCEPTION'],
};

const REJECTION_LABEL: Record<(typeof REJECTION_REASONS)[number], string> = {
  ITEM_UNAVAILABLE: 'An item is unavailable',
  TOO_BUSY: 'The restaurant is too busy',
  CLOSING_SOON: 'The restaurant is closing',
  CANNOT_DELIVER_AREA: 'The restaurant can’t serve this area',
  OTHER: 'Declined by the restaurant',
};

const vendorInclude = {
  customer: { select: { fullName: true } },
  items: { include: { extras: true }, orderBy: { id: 'asc' } },
  delivery: { select: publicRiderSelect },
} satisfies Prisma.OrderInclude;
type VendorOrderRow = Prisma.OrderGetPayload<{ include: typeof vendorInclude }>;


function actionsFor(status: OrderStatus) {
  if (status === 'PLACED') return ['accept', 'reject'] as const;
  if (status === 'ACCEPTED') return ['start_preparing', 'mark_ready', 'report_delay'] as const;
  if (status === 'PREPARING') return ['mark_ready', 'report_delay'] as const;
  return [] as const;
}

function toVendorDto(o: VendorOrderRow) {
  return {
    id: o.id,
    code: o.code,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    customerFirstName: o.customer.fullName.split(/\s+/)[0] ?? 'Customer',
    customerNote: o.customerNote,
    items: o.items.map((i) => ({
      name: i.nameSnapshot,
      variantName: i.variantNameSnapshot,
      quantity: i.quantity,
      specialInstructions: i.specialInstructions,
      extras: i.extras.map((e) => ({ name: e.nameSnapshot, quantity: e.quantity })),
      lineTotalKobo: i.lineTotalKobo,
    })),
    subtotalKobo: o.subtotalKobo,
    commissionKobo: o.commissionKobo,
    estimatedEarningsKobo: o.subtotalKobo - o.commissionKobo,
    placedAt: o.placedAt,
    acceptDeadlineAt: o.acceptDeadlineAt,
    acceptedAt: o.acceptedAt,
    estimatedReadyAt: o.estimatedReadyAt,
    readyAt: o.readyAt,
    cancellationReason: o.cancellationReason,
    deliveryStatus: o.delivery?.status ?? null,
    rider: publicRider(o.delivery),
    actions: [...actionsFor(o.status)],
  };
}

/**
 * The restaurant side of the order lifecycle. Restaurants only ever see orders that were sent to
 * them (`visibleToVendorAt` set: cash orders immediately, online orders once paid) for restaurants
 * they own. Each action re-checks the order's current state inside a transaction.
 */
export class VendorOrdersService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: Logger,
    private readonly dispatch?: DispatchService,
  ) {}

  private async ownRestaurant(principal: Principal, restaurantId: string) {
    const r = await this.db.restaurant.findFirst({ where: { id: restaurantId, ownerId: principal.userId } });
    if (!r) throw Errors.notFound('Restaurant');
    return r;
  }

  private visible(restaurantId: string): Prisma.OrderWhereInput {
    return { restaurantId, visibleToVendorAt: { not: null } };
  }

  async list(principal: Principal, restaurantId: string, q: { view: 'incoming' | 'active' | 'history'; page: number; pageSize: number; q?: string }) {
    await this.ownRestaurant(principal, restaurantId);
    const where: Prisma.OrderWhereInput = {
      ...this.visible(restaurantId),
      status: { in: VIEW_STATUSES[q.view] },
      ...(q.q ? { code: { contains: q.q.toUpperCase() } } : {}),
    };
    const [total, rows, incomingCount] = await Promise.all([
      this.db.order.count({ where }),
      this.db.order.findMany({
        where,
        include: vendorInclude,
        // Work queues oldest first; history newest first.
        orderBy: { placedAt: q.view === 'history' ? 'desc' : 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.order.count({ where: { ...this.visible(restaurantId), status: 'PLACED' } }),
    ]);
    return { items: rows.map(toVendorDto), page: q.page, pageSize: q.pageSize, total, incomingCount };
  }

  private async ownOrder(tx: Db | Tx, principal: Principal, restaurantId: string, orderId: string) {
    const o = await tx.order.findFirst({
      where: { id: orderId, ...this.visible(restaurantId), restaurant: { ownerId: principal.userId } },
      include: { ...vendorInclude, restaurant: { select: { prepTimeMinutes: true } } },
    });
    if (!o) throw Errors.notFound('Order');
    return o;
  }

  async get(principal: Principal, restaurantId: string, orderId: string) {
    return toVendorDto(await this.ownOrder(this.db, principal, restaurantId, orderId));
  }

  private actor(p: Principal): Actor {
    return { userId: p.userId, role: p.role };
  }

  async accept(principal: Principal, restaurantId: string, orderId: string, prepTimeMinutes?: number) {
    const deliveryId = await this.db.$transaction(async (tx) => {
      const o = await this.ownOrder(tx, principal, restaurantId, orderId);
      if (o.status !== 'PLACED') throw new AppError(409, 'ORDER_NOT_PENDING', 'This order is no longer waiting for acceptance.');
      if (o.acceptDeadlineAt && o.acceptDeadlineAt < this.now()) {
        throw new AppError(409, 'ACCEPT_DEADLINE_PASSED', 'The time to accept this order has passed. It will be cancelled and the customer told.');
      }
      const minutes = prepTimeMinutes ?? o.restaurant.prepTimeMinutes;
      await transitionOrder(tx, {
        orderId,
        from: 'PLACED',
        to: 'ACCEPTED',
        actor: this.actor(principal),
        data: { estimatedReadyAt: new Date(this.now().getTime() + minutes * 60_000) },
      });
      await notifyAccepted(tx, orderId, this.now());
      const rules = await getBusinessRules(tx);
      return rules.dispatch.startDispatchOn === 'ACCEPTED' ? openDelivery(tx, o, this.now()) : null;
    });
    if (deliveryId) await this.dispatch?.kick(deliveryId);
    return this.get(principal, restaurantId, orderId);
  }

  async reject(principal: Principal, restaurantId: string, orderId: string, reason: (typeof REJECTION_REASONS)[number], note: string | undefined, ctx: RequestContext) {
    await this.db.$transaction(async (tx) => {
      const o = await this.ownOrder(tx, principal, restaurantId, orderId);
      if (o.status !== 'PLACED') throw new AppError(409, 'ORDER_NOT_PENDING', 'Only orders waiting for acceptance can be declined.');
      const text = note ? `${REJECTION_LABEL[reason]}: ${note}` : REJECTION_LABEL[reason];
      const { refundRequested } = await closeUnfulfilledOrder(tx, { order: o, to: 'REJECTED', actor: this.actor(principal), reason: text });
      await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'order.reject', entityType: 'Order', entityId: orderId, after: { reason, note: note ?? null, refundRequested } }, ctx);
    });
    return this.get(principal, restaurantId, orderId);
  }

  async startPreparing(principal: Principal, restaurantId: string, orderId: string) {
    await this.db.$transaction(async (tx) => {
      const o = await this.ownOrder(tx, principal, restaurantId, orderId);
      await transitionOrder(tx, { orderId, from: o.status, to: 'PREPARING', actor: this.actor(principal) });
    });
    return this.get(principal, restaurantId, orderId);
  }

  /** Marks food ready. From ACCEPTED, records PREPARING first so the history stays complete. */
  async markReady(principal: Principal, restaurantId: string, orderId: string) {
    const deliveryId = await this.db.$transaction(async (tx) => {
      const o = await this.ownOrder(tx, principal, restaurantId, orderId);
      let from = o.status;
      if (from === 'ACCEPTED') {
        await transitionOrder(tx, { orderId, from, to: 'PREPARING', actor: this.actor(principal) });
        from = 'PREPARING';
      }
      await transitionOrder(tx, { orderId, from, to: 'READY_FOR_PICKUP', actor: this.actor(principal) });
      // Starts dispatch here when configured to wait for ready food (no-op if already started).
      return openDelivery(tx, o, this.now());
    });
    await this.dispatch?.kick(deliveryId);
    return this.get(principal, restaurantId, orderId);
  }

  /** Moves the estimated ready time later and records why. Does not change the status. */
  async reportDelay(principal: Principal, restaurantId: string, orderId: string, extraMinutes: number, note: string | undefined, ctx: RequestContext) {
    await this.db.$transaction(async (tx) => {
      const o = await this.ownOrder(tx, principal, restaurantId, orderId);
      if (o.status !== 'ACCEPTED' && o.status !== 'PREPARING') throw new AppError(409, 'ORDER_NOT_IN_KITCHEN', 'Delays can only be reported while the food is being prepared.');
      const base = Math.max(this.now().getTime(), o.estimatedReadyAt?.getTime() ?? 0);
      const next = new Date(base + extraMinutes * 60_000);
      const updated = await tx.order.updateMany({ where: { id: orderId, status: o.status }, data: { estimatedReadyAt: next } });
      if (updated.count !== 1) throw new AppError(409, 'ORDER_STATE_CHANGED', 'This order was updated by someone else. Refresh and try again.');
      await notifyDelayed(tx, orderId, this.now());
      await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'order.delay', entityType: 'Order', entityId: orderId, before: { estimatedReadyAt: o.estimatedReadyAt?.toISOString() ?? null }, after: { estimatedReadyAt: next.toISOString(), extraMinutes, note: note ?? null } }, ctx);
    });
    return this.get(principal, restaurantId, orderId);
  }

  /**
   * Rejects orders the restaurant did not accept before the deadline (customer is refunded if paid).
   * Safe to run on several instances: each order changes only if it is still PLACED.
   */
  async expireOverdue(limit = 50): Promise<number> {
    const overdue = await this.db.order.findMany({
      where: { status: 'PLACED', visibleToVendorAt: { not: null }, acceptDeadlineAt: { lt: this.now() } },
      select: { id: true, status: true, paymentStatus: true },
      take: limit,
    });
    let expired = 0;
    for (const o of overdue) {
      try {
        await this.db.$transaction((tx) => closeUnfulfilledOrder(tx, { order: o, to: 'REJECTED', actor: { userId: null, role: 'SYSTEM' }, reason: 'The restaurant did not respond in time' }));
        expired++;
      } catch (err) {
        // Accepted at the last moment, or handled by another instance: nothing to do.
        if (!(err instanceof AppError && err.code === 'ORDER_STATE_CHANGED')) this.logger?.error({ err, orderId: o.id }, 'failed to expire order');
      }
    }
    if (expired) this.logger?.info({ expired }, 'expired unaccepted orders');
    return expired;
  }

  async salesReport(principal: Principal, restaurantId: string, from: string, to: string) {
    await this.ownRestaurant(principal, restaurantId);
    const start = lagosDayStartUtc(from);
    const end = new Date(lagosDayStartUtc(to).getTime() + 86_400_000);
    const orders = await this.db.order.findMany({
      where: { ...this.visible(restaurantId), placedAt: { gte: start, lt: end } },
      include: { items: true, promotion: { select: { fundedBy: true } } },
    });
    const delivered = orders.filter((o) => o.status === 'DELIVERED');
    const gross = delivered.reduce((s, o) => s + o.subtotalKobo, 0);
    const commission = delivered.reduce((s, o) => s + o.commissionKobo, 0);
    const restaurantFunded = delivered.filter((o) => o.promotion?.fundedBy === 'RESTAURANT').reduce((s, o) => s + o.discountKobo, 0);

    const days = new Map<string, { orders: number; grossFoodSalesKobo: number }>();
    for (let t = start.getTime(); t < end.getTime(); t += 86_400_000) days.set(lagosDate(new Date(t)), { orders: 0, grossFoodSalesKobo: 0 });
    const items = new Map<string, { quantity: number; salesKobo: number }>();
    for (const o of delivered) {
      const d = days.get(lagosDate(o.placedAt));
      if (d) {
        d.orders++;
        d.grossFoodSalesKobo += o.subtotalKobo;
      }
      for (const i of o.items) {
        const it = items.get(i.nameSnapshot) ?? { quantity: 0, salesKobo: 0 };
        it.quantity += i.quantity;
        it.salesKobo += i.lineTotalKobo;
        items.set(i.nameSnapshot, it);
      }
    }
    return {
      from,
      to,
      deliveredOrders: delivered.length,
      cancelledOrders: orders.filter((o) => o.status === 'CANCELLED').length,
      rejectedOrders: orders.filter((o) => o.status === 'REJECTED').length,
      grossFoodSalesKobo: gross,
      commissionKobo: commission,
      restaurantFundedDiscountKobo: restaurantFunded,
      estimatedNetKobo: gross - commission - restaurantFunded,
      averageOrderKobo: delivered.length ? Math.round(gross / delivered.length) : 0,
      days: [...days.entries()].map(([date, v]) => ({ date, ...v })),
      topItems: [...items.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.salesKobo - a.salesKobo)
        .slice(0, 10),
    };
  }
}
