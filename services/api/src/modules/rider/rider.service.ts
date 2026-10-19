import { timingSafeEqual } from 'node:crypto';
import { RIDER_DOCUMENT_TYPES, type PROBLEM_REASONS, type RELEASE_REASONS } from '@chopnow/shared-schemas';
import { distanceMeters } from '@chopnow/shared-utils';
import type { Db, Tx } from '../../db/client.js';
import { Prisma, type DeliveryStatus } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import { lagosDate, lagosDayStartUtc } from '../../lib/lagos.js';
import { writeAudit, type RequestContext } from '../audit/audit.js';
import type { Principal } from '../auth/auth.service.js';
import { ACTIVE_DELIVERY_STATUSES, cashLimitFor, outstandingCashByRider, type DispatchService } from '../dispatch/dispatch.service.js';
import { finalizeDelivery } from '../dispatch/finalize-delivery.js';
import { transitionOrder } from '../orders/order-state.js';
import { getBusinessRules } from '../settings/business-rules.js';
import type { StorageDriver } from '../storage/storage.js';
import { storeDocument } from '../storage/uploads.js';
import { notifyDeliveryProblem, notifyPickedUp, notifyRiderAssigned } from '../notifications/messages.js';

const RELEASE_LABEL: Record<(typeof RELEASE_REASONS)[number], string> = {
  VEHICLE_ISSUE: 'Vehicle problem',
  EMERGENCY: 'Rider emergency',
  RESTAURANT_TOO_SLOW: 'Food not ready in time',
  OTHER: 'Released by rider',
};
const PROBLEM_LABEL: Record<(typeof PROBLEM_REASONS)[number], string> = {
  CUSTOMER_UNREACHABLE: 'Customer could not be reached',
  CUSTOMER_REFUSED: 'Customer refused the order',
  CANNOT_PAY: 'Customer could not pay the full amount',
  WRONG_ADDRESS: 'Address could not be found',
  UNSAFE: 'Delivery location unsafe',
  ACCIDENT: 'Rider accident or emergency',
  OTHER: 'Delivery problem',
};

const deliveryInclude = {
  order: {
    include: {
      restaurant: { select: { name: true, addressLine: true, area: true, latitude: true, longitude: true, phone: true } },
      customer: { select: { fullName: true } },
      items: { include: { extras: true }, orderBy: { id: 'asc' } },
    },
  },
  cashCollection: true,
} satisfies Prisma.DeliveryInclude;
type DeliveryRow = Prisma.DeliveryGetPayload<{ include: typeof deliveryInclude }>;

type Address = { line1: string; line2?: string | null; area: string; city: string; landmark?: string | null; instructions?: string | null; contactPhone?: string | null };

const pinMatches = (given: string, expected: string) => given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));

function actionsFor(status: DeliveryStatus) {
  if (status === 'ASSIGNED') return ['arrived', 'picked_up', 'release'] as const;
  if (status === 'ARRIVED_AT_RESTAURANT') return ['picked_up', 'release'] as const;
  if (status === 'PICKED_UP') return ['complete', 'report_problem'] as const;
  return [] as const;
}

/**
 * Everything a rider does: profile and availability, offers, and the delivery steps. Every lookup is
 * scoped to the caller's rider record; another rider's offer or delivery is a 404.
 */
