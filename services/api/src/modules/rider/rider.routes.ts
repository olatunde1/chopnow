import multer from 'multer';
import { z } from 'zod';
import {
  AvailabilityRequestSchema,
  CompleteDeliverySchema,
  DeclineOfferSchema,
  IdSchema,
  OkResponseSchema,
  PageQuerySchema,
  ReleaseDeliverySchema,
  ReportProblemSchema,
  RiderDeliveryHistorySchema,
  RiderDeliverySchema,
  RiderEarningsQuerySchema,
  RiderEarningsSchema,
  RiderLocationSchema,
  RiderProfileSchema,
  RiderWorkSchema,
  VerificationDocumentSchema,
} from '@chopnow/shared-schemas';
import type { RequestHandler } from 'express';
import { defineRoute } from '../../http/route.js';
import { AppError } from '../../lib/errors.js';
import type { StorageDriver } from '../storage/storage.js';
import { MAX_DOCUMENT_BYTES } from '../storage/uploads.js';
import type { RiderService } from './rider.service.js';

const D = z.object({ deliveryId: IdSchema });
const O = z.object({ offerId: IdSchema });
const singleFile = (maxBytes: number): RequestHandler => multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 5, parts: 6 } }).single('file');

export function riderRoutes(deps: { riders: RiderService; storage: StorageDriver; uploadLimiter: RequestHandler }) {
  const { riders } = deps;
  const tag = 'Rider';
  const work = 'delivery.work.own' as const;
  const profile = 'rider.profile.own' as const;

  return [
    defineRoute({
      method: 'get', path: '/v1/rider/me', summary: 'My rider profile, status, outstanding cash and today’s earnings', tag, access: profile,
      response: RiderProfileSchema,
      handler: ({ me }) => riders.profile(me()),
    }),
    defineRoute({
      method: 'put', path: '/v1/rider/availability', summary: 'Go online (approved riders only) or offline (withdraws a pending offer)', tag, access: work,
      body: AvailabilityRequestSchema, response: RiderProfileSchema,
      handler: ({ me, body }) => riders.setAvailability(me(), body.online),
    }),
    defineRoute({
      method: 'put', path: '/v1/rider/location', summary: 'Report my latest position (stored only while online; overwritten, never a history)', tag, access: work,
      body: RiderLocationSchema, response: OkResponseSchema,
      handler: ({ me, body }) => riders.updateLocation(me(), body.latitude, body.longitude),
    }),
    defineRoute({
      method: 'get', path: '/v1/rider/work', summary: 'Current offer and active delivery (poll while online; also a heartbeat)', tag, access: work,
      response: RiderWorkSchema,
      handler: ({ me }) => riders.work(me()),
    }),
    defineRoute({
      method: 'post', path: '/v1/rider/offers/:offerId/accept', summary: 'Accept a delivery offer (first valid acceptance wins)', tag, access: work,
      params: O, response: RiderDeliverySchema,
      handler: ({ me, params }) => riders.acceptOffer(me(), params.offerId),
    }),
    defineRoute({
      method: 'post', path: '/v1/rider/offers/:offerId/decline', summary: 'Decline a delivery offer', tag, access: work,
      params: O, body: DeclineOfferSchema, response: OkResponseSchema,
      handler: ({ me, params, body }) => riders.declineOffer(me(), params.offerId, body.reason),
    }),
    defineRoute({
      method: 'post', path: '/v1/rider/deliveries/:deliveryId/arrived', summary: 'I have arrived at the restaurant', tag, access: work,
      params: D, response: RiderDeliverySchema,
      handler: ({ me, params }) => riders.arrived(me(), params.deliveryId),
    }),
    defineRoute({
      method: 'post', path: '/v1/rider/deliveries/:deliveryId/picked-up', summary: 'I have collected the food (restaurant must have marked it ready)', tag, access: work,
      params: D, response: RiderDeliverySchema,
      handler: ({ me, params }) => riders.pickedUp(me(), params.deliveryId),
    }),
    defineRoute({
      method: 'post', path: '/v1/rider/deliveries/:deliveryId/complete', summary: 'Complete with the customer’s PIN (and cash received, for cash orders)', tag, access: work,
      params: D, body: CompleteDeliverySchema, response: RiderDeliverySchema,
      handler: ({ me, params, body, requestContext }) => riders.complete(me(), params.deliveryId, body.pin, body.cashCollectedKobo, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/rider/deliveries/:deliveryId/release', summary: 'Hand a job back before pickup (it is offered to another rider)', tag, access: work,
      params: D, body: ReleaseDeliverySchema, response: OkResponseSchema,
      handler: ({ me, params, body, requestContext }) => riders.release(me(), params.deliveryId, body.reason, body.note, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/rider/deliveries/:deliveryId/problem', summary: 'Report that a picked-up order can’t be delivered (operations takes over)', tag, access: work,
      params: D, body: ReportProblemSchema, response: RiderDeliverySchema,
      handler: ({ me, params, body, requestContext }) => riders.reportProblem(me(), params.deliveryId, body.reason, body.note, requestContext),
    }),
    defineRoute({
      method: 'get', path: '/v1/rider/deliveries', summary: 'My past deliveries (drop-off area only)', tag, access: work,
      query: PageQuerySchema, response: RiderDeliveryHistorySchema,
      handler: ({ me, query }) => riders.history(me(), query.page, query.pageSize),
    }),
    defineRoute({
      method: 'get', path: '/v1/rider/earnings', summary: 'Earnings by Lagos day, unsettled total and outstanding cash', tag, access: 'earnings.read.own',
      query: RiderEarningsQuerySchema, response: RiderEarningsSchema,
      handler: ({ me, query }) => riders.earnings(me(), query.from, query.to),
    }),
    defineRoute({
      method: 'post', path: '/v1/rider/documents', summary: 'Upload a verification document (multipart "file" + "type"; PDF/JPG/PNG ≤ 10 MB; stored privately)', tag, access: profile,
      response: VerificationDocumentSchema, status: 201,
      middleware: [deps.uploadLimiter, singleFile(MAX_DOCUMENT_BYTES)],
      handler: ({ me, req }) => {
        if (!req.file) throw new AppError(400, 'FILE_REQUIRED', 'Choose a file to upload.');
        return riders.uploadDocument(me(), deps.storage, req.file, String(req.body?.type ?? ''));
      },
    }),
    defineRoute({
      method: 'get', path: '/v1/rider/documents', summary: 'My verification documents and their review status', tag, access: profile,
      response: z.object({ items: z.array(VerificationDocumentSchema) }),
      handler: ({ me }) => riders.documents(me()),
    }),
  ];
}
