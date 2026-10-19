import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onSessionExpired } from '../lib/api';
import { unregisterPush } from '../lib/live';

const AuthContext = createContext(null);
const NOT_A_RIDER = 'This app is for ChopNow riders. Customers order in the ChopNow app.';

/**
 * Session state. Only RIDER accounts may use this app (the API enforces the same on every rider
 * endpoint; this just gives a clear message).
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: 'restoring', user: null, error: null });

  const accept = useCallback(async (user) => {
    if (user.role !== 'RIDER') {
      await api.auth.logout();
      setState({ status: 'signedOut', user: null, error: NOT_A_RIDER });
      throw new Error(NOT_A_RIDER);
    }
    setState({ status: 'signedIn', user, error: null });
    return user;
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.auth
      .restore()
      .then((a) => {
        if (cancelled) return;
        if (a?.user?.role === 'RIDER') setState({ status: 'signedIn', user: a.user, error: null });
        else setState({ status: 'signedOut', user: null, error: null });
      })
      .catch(() => !cancelled && setState({ status: 'signedOut', user: null, error: null }));
    onSessionExpired(() => {
      setState({ status: 'signedOut', user: null, error: 'Your session ended. Please sign in again.' });
      queryClient.clear();
    });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const signIn = useCallback(async (input) => accept((await api.auth.login(input)).user), [accept]);
  const signUp = useCallback(async (input) => accept((await api.auth.register(input)).user), [accept]);
  const signOut = useCallback(async () => {
    // Go offline first so no offers are sent to a signed-out phone.
    try {
      await api.rider.setOnline(false);
    } catch {
      // Not approved or offline already: nothing to withdraw.
    }
    await unregisterPush();
    await api.auth.logout();
    queryClient.clear();
    setState({ status: 'signedOut', user: null, error: null });
  }, [queryClient]);

  const value = useMemo(() => ({ ...state, isSignedIn: state.status === 'signedIn', signIn, signUp, signOut }), [state, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
