import { TERMINAL_ORDER_STATUSES, type OrderRequest } from '@chopnow/shared-schemas';
import { isOpenAt } from '@chopnow/shared-utils';
import type { Db, Tx } from '../../db/client.js';
import { Prisma, type OrderStatus } from '../../generated/prisma/client.js';
import { generateDeliveryPin, generateOrderCode } from '../../lib/codes.js';
import { AppError, Errors } from '../../lib/errors.js';
import { withIdempotency } from '../../lib/idempotency.js';
import { writeAudit, type RequestContext } from '../audit/audit.js';
import type { Principal } from '../auth/auth.service.js';
import { publicRider, publicRiderSelect } from '../dispatch/dispatch.service.js';
import { closeUnfulfilledOrder } from './order-closure.js';
import { buildQuote } from './quote.js';
import { notifyNewOrder } from '../notifications/messages.js';

export const orderInclude = {
  restaurant: { select: { id: true, name: true, slug: true, phone: true } },
  items: { include: { extras: true }, orderBy: { id: 'asc' } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
  review: { select: { id: true } },
  delivery: { select: publicRiderSelect },
} satisfies Prisma.OrderInclude;

/** Customers can review a delivered order once, within this many days. */
export const REVIEW_WINDOW_DAYS = 14;

type OrderFull = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function toCustomerOrder(o: OrderFull) {
  const payment = o.payments[0] ?? null;
  return {
    id: o.id,
    code: o.code,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    totalKobo: o.totalKobo,
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    restaurant: { id: o.restaurant.id, name: o.restaurant.name, slug: o.restaurant.slug },
    placedAt: o.placedAt,
    items: o.items.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      name: i.nameSnapshot,
      variantName: i.variantNameSnapshot,
      unitPriceKobo: i.unitPriceKobo,
      quantity: i.quantity,
      lineTotalKobo: i.lineTotalKobo,
      specialInstructions: i.specialInstructions,
      extras: i.extras.map((e) => ({ name: e.nameSnapshot, unitPriceKobo: e.unitPriceKobo, quantity: e.quantity })),
    })),
    subtotalKobo: o.subtotalKobo,
    deliveryFeeKobo: o.deliveryFeeKobo,
    serviceFeeKobo: o.serviceFeeKobo,
    discountKobo: o.discountKobo,
    deliveryAddress: o.deliveryAddress as { label: string; line1: string; area: string; city: string },
    customerNote: o.customerNote,
    deliveryPin: o.deliveryPin,
    restaurantPhone: o.restaurant.phone,
    timeline: o.statusHistory.map((h) => ({ status: h.toStatus, at: h.createdAt, reason: h.reason })),
    payment: payment && { reference: payment.reference, status: payment.status, provider: payment.provider, isTestPayment: payment.provider === 'MOCK' },
    sentToRestaurant: o.visibleToVendorAt !== null,
    canCancel: o.status === 'PLACED',
    canPay: o.paymentMethod === 'ONLINE' && o.status === 'PLACED' && (o.paymentStatus === 'PENDING' || o.paymentStatus === 'FAILED'),
    cancellationReason: o.cancellationReason,
    estimatedReadyAt: o.estimatedReadyAt,
    canReview:
      o.status === 'DELIVERED' && !o.review && !!o.deliveredAt && Date.now() - o.deliveredAt.getTime() < REVIEW_WINDOW_DAYS * 86_400_000,
    deliveryStatus: o.delivery?.status ?? null,
    rider: publicRider(o.delivery),
  };
}

/**
 * Customer-side ordering: quote, place, view, cancel and reorder. Every order lookup includes the
 * caller's id so customers can only see their own orders.
 */
