import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { createRealtimeClient } from '@chopnow/shared-utils';
import { client } from './api';

// ───────── Realtime ─────────

/** Live "something changed" events; screens refetch. Polling continues more slowly as a fallback. */
export function useRealtime(onEvent, enabled) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [status, setStatus] = useState('closed');
  useEffect(() => {
    if (!enabled) return undefined;
    const rt = createRealtimeClient({
      getTicket: () => client.post('/v1/realtime/ticket', undefined, { auth: 'required' }).catch((e) => (e?.status === 401 ? null : Promise.reject(e))),
      onEvent: (e) => handler.current(e),
      onStatus: setStatus,
    });
    return () => rt.stop();
  }, [enabled]);
  return status;
}

export const LiveStatusContext = createContext('closed');
export const useLiveStatus = () => useContext(LiveStatusContext);
export const pollEvery = (status, fastMs, slowMs) => (status === 'open' ? slowMs : fastMs);

// ───────── Push notifications ─────────

/** The token registered for the signed-in account on this device (removed on sign-out). */
let registeredToken = null;

Notifications.setNotificationHandler({
  // Shown even while the app is open: a new offer must not be missed.
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Registers this device for push. Needs a physical device and an EAS project id (set when the app
 * is built with EAS, Phase 12). Expo Go on Android can't receive remote push (SDK 53+), so failure
 * is expected there and harmless: the app still updates live while open.
 */
export async function registerForPush() {
  if (Platform.OS === 'web' || !Device.isDevice) return { status: 'unsupported' };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { status: 'no-project-id' };
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Updates', importance: Notifications.AndroidImportance.DEFAULT });
      await Notifications.setNotificationChannelAsync('urgent', { name: 'Delivery offers', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250], sound: 'default' });
    }
    const existing = await Notifications.getPermissionsAsync();
    const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return { status: 'denied' };
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await client.put('/v1/me/push-tokens', { token, platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID' }, { auth: 'required' });
    registeredToken = token;
    return { status: 'registered' };
  } catch {
    return { status: 'unavailable' };
  }
}

/** On sign-out: stop pushes to this device for this account. */
export async function unregisterPush() {
  const token = registeredToken;
  if (!token) return;
  registeredToken = null;
  await client.post('/v1/me/push-tokens/remove', { token }, { auth: 'required' }).catch(() => {});
}

/** Calls `onOpen(data)` when the user taps a notification. */
export function useNotificationTaps(onOpen) {
  const handler = useRef(onOpen);
  handler.current = onOpen;
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => handler.current(r.notification.request.content.data ?? {}));
    return () => sub.remove();
  }, []);
}

export const notificationsApi = {
  list: () => client.get('/v1/me/notifications', { auth: 'required', query: { pageSize: 30 } }),
  read: (body) => client.post('/v1/me/notifications/read', body, { auth: 'required' }),
};
