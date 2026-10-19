/**
 * Rider dispatch and delivery (acceptance steps 15–19): tiered offers with timeouts, acceptance
 * races, privacy before/after acceptance, pickup and PIN proof, cash collection with ledger and
 * outstanding-cash limits, release and problem reports, and the operations alert.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../../src/modules/payments/mock.js';
import { closeUnfulfilledOrder } from '../../src/modules/orders/order-closure.js';
import { createTestDb } from './helpers.js';
import { LAGOS_NOON, bearer, buildTestHarness, freshSeed, seededEmail, tokenFor, expectNoPin } from './http-helpers.js';

const db = createTestDb();
let t = LAGOS_NOON.getTime();
const clock = () => new Date(t);
const advance = (seconds: number) => {
  t += seconds * 1000;
};
const harness = buildTestHarness(db, { clock });
const { app, services } = harness;
const mock = services.paymentProvider as MockPaymentProvider;

const tok: Record<string, string> = {};
let mamaId: string;
let mamaPos: { latitude: number; longitude: number };
let addressId: string;
let jollof: { id: string; large: string };
let n = 0;
const key = () => `dispatch-test-${Date.now()}-${++n}`;
const riderId = async (name: string) => (await db.rider.findFirstOrThrow({ where: { user: { email: seededEmail(name) } } })).id;

async function placeAndAccept(paymentMethod: 'CASH_ON_DELIVERY' | 'ONLINE' = 'CASH_ON_DELIVERY') {
  const res = await request(app)
    .post('/v1/orders')
    .set(bearer(tok.ada!))
    .set('Idempotency-Key', key())
    .send({ restaurantId: mamaId, addressId, paymentMethod, items: [{ menuItemId: jollof.id, variantId: jollof.large, quantity: 1 }] });
  expect(res.status).toBe(201);
  if (paymentMethod === 'ONLINE') {
    const init = await request(app).post(`/v1/orders/${res.body.id}/payments`).set(bearer(tok.ada!)).set('Idempotency-Key', key()).send();
    mock.complete(init.body.reference, 'success');
    await request(app).post(`/v1/payments/${init.body.reference}/verify`).set(bearer(tok.ada!)).send();
  }
  const acc = await request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${res.body.id}/accept`).set(bearer(tok.mama!)).send({ prepTimeMinutes: 15 });
  expect(acc.status).toBe(200);
  const delivery = await db.delivery.findUniqueOrThrow({ where: { orderId: res.body.id } });
  return { orderId: res.body.id as string, code: res.body.code as string, pin: res.body.deliveryPin as string, total: res.body.totalKobo as number, deliveryId: delivery.id };
}

const markReady = (orderId: string) => request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${orderId}/ready`).set(bearer(tok.mama!)).send();
const work = (name: string) => request(app).get('/v1/rider/work').set(bearer(tok[name]!));
const goOnline = async (name: string, pos?: { latitude: number; longitude: number }) => {
  expect((await request(app).put('/v1/rider/availability').set(bearer(tok[name]!)).send({ online: true })).status).toBe(200);
  if (pos) await request(app).put('/v1/rider/location').set(bearer(tok[name]!)).send(pos);
};
const goOffline = (name: string) => request(app).put('/v1/rider/availability').set(bearer(tok[name]!)).send({ online: false });
const accept = (name: string, offerId: string) => request(app).post(`/v1/rider/offers/${offerId}/accept`).set(bearer(tok[name]!)).send();
const step = (name: string, deliveryId: string, action: string, body: object = {}) => request(app).post(`/v1/rider/deliveries/${deliveryId}/${action}`).set(bearer(tok[name]!)).send(body);
const offerFor = async (name: string) => (await work(name)).body.offer as { id: string; deliveryId: string } | null;

/** Positions around Mama Nkechi's: core1 300 m away, core2 1.5 km away. */
const near = () => ({ latitude: mamaPos.latitude + 0.0027, longitude: mamaPos.longitude });
const far = () => ({ latitude: mamaPos.latitude + 0.0135, longitude: mamaPos.longitude });

