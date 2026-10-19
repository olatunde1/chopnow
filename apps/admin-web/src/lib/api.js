/**
 * Browser API client for the admin dashboard.
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
    /** Used after a password change, which returns a fresh session. */
    setAccessToken(token) {
      accessToken = token;
    },
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

const A = '/v1/admin';
const F = '/v1/admin/finance';

/** Endpoint functions (see docs/API_DOCUMENTATION.md: Admin, Operations, Finance). */
export const api = {
  me: () => client.get('/v1/me'),
  changePassword: (currentPassword, newPassword) => client.post('/v1/me/password', { currentPassword, newPassword }),
  dashboard: () => client.get(`${A}/dashboard`),
  orders: {
    list: (query) => client.get(`${A}/orders`, { query }),
    get: (id) => client.get(`${A}/orders/${id}`),
    cancel: (id, reason) => client.post(`${A}/orders/${id}/cancel`, { reason }),
    retryDelivery: (id, mode, reason) => client.post(`${A}/orders/${id}/retry-delivery`, { mode, reason }),
    confirmDelivered: (id, reason, cashCollectedKobo) => client.post(`${A}/orders/${id}/confirm-delivered`, { reason, ...(cashCollectedKobo !== undefined ? { cashCollectedKobo } : {}) }),
    requestRefund: (id, input) => client.post(`${A}/orders/${id}/refunds`, input),
    checkPayment: (reference) => client.post(`${A}/payments/${encodeURIComponent(reference)}/verify`),
  },
  dispatch: {
    board: () => client.get(`${A}/dispatch`),
    assign: (deliveryId, riderId, reason) => client.post(`${A}/deliveries/${deliveryId}/assign`, { riderId, reason }),
    unassign: (deliveryId, reason) => client.post(`${A}/deliveries/${deliveryId}/unassign`, { reason }),
  },
  restaurants: {
    list: (query) => client.get(`${A}/restaurants`, { query }),
    get: (id) => client.get(`${A}/restaurants/${id}`),
    approve: (id, note) => client.post(`${A}/restaurants/${id}/approve`, note ? { note } : {}),
    reject: (id, reason) => client.post(`${A}/restaurants/${id}/reject`, { reason }),
    suspend: (id, reason) => client.post(`${A}/restaurants/${id}/suspend`, { reason }),
  },
  riders: {
    list: (query) => client.get(`${A}/riders`, { query }),
    get: (id) => client.get(`${A}/riders/${id}`),
    approve: (id, riderType, note) => client.post(`${A}/riders/${id}/approve`, { riderType, ...(note ? { note } : {}) }),
    reject: (id, reason) => client.post(`${A}/riders/${id}/reject`, { reason }),
    suspend: (id, reason) => client.post(`${A}/riders/${id}/suspend`, { reason }),
    setType: (id, riderType) => client.put(`${A}/riders/${id}/type`, { riderType }),
  },
  documents: {
    /** owner: 'restaurant' | 'rider' */
    list: (owner, query) => client.get(`${A}/${owner}-documents`, { query }),
    link: (owner, id) => client.post(`${A}/${owner}-documents/${id}/link`),
    review: (owner, id, status, note) => client.post(`${A}/${owner}-documents/${id}/review`, { status, ...(note ? { note } : {}) }),
  },
  users: {
    list: (query) => client.get(`${A}/users`, { query }),
    suspend: (id, reason) => client.post(`${A}/users/${id}/suspend`, { reason }),
    reactivate: (id, reason) => client.post(`${A}/users/${id}/reactivate`, { reason }),
    createStaff: (input) => client.post(`${A}/staff`, input),
  },
  promotions: {
    list: () => client.get(`${A}/promotions`),
    create: (input) => client.post(`${A}/promotions`, input),
    update: (id, input) => client.patch(`${A}/promotions/${id}`, input),
  },
  reviews: {
    list: (query) => client.get(`${A}/reviews`, { query }),
    moderate: (id, status, note) => client.post(`${A}/reviews/${id}/moderate`, { status, note }),
  },
  audit: (query) => client.get(`${A}/audit`, { query }),
  settings: {
    get: () => client.get(`${A}/settings/business-rules`),
    put: (rules) => client.put(`${A}/settings/business-rules`, rules),
  },
  finance: {
    summary: (from, to) => client.get(`${F}/summary`, { query: { from, to } }),
    refunds: (query) => client.get(`${F}/refunds`, { query }),
    approveRefund: (id, chargeTo) => client.post(`${F}/refunds/${id}/approve`, chargeTo ? { chargeTo } : {}),
    rejectRefund: (id, reason) => client.post(`${F}/refunds/${id}/reject`, { reason }),
    retryRefund: (id) => client.post(`${F}/refunds/${id}/retry`),
    markRefundPaid: (id, bankReference) => client.post(`${F}/refunds/${id}/mark-paid`, { bankReference }),
    refreshRefund: (id) => client.post(`${F}/refunds/${id}/refresh`),
    cash: () => client.get(`${F}/cash`),
    remittances: (query) => client.get(`${F}/remittances`, { query }),
    recordRemittance: (input) => client.post(`${F}/remittances`, input),
    confirmRemittance: (id) => client.post(`${F}/remittances/${id}/confirm`),
    rejectRemittance: (id, reason) => client.post(`${F}/remittances/${id}/reject`, { reason }),
    generateSettlements: (input) => client.post(`${F}/settlements/generate`, input),
    settlements: (query) => client.get(`${F}/settlements`, { query }),
    approveSettlement: (kind, id) => client.post(`${F}/settlements/${kind}/${id}/approve`),
    cancelSettlement: (kind, id, reason) => client.post(`${F}/settlements/${kind}/${id}/cancel`, { reason }),
    startPayout: (kind, id) => client.post(`${F}/settlements/${kind}/${id}/payout`),
    completePayout: (payoutId, bankReference) => client.post(`${F}/payouts/${payoutId}/complete`, { bankReference }),
    failPayout: (payoutId, reason) => client.post(`${F}/payouts/${payoutId}/fail`, { reason }),
  },
};
