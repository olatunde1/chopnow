import { isOpenAt } from '@chopnow/shared-utils';
import type { Prisma } from '../../generated/prisma/client.js';

/** Prisma include for a full, non-deleted menu. */
export const menuInclude = {
  categories: {
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      items: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          variants: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
          extras: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        },
      },
    },
  },
} satisfies Prisma.RestaurantInclude;

export type MenuItemWithOptions = Prisma.MenuItemGetPayload<{ include: { variants: true; extras: true } }>;
type RestaurantWithMenu = Prisma.RestaurantGetPayload<{ include: typeof menuInclude }>;

/**
 * The lowest price a customer can pay for an item: the cheapest available variant when the item has
 * variants (falling back to all variants if every one is sold out), otherwise the base price.
 */
export function fromPrice(item: Pick<MenuItemWithOptions, 'priceKobo' | 'variants'>): number {
  const live = item.variants.filter((v) => v.deletedAt === null);
  if (live.length === 0) return item.priceKobo;
  const pool = live.some((v) => v.isAvailable) ? live.filter((v) => v.isAvailable) : live;
  return Math.min(...pool.map((v) => v.priceKobo));
}

export function toMenuItemDto(item: MenuItemWithOptions) {
  return {
    id: item.id,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description,
    imageUrl: item.imageUrl,
    priceKobo: item.priceKobo,
    fromPriceKobo: fromPrice(item),
    isAvailable: item.isAvailable,
    prepTimeMinutes: item.prepTimeMinutes,
    variants: item.variants
      .filter((v) => v.deletedAt === null)
      .map((v) => ({ id: v.id, name: v.name, priceKobo: v.priceKobo, isDefault: v.isDefault, isAvailable: v.isAvailable })),
    extras: item.extras
      .filter((e) => e.deletedAt === null)
      .map((e) => ({ id: e.id, name: e.name, priceKobo: e.priceKobo, maxQuantity: e.maxQuantity, isAvailable: e.isAvailable })),
  };
}

/**
 * Vendor view: every category (active or not) and every non-deleted item.
 * Customer view: active categories with at least one item; sold-out items stay visible but flagged.
 */
export function toMenuDto(restaurant: RestaurantWithMenu, audience: 'vendor' | 'customer') {
  const categories = restaurant.categories
    .filter((c) => audience === 'vendor' || c.isActive)
    .map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder, isActive: c.isActive, items: c.items.map(toMenuItemDto) }))
    .filter((c) => audience === 'vendor' || c.items.length > 0);
  return { restaurantId: restaurant.id, categories };
}

export function isRestaurantOpen(hours: { dayOfWeek: number; opensAt: number; closesAt: number }[], now: Date): boolean {
  return isOpenAt(hours, now);
}
