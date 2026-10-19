/**
 * Online payment: initialisation, provider verification as the source of truth, webhook signature
 * and duplicate handling, amount mismatch, failure/retry, late payment after cancellation, and the
 * ledger entry for captured funds. Uses the in-process mock provider (clearly marked as test).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../../src/modules/payments/mock.js';
import { createTestDb } from './helpers.js';
import { bearer, buildTestHarness, freshSeed, seededEmail, tokenFor } from './http-helpers.js';

const db = createTestDb();
const harness = buildTestHarness(db);
const app = harness.app;
const mock = harness.services.paymentProvider as MockPaymentProvider;

let ada: string;
let tunde: string;
let addressId: string;
let jollofId: string;
let largeId: string;
let mamaId: string;
let n = 0;
const key = () => `pay-test-${Date.now()}-${++n}`;

async function placeOnlineOrder(token = ada) {
  const res = await request(app)
    .post('/v1/orders')
    .set(bearer(token))
    .set('Idempotency-Key', key())
    .send({ restaurantId: mamaId, addressId, paymentMethod: 'ONLINE', items: [{ menuItemId: jollofId, variantId: largeId, quantity: 1 }] });
  expect(res.status).toBe(201);
  return res.body;
}

async function startPayment(orderId: string, idem = key(), token = ada) {
  return request(app).post(`/v1/orders/${orderId}/payments`).set(bearer(token)).set('Idempotency-Key', idem).send();
}

const capturedJournals = (orderId: string) => db.financialTransaction.findMany({ where: { orderId, type: 'ONLINE_PAYMENT_CAPTURED' }, include: { entries: true } });

beforeAll(async () => {
  expect(mock).toBeInstanceOf(MockPaymentProvider);
  await freshSeed(db);
  ada = await tokenFor(app, 'ada');
  tunde = await tokenFor(app, 'tunde');
  addressId = (await db.address.findFirstOrThrow({ where: { user: { email: seededEmail('ada') } } })).id;
  const mama = await db.restaurant.findUniqueOrThrow({ where: { slug: 'mama-nkechis-kitchen' } });
  mamaId = mama.id;
  const jollof = await db.menuItem.findFirstOrThrow({ where: { restaurantId: mama.id, name: 'Jollof Rice' }, include: { variants: true } });
  jollofId = jollof.id;
  largeId = jollof.variants.find((v) => v.name === 'Large')!.id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('starting a payment', () => {
  it('online orders are not sent to the restaurant before payment', async () => {
    const order = await placeOnlineOrder();
    expect(order).toMatchObject({ paymentMethod: 'ONLINE', paymentStatus: 'PENDING', sentToRestaurant: false, canPay: true });
  });

  it('returns a clearly marked test checkout URL, and reuses it for retries', async () => {
    const order = await placeOnlineOrder();
    expect((await request(app).post(`/v1/orders/${order.id}/payments`).set(bearer(ada)).send()).status).toBe(400); // no key

    const idem = key();
    const first = await startPayment(order.id, idem);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ provider: 'MOCK', isTestPayment: true, amountKobo: order.totalKobo, reference: `${order.code}-1` });
    expect(first.body.authorizationUrl).toContain(`/v1/payments/mock/checkout/${order.code}-1`);

    const replay = await startPayment(order.id, idem);
    expect(replay.body.reference).toBe(first.body.reference);
    const newAttemptSoon = await startPayment(order.id);
    expect(newAttemptSoon.body.reference).toBe(first.body.reference); // unpaid attempt is reused
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('rejects payment for cash orders, other customers\' orders and cancelled orders', async () => {
    const cash = await request(app)
      .post('/v1/orders')
      .set(bearer(ada))
      .set('Idempotency-Key', key())
      .send({ restaurantId: mamaId, addressId, paymentMethod: 'CASH_ON_DELIVERY', items: [{ menuItemId: jollofId, variantId: largeId, quantity: 1 }] });
    expect((await startPayment(cash.body.id)).body.error.code).toBe('NOT_ONLINE_PAYMENT');

    const order = await placeOnlineOrder();
    expect((await startPayment(order.id, key(), tunde)).status).toBe(404);

    await request(app).post(`/v1/orders/${order.id}/cancel`).set(bearer(ada)).send({});
    expect((await startPayment(order.id)).body.error.code).toBe('ORDER_NOT_PAYABLE');
  });
});

describe('confirming payment', () => {
  it('does not trust the app: unpaid stays pending until the provider confirms', async () => {
    const order = await placeOnlineOrder();
    const { body: init } = await startPayment(order.id);
    const pending = await request(app).post(`/v1/payments/${init.reference}/verify`).set(bearer(ada)).send();
    expect(pending.body).toMatchObject({ status: 'PENDING', orderPaymentStatus: 'PENDING' });

    mock.complete(init.reference, 'success');
    const ok = await request(app).post(`/v1/payments/${init.reference}/verify`).set(bearer(ada)).send();
    expect(ok.body).toMatchObject({ status: 'SUCCESSFUL', orderPaymentStatus: 'SUCCESSFUL' });

    const after = await request(app).get(`/v1/orders/${order.id}`).set(bearer(ada));
    expect(after.body).toMatchObject({ paymentStatus: 'SUCCESSFUL', sentToRestaurant: true, canPay: false, payment: { status: 'SUCCESSFUL', isTestPayment: true } });
    const stored = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.acceptDeadlineAt).not.toBeNull();

    const journals = await capturedJournals(order.id);
    expect(journals).toHaveLength(1);
    expect(journals[0]!.entries.map((e) => [e.account, e.direction, e.amountKobo]).sort()).toEqual(
      [['CUSTOMER_ORDER_FUNDS', 'CREDIT', order.totalKobo], ['PROVIDER_CLEARING', 'DEBIT', order.totalKobo]].sort(),
    );
    expect((await request(app).post(`/v1/payments/${init.reference}/verify`).set(bearer(tunde)).send()).status).toBe(404);
  });

  it('processes a signed webhook once, however many times it is delivered', async () => {
    const order = await placeOnlineOrder();
    const { body: init } = await startPayment(order.id);
    mock.complete(init.reference, 'success');
    const { raw, signature } = mock.signedWebhook(init.reference);

    const deliveries = await Promise.all([1, 2, 3].map(() => harness.services.payments.handleWebhook(raw, { 'x-mock-signature': signature }, JSON.parse(raw.toString()))));
    expect(deliveries.filter((d) => !d.duplicate)).toHaveLength(1);
    // One stored webhook delivery, plus one provider-verification record it triggered.
    expect(await db.paymentEvent.count({ where: { eventType: 'charge.success', payment: { reference: init.reference } } })).toBe(1);
    expect(await db.paymentEvent.count({ where: { eventType: 'verify.success', payment: { reference: init.reference } } })).toBe(1);
    expect(await capturedJournals(order.id)).toHaveLength(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe('SUCCESSFUL');
  });

  it('rejects webhooks with a missing or wrong signature, without storing them', async () => {
    const before = await db.paymentEvent.count();
    const res = await request(app).post('/v1/payments/webhooks/paystack').set('x-paystack-signature', 'ab'.repeat(64)).send({ event: 'charge.success', data: { reference: 'X' } });
    expect(res.status).toBe(401);
    expect((await request(app).post('/v1/payments/webhooks/paystack').send({ event: 'charge.success' })).status).toBe(401);
    expect(await db.paymentEvent.count()).toBe(before);
  });

  it('two concurrent confirmations post one ledger entry', async () => {
    const order = await placeOnlineOrder();
    const { body: init } = await startPayment(order.id);
    mock.complete(init.reference, 'success');
    await Promise.all([1, 2, 3].map(() => request(app).post(`/v1/payments/${init.reference}/verify`).set(bearer(ada)).send()));
    expect(await capturedJournals(order.id)).toHaveLength(1);
  });

  it('does not mark an order paid when the amount does not match; requests a refund', async () => {
    const order = await placeOnlineOrder();
    const { body: init } = await startPayment(order.id);
    mock.complete(init.reference, 'success', 100); // ₦1 instead of the total
    const res = await request(app).post(`/v1/payments/${init.reference}/verify`).set(bearer(ada)).send();
    expect(res.body).toMatchObject({ status: 'FAILED', orderPaymentStatus: 'PENDING' });
    const payment = await db.payment.findUniqueOrThrow({ where: { reference: init.reference } });
    expect(payment.failureReason).toBe('AMOUNT_MISMATCH');
    expect(await db.refund.count({ where: { paymentId: payment.id, status: 'REQUESTED', amountKobo: 100 } })).toBe(1);
    // The money the provider holds is booked as owed back, never as payment for the order.
    const journals = await capturedJournals(order.id);
    expect(journals.map((j) => j.idempotencyKey)).toEqual([`payment:${payment.id}:unapplied`]);
    expect(journals[0]!.entries.find((e) => e.direction === 'CREDIT')).toMatchObject({ account: 'REFUNDS_PAYABLE', amountKobo: 100 });
    expect(await db.auditLog.count({ where: { action: 'payment.amount_mismatch', entityId: payment.id } })).toBe(1);
  });

  it('a failed payment can be retried with a new attempt', async () => {
    const order = await placeOnlineOrder();
    const { body: first } = await startPayment(order.id);
    mock.complete(first.reference, 'failed');
    const failed = await request(app).post(`/v1/payments/${first.reference}/verify`).set(bearer(ada)).send();
    expect(failed.body).toMatchObject({ status: 'FAILED', orderPaymentStatus: 'FAILED' });
    expect((await request(app).get(`/v1/orders/${order.id}`).set(bearer(ada))).body.canPay).toBe(true);

    const { body: second } = await startPayment(order.id);
    expect(second.reference).toBe(`${order.code}-2`);
    mock.complete(second.reference, 'success');
    const ok = await request(app).post(`/v1/payments/${second.reference}/verify`).set(bearer(ada)).send();
    expect(ok.body.orderPaymentStatus).toBe('SUCCESSFUL');
  });

  it('a second successful charge for the same order is held for refund, not double-counted', async () => {
    const order = await placeOnlineOrder();
    const { body: first } = await startPayment(order.id);
    // Customer opens two checkouts (simulated by forcing a second attempt row) and pays both.
    const second = await db.payment.create({ data: { orderId: order.id, provider: 'MOCK', reference: `${order.code}-9`, amountKobo: order.totalKobo, status: 'INITIALIZED' } });
    await mock.initialize({ reference: second.reference, amountKobo: second.amountKobo, email: 'x@test', callbackUrl: 'x', metadata: {} });
    mock.complete(first.reference, 'success');
    mock.complete(second.reference, 'success');
    await request(app).post(`/v1/payments/${first.reference}/verify`).set(bearer(ada)).send();
    const dup = await request(app).post(`/v1/payments/${second.reference}/verify`).set(bearer(ada)).send();
    expect(dup.body.status).toBe('FAILED');
    expect((await db.payment.findUniqueOrThrow({ where: { id: second.id } })).failureReason).toBe('DUPLICATE_CHARGE');
    expect(await db.refund.count({ where: { paymentId: second.id } })).toBe(1);
    // One capture for the order; the duplicate is booked as owed back to the customer.
    const journals = await capturedJournals(order.id);
    expect(journals.map((j) => j.entries.find((e) => e.direction === 'CREDIT')!.account).sort()).toEqual(['CUSTOMER_ORDER_FUNDS', 'REFUNDS_PAYABLE']);
  });
});

describe('cancellation and payment', () => {
  it('cancelling a paid order requests a full refund', async () => {
    const order = await placeOnlineOrder();
    const { body: init } = await startPayment(order.id);
    mock.complete(init.reference, 'success');
    await request(app).post(`/v1/payments/${init.reference}/verify`).set(bearer(ada)).send();

    const res = await request(app).post(`/v1/orders/${order.id}/cancel`).set(bearer(ada)).send({ reason: 'Plans changed' });
    expect(res.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_PENDING' });
    expect(await db.refund.count({ where: { orderId: order.id, status: 'REQUESTED', amountKobo: order.totalKobo } })).toBe(1);
  });

  it('a payment that completes after cancellation is refunded, not applied', async () => {
    const order = await placeOnlineOrder();
    const { body: init } = await startPayment(order.id);
    await request(app).post(`/v1/orders/${order.id}/cancel`).set(bearer(ada)).send({});
    mock.complete(init.reference, 'success');
    // The payment attempt was marked abandoned on cancel; the provider still reports success.
    const res = await harness.services.payments.verifyAndApply(init.reference, 'webhook');
    expect(res.orderPaymentStatus).toBe('REFUND_PENDING');
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_PENDING', visibleToVendorAt: null });
    expect(await db.refund.count({ where: { orderId: order.id } })).toBe(1);
  });
});

describe('hosted pages', () => {
  it('the mock checkout page is labelled as a test and completes payment through the webhook path', async () => {
    const order = await placeOnlineOrder();
    const { body: init } = await startPayment(order.id);
    const pageRes = await request(app).get(`/v1/payments/mock/checkout/${init.reference}`);
    expect(pageRes.status).toBe(200);
    expect(pageRes.text).toContain('TEST PAYMENT');
    expect(pageRes.text).toContain('No real money');

    const done = await request(app).post(`/v1/payments/mock/checkout/${init.reference}`).type('form').send({ outcome: 'success' });
    expect(done.text).toContain('Test payment succeeded');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe('SUCCESSFUL');
  });

  it('the provider callback page verifies and escapes untrusted input', async () => {
    const res = await request(app).get('/v1/payments/callback').query({ reference: '<script>alert(1)</script>' });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<script>alert(1)</script>');
  });
});
