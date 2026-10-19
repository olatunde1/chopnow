import { describe, expect, it, vi } from 'vitest';
import { ExpoPushProvider, PushTransientError } from '../src/modules/notifications/push.js';
import { signTicket, verifyTicket } from '../src/modules/realtime/ticket.js';

const SECRET = 'unit-test-secret-0123456789-abcdefghijklmnopqrstuv';
const NOW = new Date('2026-10-16T10:00:00Z');

describe('realtime tickets', () => {
  it('round-trips the user and token version within 30 seconds', () => {
    const { ticket, expiresAt } = signTicket(SECRET, { userId: 'u1', tokenVersion: 3 }, NOW);
    expect(expiresAt.toISOString()).toBe('2026-10-16T10:00:30.000Z');
    expect(verifyTicket(SECRET, ticket, new Date(NOW.getTime() + 29_000))).toEqual({ userId: 'u1', tokenVersion: 3 });
    expect(verifyTicket(SECRET, ticket, new Date(NOW.getTime() + 31_000))).toBeNull();
  });

  it('rejects tampered, foreign and malformed tickets', () => {
    const { ticket } = signTicket(SECRET, { userId: 'u1', tokenVersion: 0 }, NOW);
    const [payload, sig] = ticket.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', tv: 0, exp: 9_999_999_999 })).toString('base64url');
    expect(verifyTicket(SECRET, `${forged}.${sig}`, NOW)).toBeNull();
    expect(verifyTicket('another-secret-0123456789-abcdefghijklmnopqrstuv', ticket, NOW)).toBeNull();
    expect(verifyTicket(SECRET, `${payload}`, NOW)).toBeNull();
    expect(verifyTicket(SECRET, 'x'.repeat(600), NOW)).toBeNull();
    // The access-token secret alone doesn't sign tickets (domain-separated key).
    expect(verifyTicket(SECRET, `${payload}.${Buffer.from('nope').toString('base64url')}`, NOW)).toBeNull();
  });
});

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Expo push adapter', () => {
  it('sends batches with priority, TTL and channel, and maps tickets', async () => {
    const fetchImpl = vi.fn(async () => reply(200, { data: [{ status: 'ok', id: 't1' }, { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }, { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } }] }));
    const p = new ExpoPushProvider('expo-access-token', fetchImpl as unknown as typeof fetch);
    const res = await p.send([
      { to: 'ExponentPushToken[aaaaaaaaaaaa]', title: 'New delivery', body: 'Earn ₦400', data: { type: 'delivery.offer' }, priority: 'high', ttlSeconds: 45 },
      { to: 'ExponentPushToken[bbbbbbbbbbbb]', title: 'Hi', body: 'b', data: {}, priority: 'default' },
      { to: 'ExponentPushToken[cccccccccccc]', title: 'Hi', body: 'c', data: {}, priority: 'default' },
    ]);
    expect(res).toEqual([
      { to: 'ExponentPushToken[aaaaaaaaaaaa]', ok: true },
      { to: 'ExponentPushToken[bbbbbbbbbbbb]', ok: false, invalidToken: true, error: 'DeviceNotRegistered' },
      { to: 'ExponentPushToken[cccccccccccc]', ok: false, invalidToken: false, error: 'MessageTooBig' },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(init.headers.Authorization).toBe('Bearer expo-access-token');
    expect(JSON.parse(init.body)[0]).toMatchObject({ priority: 'high', ttl: 45, channelId: 'urgent', sound: 'default' });
    expect(JSON.parse(init.body)[1]).not.toHaveProperty('ttl');
  });

  it('splits into requests of 100 and treats outages and rate limits as retryable', async () => {
    const fetchImpl = vi.fn(async (_u: string, init: { body: string }) => reply(200, { data: JSON.parse(init.body).map(() => ({ status: 'ok' })) }));
    const p = new ExpoPushProvider(undefined, fetchImpl as unknown as typeof fetch);
    const many = Array.from({ length: 150 }, (_, i) => ({ to: `ExponentPushToken[${String(i).padStart(12, '0')}]`, title: 't', body: 'b', data: {}, priority: 'default' as const }));
    expect(await p.send(many)).toHaveLength(150);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers).not.toHaveProperty('Authorization');

    for (const status of [429, 503]) {
      const down = new ExpoPushProvider(undefined, (async () => reply(status, {})) as unknown as typeof fetch);
      await expect(down.send(many.slice(0, 1))).rejects.toBeInstanceOf(PushTransientError);
    }
    const offline = new ExpoPushProvider(undefined, (async () => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch);
    await expect(offline.send(many.slice(0, 1))).rejects.toBeInstanceOf(PushTransientError);
  });
});
