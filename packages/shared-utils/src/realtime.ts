/**
 * Realtime client shared by the web portals and the mobile apps (any runtime with a WebSocket).
 * It asks the API for a short-lived ticket, connects, reports "something changed" events, and
 * reconnects with backoff (1 s → 30 s, with jitter). Events are hints: callers refetch over REST.
 */

export type RealtimeStatus = 'connecting' | 'open' | 'closed';

export interface RealtimeEventMessage {
  type: string;
  [key: string]: unknown;
}

interface MinimalSocket {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(code?: number): void;
}

export interface RealtimeClientOptions {
  /** Calls POST /v1/realtime/ticket. Return null when signed out (the client then stops). */
  getTicket: () => Promise<{ ticket: string; url: string } | null>;
  onEvent: (event: RealtimeEventMessage) => void;
  onStatus?: (status: RealtimeStatus) => void;
  /** Injected for tests; defaults to the global WebSocket. */
  createSocket?: (url: string) => MinimalSocket;
  /** Injected for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  random?: () => number;
}

export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
  return Math.round(base * (0.75 + random() * 0.5));
}

export function createRealtimeClient(opts: RealtimeClientOptions) {
  const createSocket = opts.createSocket ?? ((url: string) => new (globalThis as unknown as { WebSocket: new (u: string) => MinimalSocket }).WebSocket(url));
  // This package targets every runtime, so timers are reached through globalThis.
  const g = globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(t: unknown): void };
  const setTimer = opts.setTimer ?? ((fn, ms) => g.setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => g.clearTimeout(t));
  let socket: MinimalSocket | null = null;
  let timer: unknown = null;
  let attempt = 0;
  let stopped = false;
  let status: RealtimeStatus = 'closed';

  const setStatus = (s: RealtimeStatus) => {
    if (s !== status) {
      status = s;
      opts.onStatus?.(s);
    }
  };

  const schedule = () => {
    if (stopped) return;
    setStatus('closed');
    timer = setTimer(() => void connect(), reconnectDelay(attempt++, opts.random));
  };

  async function connect() {
    if (stopped) return;
    setStatus('connecting');
    let t: { ticket: string; url: string } | null;
    try {
      t = await opts.getTicket();
    } catch {
      return schedule();
    }
    if (!t || stopped) return setStatus('closed');
    const s = createSocket(`${t.url}?ticket=${encodeURIComponent(t.ticket)}`);
    socket = s;
    s.onopen = () => {
      attempt = 0;
      setStatus('open');
    };
    s.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as RealtimeEventMessage;
        if (msg && typeof msg.type === 'string' && msg.type !== 'hello') opts.onEvent(msg);
      } catch {
        // Ignore anything that isn't our JSON.
      }
    };
    s.onerror = () => {
      // onclose follows and schedules the reconnect.
    };
    s.onclose = () => {
      if (socket === s) socket = null;
      schedule();
    };
  }

  void connect();
  return {
    get status() {
      return status;
    },
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      socket?.close(1000);
      socket = null;
      setStatus('closed');
    },
  };
}
