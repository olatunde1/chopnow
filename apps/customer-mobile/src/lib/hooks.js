import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useDeliveryLocation } from '../state/location';
import { useAuth } from '../state/auth';

export function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Query keys include the location and sign-in state so results refresh when either changes. */
export function useRestaurants(params = {}) {
  const location = useDeliveryLocation((s) => s.location);
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: ['restaurants', params, location?.latitude, location?.longitude, isSignedIn],
    queryFn: () => api.discovery.restaurants({ ...params, location }),
  });
}

export function useFoodSearch(params, enabled) {
  const location = useDeliveryLocation((s) => s.location);
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: ['food-search', params, location?.latitude, location?.longitude, isSignedIn],
    queryFn: () => api.discovery.searchFood({ ...params, location }),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useRestaurant(slug) {
  const location = useDeliveryLocation((s) => s.location);
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: ['restaurant', slug, location?.latitude, location?.longitude, isSignedIn],
    queryFn: () => api.discovery.restaurant(slug, location),
    enabled: !!slug,
  });
}

export function useCategories() {
  return useQuery({ queryKey: ['food-categories'], queryFn: api.discovery.categories, staleTime: 5 * 60_000 });
}

export function useAddresses() {
  const { isSignedIn } = useAuth();
  return useQuery({ queryKey: ['me', 'addresses'], queryFn: api.addresses.list, enabled: isSignedIn });
}

export function useFavourites() {
  const location = useDeliveryLocation((s) => s.location);
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: ['me', 'favourites', location?.latitude, location?.longitude],
    queryFn: () => api.favourites.list(location),
    enabled: isSignedIn,
  });
}

/** Human message for any error thrown by the API client or a query. */
export function errorMessage(err) {
  return err?.message || 'Something went wrong. Please try again.';
}
