/**
 * HTTP client for the ChopNow API.
 * - Adds the in-memory access token to requests.
 * - On a 401, refreshes once (single-flight: concurrent requests share one refresh) and retries.
 * - If refresh fails, clears the session and calls onSessionExpired.
 * - Converts failures into ApiError with a message that is safe to show to users.
 */
export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field errors from VALIDATION_FAILED as { fieldName: message }. */
  fieldErrors() {
    const out = {};
    if (this.code !== 'VALIDATION_FAILED' || !Array.isArray(this.details)) return out;
    for (const d of this.details) {
      const key = String(d.path ?? '').split('.')[0];
      if (key && !out[key]) out[key] = d.message;
    }
    return out;
  }
}

const NETWORK_MESSAGE = 'We can’t reach ChopNow right now. Check your internet connection and try again.';

function buildUrl(baseUrl, path, query) {
  const url = `${baseUrl}${path}`;
  if (!query) return url;
  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return params.length ? `${url}?${params.join('&')}` : url;
}

export function createApiClient({ baseUrl, tokenStorage, fetchImpl = (...a) => globalThis.fetch(...a), onSessionExpired = () => {} }) {
  let accessToken = null;
  let refreshing = null;

  async function send(method, path, { query, body, form, token, headers } = {}) {
    let res;
    try {
      res = await fetchImpl(buildUrl(baseUrl, path, query), {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        // multipart uploads: fetch sets the boundary header itself
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

  /** Stores a new session (access token in memory, refresh token in secure storage). */
  async function setSession(auth) {
    accessToken = auth.accessToken;
    await tokenStorage.setRefreshToken(auth.refreshToken);
    return auth;
  }

  async function clearSession() {
    accessToken = null;
    await tokenStorage.clear();
  }

  /** Exchanges the stored refresh token for a new pair. Returns the auth payload or null. */
  function refresh() {
    if (!refreshing) {
      refreshing = (async () => {
        const refreshToken = await tokenStorage.getRefreshToken();
        if (!refreshToken) return null;
        try {
          return await setSession(await send('POST', '/v1/auth/refresh', { body: { refreshToken } }));
        } catch (err) {
          // Only a definitive rejection ends the session; a network blip keeps the stored token.
          if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 400)) await clearSession();
          return null;
        }
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  /**
   * Authenticated or anonymous request. `auth: 'required'` fails with 401 when signed out;
   * `auth: 'optional'` sends the token if there is one.
   */
  async function request(method, path, { auth = 'optional', ...opts } = {}) {
    if (!accessToken && auth === 'required') await refresh();
    try {
      return await send(method, path, { ...opts, token: accessToken });
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401 || err.code !== 'UNAUTHENTICATED' || !accessToken) throw err;
      const renewed = await refresh();
      if (!renewed) {
        onSessionExpired();
        throw err;
      }
      return send(method, path, { ...opts, token: accessToken });
    }
  }

  return {
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body }),
    del: (path, opts) => request('DELETE', path, opts),
    upload: (path, form, opts) => request('POST', path, { ...opts, form }),
    setSession,
    clearSession,
    refresh,
    hasAccessToken: () => !!accessToken,
  };
}
