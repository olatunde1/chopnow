import { expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { createApp, type AppDeps } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { Db } from '../../src/db/client.js';
import { DEFAULT_SEED_PASSWORD, SEED_EMAIL_DOMAIN, seedDevelopmentData } from '../../src/db/seed/dev-seed.js';
import { TEST_JWT_SECRET, resetDb } from './helpers.js';
import { testDatabaseUrl } from './load-env.js';

/** Uploaded files from tests go to the OS temp directory, never into the repository. */
export const TEST_STORAGE_DIR = join(tmpdir(), 'chopnow-test-storage');

/** Wednesday 2026-10-14 12:00 in Lagos (11:00Z): inside the seeded 08:00–22:00 opening hours. */
export const LAGOS_NOON = new Date('2026-10-14T11:00:00Z');
/** 03:00 Lagos the same night: every seeded restaurant is closed. */
export const LAGOS_3AM = new Date('2026-10-15T02:00:00Z');

/** Ada's seeded home address in Sagamu (Makun), ~0.6 km from Mama Nkechi's and ~1.4 km from Bukka Republic. */
export const ADA_HOME = { lat: 6.848, lng: 3.645 };
/** Abuja: far outside every delivery radius. */
export const ABUJA = { lat: 9.0765, lng: 7.3986 };

export function buildTestApp(db: Db, opts: { now?: Date; env?: Record<string, string> } = {}): Express {
  return buildTestHarness(db, opts).app;
}

/** App plus its services. Pass `clock` for tests that move time forward (dispatch timeouts). */
export function buildTestHarness(db: Db, opts: { now?: Date; clock?: () => Date; env?: Record<string, string>; deps?: Partial<AppDeps> } = {}) {
  const config = loadConfig({
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testDatabaseUrl(),
    JWT_ACCESS_SECRET: TEST_JWT_SECRET,
    RATE_LIMIT_AUTH_MAX: '10000',
    RATE_LIMIT_GLOBAL_MAX: '100000',
    RATE_LIMIT_ORDER_MAX: '10000',
    RATE_LIMIT_PAYMENT_MAX: '10000',
    RATE_LIMIT_WEBHOOK_MAX: '10000',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    STORAGE_LOCAL_DIR: TEST_STORAGE_DIR,
    ...opts.env,
  });
  const now = opts.now ?? LAGOS_NOON;
  return createApp(config, { db, now: opts.clock ?? (() => now), ...opts.deps });
}

export const seededEmail = (name: string) => `${name}${SEED_EMAIL_DOMAIN}`;

const tokenCache = new Map<string, string>();

/** Signs in a seeded account and returns an access token (cached per app run; re-seeding clears it). */
export async function tokenFor(app: Express, name: string): Promise<string> {
  const cached = tokenCache.get(name);
  if (cached) return cached;
  const res = await request(app).post('/v1/auth/login').send({ email: seededEmail(name), password: DEFAULT_SEED_PASSWORD });
  if (res.status !== 200) throw new Error(`login ${name} failed: ${res.status} ${JSON.stringify(res.body)}`);
  tokenCache.set(name, res.body.accessToken);
  return res.body.accessToken;
}

export function clearTokenCache() {
  tokenCache.clear();
}

/**
 * Empties the test database, then seeds it. Truncating first is required: the seed deliberately
 * refuses to run over a database that holds non-test accounts (which earlier test files create).
 */
export async function freshSeed(db: Db): Promise<void> {
  clearTokenCache();
  await resetDb(db);
  // The promotion window follows the tests' fixed clock, so results don't depend on the real date.
  await seedDevelopmentData(db, { appEnv: 'test', now: LAGOS_NOON });
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Asserts a delivery PIN isn't exposed: no pin field, and the 4 digits nowhere as a standalone
 * number. Timestamps are removed first, and digits inside ids, amounts or coordinates don't count,
 * so a PIN like 2026 can't collide with a date (a plain substring check flaked on exactly that).
 */
export function expectNoPin(value: unknown, pin: string) {
  const text = (typeof value === 'string' ? value : JSON.stringify(value)).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '');
  expect(text).not.toMatch(/"(deliveryPin|pin)"\s*:/i);
  expect(text).not.toMatch(new RegExp(String.raw`(?<![\w.-])${pin}(?![\w-])`));
}
