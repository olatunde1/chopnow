import * as SecureStore from 'expo-secure-store';

/**
 * Refresh token storage on iOS/Android: the OS keychain/keystore via expo-secure-store.
 * (Web uses token-storage.web.js.) The short-lived access token is kept only in memory.
 */
const KEY = 'chopnow.rider.refreshToken';

export const tokenStorage = {
  getRefreshToken: () => SecureStore.getItemAsync(KEY),
  setRefreshToken: (token) => SecureStore.setItemAsync(KEY, token),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
