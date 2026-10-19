import { createHmac, randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { CURRENCY } from '@chopnow/shared-utils';
import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import { authenticate, errorHandler, limiter } from './http/middleware.js';
import { buildOpenApi, mountRoutes, type RouteSpec } from './http/route.js';
import { accountRoutes } from './modules/account/account.routes.js';
import { AccountService } from './modules/account/account.service.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { ApprovalsService } from './modules/admin/approvals.service.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { TokenService } from './modules/auth/tokens.js';
import { vendorRoutes } from './modules/catalog/vendor.routes.js';
import { VendorCatalogService } from './modules/catalog/vendor-catalog.service.js';
import { discoveryRoutes } from './modules/discovery/discovery.routes.js';
import { DiscoveryService } from './modules/discovery/discovery.service.js';
import { orderRoutes } from './modules/orders/orders.routes.js';
import { OrdersService } from './modules/orders/orders.service.js';
import { MockPaymentProvider } from './modules/payments/mock.js';
import { paymentPages } from './modules/payments/payment-pages.js';
import { PaymentsService } from './modules/payments/payments.service.js';
import { PaystackProvider } from './modules/payments/paystack.js';
import type { PaymentProvider } from './modules/payments/provider.js';
import { ReviewsService } from './modules/reviews/reviews.service.js';
import { LocalStorageDriver, S3StorageDriver, type StorageDriver } from './modules/storage/storage.js';
import { vendorOrderRoutes } from './modules/vendor-orders/vendor-orders.routes.js';
import { VendorOrdersService } from './modules/vendor-orders/vendor-orders.service.js';
import { DispatchService } from './modules/dispatch/dispatch.service.js';
import { CashService } from './modules/finance/cash.service.js';
import { financeRoutes } from './modules/finance/finance.routes.js';
import type { JobHealth } from './modules/monitoring/monitoring.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { notificationRoutes } from './modules/notifications/notifications.routes.js';
import { ExpoPushProvider, LogPushProvider, type PushProvider } from './modules/notifications/push.js';
import { OpsAdminService } from './modules/ops/ops-admin.service.js';
import { ChangeFeed } from './modules/realtime/feed.js';
import { RealtimeHub } from './modules/realtime/hub.js';
import { OpsOrdersService } from './modules/ops/ops-orders.service.js';
import { opsRoutes } from './modules/ops/ops.routes.js';
import { RefundsService } from './modules/finance/refunds.service.js';
import { FinanceReportsService } from './modules/finance/reports.service.js';
import { SettlementsService } from './modules/finance/settlements.service.js';
import { riderRoutes } from './modules/rider/rider.routes.js';
import { RiderService } from './modules/rider/rider.service.js';

function createStorage(config: AppConfig): StorageDriver {
  if (config.STORAGE_DRIVER === 's3') {
    return new S3StorageDriver(
      {
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        accessKeyId: config.S3_ACCESS_KEY_ID!,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
        publicBucket: config.S3_BUCKET_PUBLIC!,
        privateBucket: config.S3_BUCKET_PRIVATE!,
      },
      config.MEDIA_PUBLIC_BASE_URL,
    );
  }
  // Private-file URL signing key derived from the JWT secret (separate purpose label).
  const signingKey = createHmac('sha256', config.JWT_ACCESS_SECRET).update('chopnow:private-media').digest('hex');
  return new LocalStorageDriver(config.STORAGE_LOCAL_DIR, config.MEDIA_PUBLIC_BASE_URL, `${config.PUBLIC_API_URL}/media-private`, signingKey);
}

export interface AppDeps {
  db: Db;
  /** Injected clock so opening-hours logic is testable. */
  now?: () => Date;
  logger?: Logger;
  /** Override the configured payment provider (tests). */
  paymentProvider?: PaymentProvider;
  /** Override the configured storage driver (tests). */
  storage?: StorageDriver;
  /** Override the configured push provider (tests). */
  pushProvider?: PushProvider;
  /** Background job heartbeats reported by /ready (the server registers its jobs). */
  jobHealth?: JobHealth;
}

function createPaymentProvider(config: AppConfig): PaymentProvider {
  if (config.PAYMENT_PROVIDER === 'paystack') return new PaystackProvider(config.PAYSTACK_SECRET_KEY!, config.PAYSTACK_BASE_URL);
  return new MockPaymentProvider(config.PUBLIC_API_URL);
}

export function createServices(config: AppConfig, deps: AppDeps & { logger?: Logger }) {
  const now = deps.now ?? (() => new Date());
  const tokens = new TokenService(config.JWT_ACCESS_SECRET, config.JWT_ACCESS_TTL_SECONDS);
  const paymentProvider = deps.paymentProvider ?? createPaymentProvider(config);
  const dispatch = new DispatchService(deps.db, now, deps.logger);
  const refunds = new RefundsService(deps.db, paymentProvider, now, deps.logger);
  const storage = deps.storage ?? createStorage(config);
  const pushProvider = deps.pushProvider ?? (config.PUSH_PROVIDER === 'expo' ? new ExpoPushProvider(config.EXPO_ACCESS_TOKEN) : new LogPushProvider(deps.logger));
  const realtime = new RealtimeHub();
  return {
    auth: new AuthService(deps.db, tokens, {
      refreshTokenTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
      accessTokenTtlSeconds: config.JWT_ACCESS_TTL_SECONDS,
    }),
    account: new AccountService(deps.db),
    vendorCatalog: new VendorCatalogService(deps.db, now, config.MEDIA_PUBLIC_BASE_URL),
    discovery: new DiscoveryService(deps.db, now),
    approvals: new ApprovalsService(deps.db),
    orders: new OrdersService(deps.db, now),
    payments: new PaymentsService(deps.db, paymentProvider, { publicApiUrl: config.PUBLIC_API_URL, logger: deps.logger, now, onRefundEvent: (id) => refunds.refreshByProviderId(id) }),
    vendorOrders: new VendorOrdersService(deps.db, now, deps.logger, dispatch),
    dispatch,
    riders: new RiderService(deps.db, dispatch, now),
    reviews: new ReviewsService(deps.db, now),
    refunds,
    cash: new CashService(deps.db, now),
    settlements: new SettlementsService(deps.db, now),
    financeReports: new FinanceReportsService(deps.db),
    storage,
    opsOrders: new OpsOrdersService(deps.db, dispatch, now),
    opsAdmin: new OpsAdminService(deps.db, storage, now),
    notifications: new NotificationsService(deps.db, pushProvider, now, deps.logger),
    pushProvider,
    realtime,
    changeFeed: new ChangeFeed(deps.db, realtime, now, deps.logger),
    paymentProvider,
  };
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export function createApp(config: AppConfig, deps: AppDeps) {
  const logger =
    deps.logger ??
    pino({
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-paystack-signature"]'],
    });
  const services = createServices(config, { ...deps, logger });

  const authLimiter = limiter({ name: 'auth', windowMs: 15 * 60_000, limit: config.RATE_LIMIT_AUTH_MAX });
  const uploadLimiter = limiter({ name: 'upload', windowMs: 15 * 60_000, limit: 60 });
  const orderLimits = {
    quote: limiter({ name: 'quote', windowMs: 10 * 60_000, limit: 12 * config.RATE_LIMIT_ORDER_MAX, per: 'user' }),
    place: limiter({ name: 'order', windowMs: 10 * 60_000, limit: config.RATE_LIMIT_ORDER_MAX, per: 'user' }),
    payment: limiter({ name: 'payment', windowMs: 10 * 60_000, limit: config.RATE_LIMIT_PAYMENT_MAX, per: 'user' }),
    webhook: limiter({ name: 'webhook', windowMs: 60_000, limit: config.RATE_LIMIT_WEBHOOK_MAX }),
  };
  const ticketLimiter = limiter({ name: 'realtime-ticket', windowMs: 60_000, limit: 30, per: 'user' });
  const routes: RouteSpec[] = [
    ...authRoutes(services.auth, authLimiter, {
      secureCookies: config.APP_ENV !== 'development' && config.APP_ENV !== 'test',
      refreshTokenTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
    }),
    ...accountRoutes(services.account),
    ...discoveryRoutes(services.discovery),
    ...vendorRoutes(services.vendorCatalog),
    ...adminRoutes(services.approvals),
    ...orderRoutes(services.orders, services.payments, services.reviews, orderLimits),
    ...notificationRoutes({ notifications: services.notifications, ticketLimiter, db: deps.db, ticketSecret: config.JWT_ACCESS_SECRET, publicApiUrl: config.PUBLIC_API_URL, now: deps.now ?? (() => new Date()) }),
    ...opsRoutes({ orders: services.opsOrders, admin: services.opsAdmin, payments: services.payments }),
    ...financeRoutes({ refunds: services.refunds, cash: services.cash, settlements: services.settlements, reports: services.financeReports }),
    ...riderRoutes({ riders: services.riders, storage: services.storage, uploadLimiter }),
    ...vendorOrderRoutes({ orders: services.vendorOrders, reviews: services.reviews, storage: services.storage, db: deps.db, uploadLimiter }),
  ];

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
    }),
  );
  app.use(
    cors({
      // Browsers from the listed portals only. Mobile apps send no Origin header and are unaffected.
      origin: (origin, cb) => cb(null, !origin || config.CORS_ALLOWED_ORIGINS.includes(origin)),
      // Credentials are needed for the web portals' httpOnly refresh cookie (listed origins only).
      credentials: true,
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id', 'X-ChopNow-Client'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Idempotent-Replayed'],
      maxAge: 600,
    }),
  );
  app.use(limiter({ name: 'global', windowMs: 60_000, limit: config.RATE_LIMIT_GLOBAL_MAX }));
  app.use(cookieParser());
  // Keep the exact bytes: webhook signatures are computed over the raw body, not re-serialised JSON.
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );

  // Liveness: the process is up. Readiness: it can reach the database.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', env: config.APP_ENV, currency: CURRENCY });
  });
  app.get('/ready', async (_req, res) => {
    try {
      await deps.db.$queryRaw`SELECT 1`;
      const jobs = deps.jobHealth?.report() ?? {};
      const stalled = Object.entries(jobs).filter(([, j]) => j.stalled).map(([n]) => n);
      res.status(stalled.length ? 503 : 200).json({ status: stalled.length ? 'degraded' : 'ready', jobs, realtimeConnections: services.realtime.size });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  if (config.API_DOCS_ENABLED) {
    const doc = buildOpenApi(routes, { version: '0.3.0' });
    app.get('/v1/openapi.json', (_req, res) => {
      res.json(doc);
    });
  }

  // Local-disk storage (development): public images, and private files only via signed URLs.
  if (services.storage instanceof LocalStorageDriver) {
    const local = services.storage;
    app.use(
      '/media',
      express.static(local.publicDir, {
        index: false,
        dotfiles: 'deny',
        immutable: true,
        maxAge: '365d',
        // Images are embedded by the apps and portals on other origins.
        setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
      }),
    );
    app.get('/media-private/*key', async (req, res) => {
      const key = ([] as string[]).concat((req.params as { key: string | string[] }).key).join('/');
      let file: Buffer | null = null;
      try {
        file = await local.readPrivate(key, Number(req.query.exp), String(req.query.sig ?? ''));
      } catch {
        file = null;
      }
      if (!file) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found or link expired' } });
        return;
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', 'attachment');
      res.type(key.split('.').pop() ?? 'application/octet-stream').send(file);
    });
  }

  // Browser pages for the payment provider redirect (and the dev-only mock checkout).
  const mock = services.paymentProvider instanceof MockPaymentProvider && config.APP_ENV !== 'production' ? services.paymentProvider : null;
  app.use(paymentPages(services.payments, deps.db, mock));

  const api = Router();
  api.use(authenticate(services.auth));
  mountRoutes(api, routes);
  app.use(api);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
  app.use(errorHandler);

  return { app, logger, services, routes };
}
