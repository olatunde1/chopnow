import type { Logger } from 'pino';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  priority: 'default' | 'high';
  ttlSeconds?: number;
}

export interface PushResult {
  to: string;
  ok: boolean;
  /** The token is dead (app uninstalled, signed out): stop sending to it. */
  invalidToken?: boolean;
  error?: string;
}

/** Push delivery adapter (Expo in deployed environments; a logger in development; memory in tests). */
export interface PushProvider {
  readonly name: 'expo' | 'log' | 'memory';
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

export const EXPO_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$/;

export class PushTransientError extends Error {}

/**
 * Expo Push API (https://docs.expo.dev/push-notifications/sending-notifications/). Up to 100
 * messages per request. Per-message errors come back as tickets; DeviceNotRegistered means the
 * token is dead. Receipts (delivery to Apple/Google) are not polled in v1.
 */
export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo' as const;
  constructor(
    private readonly accessToken: string | undefined,
    private readonly fetchImpl: typeof fetch = (u, i) => globalThis.fetch(u, i),
    private readonly url = 'https://exp.host/--/api/v2/push/send',
  ) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const out: PushResult[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      let res: Response;
      try {
        res = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}) },
          body: JSON.stringify(batch.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, priority: m.priority, sound: 'default', channelId: m.priority === 'high' ? 'urgent' : 'default', ...(m.ttlSeconds ? { ttl: m.ttlSeconds } : {}) }))),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new PushTransientError('Could not reach Expo push service');
      }
      if (res.status >= 500 || res.status === 429) throw new PushTransientError(`Expo push service returned ${res.status}`);
      const json = (await res.json().catch(() => null)) as { data?: { status: string; message?: string; details?: { error?: string } }[]; errors?: { message: string }[] } | null;
      if (!res.ok || !Array.isArray(json?.data)) throw new PushTransientError(`Expo push rejected the request (${res.status}): ${json?.errors?.[0]?.message ?? 'no details'}`);
      json.data.forEach((t, k) => {
        const to = batch[k]!.to;
        if (t.status === 'ok') out.push({ to, ok: true });
        else out.push({ to, ok: false, invalidToken: t.details?.error === 'DeviceNotRegistered', error: t.details?.error ?? t.message ?? 'error' });
      });
    }
    return out;
  }
}

/** Development: logs what would be sent (no network). */
export class LogPushProvider implements PushProvider {
  readonly name = 'log' as const;
  constructor(private readonly logger?: Logger) {}
  async send(messages: PushMessage[]) {
    for (const m of messages) this.logger?.info({ to: `${m.to.slice(0, 22)}…`, title: m.title, priority: m.priority }, 'push (log only)');
    return messages.map((m) => ({ to: m.to, ok: true }));
  }
}

/** Tests: records messages; tokens listed in `dead` are reported as unregistered. */
export class MemoryPushProvider implements PushProvider {
  readonly name = 'memory' as const;
  readonly sent: PushMessage[] = [];
  dead = new Set<string>();
  failNext = false;
  async send(messages: PushMessage[]) {
    if (this.failNext) {
      this.failNext = false;
      throw new PushTransientError('simulated outage');
    }
    this.sent.push(...messages);
    return messages.map((m) => (this.dead.has(m.to) ? { to: m.to, ok: false, invalidToken: true, error: 'DeviceNotRegistered' } : { to: m.to, ok: true }));
  }
}
