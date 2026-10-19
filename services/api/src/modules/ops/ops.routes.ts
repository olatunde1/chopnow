import { z } from 'zod';
import {
  AdminCancelOrderSchema,
  AdminDashboardSchema,
  AdminDocumentListSchema,
  AdminDocumentQuerySchema,
  AdminDocumentSchema,
  AdminOrderDetailSchema,
  AdminOrderListSchema,
  AdminOrderQuerySchema,
  AdminReviewListSchema,
  AdminReviewQuerySchema,
  AdminReviewSchema,
  AdminUserListSchema,
  AdminUserQuerySchema,
  AdminUserSchema,
  AssignRiderSchema,
  AuditListSchema,
  AuditQuerySchema,
  ConfirmDeliveredSchema,
  CreatePromotionSchema,
  CreateStaffResultSchema,
  CreateStaffSchema,
  DispatchBoardSchema,
  DocumentLinkSchema,
  DocumentReviewSchema,
  IdSchema,
  ModerateReviewSchema,
  PromotionListSchema,
  PromotionSchema,
  RetryDeliverySchema,
  SuspendUserSchema,
  UnassignRiderSchema,
  UpdatePromotionSchema,
  PaymentVerifyResultSchema,
  hasPermission,
} from '@chopnow/shared-schemas';
import { defineRoute } from '../../http/route.js';
import type { OpsAdminService } from './ops-admin.service.js';
import type { OpsOrdersService } from './ops-orders.service.js';
import type { PaymentsService } from '../payments/payments.service.js';

const O = z.object({ orderId: IdSchema });
const D = z.object({ deliveryId: IdSchema });
const U = z.object({ userId: IdSchema });
const DOC = z.object({ documentId: IdSchema });

