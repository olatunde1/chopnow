import type { ApprovalStatus, BusinessRules, RiderType } from '@chopnow/shared-schemas';
import { BusinessRulesSchema } from '@chopnow/shared-schemas';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import { writeAudit, type RequestContext } from '../audit/audit.js';
import type { Principal } from '../auth/auth.service.js';
import { BUSINESS_RULES_KEY, getBusinessRules } from '../settings/business-rules.js';
import { notifyApproval } from '../notifications/messages.js';

const ACTIVE_DELIVERY = ['ASSIGNED', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP'] as const;

interface ListQuery {
  page: number;
  pageSize: number;
  status?: ApprovalStatus;
  q?: string;
}

function invalidTransition(entity: string, from: string, action: string) {
  return new AppError(409, 'INVALID_STATUS', `Cannot ${action} a ${entity} that is ${from.toLowerCase()}`);
}

/**
 * Staff decisions on restaurants and riders, plus business-rule configuration. Every decision is
 * audited with before/after state. Permissions are enforced at the route; transitions here.
 */
export class ApprovalsService {
  constructor(private readonly db: Db) {}

  // ───────── Restaurants ─────────

  private restaurantView = {
    include: {
      owner: { select: { id: true, fullName: true, email: true, phone: true } },
      _count: { select: { hours: true, menuItems: { where: { deletedAt: null } } } },
    },
  } satisfies Prisma.RestaurantDefaultArgs;

  private toRestaurantDto(r: Prisma.RestaurantGetPayload<ApprovalsService['restaurantView']>) {
    return { ...r, hoursConfigured: r._count.hours > 0, menuItemCount: r._count.menuItems };
  }

  async listRestaurants(q: ListQuery) {
    const where: Prisma.RestaurantWhereInput = {
      ...(q.status ? { verificationStatus: q.status } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { owner: { email: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.db.restaurant.count({ where }),
      this.db.restaurant.findMany({ where, ...this.restaurantView, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { items: rows.map((r) => this.toRestaurantDto(r)), page: q.page, pageSize: q.pageSize, total };
  }

  async getRestaurant(id: string) {
    const r = await this.db.restaurant.findUnique({ where: { id }, ...this.restaurantView });
    if (!r) throw Errors.notFound('Restaurant');
    return this.toRestaurantDto(r);
  }

  /**
   * Approval requires a location (for delivery-radius checks) and opening hours. It does not switch the
   * restaurant on: the vendor does that when ready.
   */
  async approveRestaurant(actor: Principal, id: string, note: string | undefined, ctx: RequestContext) {
    const r = await this.getRestaurant(id);
    if (r.verificationStatus === 'APPROVED') throw invalidTransition('restaurant', r.verificationStatus, 'approve');
    const missing = [
      r.latitude === null || r.longitude === null ? 'location coordinates' : null,
      r.hoursConfigured ? null : 'opening hours',
    ].filter(Boolean);
    if (missing.length) {
      throw new AppError(409, 'RESTAURANT_INCOMPLETE', `The restaurant needs ${missing.join(' and ')} before it can be approved`);
    }
    await this.db.$transaction(async (tx) => {
      await tx.restaurant.update({
        where: { id },
        data: { verificationStatus: 'APPROVED', verificationNote: note ?? null, approvedAt: new Date(), approvedById: actor.userId },
      });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'restaurant.approve', entityType: 'Restaurant', entityId: id, before: { verificationStatus: r.verificationStatus }, after: { verificationStatus: 'APPROVED', note: note ?? null } }, ctx);
      await notifyApproval(tx, { userId: r.owner.id, what: 'restaurant', name: r.name, status: 'APPROVED', entityId: id }, new Date());
    });
    return this.getRestaurant(id);
  }

  async rejectRestaurant(actor: Principal, id: string, reason: string, ctx: RequestContext) {
    return this.restaurantDecision(actor, id, 'REJECTED', reason, ['PENDING'], 'reject', ctx);
  }

  async suspendRestaurant(actor: Principal, id: string, reason: string, ctx: RequestContext) {
    return this.restaurantDecision(actor, id, 'SUSPENDED', reason, ['APPROVED'], 'suspend', ctx);
  }

  private async restaurantDecision(actor: Principal, id: string, to: ApprovalStatus, reason: string, allowedFrom: ApprovalStatus[], verb: string, ctx: RequestContext) {
    const r = await this.getRestaurant(id);
    if (!allowedFrom.includes(r.verificationStatus)) throw invalidTransition('restaurant', r.verificationStatus, verb);
    await this.db.$transaction(async (tx) => {
      // Switching off accepting orders is required by the DB check for any non-approved status.
      await tx.restaurant.update({ where: { id }, data: { verificationStatus: to, verificationNote: reason, isAcceptingOrders: false } });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: `restaurant.${verb}`, entityType: 'Restaurant', entityId: id, before: { verificationStatus: r.verificationStatus, isAcceptingOrders: r.isAcceptingOrders }, after: { verificationStatus: to, reason } }, ctx);
      if (to === 'REJECTED' || to === 'SUSPENDED') await notifyApproval(tx, { userId: r.owner.id, what: 'restaurant', name: r.name, status: to, reason, entityId: id }, new Date());
    });
    return this.getRestaurant(id);
  }

  // ───────── Riders ─────────

  private riderView = { include: { user: { select: { id: true, fullName: true, email: true, phone: true } } } } satisfies Prisma.RiderDefaultArgs;

  async listRiders(q: ListQuery & { riderType?: RiderType }) {
    const where: Prisma.RiderWhereInput = {
      ...(q.status ? { verificationStatus: q.status } : {}),
      ...(q.riderType ? { riderType: q.riderType } : {}),
      ...(q.q
        ? { user: { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] } }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.db.rider.count({ where }),
      this.db.rider.findMany({ where, ...this.riderView, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total };
  }

  async getRider(id: string) {
    const r = await this.db.rider.findUnique({ where: { id }, ...this.riderView });
    if (!r) throw Errors.notFound('Rider');
    return r;
  }

  async approveRider(actor: Principal, id: string, riderType: RiderType, note: string | undefined, ctx: RequestContext) {
    const r = await this.getRider(id);
    if (r.verificationStatus === 'APPROVED') throw invalidTransition('rider', r.verificationStatus, 'approve');
    await this.db.$transaction(async (tx) => {
      await tx.rider.update({
        where: { id },
        data: { verificationStatus: 'APPROVED', riderType, verificationNote: note ?? null, approvedAt: new Date(), approvedById: actor.userId },
      });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'rider.approve', entityType: 'Rider', entityId: id, before: { verificationStatus: r.verificationStatus, riderType: r.riderType }, after: { verificationStatus: 'APPROVED', riderType, note: note ?? null } }, ctx);
      await notifyApproval(tx, { userId: r.user.id, what: 'rider', name: r.user.fullName, status: 'APPROVED', entityId: id }, new Date());
    });
    return this.getRider(id);
  }

  async rejectRider(actor: Principal, id: string, reason: string, ctx: RequestContext) {
    return this.riderDecision(actor, id, 'REJECTED', reason, ['PENDING'], 'reject', ctx);
  }

  /** A rider in the middle of a delivery must be reassigned before suspension. */
  async suspendRider(actor: Principal, id: string, reason: string, ctx: RequestContext) {
    const active = await this.db.delivery.count({ where: { currentRiderId: id, status: { in: [...ACTIVE_DELIVERY] } } });
    if (active > 0) throw Errors.conflict('RIDER_HAS_ACTIVE_DELIVERY', 'Reassign this rider’s active delivery before suspending them');
    return this.riderDecision(actor, id, 'SUSPENDED', reason, ['APPROVED'], 'suspend', ctx);
  }

  private async riderDecision(actor: Principal, id: string, to: ApprovalStatus, reason: string, allowedFrom: ApprovalStatus[], verb: string, ctx: RequestContext) {
    const r = await this.getRider(id);
    if (!allowedFrom.includes(r.verificationStatus)) throw invalidTransition('rider', r.verificationStatus, verb);
    await this.db.$transaction(async (tx) => {
      await tx.rider.update({ where: { id }, data: { verificationStatus: to, verificationNote: reason, availability: 'OFFLINE' } });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: `rider.${verb}`, entityType: 'Rider', entityId: id, before: { verificationStatus: r.verificationStatus }, after: { verificationStatus: to, reason } }, ctx);
      if (to === 'REJECTED' || to === 'SUSPENDED') await notifyApproval(tx, { userId: r.user.id, what: 'rider', name: r.user.fullName, status: to, reason, entityId: id }, new Date());
    });
    return this.getRider(id);
  }

  async setRiderType(actor: Principal, id: string, riderType: RiderType, ctx: RequestContext) {
    const r = await this.getRider(id);
    if (r.riderType === riderType) return r;
    await this.db.$transaction(async (tx) => {
      await tx.rider.update({ where: { id }, data: { riderType } });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'rider.set_type', entityType: 'Rider', entityId: id, before: { riderType: r.riderType }, after: { riderType } }, ctx);
    });
    return this.getRider(id);
  }

  // ───────── Business rules ─────────

  getBusinessRules(): Promise<BusinessRules> {
    return getBusinessRules(this.db);
  }

  async updateBusinessRules(actor: Principal, input: unknown, ctx: RequestContext): Promise<BusinessRules> {
    const parsed = BusinessRulesSchema.safeParse(input);
    if (!parsed.success) throw Errors.validation(parsed.error.issues.map((i) => ({ in: 'body', path: i.path.join('.'), message: i.message })));
    const before = await getBusinessRules(this.db);
    await this.db.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: BUSINESS_RULES_KEY },
        create: { key: BUSINESS_RULES_KEY, value: parsed.data, updatedById: actor.userId },
        update: { value: parsed.data, updatedById: actor.userId },
      });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'settings.business_rules_update', entityType: 'PlatformSetting', entityId: BUSINESS_RULES_KEY, before, after: parsed.data }, ctx);
    });
    return parsed.data;
  }
}
