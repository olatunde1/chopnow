import { randomInt } from 'node:crypto';
import { STAFF_ROLES } from '@chopnow/shared-schemas';
import type { Db } from '../../db/client.js';
import { Prisma, type DocumentStatus, type PromotionType, type ReviewStatus, type Role, type UserStatus } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import { writeAudit, type RequestContext } from '../audit/audit.js';
import type { Principal } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';
import { refreshRatings } from '../reviews/reviews.service.js';
import type { StorageDriver } from '../storage/storage.js';
import { notifyDocumentRejected } from '../notifications/messages.js';

const isStaff = (r: Role) => (STAFF_ROLES as readonly string[]).includes(r);
const DOC_LINK_TTL_SECONDS = 300;

/** 16 characters from an unambiguous alphabet, always with letters and digits (meets the policy). */
function temporaryPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)]!, digits[randomInt(digits.length)]!];
  while (chars.length < 16) chars.push(all[randomInt(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/**
 * Staff administration: users and staff accounts, verification documents, promotions, review
 * moderation and the audit log. Suspensions revoke sessions immediately (tokenVersion bump).
 */
export class OpsAdminService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageDriver,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ───────── Users ─────────

  private userDto(u: Prisma.UserGetPayload<{ include: { _count: { select: { orders: true } } } }>) {
    return { id: u.id, email: u.email, phone: u.phone, fullName: u.fullName, role: u.role, status: u.status, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, orderCount: u._count.orders, mustChangePassword: u.mustChangePassword };
  }

  async listUsers(q: { page: number; pageSize: number; role?: Role; status?: UserStatus; q?: string }) {
    const term = q.q?.trim();
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(term ? { OR: [{ email: { contains: term.toLowerCase() } }, { fullName: { contains: term, mode: 'insensitive' } }, { phone: { contains: term.replace(/\s/g, '') } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.db.user.count({ where }),
      this.db.user.findMany({ where, include: { _count: { select: { orders: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { items: rows.map((u) => this.userDto(u)), page: q.page, pageSize: q.pageSize, total };
  }

  async getUser(id: string) {
    const u = await this.db.user.findUnique({ where: { id }, include: { _count: { select: { orders: true } } } });
    if (!u) throw Errors.notFound('User');
    return this.userDto(u);
  }

  /**
   * Customers need customer.manage; staff need staff.manage. Restaurants and riders are suspended
   * through their own approval flows so their business records stay consistent.
   */
  private async assertCanManage(actor: Principal, target: { id: string; role: Role }, can: (p: 'customer.manage' | 'staff.manage') => boolean) {
    if (target.id === actor.userId) throw new AppError(409, 'CANNOT_CHANGE_SELF', 'You can’t change your own account status.');
    if (target.role === 'VENDOR' || target.role === 'RIDER') throw new AppError(409, 'USE_APPROVAL_FLOW', `Suspend ${target.role === 'VENDOR' ? 'the restaurant' : 'the rider'} from their profile instead.`);
    if (target.role === 'CUSTOMER' ? !can('customer.manage') : !can('staff.manage')) throw Errors.forbidden();
  }

  async setUserStatus(actor: Principal, id: string, status: 'ACTIVE' | 'SUSPENDED', reason: string, can: (p: 'customer.manage' | 'staff.manage') => boolean, ctx: RequestContext) {
    const u = await this.db.user.findUnique({ where: { id } });
    if (!u) throw Errors.notFound('User');
    await this.assertCanManage(actor, u, can);
    if (u.status === status) return this.getUser(id);
    if (status === 'SUSPENDED' && u.role === 'ADMIN' && (await this.db.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })) <= 1) {
      throw new AppError(409, 'LAST_ADMIN', 'At least one active admin must remain.');
    }
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status, ...(status === 'SUSPENDED' ? { tokenVersion: { increment: 1 } } : {}) } });
      if (status === 'SUSPENDED') await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: this.now(), revokedReason: 'SUSPENDED' } });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: status === 'SUSPENDED' ? 'user.suspend' : 'user.reactivate', entityType: 'User', entityId: id, before: { status: u.status }, after: { status, reason } }, ctx);
    });
    return this.getUser(id);
  }

  /** New staff member with a one-time password they must change at first sign-in. */
  async createStaff(actor: Principal, input: { email: string; fullName: string; phone?: string; role: Role }, ctx: RequestContext) {
    if (!isStaff(input.role)) throw Errors.validation([{ in: 'body', path: 'role', message: 'Choose a staff role' }]);
    const password = temporaryPassword();
    try {
      const u = await this.db.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email: input.email, fullName: input.fullName, phone: input.phone ?? null, role: input.role, passwordHash: await hashPassword(password), mustChangePassword: true } });
        await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'staff.create', entityType: 'User', entityId: created.id, after: { email: input.email, role: input.role } }, ctx);
        return created;
      });
      return { user: await this.getUser(u.id), temporaryPassword: password };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new AppError(409, 'EMAIL_OR_PHONE_IN_USE', 'An account with that email or phone already exists.');
      throw err;
    }
  }

  // ───────── Documents ─────────

  async listDocuments(owner: 'RESTAURANT' | 'RIDER', q: { status?: DocumentStatus; restaurantId?: string; riderId?: string }) {
    const rows = await this.db.verificationDocument.findMany({
      where: {
        ...(owner === 'RESTAURANT' ? { restaurantId: q.restaurantId ?? { not: null } } : { riderId: q.riderId ?? { not: null } }),
        ...(q.status ? { status: q.status } : {}),
      },
      include: { restaurant: { select: { name: true } }, rider: { select: { user: { select: { fullName: true } } } } },
      orderBy: { uploadedAt: 'asc' },
      take: 200,
    });
    return {
      items: rows.map((d) => ({
        id: d.id,
        owner,
        ownerId: (owner === 'RESTAURANT' ? d.restaurantId : d.riderId)!,
        ownerName: owner === 'RESTAURANT' ? d.restaurant!.name : d.rider!.user.fullName,
        type: d.type,
        originalName: d.originalName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        status: d.status,
        reviewNote: d.reviewNote,
        uploadedAt: d.uploadedAt,
        reviewedAt: d.reviewedAt,
      })),
    };
  }

  private async document(owner: 'RESTAURANT' | 'RIDER', id: string) {
    const d = await this.db.verificationDocument.findFirst({ where: { id, ...(owner === 'RESTAURANT' ? { restaurantId: { not: null } } : { riderId: { not: null } }) } });
    if (!d) throw Errors.notFound('Document');
    return d;
  }

  /** Short-lived link to view a private document. Each view is audited. */
  async documentLink(actor: Principal, owner: 'RESTAURANT' | 'RIDER', id: string, ctx: RequestContext) {
    const d = await this.document(owner, id);
    const url = await this.storage.signedPrivateUrl(d.storageKey, DOC_LINK_TTL_SECONDS);
    await writeAudit(this.db, { actorUserId: actor.userId, actorRole: actor.role, action: 'document.view', entityType: 'VerificationDocument', entityId: id }, ctx);
    return { url, expiresAt: new Date(this.now().getTime() + DOC_LINK_TTL_SECONDS * 1000) };
  }

  async reviewDocument(actor: Principal, owner: 'RESTAURANT' | 'RIDER', id: string, input: { status: 'ACCEPTED' | 'REJECTED'; note?: string }, ctx: RequestContext) {
    const d = await this.document(owner, id);
    await this.db.$transaction(async (tx) => {
      await tx.verificationDocument.update({ where: { id }, data: { status: input.status, reviewNote: input.note ?? null, reviewedById: actor.userId, reviewedAt: this.now() } });
      if (input.status === 'REJECTED') {
        const ownerUserId = d.restaurantId ? (await tx.restaurant.findUniqueOrThrow({ where: { id: d.restaurantId }, select: { ownerId: true } })).ownerId : (await tx.rider.findUniqueOrThrow({ where: { id: d.riderId! }, select: { userId: true } })).userId;
        await notifyDocumentRejected(tx, { userId: ownerUserId, documentId: id, note: input.note ?? 'Please upload it again.' }, this.now());
      }
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'document.review', entityType: 'VerificationDocument', entityId: id, before: { status: d.status }, after: input }, ctx);
    });
    return (await this.listDocuments(owner, owner === 'RESTAURANT' ? { restaurantId: d.restaurantId! } : { riderId: d.riderId! })).items.find((x) => x.id === id)!;
  }

  // ───────── Promotions ─────────

  private promoDto(p: Prisma.PromotionGetPayload<{ include: { restaurant: { select: { name: true } }; _count: { select: { redemptions: { where: { isActive: true } } } } } }>) {
    return {
      id: p.id, code: p.code, description: p.description, type: p.type, percentBps: p.percentBps, amountKobo: p.amountKobo, maxDiscountKobo: p.maxDiscountKobo,
      minSubtotalKobo: p.minSubtotalKobo, restaurantId: p.restaurantId, restaurantName: p.restaurant?.name ?? null, fundedBy: p.fundedBy, startsAt: p.startsAt, endsAt: p.endsAt,
      usageLimit: p.usageLimit, perCustomerLimit: p.perCustomerLimit, isActive: p.isActive, redemptions: p._count.redemptions, createdAt: p.createdAt,
    };
  }
  private promoInclude = { restaurant: { select: { name: true } }, _count: { select: { redemptions: { where: { isActive: true } } } } } as const;

  async listPromotions() {
    const rows = await this.db.promotion.findMany({ include: this.promoInclude, orderBy: { createdAt: 'desc' } });
    return { items: rows.map((p) => this.promoDto(p)) };
  }

  async createPromotion(actor: Principal, input: { code: string; description: string; type: PromotionType; percentBps?: number; amountKobo?: number; maxDiscountKobo?: number; minSubtotalKobo: number; restaurantId?: string; fundedBy: 'PLATFORM' | 'RESTAURANT'; startsAt: string; endsAt: string; usageLimit?: number; perCustomerLimit: number }, ctx: RequestContext) {
    if (input.restaurantId && !(await this.db.restaurant.findUnique({ where: { id: input.restaurantId } }))) throw Errors.notFound('Restaurant');
    try {
      const p = await this.db.$transaction(async (tx) => {
        const created = await tx.promotion.create({
          data: {
            code: input.code, description: input.description, type: input.type,
            percentBps: input.type === 'PERCENT_OFF' ? (input.percentBps ?? null) : null,
            amountKobo: input.type === 'FIXED_OFF' ? (input.amountKobo ?? null) : null,
            maxDiscountKobo: input.maxDiscountKobo ?? null, minSubtotalKobo: input.minSubtotalKobo, restaurantId: input.restaurantId ?? null, fundedBy: input.fundedBy,
            startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), usageLimit: input.usageLimit ?? null, perCustomerLimit: input.perCustomerLimit, createdById: actor.userId,
          },
          include: this.promoInclude,
        });
        await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'promotion.create', entityType: 'Promotion', entityId: created.id, after: { ...input } }, ctx);
        return created;
      });
      return this.promoDto(p);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new AppError(409, 'PROMO_CODE_EXISTS', 'That code is already used by another promotion.');
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2004') throw new AppError(422, 'PROMO_INVALID', 'Those promotion settings are not allowed.');
      throw err;
    }
  }

  async updatePromotion(actor: Principal, id: string, input: { isActive?: boolean; endsAt?: string; usageLimit?: number | null; description?: string }, ctx: RequestContext) {
    const before = await this.db.promotion.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Promotion');
    if (input.endsAt && new Date(input.endsAt) <= before.startsAt) throw Errors.validation([{ in: 'body', path: 'endsAt', message: 'Must end after it starts' }]);
    const p = await this.db.$transaction(async (tx) => {
      const updated = await tx.promotion.update({ where: { id }, data: { ...input, ...(input.endsAt ? { endsAt: new Date(input.endsAt) } : {}) }, include: this.promoInclude });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'promotion.update', entityType: 'Promotion', entityId: id, before: { isActive: before.isActive, endsAt: before.endsAt.toISOString(), usageLimit: before.usageLimit }, after: { ...input } }, ctx);
      return updated;
    });
    return this.promoDto(p);
  }

  // ───────── Reviews ─────────

  async listReviews(q: { page: number; pageSize: number; status?: ReviewStatus; maxRating?: number }) {
    const where: Prisma.ReviewWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.maxRating ? { restaurantRating: { lte: q.maxRating } } : {}) };
    const [total, rows] = await Promise.all([
      this.db.review.count({ where }),
      this.db.review.findMany({ where, include: { order: { select: { code: true } }, restaurant: { select: { name: true } }, customer: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      page: q.page, pageSize: q.pageSize, total,
      items: rows.map((r) => ({ id: r.id, orderCode: r.order.code, restaurantName: r.restaurant.name, customerName: r.customer.fullName, restaurantRating: r.restaurantRating, riderRating: r.riderRating, comment: r.comment, vendorReply: r.vendorReply, status: r.status, moderationNote: r.moderationNote, createdAt: r.createdAt })),
    };
  }

  /** Hides abusive or irrelevant reviews (or restores them); ratings are recomputed from published ones. */
  async moderateReview(actor: Principal, id: string, status: ReviewStatus, note: string, ctx: RequestContext) {
    const r = await this.db.review.findUnique({ where: { id } });
    if (!r) throw Errors.notFound('Review');
    await this.db.$transaction(async (tx) => {
      await tx.review.update({ where: { id }, data: { status, moderatedById: actor.userId, moderationNote: note } });
      await refreshRatings(tx, r.restaurantId, r.riderId);
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'review.moderate', entityType: 'Review', entityId: id, before: { status: r.status }, after: { status, note } }, ctx);
    });
    return this.reviewById(id);
  }

  private async reviewById(id: string) {
    const r = await this.db.review.findUniqueOrThrow({ where: { id }, include: { order: { select: { code: true } }, restaurant: { select: { name: true } }, customer: { select: { fullName: true } } } });
    return { id: r.id, orderCode: r.order.code, restaurantName: r.restaurant.name, customerName: r.customer.fullName, restaurantRating: r.restaurantRating, riderRating: r.riderRating, comment: r.comment, vendorReply: r.vendorReply, status: r.status, moderationNote: r.moderationNote, createdAt: r.createdAt };
  }

  // ───────── Audit log ─────────

  async audit(q: { page: number; pageSize: number; entityType?: string; entityId?: string; actorUserId?: string; action?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.db.auditLog.count({ where }),
      this.db.auditLog.findMany({ where, include: { actor: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return {
      page: q.page, pageSize: q.pageSize, total,
      items: rows.map((a) => ({ id: a.id, actorUserId: a.actorUserId, actorName: a.actor?.fullName ?? null, actorRole: a.actorRole, action: a.action, entityType: a.entityType, entityId: a.entityId, before: a.before, after: a.after, ipAddress: a.ipAddress, createdAt: a.createdAt })),
    };
  }
}
