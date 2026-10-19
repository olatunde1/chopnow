/**
 * Web preview only. Browsers have no keychain, so the refresh token is kept in sessionStorage
 * (cleared when the tab closes) rather than localStorage. The customer product ships as a native
 * app; the web build exists for development previews.
 */
const KEY = 'chopnow.refreshToken';

function store() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export const tokenStorage = {
  getRefreshToken: async () => store()?.getItem(KEY) ?? null,
  setRefreshToken: async (token) => store()?.setItem(KEY, token),
  clear: async () => store()?.removeItem(KEY),
};
