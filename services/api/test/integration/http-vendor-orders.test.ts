/**
 * Restaurant side of the order lifecycle (acceptance steps 11–13): visibility, accept/reject,
 * preparing/ready, delays, the accept deadline, refunds on rejection, sales report, reviews,
 * and cookie-based web sessions.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../../src/modules/payments/mock.js';
import { createTestDb } from './helpers.js';
import { LAGOS_NOON, bearer, buildTestHarness, freshSeed, seededEmail, tokenFor, expectNoPin } from './http-helpers.js';

const db = createTestDb();
const harness = buildTestHarness(db);
const app = harness.app;
const mock = harness.services.paymentProvider as MockPaymentProvider;

let ada: string;
let mamaVendor: string;
let bukkaVendor: string;
let mamaId: string;
let addressId: string;
let jollof: { id: string; large: string };
let n = 0;
const key = () => `vendor-test-${Date.now()}-${++n}`;
const v = (path: string) => `/v1/vendor/restaurants/${mamaId}${path}`;

async function placeOrder(paymentMethod: 'CASH_ON_DELIVERY' | 'ONLINE', extra: Record<string, unknown> = {}, appToUse = app) {
  const res = await request(appToUse)
    .post('/v1/orders')
    .set(bearer(ada))
    .set('Idempotency-Key', key())
    .send({ restaurantId: mamaId, addressId, paymentMethod, items: [{ menuItemId: jollof.id, variantId: jollof.large, quantity: 1 }], ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

async function payOnline(orderId: string) {
  const init = await request(app).post(`/v1/orders/${orderId}/payments`).set(bearer(ada)).set('Idempotency-Key', key()).send();
  mock.complete(init.body.reference, 'success');
  await request(app).post(`/v1/payments/${init.body.reference}/verify`).set(bearer(ada)).send();
}

beforeAll(async () => {
  await freshSeed(db);
  ada = await tokenFor(app, 'ada');
  mamaVendor = await tokenFor(app, 'vendor.mamankechi');
  bukkaVendor = await tokenFor(app, 'vendor.bukka');
  mamaId = (await db.restaurant.findUniqueOrThrow({ where: { slug: 'mama-nkechis-kitchen' } })).id;
  addressId = (await db.address.findFirstOrThrow({ where: { user: { email: seededEmail('ada') } } })).id;
  const j = await db.menuItem.findFirstOrThrow({ where: { restaurantId: mamaId, name: 'Jollof Rice' }, include: { variants: true } });
  jollof = { id: j.id, large: j.variants.find((x) => x.name === 'Large')!.id };
}, 120_000);
afterAll(() => db.$disconnect());

describe('what the restaurant can see', () => {
  it('cash orders arrive immediately, without customer contact details or the delivery PIN', async () => {
    const order = await placeOrder('CASH_ON_DELIVERY', { customerNote: 'Extra pepper please' });
    const list = await request(app).get(v('/orders')).query({ view: 'incoming' }).set(bearer(mamaVendor));
    expect(list.status).toBe(200);
    expect(list.body.incomingCount).toBeGreaterThanOrEqual(1);
    const seen = list.body.items.find((o: { id: string }) => o.id === order.id);
    expect(seen).toMatchObject({ status: 'PLACED', customerFirstName: 'Ada', customerNote: 'Extra pepper please', actions: ['accept', 'reject'], subtotalKobo: 350_000, commissionKobo: 52_500, estimatedEarningsKobo: 297_500 });
    const raw = JSON.stringify(seen);
    expectNoPin(raw, order.deliveryPin);
    expect(raw).not.toMatch(/Sabo Road|\+234|chopnow\.test|deliveryPin|address/i);
  });

  it('unpaid online orders are invisible to the restaurant until paid', async () => {
    const order = await placeOrder('ONLINE');
    expect((await request(app).get(v(`/orders/${order.id}`)).set(bearer(mamaVendor))).status).toBe(404);
    expect((await request(app).post(v(`/orders/${order.id}/accept`)).set(bearer(mamaVendor)).send({})).status).toBe(404);
    await payOnline(order.id);
    expect((await request(app).get(v(`/orders/${order.id}`)).set(bearer(mamaVendor))).body.paymentStatus).toBe('SUCCESSFUL');
  });

  it("another restaurant's owner cannot see or act on the order", async () => {
    const order = await placeOrder('CASH_ON_DELIVERY');
    const bukkaPath = `/v1/vendor/restaurants/${mamaId}/orders/${order.id}`;
    expect((await request(app).get(bukkaPath).set(bearer(bukkaVendor))).status).toBe(404);
    expect((await request(app).post(`${bukkaPath}/accept`).set(bearer(bukkaVendor)).send({})).status).toBe(404);
    expect((await request(app).get(`/v1/vendor/restaurants/${mamaId}/orders`).set(bearer(bukkaVendor))).status).toBe(404);
  });
});

describe('kitchen workflow', () => {
  let orderId: string;
  beforeAll(async () => {
    orderId = (await placeOrder('CASH_ON_DELIVERY')).id;
  });

  it('cannot skip ahead before accepting', async () => {
    const res = await request(app).post(v(`/orders/${orderId}/start-preparing`)).set(bearer(mamaVendor)).send();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_ORDER_TRANSITION');
  });

  it('accepts with a prep time; the customer sees the estimate', async () => {
    const res = await request(app).post(v(`/orders/${orderId}/accept`)).set(bearer(mamaVendor)).send({ prepTimeMinutes: 40 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ACCEPTED', actions: ['start_preparing', 'mark_ready', 'report_delay'] });
    expect(new Date(res.body.estimatedReadyAt).getTime()).toBe(LAGOS_NOON.getTime() + 40 * 60_000);
    const customer = await request(app).get(`/v1/orders/${orderId}`).set(bearer(ada));
    expect(customer.body).toMatchObject({ status: 'ACCEPTED', canCancel: false, estimatedReadyAt: res.body.estimatedReadyAt });
    expect((await request(app).post(v(`/orders/${orderId}/accept`)).set(bearer(mamaVendor)).send({})).status).toBe(409);
  });

  it('reports a delay, moving the estimate later (audited)', async () => {
    const before = (await request(app).get(v(`/orders/${orderId}`)).set(bearer(mamaVendor))).body.estimatedReadyAt;
    const res = await request(app).post(v(`/orders/${orderId}/delay`)).set(bearer(mamaVendor)).send({ extraMinutes: 15, note: 'Gas ran out' });
    expect(new Date(res.body.estimatedReadyAt).getTime() - new Date(before).getTime()).toBe(15 * 60_000);
    expect(await db.auditLog.count({ where: { action: 'order.delay', entityId: orderId } })).toBe(1);
  });

  it('marks ready straight from accepted, recording preparing in between', async () => {
    const res = await request(app).post(v(`/orders/${orderId}/ready`)).set(bearer(mamaVendor)).send();
    expect(res.body).toMatchObject({ status: 'READY_FOR_PICKUP', actions: [] });
    const timeline = (await request(app).get(`/v1/orders/${orderId}`).set(bearer(ada))).body.timeline.map((t: { status: string }) => t.status);
    expect(timeline).toEqual(['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP']);
    expect((await request(app).post(v(`/orders/${orderId}/delay`)).set(bearer(mamaVendor)).send({ extraMinutes: 5 })).status).toBe(409);
    const history = (await db.orderStatusHistory.findMany({ where: { orderId, toStatus: { in: ['ACCEPTED', 'READY_FOR_PICKUP'] } } })).map((h) => h.actorRole);
    expect(history).toEqual(['VENDOR', 'VENDOR']);
  });

  it('active view lists ready orders; history excludes them', async () => {
    const active = await request(app).get(v('/orders')).query({ view: 'active' }).set(bearer(mamaVendor));
    expect(active.body.items.map((o: { id: string }) => o.id)).toContain(orderId);
    const history = await request(app).get(v('/orders')).query({ view: 'history' }).set(bearer(mamaVendor));
    expect(history.body.items.map((o: { id: string }) => o.id)).not.toContain(orderId);
  });
});

describe('declining orders', () => {
  it('requires a note for "other"', async () => {
    const order = await placeOrder('CASH_ON_DELIVERY');
    expect((await request(app).post(v(`/orders/${order.id}/reject`)).set(bearer(mamaVendor)).send({ reason: 'OTHER' })).status).toBe(400);
  });

  it('declining a paid order requests a refund, frees the promo and tells the customer why', async () => {
    const order = await placeOrder('ONLINE', { promoCode: 'WELCOME10' });
    await payOnline(order.id);
    const res = await request(app).post(v(`/orders/${order.id}/reject`)).set(bearer(mamaVendor)).send({ reason: 'TOO_BUSY', note: 'Kitchen full tonight' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
    const customer = await request(app).get(`/v1/orders/${order.id}`).set(bearer(ada));
    expect(customer.body).toMatchObject({ status: 'REJECTED', paymentStatus: 'REFUND_PENDING', cancellationReason: 'The restaurant is too busy: Kitchen full tonight' });
    expect(await db.refund.count({ where: { orderId: order.id, status: 'REQUESTED', amountKobo: order.totalKobo } })).toBe(1);
    expect((await db.promotionRedemption.findUniqueOrThrow({ where: { orderId: order.id } })).isActive).toBe(false);
    expect(await db.auditLog.count({ where: { action: 'order.reject', entityId: order.id } })).toBe(1);
  });
});

describe('accept deadline', () => {
  it('orders not accepted within 10 minutes are declined automatically and cannot be accepted late', async () => {
    const order = await placeOrder('CASH_ON_DELIVERY');
    const late = buildTestHarness(db, { now: new Date(LAGOS_NOON.getTime() + 11 * 60_000) });

    const lateAccept = await request(late.app).post(v(`/orders/${order.id}/accept`)).set(bearer(mamaVendor)).send({});
    expect(lateAccept.status).toBe(409);
    expect(lateAccept.body.error.code).toBe('ACCEPT_DEADLINE_PASSED');

    const expired = await late.services.vendorOrders.expireOverdue();
    expect(expired).toBeGreaterThanOrEqual(1);
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o).toMatchObject({ status: 'REJECTED', cancellationReason: 'The restaurant did not respond in time' });
    const last = await db.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id, toStatus: 'REJECTED' } });
    expect(last).toMatchObject({ actorRole: 'SYSTEM', actorUserId: null });

    // Running the sweep again changes nothing.
    expect(await late.services.vendorOrders.expireOverdue()).toBe(0);
  });
});

describe('sales report', () => {
  it('summarises delivered orders for the period', async () => {
    const order = await placeOrder('CASH_ON_DELIVERY');
    await db.order.update({ where: { id: order.id }, data: { status: 'DELIVERED', deliveredAt: LAGOS_NOON } });
    const res = await request(app).get(v('/reports/sales')).query({ from: '2026-10-14', to: '2026-10-14' }).set(bearer(mamaVendor));
    expect(res.status).toBe(200);
    expect(res.body.deliveredOrders).toBeGreaterThanOrEqual(1);
    expect(res.body.estimatedNetKobo).toBe(res.body.grossFoodSalesKobo - res.body.commissionKobo - res.body.restaurantFundedDiscountKobo);
    expect(res.body.days).toEqual([expect.objectContaining({ date: '2026-10-14' })]);
    expect(res.body.topItems[0]).toMatchObject({ name: 'Jollof Rice' });
    expect((await request(app).get(v('/reports/sales')).query({ from: '2026-10-15', to: '2026-10-01' }).set(bearer(mamaVendor))).status).toBe(400);
    expect((await request(app).get(v('/reports/sales')).query({ from: '2026-10-14', to: '2026-10-14' }).set(bearer(bukkaVendor))).status).toBe(404);
  });
});

describe('reviews', () => {
  it('a customer reviews a delivered order once; the rating updates; the restaurant replies', async () => {
    const delivered = await db.order.findFirstOrThrow({ where: { restaurantId: mamaId, status: 'DELIVERED', customer: { email: seededEmail('ada') }, review: null } });
    const res = await request(app).post(`/v1/orders/${delivered.id}/review`).set(bearer(ada)).send({ restaurantRating: 4, riderRating: 5, comment: 'Lovely jollof' });
    expect(res.status).toBe(201);
    expect((await request(app).post(`/v1/orders/${delivered.id}/review`).set(bearer(ada)).send({ restaurantRating: 1 })).status).toBe(409);

    const restaurant = await db.restaurant.findUniqueOrThrow({ where: { id: mamaId } });
    expect(restaurant.ratingCount).toBeGreaterThanOrEqual(1);
    expect(restaurant.ratingAverage).not.toBeNull();

    const tunde = await tokenFor(app, 'tunde');
    expect((await request(app).post(`/v1/orders/${delivered.id}/review`).set(bearer(tunde)).send({ restaurantRating: 1 })).status).toBe(404);
    const notDelivered = await placeOrder('CASH_ON_DELIVERY');
    expect((await request(app).post(`/v1/orders/${notDelivered.id}/review`).set(bearer(ada)).send({ restaurantRating: 5 })).body.error.code).toBe('NOT_DELIVERED');

    const list = await request(app).get(v('/reviews')).set(bearer(mamaVendor));
    const review = list.body.items.find((r: { comment: string }) => r.comment === 'Lovely jollof');
    expect(review).toMatchObject({ restaurantRating: 4, customerFirstName: 'Ada', vendorReply: null });
    expect((await request(app).post(v(`/reviews/${review.id}/reply`)).set(bearer(bukkaVendor)).send({ reply: 'Thanks!' })).status).toBe(404);
    expect((await request(app).post(v(`/reviews/${review.id}/reply`)).set(bearer(mamaVendor)).send({ reply: 'Thank you, Ada!' })).status).toBe(200);
    expect((await db.review.findUniqueOrThrow({ where: { id: review.id } })).vendorReply).toBe('Thank you, Ada!');
  });
});

describe('web portal sessions (httpOnly cookie)', () => {
  const login = () =>
    request(app).post('/v1/auth/login').set('X-ChopNow-Client', 'web').send({ email: seededEmail('vendor.bukka'), password: 'ChopNow-dev-2026' });
  const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('chopnow_rt='));

  it('puts the refresh token in an httpOnly, SameSite=Strict cookie and not in the body', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toBe('');
    expect(res.body.accessToken).toBeTruthy();
    const cookie = cookieOf(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/v1\/auth/);
  });

  it('refreshes from the cookie (rotating it) only when the web header is present', async () => {
    const first = cookieOf(await login())!.split(';')[0]!;
    expect((await request(app).post('/v1/auth/refresh').set('Cookie', first).send({})).status).toBe(401); // no header
    const refreshed = await request(app).post('/v1/auth/refresh').set('Cookie', first).set('X-ChopNow-Client', 'web').send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).toBe('');
    const second = cookieOf(refreshed)!.split(';')[0]!;
    expect(second).not.toBe(first);
    expect((await request(app).post('/v1/auth/refresh').set('Cookie', first).set('X-ChopNow-Client', 'web').send({})).status).toBe(401); // rotated

    const out = await request(app).post('/v1/auth/logout').set('Cookie', second).set('X-ChopNow-Client', 'web').send({});
    expect(out.status).toBe(200);
    expect(cookieOf(out)).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
    // Second family was replay-revoked when `first` was reused, so the cookie is dead either way.
    expect((await request(app).post('/v1/auth/refresh').set('Cookie', second).set('X-ChopNow-Client', 'web').send({})).status).toBe(401);
  });

  it('allows credentialed CORS only for listed portal origins', async () => {
    const ok = await request(app).options('/v1/auth/refresh').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'x-chopnow-client,content-type');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(app).options('/v1/auth/refresh').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});
