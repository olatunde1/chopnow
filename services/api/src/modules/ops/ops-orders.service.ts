import { hasPermission } from '@chopnow/shared-schemas';
import type { Db, Tx } from '../../db/client.js';
import { Prisma, type OrderStatus } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import { lagosDate, lagosDayStartUtc } from '../../lib/lagos.js';
import { writeAudit, type RequestContext } from '../audit/audit.js';
import type { Principal } from '../auth/auth.service.js';
import { ACTIVE_DELIVERY_STATUSES, RIDER_HEARTBEAT_MS, outstandingCashByRider, type DispatchService } from '../dispatch/dispatch.service.js';
import { finalizeDelivery } from '../dispatch/finalize-delivery.js';
import { closeUnfulfilledOrder } from '../orders/order-closure.js';
import { transitionOrder } from '../orders/order-state.js';
import { getBusinessRules } from '../settings/business-rules.js';
import { notifyRiderAssigned, notifyRiderJobChange } from '../notifications/messages.js';

const CANCELLABLE: OrderStatus[] = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'DELIVERY_EXCEPTION'];
const REFUNDABLE: OrderStatus[] = ['DELIVERED', 'DELIVERY_EXCEPTION', 'CANCELLED', 'REJECTED'];
/** An order waiting this long for a restaurant or rider is flagged for attention. */
const SLOW_MS = 20 * 60_000;

const listInclude = {
  restaurant: { select: { name: true } },
  customer: { select: { fullName: true } },
  delivery: { select: { status: true, dispatchAlertAt: true, currentRider: { select: { user: { select: { fullName: true } } } } } },
} satisfies Prisma.OrderInclude;

