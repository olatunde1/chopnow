import { z } from 'zod';
import { DateTimeSchema, IdSchema, KoboSchema, PageQuerySchema, paginated } from './common.js';
import { EmailSchema, NigerianPhoneSchema } from './auth.js';
import { ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, ROLES, STAFF_ROLES } from './enums.js';
import { DELIVERY_STATUSES } from './rider.js';

/**
 * Operations (admin dashboard, Phase 9). Staff see full order details, including the customer's
 * contact and (for order managers) the delivery PIN, because resolving problems needs them; every
 * change is audited with a reason.
 */

const reason = z.string().trim().min(5, 'Give a short reason').max(500);

// ───────── Dashboard ─────────

export const AdminDashboardSchema = z.object({
  today: z.object({
    ordersPlaced: z.number().int(),
    ordersDelivered: z.number().int(),
    ordersCancelled: z.number().int(),
    grossOrderValueKobo: z.number().int(),
    averageDeliveryMinutes: z.number().nullable(),
  }),
  live: z.object({
    awaitingRestaurant: z.number().int(),
    inKitchen: z.number().int(),
    awaitingRider: z.number().int(),
    onTheWay: z.number().int(),
    exceptions: z.number().int(),
    dispatchAlerts: z.number().int(),
    ridersOnline: z.number().int(),
    ridersBusy: z.number().int(),
    restaurantsOpen: z.number().int(),
  }),
  queues: z.object({
    restaurantApprovals: z.number().int(),
    riderApprovals: z.number().int(),
    documentsToReview: z.number().int(),
    refundRequests: z.number().int(),
    remittancesToConfirm: z.number().int(),
  }),
});

// ───────── Orders ─────────

export const ADMIN_ORDER_ACTIONS = ['cancel', 'retry_delivery', 'confirm_delivered', 'request_refund'] as const;

export const AdminOrderQuerySchema = PageQuerySchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  /** Order code, customer email or phone. */
  q: z.string().trim().max(80).optional(),
  restaurantId: IdSchema.optional(),
  /** Exceptions, dispatch alerts, or orders waiting unusually long. */
  attention: z.enum(['true', 'false']).optional(),
});

