/**
 * Finance (acceptance steps 19–22): the order split at delivery, refunds end to end (provider,
 * pending, failed, manual, unapplied charges, separation of duties), rider cash hand-ins,
 * settlements with carry-forward, payouts, statements and the trial balance.
 */
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LedgerAccount } from '../../src/generated/prisma/client.js';
import { MockPaymentProvider } from '../../src/modules/payments/mock.js';
import { createTestDb } from './helpers.js';
import { LAGOS_NOON, bearer, buildTestHarness, freshSeed, seededEmail, tokenFor } from './http-helpers.js';

const db = createTestDb();
let t = LAGOS_NOON.getTime(); // Wed 14 Oct 2026, 12:00 Lagos
const clock = () => new Date(t);
const setLagos = (isoDate: string, hour = 12) => {
  t = Date.parse(`${isoDate}T${String(hour - 1).padStart(2, '0')}:00:00Z`);
};
const harness = buildTestHarness(db, { clock });
const { app, services } = harness;
const mock = services.paymentProvider as MockPaymentProvider;

const tok: Record<string, string> = {};
const addr: Record<string, string> = {};
let mamaId: string;
let bukkaVendor: string;
let jollof: { id: string; large: string };
let n = 0;
const key = () => `finance-test-${Date.now()}-${++n}`;
const as = (name: string) => bearer(tok[name]!);
const F = '/v1/admin/finance';

/** Ledger balance of an account (debits − credits), optionally for one restaurant or rider. */
async function balance(account: LedgerAccount, owner: { restaurantId?: string; riderId?: string } = {}) {
  const rows = await db.ledgerEntry.groupBy({ by: ['direction'], where: { account, ...owner }, _sum: { amountKobo: true } });
  const s = (d: string) => rows.find((r) => r.direction === d)?._sum.amountKobo ?? 0;
  return s('DEBIT') - s('CREDIT');
}
const journal = (idempotencyKey: string) => db.financialTransaction.findUnique({ where: { idempotencyKey }, include: { entries: true } });
const line = (j: Awaited<ReturnType<typeof journal>>, account: string) => j!.entries.filter((e) => e.account === account).reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountKobo : -e.amountKobo), 0);

async function placeOrder(method: 'ONLINE' | 'CASH_ON_DELIVERY', customer = 'ada', extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/v1/orders')
    .set(as(customer))
    .set('Idempotency-Key', key())
    .send({ restaurantId: mamaId, addressId: addr[customer], paymentMethod: method, items: [{ menuItemId: jollof.id, variantId: jollof.large, quantity: 1 }], ...extra });
  expect(res.status).toBe(201);
  let paymentReference: string | null = null;
  if (method === 'ONLINE') {
    const init = await request(app).post(`/v1/orders/${res.body.id}/payments`).set(as(customer)).set('Idempotency-Key', key()).send();
    paymentReference = init.body.reference;
    mock.complete(init.body.reference, 'success');
    await request(app).post(`/v1/payments/${init.body.reference}/verify`).set(as(customer)).send();
  }
  return { id: res.body.id as string, code: res.body.code as string, pin: res.body.deliveryPin as string, total: res.body.totalKobo as number, paymentReference };
}

