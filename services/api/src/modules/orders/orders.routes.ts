import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import {
  CancelOrderSchema,
  CreateReviewSchema,
  CustomerOrderSchema,
  IdSchema,
  IdempotencyKeySchema,
  OrderListQuerySchema,
  OrderListSchema,
  OrderRequestSchema,
  PaymentInitSchema,
  PaymentVerifyResultSchema,
  QuoteSchema,
  ReorderPreviewSchema,
} from '@chopnow/shared-schemas';
import { defineRoute } from '../../http/route.js';
import { AppError } from '../../lib/errors.js';
import type { PaymentsService } from '../payments/payments.service.js';
import type { ReviewsService } from '../reviews/reviews.service.js';
import type { OrdersService } from './orders.service.js';

const OrderParams = z.object({ orderId: IdSchema });

export function idempotencyKey(req: Request): string {
  const parsed = IdempotencyKeySchema.safeParse(req.get('Idempotency-Key'));
  if (!parsed.success) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header (8–128 letters, digits, - or _) with this request.');
  }
  return parsed.data;
}

type Limits = Record<'quote' | 'place' | 'payment' | 'webhook', RequestHandler>;
const none: Limits = { quote: (_q, _s, n) => n(), place: (_q, _s, n) => n(), payment: (_q, _s, n) => n(), webhook: (_q, _s, n) => n() };

export function orderRoutes(orders: OrdersService, payments: PaymentsService, reviews: ReviewsService, limits: Limits = none) {
  const tag = 'Orders';
  return [
    defineRoute({
      method: 'post', path: '/v1/orders/quote', summary: 'Price a cart (no order is created)', tag, access: 'order.place',
      body: OrderRequestSchema, response: QuoteSchema, middleware: [limits.quote],
      handler: ({ me, body }) => orders.quote(me(), body),
    }),
    defineRoute({
      method: 'post', path: '/v1/orders', summary: 'Place an order (requires Idempotency-Key; amounts computed server-side)', tag, access: 'order.place',
      body: OrderRequestSchema, response: CustomerOrderSchema, status: 201, middleware: [limits.place],
      handler: async ({ me, body, req, res }) => {
        const result = await orders.create(me(), body, idempotencyKey(req));
        if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
        return result.body;
      },
    }),
    defineRoute({
      method: 'get', path: '/v1/orders', summary: 'My orders (active or past)', tag, access: 'order.read.own',
      query: OrderListQuerySchema, response: OrderListSchema,
      handler: ({ me, query }) => orders.list(me(), query),
    }),
    defineRoute({
      method: 'get', path: '/v1/orders/:orderId', summary: 'One of my orders, with timeline and delivery PIN', tag, access: 'order.read.own',
      params: OrderParams, response: CustomerOrderSchema,
      handler: ({ me, params }) => orders.get(me(), params.orderId),
    }),
    defineRoute({
      method: 'post', path: '/v1/orders/:orderId/cancel', summary: 'Cancel my order before the restaurant accepts it', tag, access: 'order.cancel.own',
      params: OrderParams, body: CancelOrderSchema, response: CustomerOrderSchema,
      handler: ({ me, params, body, requestContext }) => orders.cancel(me(), params.orderId, body.reason, requestContext),
    }),
    defineRoute({
      method: 'get', path: '/v1/orders/:orderId/reorder', summary: 'Rebuild a past order against the current menu', tag, access: 'order.place',
      params: OrderParams, response: ReorderPreviewSchema,
      handler: ({ me, params }) => orders.reorderPreview(me(), params.orderId),
    }),
    defineRoute({
      method: 'post', path: '/v1/orders/:orderId/review', summary: 'Rate a delivered order (once, within 14 days)', tag, access: 'review.write.own',
      params: OrderParams, body: CreateReviewSchema, response: z.object({ id: IdSchema, ok: z.literal(true) }), status: 201,
      handler: ({ me, params, body }) => reviews.create(me(), params.orderId, body),
    }),
    defineRoute({
      method: 'post', path: '/v1/orders/:orderId/payments', summary: 'Start online payment; returns the checkout URL (requires Idempotency-Key)', tag: 'Payments', access: 'order.place',
      params: OrderParams, response: PaymentInitSchema, middleware: [limits.payment],
      handler: ({ me, params, req }) => payments.initialize(me(), params.orderId, idempotencyKey(req)),
    }),
    defineRoute({
      method: 'post', path: '/v1/payments/:reference/verify', summary: 'Ask the provider for the payment result and apply it', tag: 'Payments', access: 'order.read.own',
      params: z.object({ reference: z.string().regex(/^[A-Z0-9-]{4,40}$/) }), response: PaymentVerifyResultSchema, middleware: [limits.payment],
      handler: ({ me, params }) => payments.verifyForCustomer(me(), params.reference),
    }),
    defineRoute({
      method: 'post', path: '/v1/payments/webhooks/paystack', summary: 'Paystack webhook (signature-verified; not for clients)', tag: 'Payments', access: 'public',
      response: z.object({ ok: z.literal(true) }), middleware: [limits.webhook],
      handler: async ({ req }) => {
        await payments.handleWebhook(req.rawBody, req.headers, req.body);
        return { ok: true as const };
      },
    }),
  ];
}
