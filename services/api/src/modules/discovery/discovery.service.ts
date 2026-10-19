import type { FoodSearchQuery, RestaurantSearchQuery } from '@chopnow/shared-schemas';
import { computeDeliveryFee, distanceMeters, isOpenAt, type LatLng } from '@chopnow/shared-utils';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { Errors } from '../../lib/errors.js';
import type { Principal } from '../auth/auth.service.js';
import { menuInclude, toMenuDto, fromPrice } from '../catalog/menu-view.js';
import { getBusinessRules, type BusinessRules } from '../settings/business-rules.js';

type RestaurantWithHours = Prisma.RestaurantGetPayload<{ include: { hours: true } }>;

/** Only approved restaurants are ever visible to customers. */
const VISIBLE: Prisma.RestaurantWhereInput = { verificationStatus: 'APPROVED' };

/** Upper bound on candidate rows scanned per search (pilot scale: one neighbourhood). */
const MAX_CANDIDATES = 500;

function paginate<T>(rows: T[], page: number, pageSize: number) {
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length };
}

function locationOf(q: { lat?: number; lng?: number }): LatLng | null {
  return q.lat !== undefined && q.lng !== undefined ? { latitude: q.lat, longitude: q.lng } : null;
}

/**
 * Customer discovery. Eligibility rules:
 * - unapproved restaurants never appear;
 * - with a location, restaurants that cannot deliver there are excluded;
 * - restaurants that are closed or paused are excluded by default, or shown flagged
 *   `isAcceptingOrders: false` when the client asks to include them. They are never presented as
 *   accepting orders.
 */
