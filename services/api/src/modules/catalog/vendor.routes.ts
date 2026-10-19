import { z } from 'zod';
import {
  AvailabilityUpdateSchema,
  CategoryInputSchema,
  CategoryUpdateSchema,
  IdSchema,
  ItemAvailabilitySchema,
  MenuCategorySchema,
  MenuItemInputSchema,
  MenuItemSchema,
  MenuSchema,
  OkResponseSchema,
  OpeningHoursUpdateSchema,
  RestaurantCreateSchema,
  RestaurantUpdateSchema,
  VendorRestaurantSchema,
} from '@chopnow/shared-schemas';
import { defineRoute } from '../../http/route.js';
import type { VendorCatalogService } from './vendor-catalog.service.js';

const R = z.object({ restaurantId: IdSchema });
const RC = R.extend({ categoryId: IdSchema });
const RI = R.extend({ itemId: IdSchema });
const base = '/v1/vendor/restaurants';

export function vendorRoutes(svc: VendorCatalogService) {
  const tag = 'Vendor: restaurants & menu';
  return [
    defineRoute({
      method: 'get', path: base, summary: 'List my restaurants', tag, access: 'restaurant.manage.own',
      response: z.object({ items: z.array(VendorRestaurantSchema) }),
      handler: ({ me }) => svc.listOwn(me()),
    }),
    defineRoute({
      method: 'post', path: base, summary: 'Register a restaurant (starts PENDING approval)', tag, access: 'restaurant.manage.own',
      body: RestaurantCreateSchema, response: VendorRestaurantSchema, status: 201,
      handler: ({ me, body, requestContext }) => svc.create(me(), body, requestContext),
    }),
    defineRoute({
      method: 'get', path: `${base}/:restaurantId`, summary: 'Get one of my restaurants', tag, access: 'restaurant.manage.own',
      params: R, response: VendorRestaurantSchema,
      handler: ({ me, params }) => svc.getOwn(me(), params.restaurantId),
    }),
    defineRoute({
      method: 'patch', path: `${base}/:restaurantId`, summary: 'Update restaurant profile', tag, access: 'restaurant.manage.own',
      params: R, body: RestaurantUpdateSchema, response: VendorRestaurantSchema,
      handler: ({ me, params, body, requestContext }) => svc.update(me(), params.restaurantId, body, requestContext),
    }),
    defineRoute({
      method: 'put', path: `${base}/:restaurantId/hours`, summary: 'Replace opening hours (minutes after midnight, Lagos time)', tag, access: 'restaurant.manage.own',
      params: R, body: OpeningHoursUpdateSchema, response: VendorRestaurantSchema,
      handler: ({ me, params, body, requestContext }) => svc.replaceHours(me(), params.restaurantId, body.windows, requestContext),
    }),
    defineRoute({
      method: 'put', path: `${base}/:restaurantId/availability`, summary: 'Switch accepting orders on or off', tag, access: 'restaurant.manage.own',
      params: R, body: AvailabilityUpdateSchema, response: VendorRestaurantSchema,
      handler: ({ me, params, body, requestContext }) => svc.setAvailability(me(), params.restaurantId, body.isAcceptingOrders, requestContext),
    }),

    defineRoute({
      method: 'get', path: `${base}/:restaurantId/menu`, summary: 'Full menu including hidden categories and sold-out items', tag, access: 'menu.manage.own',
      params: R, response: MenuSchema,
      handler: ({ me, params }) => svc.getMenu(me(), params.restaurantId),
    }),
    defineRoute({
      method: 'post', path: `${base}/:restaurantId/categories`, summary: 'Add a menu category', tag, access: 'menu.manage.own',
      params: R, body: CategoryInputSchema, response: MenuCategorySchema, status: 201,
      handler: ({ me, params, body }) => svc.createCategory(me(), params.restaurantId, body),
    }),
    defineRoute({
      method: 'patch', path: `${base}/:restaurantId/categories/:categoryId`, summary: 'Rename, reorder or hide a category', tag, access: 'menu.manage.own',
      params: RC, body: CategoryUpdateSchema, response: MenuCategorySchema,
      handler: ({ me, params, body }) => svc.updateCategory(me(), params.restaurantId, params.categoryId, body),
    }),
    defineRoute({
      method: 'delete', path: `${base}/:restaurantId/categories/:categoryId`, summary: 'Delete an empty category', tag, access: 'menu.manage.own',
      params: RC, response: OkResponseSchema,
      handler: ({ me, params }) => svc.deleteCategory(me(), params.restaurantId, params.categoryId),
    }),
    defineRoute({
      method: 'post', path: `${base}/:restaurantId/items`, summary: 'Add a menu item with variants and extras', tag, access: 'menu.manage.own',
      params: R, body: MenuItemInputSchema, response: MenuItemSchema, status: 201,
      handler: ({ me, params, body }) => svc.createItem(me(), params.restaurantId, body),
    }),
    defineRoute({
      method: 'put', path: `${base}/:restaurantId/items/:itemId`, summary: 'Replace a menu item definition', tag, access: 'menu.manage.own',
      params: RI, body: MenuItemInputSchema, response: MenuItemSchema,
      handler: ({ me, params, body }) => svc.updateItem(me(), params.restaurantId, params.itemId, body),
    }),
    defineRoute({
      method: 'put', path: `${base}/:restaurantId/items/:itemId/availability`, summary: 'Mark an item available or sold out', tag, access: 'menu.manage.own',
      params: RI, body: ItemAvailabilitySchema, response: MenuItemSchema,
      handler: ({ me, params, body }) => svc.setItemAvailability(me(), params.restaurantId, params.itemId, body.isAvailable),
    }),
    defineRoute({
      method: 'delete', path: `${base}/:restaurantId/items/:itemId`, summary: 'Remove a menu item', tag, access: 'menu.manage.own',
      params: RI, response: OkResponseSchema,
      handler: ({ me, params }) => svc.deleteItem(me(), params.restaurantId, params.itemId),
    }),
  ];
}
