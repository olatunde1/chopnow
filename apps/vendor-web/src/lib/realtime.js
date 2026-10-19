import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createRealtimeClient } from '@chopnow/shared-utils';
import { client } from './api';

/**
 * Live "something changed" events from the API (WebSocket). Handlers refetch; polling continues
 * at a slower pace as a fallback, so nothing depends on the socket staying up.
 */
export function useRealtime(onEvent, enabled = true) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [status, setStatus] = useState('closed');
  useEffect(() => {
    if (!enabled) return undefined;
    const rt = createRealtimeClient({
      // Signed out (401) stops the client; other failures retry with backoff.
      getTicket: () => client.post('/v1/realtime/ticket').catch((e) => (e?.status === 401 ? null : Promise.reject(e))),
      onEvent: (e) => handler.current(e),
      onStatus: setStatus,
    });
    return () => rt.stop();
  }, [enabled]);
  return status;
}

export const RealtimeStatusContext = createContext('closed');
export const useRealtimeStatus = () => useContext(RealtimeStatusContext);

/** Poll quickly without a live connection, slowly with one. */
export const pollEvery = (status, fastMs, slowMs = 60_000) => (status === 'open' ? slowMs : fastMs);
