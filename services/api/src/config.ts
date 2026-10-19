import { z } from 'zod';

/**
 * Environment configuration, validated once at startup. The process refuses to boot with an
 * invalid configuration rather than failing later on first use. Later phases add payment, storage
 * and notification settings here (see .env.example).
 */
const PLACEHOLDER_SECRET = /replace|changeme|placeholder|scratch-only/i;

const EnvSchema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    /**
     * What this process runs. `all` (default): API, sockets and every background job, for a single
     * instance. `web`: API, sockets and the realtime feed (it must run where the sockets are); scale
     * these horizontally. `worker`: the scheduled jobs only (dispatch, deadlines, refunds, push),
     * with /health and /ready; run exactly one in production.
     */
    PROCESS_ROLE: z.enum(['all', 'web', 'worker']).default('all'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    /** PostgreSQL connections per API process. Keep instances × this under the database's limit. */
    DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(200).default(10),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Comma-separated browser origins allowed to call the API (web portals). Mobile apps send no Origin. */
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
    /** Number of reverse proxies in front of the API (0 locally, usually 1 behind a load balancer). */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    /** Sign-in / registration attempts per IP per 15 minutes. */
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(20),
    /** Order placements per customer per 10 minutes. */
    RATE_LIMIT_ORDER_MAX: z.coerce.number().int().min(1).default(10),
    /** Payment starts and checks per customer per 10 minutes. */
    RATE_LIMIT_PAYMENT_MAX: z.coerce.number().int().min(1).default(30),
    /** Payment-provider webhook calls per IP per minute (each is signature-checked before any work). */
    RATE_LIMIT_WEBHOOK_MAX: z.coerce.number().int().min(1).default(300),
    /** All requests per IP per minute. */
    RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(1).default(600),
    /** Serve /v1/openapi.json. Defaults to on except in production. */
    API_DOCS_ENABLED: z.enum(['true', 'false']).optional(),
    /** Public base URL of this API (used for payment callback and mock checkout links). */
    PUBLIC_API_URL: z.url().default('http://localhost:4000'),
    /** `mock` is a development/test stand-in that never moves money; refused in staging/production. */
    PAYMENT_PROVIDER: z.enum(['mock', 'paystack']).default('mock'),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_BASE_URL: z.url().default('https://api.paystack.co'),
    /** `local` writes to disk (development only); `s3` uses any S3-compatible object store. */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    /** Public base URL for uploaded images. Defaults to `${PUBLIC_API_URL}/media` for the local driver. */
    MEDIA_PUBLIC_BASE_URL: z.url().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET_PUBLIC: z.string().optional(),
    S3_BUCKET_PRIVATE: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    /** `log` only logs pushes (development); `expo` sends them through the Expo push service. */
    PUSH_PROVIDER: z.enum(['log', 'expo']).default('log'),
    /** Optional Expo access token (required if "enhanced push security" is on for the Expo project). */
    EXPO_ACCESS_TOKEN: z.string().optional(),
    /** Error monitoring; empty = off. */
    SENTRY_DSN: z.url().optional().or(z.literal('').transform(() => undefined)),
    /** Build identifier shown in error reports, e.g. a git SHA. */
    RELEASE: z.string().max(80).optional(),
  })
  .superRefine((env, ctx) => {
    const deployed = env.APP_ENV === 'staging' || env.APP_ENV === 'production';
    if (deployed && PLACEHOLDER_SECRET.test(env.JWT_ACCESS_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'placeholder secret in a deployed environment' });
    }
    if (deployed && !env.PUBLIC_API_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_API_URL'], message: 'must be an https:// URL in a deployed environment' });
    }
    if (deployed) {
      const bad = env.CORS_ALLOWED_ORIGINS.filter((o) => !/^https:\/\/[^/]+$/.test(o) || /localhost|127\.0\.0\.1/.test(o));
      if (bad.length) ctx.addIssue({ code: 'custom', path: ['CORS_ALLOWED_ORIGINS'], message: `deployed origins must be https://host with no path and not localhost (${bad.length} invalid)` });
    }
    if (env.APP_ENV === 'production' && env.PUSH_PROVIDER !== 'expo') {
      ctx.addIssue({ code: 'custom', path: ['PUSH_PROVIDER'], message: 'production must send pushes (expo); log would silently drop them' });
    }
    if (env.APP_ENV === 'production' && (env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace')) {
      ctx.addIssue({ code: 'custom', path: ['LOG_LEVEL'], message: 'debug/trace logging is not allowed in production (may record personal data)' });
    }
    if (deployed && env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'the mock payment provider is not allowed in a deployed environment' });
    }
    if (env.APP_ENV === 'production' && env.STORAGE_DRIVER === 'local') {
      ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'local disk storage is not allowed in production; use s3' });
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const k of ['S3_BUCKET_PUBLIC', 'S3_BUCKET_PRIVATE', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'MEDIA_PUBLIC_BASE_URL'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'required when STORAGE_DRIVER=s3' });
      }
    }
    if (env.PAYMENT_PROVIDER === 'paystack') {
      const key = env.PAYSTACK_SECRET_KEY ?? '';
      if (!/^sk_(test|live)_\w{10,}$/.test(key)) {
        ctx.addIssue({ code: 'custom', path: ['PAYSTACK_SECRET_KEY'], message: 'must be a Paystack secret key (sk_test_… or sk_live_…)' });
      } else if (key.startsWith('sk_test_') && env.APP_ENV === 'production') {
        // Test keys take no real money while orders look real; that must never happen in production.
        ctx.addIssue({ code: 'custom', path: ['PAYSTACK_SECRET_KEY'], message: 'production needs a live key (sk_live_…)' });
      } else if (key.startsWith('sk_live_') && env.APP_ENV !== 'production') {
        ctx.addIssue({ code: 'custom', path: ['PAYSTACK_SECRET_KEY'], message: 'live keys are only allowed when APP_ENV=production' });
      }
    }
  });

export type AppConfig = Omit<z.infer<typeof EnvSchema>, 'API_DOCS_ENABLED' | 'MEDIA_PUBLIC_BASE_URL'> & {
  API_DOCS_ENABLED: boolean;
  MEDIA_PUBLIC_BASE_URL: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names and rules only, never values.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    API_DOCS_ENABLED: c.API_DOCS_ENABLED ? c.API_DOCS_ENABLED === 'true' : c.APP_ENV !== 'production',
    MEDIA_PUBLIC_BASE_URL: (c.MEDIA_PUBLIC_BASE_URL ?? `${c.PUBLIC_API_URL}/media`).replace(/\/+$/, ''),
  };
}
