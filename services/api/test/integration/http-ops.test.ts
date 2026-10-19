/**
 * Operations (admin dashboard API, Phase 9): dashboard, order search and detail, staff fixes
 * (cancel, retry delivery, confirm without PIN), manual dispatch, users and staff accounts,
 * document review, promotions, review moderation and the audit log.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../../src/modules/payments/mock.js';
import { createTestDb } from './helpers.js';
import { LAGOS_NOON, bearer, buildTestHarness, freshSeed, seededEmail, tokenFor } from './http-helpers.js';

const db = createTestDb();
let t = LAGOS_NOON.getTime();
const clock = () => new Date(t);
const harness = buildTestHarness(db, { clock });
const { app, services } = harness;
const mock = services.paymentProvider as MockPaymentProvider;
const tok: Record<string, string> = {};
const as = (name: string) => bearer(tok[name]!);
let mamaId: string;
let addressId: string;
let jollof: { id: string; large: string };
let n = 0;
const key = () => `ops-test-${Date.now()}-${++n}`;
const A = '/v1/admin';

async function placeAndAccept(method: 'ONLINE' | 'CASH_ON_DELIVERY' = 'CASH_ON_DELIVERY') {
  const res = await request(app).post('/v1/orders').set(as('ada')).set('Idempotency-Key', key()).send({ restaurantId: mamaId, addressId, paymentMethod: method, items: [{ menuItemId: jollof.id, variantId: jollof.large, quantity: 1 }] });
  expect(res.status).toBe(201);
  if (method === 'ONLINE') {
    const init = await request(app).post(`/v1/orders/${res.body.id}/payments`).set(as('ada')).set('Idempotency-Key', key()).send();
    mock.complete(init.body.reference, 'success');
    await request(app).post(`/v1/payments/${init.body.reference}/verify`).set(as('ada')).send();
  }
  await request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${res.body.id}/accept`).set(as('vendor.mamankechi')).send({});
  const delivery = await db.delivery.findUniqueOrThrow({ where: { orderId: res.body.id } });
  return { id: res.body.id as string, code: res.body.code as string, pin: res.body.deliveryPin as string, total: res.body.totalKobo as number, deliveryId: delivery.id };
}

/** Accepted, picked up by core1, and reported as a problem at the door. */
async function problemAtDoor(method: 'ONLINE' | 'CASH_ON_DELIVERY' = 'CASH_ON_DELIVERY') {
  await request(app).put('/v1/rider/availability').set(as('rider.core1')).send({ online: true });
  const o = await placeAndAccept(method);
  await services.dispatch.tick();
  const offer = (await request(app).get('/v1/rider/work').set(as('rider.core1'))).body.offer;
  expect(offer?.orderCode).toBe(o.code);
  await request(app).post(`/v1/rider/offers/${offer.id}/accept`).set(as('rider.core1')).send();
  await request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${o.id}/ready`).set(as('vendor.mamankechi')).send();
  await request(app).post(`/v1/rider/deliveries/${o.deliveryId}/picked-up`).set(as('rider.core1')).send();
  const p = await request(app).post(`/v1/rider/deliveries/${o.deliveryId}/problem`).set(as('rider.core1')).send({ reason: 'CUSTOMER_UNREACHABLE' });
  expect(p.body.status).toBe('FAILED');
  return o;
}

beforeAll(async () => {
  await freshSeed(db);
  for (const name of ['ada', 'tunde', 'vendor.mamankechi', 'vendor.pending', 'rider.core1', 'rider.core2', 'rider.pending', 'admin', 'ops', 'support', 'finance']) tok[name] = await tokenFor(app, name);
  mamaId = (await db.restaurant.findUniqueOrThrow({ where: { slug: 'mama-nkechis-kitchen' } })).id;
  addressId = (await db.address.findFirstOrThrow({ where: { user: { email: seededEmail('ada') } } })).id;
  const j = await db.menuItem.findFirstOrThrow({ where: { restaurantId: mamaId, name: 'Jollof Rice' }, include: { variants: true } });
  jollof = { id: j.id, large: j.variants.find((x) => x.name === 'Large')!.id };
  await db.delivery.updateMany({ where: { status: { in: ['UNASSIGNED', 'OFFERING'] } }, data: { status: 'CANCELLED' } });
  await db.rider.updateMany({ data: { availability: 'OFFLINE' } });
}, 120_000);
afterAll(() => db.$disconnect());

describe('dashboard and order search', () => {
  it('counts live work and queues', async () => {
    await placeAndAccept();
    const res = await request(app).get(`${A}/dashboard`).set(as('support'));
    expect(res.status).toBe(200);
    expect(res.body.live.awaitingRider).toBeGreaterThanOrEqual(1);
    expect(res.body.live.inKitchen).toBeGreaterThanOrEqual(1);
    expect(res.body.queues.restaurantApprovals).toBe(1); // the seeded pending restaurant
    expect((await request(app).get(`${A}/dashboard`).set(as('ada'))).status).toBe(403);
  });

  it('finds orders by code or customer email; detail shows the PIN only to order managers', async () => {
    const o = await placeAndAccept();
    const byCode = await request(app).get(`${A}/orders`).query({ q: o.code.toLowerCase() }).set(as('support'));
    expect(byCode.body.items.map((x: { id: string }) => x.id)).toEqual([o.id]);
    const byEmail = await request(app).get(`${A}/orders`).query({ q: 'ADA@chopnow.test' }).set(as('support'));
    expect(byEmail.body.total).toBeGreaterThanOrEqual(2);

    const forSupport = await request(app).get(`${A}/orders/${o.id}`).set(as('support'));
    expect(forSupport.body).toMatchObject({ code: o.code, deliveryPin: null, customer: { email: seededEmail('ada') }, delivery: { status: 'OFFERING' } });
    expect(forSupport.body.actions).toEqual([]);
    const forOps = await request(app).get(`${A}/orders/${o.id}`).set(as('ops'));
    expect(forOps.body.deliveryPin).toBe(o.pin);
    expect(forOps.body.actions).toContain('cancel');
    expect(forOps.body.timeline.map((h: { to: string }) => h.to)).toEqual(['PLACED', 'ACCEPTED']);
  });
});

describe('staff fixes', () => {
  it('ops cancels a paid order in the kitchen: refund requested, offers withdrawn, audited', async () => {
    await request(app).put('/v1/rider/availability').set(as('rider.core1')).send({ online: true });
    const o = await placeAndAccept('ONLINE');
    expect((await request(app).get('/v1/rider/work').set(as('rider.core1'))).body.offer?.orderCode).toBe(o.code);
    expect((await request(app).post(`${A}/orders/${o.id}/cancel`).set(as('finance')).send({ reason: 'Customer called' })).status).toBe(403);
    const res = await request(app).post(`${A}/orders/${o.id}/cancel`).set(as('ops')).send({ reason: 'Restaurant ran out of gas' });
    expect(res.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_PENDING', deliveryStatus: 'CANCELLED' });
    expect(res.body.refunds).toHaveLength(1);
    expect((await request(app).get('/v1/rider/work').set(as('rider.core1'))).body.offer).toBeNull();
    expect(await db.auditLog.count({ where: { action: 'order.cancel_by_staff', entityId: o.id } })).toBe(1);
    await request(app).put('/v1/rider/availability').set(as('rider.core1')).send({ online: false });
  });

  it('a delivery problem can be retried with the same rider', async () => {
    const o = await problemAtDoor();
    const detail = await request(app).get(`${A}/orders/${o.id}`).set(as('ops'));
    expect(detail.body.actions).toEqual(expect.arrayContaining(['cancel', 'retry_delivery', 'confirm_delivered']));
    expect(detail.body.needsAttention).toBe(true);
    const res = await request(app).post(`${A}/orders/${o.id}/retry-delivery`).set(as('ops')).send({ mode: 'SAME_RIDER', reason: 'Customer called back, try again' });
    expect(res.body).toMatchObject({ status: 'PICKED_UP', deliveryStatus: 'PICKED_UP', riderName: 'Chinedu Core (test)' });
    const done = await request(app).post(`/v1/rider/deliveries/${o.deliveryId}/complete`).set(as('rider.core1')).send({ pin: o.pin, cashCollectedKobo: o.total });
    expect(done.body.status).toBe('DELIVERED');
  });

  it('or sent back to dispatch for a new rider, who is offered it', async () => {
    const o = await problemAtDoor();
    await request(app).put('/v1/rider/availability').set(as('rider.core2')).send({ online: true });
    const res = await request(app).post(`${A}/orders/${o.id}/retry-delivery`).set(as('ops')).send({ mode: 'NEW_RIDER', reason: 'Food returned to the restaurant' });
    expect(res.body).toMatchObject({ status: 'READY_FOR_PICKUP', deliveryStatus: 'OFFERING', riderName: null });
    expect((await request(app).get('/v1/rider/work').set(as('rider.core2'))).body.offer?.orderCode).toBe(o.code);
    expect((await db.cashCollection.findUniqueOrThrow({ where: { orderId: o.id } }))).toMatchObject({ status: 'PENDING', riderId: null });
    await request(app).put('/v1/rider/availability').set(as('rider.core2')).send({ online: false });
  });

  it('confirm delivered without the PIN books everything exactly like a PIN delivery', async () => {
    const o = await problemAtDoor();
    const noCash = await request(app).post(`${A}/orders/${o.id}/confirm-delivered`).set(as('ops')).send({ reason: 'Customer confirmed by phone' });
    expect(noCash.status).toBe(400);
    const res = await request(app).post(`${A}/orders/${o.id}/confirm-delivered`).set(as('ops')).send({ reason: 'Customer confirmed by phone; PIN not available', cashCollectedKobo: o.total });
    expect(res.body).toMatchObject({ status: 'DELIVERED', paymentStatus: 'SUCCESSFUL', deliveryStatus: 'DELIVERED' });
    expect(res.body.delivery.proofOverrideReason).toMatch(/confirmed by phone/);
    expect(await db.financialTransaction.count({ where: { orderId: o.id, type: { in: ['CASH_COLLECTED', 'ORDER_SETTLED'] } } })).toBe(2);
    expect(await db.riderEarning.count({ where: { orderId: o.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'delivery.proof_override' } })).toBe(1);
    expect((await request(app).post(`${A}/orders/${o.id}/confirm-delivered`).set(as('ops')).send({ reason: 'Again by mistake', cashCollectedKobo: o.total })).status).toBe(409);
    expect((await request(app).post(`${A}/orders/${o.id}/cancel`).set(as('ops')).send({ reason: 'Too late now' })).status).toBe(409);
  });
});

describe('manual dispatch', () => {
  it('shows waiting work and riders; ops can assign, unassign, and can’t double-book a rider', async () => {
    const o = await placeAndAccept();
    const core2 = await db.rider.findFirstOrThrow({ where: { user: { email: seededEmail('rider.core2') } } });
    const board = await request(app).get(`${A}/dispatch`).set(as('ops'));
    expect(board.body.waiting.map((w: { orderCode: string }) => w.orderCode)).toContain(o.code);
    expect((await request(app).get(`${A}/dispatch`).set(as('support'))).status).toBe(403);

    const assigned = await request(app).post(`${A}/deliveries/${o.deliveryId}/assign`).set(as('ops')).send({ riderId: core2.id, reason: 'Agreed by phone' });
    expect(assigned.body.active.find((a: { deliveryId: string }) => a.deliveryId === o.deliveryId)?.riderName).toBe('Bisi Core (test)');
    const work = await request(app).get('/v1/rider/work').set(as('rider.core2'));
    expect(work.body.delivery?.orderCode).toBe(o.code);

    const other = await placeAndAccept();
    const busy = await request(app).post(`${A}/deliveries/${other.deliveryId}/assign`).set(as('ops')).send({ riderId: core2.id, reason: 'Second job' });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('RIDER_BUSY');

    const pending = await db.rider.findFirstOrThrow({ where: { user: { email: seededEmail('rider.pending') } } });
    expect((await request(app).post(`${A}/deliveries/${other.deliveryId}/assign`).set(as('ops')).send({ riderId: pending.id, reason: 'Unapproved rider' })).status).toBe(409);

    const back = await request(app).post(`${A}/deliveries/${o.deliveryId}/unassign`).set(as('ops')).send({ reason: 'Rider bike broke down' });
    expect(back.body.waiting.map((w: { orderCode: string }) => w.orderCode)).toContain(o.code);
    expect((await request(app).get('/v1/rider/work').set(as('rider.core2'))).body.delivery).toBeNull();
    expect(await db.auditLog.count({ where: { action: { in: ['dispatch.assign', 'dispatch.unassign'] }, entityId: o.deliveryId } })).toBe(2);
  });
});

describe('users and staff', () => {
  it('support can look people up but only admins suspend; a suspended customer is signed out at once', async () => {
    const tunde = await db.user.findUniqueOrThrow({ where: { email: seededEmail('tunde') } });
    const found = await request(app).get(`${A}/users`).query({ q: 'tunde', role: 'CUSTOMER' }).set(as('support'));
    expect(found.body.items.map((u: { id: string }) => u.id)).toEqual([tunde.id]);
    expect((await request(app).post(`${A}/users/${tunde.id}/suspend`).set(as('ops')).send({ reason: 'Abusive to riders' })).status).toBe(403);
    const res = await request(app).post(`${A}/users/${tunde.id}/suspend`).set(as('admin')).send({ reason: 'Abusive to riders' });
    expect(res.body.status).toBe('SUSPENDED');
    expect((await request(app).get('/v1/me').set(as('tunde'))).status).toBe(401);
    expect((await request(app).post(`${A}/users/${tunde.id}/reactivate`).set(as('admin')).send({ reason: 'Apologised; warning given' })).body.status).toBe('ACTIVE');
  });

  it('admins can’t suspend themselves, the last admin, or restaurants/riders through this route', async () => {
    const admin = await db.user.findUniqueOrThrow({ where: { email: seededEmail('admin') } });
    expect((await request(app).post(`${A}/users/${admin.id}/suspend`).set(as('admin')).send({ reason: 'Testing self' })).body.error.code).toBe('CANNOT_CHANGE_SELF');
    const vendor = await db.user.findUniqueOrThrow({ where: { email: seededEmail('vendor.pending') } });
    expect((await request(app).post(`${A}/users/${vendor.id}/suspend`).set(as('admin')).send({ reason: 'Wrong route' })).body.error.code).toBe('USE_APPROVAL_FLOW');
  });

  it('a new staff member must change the one-time password before doing anything else', async () => {
    expect((await request(app).post(`${A}/staff`).set(as('ops')).send({ email: 'kemi.ops@chopnow.test', fullName: 'Kemi Ops', role: 'OPERATIONS' })).status).toBe(403);
    const created = await request(app).post(`${A}/staff`).set(as('admin')).send({ email: 'kemi.ops@chopnow.test', fullName: 'Kemi Ops', role: 'OPERATIONS' });
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({ role: 'OPERATIONS', mustChangePassword: true });
    const temp = created.body.temporaryPassword as string;
    expect(temp).toMatch(/^[A-Za-z2-9]{16}$/);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { action: 'staff.create' } }))).not.toContain(temp);
    expect((await request(app).post(`${A}/staff`).set(as('admin')).send({ email: 'kemi.ops@chopnow.test', fullName: 'Kemi Again', role: 'SUPPORT' })).status).toBe(409);

    const login = await request(app).post('/v1/auth/login').send({ email: 'kemi.ops@chopnow.test', password: temp });
    expect(login.body.user.mustChangePassword).toBe(true);
    const blocked = await request(app).get(`${A}/dashboard`).set(bearer(login.body.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await request(app).get('/v1/me').set(bearer(login.body.accessToken))).body.mustChangePassword).toBe(true);
    const changed = await request(app).post('/v1/me/password').set(bearer(login.body.accessToken)).send({ currentPassword: temp, newPassword: 'KemiStrong2026x' });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    expect((await request(app).get(`${A}/dashboard`).set(bearer(changed.body.accessToken))).status).toBe(200);
  });
});

describe('documents', () => {
  it('approvers list, view (audited, short-lived link) and review documents', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    await request(app).post('/v1/rider/documents').set(as('rider.pending')).field('type', 'DRIVERS_LICENCE').attach('file', pdf, 'licence.pdf');
    const list = await request(app).get(`${A}/rider-documents`).query({ status: 'PENDING' }).set(as('ops'));
    expect(list.body.items[0]).toMatchObject({ owner: 'RIDER', ownerName: 'Pending Rider (test)', type: 'DRIVERS_LICENCE' });
    const id = list.body.items[0].id;
    expect((await request(app).get(`${A}/rider-documents`).set(as('support'))).status).toBe(403);
    expect((await request(app).post(`${A}/restaurant-documents/${id}/link`).set(as('ops')).send()).status).toBe(404); // wrong owner type

    const link = await request(app).post(`${A}/rider-documents/${id}/link`).set(as('ops')).send();
    expect(link.body.url).toMatch(/\/media-private\//);
    expect(Date.parse(link.body.expiresAt) - t).toBe(300_000);
    expect(await db.auditLog.count({ where: { action: 'document.view', entityId: id } })).toBe(1);

    expect((await request(app).post(`${A}/rider-documents/${id}/review`).set(as('ops')).send({ status: 'REJECTED' })).status).toBe(400);
    const rejected = await request(app).post(`${A}/rider-documents/${id}/review`).set(as('ops')).send({ status: 'REJECTED', note: 'Photo is blurred; upload again' });
    expect(rejected.body).toMatchObject({ status: 'REJECTED', reviewNote: 'Photo is blurred; upload again' });
    const mine = await request(app).get('/v1/rider/documents').set(as('rider.pending'));
    expect(mine.body.items[0]).toMatchObject({ status: 'REJECTED', reviewNote: 'Photo is blurred; upload again' });
  });
});

describe('promotions, reviews and audit', () => {
  it('creates, validates and pauses promotions', async () => {
    const bad = await request(app).post(`${A}/promotions`).set(as('ops')).send({ code: 'MAMA20', description: 'Mama’s week', type: 'PERCENT_OFF', percentBps: 2000, fundedBy: 'RESTAURANT', startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-21T00:00:00Z' });
    expect(bad.status).toBe(400); // restaurant-funded needs a restaurant
    const ok = await request(app).post(`${A}/promotions`).set(as('ops')).send({ code: 'mama20', description: 'Mama’s week', type: 'PERCENT_OFF', percentBps: 2000, maxDiscountKobo: 100_000, restaurantId: mamaId, fundedBy: 'RESTAURANT', startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-21T00:00:00Z' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ code: 'MAMA20', restaurantName: expect.stringMatching(/^Mama/), isActive: true, redemptions: 0 });
    expect((await request(app).post(`${A}/promotions`).set(as('ops')).send({ code: 'MAMA20', description: 'Dup', type: 'FREE_DELIVERY', startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-21T00:00:00Z' })).status).toBe(409);

    const paused = await request(app).patch(`${A}/promotions/${ok.body.id}`).set(as('ops')).send({ isActive: false });
    expect(paused.body.isActive).toBe(false);
    expect((await request(app).get(`${A}/promotions`).set(as('support'))).status).toBe(403);
    expect(await db.auditLog.count({ where: { entityId: ok.body.id, action: { startsWith: 'promotion.' } } })).toBe(2);
  });

  it('hiding a review removes it from the restaurant’s rating', async () => {
    const order = await db.order.findFirstOrThrow({ where: { status: 'DELIVERED', customer: { email: seededEmail('ada') } }, orderBy: { placedAt: 'asc' } });
    await request(app).post(`/v1/orders/${order.id}/review`).set(as('ada')).send({ restaurantRating: 1, comment: 'TEST: rude words here' });
    expect((await db.restaurant.findUniqueOrThrow({ where: { id: mamaId } })).ratingCount).toBeGreaterThanOrEqual(1);
    const list = await request(app).get(`${A}/reviews`).query({ maxRating: 2 }).set(as('support'));
    const review = list.body.items[0];
    const hidden = await request(app).post(`${A}/reviews/${review.id}/moderate`).set(as('support')).send({ status: 'HIDDEN', note: 'Abusive language' });
    expect(hidden.body).toMatchObject({ status: 'HIDDEN', moderationNote: 'Abusive language' });
    const mama = await db.restaurant.findUniqueOrThrow({ where: { id: mamaId } });
    expect(mama.ratingCount).toBe(await db.review.count({ where: { restaurantId: mamaId, status: 'PUBLISHED' } }));
    const vendorView = await request(app).get(`/v1/vendor/restaurants/${mamaId}/reviews`).set(as('vendor.mamankechi'));
    expect(vendorView.body.items.map((r: { id: string }) => r.id)).not.toContain(review.id);
  });

  it('the audit log is filterable and readable by finance and admins only', async () => {
    const res = await request(app).get(`${A}/audit`).query({ action: 'dispatch.' }).set(as('finance'));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.items.every((a: { action: string }) => a.action.startsWith('dispatch.'))).toBe(true);
    expect(res.body.items[0].actorName).toBeTruthy();
    expect(res.body.items[0].actorRole).toBe('OPERATIONS');
    expect((await request(app).get(`${A}/audit`).set(as('ops'))).status).toBe(403);
  });
});
