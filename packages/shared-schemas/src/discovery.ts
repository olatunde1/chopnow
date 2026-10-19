import { z } from 'zod';
import { IdSchema, LatitudeQuery, LongitudeQuery, PageQuerySchema, paginated } from './common.js';
import { MenuSchema, OpeningWindowSchema } from './catalog.js';

const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

/**
 * Customer location (lat/lng) is optional for browsing; without it, results are not filtered by
 * delivery radius and show no delivery fee. When given, both values are required.
 */
const pairedLocation = (v: { lat?: number; lng?: number }) => (v.lat === undefined) === (v.lng === undefined);

export const RESTAURANT_SORTS = ['recommended', 'distance', 'rating', 'prep_time', 'name'] as const;
export const FOOD_SORTS = ['relevance', 'price_asc', 'price_desc', 'distance', 'rating', 'prep_time'] as const;

export const RestaurantSearchQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  sort: z.enum(RESTAURANT_SORTS).default('recommended'),
  /** Include restaurants that are closed or paused (shown as not accepting orders). Default false. */
  includeClosed: booleanQuery,
  lat: LatitudeQuery.optional(),
  lng: LongitudeQuery.optional(),
}).superRefine((v, ctx) => {
  if (!pairedLocation(v)) ctx.addIssue({ code: 'custom', path: ['lat'], message: 'Send lat and lng together' });
});
export type RestaurantSearchQuery = z.infer<typeof RestaurantSearchQuerySchema>;

export const FoodSearchQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(80),
  sort: z.enum(FOOD_SORTS).default('relevance'),
  minPriceKobo: z.coerce.number().int().min(0).optional(),
  maxPriceKobo: z.coerce.number().int().min(0).optional(),
  /** Include sold-out items and closed restaurants (flagged as not orderable). Default false. */
  includeUnavailable: booleanQuery,
  category: z.string().trim().max(60).optional(),
  lat: LatitudeQuery.optional(),
  lng: LongitudeQuery.optional(),
}).superRefine((v, ctx) => {
  if (!pairedLocation(v)) ctx.addIssue({ code: 'custom', path: ['lat'], message: 'Send lat and lng together' });
  if (v.minPriceKobo !== undefined && v.maxPriceKobo !== undefined && v.minPriceKobo > v.maxPriceKobo) {
    ctx.addIssue({ code: 'custom', path: ['minPriceKobo'], message: 'Minimum price is above the maximum' });
  }
});
export type FoodSearchQuery = z.infer<typeof FoodSearchQuerySchema>;

export const LocationOnlyQuerySchema = z
  .object({ lat: LatitudeQuery.optional(), lng: LongitudeQuery.optional() })
  .refine(pairedLocation, 'Send lat and lng together');

/** What a customer needs to compare restaurants. */
export const RestaurantSummarySchema = z.object({
  id: IdSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  area: z.string(),
  ratingAverage: z.number().nullable(),
  ratingCount: z.number().int(),
  prepTimeMinutes: z.number().int(),
  minOrderKobo: z.number().int(),
  isOpenNow: z.boolean(),
  /** True only when approved, switched on by the vendor, open now and (if location given) in range. */
  isAcceptingOrders: z.boolean(),
  /** Null when no customer location was supplied. */
  distanceMeters: z.number().int().nullable(),
  deliveryFeeKobo: z.number().int().nullable(),
  /** Null when no location was supplied. */
  deliversToLocation: z.boolean().nullable(),
  isFavourite: z.boolean(),
});
export type RestaurantSummaryDto = z.infer<typeof RestaurantSummarySchema>;

export const RestaurantListResponseSchema = paginated(RestaurantSummarySchema);

export const RestaurantDetailSchema = RestaurantSummarySchema.extend({
  addressLine: z.string(),
  hours: z.array(OpeningWindowSchema),
  menu: MenuSchema,
});
export type RestaurantDetailDto = z.infer<typeof RestaurantDetailSchema>;

export const FoodResultSchema = z.object({
  item: z.object({
    id: IdSchema,
    name: z.string(),
    description: z.string().nullable(),
    imageUrl: z.string().nullable(),
    categoryName: z.string(),
    fromPriceKobo: z.number().int(),
    isAvailable: z.boolean(),
    hasVariants: z.boolean(),
    hasExtras: z.boolean(),
  }),
  restaurant: RestaurantSummarySchema,
  /** Item available and restaurant accepting orders (and in range, if location given). */
  orderable: z.boolean(),
});
export type FoodResultDto = z.infer<typeof FoodResultSchema>;
export const FoodSearchResponseSchema = paginated(FoodResultSchema);

export const CategoryListResponseSchema = z.object({
  categories: z.array(z.object({ name: z.string(), itemCount: z.number().int() })),
});
