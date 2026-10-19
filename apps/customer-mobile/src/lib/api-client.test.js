import { ApiError, createApiClient } from './api-client';

function memoryStorage(initial = null) {
  let token = initial;
  return {
    getRefreshToken: jest.fn(async () => token),
    setRefreshToken: jest.fn(async (t) => {
      token = t;
    }),
    clear: jest.fn(async () => {
      token = null;
    }),
    peek: () => token,
  };
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
const authPayload = (n) => ({ user: { id: 'u1', fullName: 'Ada' }, accessToken: `access-${n}`, accessTokenExpiresIn: 900, refreshToken: `refresh-${n}` });

describe('api client', () => {
  it('builds query strings, skipping empty values', async () => {
    const fetchImpl = jest.fn(async () => json(200, { ok: true }));
    const client = createApiClient({ baseUrl: 'http://api', tokenStorage: memoryStorage(), fetchImpl });
    await client.get('/v1/search/food', { query: { q: 'jollof rice', lat: 6.5, page: undefined, category: '' } });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://api/v1/search/food?q=jollof%20rice&lat=6.5');
  });

  it('turns API errors into ApiError with field errors', async () => {
    const fetchImpl = jest.fn(async () =>
      json(400, { error: { code: 'VALIDATION_FAILED', message: 'Some fields are invalid', details: [{ in: 'body', path: 'email', message: 'Enter a valid email address' }] } }),
    );
    const client = createApiClient({ baseUrl: 'http://api', tokenStorage: memoryStorage(), fetchImpl });
    const err = await client.post('/v1/auth/login', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.fieldErrors()).toEqual({ email: 'Enter a valid email address' });
  });

  it('reports network failures with a friendly message', async () => {
    const client = createApiClient({ baseUrl: 'http://api', tokenStorage: memoryStorage(), fetchImpl: async () => { throw new TypeError('Network request failed'); } });
    const err = await client.get('/health').catch((e) => e);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).toMatch(/internet connection/);
  });

  it('refreshes once on 401 and retries, sharing one refresh between concurrent requests', async () => {
    const storage = memoryStorage('refresh-0');
    let refreshCalls = 0;
    const fetchImpl = jest.fn(async (url, init) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshCalls += 1;
        return json(200, authPayload(refreshCalls));
      }
      const auth = init.headers.Authorization;
      return auth === 'Bearer access-1' ? json(200, { ok: true }) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue' } });
    });
    const client = createApiClient({ baseUrl: 'http://api', tokenStorage: storage, fetchImpl });
    await client.setSession(authPayload(0)); // access-0 is now "expired" server-side

    const results = await Promise.all([client.get('/v1/me', { auth: 'required' }), client.get('/v1/me/addresses', { auth: 'required' })]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
    expect(storage.peek()).toBe('refresh-1'); // rotated token persisted
  });

  it('ends the session when the refresh token is rejected', async () => {
    const storage = memoryStorage('stolen-or-expired');
    const onSessionExpired = jest.fn();
    const fetchImpl = jest.fn(async (url) =>
      url.endsWith('/v1/auth/refresh')
        ? json(401, { error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue' } })
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue' } }),
    );
    const client = createApiClient({ baseUrl: 'http://api', tokenStorage: storage, fetchImpl, onSessionExpired });
    await client.setSession(authPayload(0));
    const err = await client.get('/v1/me', { auth: 'required' }).catch((e) => e);
    expect(err.status).toBe(401);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(storage.peek()).toBeNull();
    expect(client.hasAccessToken()).toBe(false);
  });

  it('keeps the stored refresh token when the refresh fails because of the network', async () => {
    const storage = memoryStorage('refresh-0');
    const client = createApiClient({
      baseUrl: 'http://api',
      tokenStorage: storage,
      fetchImpl: async () => {
        throw new TypeError('offline');
      },
    });
    expect(await client.refresh()).toBeNull();
    expect(storage.peek()).toBe('refresh-0');
  });
});
