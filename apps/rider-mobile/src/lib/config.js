import { Platform } from 'react-native';

/**
 * API base URL, from EXPO_PUBLIC_API_BASE_URL (bundled at build time; public by definition).
 * Defaults suit local development: Android emulators reach the host machine via 10.0.2.2.
 */
const fallback = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || fallback).replace(/\/+$/, '');

/** Pilot neighbourhood centre (Yaba, Lagos), offered when location permission is denied. */
export const PILOT_AREA = { label: 'Yaba, Lagos (pilot area)', latitude: 6.5095, longitude: 3.3711 };
