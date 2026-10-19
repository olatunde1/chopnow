/**
 * Canonical enumerations shared across the platform. The Prisma schema (Phase 2) mirrors these
 * values; a test in services/api asserts they stay in sync.
 */

export const ROLES = ['CUSTOMER', 'VENDOR', 'RIDER', 'ADMIN', 'OPERATIONS', 'SUPPORT', 'FINANCE'] as const;
export type Role = (typeof ROLES)[number];

/** Staff roles that can sign in to the admin dashboard. */
export const STAFF_ROLES = ['ADMIN', 'OPERATIONS', 'SUPPORT', 'FINANCE'] as const satisfies readonly Role[];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const ORDER_STATUSES = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
  'DELIVERY_EXCEPTION',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Payment state is modelled separately from fulfilment state. */
export const PAYMENT_STATUSES = [
  'PENDING',
  'SUCCESSFUL',
  'FAILED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['ONLINE', 'CASH_ON_DELIVERY'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const RIDER_TYPES = ['CORE', 'INDEPENDENT'] as const;
export type RiderType = (typeof RIDER_TYPES)[number];
