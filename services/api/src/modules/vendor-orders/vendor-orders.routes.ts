import multer from 'multer';
import { z } from 'zod';
import {
  AcceptOrderSchema,
  DOCUMENT_TYPES,
  DelayOrderSchema,
  IMAGE_PURPOSES,
  IdSchema,
  ImageUploadResultSchema,
  OkResponseSchema,
  PageQuerySchema,
  RejectOrderSchema,
  ReviewListSchema,
  ReviewReplySchema,
  SalesReportQuerySchema,
  SalesReportSchema,
  VendorOrderListSchema,
  VendorOrderQuerySchema,
  VendorOrderSchema,
  VerificationDocumentSchema,
} from '@chopnow/shared-schemas';
import type { RequestHandler } from 'express';
import type { Db } from '../../db/client.js';
import { defineRoute } from '../../http/route.js';
import { AppError, Errors } from '../../lib/errors.js';
import type { ReviewsService } from '../reviews/reviews.service.js';
import type { StorageDriver } from '../storage/storage.js';
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, storeDocument, storeImage } from '../storage/uploads.js';
import type { VendorOrdersService } from './vendor-orders.service.js';

const R = z.object({ restaurantId: IdSchema });
const RO = R.extend({ orderId: IdSchema });
const base = '/v1/vendor/restaurants/:restaurantId';

/** Multipart parsing into memory with hard limits; files never touch disk unvalidated. */
const singleFile = (maxBytes: number): RequestHandler => multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 5, parts: 6 } }).single('file');

