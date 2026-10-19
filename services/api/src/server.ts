import express from 'express';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrismaClient } from './db/client.js';
import { JobHealth, flushMonitoring, initMonitoring, reportError } from './modules/monitoring/monitoring.js';
import { attachRealtime } from './modules/realtime/server.js';

const config = loadConfig();
const monitoring = initMonitoring({ dsn: config.SENTRY_DSN, environment: config.APP_ENV, release: config.RELEASE });
const db = createPrismaClient(config.DATABASE_URL, { poolMax: config.DATABASE_POOL_MAX });
const jobHealth = new JobHealth();
const { app, logger, services } = createApp(config, { db, jobHealth });

const role = config.PROCESS_ROLE;
const servesApi = role !== 'worker';

// A worker answers only health checks; API traffic goes to web instances.
const httpApp = servesApi ? app : workerHealthApp();
const server = httpApp.listen(config.API_PORT, () => {
  logger.info({ role, port: config.API_PORT, env: config.APP_ENV, payments: services.paymentProvider.name, storage: config.STORAGE_DRIVER, push: services.pushProvider.name, monitoring }, servesApi ? 'ChopNow API listening' : 'ChopNow worker running');
});
const realtime = servesApi ? attachRealtime(server, { db, hub: services.realtime, secret: config.JWT_ACCESS_SECRET, allowedOrigins: config.CORS_ALLOWED_ORIGINS, logger }) : null;

function workerHealthApp() {
  const health = express();
  health.disable('x-powered-by');
  health.get('/health', (_req, res) => {
    res.json({ status: 'ok', role: 'worker', env: config.APP_ENV });
  });
  health.get('/ready', async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      const jobs = jobHealth.report();
      const stalled = Object.values(jobs).some((j) => j.stalled);
      res.status(stalled ? 503 : 200).json({ status: stalled ? 'degraded' : 'ready', role: 'worker', jobs });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  health.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'This is a worker process; it serves no API.' } });
  });
  return health;
}

/**
 * Periodic work. Every task is safe to run on several instances at once (state changes are
 * conditional on the current state, and claims use SKIP LOCKED), so no leader election is needed;
 * running the scheduled jobs in one worker just avoids wasted sweeps. The realtime feed runs on
 * every process with sockets. Each job records a heartbeat for /ready; failures are logged and
 * reported to monitoring.
 */
type Job = [name: string, everyMs: number, run: () => Promise<unknown>];
const scheduled: Job[] = [
  ['accept-deadline', 30_000, () => services.vendorOrders.expireOverdue()],
  // Offers expire after 45 s and riders wait on the next one.
  ['dispatch', 5_000, () => services.dispatch.tick()],
  // Provider refunds complete asynchronously; re-check processing ones (webhooks usually arrive first).
  ['refunds', 120_000, () => services.refunds.sweepProcessing()],
  // Lost webhooks / closed apps: ask the provider about unconfirmed payments; close unpaid orders.
  ['payments-reconcile', 60_000, () => services.payments.reconcile()],
  ['push', 3_000, () => services.notifications.deliverPending()],
];
const perSocketProcess: Job[] = [['realtime-feed', 1_000, () => services.changeFeed.poll()]];
const jobs: Job[] = [...(role !== 'web' ? scheduled : []), ...(servesApi ? perSocketProcess : [])];
const timers = jobs.map(([name, everyMs, run]) => {
  jobHealth.register(name, everyMs);
  let running = false;
  return setInterval(() => {
    if (running) return; // never overlap the same job on one instance
    running = true;
    run()
      .then(() => jobHealth.ok(name))
      .catch((err) => {
        jobHealth.failed(name, err);
        logger.error({ err, job: name }, 'background job failed');
        reportError(err, { job: name });
      })
      .finally(() => {
        running = false;
      });
  }, everyMs);
});

// Graceful shutdown: stop jobs and sockets, let in-flight requests finish, then close the pool.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    for (const t of timers) clearInterval(t);
    void realtime?.close();
    server.close(() => {
      void flushMonitoring()
        .then(() => db.$disconnect())
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