export const AdminOrderSummarySchema = z.object({
  id: IdSchema,
  code: z.string(),
  status: z.enum(ORDER_STATUSES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  totalKobo: z.number().int(),
  placedAt: DateTimeSchema,
  restaurantName: z.string(),
  customerName: z.string(),
  deliveryStatus: z.enum(DELIVERY_STATUSES).nullable(),
  riderName: z.string().nullable(),
  needsAttention: z.boolean(),
});
export const AdminOrderListSchema = paginated(AdminOrderSummarySchema);

const person = z.object({ id: IdSchema, fullName: z.string(), email: z.string(), phone: z.string().nullable() });

export const AdminOrderDetailSchema = AdminOrderSummarySchema.extend({
  customer: person,
  restaurant: z.object({ id: IdSchema, name: z.string(), phone: z.string().nullable(), area: z.string() }),
  items: z.array(z.object({ name: z.string(), variantName: z.string().nullable(), quantity: z.number().int(), lineTotalKobo: z.number().int(), extras: z.array(z.string()), specialInstructions: z.string().nullable() })),
  subtotalKobo: z.number().int(),
  deliveryFeeKobo: z.number().int(),
  serviceFeeKobo: z.number().int(),
  discountKobo: z.number().int(),
  commissionKobo: z.number().int(),
  riderEarningKobo: z.number().int(),
  promotionCode: z.string().nullable(),
  deliveryAddress: z.record(z.string(), z.unknown()),
  customerNote: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  /** Only for staff who can manage orders. */
  deliveryPin: z.string().nullable(),
  timeline: z.array(z.object({ from: z.string().nullable(), to: z.string(), at: DateTimeSchema, actorRole: z.string().nullable(), reason: z.string().nullable() })),
  payments: z.array(z.object({ id: IdSchema, reference: z.string(), provider: z.string(), status: z.string(), amountKobo: z.number().int(), failureReason: z.string().nullable(), createdAt: DateTimeSchema })),
  refunds: z.array(z.object({ id: IdSchema, amountKobo: z.number().int(), status: z.string(), reason: z.string(), chargeTo: z.string().nullable(), createdAt: DateTimeSchema })),
  delivery: z
    .object({
      id: IdSchema,
      status: z.enum(DELIVERY_STATUSES),
      rider: person.extend({ riderId: IdSchema, vehicleType: z.string() }).nullable(),
      dispatchStartedAt: DateTimeSchema.nullable(),
      dispatchAlertAt: DateTimeSchema.nullable(),
      offersMade: z.number().int(),
      pinFailedAttempts: z.number().int(),
      failureReason: z.string().nullable(),
      proofOverrideReason: z.string().nullable(),
      events: z.array(z.object({ type: z.string(), at: DateTimeSchema, riderName: z.string().nullable(), note: z.string().nullable() })),
    })
    .nullable(),
  cash: z.object({ dueKobo: z.number().int(), collectedKobo: z.number().int(), status: z.string(), reconciliationStatus: z.string() }).nullable(),
  /** Every ledger journal for this order (payment, cash, split, refunds) and where its proceeds were settled. */
  financialHistory: z.object({
    journals: z.array(z.object({
      id: IdSchema,
      type: z.string(),
      description: z.string(),
      at: DateTimeSchema,
      lines: z.array(z.object({ account: z.string(), direction: z.enum(['DEBIT', 'CREDIT']), amountKobo: z.number().int(), party: z.string().nullable() })),
    })),
    /** From the ORDER_SETTLED journal (null until delivered). */
    split: z.object({ restaurantKobo: z.number().int(), riderKobo: z.number().int(), platformRevenueKobo: z.number().int(), platformPromotionCostKobo: z.number().int() }).nullable(),
    restaurantSettlement: z.object({ id: IdSchema, from: z.string(), to: z.string(), status: z.string() }).nullable(),
    riderSettlement: z.object({ id: IdSchema, from: z.string(), to: z.string(), status: z.string() }).nullable(),
  }),
  /** What staff may do next (the API re-checks every action). */
  actions: z.array(z.enum(ADMIN_ORDER_ACTIONS)),
});
export type AdminOrderDetailDto = z.infer<typeof AdminOrderDetailSchema>;

export const AdminCancelOrderSchema = z.object({ reason }).strict();
/** After a delivery problem: the same rider tries again, or the job goes back to dispatch for a new rider. */
export const RetryDeliverySchema = z.object({ reason, mode: z.enum(['SAME_RIDER', 'NEW_RIDER']) }).strict();
/** Delivered without the PIN (locked PIN, customer confirmed by phone, etc.). Always audited. */
export const ConfirmDeliveredSchema = z.object({ reason, cashCollectedKobo: KoboSchema.optional() }).strict();

// ───────── Dispatch ─────────

export const DispatchBoardSchema = z.object({
  waiting: z.array(z.object({
    deliveryId: IdSchema, orderId: IdSchema, orderCode: z.string(), orderStatus: z.string(), restaurantName: z.string(), dropoffArea: z.string(),
    cashToCollectKobo: z.number().int(), waitingSeconds: z.number().int(), offersMade: z.number().int(), pendingOfferTo: z.string().nullable(), alerted: z.boolean(),
  })),
  active: z.array(z.object({
    deliveryId: IdSchema, orderId: IdSchema, orderCode: z.string(), status: z.enum(DELIVERY_STATUSES), restaurantName: z.string(), dropoffArea: z.string(),
    riderId: IdSchema, riderName: z.string(), riderPhone: z.string().nullable(), assignedAt: DateTimeSchema.nullable(), pickedUpAt: DateTimeSchema.nullable(),
  })),
  riders: z.array(z.object({
    riderId: IdSchema, name: z.string(), riderType: z.string(), vehicleType: z.string(), availability: z.string(),
    reachable: z.boolean(), lastSeenAt: DateTimeSchema.nullable(), busy: z.boolean(), outstandingCashKobo: z.number().int(),
  })),
});
export const AssignRiderSchema = z.object({ riderId: IdSchema, reason }).strict();
export const UnassignRiderSchema = z.object({ reason }).strict();

// ───────── Users and staff ─────────

export const AdminUserQuerySchema = PageQuerySchema.extend({
  role: z.enum(ROLES).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  q: z.string().trim().max(80).optional(),
});
export const AdminUserSchema = z.object({
  id: IdSchema,
  email: z.string(),
  phone: z.string().nullable(),
  fullName: z.string(),
  role: z.enum(ROLES),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  lastLoginAt: DateTimeSchema.nullable(),
  createdAt: DateTimeSchema,
  orderCount: z.number().int(),
  mustChangePassword: z.boolean(),
});
export const AdminUserListSchema = paginated(AdminUserSchema);
export const SuspendUserSchema = z.object({ reason }).strict();
export const CreateStaffSchema = z.object({ email: EmailSchema, fullName: z.string().trim().min(2).max(120), phone: NigerianPhoneSchema.optional(), role: z.enum(STAFF_ROLES) }).strict();
/** The temporary password is shown once; the new staff member must change it at first sign-in. */
export const CreateStaffResultSchema = z.object({ user: AdminUserSchema, temporaryPassword: z.string() });

// ───────── Documents ─────────

export const AdminDocumentSchema = z.object({
  id: IdSchema,
  owner: z.enum(['RESTAURANT', 'RIDER']),
  ownerId: IdSchema,
  ownerName: z.string(),
  type: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']),
  reviewNote: z.string().nullable(),
  uploadedAt: DateTimeSchema,
  reviewedAt: DateTimeSchema.nullable(),
});
export const AdminDocumentListSchema = z.object({ items: z.array(AdminDocumentSchema) });
export const AdminDocumentQuerySchema = z.object({ status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional(), restaurantId: IdSchema.optional(), riderId: IdSchema.optional() });
export const DocumentReviewSchema = z
  .object({ status: z.enum(['ACCEPTED', 'REJECTED']), note: z.string().trim().max(500).optional() })
  .strict()
  .refine((v) => v.status !== 'REJECTED' || (v.note?.length ?? 0) >= 5, { path: ['note'], message: 'Say what is wrong so they can fix it' });
export const DocumentLinkSchema = z.object({ url: z.string(), expiresAt: DateTimeSchema });

// ───────── Promotions ─────────

export const PROMOTION_TYPES = ['PERCENT_OFF', 'FIXED_OFF', 'FREE_DELIVERY'] as const;
export const PromotionSchema = z.object({
  id: IdSchema,
  code: z.string(),
  description: z.string(),
  type: z.enum(PROMOTION_TYPES),
  percentBps: z.number().int().nullable(),
  amountKobo: z.number().int().nullable(),
  maxDiscountKobo: z.number().int().nullable(),
  minSubtotalKobo: z.number().int(),
  restaurantId: IdSchema.nullable(),
  restaurantName: z.string().nullable(),
  fundedBy: z.enum(['PLATFORM', 'RESTAURANT']),
  startsAt: DateTimeSchema,
  endsAt: DateTimeSchema,
  usageLimit: z.number().int().nullable(),
  perCustomerLimit: z.number().int(),
  isActive: z.boolean(),
  redemptions: z.number().int(),
  createdAt: DateTimeSchema,
});
export const PromotionListSchema = z.object({ items: z.array(PromotionSchema) });
export const CreatePromotionSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, 'Use 4–20 letters or digits'),
    description: z.string().trim().min(3).max(200),
    type: z.enum(PROMOTION_TYPES),
    percentBps: z.number().int().min(100).max(10_000).optional(),
    amountKobo: KoboSchema.optional(),
    maxDiscountKobo: KoboSchema.optional(),
    minSubtotalKobo: KoboSchema.default(0),
    restaurantId: IdSchema.optional(),
    fundedBy: z.enum(['PLATFORM', 'RESTAURANT']).default('PLATFORM'),
    startsAt: DateTimeSchema,
    endsAt: DateTimeSchema,
    usageLimit: z.number().int().min(1).optional(),
    perCustomerLimit: z.number().int().min(1).max(100).default(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'PERCENT_OFF' && !v.percentBps) ctx.addIssue({ code: 'custom', path: ['percentBps'], message: 'Enter the percentage' });
    if (v.type === 'FIXED_OFF' && !v.amountKobo) ctx.addIssue({ code: 'custom', path: ['amountKobo'], message: 'Enter the amount off' });
    if (v.endsAt <= v.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Must end after it starts' });
    if (v.fundedBy === 'RESTAURANT' && !v.restaurantId) ctx.addIssue({ code: 'custom', path: ['restaurantId'], message: 'Restaurant-funded promotions must be for one restaurant' });
  });