export class RiderService {
  constructor(
    private readonly db: Db,
    private readonly dispatch: DispatchService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async me(principal: Principal) {
    const rider = await this.db.rider.findUnique({ where: { userId: principal.userId }, include: { user: { select: { fullName: true, status: true } } } });
    if (!rider) throw Errors.notFound('Rider profile');
    return rider;
  }

  async profile(principal: Principal) {
    const rider = await this.me(principal);
    const rules = await getBusinessRules(this.db);
    const today = lagosDate(this.now());
    const start = lagosDayStartUtc(today);
    const [cash, earnings, todayDeliveries] = await Promise.all([
      outstandingCashByRider(this.db, [rider.id]),
      this.db.riderEarning.aggregate({ where: { riderId: rider.id, status: { not: 'VOIDED' }, createdAt: { gte: start } }, _sum: { amountKobo: true } }),
      this.db.delivery.count({ where: { currentRiderId: rider.id, status: 'DELIVERED', deliveredAt: { gte: start } } }),
    ]);
    return {
      id: rider.id,
      fullName: rider.user.fullName,
      riderType: rider.riderType,
      verificationStatus: rider.verificationStatus,
      verificationNote: rider.verificationNote,
      availability: rider.availability,
      vehicleType: rider.vehicleType,
      vehiclePlate: rider.vehiclePlate,
      completedDeliveries: rider.completedDeliveries,
      ratingAverage: rider.ratingAverage,
      ratingCount: rider.ratingCount,
      outstandingCashKobo: cash.get(rider.id) ?? 0,
      cashLimitKobo: cashLimitFor(rider, rules),
      todayEarningsKobo: earnings._sum.amountKobo ?? 0,
      todayDeliveries,
    };
  }

  /** Going online needs an approved, active account. Going offline withdraws any pending offer. */
  async setAvailability(principal: Principal, online: boolean) {
    const rider = await this.me(principal);
    const now = this.now();
    if (online) {
      if (rider.verificationStatus !== 'APPROVED' || rider.user.status !== 'ACTIVE') {
        throw new AppError(409, 'RIDER_NOT_APPROVED', 'Your account must be approved before you can go online.');
      }
      await this.db.rider.update({ where: { id: rider.id }, data: { availability: 'ONLINE', lastSeenAt: now } });
    } else {
      const pending = await this.db.$transaction(async (tx) => {
        await tx.rider.update({ where: { id: rider.id }, data: { availability: 'OFFLINE' } });
        const offers = await tx.deliveryOffer.findMany({ where: { riderId: rider.id, status: 'PENDING' }, select: { id: true, deliveryId: true } });
        await tx.deliveryOffer.updateMany({ where: { id: { in: offers.map((o) => o.id) } }, data: { status: 'CANCELLED', respondedAt: now } });
        return offers;
      });
      for (const o of pending) await this.dispatch.kick(o.deliveryId);
    }
    return this.profile(principal);
  }

  /** Latest position only (overwritten), and only while online. Also counts as a heartbeat. */
  async updateLocation(principal: Principal, latitude: number, longitude: number) {
    const rider = await this.me(principal);
    if (rider.availability === 'ONLINE') {
      await this.db.rider.update({ where: { id: rider.id }, data: { lastLatitude: latitude, lastLongitude: longitude, lastSeenAt: this.now() } });
    }
    return { ok: true as const };
  }

  /** The app's poll: current offer and active delivery. Marks the rider as reachable. */
  async work(principal: Principal) {
    const rider = await this.me(principal);
    const now = this.now();
    if (rider.availability === 'ONLINE') await this.db.rider.update({ where: { id: rider.id }, data: { lastSeenAt: now } });
    const [offer, active] = await Promise.all([
      this.db.deliveryOffer.findFirst({
        where: { riderId: rider.id, status: 'PENDING', expiresAt: { gt: now } },
        include: { delivery: { include: deliveryInclude } },
        orderBy: { offeredAt: 'desc' },
      }),
      this.db.delivery.findFirst({ where: { currentRiderId: rider.id, status: { in: [...ACTIVE_DELIVERY_STATUSES] } }, include: deliveryInclude }),
    ]);
    const rules = await getBusinessRules(this.db);
    return {
      availability: rider.availability,
      offer: offer ? this.toOffer(offer, offer.delivery, rider) : null,
      delivery: active ? this.toDelivery(active, rider.id, rules.dispatch.maxPinAttempts) : null,
    };
  }

  private toOffer(
    offer: { id: string; expiresAt: Date },
    d: DeliveryRow,
    rider: { lastLatitude: number | null; lastLongitude: number | null },
  ) {
    const r = d.order.restaurant;
    const known = (lat: number | null, lng: number | null) => (lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null);
    const here = known(rider.lastLatitude, rider.lastLongitude);
    const shop = known(r.latitude, r.longitude);
    const drop = known(d.order.deliveryLatitude, d.order.deliveryLongitude);
    return {
      id: offer.id,
      deliveryId: d.id,
      orderCode: d.order.code,
      expiresAt: offer.expiresAt,
      restaurant: { name: r.name, addressLine: r.addressLine, area: r.area, latitude: r.latitude, longitude: r.longitude },
      dropoffArea: (d.order.deliveryAddress as Address).area,
      distanceToRestaurantMeters: here && shop ? Math.round(distanceMeters(here, shop)) : null,
      deliveryDistanceMeters: shop && drop ? Math.round(distanceMeters(shop, drop)) : null,
      earningKobo: d.order.riderEarningKobo,
      cashToCollectKobo: d.cashToCollectKobo,
      itemCount: d.order.items.reduce((n, i) => n + i.quantity, 0),
      estimatedReadyAt: d.order.estimatedReadyAt,
    };
  }

  private toDelivery(d: DeliveryRow, riderId: string, maxPinAttempts: number) {
    const a = d.order.deliveryAddress as Address;
    const holding = d.currentRiderId === riderId && (ACTIVE_DELIVERY_STATUSES as readonly string[]).includes(d.status);
    const r = d.order.restaurant;
    return {
      id: d.id,
      status: d.status,
      orderId: d.order.id,
      orderCode: d.order.code,
      orderStatus: d.order.status,
      restaurant: { name: r.name, addressLine: r.addressLine, area: r.area, latitude: r.latitude, longitude: r.longitude, phone: r.phone },
      dropoff: holding
        ? {
            customerFirstName: d.order.customer.fullName.split(/\s+/)[0] ?? 'Customer',
            line1: a.line1,
            line2: a.line2 ?? null,
            area: a.area,
            city: a.city,
            landmark: a.landmark ?? null,
            instructions: a.instructions ?? null,
            contactPhone: a.contactPhone ?? null,
            latitude: d.order.deliveryLatitude,
            longitude: d.order.deliveryLongitude,
          }
        : null,
      dropoffArea: a.area,
      customerNote: holding ? d.order.customerNote : null,
      items: d.order.items.map((i) => ({ name: i.nameSnapshot, variantName: i.variantNameSnapshot, quantity: i.quantity, extras: i.extras.map((e) => (e.quantity > 1 ? `${e.quantity}× ${e.nameSnapshot}` : e.nameSnapshot)) })),
      paymentMethod: d.order.paymentMethod,
      cashToCollectKobo: d.cashToCollectKobo,
      earningKobo: d.order.riderEarningKobo,
      estimatedReadyAt: d.order.estimatedReadyAt,
      foodReady: d.order.status === 'READY_FOR_PICKUP',
      pinAttemptsLeft: Math.max(0, maxPinAttempts - d.pinFailedAttempts),
      assignedAt: d.assignedAt,
      pickedUpAt: d.pickedUpAt,
      deliveredAt: d.deliveredAt,
      failureReason: d.failureReason,
      actions: d.currentRiderId === riderId ? [...actionsFor(d.status)] : [],
    };
  }

  private async ownOffer(principal: Principal, offerId: string) {
    const rider = await this.me(principal);
    const offer = await this.db.deliveryOffer.findFirst({ where: { id: offerId, riderId: rider.id } });
    if (!offer) throw Errors.notFound('Offer');
    return { rider, offer };
  }

  async acceptOffer(principal: Principal, offerId: string) {
    const { rider, offer } = await this.ownOffer(principal, offerId);
    if (rider.verificationStatus !== 'APPROVED' || rider.availability !== 'ONLINE') {
      throw new AppError(409, 'RIDER_NOT_ONLINE', 'Go online to accept deliveries.');
    }
    const now = this.now();
    try {
      await this.db.$transaction(async (tx) => {
        const taken = await tx.deliveryOffer.updateMany({ where: { id: offer.id, status: 'PENDING', expiresAt: { gt: now } }, data: { status: 'ACCEPTED', respondedAt: now } });
        if (taken.count !== 1) throw new AppError(409, 'OFFER_UNAVAILABLE', 'This offer has expired or was withdrawn.');
        const assigned = await tx.delivery.updateMany({
          where: { id: offer.deliveryId, status: { in: ['UNASSIGNED', 'OFFERING'] }, currentRiderId: null },
          data: { status: 'ASSIGNED', currentRiderId: rider.id, assignedAt: now },
        });
        if (assigned.count !== 1) throw new AppError(409, 'OFFER_UNAVAILABLE', 'This delivery is no longer available.');
        await tx.deliveryOffer.updateMany({ where: { deliveryId: offer.deliveryId, status: 'PENDING', id: { not: offer.id } }, data: { status: 'CANCELLED', respondedAt: now } });
        await tx.cashCollection.updateMany({ where: { deliveryId: offer.deliveryId }, data: { riderId: rider.id } });
        await tx.deliveryEvent.create({ data: { deliveryId: offer.deliveryId, riderId: rider.id, actorUserId: principal.userId, type: 'ACCEPTED', createdAt: now } });
        const { orderId } = await tx.delivery.findUniqueOrThrow({ where: { id: offer.deliveryId }, select: { orderId: true } });
        await notifyRiderAssigned(tx, orderId, now);
      });
    } catch (err) {
      // deliveries_one_active_per_rider_idx: the rider already holds a delivery.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(409, 'ALREADY_ON_DELIVERY', 'Finish your current delivery before accepting another.');
      }
      throw err;
    }
    return this.current(principal, offer.deliveryId);
  }

