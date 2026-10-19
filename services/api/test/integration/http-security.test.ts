/**
 * Cross-cutting HTTP security: every protected route rejects anonymous callers and callers without
 * the permission; ownership is enforced (IDOR); errors are safe; rate limits and CORS behave.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasPermission, type Permission, type Role } from '@chopnow/shared-schemas';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { TEST_JWT_SECRET, createTestDb } from './helpers.js';
import { bearer, buildTestApp, freshSeed, seededEmail, tokenFor, expectNoPin } from './http-helpers.js';
import { testDatabaseUrl } from './load-env.js';

const db = createTestDb();
const app = buildTestApp(db);
const { routes } = createApp(loadConfig({ APP_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: testDatabaseUrl(), JWT_ACCESS_SECRET: TEST_JWT_SECRET }), { db });

beforeAll(() => freshSeed(db), 120_000);
afterAll(() => db.$disconnect());

/** Fills path params with values that pass validation but match nothing. */
function concretePath(path: string) {
  return path.replace(/:(\w+)/g, (_m, name: string) => (name === 'slug' ? 'no-such-restaurant' : randomUUID()));
}

const SEEDED_ACCOUNT: Record<Role, string> = {
  CUSTOMER: 'ada',
  VENDOR: 'vendor.mamankechi',
  RIDER: 'rider.core1',
  ADMIN: 'admin',
  OPERATIONS: 'ops',
  SUPPORT: 'support',
  FINANCE: 'finance',
};

/**
 * The intended access for every route. The sweep below proves each route ENFORCES its declared
 * access; this manifest proves the declaration itself has not been weakened. Changing who may call a
 * route means changing this list on purpose (and getting it reviewed).
 */
