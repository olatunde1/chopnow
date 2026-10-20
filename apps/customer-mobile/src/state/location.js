import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { PILOT_AREA } from '../lib/config';

/**
 * The delivery location used for discovery (eligibility, distance, fees).
 * source: 'address' (a saved address), 'device' (GPS), or 'area' (pilot area fallback).
 * Persisted on the device only; never sent anywhere except as lat/lng on discovery requests.
 */
export const pilotAreaLocation = () => ({ latitude: PILOT_AREA.latitude, longitude: PILOT_AREA.longitude, label: PILOT_AREA.label, source: 'area' });

/**
 * A saved "pilot area" choice always means the CURRENT pilot area: if the pilot area moves (as it
 * did from Yaba to Sagamu), devices that had picked it follow, instead of searching the old place.
 * Saved addresses and GPS positions are the customer's own and are kept as they are.
 */
export function rehydrateLocation(persisted) {
  const location = persisted?.location ?? null;
  return { location: location?.source === 'area' ? pilotAreaLocation() : location };
}

export const useDeliveryLocation = create(
  persist(
    (set) => ({
      location: null,
      setLocation: (location) => set({ location }),
      clearLocation: () => set({ location: null }),
    }),
    {
      name: 'chopnow.deliveryLocation',
      storage: createJSONStorage(() => AsyncStorage),
      merge: (persisted, current) => ({ ...current, ...rehydrateLocation(persisted) }),
    },
  ),
);

export function describeLocation(location) {
  if (!location) return 'Choose delivery location';
  return location.label;
}