beforeAll(async () => {
  await freshSeed(db);
  for (const name of ['ada', 'tunde', 'vendor.mamankechi', 'rider.core1', 'rider.core2', 'rider.indie1', 'rider.pending']) tok[name] = await tokenFor(app, name);
  tok.mama = tok['vendor.mamankechi']!;
  const mama = await db.restaurant.findUniqueOrThrow({ where: { slug: 'mama-nkechis-kitchen' } });
  mamaId = mama.id;
  mamaPos = { latitude: mama.latitude!, longitude: mama.longitude! };
  addressId = (await db.address.findFirstOrThrow({ where: { user: { email: seededEmail('ada') } } })).id;
  const j = await db.menuItem.findFirstOrThrow({ where: { restaurantId: mamaId, name: 'Jollof Rice' }, include: { variants: true } });
  jollof = { id: j.id, large: j.variants.find((x) => x.name === 'Large')!.id };
}, 120_000);
afterAll(() => db.$disconnect());

/** Every rider offline and no delivery waiting (seeded sample orders included); time moves on 10 minutes. */
async function resetDispatchState() {
  advance(600);
  await db.deliveryOffer.updateMany({ where: { status: 'PENDING' }, data: { status: 'CANCELLED' } });
  await db.delivery.updateMany({ where: { status: { in: ['UNASSIGNED', 'OFFERING'] } }, data: { status: 'CANCELLED' } });
  await db.rider.updateMany({ data: { availability: 'OFFLINE', lastSeenAt: null, lastLatitude: null, lastLongitude: null, cashLimitKoboOverride: null } });
}

