import type { Role } from './enums.js';

/**
 * Fine-grained permissions. The API checks these on every protected route; the web apps read the
 * same table only to decide which navigation to show. A client-side check is never a security control.
 *
 * Resource ownership (a vendor's own restaurant, a customer's own order, a rider's assigned
 * delivery) is checked separately in the service layer; the `*.own` permissions only say that the
 * role may act on its own records.
 */
export const PERMISSIONS = [
  // Customer self-service
  'order.place',
  'order.read.own',
  'order.cancel.own',
  'address.manage.own',
  'review.write.own',
  'favourite.manage.own',
  'support.ticket.own',

  // Vendor self-service
  'restaurant.manage.own',
  'menu.manage.own',
  'order.process.own',
  'finance.read.own',
  'review.reply.own',

  // Rider self-service
  'rider.profile.own',
  'delivery.work.own',
  'earnings.read.own',

  // Staff
  'dashboard.view',
  'order.read.any',
  'order.manage.any',
  'restaurant.read.any',
  'restaurant.approve',
  'rider.read.any',
  'rider.approve',
  'customer.read.any',
  'customer.manage',
  'dispatch.manage',
  'payment.read',
  'refund.request',
  'refund.approve',
  'cash.reconcile',
  'settlement.manage',
  'payout.manage',
  'promotion.manage',
  'review.moderate',
  'support.manage',
  'analytics.view',
  'config.manage',
  'audit.read',
  'staff.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const CUSTOMER: Permission[] = [
  'order.place',
  'order.read.own',
  'order.cancel.own',
  'address.manage.own',
  'review.write.own',
  'favourite.manage.own',
  'support.ticket.own',
];

const VENDOR: Permission[] = [
  'restaurant.manage.own',
  'menu.manage.own',
  'order.process.own',
  'finance.read.own',
  'review.reply.own',
  'support.ticket.own',
];

const RIDER: Permission[] = ['rider.profile.own', 'delivery.work.own', 'earnings.read.own', 'support.ticket.own'];

const SUPPORT: Permission[] = [
  'dashboard.view',
  'order.read.any',
  'customer.read.any',
  'restaurant.read.any',
  'rider.read.any',
  'payment.read',
  'refund.request',
  'review.moderate',
  'support.manage',
];

const OPERATIONS: Permission[] = [
  ...SUPPORT,
  'order.manage.any',
  'restaurant.approve',
  'rider.approve',
  'dispatch.manage',
  'promotion.manage',
  'analytics.view',
];

const FINANCE: Permission[] = [
  'dashboard.view',
  'order.read.any',
  'restaurant.read.any',
  'rider.read.any',
  'payment.read',
  'refund.request',
  'refund.approve',
  'cash.reconcile',
  'settlement.manage',
  'payout.manage',
  'analytics.view',
  'audit.read',
];

const STAFF_ALL: Permission[] = PERMISSIONS.filter(
  (p) => !p.endsWith('.own') && p !== 'order.place',
) as Permission[];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  CUSTOMER: new Set(CUSTOMER),
  VENDOR: new Set(VENDOR),
  RIDER: new Set(RIDER),
  SUPPORT: new Set(SUPPORT),
  OPERATIONS: new Set(OPERATIONS),
  FINANCE: new Set(FINANCE),
  ADMIN: new Set(STAFF_ALL),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Roles a person may choose at self-registration. Staff accounts are created by an ADMIN only. */
export const SELF_REGISTRABLE_ROLES = ['CUSTOMER', 'VENDOR', 'RIDER'] as const satisfies readonly Role[];
export type SelfRegistrableRole = (typeof SELF_REGISTRABLE_ROLES)[number];
