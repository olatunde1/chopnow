/**
 * The MVP acceptance journey (spec §21), end to end through the HTTP API, once paid online and once
 * with cash on delivery. Each step is labelled with its number in the spec. The same journey is
 * driven through the real web apps by tests/e2e (Playwright).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../../src/modules/payments/mock.js';
import { createTestDb } from './helpers.js';
import { LAGOS_NOON, YABA, bearer, buildTestHarness, freshSeed, tokenFor } from './http-helpers.js';

const db = createTestDb();
let t = LAGOS_NOON.getTime();
const harness = buildTestHarness(db, { clock: () => new Date(t) });
const { app, services } = harness;
const mock = services.paymentProvider as MockPaymentProvider;

const tok: Record<string, string> = {};
const as = (n: string) => bearer(tok[n]!);
const ctx: { restaurantId?: string; slug?: string; itemId?: string; variants?: Record<string, string>; extras?: Record<string, string>; addressId?: string } = {};

beforeAll(async () => {
  await freshSeed(db);
  for (const n of ['admin', 'ops', 'finance', 'rider.core1']) tok[n] = await tokenFor(app, n);
  // Only the rider in this journey is working; the seeded sample deliveries are out of the way.
  await db.delivery.updateMany({ where: { status: { in: ['UNASSIGNED', 'OFFERING'] } }, data: { status: 'CANCELLED' } });
  await db.rider.updateMany({ data: { availability: 'OFFLINE' } });
}, 120_000);
afterAll(() => db.$disconnect());

describe('setting up a new restaurant', () => {
  it('1. an administrator approves a new restaurant', async () => {
    const owner = await request(app).post('/v1/auth/register').send({ email: 'chef@bole-joint.test', password: 'bole2026ok', fullName: 'Tamuno Briggs', phone: '08061114444', role: 'VENDOR' });
    expect(owner.status).toBe(201);
    tok.owner = owner.body.accessToken;
    const r = await request(app).post('/v1/vendor/restaurants').set(as('owner')).send({
      name: 'Bole & Jollof Joint', description: 'Party jollof, bole and fish.', phone: '08061114444', addressLine: '9 Commercial Avenue', area: 'Yaba', city: 'Lagos', latitude: 6.5139, longitude: 3.3718, prepTimeMinutes: 20,
    });
    expect(r.body.verificationStatus).toBe('PENDING');
    ctx.restaurantId = r.body.id;
    ctx.slug = r.body.slug;
    await request(app).put(`/v1/vendor/restaurants/${ctx.restaurantId}/hours`).set(as('owner')).send({ windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, opensAt: 9 * 60, closesAt: 22 * 60 })) });
    const approved = await request(app).post(`/v1/admin/restaurants/${ctx.restaurantId}/approve`).set(as('ops')).send({ note: 'Visited and checked' });
    expect(approved.body.verificationStatus).toBe('APPROVED');
    expect((await request(app).put(`/v1/vendor/restaurants/${ctx.restaurantId}/availability`).set(as('owner')).send({ isAcceptingOrders: true })).body.isAcceptingOrders).toBe(true);
  });

  it('2. the restaurant creates a menu', async () => {
    const cat = await request(app).post(`/v1/vendor/restaurants/${ctx.restaurantId}/categories`).set(as('owner')).send({ name: 'Rice' });
    const item = await request(app).post(`/v1/vendor/restaurants/${ctx.restaurantId}/items`).set(as('owner')).send({
      categoryId: cat.body.id, name: 'Smoky Party Jollof Rice', description: 'Firewood jollof', priceKobo: 280_000,
      variants: [{ name: 'Regular', priceKobo: 280_000, isDefault: true }, { name: 'Large', priceKobo: 360_000 }],
      extras: [{ name: 'Grilled chicken', priceKobo: 180_000, maxQuantity: 2 }, { name: 'Dodo', priceKobo: 50_000 }],
    });
    expect(item.status).toBe(201);
    ctx.itemId = item.body.id;
    ctx.variants = Object.fromEntries(item.body.variants.map((v: { name: string; id: string }) => [v.name, v.id]));
    ctx.extras = Object.fromEntries(item.body.extras.map((e: { name: string; id: string }) => [e.name, e.id]));
  });
});

describe.each([['ONLINE'], ['CASH_ON_DELIVERY']] as const)('a customer orders, paying %s', (method) => {
  const name = `cust-${method}`;
  const order: { id?: string; code?: string; pin?: string; total?: number; deliveryId?: string } = {};

  it('3. the customer opens the app (browsing needs no account)', async () => {
    expect((await request(app).get('/v1/food-categories')).status).toBe(200);
    const nearby = await request(app).get('/v1/restaurants').query({ lat: YABA.lat, lng: YABA.lng });
    expect(nearby.body.items.map((r: { slug: string }) => r.slug)).toContain(ctx.slug);
  });

  it('4–5. searches for jollof rice and sees eligible restaurants and their available meals', async () => {
    const res = await request(app).get('/v1/search/food').query({ q: 'jollof rice', lat: YABA.lat, lng: YABA.lng });
    const hit = res.body.items.find((h: { restaurant: { slug: string } }) => h.restaurant.slug === ctx.slug);
    expect(hit).toMatchObject({ orderable: true, item: { name: 'Smoky Party Jollof Rice', fromPriceKobo: 280_000, isAvailable: true } });
    expect(hit.restaurant.deliveryFeeKobo).toBe(50_000);
    expect((await request(app).get('/v1/search/food').query({ q: 'jollof rice', lat: 9.0765, lng: 7.3986 })).body.total).toBe(0); // Abuja: out of range
  });

  it('6–8. selects and customises the meal, has a cart, and enters a delivery address', async () => {
    const reg = await request(app).post('/v1/auth/register').send({ email: `${name.toLowerCase()}@journey.test`, password: 'hungry2026', fullName: `Journey ${method}`, role: 'CUSTOMER' });
    tok[name] = reg.body.accessToken;
    const addr = await request(app).post('/v1/me/addresses').set(as(name)).send({ label: 'Home', line1: '14 Akoka Road', area: 'Yaba', city: 'Lagos', latitude: YABA.lat, longitude: YABA.lng, landmark: 'Opposite the pharmacy' });
    expect(addr.status).toBe(201);
    ctx.addressId = addr.body.id;
  });

  // A first cash order is capped at ₦10,000 (spec default), so the cash journey orders one plate.
  const qty = method === 'ONLINE' ? 2 : 1;
  // Per plate: Large ₦3,600 + chicken ₦1,800 = ₦5,400. Delivery ₦500 (under 2 km). Service 5%, max ₦300.
  const sub = 540_000 * qty;
  const service = Math.min(30_000, sub * 0.05);
  const total = sub + 50_000 + service;
  const commission = sub * 0.15;
  const cart = () => ({ restaurantId: ctx.restaurantId, addressId: ctx.addressId, paymentMethod: method, items: [{ menuItemId: ctx.itemId, variantId: ctx.variants!.Large, quantity: qty, extras: [{ extraId: ctx.extras!['Grilled chicken'], quantity: 1 }], specialInstructions: 'Extra pepper' }] });

  it('9–10. chooses how to pay; the server validates the order and calculates the total', async () => {
    const tampered = await request(app).post('/v1/orders/quote').set(as(name)).send({ ...cart(), totalKobo: 100 });
    expect(tampered.status).toBe(400);
    const quote = await request(app).post('/v1/orders/quote').set(as(name)).send(cart());
    expect(quote.body).toMatchObject({ subtotalKobo: sub, deliveryFeeKobo: 50_000, serviceFeeKobo: service, discountKobo: 0, totalKobo: total });
    const placed = await request(app).post('/v1/orders').set(as(name)).set('Idempotency-Key', `journey-${method}`).send(cart());
    expect(placed.status).toBe(201);
    expect(placed.body.totalKobo).toBe(total);
    Object.assign(order, { id: placed.body.id, code: placed.body.code, pin: placed.body.deliveryPin, total: placed.body.totalKobo });
    const again = await request(app).post('/v1/orders').set(as(name)).set('Idempotency-Key', `journey-${method}`).send(cart());
    expect(again.body.id).toBe(order.id); // a retried tap doesn't create a second order
    if (method === 'ONLINE') {
      const init = await request(app).post(`/v1/orders/${order.id}/payments`).set(as(name)).set('Idempotency-Key', `pay-${method}`).send();
      expect(init.body).toMatchObject({ isTestPayment: true, amountKobo: total });
      mock.complete(init.body.reference, 'success');
      const verified = await request(app).post(`/v1/payments/${init.body.reference}/verify`).set(as(name)).send();
      expect(verified.body.orderPaymentStatus).toBe('SUCCESSFUL');
    }
  });

  it('11–13. the restaurant receives, accepts and prepares the order', async () => {
    const r = (p: string) => `/v1/vendor/restaurants/${ctx.restaurantId}/orders${p}`;
    const incoming = await request(app).get(r('')).query({ view: 'incoming' }).set(as('owner'));
    expect(incoming.body.items.map((o: { id: string }) => o.id)).toContain(order.id);
    expect((await request(app).post(r(`/${order.id}/accept`)).set(as('owner')).send({ prepTimeMinutes: 15 })).body.status).toBe('ACCEPTED');
    expect((await request(app).post(r(`/${order.id}/start-preparing`)).set(as('owner')).send()).body.status).toBe('PREPARING');
    expect((await request(app).post(r(`/${order.id}/ready`)).set(as('owner')).send()).body.status).toBe('READY_FOR_PICKUP');
  });

  it('14. the platform assigns an eligible rider', async () => {
    await request(app).put('/v1/rider/availability').set(as('rider.core1')).send({ online: true });
    await services.dispatch.tick();
    const offer = (await request(app).get('/v1/rider/work').set(as('rider.core1'))).body.offer;
    expect(offer.orderCode).toBe(order.code);
    const accepted = await request(app).post(`/v1/rider/offers/${offer.id}/accept`).set(as('rider.core1')).send();
    expect(accepted.body.status).toBe('ASSIGNED');
    order.deliveryId = accepted.body.id;
  });

  it('15. the rider confirms pickup', async () => {
    const res = await request(app).post(`/v1/rider/deliveries/${order.deliveryId}/picked-up`).set(as('rider.core1')).send();
    expect(res.body).toMatchObject({ status: 'PICKED_UP', orderStatus: 'PICKED_UP' });
  });

  it('16–18. the rider delivers; the customer receives it; delivery is completed with the PIN', async () => {
    const wrong = await request(app).post(`/v1/rider/deliveries/${order.deliveryId}/complete`).set(as('rider.core1')).send({ pin: order.pin === '0000' ? '1111' : '0000', ...(method === 'CASH_ON_DELIVERY' ? { cashCollectedKobo: order.total } : {}) });
    expect(wrong.status).toBe(422);
    const done = await request(app).post(`/v1/rider/deliveries/${order.deliveryId}/complete`).set(as('rider.core1')).send({ pin: order.pin, ...(method === 'CASH_ON_DELIVERY' ? { cashCollectedKobo: order.total } : {}) });
    expect(done.body.status).toBe('DELIVERED');
    const mine = await request(app).get(`/v1/orders/${order.id}`).set(as(name));
    expect(mine.body).toMatchObject({ status: 'DELIVERED', deliveryStatus: 'DELIVERED', canReview: true });
    expect(mine.body.timeline.map((h: { status: string }) => h.status)).toEqual(['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED']);
    await request(app).put('/v1/rider/availability').set(as('rider.core1')).send({ online: false });
  });

  it('19. the payment or cash collection is recorded', async () => {
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true, cashCollection: true } });
    expect(o.paymentStatus).toBe('SUCCESSFUL');
    if (method === 'ONLINE') expect(o.payments.filter((p) => p.status === 'SUCCESSFUL')).toHaveLength(1);
    else expect(o.cashCollection).toMatchObject({ status: 'COLLECTED', amountCollectedKobo: total, reconciliationStatus: 'OUTSTANDING' });
  });

  it('20–21. the platform calculates each share, and an administrator can inspect the order and its financial history', async () => {
    const detail = await request(app).get(`/v1/admin/orders/${order.id}`).set(as('finance'));
    expect(detail.status).toBe(200);
    // Restaurant: food − 15% commission. Rider: 80% of the ₦500 fee = ₦400. ChopNow: commission + ₦100 delivery margin + service fee.
    expect(detail.body.financialHistory.split).toEqual({ restaurantKobo: sub - commission, riderKobo: 40_000, platformRevenueKobo: commission + 10_000 + service, platformPromotionCostKobo: 0 });
    const types = detail.body.financialHistory.journals.map((j: { type: string }) => j.type);
    expect(types).toEqual(method === 'ONLINE' ? ['ONLINE_PAYMENT_CAPTURED', 'ORDER_SETTLED'] : ['CASH_COLLECTED', 'ORDER_SETTLED']);
    for (const j of detail.body.financialHistory.journals) {
      const sum = (d: string) => j.lines.filter((l: { direction: string }) => l.direction === d).reduce((s: number, l: { amountKobo: number }) => s + l.amountKobo, 0);
      expect(sum('DEBIT')).toBe(sum('CREDIT'));
    }
    expect(detail.body.financialHistory.journals.at(-1).lines).toEqual(expect.arrayContaining([expect.objectContaining({ account: 'VENDOR_PAYABLE', party: 'Bole & Jollof Joint', amountKobo: sub - commission })]));
    expect(detail.body.financialHistory.restaurantSettlement).toBeNull();
    expect(detail.body.timeline.at(-1)).toMatchObject({ to: 'DELIVERED', actorRole: 'RIDER' });
  });
});

describe('after the journey', () => {
  it('the restaurant’s proceeds are settled and the admin sees which settlement covers the order', async () => {
    t = Date.parse('2026-10-15T11:00:00Z');
    const gen = await request(app).post('/v1/admin/finance/settlements/generate').set(as('finance')).send({ from: '2026-10-14', to: '2026-10-14' });
    expect(gen.body.created).toBeGreaterThanOrEqual(2);
    const s = (await request(app).get('/v1/admin/finance/settlements').query({ kind: 'VENDOR' }).set(as('finance'))).body.items.find((x: { restaurantId: string }) => x.restaurantId === ctx.restaurantId);
    // Two orders: ₦10,800 (online) + ₦5,400 (cash) of food, less 15% commission.
    expect(s).toMatchObject({ orderCount: 2, grossSalesKobo: 1_620_000, commissionKobo: 243_000, netPayableKobo: 1_377_000 });
    const order = await db.order.findFirstOrThrow({ where: { restaurantId: ctx.restaurantId } });
    const detail = await request(app).get(`/v1/admin/orders/${order.id}`).set(as('admin'));
    expect(detail.body.financialHistory.restaurantSettlement).toMatchObject({ id: s.id, from: '2026-10-14', to: '2026-10-14', status: 'DRAFT' });
    const summary = await request(app).get('/v1/admin/finance/summary').query({ from: '2026-10-14', to: '2026-10-14' }).set(as('finance'));
    expect(summary.body.trialBalance.balanced).toBe(true);
  });
});