export class OrdersService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async quote(principal: Principal, input: OrderRequest) {
    return (await buildQuote(this.db, principal.userId, input, this.now())).quote;
  }

  /**
   * Places an order. Safe to retry: the same Idempotency-Key returns the same order instead of
   * creating another one. All amounts are recomputed inside the transaction.
   */
  async create(principal: Principal, input: OrderRequest, idempotencyKey: string) {
    const result = await withIdempotency(
      this.db,
      { userId: principal.userId, scope: 'orders.create', key: idempotencyKey, request: input },
      async () => ({ status: 201, body: await this.createOnce(principal, input, idempotencyKey) }),
    );
    return result;
  }

  private async createOnce(principal: Principal, input: OrderRequest, idempotencyKey: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const orderId = await this.db.$transaction(async (tx) => this.insertOrder(tx, principal, input, idempotencyKey), { timeout: 15_000 });
        return this.get(principal, orderId);
      } catch (err) {
        // Order codes are random; on the rare collision, try again with a new code.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 2) continue;
        throw err;
      }
    }
    throw new Error('unreachable');
  }

  private async insertOrder(tx: Tx, principal: Principal, input: OrderRequest, idempotencyKey: string): Promise<string> {
    const now = this.now();
    // Serialise redemptions of a limited promotion so its usage limit cannot be overshot.
    if (input.promoCode) await tx.$queryRaw`SELECT id FROM promotions WHERE code = ${input.promoCode} FOR UPDATE`;

    const { quote, forCreate } = await buildQuote(tx, principal.userId, input, now);
    if (!quote.canPlaceOrder) {
      throw new AppError(422, 'ORDER_NOT_PLACEABLE', quote.problems[0]?.message ?? 'This order can’t be placed.', quote.problems);
    }

    const isCash = input.paymentMethod === 'CASH_ON_DELIVERY';
    const a = forCreate.address;
    const order = await tx.order.create({
      data: {
        code: generateOrderCode(),
        customerId: principal.userId,
        restaurantId: quote.restaurant.id,
        addressId: a.id,
        deliveryAddress: { label: a.label, line1: a.line1, line2: a.line2, area: a.area, city: a.city, landmark: a.landmark, contactPhone: a.contactPhone, instructions: a.instructions },
        deliveryLatitude: a.latitude,
        deliveryLongitude: a.longitude,
        status: 'PLACED',
        paymentMethod: input.paymentMethod,
        paymentStatus: 'PENDING',
        subtotalKobo: quote.subtotalKobo,
        deliveryFeeKobo: quote.deliveryFeeKobo,
        serviceFeeKobo: quote.serviceFeeKobo,
        discountKobo: quote.discountKobo,
        totalKobo: quote.totalKobo,
        commissionBps: forCreate.commissionBps,
        commissionKobo: forCreate.commissionKobo,
        riderEarningKobo: forCreate.riderEarningKobo,
        promotionId: forCreate.promotionId,
        customerNote: input.customerNote || null,
        deliveryPin: generateDeliveryPin(),
        idempotencyKey,
        // Cash orders go to the restaurant now; online orders only once payment is verified.
        visibleToVendorAt: isCash ? now : null,
        acceptDeadlineAt: isCash ? new Date(now.getTime() + forCreate.rules.orders.vendorAcceptTimeoutSeconds * 1000) : null,
        placedAt: now,
        items: {
          create: forCreate.lines.map((l) => ({
            menuItemId: l.menuItemId,
            variantId: l.variantId,
            nameSnapshot: l.name,
            variantNameSnapshot: l.variantName,
            unitPriceKobo: l.unitPriceKobo,
            quantity: l.quantity,
            lineTotalKobo: l.lineTotalKobo,
            specialInstructions: l.specialInstructions,
            extras: { create: l.extras.map((e) => ({ extraId: e.extraId, nameSnapshot: e.name, unitPriceKobo: e.unitPriceKobo, quantity: e.quantity })) },
          })),
        },
      },
    });
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: null, toStatus: 'PLACED', actorUserId: principal.userId, actorRole: principal.role, createdAt: now },
    });
    if (forCreate.promotionId) {
      await tx.promotionRedemption.create({
        data: { promotionId: forCreate.promotionId, orderId: order.id, customerId: principal.userId, discountKobo: quote.discountKobo },
      });
    }
    if (isCash) await notifyNewOrder(tx, order.id, now);
    return order.id;
  }

  async list(principal: Principal, q: { page: number; pageSize: number; status?: 'active' | 'past' }) {
    const terminal = TERMINAL_ORDER_STATUSES as OrderStatus[];
    const where: Prisma.OrderWhereInput = {
      customerId: principal.userId,
      ...(q.status === 'active' ? { status: { notIn: terminal } } : q.status === 'past' ? { status: { in: terminal } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.db.order.count({ where }),
      this.db.order.findMany({ where, include: orderInclude, orderBy: { placedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { items: rows.map(toCustomerOrder), page: q.page, pageSize: q.pageSize, total };
  }

  private async ownOrder(principal: Principal, orderId: string, tx: Db | Tx = this.db) {
    const o = await tx.order.findFirst({ where: { id: orderId, customerId: principal.userId }, include: orderInclude });
    if (!o) throw Errors.notFound('Order');
    return o;
  }

  async get(principal: Principal, orderId: string) {
    return toCustomerOrder(await this.ownOrder(principal, orderId));
  }

  /**
   * Customers may cancel until the restaurant accepts. Paid online orders get a refund request
   * (processed by finance in Phase 8); unpaid payment attempts are abandoned.
   */
  async cancel(principal: Principal, orderId: string, reason: string | undefined, ctx: RequestContext) {
    await this.db.$transaction(async (tx) => {
      const o = await this.ownOrder(principal, orderId, tx);
      if (o.status !== 'PLACED') {
        throw new AppError(409, 'CANNOT_CANCEL', 'The restaurant has already accepted this order. Contact support if you need help.');
      }
      const { refundRequested } = await closeUnfulfilledOrder(tx, {
        order: o,
        to: 'CANCELLED',
        actor: { userId: principal.userId, role: principal.role },
        reason: reason || 'Cancelled by customer',
      });
      await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'order.cancel', entityType: 'Order', entityId: orderId, before: { status: o.status, paymentStatus: o.paymentStatus }, after: { status: 'CANCELLED', refundRequested } }, ctx);
    });
    return this.get(principal, orderId);
  }

  /** Rebuilds a past order against today's menu: current prices, and what can no longer be ordered. */
  async reorderPreview(principal: Principal, orderId: string) {
    const o = await this.ownOrder(principal, orderId);
    const restaurant = await this.db.restaurant.findUniqueOrThrow({ where: { id: o.restaurantId }, include: { hours: true } });
    const ids = o.items.map((i) => i.menuItemId);
    const menu = await this.db.menuItem.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: { variants: { where: { deletedAt: null } }, extras: { where: { deletedAt: null } }, category: true },
    });
    const byId = new Map(menu.map((m) => [m.id, m]));
    const lines = [];
    const unavailable = [];
    for (const old of o.items) {
      const item = byId.get(old.menuItemId);
      if (!item || !item.isAvailable || !item.category.isActive) {
        unavailable.push({ name: old.nameSnapshot, reason: item ? 'Sold out' : 'No longer on the menu' });
        continue;
      }
      let unit = item.priceKobo;
      let variant = null;
      if (item.variants.length) {
        variant = item.variants.find((v) => v.id === old.variantId) ?? item.variants.find((v) => v.name === old.variantNameSnapshot) ?? null;
        if (!variant || !variant.isAvailable) {
          unavailable.push({ name: `${old.nameSnapshot}${old.variantNameSnapshot ? ` (${old.variantNameSnapshot})` : ''}`, reason: 'That option is unavailable' });
          continue;
        }
        unit = variant.priceKobo;
      }
      const extras = [];
      for (const e of old.extras) {
        const extra = item.extras.find((x) => x.id === e.extraId);
        if (extra?.isAvailable) extras.push({ id: extra.id, name: extra.name, priceKobo: extra.priceKobo, quantity: Math.min(e.quantity, extra.maxQuantity) });
        else unavailable.push({ name: `${e.nameSnapshot} (extra)`, reason: 'Unavailable' });
      }
      lines.push({
        menuItemId: item.id,
        name: item.name,
        variantId: variant?.id ?? null,
        variantName: variant?.name ?? null,
        extras,
        quantity: old.quantity,
        unitPriceKobo: unit + extras.reduce((s, x) => s + x.priceKobo * x.quantity, 0),
        instructions: old.specialInstructions,
      });
    }
    return {
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        minOrderKobo: restaurant.minOrderKobo,
        isAcceptingOrders: restaurant.verificationStatus === 'APPROVED' && restaurant.isAcceptingOrders && isOpenAt(restaurant.hours, this.now()),
      },
      lines,
      unavailable,
    };
  }
}
