import { z } from 'zod';
import {
  AddressInputSchema,
  AddressSchema,
  AddressUpdateSchema,
  IdSchema,
  MeResponseSchema,
  OkResponseSchema,
  UpdateProfileRequestSchema,
} from '@chopnow/shared-schemas';
import { defineRoute } from '../../http/route.js';
import type { AccountService } from './account.service.js';

const AddressParams = z.object({ addressId: IdSchema });
const RestaurantParams = z.object({ restaurantId: IdSchema });

export function accountRoutes(account: AccountService) {
  return [
    defineRoute({
      method: 'get',
      path: '/v1/me',
      summary: 'Current user profile',
      tag: 'Account',
      access: 'authenticated',
      response: MeResponseSchema,
      handler: ({ me }) => account.me(me()),
    }),
    defineRoute({
      method: 'patch',
      path: '/v1/me',
      summary: 'Update name or phone number',
      tag: 'Account',
      access: 'authenticated',
      body: UpdateProfileRequestSchema,
      response: MeResponseSchema,
      handler: ({ me, body }) => account.updateProfile(me(), body),
    }),

    defineRoute({
      method: 'get',
      path: '/v1/me/addresses',
      summary: 'List my delivery addresses',
      tag: 'Addresses',
      access: 'address.manage.own',
      response: z.object({ items: z.array(AddressSchema) }),
      handler: ({ me }) => account.listAddresses(me()),
    }),
    defineRoute({
      method: 'post',
      path: '/v1/me/addresses',
      summary: 'Add a delivery address (coordinates required)',
      tag: 'Addresses',
      access: 'address.manage.own',
      body: AddressInputSchema,
      response: AddressSchema,
      status: 201,
      handler: ({ me, body }) => account.createAddress(me(), body),
    }),
    defineRoute({
      method: 'patch',
      path: '/v1/me/addresses/:addressId',
      summary: 'Update one of my addresses',
      tag: 'Addresses',
      access: 'address.manage.own',
      params: AddressParams,
      body: AddressUpdateSchema,
      response: AddressSchema,
      handler: ({ me, params, body }) => account.updateAddress(me(), params.addressId, body),
    }),
    defineRoute({
      method: 'delete',
      path: '/v1/me/addresses/:addressId',
      summary: 'Remove one of my addresses',
      tag: 'Addresses',
      access: 'address.manage.own',
      params: AddressParams,
      response: OkResponseSchema,
      handler: ({ me, params }) => account.deleteAddress(me(), params.addressId),
    }),
    defineRoute({
      method: 'post',
      path: '/v1/me/addresses/:addressId/default',
      summary: 'Make an address my default',
      tag: 'Addresses',
      access: 'address.manage.own',
      params: AddressParams,
      response: AddressSchema,
      handler: ({ me, params }) => account.setDefaultAddress(me(), params.addressId),
    }),

    defineRoute({
      method: 'put',
      path: '/v1/me/favourites/:restaurantId',
      summary: 'Save a restaurant to favourites',
      tag: 'Favourites',
      access: 'favourite.manage.own',
      params: RestaurantParams,
      response: OkResponseSchema,
      handler: ({ me, params }) => account.addFavourite(me(), params.restaurantId),
    }),
    defineRoute({
      method: 'delete',
      path: '/v1/me/favourites/:restaurantId',
      summary: 'Remove a restaurant from favourites',
      tag: 'Favourites',
      access: 'favourite.manage.own',
      params: RestaurantParams,
      response: OkResponseSchema,
      handler: ({ me, params }) => account.removeFavourite(me(), params.restaurantId),
    }),
  ];
}
