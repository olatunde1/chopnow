import { z } from 'zod';
import { APPROVAL_STATUSES } from './enums.js';
import { DateTimeSchema, IdSchema, KoboSchema, LatitudeSchema, LongitudeSchema, optionalText, text } from './common.js';
import { EmailSchema, NigerianPhoneSchema } from './auth.js';

// ───────── Restaurant (vendor side) ─────────

export const OpeningWindowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  opensAt: z.number().int().min(0).max(1440),
  closesAt: z.number().int().min(0).max(1440),
});

export const RestaurantCreateSchema = z
  .object({
    name: text(80).min(2, 'Enter the restaurant name'),
    description: optionalText(500),
    phone: NigerianPhoneSchema,
    email: EmailSchema.optional(),
    addressLine: text(160).min(3),
    area: text(80).min(2),
    city: text(80).min(2),
    latitude: LatitudeSchema,
    longitude: LongitudeSchema,
    prepTimeMinutes: z.number().int().min(5).max(180).default(20),
    minOrderKobo: KoboSchema.default(0),
  })
  .strict();
export type RestaurantCreate = z.infer<typeof RestaurantCreateSchema>;

/** Vendors cannot change verification, commission, rating or ownership fields. */
export const RestaurantUpdateSchema = RestaurantCreateSchema.partial()
  .extend({
    logoUrl: z.url().max(500).nullable().optional(),
    coverImageUrl: z.url().max(500).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), 'Send latitude and longitude together');
export type RestaurantUpdate = z.infer<typeof RestaurantUpdateSchema>;

export const OpeningHoursUpdateSchema = z.object({ windows: z.array(OpeningWindowSchema).max(28) }).strict();
export const AvailabilityUpdateSchema = z.object({ isAcceptingOrders: z.boolean() }).strict();

export const VendorRestaurantSchema = z.object({
  id: IdSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  logoUrl: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  addressLine: z.string(),
  area: z.string(),
  city: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  verificationStatus: z.enum(APPROVAL_STATUSES),
  verificationNote: z.string().nullable(),
  isAcceptingOrders: z.boolean(),
  isOpenNow: z.boolean(),
  prepTimeMinutes: z.number().int(),
  minOrderKobo: z.number().int(),
  deliveryRadiusMeters: z.number().int(),
  ratingAverage: z.number().nullable(),
  ratingCount: z.number().int(),
  hours: z.array(OpeningWindowSchema),
  createdAt: DateTimeSchema,
});
export type VendorRestaurantDto = z.infer<typeof VendorRestaurantSchema>;

// ───────── Menu (vendor side) ─────────

export const CategoryInputSchema = z
  .object({
    name: text(60).min(1),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export const CategoryUpdateSchema = CategoryInputSchema.partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const VariantInputSchema = z
  .object({
    /** Present when updating an existing variant; omitted to create one. */
    id: IdSchema.optional(),
    name: text(40).min(1),
    priceKobo: KoboSchema,
    isDefault: z.boolean().default(false),
    isAvailable: z.boolean().default(true),
  })
  .strict();

const ExtraInputSchema = z
  .object({
    id: IdSchema.optional(),
    name: text(60).min(1),
    priceKobo: KoboSchema,
    maxQuantity: z.number().int().min(1).max(20).default(1),
    isAvailable: z.boolean().default(true),
  })
  .strict();

/**
 * Full item definition. `variants` and `extras` are the complete desired lists: existing ones not
 * included are retired (soft-deleted, so past orders keep their references).
 */
export const MenuItemInputSchema = z
  .object({
    categoryId: IdSchema,
    name: text(80).min(2),
    description: optionalText(500),
    imageUrl: z.url().max(500).nullable().optional(),
    priceKobo: KoboSchema,
    isAvailable: z.boolean().default(true),
    prepTimeMinutes: z.number().int().min(1).max(180).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    variants: z.array(VariantInputSchema).max(10).default([]),
    extras: z.array(ExtraInputSchema).max(20).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.variants.filter((x) => x.isDefault).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Only one variant can be the default' });
    }
    const names = v.variants.map((x) => x.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Variant names must be unique' });
    }
    const extraNames = v.extras.map((x) => x.name.toLowerCase());
    if (new Set(extraNames).size !== extraNames.length) {
      ctx.addIssue({ code: 'custom', path: ['extras'], message: 'Extra names must be unique' });
    }
  });
export type MenuItemInput = z.infer<typeof MenuItemInputSchema>;

export const ItemAvailabilitySchema = z.object({ isAvailable: z.boolean() }).strict();

// ───────── Menu views ─────────

export const VariantSchema = z.object({ id: IdSchema, name: z.string(), priceKobo: z.number().int(), isDefault: z.boolean(), isAvailable: z.boolean() });
export const ExtraSchema = z.object({ id: IdSchema, name: z.string(), priceKobo: z.number().int(), maxQuantity: z.number().int(), isAvailable: z.boolean() });

export const MenuItemSchema = z.object({
  id: IdSchema,
  categoryId: IdSchema,
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  priceKobo: z.number().int(),
  /** Lowest price a customer can pay for the item (cheapest available variant, or the base price). */
  fromPriceKobo: z.number().int(),
  isAvailable: z.boolean(),
  prepTimeMinutes: z.number().int().nullable(),
  variants: z.array(VariantSchema),
  extras: z.array(ExtraSchema),
});
export type MenuItemDto = z.infer<typeof MenuItemSchema>;

export const MenuCategorySchema = z.object({
  id: IdSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  items: z.array(MenuItemSchema),
});
export const MenuSchema = z.object({ restaurantId: IdSchema, categories: z.array(MenuCategorySchema) });
export type MenuDto = z.infer<typeof MenuSchema>;
