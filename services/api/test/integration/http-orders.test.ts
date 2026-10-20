/**
 * Cart validation, server-side pricing, order creation, idempotency, promotions, cash-on-delivery
 * eligibility, cancellation and ownership. Acceptance steps 8–10.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './helpers.js';
import { bearer, buildTestApp, freshSeed, seededEmail, tokenFor } from './http-helpers.js';

const db = createTestDb();
const app = buildTestApp(db);

let ada: string;
let tunde: string;
let adaAddressId: string;
let tundeAddressId: string;
let mama: { id: string };
let bukka: { id: string };
let jollof: { id: string; large: string; regular: string; chicken: string; plantain: string };
let partyJollof: { id: string; regular: string; jumbo: string };
let ofadaId: string;

let keyCounter = 0;
const newKey = () => `test-key-${Date.now()}-${++keyCounter}`;

beforeAll(async () => {
  await freshSeed(db);
  ada = await tokenFor(app, 'ada');
  tunde = await tokenFor(app, 'tunde');
  adaAddressId = (await db.address.findFirstOrThrow({ where: { user: { email: seededEmail('ada') } } })).id;
  tundeAddressId = (await db.address.findFirstOrThrow({ where: { user: { email: seededEmail('tunde') } } })).id;
  mama = await db.restaurant.findUniqueOrThrow({ where: { slug: 'mama-nkechis-kitchen' } });
  bukka = await db.restaurant.findUniqueOrThrow({ where: { slug: 'bukka-republic' } });
  const j = await db.menuItem.findFirstOrThrow({ where: { restaurantId: mama.id, name: 'Jollof Rice' }, include: { variants: true, extras: true } });
  jollof = {
    id: j.id,
    large: j.variants.find((v) => v.name === 'Large')!.id,
    regular: j.variants.find((v) => v.name === 'Regular')!.id,
    chicken: j.extras.find((e) => e.name === 'Fried chicken')!.id,
    plantain: j.extras.find((e) => e.name.startsWith('Fried plantain'))!.id,
  };
  const p = await db.menuItem.findFirstOrThrow({ where: { restaurantId: bukka.id, name: 'Party Jollof Rice' }, include: { variants: true } });
  partyJollof = { id: p.id, regular: p.variants.find((v) => v.name === 'Regular')!.id, jumbo: p.variants.find((v) => v.name === 'Jumbo')!.id };
  ofadaId = (await db.menuItem.findFirstOrThrow({ where: { name: 'Ofada Rice & Ayamase' } })).id;
}, 120_000);
afterAll(() => db.$disconnect());

const jollofOrder = (over: Record<string, unknown> = {}) => ({
  restaurantId: mama.id,
  addressId: adaAddressId,
  paymentMethod: 'CASH_ON_DELIVERY',
  items: [{ menuItemId: jollof.id, variantId: jollof.large, extras: [{ extraId: jollof.chicken, quantity: 1 }], quantity: 1 }],
  ...over,
});

describe('quote: server-side pricing', () => {
  it('prices Large jollof + chicken delivered to Makun from current menu and rules', async () => {
    const res = await request(app).post('/v1/orders/quote').set(bearer(ada)).send(jollofOrder());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      subtotalKobo: 500_000, // ₦3,500 + ₦1,500
      deliveryFeeKobo: 50_000, // within the included 2 km
      serviceFeeKobo: 25_000, // 5% of subtotal
      discountKobo: 0,
      totalKobo: 575_000,
      canPlaceOrder: true,
      cashOnDeliveryAllowed: true,
      problems: [],
    });
    expect(res.body.lines[0]).toMatchObject({ name: 'Jollof Rice', variantName: 'Large', unitPriceKobo: 350_000, lineTotalKobo: 500_000 });
  });

  it('rejects client-supplied prices or totals outright', async () => {
    const res = await request(app).post('/v1/orders/quote').set(bearer(ada)).send({ ...jollofOrder(), totalKobo: 1 });
    expect(res.status).toBe(400);
    const res2 = await request(app)
      .post('/v1/orders/quote')
      .set(bearer(ada))
      .send(jollofOrder({ items: [{ menuItemId: jollof.id, variantId: jollof.large, quantity: 1, unitPriceKobo: 1 }] }));
    expect(res2.status).toBe(400);
  });

  it('reports every cart problem with the line it belongs to', async () => {
    const otherItemsVariant = partyJollof.regular;
    const res = await request(app)
      .post('/v1/orders/quote')
      .set(bearer(ada))
      .send(
        jollofOrder({
          items: [
            { menuItemId: ofadaId, quantity: 1 }, // sold out
            { menuItemId: jollof.id, quantity: 1 }, // variant missing
            { menuItemId: jollof.id, variantId: otherItemsVariant, quantity: 1 }, // variant from another item
            { menuItemId: jollof.id, variantId: jollof.regular, extras: [{ extraId: jollof.chicken, quantity: 3 }], quantity: 1 }, // max 2
            { menuItemId: partyJollof.id, variantId: partyJollof.regular, quantity: 1 }, // other restaurant's item
            { menuItemId: jollof.id, variantId: jollof.regular, quantity: 20 }, // pushes Jollof over 20 in total
          ],
        }),
      );
    expect(res.status).toBe(200);
    expect(res.body.canPlaceOrder).toBe(false);
    const codes = res.body.problems.map((p: { code: string; lineIndex?: number }) => `${p.lineIndex}:${p.code}`);
    expect(codes).toEqual(
      expect.arrayContaining(['0:ITEM_UNAVAILABLE', '1:VARIANT_REQUIRED', '2:VARIANT_INVALID', '3:EXTRA_LIMIT', '4:ITEM_NOT_FOUND', '5:QUANTITY_LIMIT']),
    );
  });

  it('blocks closed or paused restaurants and out-of-range addresses', async () => {
    const suya = await db.restaurant.findUniqueOrThrow({ where: { slug: 'suya-spot-express' }, include: { menuItems: true } });
    const paused = await request(app)
      .post('/v1/orders/quote')
      .set(bearer(ada))
      .send(jollofOrder({ restaurantId: suya.id, items: [{ menuItemId: suya.menuItems[0]!.id, quantity: 1 }] }));
    expect(paused.body.problems.map((p: { code: string }) => p.code)).toContain('RESTAURANT_NOT_ACCEPTING');

    const abuja = await db.address.create({
      data: { userId: (await db.user.findUniqueOrThrow({ where: { email: seededEmail('ada') } })).id, label: 'Abuja', line1: '1 Aminu Kano Crescent', area: 'Wuse', city: 'Abuja', latitude: 9.0765, longitude: 7.3986 },
    });
    const far = await request(app).post('/v1/orders/quote').set(bearer(ada)).send(jollofOrder({ addressId: abuja.id }));
    expect(far.body.problems.map((p: { code: string }) => p.code)).toContain('OUT_OF_DELIVERY_RANGE');
  });

  it('enforces the restaurant minimum order', async () => {
    await db.restaurant.update({ where: { id: mama.id }, data: { minOrderKobo: 1_000_000 } });
    const res = await request(app).post('/v1/orders/quote').set(bearer(ada)).send(jollofOrder());
    await db.restaurant.update({ where: { id: mama.id }, data: { minOrderKobo: 0 } });
    expect(res.body.problems).toEqual([expect.objectContaining({ code: 'BELOW_MINIMUM_ORDER', message: expect.stringContaining('Add ₦5,000 more') })]);
  });

  it("will not price another customer's address (404)", async () => {
    const res = await request(app).post('/v1/orders/quote').set(bearer(tunde)).send(jollofOrder({ addressId: adaAddressId }));
    expect(res.status).toBe(404);
  });
});

describe('cash on delivery eligibility', () => {
  it('caps COD at ₦10,000 for first-time customers (₦20,000 otherwise) but allows online payment', async () => {
    // 3 × Jumbo Party Jollof = ₦13,500 of food: over the first-order cap, under the general cap.
    const order = (addressId: string) => ({ restaurantId: bukka.id, addressId, items: [{ menuItemId: partyJollof.id, variantId: partyJollof.jumbo, quantity: 3 }] });
    const firstTimer = await request(app).post('/v1/orders/quote').set(bearer(tunde)).send({ ...order(tundeAddressId), paymentMethod: 'CASH_ON_DELIVERY' });
    expect(firstTimer.body.totalKobo).toBeGreaterThan(1_000_000);
    expect(firstTimer.body.totalKobo).toBeLessThan(2_000_000);
    expect(firstTimer.body.cashOnDeliveryAllowed).toBe(false);
    expect(firstTimer.body.problems).toEqual([expect.objectContaining({ code: 'COD_NOT_ALLOWED', message: expect.stringContaining('first order') })]);

    const online = await request(app).post('/v1/orders/quote').set(bearer(tunde)).send({ ...order(tundeAddressId), paymentMethod: 'ONLINE' });
    expect(online.body.canPlaceOrder).toBe(true);

    // Ada has a delivered order, so the same basket is fine for cash.
    const returning = await request(app).post('/v1/orders/quote').set(bearer(ada)).send({ ...order(adaAddressId), paymentMethod: 'CASH_ON_DELIVERY' });
    expect(returning.body.cashOnDeliveryAllowed).toBe(true);
  });
});

describe('placing orders', () => {
  let orderId: string;

  it('requires an Idempotency-Key', async () => {
    const res = await request(app).post('/v1/orders').set(bearer(ada)).send(jollofOrder());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('creates a cash order with server-computed amounts, snapshots, PIN and history', async () => {
    const res = await request(app).post('/v1/orders').set(bearer(ada)).set('Idempotency-Key', newKey()).send(jollofOrder({ customerNote: 'Please call on arrival' }));
    expect(res.status).toBe(201);
    orderId = res.body.id;
    expect(res.body).toMatchObject({
      status: 'PLACED',
      paymentMethod: 'CASH_ON_DELIVERY',
      paymentStatus: 'PENDING',
      totalKobo: 575_000,
      sentToRestaurant: true, // cash orders go straight to the restaurant
      canCancel: true,
      canPay: false,
      customerNote: 'Please call on arrival',
    });
    expect(res.body.code).toMatch(/^CN-[2-9A-HJ-NP-TV-Z]{6}$/);
    expect(res.body.deliveryPin).toMatch(/^\d{4}$/);
    expect(res.body.timeline).toEqual([expect.objectContaining({ status: 'PLACED' })]);

    const stored = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(stored).toMatchObject({ commissionBps: 1500, commissionKobo: 75_000, riderEarningKobo: 40_000 });
    expect(stored.acceptDeadlineAt!.getTime() - stored.placedAt.getTime()).toBe(600_000);
  });

  it('keeps the price charged even if the menu price changes later', async () => {
    await db.menuItemVariant.update({ where: { id: jollof.large }, data: { priceKobo: 999_900 } });
    const res = await request(app).get(`/v1/orders/${orderId}`).set(bearer(ada));
    await db.menuItemVariant.update({ where: { id: jollof.large }, data: { priceKobo: 350_000 } });
    expect(res.body.items[0]).toMatchObject({ name: 'Jollof Rice', variantName: 'Large', unitPriceKobo: 350_000, lineTotalKobo: 500_000 });
    expect(res.body.items[0].extras).toEqual([{ name: 'Fried chicken', unitPriceKobo: 150_000, quantity: 1 }]);
  });

  it('refuses to create an order that has problems', async () => {
    const res = await request(app)
      .post('/v1/orders')
      .set(bearer(ada))
      .set('Idempotency-Key', newKey())
      .send(jollofOrder({ items: [{ menuItemId: ofadaId, quantity: 1 }] }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORDER_NOT_PLACEABLE');
    expect(res.body.error.details[0].code).toBe('ITEM_UNAVAILABLE');
  });
});

describe('duplicate submissions', () => {
  it('replays the same order for a retried request with the same key', async () => {
    const key = newKey();
    const before = await db.order.count();
    const first = await request(app).post('/v1/orders').set(bearer(ada)).set('Idempotency-Key', key).send(jollofOrder());
    const second = await request(app).post('/v1/orders').set(bearer(ada)).set('Idempotency-Key', key).send(jollofOrder());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(await db.order.count()).toBe(before + 1);
  });

  it('rejects reuse of a key for a different request', async () => {
    const key = newKey();
    await request(app).post('/v1/orders').set(bearer(ada)).set('Idempotency-Key', key).send(jollofOrder());
    const res = await request(app)
      .post('/v1/orders')
      .set(bearer(ada))
      .set('Idempotency-Key', key)
      .send(jollofOrder({ items: [{ menuItemId: jollof.id, variantId: jollof.regular, quantity: 2 }] }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('creates exactly one order when the same request arrives several times at once', async () => {
    const key = newKey();
    const before = await db.order.count();
    const results = await Promise.all([1, 2, 3, 4].map(() => request(app).post('/v1/orders').set(bearer(ada)).set('Idempotency-Key', key).send(jollofOrder())));
    expect(await db.order.count()).toBe(before + 1);
    const ids = new Set(results.filter((r) => r.status === 201).map((r) => r.body.id));
    expect(ids.size).toBe(1);
    for (const r of results) expect([201, 409]).toContain(r.status);
  });

  it('lets a failed attempt be retried with the same key', async () => {
    const key = newKey();
    await db.restaurant.update({ where: { id: mama.id }, data: { isAcceptingOrders: false } });
    const failed = await request(app).post('/v1/orders').set(bearer(ada)).set('Idempotency-Key', key).send(jollofOrder());
    await db.restaurant.update({ where: { id: mama.id }, data: { isAcceptingOrders: true } });
    expect(failed.status).toBe(422);
    const retried = await request(app).post('/v1/orders').set(bearer(ada)).set('Idempotency-Key', key).send(jollofOrder());
    expect(retried.status).toBe(201);
  });
});

describe('promotions', () => {
  it('applies WELCOME10 once per customer; cancelling frees it again', async () => {
    const quote = await request(app).post('/v1/orders/quote').set(bearer(tunde)).send({
      restaurantId: mama.id,
      addressId: tundeAddressId,
      paymentMethod: 'CASH_ON_DELIVERY',
      promoCode: 'welcome10',
      items: [{ menuItemId: jollof.id, variantId: jollof.large, extras: [{ extraId: jollof.chicken, quantity: 1 }], quantity: 1 }],
    });
    expect(quote.body).toMatchObject({ discountKobo: 50_000, promotion: { code: 'WELCOME10' } });
    expect(quote.body.totalKobo).toBe(quote.body.subtotalKobo + quote.body.deliveryFeeKobo + quote.body.serviceFeeKobo - 50_000);

    const body = { restaurantId: mama.id, addressId: tundeAddressId, paymentMethod: 'CASH_ON_DELIVERY', promoCode: 'WELCOME10', items: [{ menuItemId: jollof.id, variantId: jollof.large, quantity: 2 }] };
    const first = await request(app).post('/v1/orders').set(bearer(tunde)).set('Idempotency-Key', newKey()).send(body);
    expect(first.status).toBe(201);
    expect(first.body.discountKobo).toBe(70_000); // 10% of ₦7,000

    const again = await request(app).post('/v1/orders/quote').set(bearer(tunde)).send(body);
    expect(again.body.problems).toEqual([expect.objectContaining({ code: 'PROMO_INVALID', message: expect.stringMatching(/already used/) })]);

    await request(app).post(`/v1/orders/${first.body.id}/cancel`).set(bearer(tunde)).send({ reason: 'Changed my mind' });
    const afterCancel = await request(app).post('/v1/orders/quote').set(bearer(tunde)).send(body);
    expect(afterCancel.body.canPlaceOrder).toBe(true);
  });

  it('caps the discount and validates minimum spend', async () => {
    const big = await request(app).post('/v1/orders/quote').set(bearer(ada)).send(jollofOrder({ promoCode: 'WELCOME10', items: [{ menuItemId: jollof.id, variantId: jollof.large, quantity: 10 }] }));
    expect(big.body.discountKobo).toBe(100_000); // 10% of ₦35,000 would be ₦3,500; capped at ₦1,000
    const chapman = await db.menuItem.findFirstOrThrow({ where: { name: 'Chapman' } });
    const small = await request(app).post('/v1/orders/quote').set(bearer(ada)).send(jollofOrder({ promoCode: 'WELCOME10', items: [{ menuItemId: chapman.id, quantity: 1 }] }));
    expect(small.body.problems[0]).toMatchObject({ code: 'PROMO_INVALID' });
    const bogus = await request(app).post('/v1/orders/quote').set(bearer(ada)).send(jollofOrder({ promoCode: 'NOPE123' }));
    expect(bogus.body.problems[0]).toMatchObject({ code: 'PROMO_INVALID' });
  });
});

describe('viewing, cancelling, reordering', () => {
  let orderId: string;
  beforeAll(async () => {
    const res = await request(app).post('/v1/orders').set(bearer(ada)).set('Idempotency-Key', newKey()).send(jollofOrder());
    orderId = res.body.id;
  });

  it("customers only see their own orders", async () => {
    expect((await request(app).get(`/v1/orders/${orderId}`).set(bearer(tunde))).status).toBe(404);
    expect((await request(app).post(`/v1/orders/${orderId}/cancel`).set(bearer(tunde)).send({})).status).toBe(404);
    expect((await request(app).get(`/v1/orders/${orderId}/reorder`).set(bearer(tunde))).status).toBe(404);
    const tundeList = await request(app).get('/v1/orders').set(bearer(tunde));
    expect(tundeList.body.items.map((o: { id: string }) => o.id)).not.toContain(orderId);
    const adaList = await request(app).get('/v1/orders').query({ status: 'active' }).set(bearer(ada));
    expect(adaList.body.items.map((o: { id: string }) => o.id)).toContain(orderId);
  });

  it('staff and vendors cannot use the customer order endpoints', async () => {
    const vendor = await tokenFor(app, 'vendor.mamankechi');
    expect((await request(app).post('/v1/orders').set(bearer(vendor)).set('Idempotency-Key', newKey()).send(jollofOrder())).status).toBe(403);
  });

  it('cancels while PLACED, records history, and cannot cancel twice', async () => {
    const res = await request(app).post(`/v1/orders/${orderId}/cancel`).set(bearer(ada)).send({ reason: 'Ordered by mistake' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', canCancel: false, cancellationReason: 'Ordered by mistake' });
    expect(res.body.timeline.map((t: { status: string }) => t.status)).toEqual(['PLACED', 'CANCELLED']);
    const again = await request(app).post(`/v1/orders/${orderId}/cancel`).set(bearer(ada)).send({});
    expect(again.status).toBe(409);
    expect(await db.auditLog.count({ where: { action: 'order.cancel', entityId: orderId } })).toBe(1);
  });

  it('cannot cancel once the restaurant has accepted', async () => {
    const res = await request(app).post('/v1/orders').set(bearer(ada)).set('Idempotency-Key', newKey()).send(jollofOrder());
    await db.order.update({ where: { id: res.body.id }, data: { status: 'ACCEPTED' } });
    const cancel = await request(app).post(`/v1/orders/${res.body.id}/cancel`).set(bearer(ada)).send({});
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('CANNOT_CANCEL');
  });

  it('reorder rebuilds the cart at current prices and lists what is unavailable', async () => {
    await db.menuItemExtra.update({ where: { id: jollof.chicken }, data: { isAvailable: false } });
    const res = await request(app).get(`/v1/orders/${orderId}/reorder`).set(bearer(ada));
    await db.menuItemExtra.update({ where: { id: jollof.chicken }, data: { isAvailable: true } });
    expect(res.status).toBe(200);
    expect(res.body.lines).toEqual([expect.objectContaining({ menuItemId: jollof.id, variantId: jollof.large, extras: [], unitPriceKobo: 350_000, quantity: 1 })]);
    expect(res.body.unavailable).toEqual([{ name: 'Fried chicken (extra)', reason: 'Unavailable' }]);
  });
});
