import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { STAFF_ROLES, hasPermission } from '@chopnow/shared-schemas';
import { api, client, onSessionExpired } from '../lib/api';

const SessionContext = createContext(null);
const NOT_STAFF = 'This dashboard is for ChopNow staff. Restaurants use the restaurant portal; riders and customers use the apps.';

/**
 * Signed-in staff member. `can(permission)` drives what the UI shows; the API enforces the same
 * permissions on every request, so hiding something here is never the security control.
 */
export function SessionProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: 'restoring', user: null, error: null });

  const accept = useCallback((user) => {
    if (!STAFF_ROLES.includes(user.role)) {
      void client.logout();
      setState({ status: 'signedOut', user: null, error: NOT_STAFF });
      return false;
    }
    setState({ status: 'signedIn', user, error: null });
    return true;
  }, []);

  useEffect(() => {
    client
      .restore()
      .then((auth) => (auth ? accept(auth.user) : setState({ status: 'signedOut', user: null, error: null })))
      .catch(() => setState({ status: 'signedOut', user: null, error: null }));
    onSessionExpired(() => {
      setState({ status: 'signedOut', user: null, error: 'Your session ended. Please sign in again.' });
      queryClient.clear();
    });
  }, [accept, queryClient]);

  const signIn = useCallback(async (email, password) => accept((await client.login({ email, password })).user), [accept]);
  const signOut = useCallback(async () => {
    await client.logout();
    queryClient.clear();
    setState({ status: 'signedOut', user: null, error: null });
  }, [queryClient]);
  /** After the one-time password is replaced, the API issues a fresh session. */
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const auth = await api.changePassword(currentPassword, newPassword);
    client.setAccessToken(auth.accessToken);
    setState((s) => ({ ...s, user: auth.user }));
  }, []);

  const can = useCallback((permission) => !!state.user && hasPermission(state.user.role, permission), [state.user]);
  const value = useMemo(() => ({ ...state, signIn, signOut, changePassword, can }), [state, signIn, signOut, changePassword, can]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