export const UpdatePromotionSchema = z
  .object({ isActive: z.boolean().optional(), endsAt: DateTimeSchema.optional(), usageLimit: z.number().int().min(1).nullable().optional(), description: z.string().trim().min(3).max(200).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

// ───────── Reviews ─────────

export const AdminReviewQuerySchema = PageQuerySchema.extend({ status: z.enum(['PUBLISHED', 'HIDDEN']).optional(), maxRating: z.coerce.number().int().min(1).max(5).optional() });
export const AdminReviewSchema = z.object({
  id: IdSchema,
  orderCode: z.string(),
  restaurantName: z.string(),
  customerName: z.string(),
  restaurantRating: z.number().int(),
  riderRating: z.number().int().nullable(),
  comment: z.string().nullable(),
  vendorReply: z.string().nullable(),
  status: z.enum(['PUBLISHED', 'HIDDEN']),
  moderationNote: z.string().nullable(),
  createdAt: DateTimeSchema,
});
export const AdminReviewListSchema = paginated(AdminReviewSchema);
export const ModerateReviewSchema = z.object({ status: z.enum(['PUBLISHED', 'HIDDEN']), note: reason }).strict();

// ───────── Audit log ─────────

export const AuditQuerySchema = PageQuerySchema.extend({
  entityType: z.string().trim().max(60).optional(),
  entityId: IdSchema.optional(),
  actorUserId: IdSchema.optional(),
  action: z.string().trim().max(80).optional(),
});
export const AuditEntrySchema = z.object({
  id: IdSchema,
  actorUserId: IdSchema.nullable(),
  actorName: z.string().nullable(),
  actorRole: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: DateTimeSchema,
});
export const AuditListSchema = paginated(AuditEntrySchema);
