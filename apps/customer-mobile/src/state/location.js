import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The delivery location used for discovery (eligibility, distance, fees).
 * source: 'address' (a saved address), 'device' (GPS), or 'area' (pilot area fallback).
 * Persisted on the device only; never sent anywhere except as lat/lng on discovery requests.
 */
export const useDeliveryLocation = create(
  persist(
    (set) => ({
      location: null,
      setLocation: (location) => set({ location }),
      clearLocation: () => set({ location: null }),
    }),
    { name: 'chopnow.deliveryLocation', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export function describeLocation(location) {
  if (!location) return 'Choose delivery location';
  return location.label;
}
