import * as Sentry from '@sentry/node';

/**
 * Error monitoring. Sentry is used only when SENTRY_DSN is set; otherwise errors are just logged.
 * No personal data is sent: request bodies, cookies, auth headers and query strings are stripped.
 */
let enabled = false;

export function initMonitoring(opts: { dsn?: string; environment: string; release?: string }) {
  if (!opts.dsn) return false;
  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    // Collect nothing about people or requests beyond the stack trace (Sentry 11 data-collection options).
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false },
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        if (event.request.headers) {
          for (const h of Object.keys(event.request.headers)) if (/authorization|cookie|signature|token/i.test(h)) delete event.request.headers[h];
        }
      }
      delete event.user;
      return event;
    },
  });
  enabled = true;
  return true;
}

/** Report an unexpected error (5xx, failed background job). Safe to call when monitoring is off. */
export function reportError(err: unknown, context: { requestId?: string; job?: string; route?: string } = {}) {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(context)) if (v) scope.setTag(k, v);
    Sentry.captureException(err);
  });
}

export async function flushMonitoring() {
  if (enabled) await Sentry.flush(2000);
}

/** Background job heartbeats for /ready: a job that stops running makes the instance unready. */
export class JobHealth {
  private readonly jobs = new Map<string, { everyMs: number; lastOk: number | null; lastError: string | null; started: number }>();

  register(name: string, everyMs: number) {
    this.jobs.set(name, { everyMs, lastOk: null, lastError: null, started: Date.now() });
  }

  ok(name: string) {
    const j = this.jobs.get(name);
    if (j) {
      j.lastOk = Date.now();
      j.lastError = null;
    }
  }

  failed(name: string, err: unknown) {
    const j = this.jobs.get(name);
    if (j) j.lastError = err instanceof Error ? err.message.slice(0, 200) : 'error';
  }

  /** A job is stalled if it hasn't succeeded for 5 intervals (with a 30 s grace after start). */
  report(now = Date.now()) {
    const out: Record<string, { lastOkSecondsAgo: number | null; stalled: boolean; lastError: string | null }> = {};
    for (const [name, j] of this.jobs) {
      const since = j.lastOk ?? j.started;
      out[name] = { lastOkSecondsAgo: j.lastOk ? Math.round((now - j.lastOk) / 1000) : null, stalled: now - since > Math.max(j.everyMs * 5, 30_000), lastError: j.lastError };
    }
    return out;
  }
}