export function opsRoutes(deps: { orders: OpsOrdersService; admin: OpsAdminService; payments: PaymentsService }) {
  const { orders, admin } = deps;

  const documentRoutes = (owner: 'RESTAURANT' | 'RIDER') => {
    const base = owner === 'RESTAURANT' ? '/v1/admin/restaurant-documents' : '/v1/admin/rider-documents';
    const access = owner === 'RESTAURANT' ? ('restaurant.approve' as const) : ('rider.approve' as const);
    const tag = owner === 'RESTAURANT' ? 'Admin: restaurants' : 'Admin: riders';
    return [
      defineRoute({
        method: 'get', path: base, summary: `Verification documents uploaded by ${owner === 'RESTAURANT' ? 'restaurants' : 'riders'} (oldest first)`, tag, access,
        query: AdminDocumentQuerySchema, response: AdminDocumentListSchema,
        handler: ({ query }) => admin.listDocuments(owner, query),
      }),
      defineRoute({
        method: 'post', path: `${base}/:documentId/link`, summary: 'A 5-minute link to view the document (each view is audited)', tag, access,
        params: DOC, response: DocumentLinkSchema,
        handler: ({ me, params, requestContext }) => admin.documentLink(me(), owner, params.documentId, requestContext),
      }),
      defineRoute({
        method: 'post', path: `${base}/:documentId/review`, summary: 'Accept or reject a document (rejections need a note)', tag, access,
        params: DOC, body: DocumentReviewSchema, response: AdminDocumentSchema,
        handler: ({ me, params, body, requestContext }) => admin.reviewDocument(me(), owner, params.documentId, body, requestContext),
      }),
    ];
  };

  return [
    defineRoute({
      method: 'get', path: '/v1/admin/dashboard', summary: 'Today’s numbers, live operations and work queues', tag: 'Admin: operations', access: 'dashboard.view',
      response: AdminDashboardSchema,
      handler: () => orders.dashboard(),
    }),

    // Orders
    defineRoute({
      method: 'post', path: '/v1/admin/payments/:reference/verify', summary: 'Ask the payment provider about one attempt now and apply the result (audited)', tag: 'Admin: orders', access: 'payment.read',
      params: z.object({ reference: z.string().regex(/^[A-Z0-9-]{4,40}$/) }), response: PaymentVerifyResultSchema,
      handler: ({ me, params, requestContext }) => deps.payments.verifyForStaff(me(), params.reference, requestContext),
    }),
    defineRoute({
      method: 'get', path: '/v1/admin/orders', summary: 'Search orders (code, customer email/phone, status, restaurant, needs attention)', tag: 'Admin: orders', access: 'order.read.any',
      query: AdminOrderQuerySchema, response: AdminOrderListSchema,
      handler: ({ query }) => orders.list(query),
    }),
    defineRoute({
      method: 'get', path: '/v1/admin/orders/:orderId', summary: 'Full order: customer, money, payments, refunds, delivery events and allowed actions', tag: 'Admin: orders', access: 'order.read.any',
      params: O, response: AdminOrderDetailSchema,
      handler: ({ me, params }) => orders.get(me(), params.orderId),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/orders/:orderId/cancel', summary: 'Cancel an undelivered order (refund requested if paid; offers withdrawn)', tag: 'Admin: orders', access: 'order.manage.any',
      params: O, body: AdminCancelOrderSchema, response: AdminOrderDetailSchema,
      handler: ({ me, params, body, requestContext }) => orders.cancel(me(), params.orderId, body.reason, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/orders/:orderId/retry-delivery', summary: 'Resolve a delivery problem by trying again (same rider, or back to dispatch)', tag: 'Admin: orders', access: 'order.manage.any',
      params: O, body: RetryDeliverySchema, response: AdminOrderDetailSchema,
      handler: ({ me, params, body, requestContext }) => orders.retryDelivery(me(), params.orderId, body.mode, body.reason, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/orders/:orderId/confirm-delivered', summary: 'Confirm delivery without the PIN (reason required; audited)', tag: 'Admin: orders', access: 'order.manage.any',
      params: O, body: ConfirmDeliveredSchema, response: AdminOrderDetailSchema,
      handler: ({ me, params, body, requestContext }) => orders.confirmDelivered(me(), params.orderId, body.reason, body.cashCollectedKobo, requestContext),
    }),

    // Dispatch
    defineRoute({
      method: 'get', path: '/v1/admin/dispatch', summary: 'Deliveries waiting for a rider, deliveries in progress, and riders online', tag: 'Admin: dispatch', access: 'dispatch.manage',
      response: DispatchBoardSchema,
      handler: () => orders.dispatchBoard(),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/deliveries/:deliveryId/assign', summary: 'Give a waiting delivery to a specific rider', tag: 'Admin: dispatch', access: 'dispatch.manage',
      params: D, body: AssignRiderSchema, response: DispatchBoardSchema,
      handler: ({ me, params, body, requestContext }) => orders.assign(me(), params.deliveryId, body.riderId, body.reason, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/deliveries/:deliveryId/unassign', summary: 'Take a delivery back from its rider before pickup', tag: 'Admin: dispatch', access: 'dispatch.manage',
      params: D, body: UnassignRiderSchema, response: DispatchBoardSchema,
      handler: ({ me, params, body, requestContext }) => orders.unassign(me(), params.deliveryId, body.reason, requestContext),
    }),

    // Users and staff
    defineRoute({
      method: 'get', path: '/v1/admin/users', summary: 'Find accounts by email, name or phone', tag: 'Admin: users', access: 'customer.read.any',
      query: AdminUserQuerySchema, response: AdminUserListSchema,
      handler: ({ query }) => admin.listUsers(query),
    }),
    defineRoute({
      method: 'get', path: '/v1/admin/users/:userId', summary: 'One account', tag: 'Admin: users', access: 'customer.read.any',
      params: U, response: AdminUserSchema,
      handler: ({ params }) => admin.getUser(params.userId),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/users/:userId/suspend', summary: 'Suspend a customer or staff account (signs them out everywhere)', tag: 'Admin: users', access: 'customer.manage',
      params: U, body: SuspendUserSchema, response: AdminUserSchema,
      handler: ({ me, params, body, requestContext }) => admin.setUserStatus(me(), params.userId, 'SUSPENDED', body.reason, (p) => hasPermission(me().role, p), requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/users/:userId/reactivate', summary: 'Reactivate a suspended customer or staff account', tag: 'Admin: users', access: 'customer.manage',
      params: U, body: SuspendUserSchema, response: AdminUserSchema,
      handler: ({ me, params, body, requestContext }) => admin.setUserStatus(me(), params.userId, 'ACTIVE', body.reason, (p) => hasPermission(me().role, p), requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/staff', summary: 'Create a staff account with a one-time password (must be changed at first sign-in)', tag: 'Admin: users', access: 'staff.manage',
      body: CreateStaffSchema, response: CreateStaffResultSchema, status: 201,
      handler: ({ me, body, requestContext }) => admin.createStaff(me(), body, requestContext),
    }),

    ...documentRoutes('RESTAURANT'),
    ...documentRoutes('RIDER'),

    // Promotions
    defineRoute({
      method: 'get', path: '/v1/admin/promotions', summary: 'All promotions with usage', tag: 'Admin: promotions', access: 'promotion.manage',
      response: PromotionListSchema,
      handler: () => admin.listPromotions(),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/promotions', summary: 'Create a promotion code', tag: 'Admin: promotions', access: 'promotion.manage',
      body: CreatePromotionSchema, response: PromotionSchema, status: 201,
      handler: ({ me, body, requestContext }) => admin.createPromotion(me(), body, requestContext),
    }),
    defineRoute({
      method: 'patch', path: '/v1/admin/promotions/:promotionId', summary: 'Pause, resume, extend or limit a promotion', tag: 'Admin: promotions', access: 'promotion.manage',
      params: z.object({ promotionId: IdSchema }), body: UpdatePromotionSchema, response: PromotionSchema,
      handler: ({ me, params, body, requestContext }) => admin.updatePromotion(me(), params.promotionId, body, requestContext),
    }),

    // Reviews
    defineRoute({
      method: 'get', path: '/v1/admin/reviews', summary: 'Reviews for moderation (filter by status or low ratings)', tag: 'Admin: reviews', access: 'review.moderate',
      query: AdminReviewQuerySchema, response: AdminReviewListSchema,
      handler: ({ query }) => admin.listReviews(query),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/reviews/:reviewId/moderate', summary: 'Hide or restore a review (ratings recalculated)', tag: 'Admin: reviews', access: 'review.moderate',
      params: z.object({ reviewId: IdSchema }), body: ModerateReviewSchema, response: AdminReviewSchema,
      handler: ({ me, params, body, requestContext }) => admin.moderateReview(me(), params.reviewId, body.status, body.note, requestContext),
    }),

    // Audit
    defineRoute({
      method: 'get', path: '/v1/admin/audit', summary: 'Audit log, newest first (filter by entity, actor or action prefix)', tag: 'Admin: audit', access: 'audit.read',
      query: AuditQuerySchema, response: AuditListSchema,
      handler: ({ query }) => admin.audit(query),
    }),
  ];
}
