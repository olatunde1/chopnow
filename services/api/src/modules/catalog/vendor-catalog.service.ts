import { randomBytes } from 'node:crypto';
import type { MenuItemInput, RestaurantCreate, RestaurantUpdate } from '@chopnow/shared-schemas';
import { validateOpeningWindows, type OpeningWindow } from '@chopnow/shared-utils';
import type { Db, Tx } from '../../db/client.js';
import { Prisma, type Restaurant, type RestaurantHours } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import { writeAudit, type RequestContext } from '../audit/audit.js';
import type { Principal } from '../auth/auth.service.js';
import { getBusinessRules } from '../settings/business-rules.js';
import { assertOwnMediaUrl } from '../storage/uploads.js';
import { isRestaurantOpen, menuInclude, toMenuDto, toMenuItemDto } from './menu-view.js';

export const MAX_RESTAURANTS_PER_VENDOR = 5;

export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip combining accents left by NFKD (é -> e)
    .toLowerCase()
    .replace(/['\p{Pi}\p{Pf}]/gu, '') // apostrophes and curly quotes: "Mama’s" -> "mamas"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'restaurant';
}

/**
 * Restaurant profile, opening hours, availability and menu management for vendors.
 * Every method takes the caller and loads records through `ownedRestaurant`, so a vendor can never
 * read or change another vendor's restaurant (they get 404, not 403, to avoid confirming it exists).
 */
export class VendorCatalogService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    /** Image URLs must point at ChopNow's own media storage. */
    private readonly mediaBaseUrl = 'http://localhost:4000/media',
  ) {}

  private async ownedRestaurant(principal: Principal, restaurantId: string, tx: Db | Tx = this.db) {
    const r = await tx.restaurant.findFirst({ where: { id: restaurantId, ownerId: principal.userId }, include: { hours: true } });
    if (!r) throw Errors.notFound('Restaurant');
    return r;
  }

  private toVendorDto(r: Restaurant & { hours: RestaurantHours[] }) {
    const hours = [...r.hours]
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt - b.opensAt)
      .map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt }));
    return { ...r, hours, isOpenNow: isRestaurantOpen(hours, this.now()) };
  }

  // ───────── Restaurants ─────────

  async listOwn(principal: Principal) {
    const rows = await this.db.restaurant.findMany({ where: { ownerId: principal.userId }, include: { hours: true }, orderBy: { createdAt: 'asc' } });
    return { items: rows.map((r) => this.toVendorDto(r)) };
  }

  async getOwn(principal: Principal, restaurantId: string) {
    return this.toVendorDto(await this.ownedRestaurant(principal, restaurantId));
  }

  /** Creates a restaurant application. It starts PENDING and not accepting orders until an admin approves it. */
  async create(principal: Principal, input: RestaurantCreate, ctx: RequestContext) {
    const count = await this.db.restaurant.count({ where: { ownerId: principal.userId } });
    if (count >= MAX_RESTAURANTS_PER_VENDOR) {
      throw Errors.conflict('RESTAURANT_LIMIT', `A vendor account can register up to ${MAX_RESTAURANTS_PER_VENDOR} restaurants`);
    }
    const rules = await getBusinessRules(this.db);
    const base = slugify(input.name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      try {
        const created = await this.db.$transaction(async (tx) => {
          const r = await tx.restaurant.create({
            data: {
              ...input,
              slug,
              ownerId: principal.userId,
              deliveryRadiusMeters: rules.orders.defaultDeliveryRadiusMeters,
            },
            include: { hours: true },
          });
          await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'restaurant.create', entityType: 'Restaurant', entityId: r.id, after: { name: r.name, slug } }, ctx);
          return r;
        });
        return this.toVendorDto(created);
      } catch (err) {
        const slugTaken = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!slugTaken) throw err;
      }
    }
    throw new AppError(409, 'SLUG_UNAVAILABLE', 'Could not create a unique web address for this name. Try a slightly different name.');
  }

  async update(principal: Principal, restaurantId: string, input: RestaurantUpdate, ctx: RequestContext) {
    const before = await this.ownedRestaurant(principal, restaurantId);
    assertOwnMediaUrl(input.logoUrl, this.mediaBaseUrl);
    assertOwnMediaUrl(input.coverImageUrl, this.mediaBaseUrl);
    const updated = await this.db.$transaction(async (tx) => {
      const r = await tx.restaurant.update({ where: { id: restaurantId }, data: input, include: { hours: true } });
      const changed = Object.fromEntries(Object.keys(input).map((k) => [k, (before as Record<string, unknown>)[k] ?? null]));
      await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'restaurant.update', entityType: 'Restaurant', entityId: r.id, before: changed as Prisma.InputJsonValue, after: input as Prisma.InputJsonValue }, ctx);
      return r;
    });
    return this.toVendorDto(updated);
  }

  async replaceHours(principal: Principal, restaurantId: string, windows: OpeningWindow[], ctx: RequestContext) {
    await this.ownedRestaurant(principal, restaurantId);
    const problem = validateOpeningWindows(windows);
    if (problem) throw Errors.validation([{ in: 'body', path: 'windows', message: problem }]);
    const updated = await this.db.$transaction(async (tx) => {
      await tx.restaurantHours.deleteMany({ where: { restaurantId } });
      await tx.restaurantHours.createMany({ data: windows.map((w) => ({ ...w, restaurantId })) });
      await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'restaurant.hours_update', entityType: 'Restaurant', entityId: restaurantId, after: { windows } as unknown as Prisma.InputJsonValue }, ctx);
      return this.ownedRestaurant(principal, restaurantId, tx);
    });
    return this.toVendorDto(updated);
  }

  /** The vendor's "open for orders" switch. Only approved restaurants with opening hours can switch it on. */
  async setAvailability(principal: Principal, restaurantId: string, isAcceptingOrders: boolean, ctx: RequestContext) {
    const r = await this.ownedRestaurant(principal, restaurantId);
    if (isAcceptingOrders && r.verificationStatus !== 'APPROVED') {
      throw Errors.conflict('RESTAURANT_NOT_APPROVED', 'Your restaurant must be approved before it can accept orders');
    }
    if (isAcceptingOrders && r.hours.length === 0) {
      throw Errors.conflict('NO_OPENING_HOURS', 'Set your opening hours before accepting orders');
    }
    const updated = await this.db.$transaction(async (tx) => {
      const u = await tx.restaurant.update({ where: { id: restaurantId }, data: { isAcceptingOrders }, include: { hours: true } });
      await writeAudit(tx, { actorUserId: principal.userId, actorRole: principal.role, action: 'restaurant.availability', entityType: 'Restaurant', entityId: restaurantId, before: { isAcceptingOrders: r.isAcceptingOrders }, after: { isAcceptingOrders } }, ctx);
      return u;
    });
    return this.toVendorDto(updated);
  }

  // ───────── Menu ─────────

  async getMenu(principal: Principal, restaurantId: string) {
    await this.ownedRestaurant(principal, restaurantId);
    const r = await this.db.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, include: menuInclude });
    return toMenuDto(r, 'vendor');
  }

  private async ownedCategory(principal: Principal, restaurantId: string, categoryId: string, tx: Db | Tx = this.db) {
    const c = await tx.menuCategory.findFirst({ where: { id: categoryId, restaurantId, restaurant: { ownerId: principal.userId } } });
    if (!c) throw Errors.notFound('Menu category');
    return c;
  }

  private async ownedItem(principal: Principal, restaurantId: string, itemId: string, tx: Db | Tx = this.db) {
    const item = await tx.menuItem.findFirst({
      where: { id: itemId, restaurantId, deletedAt: null, restaurant: { ownerId: principal.userId } },
      include: { variants: true, extras: true },
    });
    if (!item) throw Errors.notFound('Menu item');
    return item;
  }

  async createCategory(principal: Principal, restaurantId: string, input: { name: string; sortOrder?: number; isActive?: boolean }) {
    await this.ownedRestaurant(principal, restaurantId);
    try {
      const c = await this.db.menuCategory.create({ data: { ...input, restaurantId } });
      return { ...c, items: [] };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('CATEGORY_EXISTS', 'A category with this name already exists');
      }
      throw err;
    }
  }

  async updateCategory(principal: Principal, restaurantId: string, categoryId: string, input: { name?: string; sortOrder?: number; isActive?: boolean }) {
    await this.ownedCategory(principal, restaurantId, categoryId);
    try {
      const c = await this.db.menuCategory.update({ where: { id: categoryId }, data: input });
      return { ...c, items: [] };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('CATEGORY_EXISTS', 'A category with this name already exists');
      }
      throw err;
    }
  }

  async deleteCategory(principal: Principal, restaurantId: string, categoryId: string) {
    await this.ownedCategory(principal, restaurantId, categoryId);
    const live = await this.db.menuItem.count({ where: { categoryId, deletedAt: null } });
    if (live > 0) throw Errors.conflict('CATEGORY_NOT_EMPTY', 'Move or delete the items in this category first');
    const anyItems = await this.db.menuItem.count({ where: { categoryId } });
    // Categories referenced by (soft-deleted) items that appear in past orders are hidden, not deleted.
    if (anyItems > 0) await this.db.menuCategory.update({ where: { id: categoryId }, data: { isActive: false } });
    else await this.db.menuCategory.delete({ where: { id: categoryId } });
    return { ok: true as const };
  }

  async createItem(principal: Principal, restaurantId: string, input: MenuItemInput) {
    await this.ownedRestaurant(principal, restaurantId);
    assertOwnMediaUrl(input.imageUrl, this.mediaBaseUrl);
    return this.db.$transaction(async (tx) => {
      await this.ownedCategory(principal, restaurantId, input.categoryId, tx);
      const { variants, extras, ...fields } = input;
      const created = await tx.menuItem.create({
        data: {
          ...fields,
          restaurantId,
          variants: { create: normaliseVariants(variants).map(({ id: _id, ...v }, i) => ({ ...v, sortOrder: i })) },
          extras: { create: extras.map(({ id: _id, ...e }, i) => ({ ...e, sortOrder: i })) },
        },
        include: { variants: true, extras: true },
      });
      return toMenuItemDto(created);
    });
  }

  /**
   * Replaces an item's definition. Variants/extras with an `id` are updated, ones without are created,
   * and existing ones missing from the request are retired (soft-deleted) so past orders stay intact.
   */
  async updateItem(principal: Principal, restaurantId: string, itemId: string, input: MenuItemInput) {
    assertOwnMediaUrl(input.imageUrl, this.mediaBaseUrl);
    return this.db.$transaction(async (tx) => {
      const existing = await this.ownedItem(principal, restaurantId, itemId, tx);
      await this.ownedCategory(principal, restaurantId, input.categoryId, tx);
      const { variants, extras, ...fields } = input;
      await tx.menuItem.update({ where: { id: itemId }, data: fields });
      await syncOptions(tx, 'variant', itemId, existing.variants, normaliseVariants(variants));
      await syncOptions(tx, 'extra', itemId, existing.extras, extras);
      const updated = await tx.menuItem.findUniqueOrThrow({ where: { id: itemId }, include: { variants: true, extras: true } });
      return toMenuItemDto(updated);
    });
  }

  async setItemAvailability(principal: Principal, restaurantId: string, itemId: string, isAvailable: boolean) {
    await this.ownedItem(principal, restaurantId, itemId);
    const updated = await this.db.menuItem.update({ where: { id: itemId }, data: { isAvailable }, include: { variants: true, extras: true } });
    return toMenuItemDto(updated);
  }

  /** Soft delete: the item disappears from menus but past orders keep referencing it. */
  async deleteItem(principal: Principal, restaurantId: string, itemId: string) {
    await this.ownedItem(principal, restaurantId, itemId);
    await this.db.menuItem.update({ where: { id: itemId }, data: { deletedAt: this.now(), isAvailable: false } });
    return { ok: true as const };
  }
}