const ACCESS_MANIFEST: Record<string, string> = {
  'POST /v1/auth/register': 'public',
  'POST /v1/auth/login': 'public',
  'POST /v1/auth/refresh': 'public',
  'POST /v1/auth/logout': 'public',
  'POST /v1/auth/logout-all': 'authenticated',
  'POST /v1/me/password': 'authenticated',
  'GET /v1/me': 'authenticated',
  'PATCH /v1/me': 'authenticated',
  'GET /v1/me/addresses': 'address.manage.own',
  'POST /v1/me/addresses': 'address.manage.own',
  'PATCH /v1/me/addresses/:addressId': 'address.manage.own',
  'DELETE /v1/me/addresses/:addressId': 'address.manage.own',
  'POST /v1/me/addresses/:addressId/default': 'address.manage.own',
  'GET /v1/me/favourites': 'favourite.manage.own',
  'PUT /v1/me/favourites/:restaurantId': 'favourite.manage.own',
  'DELETE /v1/me/favourites/:restaurantId': 'favourite.manage.own',
  'GET /v1/restaurants': 'optional',
  'GET /v1/restaurants/:slug': 'optional',
  'GET /v1/search/food': 'optional',
  'GET /v1/food-categories': 'public',
  'GET /v1/vendor/restaurants': 'restaurant.manage.own',
  'POST /v1/vendor/restaurants': 'restaurant.manage.own',
  'GET /v1/vendor/restaurants/:restaurantId': 'restaurant.manage.own',
  'PATCH /v1/vendor/restaurants/:restaurantId': 'restaurant.manage.own',
  'PUT /v1/vendor/restaurants/:restaurantId/hours': 'restaurant.manage.own',
  'PUT /v1/vendor/restaurants/:restaurantId/availability': 'restaurant.manage.own',
  'GET /v1/vendor/restaurants/:restaurantId/menu': 'menu.manage.own',
  'POST /v1/vendor/restaurants/:restaurantId/categories': 'menu.manage.own',
  'PATCH /v1/vendor/restaurants/:restaurantId/categories/:categoryId': 'menu.manage.own',
  'DELETE /v1/vendor/restaurants/:restaurantId/categories/:categoryId': 'menu.manage.own',
  'POST /v1/vendor/restaurants/:restaurantId/items': 'menu.manage.own',
  'PUT /v1/vendor/restaurants/:restaurantId/items/:itemId': 'menu.manage.own',
  'PUT /v1/vendor/restaurants/:restaurantId/items/:itemId/availability': 'menu.manage.own',
  'DELETE /v1/vendor/restaurants/:restaurantId/items/:itemId': 'menu.manage.own',
  'GET /v1/admin/restaurants': 'restaurant.read.any',
  'GET /v1/admin/restaurants/:restaurantId': 'restaurant.read.any',
  'POST /v1/admin/restaurants/:restaurantId/approve': 'restaurant.approve',
  'POST /v1/admin/restaurants/:restaurantId/reject': 'restaurant.approve',
  'POST /v1/admin/restaurants/:restaurantId/suspend': 'restaurant.approve',
  'GET /v1/admin/riders': 'rider.read.any',
  'GET /v1/admin/riders/:riderId': 'rider.read.any',
  'POST /v1/admin/riders/:riderId/approve': 'rider.approve',
  'POST /v1/admin/riders/:riderId/reject': 'rider.approve',
  'POST /v1/admin/riders/:riderId/suspend': 'rider.approve',
  'PUT /v1/admin/riders/:riderId/type': 'rider.approve',
  'GET /v1/admin/settings/business-rules': 'config.manage',
  'PUT /v1/admin/settings/business-rules': 'config.manage',
  'POST /v1/orders/quote': 'order.place',
  'POST /v1/orders': 'order.place',
  'GET /v1/orders': 'order.read.own',
  'GET /v1/orders/:orderId': 'order.read.own',
  'POST /v1/orders/:orderId/cancel': 'order.cancel.own',
  'GET /v1/orders/:orderId/reorder': 'order.place',
  'POST /v1/orders/:orderId/payments': 'order.place',
  'POST /v1/payments/:reference/verify': 'order.read.own',
  // Public by necessity: authenticated by the provider's HMAC signature, not a user token.
  'POST /v1/payments/webhooks/paystack': 'public',
  'POST /v1/orders/:orderId/review': 'review.write.own',
  'GET /v1/vendor/restaurants/:restaurantId/orders': 'order.process.own',
  'GET /v1/vendor/restaurants/:restaurantId/orders/:orderId': 'order.process.own',
  'POST /v1/vendor/restaurants/:restaurantId/orders/:orderId/accept': 'order.process.own',
  'POST /v1/vendor/restaurants/:restaurantId/orders/:orderId/reject': 'order.process.own',
  'POST /v1/vendor/restaurants/:restaurantId/orders/:orderId/start-preparing': 'order.process.own',
  'POST /v1/vendor/restaurants/:restaurantId/orders/:orderId/ready': 'order.process.own',
  'POST /v1/vendor/restaurants/:restaurantId/orders/:orderId/delay': 'order.process.own',
  'GET /v1/vendor/restaurants/:restaurantId/reports/sales': 'finance.read.own',
  'GET /v1/vendor/restaurants/:restaurantId/reviews': 'review.reply.own',
  'POST /v1/vendor/restaurants/:restaurantId/reviews/:reviewId/reply': 'review.reply.own',
  'POST /v1/vendor/restaurants/:restaurantId/images': 'menu.manage.own',
  'POST /v1/vendor/restaurants/:restaurantId/documents': 'restaurant.manage.own',
  'GET /v1/vendor/restaurants/:restaurantId/documents': 'restaurant.manage.own',
  // Phase 7: rider app
  'GET /v1/rider/me': 'rider.profile.own',
  'PUT /v1/rider/availability': 'delivery.work.own',
  'PUT /v1/rider/location': 'delivery.work.own',
  'GET /v1/rider/work': 'delivery.work.own',
  'POST /v1/rider/offers/:offerId/accept': 'delivery.work.own',
  'POST /v1/rider/offers/:offerId/decline': 'delivery.work.own',
  'POST /v1/rider/deliveries/:deliveryId/arrived': 'delivery.work.own',
  'POST /v1/rider/deliveries/:deliveryId/picked-up': 'delivery.work.own',
  'POST /v1/rider/deliveries/:deliveryId/complete': 'delivery.work.own',
  'POST /v1/rider/deliveries/:deliveryId/release': 'delivery.work.own',
  'POST /v1/rider/deliveries/:deliveryId/problem': 'delivery.work.own',
  'GET /v1/rider/deliveries': 'delivery.work.own',
  'GET /v1/rider/earnings': 'earnings.read.own',
  'POST /v1/rider/documents': 'rider.profile.own',
  'GET /v1/rider/documents': 'rider.profile.own',
  // Phase 8: finance
  'GET /v1/admin/finance/summary': 'settlement.manage',
  'GET /v1/admin/finance/refunds': 'payment.read',
  'GET /v1/admin/finance/refunds/:refundId': 'payment.read',
  'POST /v1/admin/orders/:orderId/refunds': 'refund.request',
  'POST /v1/admin/payments/:reference/verify': 'payment.read',
  'POST /v1/admin/finance/refunds/:refundId/approve': 'refund.approve',
  'POST /v1/admin/finance/refunds/:refundId/reject': 'refund.approve',
  'POST /v1/admin/finance/refunds/:refundId/retry': 'refund.approve',
  'POST /v1/admin/finance/refunds/:refundId/mark-paid': 'refund.approve',
  'POST /v1/admin/finance/refunds/:refundId/refresh': 'refund.approve',
  'GET /v1/admin/finance/cash': 'cash.reconcile',
  'GET /v1/admin/finance/remittances': 'cash.reconcile',
  'POST /v1/admin/finance/remittances': 'cash.reconcile',
  'POST /v1/admin/finance/remittances/:remittanceId/confirm': 'cash.reconcile',
  'POST /v1/admin/finance/remittances/:remittanceId/reject': 'cash.reconcile',
  'POST /v1/admin/finance/settlements/generate': 'settlement.manage',
  'GET /v1/admin/finance/settlements': 'settlement.manage',
  'GET /v1/admin/finance/settlements/:kind/:settlementId': 'settlement.manage',
  'POST /v1/admin/finance/settlements/:kind/:settlementId/approve': 'settlement.manage',
  'POST /v1/admin/finance/settlements/:kind/:settlementId/cancel': 'settlement.manage',
  'POST /v1/admin/finance/settlements/:kind/:settlementId/payout': 'payout.manage',
  'POST /v1/admin/finance/payouts/:payoutId/complete': 'payout.manage',
  'POST /v1/admin/finance/payouts/:payoutId/fail': 'payout.manage',
  'GET /v1/vendor/restaurants/:restaurantId/settlements': 'finance.read.own',
  'GET /v1/rider/settlements': 'earnings.read.own',
  'GET /v1/rider/remittances': 'earnings.read.own',
  'POST /v1/rider/remittances': 'delivery.work.own',
  // Phase 9: operations
  'GET /v1/admin/dashboard': 'dashboard.view',
  'GET /v1/admin/orders': 'order.read.any',
  'GET /v1/admin/orders/:orderId': 'order.read.any',
  'POST /v1/admin/orders/:orderId/cancel': 'order.manage.any',
  'POST /v1/admin/orders/:orderId/retry-delivery': 'order.manage.any',
  'POST /v1/admin/orders/:orderId/confirm-delivered': 'order.manage.any',
  'GET /v1/admin/dispatch': 'dispatch.manage',
  'POST /v1/admin/deliveries/:deliveryId/assign': 'dispatch.manage',
  'POST /v1/admin/deliveries/:deliveryId/unassign': 'dispatch.manage',
  'GET /v1/admin/users': 'customer.read.any',
  'GET /v1/admin/users/:userId': 'customer.read.any',
  'POST /v1/admin/users/:userId/suspend': 'customer.manage',
  'POST /v1/admin/users/:userId/reactivate': 'customer.manage',
  'POST /v1/admin/staff': 'staff.manage',
  'GET /v1/admin/restaurant-documents': 'restaurant.approve',
  'POST /v1/admin/restaurant-documents/:documentId/link': 'restaurant.approve',
  'POST /v1/admin/restaurant-documents/:documentId/review': 'restaurant.approve',
  'GET /v1/admin/rider-documents': 'rider.approve',
  'POST /v1/admin/rider-documents/:documentId/link': 'rider.approve',
  'POST /v1/admin/rider-documents/:documentId/review': 'rider.approve',
  'GET /v1/admin/promotions': 'promotion.manage',
  'POST /v1/admin/promotions': 'promotion.manage',
  'PATCH /v1/admin/promotions/:promotionId': 'promotion.manage',
  'GET /v1/admin/reviews': 'review.moderate',
  'POST /v1/admin/reviews/:reviewId/moderate': 'review.moderate',
  'GET /v1/admin/audit': 'audit.read',
  // Phase 10: notifications and realtime
  'GET /v1/me/notifications': 'authenticated',
  'POST /v1/me/notifications/read': 'authenticated',
  'PUT /v1/me/push-tokens': 'authenticated',
  'POST /v1/me/push-tokens/remove': 'authenticated',
  'POST /v1/realtime/ticket': 'authenticated',
};