export function vendorOrderRoutes(deps: { orders: VendorOrdersService; reviews: ReviewsService; storage: StorageDriver; db: Db; uploadLimiter: RequestHandler }) {
  const { orders, reviews, storage, db } = deps;
  const tag = 'Vendor: orders';

  const ownedRestaurant = async (userId: string, restaurantId: string) => {
    const r = await db.restaurant.findFirst({ where: { id: restaurantId, ownerId: userId } });
    if (!r) throw Errors.notFound('Restaurant');
    return r;
  };

  return [
    defineRoute({
      method: 'get', path: `${base}/orders`, summary: 'Orders sent to this restaurant (incoming, active or history)', tag, access: 'order.process.own',
      params: R, query: VendorOrderQuerySchema, response: VendorOrderListSchema,
      handler: ({ me, params, query }) => orders.list(me(), params.restaurantId, query),
    }),
    defineRoute({
      method: 'get', path: `${base}/orders/:orderId`, summary: 'One order (no customer contact details or delivery PIN)', tag, access: 'order.process.own',
      params: RO, response: VendorOrderSchema,
      handler: ({ me, params }) => orders.get(me(), params.restaurantId, params.orderId),
    }),
    defineRoute({
      method: 'post', path: `${base}/orders/:orderId/accept`, summary: 'Accept an order (optionally with a prep time)', tag, access: 'order.process.own',
      params: RO, body: AcceptOrderSchema, response: VendorOrderSchema,
      handler: ({ me, params, body }) => orders.accept(me(), params.restaurantId, params.orderId, body.prepTimeMinutes),
    }),
    defineRoute({
      method: 'post', path: `${base}/orders/:orderId/reject`, summary: 'Decline an order with a reason (refund requested if paid)', tag, access: 'order.process.own',
      params: RO, body: RejectOrderSchema, response: VendorOrderSchema,
      handler: ({ me, params, body, requestContext }) => orders.reject(me(), params.restaurantId, params.orderId, body.reason, body.note, requestContext),
    }),
    defineRoute({
      method: 'post', path: `${base}/orders/:orderId/start-preparing`, summary: 'Mark an accepted order as being prepared', tag, access: 'order.process.own',
      params: RO, response: VendorOrderSchema,
      handler: ({ me, params }) => orders.startPreparing(me(), params.restaurantId, params.orderId),
    }),
    defineRoute({
      method: 'post', path: `${base}/orders/:orderId/ready`, summary: 'Mark food ready for pickup', tag, access: 'order.process.own',
      params: RO, response: VendorOrderSchema,
      handler: ({ me, params }) => orders.markReady(me(), params.restaurantId, params.orderId),
    }),
    defineRoute({
      method: 'post', path: `${base}/orders/:orderId/delay`, summary: 'Report that food will be late (moves the estimated ready time)', tag, access: 'order.process.own',
      params: RO, body: DelayOrderSchema, response: VendorOrderSchema,
      handler: ({ me, params, body, requestContext }) => orders.reportDelay(me(), params.restaurantId, params.orderId, body.extraMinutes, body.note, requestContext),
    }),

    defineRoute({
      method: 'get', path: `${base}/reports/sales`, summary: 'Sales summary for a date range (Lagos dates)', tag: 'Vendor: reports', access: 'finance.read.own',
      params: R, query: SalesReportQuerySchema, response: SalesReportSchema,
      handler: ({ me, params, query }) => orders.salesReport(me(), params.restaurantId, query.from, query.to),
    }),

    defineRoute({
      method: 'get', path: `${base}/reviews`, summary: 'Customer reviews of this restaurant', tag: 'Vendor: reviews', access: 'review.reply.own',
      params: R, query: PageQuerySchema, response: ReviewListSchema,
      handler: ({ me, params, query }) => reviews.listForVendor(me(), params.restaurantId, query.page, query.pageSize),
    }),
    defineRoute({
      method: 'post', path: `${base}/reviews/:reviewId/reply`, summary: 'Reply publicly to a review', tag: 'Vendor: reviews', access: 'review.reply.own',
      params: R.extend({ reviewId: IdSchema }), body: ReviewReplySchema, response: OkResponseSchema,
      handler: ({ me, params, body }) => reviews.reply(me(), params.restaurantId, params.reviewId, body.reply),
    }),

    defineRoute({
      method: 'post', path: `${base}/images`, summary: 'Upload a food photo, logo or cover (multipart field "file"; JPG/PNG/WebP ≤ 5 MB)', tag: 'Vendor: restaurants & menu', access: 'menu.manage.own',
      params: R, query: z.object({ purpose: z.enum(IMAGE_PURPOSES) }), response: ImageUploadResultSchema, status: 201,
      middleware: [deps.uploadLimiter, singleFile(MAX_IMAGE_BYTES)],
      handler: async ({ me, params, query, req }) => {
        await ownedRestaurant(me().userId, params.restaurantId);
        if (!req.file) throw new AppError(400, 'FILE_REQUIRED', 'Choose a photo to upload.');
        return storeImage(storage, req.file.buffer, `restaurants/${params.restaurantId}/${query.purpose.replace('_', '-')}`);
      },
    }),
    defineRoute({
      method: 'post', path: `${base}/documents`, summary: 'Upload a verification document (multipart "file" + "type"; PDF/JPG/PNG ≤ 10 MB; stored privately)', tag: 'Vendor: restaurants & menu', access: 'restaurant.manage.own',
      params: R, response: VerificationDocumentSchema, status: 201,
      middleware: [deps.uploadLimiter, singleFile(MAX_DOCUMENT_BYTES)],
      handler: async ({ me, params, req }) => {
        await ownedRestaurant(me().userId, params.restaurantId);
        const type = z.enum(DOCUMENT_TYPES).safeParse(req.body?.type);
        if (!type.success) throw Errors.validation([{ in: 'body', path: 'type', message: 'Choose the document type' }]);
        if (!req.file) throw new AppError(400, 'FILE_REQUIRED', 'Choose a file to upload.');
        const stored = await storeDocument(storage, req.file.buffer, `verification/restaurants/${params.restaurantId}`);
        return db.verificationDocument.create({
          data: {
            restaurantId: params.restaurantId,
            type: type.data,
            storageKey: stored.key,
            originalName: req.file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document',
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
          },
        });
      },
    }),
    defineRoute({
      method: 'get', path: `${base}/documents`, summary: 'Verification documents I have uploaded and their review status', tag: 'Vendor: restaurants & menu', access: 'restaurant.manage.own',
      params: R, response: z.object({ items: z.array(VerificationDocumentSchema) }),
      handler: async ({ me, params }) => {
        await ownedRestaurant(me().userId, params.restaurantId);
        return { items: await db.verificationDocument.findMany({ where: { restaurantId: params.restaurantId }, orderBy: { uploadedAt: 'desc' } }) };
      },
    }),
  ];
}
