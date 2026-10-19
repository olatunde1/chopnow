import { z } from 'zod';
import { VEHICLE_TYPES } from './auth.js';
import { DateTimeSchema, IdSchema, LatitudeSchema, LongitudeSchema, paginated } from './common.js';
import { APPROVAL_STATUSES, PAYMENT_METHODS, RIDER_TYPES } from './enums.js';

/**
 * Rider app contracts (Phase 7). Privacy rule: an *offer* shows only the restaurant, the drop-off
 * area and the money involved; the full address, landmark and contact phone are shown only to the
 * rider who accepted, and only until the delivery ends.
 */

export const DELIVERY_STATUSES = ['UNASSIGNED', 'OFFERING', 'ASSIGNED', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const RIDER_DOCUMENT_TYPES = ['DRIVERS_LICENCE', 'VEHICLE_PAPERS', 'RIDER_ID', 'OTHER'] as const;

export const RiderProfileSchema = z.object({
  id: IdSchema,
  fullName: z.string(),
  riderType: z.enum(RIDER_TYPES),
  verificationStatus: z.enum(APPROVAL_STATUSES),
  verificationNote: z.string().nullable(),
  availability: z.enum(['OFFLINE', 'ONLINE']),
  vehicleType: z.enum(VEHICLE_TYPES),
  vehiclePlate: z.string().nullable(),
  completedDeliveries: z.number().int(),
  ratingAverage: z.number().nullable(),
  ratingCount: z.number().int(),
  /** Cash collected on deliveries and not yet handed to ChopNow. */
  outstandingCashKobo: z.number().int(),
  /** At or above this, no cash-on-delivery offers are sent. */
  cashLimitKobo: z.number().int(),
  todayEarningsKobo: z.number().int(),
  todayDeliveries: z.number().int(),
});
export type RiderProfileDto = z.infer<typeof RiderProfileSchema>;

export const AvailabilityRequestSchema = z.object({ online: z.boolean() }).strict();
export const RiderLocationSchema = z.object({ latitude: LatitudeSchema, longitude: LongitudeSchema }).strict();

const PlaceSchema = z.object({ name: z.string(), addressLine: z.string(), area: z.string(), latitude: z.number().nullable(), longitude: z.number().nullable() });

export const RiderOfferSchema = z.object({
  id: IdSchema,
  deliveryId: IdSchema,
  orderCode: z.string(),
  expiresAt: DateTimeSchema,
  restaurant: PlaceSchema,
  /** Area only until the offer is accepted. */
  dropoffArea: z.string(),
  /** Straight-line distances in metres (null when the rider's position is unknown). */
  distanceToRestaurantMeters: z.number().int().nullable(),
  deliveryDistanceMeters: z.number().int().nullable(),
  earningKobo: z.number().int(),
  cashToCollectKobo: z.number().int(),
  itemCount: z.number().int(),
  estimatedReadyAt: DateTimeSchema.nullable(),
});
export type RiderOfferDto = z.infer<typeof RiderOfferSchema>;

export const RIDER_DELIVERY_ACTIONS = ['arrived', 'picked_up', 'complete', 'release', 'report_problem'] as const;

export const RiderDeliverySchema = z.object({
  id: IdSchema,
  status: z.enum(DELIVERY_STATUSES),
  orderId: IdSchema,
  orderCode: z.string(),
  orderStatus: z.string(),
  restaurant: PlaceSchema.extend({ phone: z.string().nullable() }),
  /** Full drop-off details: only while this rider holds an active delivery. */
  dropoff: z
    .object({
      customerFirstName: z.string(),
      line1: z.string(),
      line2: z.string().nullable(),
      area: z.string(),
      city: z.string(),
      landmark: z.string().nullable(),
      instructions: z.string().nullable(),
      contactPhone: z.string().nullable(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
    })
    .nullable(),
  dropoffArea: z.string(),
  customerNote: z.string().nullable(),
  items: z.array(z.object({ name: z.string(), variantName: z.string().nullable(), quantity: z.number().int(), extras: z.array(z.string()) })),
  paymentMethod: z.enum(PAYMENT_METHODS),
  cashToCollectKobo: z.number().int(),
  earningKobo: z.number().int(),
  estimatedReadyAt: DateTimeSchema.nullable(),
  foodReady: z.boolean(),
  pinAttemptsLeft: z.number().int(),
  assignedAt: DateTimeSchema.nullable(),
  pickedUpAt: DateTimeSchema.nullable(),
  deliveredAt: DateTimeSchema.nullable(),
  failureReason: z.string().nullable(),
  actions: z.array(z.enum(RIDER_DELIVERY_ACTIONS)),
});
export type RiderDeliveryDto = z.infer<typeof RiderDeliverySchema>;

/** The single poll the app makes while online. It also counts as a heartbeat. */
export const RiderWorkSchema = z.object({ offer: RiderOfferSchema.nullable(), delivery: RiderDeliverySchema.nullable(), availability: z.enum(['OFFLINE', 'ONLINE']) });

export const DECLINE_REASONS = ['TOO_FAR', 'BUSY', 'VEHICLE_ISSUE', 'OTHER'] as const;
export const DeclineOfferSchema = z.object({ reason: z.enum(DECLINE_REASONS).optional() }).strict();

export const CompleteDeliverySchema = z
  .object({
    pin: z.string().regex(/^\d{4}$/, 'Enter the 4-digit PIN from the customer'),
    /** Required for cash orders: the amount actually received, in kobo. */
    cashCollectedKobo: z.number().int().min(0).optional(),
  })
  .strict();

/** Before pickup: hand the job back so another rider can take it. */
export const RELEASE_REASONS = ['VEHICLE_ISSUE', 'EMERGENCY', 'RESTAURANT_TOO_SLOW', 'OTHER'] as const;
export const ReleaseDeliverySchema = z.object({ reason: z.enum(RELEASE_REASONS), note: z.string().trim().max(300).optional() }).strict();

/** After pickup: the delivery could not be completed; operations takes over. */
export const PROBLEM_REASONS = ['CUSTOMER_UNREACHABLE', 'CUSTOMER_REFUSED', 'CANNOT_PAY', 'WRONG_ADDRESS', 'UNSAFE', 'ACCIDENT', 'OTHER'] as const;
export const ReportProblemSchema = z.object({ reason: z.enum(PROBLEM_REASONS), note: z.string().trim().max(500).optional() }).strict();

export const RiderDeliveryHistoryItemSchema = z.object({
  id: IdSchema,
  orderCode: z.string(),
  status: z.enum(DELIVERY_STATUSES),
  restaurantName: z.string(),
  dropoffArea: z.string(),
  earningKobo: z.number().int(),
  cashCollectedKobo: z.number().int(),
  assignedAt: DateTimeSchema.nullable(),
  deliveredAt: DateTimeSchema.nullable(),
});
export const RiderDeliveryHistorySchema = paginated(RiderDeliveryHistoryItemSchema);

export const RiderEarningsQuerySchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((v) => v.from <= v.to, { path: ['to'], message: '"to" must be on or after "from"' })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 92, { path: ['to'], message: 'Choose a range of 3 months or less' });

export const RiderEarningsSchema = z.object({
  from: z.string(),
  to: z.string(),
  deliveries: z.number().int(),
  totalKobo: z.number().int(),
  /** Earnings not yet included in a settlement (Phase 8). */
  unsettledKobo: z.number().int(),
  outstandingCashKobo: z.number().int(),
  days: z.array(z.object({ date: z.string(), deliveries: z.number().int(), earningsKobo: z.number().int() })),
});

/** What customers and restaurants see about the rider: first name and vehicle only. */
export const PublicRiderSchema = z.object({ firstName: z.string(), vehicleType: z.enum(VEHICLE_TYPES) }).nullable();