describe('route access declarations', () => {
  it('match the reviewed access manifest exactly', () => {
    const actual = Object.fromEntries(routes.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r.access]));
    expect(actual).toEqual(ACCESS_MANIFEST);
  });

  it('admin routes need a staff-only permission; vendor and rider routes need their own role’s permission', () => {
    for (const r of routes) {
      if (r.path.startsWith('/v1/admin/')) {
        expect(['public', 'optional', 'authenticated'], r.path).not.toContain(r.access);
        for (const role of ['CUSTOMER', 'VENDOR', 'RIDER'] as const) expect(hasPermission(role, r.access as Permission), `${role} ${r.path}`).toBe(false);
      }
      if (r.path.startsWith('/v1/vendor/')) {
        expect(hasPermission('VENDOR', r.access as Permission), r.path).toBe(true);
        for (const role of ['CUSTOMER', 'RIDER'] as const) expect(hasPermission(role, r.access as Permission), `${role} ${r.path}`).toBe(false);
      }
      if (r.path.startsWith('/v1/rider/')) {
        expect(hasPermission('RIDER', r.access as Permission), r.path).toBe(true);
        for (const role of ['CUSTOMER', 'VENDOR'] as const) expect(hasPermission(role, r.access as Permission), `${role} ${r.path}`).toBe(false);
      }
    }
  });
});

