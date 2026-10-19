/**
 * Browser API client for the vendor portal.
 * - Sessions use the API's web mode: the refresh token lives in an httpOnly cookie that JavaScript
 *   cannot read; the short-lived access token is kept in memory only.
 * - On a 401, refresh once (shared between concurrent requests) and retry.
 */
export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  fieldErrors() {
    const out = {};
    if (this.code !== 'VALIDATION_FAILED' || !Array.isArray(this.details)) return out;
    for (const d of this.details) {
      const k = String(d.path ?? '').split('.')[0];
      if (k && !out[k]) out[k] = d.message;
    }
    return out;
  }
}

const NETWORK_MESSAGE = 'We can’t reach ChopNow. Check your connection and try again.';

export function createApiClient({ baseUrl, fetchImpl = (...a) => globalThis.fetch(...a), onSessionExpired = () => {} }) {
  let accessToken = null;
  let refreshing = null;

  async function send(method, path, { query, body, form, headers } = {}) {
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}${qs ? `?${qs}` : ''}`, {
        method,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-ChopNow-Client': 'web',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...headers,
        },
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      });
    } catch {
      throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_MESSAGE });
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = json?.error;
      throw new ApiError({
        status: res.status,
        code: err?.code ?? 'HTTP_ERROR',
        message: err?.message ?? (res.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'The request could not be completed.'),
        details: err?.details,
      });
    }
    return json;
  }

  function refresh() {
    if (!refreshing) {
      refreshing = send('POST', '/v1/auth/refresh', { body: {} })
        .then((auth) => {
          accessToken = auth.accessToken;
          return auth;
        })
        .catch(() => {
          accessToken = null;
          return null;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  }

  async function request(method, path, opts = {}) {
    try {
      return await send(method, path, opts);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401 || err.code !== 'UNAUTHENTICATED' || path.startsWith('/v1/auth/')) throw err;
      const renewed = await refresh();
      if (!renewed) {
        onSessionExpired();
        throw err;
      }
      return send(method, path, opts);
    }
  }

  return {
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
    del: (path, opts) => request('DELETE', path, opts),
    upload: (path, formData, opts) => request('POST', path, { ...opts, form: formData }),
    async login(input) {
      const auth = await send('POST', '/v1/auth/login', { body: input });
      accessToken = auth.accessToken;
      return auth;
    },
    async register(input) {
      const auth = await send('POST', '/v1/auth/register', { body: input });
      accessToken = auth.accessToken;
      return auth;
    },
    async logout() {
      try {
        await send('POST', '/v1/auth/logout', { body: {} });
      } finally {
        accessToken = null;
      }
    },
    restore: refresh,
  };
}

let expiredListener = () => {};
export const onSessionExpired = (fn) => {
  expiredListener = fn;
};

export const client = createApiClient({
  baseUrl: (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000').replace(/\/+$/, ''),
  onSessionExpired: () => expiredListener(),
});

const r = (id) => `/v1/vendor/restaurants/${id}`;

/** Endpoint functions (see docs/API_DOCUMENTATION.md). */
export const api = {
  me: () => client.get('/v1/me'),
  restaurants: {
    list: () => client.get('/v1/vendor/restaurants'),
    get: (id) => client.get(r(id)),
    create: (input) => client.post('/v1/vendor/restaurants', input),
    update: (id, input) => client.patch(r(id), input),
    setHours: (id, windows) => client.put(`${r(id)}/hours`, { windows }),
    setAccepting: (id, isAcceptingOrders) => client.put(`${r(id)}/availability`, { isAcceptingOrders }),
    uploadImage: (id, file, purpose) => {
      const fd = new FormData();
      fd.append('file', file);
      return client.upload(`${r(id)}/images?purpose=${purpose}`, fd);
    },
    documents: (id) => client.get(`${r(id)}/documents`),
    uploadDocument: (id, file, type) => {
      const fd = new FormData();
      fd.append('type', type);
      fd.append('file', file);
      return client.upload(`${r(id)}/documents`, fd);
    },
  },
  menu: {
    get: (id) => client.get(`${r(id)}/menu`),
    createCategory: (id, input) => client.post(`${r(id)}/categories`, input),
    updateCategory: (id, cid, input) => client.patch(`${r(id)}/categories/${cid}`, input),
    deleteCategory: (id, cid) => client.del(`${r(id)}/categories/${cid}`),
    createItem: (id, input) => client.post(`${r(id)}/items`, input),
    updateItem: (id, itemId, input) => client.put(`${r(id)}/items/${itemId}`, input),
    setItemAvailable: (id, itemId, isAvailable) => client.put(`${r(id)}/items/${itemId}/availability`, { isAvailable }),
    deleteItem: (id, itemId) => client.del(`${r(id)}/items/${itemId}`),
  },
  orders: {
    list: (id, query) => client.get(`${r(id)}/orders`, { query }),
    get: (id, orderId) => client.get(`${r(id)}/orders/${orderId}`),
    accept: (id, orderId, prepTimeMinutes) => client.post(`${r(id)}/orders/${orderId}/accept`, prepTimeMinutes ? { prepTimeMinutes } : {}),
    reject: (id, orderId, reason, note) => client.post(`${r(id)}/orders/${orderId}/reject`, { reason, ...(note ? { note } : {}) }),
    startPreparing: (id, orderId) => client.post(`${r(id)}/orders/${orderId}/start-preparing`),
    ready: (id, orderId) => client.post(`${r(id)}/orders/${orderId}/ready`),
    delay: (id, orderId, extraMinutes, note) => client.post(`${r(id)}/orders/${orderId}/delay`, { extraMinutes, ...(note ? { note } : {}) }),
  },
  finance: { settlements: (id) => client.get(`${r(id)}/settlements`) },
  reports: { sales: (id, from, to) => client.get(`${r(id)}/reports/sales`, { query: { from, to } }) },
  reviews: {
    list: (id, page = 1) => client.get(`${r(id)}/reviews`, { query: { page, pageSize: 20 } }),
    reply: (id, reviewId, reply) => client.post(`${r(id)}/reviews/${reviewId}/reply`, { reply }),
  },
};
