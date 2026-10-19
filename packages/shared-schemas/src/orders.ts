import { z } from 'zod';
import { ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from './enums.js';
import { DateTimeSchema, IdSchema, PageQuerySchema, paginated } from './common.js';
import { DELIVERY_STATUSES, PublicRiderSchema } from './rider.js';

/** Idempotency-Key header format for retryable POSTs (order creation, payment initialisation). */
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, 'Idempotency-Key must be 8–128 letters, digits, dashes or underscores');

export const MAX_ORDER_LINES = 30;

export const CartLineInputSchema = z
  .object({
    menuItemId: IdSchema,
    variantId: IdSchema.nullable().optional(),
    extras: z
      .array(z.object({ extraId: IdSchema, quantity: z.number().int().min(1).max(20) }).strict())
      .max(20)
      .default([]),
    quantity: z.number().int().min(1).max(50),
    specialInstructions: z.string().trim().max(200).optional(),
  })
  .strict();
export type CartLineInput = z.infer<typeof CartLineInputSchema>;

/**
 * What the customer wants to order. Prices are deliberately absent: the server computes every
 * amount from the current menu and business rules. Any client-sent total is rejected as an unknown field.
 */
export const OrderRequestSchema = z
  .object({
    restaurantId: IdSchema,
    addressId: IdSchema,
    paymentMethod: z.enum(PAYMENT_METHODS),
    items: z.array(CartLineInputSchema).min(1, 'Your cart is empty').max(MAX_ORDER_LINES),
    promoCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,30}$/, 'Promo codes are 3–30 letters or digits')
      .optional(),
    customerNote: z.string().trim().max(300).optional(),
  })
  .strict();
export type OrderRequest = z.infer<typeof OrderRequestSchema>;

/** A problem that prevents ordering, tied to a cart line where relevant (index into `items`). */
export const QuoteProblemSchema = z.object({
  code: z.string(),
  message: z.string(),
  lineIndex: z.number().int().optional(),
});

export const QuoteSchema = z.object({
  restaurant: z.object({ id: IdSchema, name: z.string(), slug: z.string() }),
  lines: z.array(
    z.object({
      menuItemId: IdSchema,
      name: z.string(),
      variantName: z.string().nullable(),
      extras: z.array(z.object({ extraId: IdSchema, name: z.string(), unitPriceKobo: z.number().int(), quantity: z.number().int() })),
      unitPriceKobo: z.number().int(),
      quantity: z.number().int(),
      lineTotalKobo: z.number().int(),
    }),
  ),
  subtotalKobo: z.number().int(),
  deliveryFeeKobo: z.number().int(),
  serviceFeeKobo: z.number().int(),
  discountKobo: z.number().int(),
  totalKobo: z.number().int(),
  distanceMeters: z.number().int(),
  promotion: z.object({ code: z.string(), description: z.string() }).nullable(),
  cashOnDeliveryAllowed: z.boolean(),
  cashOnDeliveryReason: z.string().nullable(),
  /** Empty when the order can be placed as quoted. */
  problems: z.array(QuoteProblemSchema),
  canPlaceOrder: z.boolean(),
});
export type QuoteDto = z.infer<typeof QuoteSchema>;

export const OrderListQuerySchema = PageQuerySchema.extend({
  status: z.enum(['active', 'past']).optional(),
});

const OrderItemSchema = z.object({
  id: IdSchema,
  menuItemId: IdSchema,
  name: z.string(),
  variantName: z.string().nullable(),
  unitPriceKobo: z.number().int(),
  quantity: z.number().int(),
  lineTotalKobo: z.number().int(),
  specialInstructions: z.string().nullable(),
  extras: z.array(z.object({ name: z.string(), unitPriceKobo: z.number().int(), quantity: z.number().int() })),
});

export const OrderSummarySchema = z.object({
  id: IdSchema,
  code: z.string(),
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  totalKobo: z.number().int(),
  itemCount: z.number().int(),
  restaurant: z.object({ id: IdSchema, name: z.string(), slug: z.string() }),
  placedAt: DateTimeSchema,
});
export const OrderListSchema = paginated(OrderSummarySchema);

export const CustomerOrderSchema = OrderSummarySchema.extend({
  items: z.array(OrderItemSchema),
  subtotalKobo: z.number().int(),
  deliveryFeeKobo: z.number().int(),
  serviceFeeKobo: z.number().int(),
  discountKobo: z.number().int(),
  deliveryAddress: z.object({
    label: z.string(),
    line1: z.string(),
    line2: z.string().nullable().optional(),
    area: z.string(),
    city: z.string(),
    landmark: z.string().nullable().optional(),
  }),
  customerNote: z.string().nullable(),
  /** Give this to the rider at delivery. Only ever returned to the ordering customer. */
  deliveryPin: z.string(),
  restaurantPhone: z.string().nullable(),
  timeline: z.array(z.object({ status: z.enum(ORDER_STATUSES), at: DateTimeSchema, reason: z.string().nullable() })),
  payment: z
    .object({
      reference: z.string(),
      status: z.string(),
      provider: z.string(),
      isTestPayment: z.boolean(),
    })
    .nullable(),
  /** Online orders are only sent to the restaurant once payment is confirmed. */
  sentToRestaurant: z.boolean(),
  canCancel: z.boolean(),
  canPay: z.boolean(),
  cancellationReason: z.string().nullable(),
  /** When the restaurant expects the food to be ready (set on acceptance, moved by delays). */
  estimatedReadyAt: DateTimeSchema.nullable(),
  /** True once delivered and not yet reviewed. */
  canReview: z.boolean(),
  /** Delivery progress once dispatch has started (null before). */
  deliveryStatus: z.enum(DELIVERY_STATUSES).nullable(),
  /** The assigned rider (first name and vehicle only). No live location in v1. */
  rider: PublicRiderSchema,
});
export type CustomerOrderDto = z.infer<typeof CustomerOrderSchema>;

export const CancelOrderSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();

export const PaymentInitSchema = z.object({
  reference: z.string(),
  authorizationUrl: z.string(),
  provider: z.string(),
  /** True for the development mock provider: no real money moves. */
  isTestPayment: z.boolean(),
  amountKobo: z.number().int(),
});
export type PaymentInitDto = z.infer<typeof PaymentInitSchema>;

export const PaymentVerifyResultSchema = z.object({
  reference: z.string(),
  status: z.enum(['SUCCESSFUL', 'FAILED', 'PENDING', 'ABANDONED']),
  orderId: IdSchema,
  orderPaymentStatus: z.enum(PAYMENT_STATUSES),
  message: z.string(),
});

export const ReorderPreviewSchema = z.object({
  restaurant: z.object({ id: IdSchema, name: z.string(), slug: z.string(), minOrderKobo: z.number().int(), isAcceptingOrders: z.boolean() }),
  lines: z.array(
    z.object({
      menuItemId: IdSchema,
      name: z.string(),
      variantId: IdSchema.nullable(),
      variantName: z.string().nullable(),
      extras: z.array(z.object({ id: IdSchema, name: z.string(), priceKobo: z.number().int(), quantity: z.number().int() })),
      quantity: z.number().int(),
      unitPriceKobo: z.number().int(),
      instructions: z.string().nullable(),
    }),
  ),
  /** Items from the original order that can't be added again, with reasons. */
  unavailable: z.array(z.object({ name: z.string(), reason: z.string() })),
});