  async declineOffer(principal: Principal, offerId: string, reason?: string) {
    const { rider, offer } = await this.ownOffer(principal, offerId);
    const now = this.now();
    const res = await this.db.deliveryOffer.updateMany({ where: { id: offer.id, status: 'PENDING' }, data: { status: 'DECLINED', respondedAt: now, declineReason: reason ?? null } });
    if (res.count === 1) {
      await this.db.deliveryEvent.create({ data: { deliveryId: offer.deliveryId, riderId: rider.id, actorUserId: principal.userId, type: 'DECLINED', note: reason ?? null, createdAt: now } });
      await this.dispatch.kick(offer.deliveryId);
    }
    return { ok: true as const };
  }

  /** A delivery this rider currently holds (or just finished). */
  private async current(principal: Principal, deliveryId: string) {
    const rider = await this.me(principal);
    const d = await this.db.delivery.findFirst({ where: { id: deliveryId, currentRiderId: rider.id }, include: deliveryInclude });
    if (!d) throw Errors.notFound('Delivery');
    const rules = await getBusinessRules(this.db);
    return this.toDelivery(d, rider.id, rules.dispatch.maxPinAttempts);
  }

  private async held(tx: Tx | Db, principal: Principal, deliveryId: string) {
    const rider = await this.me(principal);
    const d = await tx.delivery.findFirst({ where: { id: deliveryId, currentRiderId: rider.id }, include: deliveryInclude });
    if (!d) throw Errors.notFound('Delivery');
    return { rider, d };
  }

