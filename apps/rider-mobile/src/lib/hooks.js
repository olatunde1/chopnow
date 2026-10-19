import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { api } from './api';

export const errorMessage = (err) => err?.message || 'Something went wrong. Please try again.';

export const useProfile = (enabled = true) => useQuery({ queryKey: ['rider', 'me'], queryFn: api.rider.me, enabled, refetchInterval: 60_000 });

/**
 * The work poll: current offer and active delivery, while online or on a delivery; paused otherwise.
 * New offers also arrive at once over the realtime socket (and by push when the app is closed).
 */
export const useWork = (active, live = 'closed') =>
  // 15 s with a live connection keeps the dispatch heartbeat (90 s) fresh; 5 s without one.
  useQuery({ queryKey: ['rider', 'work'], queryFn: api.rider.work, refetchInterval: active ? (live === 'open' ? 15_000 : 5_000) : false, refetchIntervalInBackground: false, staleTime: 0 });

const LOCATION_EVERY_MS = 30_000;

/**
 * Sends the rider's position every 30 s while online, in the foreground only (background tracking
 * is out of scope for v1). Used only to rank riders for offers; never shown to customers.
 * Permission refusal is fine: the rider still gets offers, ranked after riders with a position.
 */
export function useLocationReporting(online) {
  useEffect(() => {
    if (!online) return undefined;
    let stopped = false;
    let timer;
    const report = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || stopped) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!stopped) await api.rider.location(pos.coords.latitude, pos.coords.longitude);
      } catch {
        // No fix or offline: try again next interval.
      }
    };
    report();
    timer = setInterval(report, LOCATION_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [online]);
}
