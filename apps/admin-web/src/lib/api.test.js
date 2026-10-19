import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './api';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
const unauthenticated = () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in again' } });

describe('vendor API client', () => {
  it('sends the web-client header and includes cookies, never a refresh token in the body', async () => {
    const fetchImpl = vi.fn(async () => json(200, { accessToken: 'a1', user: { role: 'VENDOR' } }));
    const c = createApiClient({ baseUrl: 'http://api', fetchImpl });
    await c.login({ email: 'v@x.ng', password: 'pw' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api/v1/auth/login');
    expect(init.credentials).toBe('include');
    expect(init.headers['X-ChopNow-Client']).toBe('web');
  });

  it('attaches the in-memory access token after login', async () => {
    const fetchImpl = vi.fn(async (url) => (url.endsWith('/login') ? json(200, { accessToken: 'a1', user: {} }) : json(200, { ok: true })));
    const c = createApiClient({ baseUrl: 'http://api', fetchImpl });
    await c.login({ email: 'v@x.ng', password: 'pw' });
    await c.get('/v1/me');
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer a1');
  });

  it('refreshes once for concurrent 401s, then retries each request', async () => {
    let refreshes = 0;
    let token = null;
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshes += 1;
        token = 'fresh';
        return json(200, { accessToken: 'fresh', user: {} });
      }
      return init.headers.Authorization === `Bearer ${token}` && token ? json(200, { url }) : unauthenticated();
    });
    const c = createApiClient({ baseUrl: 'http://api', fetchImpl });
    const [a, b] = await Promise.all([c.get('/v1/a'), c.get('/v1/b')]);
    expect(a.url).toBe('http://api/v1/a');
    expect(b.url).toBe('http://api/v1/b');
    expect(refreshes).toBe(1);
  });

  it('reports an expired session when the refresh fails', async () => {
    const onSessionExpired = vi.fn();
    const fetchImpl = vi.fn(async () => unauthenticated());
    const c = createApiClient({ baseUrl: 'http://api', fetchImpl, onSessionExpired });
    await expect(c.get('/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('does not try to refresh on auth endpoints (wrong password stays a 401)', async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Email or password is incorrect' } }));
    const c = createApiClient({ baseUrl: 'http://api', fetchImpl });
    await expect(c.login({ email: 'v@x.ng', password: 'bad' })).rejects.toMatchObject({ status: 401, message: 'Email or password is incorrect' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('turns network failures and validation details into friendly errors', async () => {
    const offline = createApiClient({ baseUrl: 'http://api', fetchImpl: async () => Promise.reject(new TypeError('fetch failed')) });
    await expect(offline.get('/v1/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

    const invalid = createApiClient({
      baseUrl: 'http://api',
      fetchImpl: async () => json(400, { error: { code: 'VALIDATION_FAILED', message: 'Check the form', details: [{ path: 'name', message: 'Too short' }, { path: 'variants.0.name', message: 'Required' }] } }),
    });
    const err = await invalid.post('/v1/x', {}).catch((e) => e);
    expect(err.fieldErrors()).toEqual({ name: 'Too short', variants: 'Required' });
  });

  it('drops empty query values and encodes the rest', async () => {
    const fetchImpl = vi.fn(async () => json(200, {}));
    const c = createApiClient({ baseUrl: 'http://api', fetchImpl });
    await c.get('/v1/o', { query: { view: 'history', q: '', page: 2, code: 'CN 7&K' } });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://api/v1/o?view=history&page=2&code=CN%207%26K');
  });
});