  private async moveDelivery(tx: Tx, id: string, from: DeliveryStatus[], data: Prisma.DeliveryUncheckedUpdateManyInput) {
    const res = await tx.delivery.updateMany({ where: { id, status: { in: from } }, data });
    if (res.count !== 1) throw new AppError(409, 'DELIVERY_STATE_CHANGED', 'This delivery was updated. Refresh and try again.');
  }

  async arrived(principal: Principal, deliveryId: string) {
    await this.db.$transaction(async (tx) => {
      const { rider, d } = await this.held(tx, principal, deliveryId);
      if (d.status !== 'ASSIGNED') throw new AppError(409, 'DELIVERY_STATE_CHANGED', 'You have already marked arrival.');
      const now = this.now();
      await this.moveDelivery(tx, d.id, ['ASSIGNED'], { status: 'ARRIVED_AT_RESTAURANT', arrivedAtRestaurantAt: now });
      await tx.deliveryEvent.create({ data: { deliveryId: d.id, riderId: rider.id, actorUserId: principal.userId, type: 'ARRIVED_AT_RESTAURANT', createdAt: now } });
    });
    return this.current(principal, deliveryId);
  }

  /** Only once the restaurant has marked the food ready, so handover is recorded by both sides. */
  async pickedUp(principal: Principal, deliveryId: string) {
    await this.db.$transaction(async (tx) => {
      const { rider, d } = await this.held(tx, principal, deliveryId);
      if (d.status !== 'ASSIGNED' && d.status !== 'ARRIVED_AT_RESTAURANT') throw new AppError(409, 'DELIVERY_STATE_CHANGED', 'This delivery has already been picked up.');
      if (d.order.status !== 'READY_FOR_PICKUP') {
        throw new AppError(409, 'FOOD_NOT_READY', 'The restaurant hasn’t marked this order ready yet. Ask them to tap “Ready for pickup”.');
      }
      const now = this.now();
      await this.moveDelivery(tx, d.id, ['ASSIGNED', 'ARRIVED_AT_RESTAURANT'], { status: 'PICKED_UP', pickedUpAt: now, arrivedAtRestaurantAt: d.arrivedAtRestaurantAt ?? now });
      await transitionOrder(tx, { orderId: d.order.id, from: 'READY_FOR_PICKUP', to: 'PICKED_UP', actor: { userId: principal.userId, role: 'RIDER' } });
      await tx.deliveryEvent.create({ data: { deliveryId: d.id, riderId: rider.id, actorUserId: principal.userId, type: 'PICKED_UP', createdAt: now } });
      await notifyPickedUp(tx, d.order.id, now);
    });
    return this.current(principal, deliveryId);
  }