const detailInclude = {
  ...listInclude,
  customer: { select: { id: true, fullName: true, email: true, phone: true } },
  restaurant: { select: { id: true, name: true, phone: true, area: true } },
  items: { include: { extras: true }, orderBy: { id: 'asc' } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
  promotion: { select: { code: true } },
  cashCollection: true,
  delivery: {
    include: {
      currentRider: { include: { user: { select: { id: true, fullName: true, email: true, phone: true } } } },
      events: { orderBy: { createdAt: 'asc' }, include: { rider: { select: { user: { select: { fullName: true } } } } } },
      _count: { select: { offers: true } },
    },
  },
} satisfies Prisma.OrderInclude;
type DetailRow = Prisma.OrderGetPayload<{ include: typeof detailInclude }>;

function needsAttention(o: { status: OrderStatus; placedAt: Date; acceptedAt: Date | null; delivery: { dispatchAlertAt: Date | null } | null }, now: Date) {
  if (o.status === 'DELIVERY_EXCEPTION' || o.delivery?.dispatchAlertAt) return true;
  if (o.status === 'PLACED' && now.getTime() - o.placedAt.getTime() > SLOW_MS) return true;
  return false;
}

/**
 * Operations on orders: dashboard, search, full detail, and the fixes staff make when something
 * goes wrong (cancel with refund, retry a failed delivery, confirm delivery without the PIN). Every
 * change requires a reason and is audited; state changes are conditional so they can't race riders
 * or restaurants.
 */
export class OpsOrdersService {
  constructor(
    private readonly db: Db,
    private readonly dispatch: DispatchService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dashboard() {
    const now = this.now();
    const start = lagosDayStartUtc(lagosDate(now));
    const today = { placedAt: { gte: start } };
    const [placed, delivered, cancelled, gov, deliveredRows, byStatus, alerts, online, busy, open, rApprovals, dApprovals, docs, refunds, remittances] = await Promise.all([
      this.db.order.count({ where: today }),
      this.db.order.count({ where: { ...today, status: 'DELIVERED' } }),
      this.db.order.count({ where: { ...today, status: { in: ['CANCELLED', 'REJECTED'] } } }),
      this.db.order.aggregate({ where: { ...today, status: 'DELIVERED' }, _sum: { totalKobo: true } }),
      this.db.order.findMany({ where: { ...today, status: 'DELIVERED', deliveredAt: { not: null } }, select: { placedAt: true, deliveredAt: true } }),
      this.db.order.groupBy({ by: ['status'], where: { status: { in: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERY_EXCEPTION'] }, visibleToVendorAt: { not: null } }, _count: { _all: true } }),
      this.db.delivery.count({ where: { status: { in: ['UNASSIGNED', 'OFFERING'] }, dispatchAlertAt: { not: null }, order: { status: { in: ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'] } } } }),
      this.db.rider.count({ where: { availability: 'ONLINE', lastSeenAt: { gte: new Date(now.getTime() - RIDER_HEARTBEAT_MS) } } }),
      this.db.delivery.count({ where: { status: { in: [...ACTIVE_DELIVERY_STATUSES] } } }),
      this.db.restaurant.count({ where: { verificationStatus: 'APPROVED', isAcceptingOrders: true } }),
      this.db.restaurant.count({ where: { verificationStatus: 'PENDING' } }),
      this.db.rider.count({ where: { verificationStatus: 'PENDING' } }),
      this.db.verificationDocument.count({ where: { status: 'PENDING' } }),
      this.db.refund.count({ where: { status: 'REQUESTED' } }),
      this.db.cashRemittance.count({ where: { status: 'PENDING_CONFIRMATION' } }),
    ]);
    const count = (s: OrderStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const awaitingRider = await this.db.delivery.count({ where: { status: { in: ['UNASSIGNED', 'OFFERING'] }, order: { status: { in: ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'] } } } });
    const minutes = deliveredRows.map((o) => (o.deliveredAt!.getTime() - o.placedAt.getTime()) / 60_000);
    return {
      today: {
        ordersPlaced: placed,
        ordersDelivered: delivered,
        ordersCancelled: cancelled,
        grossOrderValueKobo: gov._sum.totalKobo ?? 0,
        averageDeliveryMinutes: minutes.length ? Math.round(minutes.reduce((s, m) => s + m, 0) / minutes.length) : null,
      },
      live: {
        awaitingRestaurant: count('PLACED'),
        inKitchen: count('ACCEPTED') + count('PREPARING'),
        awaitingRider,
        onTheWay: count('PICKED_UP'),
        exceptions: count('DELIVERY_EXCEPTION'),
        dispatchAlerts: alerts,
        ridersOnline: online,
        ridersBusy: busy,
        restaurantsOpen: open,
      },
      queues: { restaurantApprovals: rApprovals, riderApprovals: dApprovals, documentsToReview: docs, refundRequests: refunds, remittancesToConfirm: remittances },
    };
  }

  async list(q: { page: number; pageSize: number; status?: OrderStatus; q?: string; restaurantId?: string; attention?: 'true' | 'false' }) {
    const now = this.now();
    const term = q.q?.trim();
    const where: Prisma.OrderWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.restaurantId ? { restaurantId: q.restaurantId } : {}),
      ...(term
        ? { OR: [{ code: { contains: term.toUpperCase() } }, { customer: { email: { contains: term.toLowerCase() } } }, { customer: { phone: { contains: term.replace(/\s/g, '') } } }] }
        : {}),
      ...(q.attention === 'true'
        ? { OR: [{ status: 'DELIVERY_EXCEPTION' }, { delivery: { dispatchAlertAt: { not: null }, status: { in: ['UNASSIGNED', 'OFFERING'] } } }, { status: 'PLACED', visibleToVendorAt: { not: null }, placedAt: { lt: new Date(now.getTime() - SLOW_MS) } }] }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.db.order.count({ where }),
      this.db.order.findMany({ where, include: listInclude, orderBy: { placedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      page: q.page,
      pageSize: q.pageSize,
      total,
      items: rows.map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        totalKobo: o.totalKobo,
        placedAt: o.placedAt,
        restaurantName: o.restaurant.name,
        customerName: o.customer.fullName,
        deliveryStatus: o.delivery?.status ?? null,
        riderName: o.delivery?.currentRider?.user.fullName ?? null,
        needsAttention: needsAttention(o, now),
      })),
    };
  }

  private async load(db: Db | Tx, orderId: string) {
    const o = await db.order.findUnique({ where: { id: orderId }, include: detailInclude });
    if (!o) throw Errors.notFound('Order');
    return o;
  }

  private actionsFor(o: DetailRow, principal: Principal) {
    const actions: ('cancel' | 'retry_delivery' | 'confirm_delivered' | 'request_refund')[] = [];
    if (hasPermission(principal.role, 'order.manage.any')) {
      if (CANCELLABLE.includes(o.status)) actions.push('cancel');
      if (o.status === 'DELIVERY_EXCEPTION') actions.push('retry_delivery');
      if ((o.status === 'PICKED_UP' || o.status === 'DELIVERY_EXCEPTION') && o.delivery?.pickedUpAt) actions.push('confirm_delivered');
    }
    if (hasPermission(principal.role, 'refund.request') && REFUNDABLE.includes(o.status) && o.paymentStatus !== 'PENDING' && o.paymentStatus !== 'FAILED') actions.push('request_refund');
    return actions;
  }

/** The order's ledger journals, its money split, and the settlements that cover its proceeds. */
  private async financialHistory(o: DetailRow) {
    const journals = await this.db.financialTransaction.findMany({
      where: { orderId: o.id },
      orderBy: { createdAt: 'asc' },
      include: { entries: { include: { restaurant: { select: { name: true } }, rider: { select: { user: { select: { fullName: true } } } } } } },
    });
    const settled = journals.find((j) => j.type === 'ORDER_SETTLED');
    const net = (account: string) => settled?.entries.filter((e) => e.account === account).reduce((sum, e) => sum + (e.direction === 'CREDIT' ? e.amountKobo : -e.amountKobo), 0) ?? 0;
    const riderId = settled?.entries.find((e) => e.account === 'RIDER_PAYABLE')?.riderId ?? null;
    const covering = { status: { notIn: ['CANCELLED' as const] }, ...(settled ? { periodStart: { lte: settled.createdAt }, periodEnd: { gt: settled.createdAt } } : {}) };
    const [vs, rs] = settled
      ? await Promise.all([
          this.db.vendorSettlement.findFirst({ where: { restaurantId: o.restaurantId, ...covering } }),
          riderId ? this.db.riderSettlement.findFirst({ where: { riderId, ...covering } }) : null,
        ])
      : [null, null];
    const period = (x: { id: string; periodStart: Date; periodEnd: Date; status: string } | null) =>
      x ? { id: x.id, from: lagosDate(x.periodStart), to: lagosDate(new Date(x.periodEnd.getTime() - 1)), status: x.status } : null;
    return {
      journals: journals.map((j) => ({
        id: j.id,
        type: j.type,
        description: j.description,
        at: j.createdAt,
        lines: j.entries.map((e) => ({ account: e.account, direction: e.direction, amountKobo: e.amountKobo, party: e.restaurant?.name ?? e.rider?.user.fullName ?? null })),
      })),
      split: settled
        ? {
            restaurantKobo: net('VENDOR_PAYABLE'),
            riderKobo: net('RIDER_PAYABLE'),
            platformRevenueKobo: net('PLATFORM_COMMISSION_REVENUE') + net('PLATFORM_DELIVERY_REVENUE') + net('PLATFORM_SERVICE_FEE_REVENUE'),
            platformPromotionCostKobo: -net('PROMOTION_EXPENSE'),
          }
        : null,
      restaurantSettlement: period(vs),
      riderSettlement: period(rs),
    };
  }

  async get(principal: Principal, orderId: string) {
    const o = await this.load(this.db, orderId);
    const now = this.now();
    const d = o.delivery;
    const rider = d?.currentRider;
    return {
      id: o.id,
      code: o.code,
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      totalKobo: o.totalKobo,
      placedAt: o.placedAt,
      restaurantName: o.restaurant.name,
      customerName: o.customer.fullName,
      deliveryStatus: d?.status ?? null,
      riderName: rider?.user.fullName ?? null,
      needsAttention: needsAttention(o, now),
      customer: o.customer,
      restaurant: o.restaurant,
      items: o.items.map((i) => ({ name: i.nameSnapshot, variantName: i.variantNameSnapshot, quantity: i.quantity, lineTotalKobo: i.lineTotalKobo, extras: i.extras.map((e) => (e.quantity > 1 ? `${e.quantity}× ${e.nameSnapshot}` : e.nameSnapshot)), specialInstructions: i.specialInstructions })),
      subtotalKobo: o.subtotalKobo,
      deliveryFeeKobo: o.deliveryFeeKobo,
      serviceFeeKobo: o.serviceFeeKobo,
      discountKobo: o.discountKobo,
      commissionKobo: o.commissionKobo,
      riderEarningKobo: o.riderEarningKobo,
      promotionCode: o.promotion?.code ?? null,
      deliveryAddress: o.deliveryAddress as Record<string, unknown>,
      customerNote: o.customerNote,
      cancellationReason: o.cancellationReason,
      deliveryPin: hasPermission(principal.role, 'order.manage.any') ? o.deliveryPin : null,
      timeline: o.statusHistory.map((h) => ({ from: h.fromStatus, to: h.toStatus, at: h.createdAt, actorRole: h.actorRole, reason: h.reason })),
      payments: o.payments.map((p) => ({ id: p.id, reference: p.reference, provider: p.provider, status: p.status, amountKobo: p.amountKobo, failureReason: p.failureReason, createdAt: p.createdAt })),
      refunds: o.refunds.map((r) => ({ id: r.id, amountKobo: r.amountKobo, status: r.status, reason: r.reason, chargeTo: r.chargeTo, createdAt: r.createdAt })),
      delivery: d
        ? {
            id: d.id,
            status: d.status,
            rider: rider ? { ...rider.user, riderId: rider.id, vehicleType: rider.vehicleType } : null,
            dispatchStartedAt: d.dispatchStartedAt,
            dispatchAlertAt: d.dispatchAlertAt,
            offersMade: d._count.offers,
            pinFailedAttempts: d.pinFailedAttempts,
            failureReason: d.failureReason,
            proofOverrideReason: d.proofOverrideReason,
            events: d.events.map((e) => ({ type: e.type, at: e.createdAt, riderName: e.rider?.user.fullName ?? null, note: e.note })),
          }
        : null,
      cash: o.cashCollection ? { dueKobo: o.cashCollection.amountDueKobo, collectedKobo: o.cashCollection.amountCollectedKobo, status: o.cashCollection.status, reconciliationStatus: o.cashCollection.reconciliationStatus } : null,
      financialHistory: await this.financialHistory(o),
      actions: this.actionsFor(o, principal),
    };
  }

  /** Cancels an order that won't be delivered; paid orders get a refund request, offers are withdrawn. */
  async cancel(principal: Principal, orderId: string, reason: string, ctx: RequestContext) {
    await this.db.$transaction(async (tx) => {
      const o = await this.load(tx, orderId);
      if (!CANCELLABLE.includes(o.status)) throw new AppError(409, 'ORDER_NOT_CANCELLABLE', o.status === 'PICKED_UP' ? 'The rider has the food. Wait for delivery or a reported problem.' : 'This order can no longer be cancelled.');
      const { refundRequested } = await closeUnfulfilledOrder(tx, { order: o, to: 'CANCELLED', actor: { userId: principal.userId, role: principal.role }, reason: `Cancelled by ChopNow: ${reason}` });
      await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'order.cancel_by_staff', entityType: 'Order', entityId: orderId, before: { status: o.status }, after: { reason, refundRequested } }, ctx);
    });
    return this.get(principal, orderId);
  }

  /**
   * Resolves a delivery problem by trying again: the same rider (still holding the food) goes back
   * to "picked up", or the job returns to dispatch for a new rider (food back at the restaurant).
   */
  async retryDelivery(principal: Principal, orderId: string, mode: 'SAME_RIDER' | 'NEW_RIDER', reason: string, ctx: RequestContext) {
    const now = this.now();
    let deliveryId: string | null = null;
    try {
      await this.db.$transaction(async (tx) => {
        const o = await this.load(tx, orderId);
        const d = o.delivery;
        if (o.status !== 'DELIVERY_EXCEPTION' || !d || d.status !== 'FAILED') throw new AppError(409, 'NOT_A_DELIVERY_PROBLEM', 'Only orders with a reported delivery problem can be retried.');
        deliveryId = d.id;
        if (mode === 'SAME_RIDER') {
          if (!d.currentRiderId) throw new AppError(409, 'NO_RIDER', 'There is no rider to retry with.');
          await tx.delivery.update({ where: { id: d.id }, data: { status: 'PICKED_UP', failedAt: null, failureReason: null, pinFailedAttempts: 0 } });
          await transitionOrder(tx, { orderId, from: 'DELIVERY_EXCEPTION', to: 'PICKED_UP', actor: { userId: principal.userId, role: principal.role }, reason });
        } else {
          await tx.delivery.update({
            where: { id: d.id },
            data: { status: 'OFFERING', currentRiderId: null, assignedAt: null, arrivedAtRestaurantAt: null, pickedUpAt: null, failedAt: null, failureReason: null, pinFailedAttempts: 0, dispatchStartedAt: now, dispatchAlertAt: null, widenedAt: null },
          });
          await tx.deliveryOffer.updateMany({ where: { deliveryId: d.id, status: 'ACCEPTED' }, data: { status: 'RELEASED' } });
          await transitionOrder(tx, { orderId, from: 'DELIVERY_EXCEPTION', to: 'READY_FOR_PICKUP', actor: { userId: principal.userId, role: principal.role }, reason });
        }
        await tx.cashCollection.updateMany({ where: { deliveryId: d.id, status: 'NOT_COLLECTED' }, data: { status: 'PENDING', ...(mode === 'NEW_RIDER' ? { riderId: null } : {}) } });
        await tx.deliveryEvent.create({ data: { deliveryId: d.id, riderId: mode === 'SAME_RIDER' ? d.currentRiderId : null, actorUserId: principal.userId, type: mode === 'SAME_RIDER' ? 'RETRY_SAME_RIDER' : 'REDISPATCHED', note: reason, createdAt: now } });
        await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'order.retry_delivery', entityType: 'Order', entityId: orderId, after: { mode, reason } }, ctx);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new AppError(409, 'RIDER_BUSY', 'That rider is already on another delivery. Send it to a new rider instead.');
      throw err;
    }
    if (mode === 'NEW_RIDER' && deliveryId) await this.dispatch.kick(deliveryId);
    return this.get(principal, orderId);
  }

  /** Delivered without the PIN (e.g. PIN locked, customer confirmed by phone). Requires a reason. */
  async confirmDelivered(principal: Principal, orderId: string, reason: string, cashCollectedKobo: number | undefined, ctx: RequestContext) {
    const rules = await getBusinessRules(this.db);
    await this.db.$transaction(async (tx) => {
      const o = await this.load(tx, orderId);
      const d = o.delivery;
      if ((o.status !== 'PICKED_UP' && o.status !== 'DELIVERY_EXCEPTION') || !d?.pickedUpAt) throw new AppError(409, 'NOT_OUT_FOR_DELIVERY', 'Only orders that have been picked up can be confirmed as delivered.');
      const cash = o.cashCollection;
      let collected = 0;
      if (cash) {
        if (cashCollectedKobo === undefined) throw Errors.validation([{ in: 'body', path: 'cashCollectedKobo', message: 'Enter the cash the rider received' }]);
        if (cashCollectedKobo > cash.amountDueKobo || (cashCollectedKobo < cash.amountDueKobo && !rules.cashOnDelivery.allowPartialCollection) || cashCollectedKobo === 0) {
          throw new AppError(422, 'CASH_AMOUNT_INVALID', 'The cash recorded must equal the amount due. If the customer did not pay, cancel the order instead.');
        }
        collected = cashCollectedKobo;
      } else if (cashCollectedKobo) throw new AppError(422, 'NO_CASH_DUE', 'This order was paid online.');
      await finalizeDelivery(tx, {
        delivery: d,
        order: o,
        cash: cash ? { id: cash.id, amountDueKobo: cash.amountDueKobo } : null,
        collectedKobo: collected,
        actor: { userId: principal.userId, role: principal.role },
        at: this.now(),
        proof: { kind: 'override', byUserId: principal.userId, reason },
        fromDeliveryStatuses: ['PICKED_UP', 'FAILED'],
      });
      await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'delivery.proof_override', entityType: 'Delivery', entityId: d.id, after: { orderCode: o.code, reason, cashCollectedKobo: cash ? collected : null } }, ctx);
    });
    return this.get(principal, orderId);
  }

  // ───────── Dispatch board ─────────

  async dispatchBoard() {
    const now = this.now();
    const [waiting, active, riders] = await Promise.all([
      this.db.delivery.findMany({
        where: { status: { in: ['UNASSIGNED', 'OFFERING'] }, order: { status: { in: ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'] } } },
        include: { order: { select: { id: true, code: true, status: true, deliveryAddress: true, restaurant: { select: { name: true } } } }, offers: { include: { rider: { select: { user: { select: { fullName: true } } } } } } },
        orderBy: { dispatchStartedAt: 'asc' },
      }),
      this.db.delivery.findMany({
        where: { status: { in: [...ACTIVE_DELIVERY_STATUSES] } },
        include: { order: { select: { id: true, code: true, deliveryAddress: true, restaurant: { select: { name: true } } } }, currentRider: { include: { user: { select: { fullName: true, phone: true } } } } },
        orderBy: { assignedAt: 'asc' },
      }),
      this.db.rider.findMany({ where: { verificationStatus: 'APPROVED', user: { status: 'ACTIVE' } }, include: { user: { select: { fullName: true } }, deliveries: { where: { status: { in: [...ACTIVE_DELIVERY_STATUSES] } }, select: { id: true } } }, orderBy: { lastSeenAt: { sort: 'desc', nulls: 'last' } } }),
    ]);
    const cash = await outstandingCashByRider(this.db, riders.map((r) => r.id));
    const area = (a: unknown) => String((a as { area?: string })?.area ?? '');
    return {
      waiting: waiting.map((d) => {
        const pending = d.offers.find((o) => o.status === 'PENDING' && o.expiresAt > now);
        return {
          deliveryId: d.id, orderId: d.order.id, orderCode: d.order.code, orderStatus: d.order.status, restaurantName: d.order.restaurant.name, dropoffArea: area(d.order.deliveryAddress),
          cashToCollectKobo: d.cashToCollectKobo, waitingSeconds: Math.round((now.getTime() - (d.dispatchStartedAt ?? d.createdAt).getTime()) / 1000),
          offersMade: d.offers.length, pendingOfferTo: pending?.rider.user.fullName ?? null, alerted: !!d.dispatchAlertAt,
        };
      }),
      active: active.map((d) => ({
        deliveryId: d.id, orderId: d.order.id, orderCode: d.order.code, status: d.status, restaurantName: d.order.restaurant.name, dropoffArea: area(d.order.deliveryAddress),
        riderId: d.currentRiderId!, riderName: d.currentRider!.user.fullName, riderPhone: d.currentRider!.user.phone, assignedAt: d.assignedAt, pickedUpAt: d.pickedUpAt,
      })),
      riders: riders
        .filter((r) => r.availability === 'ONLINE' || r.deliveries.length > 0)
        .map((r) => ({
          riderId: r.id, name: r.user.fullName, riderType: r.riderType, vehicleType: r.vehicleType, availability: r.availability,
          reachable: !!r.lastSeenAt && now.getTime() - r.lastSeenAt.getTime() < RIDER_HEARTBEAT_MS, lastSeenAt: r.lastSeenAt, busy: r.deliveries.length > 0, outstandingCashKobo: cash.get(r.id) ?? 0,
        })),
    };
  }

  /** Gives a waiting delivery to a specific rider (e.g. agreed by phone). */
  async assign(principal: Principal, deliveryId: string, riderId: string, reason: string, ctx: RequestContext) {
    const now = this.now();
    try {
      await this.db.$transaction(async (tx) => {
        const rider = await tx.rider.findUnique({ where: { id: riderId }, include: { user: { select: { status: true, fullName: true } } } });
        if (!rider) throw Errors.notFound('Rider');
        if (rider.verificationStatus !== 'APPROVED' || rider.user.status !== 'ACTIVE') throw new AppError(409, 'RIDER_NOT_APPROVED', 'Only approved, active riders can be assigned.');
        const moved = await tx.delivery.updateMany({ where: { id: deliveryId, status: { in: ['UNASSIGNED', 'OFFERING'] }, currentRiderId: null }, data: { status: 'ASSIGNED', currentRiderId: riderId, assignedAt: now } });
        if (moved.count !== 1) {
          if (!(await tx.delivery.findUnique({ where: { id: deliveryId } }))) throw Errors.notFound('Delivery');
          throw new AppError(409, 'DELIVERY_NOT_WAITING', 'This delivery already has a rider.');
        }
        await tx.deliveryOffer.updateMany({ where: { deliveryId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: now } });
        await tx.deliveryOffer.create({ data: { deliveryId, riderId, tier: rider.riderType, status: 'ACCEPTED', offeredAt: now, expiresAt: new Date(now.getTime() + 1000), respondedAt: now } });
        await tx.cashCollection.updateMany({ where: { deliveryId }, data: { riderId } });
        await tx.deliveryEvent.create({ data: { deliveryId, riderId, actorUserId: principal.userId, type: 'ASSIGNED_BY_STAFF', note: reason, createdAt: now } });
        const job = await tx.delivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { order: { select: { id: true, code: true } } } });
        await notifyRiderJobChange(tx, rider.userId, job.order.id, 'assigned', job.order.code, now);
        await notifyRiderAssigned(tx, job.order.id, now);
        await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'dispatch.assign', entityType: 'Delivery', entityId: deliveryId, after: { riderId, riderName: rider.user.fullName, reason } }, ctx);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new AppError(409, 'RIDER_BUSY', 'That rider is already on another delivery.');
      throw err;
    }
    return this.dispatchBoard();
  }

  /** Takes a delivery away from its rider before pickup and sends it back to dispatch. */
  async unassign(principal: Principal, deliveryId: string, reason: string, ctx: RequestContext) {
    const now = this.now();
    await this.db.$transaction(async (tx) => {
      const d = await tx.delivery.findUnique({ where: { id: deliveryId } });
      if (!d) throw Errors.notFound('Delivery');
      const moved = await tx.delivery.updateMany({ where: { id: deliveryId, status: { in: ['ASSIGNED', 'ARRIVED_AT_RESTAURANT'] } }, data: { status: 'OFFERING', currentRiderId: null, assignedAt: null, arrivedAtRestaurantAt: null } });
      if (moved.count !== 1) throw new AppError(409, 'CANNOT_UNASSIGN', 'Only deliveries not yet picked up can be taken back.');
      await tx.deliveryOffer.updateMany({ where: { deliveryId, status: 'ACCEPTED' }, data: { status: 'RELEASED' } });
      await tx.cashCollection.updateMany({ where: { deliveryId }, data: { riderId: null } });
      await tx.deliveryEvent.create({ data: { deliveryId, riderId: d.currentRiderId, actorUserId: principal.userId, type: 'UNASSIGNED_BY_STAFF', note: reason, createdAt: now } });
      const job = await tx.delivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { order: { select: { id: true, code: true } }, offers: { where: { status: 'RELEASED' }, orderBy: { offeredAt: 'desc' }, take: 1, select: { rider: { select: { userId: true } } } } } });
      const riderUserId = job.offers[0]?.rider.userId;
      if (riderUserId) await notifyRiderJobChange(tx, riderUserId, job.order.id, 'removed', job.order.code, now);
      await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'dispatch.unassign', entityType: 'Delivery', entityId: deliveryId, before: { riderId: d.currentRiderId }, after: { reason } }, ctx);
    });
    await this.dispatch.kick(deliveryId);
    return this.dispatchBoard();
  }
}
