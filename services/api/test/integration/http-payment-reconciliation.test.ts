/**
 * Payment reconciliation (worker job): payments the webhook never reported are found by asking the
 * provider; unpaid online orders close after the timeout and release their promotion; money that
 * arrives after an order closed is refunded; a cancellation never loses a payment confirmed a
 * moment earlier. The clock starts at real time because rows are timestamped by the database.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeUnfulfilledOrder } from '../../src/modules/orders/order-closure.js';
import { MockPaymentProvider } from '../../src/modules/payments/mock.js';
import { createTestDb } from './helpers.js';
import { bearer, buildTestHarness, freshSeed, seededEmail, tokenFor } from './http-helpers.js';

const db = createTestDb();
let t = Date.now();
const advanceMinutes = (m: number) => {
  t += m * 60_000;
};
const { app, services } = buildTestHarness(db, { clock: () => new Date(t) });
const mock = services.paymentProvider as MockPaymentProvider;

let ada: string;
let mamaId: string;
let addressId: string;
let jollof: { id: string; variantId: string };
let n = 0;
const key = () => `recon-${Date.now()}-${++n}`;

beforeAll(async () => {
  await freshSeed(db);
  ada = await tokenFor(app, 'ada');
  const mama = await db.restaurant.findUniqueOrThrow({ where: { slug: 'mama-nkechis-kitchen' } });
  mamaId = mama.id;
  // Open all day: these tests run at real wall-clock time.
  await db.restaurantHours.updateMany({ where: { restaurantId: mamaId }, data: { opensAt: 0, closesAt: 1440 } });
  addressId = (await db.address.findFirstOrThrow({ where: { user: { email: seededEmail('ada') } } })).id;
  const item = await db.menuItem.findFirstOrThrow({ where: { restaurantId: mamaId, name: 'Jollof Rice' }, include: { variants: true } });
  jollof = { id: item.id, variantId: item.variants.find((v) => v.name === 'Large')!.id };
}, 120_000);
afterAll(() => db.$disconnect());

async function placeOnline(promoCode?: string) {
  const res = await request(app)
    .post('/v1/orders')
    .set(bearer(ada))
    .set('Idempotency-Key', key())
    .send({ restaurantId: mamaId, addressId, paymentMethod: 'ONLINE', items: [{ menuItemId: jollof.id, variantId: jollof.variantId, quantity: 1 }], ...(promoCode ? { promoCode } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; totalKobo: number };
}
async function startPayment(orderId: string) {
  const res = await request(app).post(`/v1/orders/${orderId}/payments`).set(bearer(ada)).set('Idempotency-Key', key()).send();
  expect(res.status).toBe(200);
  return res.body.reference as string;
}
const order = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
const payment = (reference: string) => db.payment.findUniqueOrThrow({ where: { reference } });

describe('payment reconciliation', () => {
  it('applies a payment whose webhook never arrived, once, and only after the 3-minute grace', async () => {
    const o = await placeOnline();
    const ref = await startPayment(o.id);
    mock.complete(ref, 'success'); // the customer paid; no webhook, no in-app check

    advanceMinutes(1);
    await services.payments.reconcile();
    expect((await payment(ref)).lastReconciledAt).toBeNull(); // too early: webhooks usually win

    advanceMinutes(3);
    await services.payments.reconcile();
    const paid = await order(o.id);
    expect(paid.paymentStatus).toBe('SUCCESSFUL');
    expect(paid.visibleToVendorAt).not.toBeNull(); // now sent to the restaurant
    expect(await db.paymentEvent.count({ where: { paymentId: (await payment(ref)).id, source: 'reconciliation' } })).toBe(1);

    advanceMinutes(20);
    await services.payments.reconcile();
    expect(await db.financialTransaction.count({ where: { orderId: o.id, type: 'ONLINE_PAYMENT_CAPTURED' } })).toBe(1);
  });

  it('backs off: an attempt still pending is asked again after 15 minutes, not every minute', async () => {
    const o = await placeOnline();
    const ref = await startPayment(o.id);
    advanceMinutes(4);
    await services.payments.reconcile();
    const first = (await payment(ref)).lastReconciledAt;
    expect(first).not.toBeNull();

    advanceMinutes(5);
    await services.payments.reconcile();
    expect((await payment(ref)).lastReconciledAt).toEqual(first);

    advanceMinutes(11);
    await services.payments.reconcile();
    expect((await payment(ref)).lastReconciledAt!.getTime()).toBeGreaterThan(first!.getTime());
    await request(app).post(`/v1/orders/${o.id}/cancel`).set(bearer(ada)).send({ reason: 'test tidy-up' });
  });

  it('cancels an online order nobody paid for and releases its promotion', async () => {
    const o = await placeOnline('WELCOME10');
    expect(await db.promotionRedemption.count({ where: { orderId: o.id, isActive: true } })).toBe(1);
    advanceMinutes(29);
    await services.payments.reconcile();
    expect((await order(o.id)).status).toBe('PLACED');

    advanceMinutes(2); // past the 30-minute default
    await services.payments.reconcile();
    const closed = await order(o.id);
    expect(closed.status).toBe('CANCELLED');
    expect(closed.cancellationReason).toBe('Payment was not completed in time');
    expect(await db.promotionRedemption.count({ where: { orderId: o.id, isActive: true } })).toBe(0);
    expect(await db.orderStatusHistory.count({ where: { orderId: o.id, toStatus: 'CANCELLED', actorRole: 'SYSTEM' } })).toBe(1);
  });

  it('checks the provider before closing, so a paid order is never cancelled', async () => {
    const o = await placeOnline();
    const ref = await startPayment(o.id);
    advanceMinutes(4);
    await services.payments.reconcile(); // pending at this point
    mock.complete(ref, 'success'); // paid at minute 30; its next scheduled check is later
    advanceMinutes(27);
    await services.payments.reconcile();
    const o2 = await order(o.id);
    expect(o2.status).toBe('PLACED');
    expect(o2.paymentStatus).toBe('SUCCESSFUL');
  });

  it('refunds money that arrives after an unpaid order was closed', async () => {
    const o = await placeOnline();
    const ref = await startPayment(o.id);
    mock.complete(ref, 'failed');
    advanceMinutes(31);
    await services.payments.reconcile();
    expect((await order(o.id)).status).toBe('CANCELLED');

    // A later attempt the customer had left open in a browser tab is then paid (and the webhook lost).
    const late = await db.payment.create({ data: { orderId: o.id, provider: 'MOCK', reference: `${ref}-LATE`, amountKobo: o.totalKobo, status: 'ABANDONED' } });
    await mock.initialize({ reference: late.reference, amountKobo: o.totalKobo, email: seededEmail('ada'), callbackUrl: 'https://example.test/cb', metadata: {} });
    expect(mock.complete(late.reference, 'success')).toBeTruthy();
    advanceMinutes(16);
    await services.payments.reconcile();
    const closed = await order(o.id);
    expect(closed.status).toBe('CANCELLED');
    expect(closed.paymentStatus).toBe('REFUND_PENDING');
    expect(await db.refund.count({ where: { orderId: o.id, paymentId: late.id, status: 'REQUESTED' } })).toBe(1);
  });

  it('closing an order uses fresh payment data, not the caller’s stale snapshot', async () => {
    const o = await placeOnline();
    const ref = await startPayment(o.id);
    const stale = await order(o.id); // read while unpaid…
    mock.complete(ref, 'success');
    await request(app).post(`/v1/payments/${ref}/verify`).set(bearer(ada)).send(); // …then paid
    await db.$transaction((tx) => closeUnfulfilledOrder(tx, { order: stale, to: 'CANCELLED', actor: { userId: null, role: 'SYSTEM' }, reason: 'race test' }));
    const closed = await order(o.id);
    expect(closed.paymentStatus).toBe('REFUND_PENDING');
    expect(await db.refund.count({ where: { orderId: o.id } })).toBe(1);
  });

  it('support can ask the provider about a payment now; it is applied once and audited, and customers cannot', async () => {
    const support = await tokenFor(app, 'support');
    const o = await placeOnline();
    const ref = await startPayment(o.id);
    mock.complete(ref, 'success');
    const verify = (token: string) => request(app).post(`/v1/admin/payments/${ref}/verify`).set(bearer(token)).send();
    expect((await verify(ada)).status).toBe(403);
    const res = await verify(support);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'SUCCESSFUL', orderPaymentStatus: 'SUCCESSFUL' });
    expect((await verify(support)).body.status).toBe('SUCCESSFUL');
    expect(await db.financialTransaction.count({ where: { orderId: o.id, type: 'ONLINE_PAYMENT_CAPTURED' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'payment.staff_verify', entityId: (await payment(ref)).id } })).toBe(2);
    expect((await request(app).post('/v1/admin/payments/NO-SUCH-REF/verify').set(bearer(support)).send()).status).toBe(404);
  });
});
