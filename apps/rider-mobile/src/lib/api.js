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

const auth = { auth: 'required' };

/** Endpoint functions. Shapes are documented in docs/API_DOCUMENTATION.md ("Rider"). */
export const api = {
  auth: {
    register: async (input) => client.setSession(await client.post('/v1/auth/register', { ...input, role: 'RIDER' })),
    login: async (input) => client.setSession(await client.post('/v1/auth/login', input)),
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
    restore: () => client.refresh(),
  },
  rider: {
    me: () => client.get('/v1/rider/me', auth),
    setOnline: (online) => client.put('/v1/rider/availability', { online }, auth),
    location: (latitude, longitude) => client.put('/v1/rider/location', { latitude, longitude }, auth),
    work: () => client.get('/v1/rider/work', auth),
    accept: (offerId) => client.post(`/v1/rider/offers/${offerId}/accept`, undefined, auth),
    decline: (offerId, reason) => client.post(`/v1/rider/offers/${offerId}/decline`, reason ? { reason } : {}, auth),
    arrived: (id) => client.post(`/v1/rider/deliveries/${id}/arrived`, undefined, auth),
    pickedUp: (id) => client.post(`/v1/rider/deliveries/${id}/picked-up`, undefined, auth),
    complete: (id, pin, cashCollectedKobo) => client.post(`/v1/rider/deliveries/${id}/complete`, { pin, ...(cashCollectedKobo !== undefined ? { cashCollectedKobo } : {}) }, auth),
    release: (id, reason, note) => client.post(`/v1/rider/deliveries/${id}/release`, { reason, ...(note ? { note } : {}) }, auth),
    problem: (id, reason, note) => client.post(`/v1/rider/deliveries/${id}/problem`, { reason, ...(note ? { note } : {}) }, auth),
    history: (page = 1) => client.get('/v1/rider/deliveries', { ...auth, query: { page, pageSize: 20 } }),
    earnings: (from, to) => client.get('/v1/rider/earnings', { ...auth, query: { from, to } }),
    documents: () => client.get('/v1/rider/documents', auth),
    remittances: () => client.get('/v1/rider/remittances', auth),
    declareRemittance: (amountKobo, reference) => client.post('/v1/rider/remittances', { amountKobo, reference }, auth),
    settlements: () => client.get('/v1/rider/settlements', auth),
    /** `file` is { uri, name, mimeType } from expo-document-picker. */
    uploadDocument: (type, file) => {
      const form = new FormData();
      form.append('type', type);
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' });
      return client.upload('/v1/rider/documents', form, auth);
    },
  },
};
