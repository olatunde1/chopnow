import { z } from 'zod';
import { APPROVAL_STATUSES, RIDER_TYPES } from './enums.js';
import { DateTimeSchema, IdSchema, PageQuerySchema, paginated } from './common.js';

export const AdminRestaurantListQuerySchema = PageQuerySchema.extend({
  status: z.enum(APPROVAL_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
});

export const AdminRiderListQuerySchema = PageQuerySchema.extend({
  status: z.enum(APPROVAL_STATUSES).optional(),
  riderType: z.enum(RIDER_TYPES).optional(),
  q: z.string().trim().max(80).optional(),
});

export const ApproveRestaurantSchema = z.object({ note: z.string().trim().max(500).optional() }).strict();
export const ApproveRiderSchema = z
  .object({ riderType: z.enum(RIDER_TYPES), note: z.string().trim().max(500).optional() })
  .strict();
/** Rejecting or suspending always needs a reason; it is shown to the vendor/rider and audited. */
export const DecisionWithReasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason').max(500) }).strict();
export const SetRiderTypeSchema = z.object({ riderType: z.enum(RIDER_TYPES) }).strict();

export const AdminRestaurantSchema = z.object({
  id: IdSchema,
  slug: z.string(),
  name: z.string(),
  area: z.string(),
  city: z.string(),
  addressLine: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  verificationStatus: z.enum(APPROVAL_STATUSES),
  verificationNote: z.string().nullable(),
  isAcceptingOrders: z.boolean(),
  approvedAt: DateTimeSchema.nullable(),
  hoursConfigured: z.boolean(),
  menuItemCount: z.number().int(),
  owner: z.object({ id: IdSchema, fullName: z.string(), email: z.string(), phone: z.string().nullable() }),
  createdAt: DateTimeSchema,
});
export const AdminRestaurantListSchema = paginated(AdminRestaurantSchema);

export const AdminRiderSchema = z.object({
  id: IdSchema,
  riderType: z.enum(RIDER_TYPES),
  verificationStatus: z.enum(APPROVAL_STATUSES),
  verificationNote: z.string().nullable(),
  availability: z.string(),
  vehicleType: z.string(),
  vehiclePlate: z.string().nullable(),
  serviceZone: z.string(),
  completedDeliveries: z.number().int(),
  approvedAt: DateTimeSchema.nullable(),
  user: z.object({ id: IdSchema, fullName: z.string(), email: z.string(), phone: z.string().nullable() }),
  createdAt: DateTimeSchema,
});
export const AdminRiderListSchema = paginated(AdminRiderSchema);
