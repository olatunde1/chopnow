import { z } from 'zod';
import { ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from './enums.js';
import { DateTimeSchema, IdSchema, PageQuerySchema, paginated } from './common.js';
import { DELIVERY_STATUSES, PublicRiderSchema } from './rider.js';

// ───────── Vendor order workflow ─────────

export const VENDOR_ORDER_VIEWS = ['incoming', 'active', 'history'] as const;
export const VendorOrderQuerySchema = PageQuerySchema.extend({
  view: z.enum(VENDOR_ORDER_VIEWS).default('active'),
  q: z.string().trim().max(20).optional(),
});

/** Standard reasons keep reporting clean; `note` adds detail for the customer. */
export const REJECTION_REASONS = ['ITEM_UNAVAILABLE', 'TOO_BUSY', 'CLOSING_SOON', 'CANNOT_DELIVER_AREA', 'OTHER'] as const;
export const RejectOrderSchema = z
  .object({ reason: z.enum(REJECTION_REASONS), note: z.string().trim().max(200).optional() })
  .strict()
  .refine((v) => v.reason !== 'OTHER' || (v.note && v.note.length >= 3), { path: ['note'], message: 'Tell the customer why' });
export const AcceptOrderSchema = z.object({ prepTimeMinutes: z.number().int().min(5).max(180).optional() }).strict();
export const DelayOrderSchema = z.object({ extraMinutes: z.number().int().min(5).max(120), note: z.string().trim().max(200).optional() }).strict();

/**
 * What a restaurant sees about an order. Deliberately excludes the customer's address, phone,
 * email and the delivery PIN: the restaurant only needs the food and a first name for the bag label.
 */
export const VendorOrderSchema = z.object({
  id: IdSchema,
  code: z.string(),
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  customerFirstName: z.string(),
  customerNote: z.string().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      variantName: z.string().nullable(),
      quantity: z.number().int(),
      specialInstructions: z.string().nullable(),
      extras: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
      lineTotalKobo: z.number().int(),
    }),
  ),
  subtotalKobo: z.number().int(),
  commissionKobo: z.number().int(),
  /** Food subtotal minus commission (before any restaurant-funded discount, settled in Phase 8). */
  estimatedEarningsKobo: z.number().int(),
  placedAt: DateTimeSchema,
  acceptDeadlineAt: DateTimeSchema.nullable(),
  acceptedAt: DateTimeSchema.nullable(),
  estimatedReadyAt: DateTimeSchema.nullable(),
  readyAt: DateTimeSchema.nullable(),
  cancellationReason: z.string().nullable(),
  /** Delivery progress once dispatch has started (null before). */
  deliveryStatus: z.enum(DELIVERY_STATUSES).nullable(),
  /** The assigned rider (first name and vehicle only), once a rider has accepted. */
  rider: PublicRiderSchema,
  /** Next actions the restaurant may take (the API enforces them regardless). */
  actions: z.array(z.enum(['accept', 'reject', 'start_preparing', 'mark_ready', 'report_delay'])),
});
export type VendorOrderDto = z.infer<typeof VendorOrderSchema>;
export const VendorOrderListSchema = paginated(VendorOrderSchema).extend({ incomingCount: z.number().int() });

// ───────── Sales report ─────────

export const SalesReportQuerySchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((v) => v.from <= v.to, { path: ['to'], message: '"to" must be on or after "from"' })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 92, { path: ['to'], message: 'Choose a range of 3 months or less' });

export const SalesReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  deliveredOrders: z.number().int(),
  cancelledOrders: z.number().int(),
  rejectedOrders: z.number().int(),
  grossFoodSalesKobo: z.number().int(),
  commissionKobo: z.number().int(),
  restaurantFundedDiscountKobo: z.number().int(),
  estimatedNetKobo: z.number().int(),
  averageOrderKobo: z.number().int(),
  days: z.array(z.object({ date: z.string(), orders: z.number().int(), grossFoodSalesKobo: z.number().int() })),
  topItems: z.array(z.object({ name: z.string(), quantity: z.number().int(), salesKobo: z.number().int() })),
});

// ───────── Reviews ─────────

export const CreateReviewSchema = z
  .object({
    restaurantRating: z.number().int().min(1).max(5),
    riderRating: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();
export const ReviewReplySchema = z.object({ reply: z.string().trim().min(2).max(1000) }).strict();

export const ReviewSchema = z.object({
  id: IdSchema,
  orderCode: z.string(),
  customerFirstName: z.string(),
  restaurantRating: z.number().int(),
  comment: z.string().nullable(),
  vendorReply: z.string().nullable(),
  vendorRepliedAt: DateTimeSchema.nullable(),
  createdAt: DateTimeSchema,
});
export const ReviewListSchema = paginated(ReviewSchema).extend({ ratingAverage: z.number().nullable(), ratingCount: z.number().int() });

// ───────── Uploads ─────────

export const IMAGE_PURPOSES = ['menu_item', 'logo', 'cover'] as const;
export const ImageUploadResultSchema = z.object({ url: z.string(), width: z.number().int(), height: z.number().int(), bytes: z.number().int() });

export const DOCUMENT_TYPES = ['CAC_CERTIFICATE', 'FOOD_HANDLER_PERMIT', 'OWNER_ID', 'OTHER'] as const;
export const VerificationDocumentSchema = z.object({
  id: IdSchema,
  type: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.string(),
  reviewNote: z.string().nullable(),
  uploadedAt: DateTimeSchema,
});