  /**
   * Proof of delivery: the customer's 4-digit PIN. Wrong PINs are counted (committed even though the
   * request fails) and locked after `dispatch.maxPinAttempts`. Cash orders must record the amount
   * received; it must equal the amount due unless partial collection is enabled.
   */
  async complete(principal: Principal, deliveryId: string, pin: string, cashCollectedKobo: number | undefined, ctx: RequestContext) {
    const rules = await getBusinessRules(this.db);
    const max = rules.dispatch.maxPinAttempts;
    const { d } = await this.held(this.db, principal, deliveryId);
    if (d.status !== 'PICKED_UP') throw new AppError(409, 'DELIVERY_STATE_CHANGED', 'Mark the order as picked up first.');
    if (d.pinFailedAttempts >= max) throw new AppError(423, 'PIN_LOCKED', 'Too many wrong PINs. Use “Report a problem” so operations can help.');

    if (!pinMatches(pin, d.order.deliveryPin)) {
      await this.db.delivery.updateMany({ where: { id: d.id, status: 'PICKED_UP' }, data: { pinFailedAttempts: { increment: 1 } } });
      const left = Math.max(0, max - d.pinFailedAttempts - 1);
      if (left === 0) {
        await writeAudit(this.db, { actorUserId: principal.userId, actorRole: 'RIDER', action: 'delivery.pin_locked', entityType: 'Delivery', entityId: d.id, after: { attempts: max } }, ctx);
        throw new AppError(423, 'PIN_LOCKED', 'Too many wrong PINs. Use “Report a problem” so operations can help.');
      }
      throw new AppError(422, 'INVALID_PIN', `That PIN is not correct. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`, { attemptsLeft: left });
    }

    const cash = d.cashCollection;
    let collected = 0;
    if (cash) {
      if (cashCollectedKobo === undefined) throw Errors.validation([{ in: 'body', path: 'cashCollectedKobo', message: 'Enter the cash you received' }]);
      if (cashCollectedKobo > cash.amountDueKobo) throw new AppError(422, 'CASH_AMOUNT_INVALID', 'That is more than the amount due. Give the customer their change and enter the amount due.');
      if (cashCollectedKobo < cash.amountDueKobo && !rules.cashOnDelivery.allowPartialCollection) {
        throw new AppError(422, 'CASH_AMOUNT_SHORT', 'Collect the full amount. If the customer can’t pay, use “Report a problem” instead.');
      }
      if (cashCollectedKobo === 0) throw new AppError(422, 'CASH_AMOUNT_SHORT', 'No cash was recorded. If the customer can’t pay, use “Report a problem” instead.');
      collected = cashCollectedKobo;
    } else if (cashCollectedKobo) {
      throw new AppError(422, 'NO_CASH_DUE', 'This order was paid online. Don’t collect any cash.');
    }

    const now = this.now();
    await this.db.$transaction((tx) =>
      finalizeDelivery(tx, {
        delivery: d,
        order: d.order,
        cash: cash ? { id: cash.id, amountDueKobo: cash.amountDueKobo } : null,
        collectedKobo: collected,
        actor: { userId: principal.userId, role: 'RIDER' },
        at: now,
        proof: { kind: 'pin' },
        fromDeliveryStatuses: ['PICKED_UP'],
      }),
    );
    return this.current(principal, deliveryId);
  }