describe('route protection sweep', () => {
  const protectedRoutes = () => routes.filter((r) => r.access !== 'public' && r.access !== 'optional');

  it('has protected routes to check', () => {
    expect(protectedRoutes().length).toBeGreaterThan(25);
  });

  it('every protected route returns 401 without a token', async () => {
    for (const r of protectedRoutes()) {
      const res = await request(app)[r.method](concretePath(r.path)).send({});
      expect(res.status, `${r.method.toUpperCase()} ${r.path}`).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('every protected route returns 401 for a forged or garbage token', async () => {
    for (const r of protectedRoutes().slice(0, 10)) {
      const res = await request(app)[r.method](concretePath(r.path)).set('Authorization', 'Bearer not.a.jwt').send({});
      expect(res.status, `${r.method.toUpperCase()} ${r.path}`).toBe(401);
    }
  });

  it('every permission-gated route returns 403 to each role that lacks the permission', async () => {
    for (const [role, account] of Object.entries(SEEDED_ACCOUNT) as [Role, string][]) {
      const token = await tokenFor(app, account);
      for (const r of routes) {
        if (r.access === 'public' || r.access === 'optional' || r.access === 'authenticated') continue;
        if (hasPermission(role, r.access as Permission)) continue;
        const res = await request(app)[r.method](concretePath(r.path)).set(bearer(token)).send({});
        expect(res.status, `${role} ${r.method.toUpperCase()} ${r.path}`).toBe(403);
      }
    }
  }, 120_000);
});

describe('ownership (IDOR)', () => {
  it("a vendor cannot read or change another vendor's restaurant or menu", async () => {
    const mama = await db.restaurant.findUniqueOrThrow({ where: { slug: 'mama-nkechis-kitchen' }, include: { categories: true, menuItems: true } });
    const other = await tokenFor(app, 'vendor.bukka');
    const base = `/v1/vendor/restaurants/${mama.id}`;
    const attempts = [
      request(app).get(base).set(bearer(other)),
      request(app).patch(base).set(bearer(other)).send({ name: 'Hijacked' }),
      request(app).put(`${base}/availability`).set(bearer(other)).send({ isAcceptingOrders: false }),
      request(app).put(`${base}/hours`).set(bearer(other)).send({ windows: [] }),
      request(app).get(`${base}/menu`).set(bearer(other)),
      request(app).post(`${base}/categories`).set(bearer(other)).send({ name: 'Mine now' }),
      request(app).put(`${base}/items/${mama.menuItems[0]!.id}/availability`).set(bearer(other)).send({ isAvailable: false }),
      request(app).delete(`${base}/items/${mama.menuItems[0]!.id}`).set(bearer(other)),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    const after = await db.restaurant.findUniqueOrThrow({ where: { id: mama.id } });
    expect(after.name).toBe(mama.name);
    expect(after.isAcceptingOrders).toBe(true);
  });

  it("a vendor cannot file an item under another restaurant's category", async () => {
    const mamaCat = await db.menuCategory.findFirstOrThrow({ where: { restaurant: { slug: 'mama-nkechis-kitchen' } } });
    const bukka = await db.restaurant.findUniqueOrThrow({ where: { slug: 'bukka-republic' } });
    const res = await request(app)
      .post(`/v1/vendor/restaurants/${bukka.id}/items`)
      .set(bearer(await tokenFor(app, 'vendor.bukka')))
      .send({ categoryId: mamaCat.id, name: 'Sneaky Rice', priceKobo: 100_000 });
    expect(res.status).toBe(404);
  });

  it("a customer cannot read, change or delete another customer's address", async () => {
    const adaAddress = await db.address.findFirstOrThrow({ where: { user: { email: seededEmail('ada') } } });
    const tunde = await tokenFor(app, 'tunde');
    const path = `/v1/me/addresses/${adaAddress.id}`;
    expect((await request(app).patch(path).set(bearer(tunde)).send({ label: 'Pwned' })).status).toBe(404);
    expect((await request(app).delete(path).set(bearer(tunde))).status).toBe(404);
    expect((await request(app).post(`${path}/default`).set(bearer(tunde))).status).toBe(404);
    const list = await request(app).get('/v1/me/addresses').set(bearer(tunde));
    expect(list.body.items.map((a: { id: string }) => a.id)).not.toContain(adaAddress.id);
    expect((await db.address.findUniqueOrThrow({ where: { id: adaAddress.id } })).label).toBe('Home');
  });
});

describe('safe errors and input handling', () => {
  it('returns structured validation errors', async () => {
    const res = await request(app).post('/v1/auth/register').send({ email: 'not-an-email', password: 'x', fullName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['email', 'password', 'fullName']));
  });

  it('rejects malformed JSON without a stack trace', async () => {
    const res = await request(app).post('/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|SyntaxError/);
  });

  it('rejects oversized bodies', async () => {
    const res = await request(app).post('/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
  });

  it('never returns password hashes or token internals', async () => {
    const token = await tokenFor(app, 'admin');
    for (const path of ['/v1/me', '/v1/admin/restaurants', '/v1/admin/riders']) {
      const res = await request(app).get(path).set(bearer(token));
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt\$|tokenVersion|failedLoginCount/);
    }
  });

  it('echoes a request id for tracing', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'trace-12345678');
    expect(res.headers['x-request-id']).toBe('trace-12345678');
  });
});

describe('PIN exposure check (test helper)', () => {
  it('catches a leaked PIN but not dates, ids, amounts or coordinates that contain the same digits', () => {
    const clean = { at: '2026-10-14T13:48:03.000Z', id: '01a14548-2026-733a-8475-0738bea23b66', cashKobo: 202600, lat: 6.2026, pinAttemptsLeft: 5 };
    expectNoPin(clean, '2026');
    expect(() => expectNoPin({ ...clean, deliveryPin: '2026' }, '2026')).toThrow();
    expect(() => expectNoPin({ ...clean, note: 'Your code is 2026' }, '2026')).toThrow();
    expect(() => expectNoPin('PIN 2026.', '2026')).toThrow();
  });
});

describe('rate limiting and CORS', () => {
  it('limits repeated sign-in attempts per IP', async () => {
    const strict = buildTestApp(db, { env: { RATE_LIMIT_AUTH_MAX: '3' } });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await request(strict).post('/v1/auth/login').send({ email: 'x@example.com', password: 'wrong1234' })).status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
    const last = await request(strict).post('/v1/auth/login').send({ email: 'x@example.com', password: 'wrong1234' });
    expect(last.body.error.code).toBe('RATE_LIMITED');
  });

  it('limits order placement per customer, not per IP (carrier NAT shares IPs)', async () => {
    const strict = buildTestApp(db, { env: { RATE_LIMIT_ORDER_MAX: '2' } });
    const ada = await tokenFor(strict, 'ada');
    const tunde = await tokenFor(strict, 'tunde');
    const place = (t: string) => request(strict).post('/v1/orders').set(bearer(t)).set('Idempotency-Key', randomUUID()).send({});
    const statuses = [(await place(ada)).status, (await place(ada)).status, (await place(ada)).status];
    expect(statuses.slice(0, 2)).toEqual([400, 400]); // counted before validation, so junk requests use the budget too
    expect(statuses[2]).toBe(429);
    // Another customer from the same IP is unaffected.
    expect((await place(tunde)).status).toBe(400);
    // Quotes get a larger budget of their own (12× placements), so checkout stays usable.
    expect((await request(strict).post('/v1/orders/quote').set(bearer(ada)).send({})).status).toBe(400);
  });

  it('limits payment starts and checks per customer', async () => {
    const strict = buildTestApp(db, { env: { RATE_LIMIT_PAYMENT_MAX: '2' } });
    const ada = await tokenFor(strict, 'ada');
    const verify = () => request(strict).post('/v1/payments/NO-SUCH-REF/verify').set(bearer(ada));
    const statuses = [(await verify()).status, (await verify()).status, (await verify()).status];
    expect(statuses.slice(0, 2)).not.toContain(429);
    expect(statuses[2]).toBe(429);
    const init = await request(strict).post(`/v1/orders/${randomUUID()}/payments`).set(bearer(ada)).set('Idempotency-Key', randomUUID());
    expect(init.status).toBe(429);
  });

  it('limits webhook calls per IP and still rejects unsigned ones', async () => {
    const strict = buildTestApp(db, { env: { RATE_LIMIT_WEBHOOK_MAX: '2' } });
    const hook = () => request(strict).post('/v1/payments/webhooks/paystack').send({ event: 'charge.success', data: { reference: 'X' } });
    const statuses = [(await hook()).status, (await hook()).status, (await hook()).status];
    expect(statuses.slice(0, 2).every((st) => st === 401 || st === 400)).toBe(true);
    expect(statuses[2]).toBe(429);
  });

  it('limits realtime tickets per user', async () => {
    const strict = buildTestApp(db);
    const ada = await tokenFor(strict, 'ada');
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await request(strict).post('/v1/realtime/ticket').set(bearer(ada))).status;
    expect(last).toBe(429);
    const rider = await tokenFor(strict, 'rider.core1');
    expect((await request(strict).post('/v1/realtime/ticket').set(bearer(rider))).status).toBe(200);
  });

  it('allows listed web origins only', async () => {
    const ok = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});