describe('going online', () => {
  beforeEach(resetDispatchState);

  it('only approved riders can go online; pending riders can still see their profile', async () => {
    const res = await request(app).put('/v1/rider/availability').set(bearer(tok['rider.pending']!)).send({ online: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RIDER_NOT_APPROVED');
    const me = await request(app).get('/v1/rider/me').set(bearer(tok['rider.pending']!));
    expect(me.body).toMatchObject({ verificationStatus: 'PENDING', availability: 'OFFLINE' });
  });

  it('stores the latest position only while online', async () => {
    const id = await riderId('rider.core2');
    await request(app).put('/v1/rider/location').set(bearer(tok['rider.core2']!)).send(near());
    expect((await db.rider.findUniqueOrThrow({ where: { id } })).lastLatitude).toBeNull();
    await goOnline('rider.core2', near());
    expect((await db.rider.findUniqueOrThrow({ where: { id } })).lastLatitude).toBeCloseTo(near().latitude, 6);
  });

  it('customers and restaurants cannot use rider endpoints', async () => {
    expect((await request(app).get('/v1/rider/work').set(bearer(tok.ada!))).status).toBe(403);
    expect((await request(app).put('/v1/rider/availability').set(bearer(tok.mama!)).send({ online: true })).status).toBe(403);
  });
});

describe('offers', () => {
  beforeEach(resetDispatchState);

  it('starts dispatch on acceptance and offers the nearest core rider first, showing only the drop-off area', async () => {
    await goOnline('rider.core2', far());
    await goOnline('rider.core1', near());
    await goOnline('rider.indie1', near());
    const o = await placeAndAccept();

    const d = await db.delivery.findUniqueOrThrow({ where: { id: o.deliveryId }, include: { cashCollection: true } });
    expect(d).toMatchObject({ status: 'OFFERING', cashToCollectKobo: o.total });
    expect(d.cashCollection).toMatchObject({ amountDueKobo: o.total, status: 'PENDING', reconciliationStatus: 'NOT_DUE' });

    const offer = (await work('rider.core1')).body.offer;
    expect(offer).toMatchObject({ deliveryId: o.deliveryId, orderCode: o.code, dropoffArea: 'Yaba', cashToCollectKobo: o.total, earningKobo: 40_000 });
    expect(offer.distanceToRestaurantMeters).toBeGreaterThan(200);
    expect(Date.parse(offer.expiresAt) - t).toBe(45_000);
    const raw = JSON.stringify(offer);
    expectNoPin(raw, o.pin);
    const home = await db.address.findUniqueOrThrow({ where: { id: addressId } });
    expect(raw).not.toContain(home.line1);
    expect(raw).not.toMatch(/\+234|line1|contactPhone|customerFirstName/);
    expect((await work('rider.core2')).body.offer).toBeNull();
    expect((await work('rider.indie1')).body.offer).toBeNull();

    const vendorView = await request(app).get(`/v1/vendor/restaurants/${mamaId}/orders/${o.orderId}`).set(bearer(tok.mama!));
    expect(vendorView.body).toMatchObject({ deliveryStatus: 'OFFERING', rider: null });
  });

  it('moves to the next rider when an offer expires, and adds independent riders after two minutes', async () => {
    await goOnline('rider.core1', near());
    await goOnline('rider.indie1', near());
    const o = await placeAndAccept();
    expect((await offerFor('rider.core1'))?.deliveryId).toBe(o.deliveryId);

    advance(46);
    await work('rider.indie1'); // still reachable
    await services.dispatch.tick();
    // Only one core rider is online and they let it expire: nobody else is eligible yet.
    expect(await offerFor('rider.core1')).toBeNull();
    expect(await offerFor('rider.indie1')).toBeNull();

    advance(80);
    await work('rider.indie1');
    await work('rider.core1');
    await services.dispatch.tick();
    expect((await offerFor('rider.indie1'))?.deliveryId).toBe(o.deliveryId);
    const d = await db.delivery.findUniqueOrThrow({ where: { id: o.deliveryId } });
    expect(d.widenedAt).not.toBeNull();
    expect(await db.deliveryOffer.count({ where: { deliveryId: o.deliveryId, status: 'EXPIRED' } })).toBe(1);
  });

  it('a decline goes straight to the next rider, and the decliner is not asked again', async () => {
    await goOnline('rider.core1', near());
    await goOnline('rider.core2', far());
    const o = await placeAndAccept();
    const first = (await offerFor('rider.core1'))!;
    const dec = await request(app).post(`/v1/rider/offers/${first.id}/decline`).set(bearer(tok['rider.core1']!)).send({ reason: 'TOO_FAR' });
    expect(dec.status).toBe(200);
    expect((await offerFor('rider.core2'))?.deliveryId).toBe(o.deliveryId);
    await request(app).post(`/v1/rider/offers/${(await offerFor('rider.core2'))!.id}/decline`).set(bearer(tok['rider.core2']!)).send({});
    advance(10);
    await work('rider.core1');
    await services.dispatch.tick();
    expect(await offerFor('rider.core1')).toBeNull();
  });

  it('a rider cannot accept an expired offer or someone else’s offer', async () => {
    await goOnline('rider.core1', near());
    await placeAndAccept();
    const offer = (await offerFor('rider.core1'))!;
    await goOnline('rider.core2', far());
    expect((await accept('rider.core2', offer.id)).status).toBe(404);
    advance(46);
    const late = await accept('rider.core1', offer.id);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('OFFER_UNAVAILABLE');
  });

  it('going offline withdraws a pending offer and passes it on', async () => {
    await goOnline('rider.core1', near());
    await goOnline('rider.core2', far());
    const o = await placeAndAccept();
    expect((await offerFor('rider.core1'))?.deliveryId).toBe(o.deliveryId);
    await goOffline('rider.core1');
    expect((await offerFor('rider.core2'))?.deliveryId).toBe(o.deliveryId);
  });

  it('a rider gets one offer at a time, and concurrent sweeps never double-offer', async () => {
    await goOnline('rider.core1', near());
    const a = await placeAndAccept();
    const b = await placeAndAccept();
    await Promise.all([services.dispatch.tick(), services.dispatch.tick(), services.dispatch.tick()]);
    const pending = await db.deliveryOffer.findMany({ where: { status: 'PENDING', deliveryId: { in: [a.deliveryId, b.deliveryId] } } });
    expect(pending).toHaveLength(1);
  });

  it('alerts operations once when nobody accepts within ten minutes', async () => {
    const o = await placeAndAccept();
    advance(601);
    await services.dispatch.tick();
    await services.dispatch.tick();
    expect((await db.delivery.findUniqueOrThrow({ where: { id: o.deliveryId } })).dispatchAlertAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: 'dispatch.unassigned_alert', entityId: o.deliveryId } })).toBe(1);
  });

  it('riders at their cash limit get online-paid offers but not cash ones', async () => {
    await db.rider.update({ where: { id: await riderId('rider.core1') }, data: { cashLimitKoboOverride: 0 } }); // already at the limit
    await goOnline('rider.core1', near());
    const cash = await placeAndAccept('CASH_ON_DELIVERY');
    expect(await offerFor('rider.core1')).toBeNull();
    await db.delivery.update({ where: { id: cash.deliveryId }, data: { status: 'CANCELLED' } });
    const online = await placeAndAccept('ONLINE');
    expect((await offerFor('rider.core1'))?.deliveryId).toBe(online.deliveryId);
  });

  it('a long queue of jobs a rider cannot take does not hide a later one they can (no head-of-line starvation)', async () => {
    // 51 cash jobs wait while core1 is offline; then core1 comes online already at the cash limit.
    const cash = [];
    for (let i = 0; i < 51; i++) cash.push(await placeAndAccept('CASH_ON_DELIVERY'));
    const online = await placeAndAccept('ONLINE'); // the 52nd waiting job, the only one core1 may take
    await db.rider.update({ where: { id: await riderId('rider.core1') }, data: { cashLimitKoboOverride: 0 } });
    await goOnline('rider.core1', near());
    await services.dispatch.tick();
    expect((await offerFor('rider.core1'))?.deliveryId).toBe(online.deliveryId);
    expect(cash).toHaveLength(51);
  }, 120_000);

  it('cancelling an order withdraws its offers', async () => {
    await goOnline('rider.core1', near());
    const o = await placeAndAccept();
    expect(await offerFor('rider.core1')).not.toBeNull();
    const order = await db.order.findUniqueOrThrow({ where: { id: o.orderId } });
    await db.$transaction((tx) => closeUnfulfilledOrder(tx, { order, to: 'CANCELLED', actor: { userId: null, role: 'OPERATIONS' }, reason: 'Test cancellation' }));
    expect(await offerFor('rider.core1')).toBeNull();
    expect((await db.delivery.findUniqueOrThrow({ where: { id: o.deliveryId } })).status).toBe('CANCELLED');
  });
});