/** Full journey to the doorstep with rider core1. */
async function deliver(method: 'ONLINE' | 'CASH_ON_DELIVERY', customer = 'ada', extra: Record<string, unknown> = {}) {
  const o = await placeOrder(method, customer, extra);
  expect((await request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${o.id}/accept`).set(as('vendor.mamankechi')).send({})).status).toBe(200);
  await request(app).put('/v1/rider/availability').set(as('rider.core1')).send({ online: true });
  await services.dispatch.tick();
  const work = await request(app).get('/v1/rider/work').set(as('rider.core1'));
  expect(work.body.offer?.orderCode).toBe(o.code);
  const delivery = (await request(app).post(`/v1/rider/offers/${work.body.offer.id}/accept`).set(as('rider.core1')).send()).body;
  await request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${o.id}/ready`).set(as('vendor.mamankechi')).send();
  await request(app).post(`/v1/rider/deliveries/${delivery.id}/picked-up`).set(as('rider.core1')).send();
  const done = await request(app)
    .post(`/v1/rider/deliveries/${delivery.id}/complete`)
    .set(as('rider.core1'))
    .send({ pin: o.pin, ...(method === 'CASH_ON_DELIVERY' ? { cashCollectedKobo: o.total } : {}) });
  expect(done.body.status).toBe('DELIVERED');
  return { ...o, deliveryId: delivery.id as string };
}

beforeAll(async () => {
  await freshSeed(db);
  for (const name of ['ada', 'tunde', 'vendor.mamankechi', 'vendor.bukka', 'rider.core1', 'rider.indie1', 'finance', 'support', 'ops', 'admin']) tok[name] = await tokenFor(app, name);
  bukkaVendor = tok['vendor.bukka']!;
  mamaId = (await db.restaurant.findUniqueOrThrow({ where: { slug: 'mama-nkechis-kitchen' } })).id;
  for (const c of ['ada', 'tunde']) addr[c] = (await db.address.findFirstOrThrow({ where: { user: { email: seededEmail(c) } } })).id;
  const j = await db.menuItem.findFirstOrThrow({ where: { restaurantId: mamaId, name: 'Jollof Rice' }, include: { variants: true } });
  jollof = { id: j.id, large: j.variants.find((x) => x.name === 'Large')!.id };
  // Only core1 works in this file, and the seeded sample deliveries are out of the way.
  await db.delivery.updateMany({ where: { status: { in: ['UNASSIGNED', 'OFFERING'] } }, data: { status: 'CANCELLED' } });
  await db.rider.updateMany({ data: { availability: 'OFFLINE' } });
}, 120_000);
afterAll(() => db.$disconnect());

describe('the order split at delivery', () => {
  it('an online order with a platform promo splits exactly between restaurant, rider and platform', async () => {
    const o = await deliver('ONLINE', 'ada', { promoCode: 'WELCOME10' });
    const order = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(order.discountKobo).toBeGreaterThan(0);
    const j = await journal(`order:${o.id}:settled`);
    expect(j?.type).toBe('ORDER_SETTLED');
    expect(line(j, 'CUSTOMER_ORDER_FUNDS')).toBe(-order.totalKobo);
    expect(line(j, 'PROMOTION_EXPENSE')).toBe(-order.discountKobo);
    expect(line(j, 'VENDOR_PAYABLE')).toBe(order.subtotalKobo - order.commissionKobo);
    expect(line(j, 'RIDER_PAYABLE')).toBe(order.riderEarningKobo);
    expect(line(j, 'PLATFORM_COMMISSION_REVENUE')).toBe(order.commissionKobo);
    expect(line(j, 'PLATFORM_DELIVERY_REVENUE')).toBe(order.deliveryFeeKobo - order.riderEarningKobo);
    expect(line(j, 'PLATFORM_SERVICE_FEE_REVENUE')).toBe(order.serviceFeeKobo);
    // Money received for the order is fully allocated: nothing left in customer funds.
    expect((await db.ledgerEntry.aggregate({ where: { transaction: { orderId: o.id }, account: 'CUSTOMER_ORDER_FUNDS' }, _sum: { amountKobo: true } }))._sum.amountKobo).toBe(order.totalKobo * 2);
  });

  it('a cash order books the cash to the rider, then splits it the same way', async () => {
    const o = await deliver('CASH_ON_DELIVERY');
    const cash = await journal(`cash:${(await db.cashCollection.findUniqueOrThrow({ where: { orderId: o.id } })).id}:collected`);
    expect(line(cash, 'RIDER_CASH_HELD')).toBe(-o.total);
    expect(line(await journal(`order:${o.id}:settled`), 'CUSTOMER_ORDER_FUNDS')).toBe(-o.total);
    expect(await balance('CUSTOMER_ORDER_FUNDS')).toBe(0);
  });
});

describe('refunds', () => {
  it('a declined paid order is refunded through the provider after finance approves', async () => {
    const o = await placeOrder('ONLINE');
    await request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${o.id}/reject`).set(as('vendor.mamankechi')).send({ reason: 'TOO_BUSY' });
    const list = await request(app).get(`${F}/refunds`).query({ status: 'REQUESTED' }).set(as('finance'));
    const r = list.body.items.find((x: { orderId: string }) => x.orderId === o.id);
    expect(r).toMatchObject({ amountKobo: o.total, status: 'REQUESTED', isTestPayment: true });

    const approved = await request(app).post(`${F}/refunds/${r.id}/approve`).set(as('finance')).send({});
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'SUCCESSFUL', chargeTo: 'CUSTOMER_FUNDS', method: 'PROVIDER' });
    expect(line(await journal(`refund:${r.id}:approved`), 'REFUNDS_PAYABLE')).toBe(o.total);
    expect(line(await journal(`refund:${r.id}:paid`), 'PROVIDER_CLEARING')).toBe(o.total);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe('REFUNDED');
    expect(await balance('CUSTOMER_ORDER_FUNDS')).toBe(0);
    expect(await balance('REFUNDS_PAYABLE')).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: r.id, action: { in: ['refund.approve', 'refund.completed'] } } })).toBe(2);
  });

  it('after delivery: support requests, a different person approves and chooses who bears it', async () => {
    const o = await deliver('ONLINE', 'tunde');
    const tooMuch = await request(app).post(`/v1/admin/orders/${o.id}/refunds`).set(as('support')).send({ amountKobo: o.total + 1, reason: 'Missing items' });
    expect(tooMuch.status).toBe(422);
    const req = await request(app).post(`/v1/admin/orders/${o.id}/refunds`).set(as('support')).send({ amountKobo: 100_000, reason: 'Chicken missing from order' });
    expect(req.status).toBe(201);
    expect((await request(app).post(`${F}/refunds/${req.body.id}/approve`).set(as('support')).send({})).status).toBe(403); // no refund.approve

    const ownRequest = await request(app).post(`/v1/admin/orders/${o.id}/refunds`).set(as('finance')).send({ amountKobo: 1000, reason: 'Testing own approval' });
    const self = await request(app).post(`${F}/refunds/${ownRequest.body.id}/approve`).set(as('finance')).send({ chargeTo: 'PLATFORM' });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SEPARATION_OF_DUTIES');
    await request(app).post(`${F}/refunds/${ownRequest.body.id}/reject`).set(as('admin')).send({ reason: 'Raised by mistake' });

    const noChoice = await request(app).post(`${F}/refunds/${req.body.id}/approve`).set(as('finance')).send({});
    expect(noChoice.status).toBe(400);
    const vendorBefore = await balance('VENDOR_PAYABLE', { restaurantId: mamaId });
    const ok = await request(app).post(`${F}/refunds/${req.body.id}/approve`).set(as('finance')).send({ chargeTo: 'RESTAURANT' });
    expect(ok.body).toMatchObject({ status: 'SUCCESSFUL', chargeTo: 'RESTAURANT' });
    expect((await balance('VENDOR_PAYABLE', { restaurantId: mamaId })) - vendorBefore).toBe(100_000); // owed 100,000 kobo less
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe('PARTIALLY_REFUNDED');
    const remaining = await request(app).post(`/v1/admin/orders/${o.id}/refunds`).set(as('support')).send({ amountKobo: o.total - 100_000 + 1, reason: 'Second refund' });
    expect(remaining.status).toBe(422);
  });

  it('a pending provider refund completes when the provider confirms (webhook prompts a re-check)', async () => {
    const o = await deliver('ONLINE');
    const req = await request(app).post(`/v1/admin/orders/${o.id}/refunds`).set(as('support')).send({ amountKobo: 50_000, reason: 'Late delivery goodwill' });
    mock.nextRefundOutcome = 'pending';
    const approved = await request(app).post(`${F}/refunds/${req.body.id}/approve`).set(as('finance')).send({ chargeTo: 'PLATFORM' });
    expect(approved.body.status).toBe('PROCESSING');
    expect(await journal(`refund:${req.body.id}:paid`)).toBeNull();

    mock.settleRefund(approved.body.providerRefundId, 'success');
    const raw = Buffer.from(JSON.stringify({ event: 'refund.processed', data: { id: approved.body.providerRefundId } }));
    const sig = createHmac('sha512', mock.webhookSecret).update(raw).digest('hex');
    await services.payments.handleWebhook(raw, { 'x-mock-signature': sig }, JSON.parse(raw.toString()));
    expect((await request(app).get(`${F}/refunds/${req.body.id}`).set(as('finance'))).body.status).toBe('SUCCESSFUL');
    expect(line(await journal(`refund:${req.body.id}:approved`), 'ADJUSTMENTS')).toBe(-50_000);
  });

  it('a failed provider refund can be retried or paid by bank transfer instead', async () => {
    const o = await deliver('ONLINE');
    const req = await request(app).post(`/v1/admin/orders/${o.id}/refunds`).set(as('support')).send({ amountKobo: 30_000, reason: 'Cold food' });
    mock.nextRefundOutcome = 'failed';
    const approved = await request(app).post(`${F}/refunds/${req.body.id}/approve`).set(as('finance')).send({ chargeTo: 'PLATFORM' });
    expect(approved.body).toMatchObject({ status: 'FAILED' });
    expect(approved.body.failureReason).toMatch(/Provider declined/);
    expect((await request(app).post(`${F}/refunds/${req.body.id}/retry`).set(as('finance')).send()).body.status).toBe('FAILED'); // provider still says failed
    const paid = await request(app).post(`${F}/refunds/${req.body.id}/mark-paid`).set(as('finance')).send({ bankReference: 'GTB-REF-778812' });
    expect(paid.body).toMatchObject({ status: 'SUCCESSFUL', method: 'MANUAL', providerRefundId: 'GTB-REF-778812' });
    expect(line(await journal(`refund:${req.body.id}:paid`), 'PLATFORM_BANK')).toBe(30_000);
  });

  it('cash orders are refunded manually, and rejected requests post nothing', async () => {
    const o = await deliver('CASH_ON_DELIVERY');
    const req = await request(app).post(`/v1/admin/orders/${o.id}/refunds`).set(as('support')).send({ amountKobo: 20_000, reason: 'Wrong drink' });
    const approved = await request(app).post(`${F}/refunds/${req.body.id}/approve`).set(as('finance')).send({ chargeTo: 'RESTAURANT' });
    expect(approved.body).toMatchObject({ status: 'APPROVED', method: 'MANUAL' });
    expect((await request(app).post(`${F}/refunds/${req.body.id}/mark-paid`).set(as('finance')).send({ bankReference: 'TRF-0091' })).body.status).toBe('SUCCESSFUL');

    const other = await request(app).post(`/v1/admin/orders/${o.id}/refunds`).set(as('support')).send({ amountKobo: 5_000, reason: 'Customer asked twice' });
    const rejected = await request(app).post(`${F}/refunds/${other.body.id}/reject`).set(as('finance')).send({ reason: 'Already refunded' });
    expect(rejected.body).toMatchObject({ status: 'REJECTED', failureReason: 'Already refunded' });
    expect(await db.financialTransaction.count({ where: { refundId: other.body.id } })).toBe(0);
    expect((await request(app).post(`${F}/refunds/${other.body.id}/approve`).set(as('finance')).send({})).status).toBe(409);
  });

  it('a duplicate charge is booked as owed back on receipt, then refunded without touching the order', async () => {
    const o = await placeOrder('ONLINE');
    // A second, separate payment for the same order succeeds at the provider.
    await db.payment.create({ data: { orderId: o.id, provider: 'MOCK', reference: `DUP-${o.code}`, amountKobo: o.total, status: 'INITIALIZED' } });
    await mock.initialize({ reference: `DUP-${o.code}`, amountKobo: o.total, email: 'x@chopnow.test', callbackUrl: 'http://x', metadata: {} });
    mock.complete(`DUP-${o.code}`, 'success');
    await services.payments.verifyAndApply(`DUP-${o.code}`, 'reconciliation');
    const dup = await db.payment.findUniqueOrThrow({ where: { reference: `DUP-${o.code}` } });
    expect(line(await journal(`payment:${dup.id}:unapplied`), 'REFUNDS_PAYABLE')).toBe(o.total);

    const r = await db.refund.findFirstOrThrow({ where: { paymentId: dup.id } });
    const approved = await request(app).post(`${F}/refunds/${r.id}/approve`).set(as('finance')).send({});
    expect(approved.body).toMatchObject({ status: 'SUCCESSFUL', chargeTo: 'UNAPPLIED_PAYMENT' });
    expect(await journal(`refund:${r.id}:approved`)).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe('SUCCESSFUL');
    // The customer then cancels: the real payment gets its own refund (from customer funds).
    await request(app).post(`/v1/orders/${o.id}/cancel`).set(as('ada')).send({});
    const real = await db.refund.findFirstOrThrow({ where: { orderId: o.id, paymentId: { not: dup.id } } });
    expect((await request(app).post(`${F}/refunds/${real.id}/approve`).set(as('finance')).send({})).body).toMatchObject({ status: 'SUCCESSFUL', chargeTo: 'CUSTOMER_FUNDS' });
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe('REFUNDED');
  });

  it('two finance staff approving at once refund once', async () => {
    const o = await deliver('ONLINE');
    const req = await request(app).post(`/v1/admin/orders/${o.id}/refunds`).set(as('support')).send({ amountKobo: 10_000, reason: 'Packaging leaked' });
    const results = await Promise.all([
      request(app).post(`${F}/refunds/${req.body.id}/approve`).set(as('finance')).send({ chargeTo: 'PLATFORM' }),
      request(app).post(`${F}/refunds/${req.body.id}/approve`).set(as('admin')).send({ chargeTo: 'PLATFORM' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.financialTransaction.count({ where: { refundId: req.body.id } })).toBe(2); // approved + paid, once each
  });
});

describe('rider cash hand-ins', () => {
  let core1: string;
  beforeAll(async () => {
    core1 = (await db.rider.findFirstOrThrow({ where: { user: { email: seededEmail('rider.core1') } } })).id;
  });

  it('shows what each rider holds, and a rider cannot declare more than that', async () => {
    const pos = await request(app).get(`${F}/cash`).set(as('finance'));
    const mine = pos.body.items.find((p: { riderId: string }) => p.riderId === core1);
    expect(mine.outstandingKobo).toBe(-(await balance('RIDER_CASH_HELD', { riderId: core1 })) * -1);
    const over = await request(app).post('/v1/rider/remittances').set(as('rider.core1')).send({ amountKobo: mine.outstandingKobo + 1, reference: 'TRF-OVER' });
    expect(over.status).toBe(422);
    expect((await request(app).get(`${F}/cash`).set(as('support'))).status).toBe(403);
  });

  it('a declared transfer clears the oldest cash first once finance confirms it', async () => {
    const held = await balance('RIDER_CASH_HELD', { riderId: core1 });
    const oldest = await db.cashCollection.findFirstOrThrow({ where: { riderId: core1, reconciliationStatus: 'OUTSTANDING' }, orderBy: { collectedAt: 'asc' } });
    const part = oldest.amountCollectedKobo + 1000;
    const dec = await request(app).post('/v1/rider/remittances').set(as('rider.core1')).send({ amountKobo: part, reference: 'OPAY-55120' });
    expect(dec.body).toMatchObject({ status: 'PENDING_CONFIRMATION', method: 'BANK_TRANSFER' });
    expect((await request(app).post('/v1/rider/remittances').set(as('rider.core1')).send({ amountKobo: held - part + 1, reference: 'TOO-MUCH' })).status).toBe(422);

    const ok = await request(app).post(`${F}/remittances/${dec.body.id}/confirm`).set(as('finance')).send();
    expect(ok.body.status).toBe('CONFIRMED');
    expect(ok.body.allocations[0]).toMatchObject({ amountKobo: oldest.amountCollectedKobo });
    expect(ok.body.allocations[1].amountKobo).toBe(1000);
    expect(await db.cashCollection.findUniqueOrThrow({ where: { id: oldest.id } })).toMatchObject({ reconciliationStatus: 'RECONCILED' });
    expect(await balance('RIDER_CASH_HELD', { riderId: core1 })).toBe(held - part);
    expect((await request(app).post(`${F}/remittances/${dec.body.id}/confirm`).set(as('finance')).send()).status).toBe(409);
    const mine = await request(app).get('/v1/rider/remittances').set(as('rider.core1'));
    expect(mine.body.items[0]).toMatchObject({ id: dec.body.id, status: 'CONFIRMED' });
  });

  it('finance can record a counted hand-in directly, reject unmatched ones, and never over-clear', async () => {
    const held = await balance('RIDER_CASH_HELD', { riderId: core1 });
    const bad = await request(app).post('/v1/rider/remittances').set(as('rider.core1')).send({ amountKobo: 1000, reference: 'UNKNOWN-1' });
    expect((await request(app).post(`${F}/remittances/${bad.body.id}/reject`).set(as('finance')).send({ reason: 'Not on the bank statement' })).body.status).toBe('REJECTED');
    const over = await request(app).post(`${F}/remittances`).set(as('finance')).send({ riderId: core1, amountKobo: held + 1, method: 'CASH_HANDOVER' });
    expect(over.status).toBe(409);
    const all = await request(app).post(`${F}/remittances`).set(as('finance')).send({ riderId: core1, amountKobo: held, method: 'CASH_HANDOVER', note: 'Counted at Yaba office' });
    expect(all.status).toBe(201);
    expect(await balance('RIDER_CASH_HELD', { riderId: core1 })).toBe(0);
    expect((await request(app).get('/v1/rider/me').set(as('rider.core1'))).body.outstandingCashKobo).toBe(0);
  });
});

describe('settlements and payouts', () => {
  const V = (id: string) => `${F}/settlements/vendor/${id}`;
  let vendorSettlement: { id: string; netPayableKobo: number };

  it('refuses periods that have not ended', async () => {
    const res = await request(app).post(`${F}/settlements/generate`).set(as('finance')).send({ from: '2026-10-14', to: '2026-10-14' });
    expect(res.status).toBe(422);
  });

  it('a week’s settlement matches what the ledger owes the restaurant and the rider', async () => {
    setLagos('2026-10-15');
    const res = await request(app).post(`${F}/settlements/generate`).set(as('finance')).send({ from: '2026-10-12', to: '2026-10-14' });
    expect(res.status).toBe(200);
    expect(res.body.created).toBeGreaterThanOrEqual(2);
    const list = await request(app).get(`${F}/settlements`).query({ status: 'DRAFT' }).set(as('finance'));
    const mama = list.body.items.find((s: { kind: string; restaurantName: string }) => s.kind === 'VENDOR' && s.restaurantName.startsWith('Mama'));
    const owed = -(await balance('VENDOR_PAYABLE', { restaurantId: mamaId }));
    expect(mama.netPayableKobo).toBe(owed);
    expect(mama.from).toBe('2026-10-12');
    expect(mama.to).toBe('2026-10-14');
    expect(mama.grossSalesKobo - mama.commissionKobo - mama.restaurantFundedDiscountKobo - mama.refundDeductionsKobo + mama.adjustmentsKobo).toBe(mama.netPayableKobo);
    expect(mama.refundDeductionsKobo).toBe(120_000); // the two refunds charged to the restaurant
    vendorSettlement = mama;

    const rider = list.body.items.find((s: { kind: string }) => s.kind === 'RIDER');
    expect(rider.netPayableKobo).toBe(-(await balance('RIDER_PAYABLE', { riderId: rider.riderId })));
    expect(rider.deliveryCount).toBeGreaterThanOrEqual(7);
    expect(await db.riderEarning.count({ where: { settlementId: rider.id } })).toBe(rider.deliveryCount);

    const again = await request(app).post(`${F}/settlements/generate`).set(as('finance')).send({ from: '2026-10-13', to: '2026-10-14' });
    expect(again.body.created).toBe(0);
    expect(again.body.skipped.map((s: { reason: string }) => s.reason)).toContain('Already settled for an overlapping period');
  });

  it('restaurants don’t see drafts; after approval they see their own statement only', async () => {
    const before = await request(app).get(`/v1/vendor/restaurants/${mamaId}/settlements`).set(as('vendor.mamankechi'));
    expect(before.body.items).toHaveLength(0);
    expect((await request(app).post(`${V(vendorSettlement.id)}/approve`).set(as('finance')).send()).body.status).toBe('APPROVED');
    const after = await request(app).get(`/v1/vendor/restaurants/${mamaId}/settlements`).set(as('vendor.mamankechi'));
    expect(after.body.items[0]).toMatchObject({ id: vendorSettlement.id, status: 'APPROVED' });
    expect((await request(app).get(`/v1/vendor/restaurants/${mamaId}/settlements`).set(bearer(bukkaVendor))).status).toBe(404);
  });

  it('a payout is booked only when finance records the bank transfer; a failed one can be retried', async () => {
    const started = await request(app).post(`${V(vendorSettlement.id)}/payout`).set(as('finance')).send();
    expect(started.body.status).toBe('PAYOUT_INITIATED');
    const payout = started.body.payouts[0];
    expect(payout).toMatchObject({ status: 'INITIATED', amountKobo: vendorSettlement.netPayableKobo });
    expect(payout.reference).toMatch(/^PO-[A-Z0-9]{8}$/);
    expect((await request(app).post(`${V(vendorSettlement.id)}/payout`).set(as('finance')).send()).status).toBe(409);
    expect(await db.financialTransaction.count({ where: { type: 'PAYOUT' } })).toBe(0);

    const failed = await request(app).post(`${F}/payouts/${payout.id}/fail`).set(as('finance')).send({ reason: 'Account name mismatch' });
    expect(failed.body.status).toBe('FAILED');
    const retry = await request(app).post(`${V(vendorSettlement.id)}/payout`).set(as('finance')).send();
    const second = retry.body.payouts.find((p: { status: string }) => p.status === 'INITIATED');
    const paid = await request(app).post(`${F}/payouts/${second.id}/complete`).set(as('finance')).send({ bankReference: 'NIP-000123456789' });
    expect(paid.body.status).toBe('PAID');
    expect(await balance('VENDOR_PAYABLE', { restaurantId: mamaId })).toBe(0);
    expect((await request(app).post(`${F}/payouts/${second.id}/complete`).set(as('finance')).send({ bankReference: 'AGAIN' })).status).toBe(409);
    expect(await db.auditLog.count({ where: { action: { in: ['payout.initiate', 'payout.fail', 'payout.complete'] } } })).toBe(4);
  });

  it('a refund charged to the restaurant after settlement carries into the next one', async () => {
    const o = await db.order.findFirstOrThrow({ where: { restaurantId: mamaId, status: 'DELIVERED', paymentMethod: 'ONLINE', paymentStatus: 'SUCCESSFUL' }, orderBy: { placedAt: 'asc' } });
    setLagos('2026-10-16');
    const req = await request(app).post(`/v1/admin/orders/${o.id}/refunds`).set(as('support')).send({ amountKobo: 40_000, reason: 'Late complaint: wrong rice' });
    await request(app).post(`${F}/refunds/${req.body.id}/approve`).set(as('finance')).send({ chargeTo: 'RESTAURANT' });
    setLagos('2026-10-17');
    await request(app).post(`${F}/settlements/generate`).set(as('finance')).send({ from: '2026-10-15', to: '2026-10-16', kind: 'VENDOR' });
    const s = (await request(app).get(`${F}/settlements`).query({ kind: 'VENDOR', status: 'DRAFT' }).set(as('finance'))).body.items.find((x: { restaurantId: string }) => x.restaurantId === mamaId);
    expect(s).toMatchObject({ netPayableKobo: -40_000, refundDeductionsKobo: 40_000, orderCount: 0 });
    const approved = await request(app).post(`${V(s.id)}/approve`).set(as('finance')).send();
    expect(approved.body.note).toMatch(/carried forward/);
    expect((await request(app).post(`${V(s.id)}/payout`).set(as('finance')).send()).body.error.code).toBe('NOTHING_TO_PAY');

    const next = await deliver('ONLINE');
    setLagos('2026-10-18');
    await request(app).post(`${F}/settlements/generate`).set(as('finance')).send({ from: '2026-10-17', to: '2026-10-17', kind: 'VENDOR' });
    const s2 = (await request(app).get(`${F}/settlements`).query({ kind: 'VENDOR', status: 'DRAFT' }).set(as('finance'))).body.items.find((x: { restaurantId: string }) => x.restaurantId === mamaId);
    const order = await db.order.findUniqueOrThrow({ where: { id: next.id } });
    expect(s2.netPayableKobo).toBe(order.subtotalKobo - order.commissionKobo - 40_000);
    expect(s2.adjustmentsKobo).toBe(-40_000);
    expect(s2.netPayableKobo).toBe(-(await balance('VENDOR_PAYABLE', { restaurantId: mamaId })));
  });

  it('riders get paid too, and their earnings are marked settled', async () => {
    const rider = (await request(app).get(`${F}/settlements`).query({ kind: 'RIDER', status: 'DRAFT' }).set(as('finance'))).body.items[0];
    await request(app).post(`${F}/settlements/rider/${rider.id}/approve`).set(as('finance')).send();
    const p = (await request(app).post(`${F}/settlements/rider/${rider.id}/payout`).set(as('finance')).send()).body.payouts[0];
    await request(app).post(`${F}/payouts/${p.id}/complete`).set(as('finance')).send({ bankReference: 'NIP-RIDER-1' });
    expect(await db.riderEarning.count({ where: { settlementId: rider.id, status: { not: 'SETTLED' } } })).toBe(0);
    const own = await request(app).get('/v1/rider/settlements').set(as('rider.core1'));
    expect(own.body.items[0]).toMatchObject({ id: rider.id, status: 'PAID' });
    expect((await request(app).get('/v1/rider/earnings').query({ from: '2026-10-12', to: '2026-10-18' }).set(as('rider.core1'))).body.unsettledKobo).toBe(40_000); // only the newest delivery
  });
});

describe('finance summary', () => {
  it('reports revenue from the ledger and the books always balance', async () => {
    const res = await request(app).get(`${F}/summary`).query({ from: '2026-10-12', to: '2026-10-18' }).set(as('finance'));
    expect(res.status).toBe(200);
    expect(res.body.trialBalance.balanced).toBe(true);
    const delivered = await db.order.findMany({ where: { status: 'DELIVERED', financialTransactions: { some: { type: 'ORDER_SETTLED' } } } });
    expect(res.body.deliveredOrders).toBe(delivered.length);
    expect(res.body.revenue.commissionKobo).toBe(delivered.reduce((s, o) => s + o.commissionKobo, 0));
    expect(res.body.revenue.totalKobo).toBe(res.body.revenue.commissionKobo + res.body.revenue.deliveryMarginKobo + res.body.revenue.serviceFeesKobo);
    expect(res.body.balances).toMatchObject({ refundsOwedKobo: 0, cashHeldByRidersKobo: 0, customerFundsHeldKobo: 0 });
    expect(res.body.balances.owedToRestaurantsKobo).toBe(-(await balance('VENDOR_PAYABLE')));
    expect((await request(app).get(`${F}/summary`).query({ from: '2026-10-12', to: '2026-10-18' }).set(as('ops'))).status).toBe(403);
  });
});
