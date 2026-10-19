import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, client, onSessionExpired } from '../lib/api';

const SessionContext = createContext(null);
const RESTAURANT_KEY = 'chopnow.vendor.restaurantId';

function readSavedRestaurant() {
  try {
    return localStorage.getItem(RESTAURANT_KEY);
  } catch {
    return null;
  }
}

/**
 * Who is signed in, and which of their restaurants is being managed. Only VENDOR accounts may use
 * the portal (the API enforces the same; this just gives a clear message).
 */
export function SessionProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: 'restoring', user: null, error: null });
  const [restaurantId, setRestaurantIdState] = useState(readSavedRestaurant);

  const accept = useCallback((user) => {
    if (user.role !== 'VENDOR') {
      void client.logout();
      setState({ status: 'signedOut', user: null, error: 'This portal is for restaurant accounts. Customers order in the ChopNow app.' });
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

  const restaurants = useQuery({
    queryKey: ['restaurants'],
    queryFn: api.restaurants.list,
    enabled: state.status === 'signedIn',
  });

  const items = useMemo(() => restaurants.data?.items ?? [], [restaurants.data]);
  const current = items.find((r) => r.id === restaurantId) ?? items[0] ?? null;

  const setRestaurantId = useCallback((id) => {
    setRestaurantIdState(id);
    try {
      localStorage.setItem(RESTAURANT_KEY, id);
    } catch {
      // Private mode: the choice simply isn't remembered.
    }
  }, []);

  const signIn = useCallback(async (email, password) => accept((await client.login({ email, password })).user), [accept]);
  const register = useCallback(async (input) => accept((await client.register({ ...input, role: 'VENDOR' })).user), [accept]);
  const signOut = useCallback(async () => {
    await client.logout();
    queryClient.clear();
    setState({ status: 'signedOut', user: null, error: null });
  }, [queryClient]);

  const value = useMemo(
    () => ({ ...state, restaurants: items, restaurantsQuery: restaurants, restaurant: current, setRestaurantId, signIn, register, signOut }),
    [state, items, restaurants, current, setRestaurantId, signIn, register, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
