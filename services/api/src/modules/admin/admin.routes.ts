import { z } from 'zod';
import {
  AdminRestaurantListQuerySchema,
  AdminRestaurantListSchema,
  AdminRestaurantSchema,
  AdminRiderListQuerySchema,
  AdminRiderListSchema,
  AdminRiderSchema,
  ApproveRestaurantSchema,
  ApproveRiderSchema,
  BusinessRulesSchema,
  DecisionWithReasonSchema,
  IdSchema,
  SetRiderTypeSchema,
} from '@chopnow/shared-schemas';
import { defineRoute } from '../../http/route.js';
import type { ApprovalsService } from './approvals.service.js';

const RestaurantParams = z.object({ restaurantId: IdSchema });
const RiderParams = z.object({ riderId: IdSchema });

export function adminRoutes(svc: ApprovalsService) {
  const r = '/v1/admin/restaurants';
  const d = '/v1/admin/riders';
  return [
    defineRoute({
      method: 'get', path: r, summary: 'List restaurants (filter by approval status)', tag: 'Admin: restaurants', access: 'restaurant.read.any',
      query: AdminRestaurantListQuerySchema, response: AdminRestaurantListSchema,
      handler: ({ query }) => svc.listRestaurants(query),
    }),
    defineRoute({
      method: 'get', path: `${r}/:restaurantId`, summary: 'Restaurant details for review', tag: 'Admin: restaurants', access: 'restaurant.read.any',
      params: RestaurantParams, response: AdminRestaurantSchema,
      handler: ({ params }) => svc.getRestaurant(params.restaurantId),
    }),
    defineRoute({
      method: 'post', path: `${r}/:restaurantId/approve`, summary: 'Approve a restaurant', tag: 'Admin: restaurants', access: 'restaurant.approve',
      params: RestaurantParams, body: ApproveRestaurantSchema, response: AdminRestaurantSchema,
      handler: ({ me, params, body, requestContext }) => svc.approveRestaurant(me(), params.restaurantId, body.note, requestContext),
    }),
    defineRoute({
      method: 'post', path: `${r}/:restaurantId/reject`, summary: 'Reject a pending restaurant', tag: 'Admin: restaurants', access: 'restaurant.approve',
      params: RestaurantParams, body: DecisionWithReasonSchema, response: AdminRestaurantSchema,
      handler: ({ me, params, body, requestContext }) => svc.rejectRestaurant(me(), params.restaurantId, body.reason, requestContext),
    }),
    defineRoute({
      method: 'post', path: `${r}/:restaurantId/suspend`, summary: 'Suspend an approved restaurant (stops new orders)', tag: 'Admin: restaurants', access: 'restaurant.approve',
      params: RestaurantParams, body: DecisionWithReasonSchema, response: AdminRestaurantSchema,
      handler: ({ me, params, body, requestContext }) => svc.suspendRestaurant(me(), params.restaurantId, body.reason, requestContext),
    }),

    defineRoute({
      method: 'get', path: d, summary: 'List riders (filter by status and type)', tag: 'Admin: riders', access: 'rider.read.any',
      query: AdminRiderListQuerySchema, response: AdminRiderListSchema,
      handler: ({ query }) => svc.listRiders(query),
    }),
    defineRoute({
      method: 'get', path: `${d}/:riderId`, summary: 'Rider details for review', tag: 'Admin: riders', access: 'rider.read.any',
      params: RiderParams, response: AdminRiderSchema,
      handler: ({ params }) => svc.getRider(params.riderId),
    }),
    defineRoute({
      method: 'post', path: `${d}/:riderId/approve`, summary: 'Approve a rider as CORE or INDEPENDENT', tag: 'Admin: riders', access: 'rider.approve',
      params: RiderParams, body: ApproveRiderSchema, response: AdminRiderSchema,
      handler: ({ me, params, body, requestContext }) => svc.approveRider(me(), params.riderId, body.riderType, body.note, requestContext),
    }),
    defineRoute({
      method: 'post', path: `${d}/:riderId/reject`, summary: 'Reject a pending rider', tag: 'Admin: riders', access: 'rider.approve',
      params: RiderParams, body: DecisionWithReasonSchema, response: AdminRiderSchema,
      handler: ({ me, params, body, requestContext }) => svc.rejectRider(me(), params.riderId, body.reason, requestContext),
    }),
    defineRoute({
      method: 'post', path: `${d}/:riderId/suspend`, summary: 'Suspend a rider (sets them offline)', tag: 'Admin: riders', access: 'rider.approve',
      params: RiderParams, body: DecisionWithReasonSchema, response: AdminRiderSchema,
      handler: ({ me, params, body, requestContext }) => svc.suspendRider(me(), params.riderId, body.reason, requestContext),
    }),
    defineRoute({
      method: 'put', path: `${d}/:riderId/type`, summary: 'Change rider type', tag: 'Admin: riders', access: 'rider.approve',
      params: RiderParams, body: SetRiderTypeSchema, response: AdminRiderSchema,
      handler: ({ me, params, body, requestContext }) => svc.setRiderType(me(), params.riderId, body.riderType, requestContext),
    }),

    defineRoute({
      method: 'get', path: '/v1/admin/settings/business-rules', summary: 'Current fees, commission, COD and dispatch rules', tag: 'Admin: settings', access: 'config.manage',
      response: BusinessRulesSchema,
      handler: () => svc.getBusinessRules(),
    }),
    defineRoute({
      method: 'put', path: '/v1/admin/settings/business-rules', summary: 'Replace business rules (audited; affects new orders only)', tag: 'Admin: settings', access: 'config.manage',
      body: BusinessRulesSchema, response: BusinessRulesSchema,
      handler: ({ me, body, requestContext }) => svc.updateBusinessRules(me(), body, requestContext),
    }),
  ];
}
