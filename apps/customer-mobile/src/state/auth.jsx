import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onSessionExpired } from '../lib/api';
import { unregisterPush } from '../lib/live';

const AuthContext = createContext(null);

/**
 * Session state. On start it tries to restore a session from the stored refresh token. The user
 * object is only for display; the API decides what the user may do.
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: 'restoring', user: null });

  useEffect(() => {
    let cancelled = false;
    api.auth
      .restore()
      .then((auth) => !cancelled && setState({ status: auth ? 'signedIn' : 'signedOut', user: auth?.user ?? null }))
      .catch(() => !cancelled && setState({ status: 'signedOut', user: null }));
    onSessionExpired(() => {
      setState({ status: 'signedOut', user: null });
      queryClient.removeQueries({ queryKey: ['me'] });
    });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const signIn = useCallback(async (input) => {
    const auth = await api.auth.login(input);
    setState({ status: 'signedIn', user: auth.user });
    return auth.user;
  }, []);

  const signUp = useCallback(async (input) => {
    const auth = await api.auth.register({ ...input, role: 'CUSTOMER' });
    setState({ status: 'signedIn', user: auth.user });
    return auth.user;
  }, []);

  const signOut = useCallback(async () => {
    await unregisterPush();
    await api.auth.logout();
    setState({ status: 'signedOut', user: null });
    // Drop cached personal data (addresses, favourites, profile); public data can stay.
    queryClient.removeQueries({ queryKey: ['me'] });
    queryClient.invalidateQueries();
  }, [queryClient]);

  const value = useMemo(() => ({ ...state, isSignedIn: state.status === 'signedIn', signIn, signUp, signOut }), [state, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
