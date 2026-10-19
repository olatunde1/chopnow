import { API_BASE_URL } from './config';
import { createApiClient } from './api-client';
import { tokenStorage } from './token-storage';

let sessionExpiredListener = () => {};
export const onSessionExpired = (fn) => {
  sessionExpiredListener = fn;
};

export const client = createApiClient({
  baseUrl: API_BASE_URL,
  tokenStorage,
  onSessionExpired: () => sessionExpiredListener(),
});

const loc = (location) => (location ? { lat: location.latitude, lng: location.longitude } : {});

/** Endpoint functions. Shapes are documented in docs/API_DOCUMENTATION.md. */
export const api = {
  auth: {
    register: async (input) => client.setSession(await client.post('/v1/auth/register', input)),
    login: async (input) => client.setSession(await client.post('/v1/auth/login', input)),
    /** Revokes this device's session on the server, then forgets it locally even if the call fails. */
    logout: async () => {
      try {
        const refreshToken = await tokenStorage.getRefreshToken();
        if (refreshToken) await client.post('/v1/auth/logout', { refreshToken });
      } catch {
        // Offline sign-out still clears local tokens; the server session expires on its own.
      } finally {
        await client.clearSession();
      }
    },
    /** Restores a session from the stored refresh token on app start. */
    restore: () => client.refresh(),
  },
  me: {
    get: () => client.get('/v1/me', { auth: 'required' }),
    update: (input) => client.patch('/v1/me', input, { auth: 'required' }),
  },
  addresses: {
    list: () => client.get('/v1/me/addresses', { auth: 'required' }),
    create: (input) => client.post('/v1/me/addresses', input, { auth: 'required' }),
    update: (id, input) => client.patch(`/v1/me/addresses/${id}`, input, { auth: 'required' }),
    remove: (id) => client.del(`/v1/me/addresses/${id}`, { auth: 'required' }),
    makeDefault: (id) => client.post(`/v1/me/addresses/${id}/default`, undefined, { auth: 'required' }),
  },
  favourites: {
    list: (location) => client.get('/v1/me/favourites', { auth: 'required', query: loc(location) }),
    add: (restaurantId) => client.put(`/v1/me/favourites/${restaurantId}`, undefined, { auth: 'required' }),
    remove: (restaurantId) => client.del(`/v1/me/favourites/${restaurantId}`, { auth: 'required' }),
  },
  orders: {
    quote: (input) => client.post('/v1/orders/quote', input, { auth: 'required' }),
    create: (input, idempotencyKey) => client.post('/v1/orders', input, { auth: 'required', headers: { 'Idempotency-Key': idempotencyKey } }),
    list: (query) => client.get('/v1/orders', { auth: 'required', query }),
    get: (id) => client.get(`/v1/orders/${id}`, { auth: 'required' }),
    cancel: (id, reason) => client.post(`/v1/orders/${id}/cancel`, reason ? { reason } : {}, { auth: 'required' }),
    reorder: (id) => client.get(`/v1/orders/${id}/reorder`, { auth: 'required' }),
    startPayment: (id, idempotencyKey) => client.post(`/v1/orders/${id}/payments`, undefined, { auth: 'required', headers: { 'Idempotency-Key': idempotencyKey } }),
    review: (id, input) => client.post(`/v1/orders/${id}/review`, input, { auth: 'required' }),
    verifyPayment: (reference) => client.post(`/v1/payments/${encodeURIComponent(reference)}/verify`, undefined, { auth: 'required' }),
  },
  discovery: {
    restaurants: ({ location, ...query }) => client.get('/v1/restaurants', { query: { ...query, ...loc(location) } }),
    restaurant: (slug, location) => client.get(`/v1/restaurants/${encodeURIComponent(slug)}`, { query: loc(location) }),
    searchFood: ({ location, ...query }) => client.get('/v1/search/food', { query: { ...query, ...loc(location) } }),
    categories: () => client.get('/v1/food-categories'),
  },
};