type VariantIn = MenuItemInput['variants'][number];
type ExtraIn = MenuItemInput['extras'][number];

/** Ensures exactly one default variant when variants exist (the first, unless one is marked). */
function normaliseVariants(variants: VariantIn[]): VariantIn[] {
  if (variants.length === 0) return variants;
  const hasDefault = variants.some((v) => v.isDefault);
  return variants.map((v, i) => ({ ...v, isDefault: hasDefault ? v.isDefault : i === 0 }));
}

async function syncOptions(
  tx: Tx,
  kind: 'variant' | 'extra',
  menuItemId: string,
  existing: { id: string; deletedAt: Date | null }[],
  wanted: (VariantIn | ExtraIn)[],
) {
  const live = new Set(existing.filter((e) => e.deletedAt === null).map((e) => e.id));
  for (const w of wanted) {
    if (w.id && !live.has(w.id)) {
      throw Errors.validation([{ in: 'body', path: `${kind}s`, message: `Unknown ${kind} id ${w.id} for this item` }]);
    }
  }
  const keep = new Set(wanted.filter((w) => w.id).map((w) => w.id!));
  const retire = [...live].filter((id) => !keep.has(id));
  const now = new Date();

  if (kind === 'variant') {
    // Clear defaults first so the one-default partial unique index is never violated mid-update.
    await tx.menuItemVariant.updateMany({ where: { menuItemId }, data: { isDefault: false } });
    if (retire.length) await tx.menuItemVariant.updateMany({ where: { id: { in: retire } }, data: { deletedAt: now, isDefault: false } });
    for (const [i, w] of (wanted as VariantIn[]).entries()) {
      const { id, ...data } = w;
      if (id) await tx.menuItemVariant.update({ where: { id }, data: { ...data, sortOrder: i } });
      else await tx.menuItemVariant.create({ data: { ...data, menuItemId, sortOrder: i } });
    }
  } else {
    if (retire.length) await tx.menuItemExtra.updateMany({ where: { id: { in: retire } }, data: { deletedAt: now } });
    for (const [i, w] of (wanted as ExtraIn[]).entries()) {
      const { id, ...data } = w;
      if (id) await tx.menuItemExtra.update({ where: { id }, data: { ...data, sortOrder: i } });
      else await tx.menuItemExtra.create({ data: { ...data, menuItemId, sortOrder: i } });
    }
  }
}