describe('a cash delivery from offer to doorstep', () => {
  let o: Awaited<ReturnType<typeof placeAndAccept>>;
  let core1: string;

  beforeAll(async () => {
    await resetDispatchState();
    await goOnline('rider.core1', near());
    o = await placeAndAccept();
    core1 = await riderId('rider.core1');
  });

  it('accepting assigns the rider and reveals the full address to them only', async () => {
    const offer = (await offerFor('rider.core1'))!;
    const res = await accept('rider.core1', offer.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ASSIGNED', orderCode: o.code, cashToCollectKobo: o.total, foodReady: false, actions: ['arrived', 'picked_up', 'release'] });
    expect(res.body.dropoff).toMatchObject({ customerFirstName: 'Ada', area: 'Yaba' });
    expect(res.body.dropoff.line1).toBeTruthy();
    expectNoPin(res.body, o.pin);

    const customer = await request(app).get(`/v1/orders/${o.orderId}`).set(bearer(tok.ada!));
    expect(customer.body).toMatchObject({ deliveryStatus: 'ASSIGNED', rider: { firstName: 'Chinedu', vehicleType: 'MOTORCYCLE' } });
    expect(JSON.stringify(customer.body.rider)).not.toMatch(/\+234|LAG-/);
    expect((await db.cashCollection.findUniqueOrThrow({ where: { deliveryId: o.deliveryId } })).riderId).toBe(core1);
  });

  it('another rider cannot see or act on it, and the busy rider gets no new offers', async () => {
    await goOnline('rider.core2', far());
    expect((await step('rider.core2', o.deliveryId, 'arrived')).status).toBe(404);
    await placeAndAccept();
    expect(await offerFor('rider.core1')).toBeNull();
    // Even a forced offer can't give a rider two active deliveries (database unique index).
    const other = await db.delivery.findFirstOrThrow({ where: { status: 'OFFERING' } });
    await db.deliveryOffer.updateMany({ where: { deliveryId: other.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    const forced = await db.deliveryOffer.create({ data: { deliveryId: other.id, riderId: core1, tier: 'CORE', offeredAt: clock(), expiresAt: new Date(t + 45_000) } });
    const res = await accept('rider.core1', forced.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_ON_DELIVERY');
    await db.delivery.update({ where: { id: other.id }, data: { status: 'CANCELLED' } });
  });

  it('pickup waits for the restaurant to mark the food ready', async () => {
    expect((await step('rider.core1', o.deliveryId, 'arrived')).body.status).toBe('ARRIVED_AT_RESTAURANT');
    const early = await step('rider.core1', o.deliveryId, 'picked-up');
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('FOOD_NOT_READY');
    expect((await markReady(o.orderId)).status).toBe(200);
    const res = await step('rider.core1', o.deliveryId, 'picked-up');
    expect(res.body).toMatchObject({ status: 'PICKED_UP', orderStatus: 'PICKED_UP', actions: ['complete', 'report_problem'] });
  });

  it('a wrong PIN is refused and counted; short cash is refused', async () => {
    const wrong = o.pin === '0000' ? '1111' : '0000';
    const bad = await step('rider.core1', o.deliveryId, 'complete', { pin: wrong, cashCollectedKobo: o.total });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatchObject({ code: 'INVALID_PIN', details: { attemptsLeft: 4 } });
    expect((await db.delivery.findUniqueOrThrow({ where: { id: o.deliveryId } })).pinFailedAttempts).toBe(1);

    const short = await step('rider.core1', o.deliveryId, 'complete', { pin: o.pin, cashCollectedKobo: o.total - 100 });
    expect(short.status).toBe(422);
    expect(short.body.error.code).toBe('CASH_AMOUNT_SHORT');
    const missing = await step('rider.core1', o.deliveryId, 'complete', { pin: o.pin });
    expect(missing.status).toBe(400);
  });

  it('the right PIN and full cash complete it: cash held by the rider is on the ledger, and the earning is recorded', async () => {
    const res = await step('rider.core1', o.deliveryId, 'complete', { pin: o.pin, cashCollectedKobo: o.total });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'DELIVERED', actions: [], dropoff: null });

    const order = await db.order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(order).toMatchObject({ status: 'DELIVERED', paymentStatus: 'SUCCESSFUL' });
    expect(await db.cashCollection.findUniqueOrThrow({ where: { deliveryId: o.deliveryId } })).toMatchObject({ status: 'COLLECTED', amountCollectedKobo: o.total, reconciliationStatus: 'OUTSTANDING', riderId: core1 });

    const journal = await db.financialTransaction.findUniqueOrThrow({ where: { idempotencyKey: `cash:${(await db.cashCollection.findUniqueOrThrow({ where: { deliveryId: o.deliveryId } })).id}:collected` }, include: { entries: true } });
    expect(journal.type).toBe('CASH_COLLECTED');
    expect(journal.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: 'RIDER_CASH_HELD', direction: 'DEBIT', amountKobo: o.total, riderId: core1 }),
        expect.objectContaining({ account: 'CUSTOMER_ORDER_FUNDS', direction: 'CREDIT', amountKobo: o.total }),
      ]),
    );
    expect(await db.riderEarning.findMany({ where: { deliveryId: o.deliveryId } })).toEqual([expect.objectContaining({ type: 'DELIVERY_FEE', amountKobo: order.riderEarningKobo, status: 'CALCULATED' })]);

    const again = await step('rider.core1', o.deliveryId, 'complete', { pin: o.pin, cashCollectedKobo: o.total });
    expect(again.status).toBe(409);
    expect(await db.riderEarning.count({ where: { deliveryId: o.deliveryId } })).toBe(1);
  });

  it('afterwards the rider sees only the area, and their profile, history and earnings add up', async () => {
    const me = await request(app).get('/v1/rider/me').set(bearer(tok['rider.core1']!));
    expect(me.body.outstandingCashKobo).toBeGreaterThanOrEqual(o.total);
    expect(me.body.todayEarningsKobo).toBeGreaterThanOrEqual(40_000);

    const history = await request(app).get('/v1/rider/deliveries').set(bearer(tok['rider.core1']!));
    const item = history.body.items.find((d: { id: string }) => d.id === o.deliveryId);
    expect(item).toMatchObject({ status: 'DELIVERED', dropoffArea: 'Yaba', cashCollectedKobo: o.total, earningKobo: 40_000 });
    expect(JSON.stringify(history.body)).not.toMatch(/line1|contactPhone/);

    const day = new Date(t + 3_600_000).toISOString().slice(0, 10);
    const earnings = await request(app).get('/v1/rider/earnings').query({ from: day, to: day }).set(bearer(tok['rider.core1']!));
    expect(earnings.status).toBe(200);
    expect(earnings.body.deliveries).toBeGreaterThanOrEqual(1);
    expect(earnings.body.days).toHaveLength(1);
  });

  it('the customer can now rate the rider too', async () => {
    const res = await request(app).post(`/v1/orders/${o.orderId}/review`).set(bearer(tok.ada!)).send({ restaurantRating: 5, riderRating: 4 });
    expect(res.status).toBe(201);
    expect(await db.rider.findUniqueOrThrow({ where: { id: core1 } })).toMatchObject({ ratingAverage: 4, ratingCount: 1 });
  });
});