  /** Before pickup: give the job back. It is offered to someone else; this rider is not asked again. */
  async release(principal: Principal, deliveryId: string, reason: (typeof RELEASE_REASONS)[number], note: string | undefined, ctx: RequestContext) {
    const { d, rider } = await this.held(this.db, principal, deliveryId);
    if (d.status !== 'ASSIGNED' && d.status !== 'ARRIVED_AT_RESTAURANT') {
      throw new AppError(409, 'CANNOT_RELEASE', 'Picked-up orders can’t be handed back. Use “Report a problem”.');
    }
    const now = this.now();
    const text = note ? `${RELEASE_LABEL[reason]}: ${note}` : RELEASE_LABEL[reason];
    await this.db.$transaction(async (tx) => {
      await this.moveDelivery(tx, d.id, ['ASSIGNED', 'ARRIVED_AT_RESTAURANT'], { status: 'OFFERING', currentRiderId: null, assignedAt: null, arrivedAtRestaurantAt: null });
      await tx.deliveryOffer.updateMany({ where: { deliveryId: d.id, riderId: rider.id, status: 'ACCEPTED' }, data: { status: 'RELEASED' } });
      await tx.cashCollection.updateMany({ where: { deliveryId: d.id }, data: { riderId: null } });
      await tx.deliveryEvent.create({ data: { deliveryId: d.id, riderId: rider.id, actorUserId: principal.userId, type: 'RELEASED', note: text, createdAt: now } });
      await writeAudit(tx, { actorUserId: principal.userId, actorRole: 'RIDER', action: 'delivery.release', entityType: 'Delivery', entityId: d.id, after: { reason, note: note ?? null, orderCode: d.order.code } }, ctx);
    });
    await this.dispatch.kick(d.id);
    return { ok: true as const };
  }

  /**
   * After pickup, when the delivery can't be completed. The order becomes a delivery exception for
   * operations to resolve (Phase 9), and the rider is set offline so no new offers arrive while they
   * still hold the food.
   */
  async reportProblem(principal: Principal, deliveryId: string, reason: (typeof PROBLEM_REASONS)[number], note: string | undefined, ctx: RequestContext) {
    const now = this.now();
    const text = note ? `${PROBLEM_LABEL[reason]}: ${note}` : PROBLEM_LABEL[reason];
    await this.db.$transaction(async (tx) => {
      const { d, rider } = await this.held(tx, principal, deliveryId);
      if (d.status !== 'PICKED_UP') throw new AppError(409, 'DELIVERY_STATE_CHANGED', 'Problems after pickup only. Before pickup, hand the job back instead.');
      await this.moveDelivery(tx, d.id, ['PICKED_UP'], { status: 'FAILED', failedAt: now, failureReason: text });
      await transitionOrder(tx, { orderId: d.order.id, from: 'PICKED_UP', to: 'DELIVERY_EXCEPTION', actor: { userId: principal.userId, role: 'RIDER' }, reason: text });
      await tx.cashCollection.updateMany({ where: { deliveryId: d.id, status: 'PENDING' }, data: { status: 'NOT_COLLECTED' } });
      await tx.rider.update({ where: { id: rider.id }, data: { availability: 'OFFLINE' } });
      await tx.deliveryEvent.create({ data: { deliveryId: d.id, riderId: rider.id, actorUserId: principal.userId, type: 'PROBLEM_REPORTED', note: text, createdAt: now } });
      await notifyDeliveryProblem(tx, d.order.id, now);
      await writeAudit(tx, { actorUserId: principal.userId, actorRole: 'RIDER', action: 'delivery.problem', entityType: 'Delivery', entityId: d.id, after: { reason, note: note ?? null, orderCode: d.order.code } }, ctx);
    });
    return this.current(principal, deliveryId);
  }

