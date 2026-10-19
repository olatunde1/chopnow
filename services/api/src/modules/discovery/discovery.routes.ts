import { z } from 'zod';
import {
  CategoryListResponseSchema,
  FoodSearchQuerySchema,
  FoodSearchResponseSchema,
  LocationOnlyQuerySchema,
  RestaurantDetailSchema,
  RestaurantListResponseSchema,
  RestaurantSearchQuerySchema,
  RestaurantSummarySchema,
} from '@chopnow/shared-schemas';
import { defineRoute } from '../../http/route.js';
import type { DiscoveryService } from './discovery.service.js';

const loc = (q: { lat?: number; lng?: number }) =>
  q.lat !== undefined && q.lng !== undefined ? { latitude: q.lat, longitude: q.lng } : null;

export function discoveryRoutes(svc: DiscoveryService) {
  const tag = 'Discovery';
  return [
    defineRoute({
      method: 'get', path: '/v1/restaurants', summary: 'Browse restaurants (restaurant-first)', tag, access: 'optional',
      query: RestaurantSearchQuerySchema, response: RestaurantListResponseSchema,
      handler: ({ query, principal }) => svc.listRestaurants(query, principal),
    }),
    defineRoute({
      method: 'get', path: '/v1/restaurants/:slug', summary: 'Restaurant details and menu', tag, access: 'optional',
      params: z.object({ slug: z.string().regex(/^[a-z0-9-]{1,80}$/) }), query: LocationOnlyQuerySchema, response: RestaurantDetailSchema,
      handler: ({ params, query, principal }) => svc.getRestaurant(params.slug, loc(query), principal),
    }),
    defineRoute({
      method: 'get', path: '/v1/search/food', summary: 'Search meals across restaurants (food-first)', tag, access: 'optional',
      query: FoodSearchQuerySchema, response: FoodSearchResponseSchema,
      handler: ({ query, principal }) => svc.searchFood(query, principal),
    }),
    defineRoute({
      method: 'get', path: '/v1/food-categories', summary: 'Food categories available right now', tag, access: 'public',
      response: CategoryListResponseSchema,
      handler: () => svc.listCategories(),
    }),
    defineRoute({
      method: 'get', path: '/v1/me/favourites', summary: 'My favourite restaurants', tag: 'Favourites', access: 'favourite.manage.own',
      query: LocationOnlyQuerySchema, response: z.object({ items: z.array(RestaurantSummarySchema) }),
      handler: ({ me, query }) => svc.listFavourites(me(), loc(query)),
    }),
  ];
}
