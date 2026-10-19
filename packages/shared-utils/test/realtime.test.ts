import { describe, expect, it, vi } from 'vitest';
import { createRealtimeClient, reconnectDelay } from '../src/realtime.js';

class FakeSocket {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close() {
    this.closed = true;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('realtime client', () => {
  it('backs off from 1 s to 30 s with jitter', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((a) => reconnectDelay(a, () => 0.5))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(reconnectDelay(0, () => 0)).toBe(750);
    expect(reconnectDelay(0, () => 1)).toBe(1250);
  });

  it('connects with a fresh ticket, passes events (not hello), and reconnects after a drop', async () => {
    const sockets: FakeSocket[] = [];
    const timers: (() => void)[] = [];
    const events: unknown[] = [];
    const statuses: string[] = [];
    let n = 0;
    const getTicket = vi.fn(async () => ({ ticket: `t${++n}`, url: 'ws://api/v1/realtime' }));
    const c = createRealtimeClient({
      getTicket,
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
      createSocket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => {},
      random: () => 0.5,
    });
    await flush();
    expect(sockets[0]!.url).toBe('ws://api/v1/realtime?ticket=t1');
    sockets[0]!.onopen?.({});
    sockets[0]!.onmessage?.({ data: JSON.stringify({ type: 'hello' }) });
    sockets[0]!.onmessage?.({ data: JSON.stringify({ type: 'order.updated', orderId: 'o1' }) });
    sockets[0]!.onmessage?.({ data: 'not json' });
    expect(events).toEqual([{ type: 'order.updated', orderId: 'o1' }]);
    expect(c.status).toBe('open');

    sockets[0]!.onclose?.({ code: 1006 });
    expect(c.status).toBe('closed');
    expect(timers).toHaveLength(1);
    timers[0]!();
    await flush();
    expect(sockets[1]!.url).toBe('ws://api/v1/realtime?ticket=t2');
    expect(statuses).toEqual(['connecting', 'open', 'closed', 'connecting']);

    c.stop();
    expect(sockets[1]!.closed).toBe(true);
    sockets[1]!.onclose?.({ code: 1000 });
    expect(timers).toHaveLength(1); // no reconnect after stop
  });

  it('stays closed when signed out, and retries when the ticket request fails', async () => {
    const timers: (() => void)[] = [];
    const signedOut = createRealtimeClient({ getTicket: async () => null, onEvent: () => {}, createSocket: () => { throw new Error('should not connect'); }, setTimer: (fn) => timers.push(fn) });
    await flush();
    expect(signedOut.status).toBe('closed');
    expect(timers).toHaveLength(0);

    const failing = createRealtimeClient({ getTicket: async () => Promise.reject(new Error('offline')), onEvent: () => {}, setTimer: (fn) => timers.push(fn) });
    await flush();
    expect(timers).toHaveLength(1);
    failing.stop();
  });
});