export class DiscoveryService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private summarise(r: RestaurantWithHours, loc: LatLng | null, rules: BusinessRules, favourites: Set<string>) {
    const isOpenNow = isOpenAt(r.hours, this.now());
    const hasCoords = r.latitude !== null && r.longitude !== null;
    const distance = loc && hasCoords ? distanceMeters(loc, { latitude: r.latitude!, longitude: r.longitude! }) : null;
    const deliversToLocation = loc ? distance !== null && distance <= r.deliveryRadiusMeters : null;
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      logoUrl: r.logoUrl,
      coverImageUrl: r.coverImageUrl,
      area: r.area,
      ratingAverage: r.ratingAverage,
      ratingCount: r.ratingCount,
      prepTimeMinutes: r.prepTimeMinutes,
      minOrderKobo: r.minOrderKobo,
      isOpenNow,
      isAcceptingOrders: r.verificationStatus === 'APPROVED' && r.isAcceptingOrders && isOpenNow && deliversToLocation !== false,
      distanceMeters: distance,
      deliveryFeeKobo: distance !== null && deliversToLocation ? computeDeliveryFee(distance, rules.pricing) : null,
      deliversToLocation,
      isFavourite: favourites.has(r.id),
    };
  }

  private async favourites(principal: Principal | null): Promise<Set<string>> {
    if (!principal) return new Set();
    const rows = await this.db.favouriteRestaurant.findMany({ where: { userId: principal.userId }, select: { restaurantId: true } });
    return new Set(rows.map((r) => r.restaurantId));
  }

  async listRestaurants(query: RestaurantSearchQuery, principal: Principal | null) {
    const loc = locationOf(query);
    const [rules, favs, rows] = await Promise.all([
      getBusinessRules(this.db),
      this.favourites(principal),
      this.db.restaurant.findMany({
        where: { ...VISIBLE, ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}) },
        include: { hours: true },
        take: MAX_CANDIDATES,
      }),
    ]);
    let results = rows
      .map((r) => this.summarise(r, loc, rules, favs))
      .filter((s) => s.deliversToLocation !== false)
      .filter((s) => query.includeClosed || s.isAcceptingOrders);

    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const dist = (s: { distanceMeters: number | null }) => s.distanceMeters ?? Number.MAX_SAFE_INTEGER;
    const rating = (s: { ratingAverage: number | null }) => s.ratingAverage ?? 0;
    const sorters: Record<RestaurantSearchQuery['sort'], (a: (typeof results)[number], b: (typeof results)[number]) => number> = {
      recommended: (a, b) => Number(b.isAcceptingOrders) - Number(a.isAcceptingOrders) || rating(b) - rating(a) || dist(a) - dist(b) || byName(a, b),
      distance: (a, b) => dist(a) - dist(b) || byName(a, b),
      rating: (a, b) => rating(b) - rating(a) || b.ratingCount - a.ratingCount || byName(a, b),
      prep_time: (a, b) => a.prepTimeMinutes - b.prepTimeMinutes || byName(a, b),
      name: byName,
    };
    results = results.sort(sorters[query.sort]);
    return paginate(results, query.page, query.pageSize);
  }

  async listFavourites(principal: Principal, loc: LatLng | null) {
    const [rules, favs] = await Promise.all([getBusinessRules(this.db), this.favourites(principal)]);
    const rows = await this.db.restaurant.findMany({ where: { ...VISIBLE, id: { in: [...favs] } }, include: { hours: true }, orderBy: { name: 'asc' } });
    return { items: rows.map((r) => this.summarise(r, loc, rules, favs)) };
  }

  async getRestaurant(slug: string, loc: LatLng | null, principal: Principal | null) {
    const r = await this.db.restaurant.findFirst({ where: { ...VISIBLE, slug }, include: { hours: true, ...menuInclude } });
    if (!r) throw Errors.notFound('Restaurant');
    const [rules, favs] = await Promise.all([getBusinessRules(this.db), this.favourites(principal)]);
    return {
      ...this.summarise(r, loc, rules, favs),
      addressLine: r.addressLine,
      hours: r.hours
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt - b.opensAt)
        .map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt })),
      menu: toMenuDto(r, 'customer'),
    };
  }

  /**
   * Food-first search across item names, descriptions and category names. Candidate rows come from a
   * trigram-indexed LIKE on lower(name); eligibility, price filters and ranking are applied in code.
   */
  async searchFood(query: FoodSearchQuery, principal: Principal | null) {
    const loc = locationOf(query);
    const term = query.q.toLowerCase();
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const ids = await this.db.$queryRaw<{ id: string }[]>`
      SELECT mi.id
      FROM menu_items mi
      JOIN restaurants r ON r.id = mi."restaurantId"
      JOIN menu_categories c ON c.id = mi."categoryId"
      WHERE r."verificationStatus" = 'APPROVED'
        AND mi."deletedAt" IS NULL
        AND c."isActive"
        AND (lower(mi.name) LIKE ${like} OR lower(coalesce(mi.description, '')) LIKE ${like} OR lower(c.name) LIKE ${like})
      LIMIT ${MAX_CANDIDATES}`;
    if (ids.length === 0) return paginate([], query.page, query.pageSize);

    const [rules, favs, items] = await Promise.all([
      getBusinessRules(this.db),
      this.favourites(principal),
      this.db.menuItem.findMany({
        where: { id: { in: ids.map((i) => i.id) } },
        include: {
          category: true,
          restaurant: { include: { hours: true } },
          variants: { where: { deletedAt: null } },
          extras: { where: { deletedAt: null } },
        },
      }),
    ]);

    const summaries = new Map<string, ReturnType<DiscoveryService['summarise']>>();
    const summaryFor = (r: RestaurantWithHours) => {
      let s = summaries.get(r.id);
      if (!s) summaries.set(r.id, (s = this.summarise(r, loc, rules, favs)));
      return s;
    };

    const category = query.category?.toLowerCase();
    let results = items
      .map((item) => {
        const restaurant = summaryFor(item.restaurant);
        const price = fromPrice(item);
        const anyVariantAvailable = item.variants.length === 0 || item.variants.some((v) => v.isAvailable);
        const itemAvailable = item.isAvailable && anyVariantAvailable;
        const nameLc = item.name.toLowerCase();
        const relevance = nameLc.startsWith(term) ? 3 : new RegExp(`\\b${escapeRegExp(term)}`).test(nameLc) ? 2 : nameLc.includes(term) ? 1 : 0;
        return {
          relevance,
          item: {
            id: item.id,
            name: item.name,
            description: item.description,
            imageUrl: item.imageUrl,
            categoryName: item.category.name,
            fromPriceKobo: price,
            isAvailable: itemAvailable,
            hasVariants: item.variants.length > 0,
            hasExtras: item.extras.some((e) => e.isAvailable),
          },
          restaurant,
          orderable: itemAvailable && restaurant.isAcceptingOrders,
        };
      })
      .filter((r) => r.restaurant.deliversToLocation !== false)
      .filter((r) => query.includeUnavailable || r.orderable)
      .filter((r) => query.minPriceKobo === undefined || r.item.fromPriceKobo >= query.minPriceKobo)
      .filter((r) => query.maxPriceKobo === undefined || r.item.fromPriceKobo <= query.maxPriceKobo)
      .filter((r) => !category || r.item.categoryName.toLowerCase() === category);

    type Row = (typeof results)[number];
    const dist = (r: Row) => r.restaurant.distanceMeters ?? Number.MAX_SAFE_INTEGER;
    const rating = (r: Row) => r.restaurant.ratingAverage ?? 0;
    const tie = (a: Row, b: Row) => a.item.name.localeCompare(b.item.name) || a.restaurant.name.localeCompare(b.restaurant.name);
    const sorters: Record<FoodSearchQuery['sort'], (a: Row, b: Row) => number> = {
      relevance: (a, b) => Number(b.orderable) - Number(a.orderable) || b.relevance - a.relevance || rating(b) - rating(a) || dist(a) - dist(b) || tie(a, b),
      price_asc: (a, b) => a.item.fromPriceKobo - b.item.fromPriceKobo || tie(a, b),
      price_desc: (a, b) => b.item.fromPriceKobo - a.item.fromPriceKobo || tie(a, b),
      distance: (a, b) => dist(a) - dist(b) || tie(a, b),
      rating: (a, b) => rating(b) - rating(a) || tie(a, b),
      prep_time: (a, b) => a.restaurant.prepTimeMinutes - b.restaurant.prepTimeMinutes || tie(a, b),
    };
    results = results.sort(sorters[query.sort]);
    const page = paginate(results, query.page, query.pageSize);
    return { ...page, items: page.items.map(({ relevance: _r, ...rest }) => rest) };
  }

  /** Food categories with orderable items at currently visible restaurants (case-insensitive grouping). */
  async listCategories() {
    const rows = await this.db.menuCategory.findMany({
      where: { isActive: true, restaurant: { ...VISIBLE, isAcceptingOrders: true } },
      select: { name: true, _count: { select: { items: { where: { deletedAt: null, isAvailable: true } } } } },
    });
    const grouped = new Map<string, { name: string; itemCount: number }>();
    for (const r of rows) {
      if (r._count.items === 0) continue;
      const key = r.name.trim().toLowerCase();
      const g = grouped.get(key) ?? { name: r.name.trim(), itemCount: 0 };
      g.itemCount += r._count.items;
      grouped.set(key, g);
    }
    return { categories: [...grouped.values()].sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name)) };
  }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