describe('when things go wrong', () => {
  beforeEach(resetDispatchState);

  async function assignedTo(name: string, method: 'CASH_ON_DELIVERY' | 'ONLINE' = 'CASH_ON_DELIVERY') {
    await goOnline(name, near());
    const o = await placeAndAccept(method);
    const offer = (await offerFor(name))!;
    expect((await accept(name, offer.id)).status).toBe(200);
    return o;
  }

  it('releasing before pickup re-offers the job to someone else and records why', async () => {
    const o = await assignedTo('rider.core1');
    await goOnline('rider.core2', far());
    const res = await step('rider.core1', o.deliveryId, 'release', { reason: 'VEHICLE_ISSUE', note: 'Flat tyre' });
    expect(res.status).toBe(200);
    expect((await offerFor('rider.core2'))?.deliveryId).toBe(o.deliveryId);
    expect((await work('rider.core1')).body.delivery).toBeNull();
    expect(await db.auditLog.count({ where: { action: 'delivery.release', entityId: o.deliveryId } })).toBe(1);
    expect((await db.cashCollection.findUniqueOrThrow({ where: { deliveryId: o.deliveryId } })).riderId).toBeNull();
  });

  it('online-paid deliveries take no cash', async () => {
    const o = await assignedTo('rider.core1', 'ONLINE');
    await markReady(o.orderId);
    await step('rider.core1', o.deliveryId, 'picked-up');
    const res = await step('rider.core1', o.deliveryId, 'complete', { pin: o.pin, cashCollectedKobo: 5000 });
    expect(res.body.error.code).toBe('NO_CASH_DUE');
    expect((await step('rider.core1', o.deliveryId, 'complete', { pin: o.pin })).body.status).toBe('DELIVERED');
    expect(await db.cashCollection.count({ where: { deliveryId: o.deliveryId } })).toBe(0);
  });

  it('locks proof of delivery after five wrong PINs', async () => {
    const o = await assignedTo('rider.core1');
    await markReady(o.orderId);
    await step('rider.core1', o.deliveryId, 'picked-up');
    const wrong = o.pin === '0000' ? '1111' : '0000';
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) codes.push((await step('rider.core1', o.deliveryId, 'complete', { pin: wrong, cashCollectedKobo: o.total })).body.error.code);
    expect(codes).toEqual(['INVALID_PIN', 'INVALID_PIN', 'INVALID_PIN', 'INVALID_PIN', 'PIN_LOCKED']);
    const right = await step('rider.core1', o.deliveryId, 'complete', { pin: o.pin, cashCollectedKobo: o.total });
    expect(right.status).toBe(423);
    expect(await db.auditLog.count({ where: { action: 'delivery.pin_locked', entityId: o.deliveryId } })).toBe(1);
  });

  it('a problem after pickup hands the order to operations and takes the rider offline', async () => {
    const o = await assignedTo('rider.core2');
    await markReady(o.orderId);
    await step('rider.core2', o.deliveryId, 'picked-up');
    const res = await step('rider.core2', o.deliveryId, 'problem', { reason: 'CUSTOMER_UNREACHABLE', note: 'Called 3 times' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'FAILED', failureReason: 'Customer could not be reached: Called 3 times' });
    expect((await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe('DELIVERY_EXCEPTION');
    expect((await db.rider.findUniqueOrThrow({ where: { id: await riderId('rider.core2') } })).availability).toBe('OFFLINE');
    expect((await db.cashCollection.findUniqueOrThrow({ where: { deliveryId: o.deliveryId } })).status).toBe('NOT_COLLECTED');
    expect(await db.auditLog.count({ where: { action: 'delivery.problem', entityId: o.deliveryId } })).toBe(1);
  });
});

describe('rider documents', () => {
  it('a pending rider can upload a licence; it is stored privately and listed back', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const res = await request(app).post('/v1/rider/documents').set(bearer(tok['rider.pending']!)).field('type', 'DRIVERS_LICENCE').attach('file', pdf, 'licence.pdf');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'DRIVERS_LICENCE', status: 'PENDING', mimeType: 'application/pdf' });
    const list = await request(app).get('/v1/rider/documents').set(bearer(tok['rider.pending']!));
    expect(list.body.items).toHaveLength(1);
    const wrongType = await request(app).post('/v1/rider/documents').set(bearer(tok['rider.pending']!)).field('type', 'CAC_CERTIFICATE').attach('file', pdf, 'cac.pdf');
    expect(wrongType.status).toBe(400);
  });
});