  async history(principal: Principal, page: number, pageSize: number) {
    const rider = await this.me(principal);
    const where: Prisma.DeliveryWhereInput = { currentRiderId: rider.id, status: { in: ['DELIVERED', 'FAILED', 'CANCELLED'] } };
    const [total, rows] = await Promise.all([
      this.db.delivery.count({ where }),
      this.db.delivery.findMany({
        where,
        include: { order: { select: { code: true, deliveryAddress: true, restaurant: { select: { name: true } } } }, cashCollection: true, riderEarnings: { where: { status: { not: 'VOIDED' } } } },
        orderBy: { assignedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      items: rows.map((d) => ({
        id: d.id,
        orderCode: d.order.code,
        status: d.status,
        restaurantName: d.order.restaurant.name,
        dropoffArea: (d.order.deliveryAddress as Address).area,
        earningKobo: d.riderEarnings.reduce((s, e) => s + e.amountKobo, 0),
        cashCollectedKobo: d.cashCollection?.amountCollectedKobo ?? 0,
        assignedAt: d.assignedAt,
        deliveredAt: d.deliveredAt,
      })),
    };
  }

  async earnings(principal: Principal, from: string, to: string) {
    const rider = await this.me(principal);
    const start = lagosDayStartUtc(from);
    const end = new Date(lagosDayStartUtc(to).getTime() + 86_400_000);
    const [rows, unsettled, cash] = await Promise.all([
      this.db.riderEarning.findMany({ where: { riderId: rider.id, status: { not: 'VOIDED' }, createdAt: { gte: start, lt: end } } }),
      this.db.riderEarning.aggregate({ where: { riderId: rider.id, status: { in: ['CALCULATED', 'APPROVED'] } }, _sum: { amountKobo: true } }),
      outstandingCashByRider(this.db, [rider.id]),
    ]);
    const days = new Map<string, { deliveries: number; earningsKobo: number }>();
    for (let t = start.getTime(); t < end.getTime(); t += 86_400_000) days.set(lagosDate(new Date(t)), { deliveries: 0, earningsKobo: 0 });
    for (const e of rows) {
      const day = days.get(lagosDate(e.createdAt));
      if (!day) continue;
      day.earningsKobo += e.amountKobo;
      if (e.type === 'DELIVERY_FEE') day.deliveries++;
    }
    return {
      from,
      to,
      deliveries: rows.filter((e) => e.type === 'DELIVERY_FEE').length,
      totalKobo: rows.reduce((s, e) => s + e.amountKobo, 0),
      unsettledKobo: unsettled._sum.amountKobo ?? 0,
      outstandingCashKobo: cash.get(rider.id) ?? 0,
      days: [...days.entries()].map(([date, v]) => ({ date, ...v })),
    };
  }

  async uploadDocument(principal: Principal, storage: StorageDriver, file: { buffer: Buffer; originalname: string }, type: string) {
    const rider = await this.me(principal);
    if (!(RIDER_DOCUMENT_TYPES as readonly string[]).includes(type)) throw Errors.validation([{ in: 'body', path: 'type', message: 'Choose the document type' }]);
    const stored = await storeDocument(storage, file.buffer, `verification/riders/${rider.id}`);
    return this.db.verificationDocument.create({
      data: {
        riderId: rider.id,
        type: type as (typeof RIDER_DOCUMENT_TYPES)[number],
        storageKey: stored.key,
        originalName: file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document',
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
      },
    });
  }

  async documents(principal: Principal) {
    const rider = await this.me(principal);
    return { items: await this.db.verificationDocument.findMany({ where: { riderId: rider.id }, orderBy: { uploadedAt: 'desc' } }) };
  }
}
