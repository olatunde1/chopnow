import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPrismaClient } from '../src/db/client.js';

const baseEnv = {
  APP_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/chopnow_test',
  JWT_ACCESS_SECRET: 'unit-test-secret-0123456789-abcdefghijklmnop',
};
// The Prisma client connects lazily, so these tests run without a database.
const { app } = createApp(loadConfig(baseEnv), { db: createPrismaClient(baseEnv.DATABASE_URL) });

describe('API skeleton', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', env: 'test', currency: 'NGN' });
  });

  it('unknown routes return a JSON 404 without internals', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects invalid configuration at startup', () => {
    expect(() => loadConfig({ ...baseEnv, API_PORT: 'abc' })).toThrow(/Invalid environment configuration/);
    expect(() => loadConfig({ ...baseEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses placeholder secrets in deployed environments, without echoing the value', () => {
    const env = { ...baseEnv, APP_ENV: 'production', JWT_ACCESS_SECRET: 'replace-with-64-random-bytes-xxxxxxxxxxxxxxxx' };
    expect(() => loadConfig(env)).toThrow(/placeholder secret/);
    try {
      loadConfig(env);
    } catch (e) {
      expect(String(e)).not.toContain(env.JWT_ACCESS_SECRET);
    }
  });
});

describe('deployed configuration', () => {
  // Shape of a real production env; every value here is a made-up test value.
  const prod = {
    ...baseEnv,
    APP_ENV: 'production',
    LOG_LEVEL: 'info',
    JWT_ACCESS_SECRET: 'q7Zt2Wk9-unit-test-only-Lm4Rv8Xp3Ns6Hb1Jc5Fd0Gy',
    PUBLIC_API_URL: 'https://api.chopnow.example',
    CORS_ALLOWED_ORIGINS: 'https://vendor.chopnow.example,https://admin.chopnow.example',
    PAYMENT_PROVIDER: 'paystack',
    PAYSTACK_SECRET_KEY: 'sk_live_unittestonly0000',
    STORAGE_DRIVER: 's3',
    S3_BUCKET_PUBLIC: 'pub',
    S3_BUCKET_PRIVATE: 'priv',
    S3_ACCESS_KEY_ID: 'id',
    S3_SECRET_ACCESS_KEY: 'secret',
    MEDIA_PUBLIC_BASE_URL: 'https://media.chopnow.example',
    PUSH_PROVIDER: 'expo',
  };

  it('accepts a complete production configuration and defaults to running everything in one process', () => {
    const c = loadConfig(prod);
    expect(c.APP_ENV).toBe('production');
    expect(c.PROCESS_ROLE).toBe('all');
    expect(loadConfig({ ...prod, PROCESS_ROLE: 'worker' }).PROCESS_ROLE).toBe('worker');
    expect(() => loadConfig({ ...prod, PROCESS_ROLE: 'cron' })).toThrow(/PROCESS_ROLE/);
  });

  it('requires https for the public API URL and the browser origins', () => {
    expect(() => loadConfig({ ...prod, PUBLIC_API_URL: 'http://api.chopnow.example' })).toThrow(/PUBLIC_API_URL/);
    expect(() => loadConfig({ ...prod, CORS_ALLOWED_ORIGINS: 'http://vendor.chopnow.example' })).toThrow(/CORS_ALLOWED_ORIGINS/);
    expect(() => loadConfig({ ...prod, CORS_ALLOWED_ORIGINS: 'https://localhost:5173' })).toThrow(/CORS_ALLOWED_ORIGINS/);
    expect(() => loadConfig({ ...prod, CORS_ALLOWED_ORIGINS: 'https://vendor.chopnow.example/app' })).toThrow(/CORS_ALLOWED_ORIGINS/);
    // Staging gets the same rules.
    expect(() => loadConfig({ ...prod, APP_ENV: 'staging', PAYSTACK_SECRET_KEY: 'sk_test_unittestonly0000', PUBLIC_API_URL: 'http://staging.example' })).toThrow(/PUBLIC_API_URL/);
  });

  it('refuses Paystack test keys in production (no real money would move)', () => {
    expect(() => loadConfig({ ...prod, PAYSTACK_SECRET_KEY: 'sk_test_unittestonly0000' })).toThrow(/live key/);
  });

  it('refuses log-only push and debug logging in production', () => {
    expect(() => loadConfig({ ...prod, PUSH_PROVIDER: 'log' })).toThrow(/PUSH_PROVIDER/);
    expect(() => loadConfig({ ...prod, LOG_LEVEL: 'debug' })).toThrow(/LOG_LEVEL/);
  });

  it('allows a staging environment with Paystack test keys and log-only push', () => {
    const c = loadConfig({ ...prod, APP_ENV: 'staging', PAYSTACK_SECRET_KEY: 'sk_test_unittestonly0000', PUSH_PROVIDER: 'log', LOG_LEVEL: 'debug' });
    expect(c.APP_ENV).toBe('staging');
  });
});
