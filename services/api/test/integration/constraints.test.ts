/**
 * Verifies the database itself rejects invalid states, independently of application code.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDevelopmentData } from '../../src/db/seed/dev-seed.js';
import { createTestDb, resetDb } from './helpers.js';

const db = createTestDb();

beforeAll(async () => {
  await resetDb(db);
  await seedDevelopmentData(db, { appEnv: 'test' });
}, 120_000);
afterAll(() => db.$disconnect());

const pendingRestaurant = () => db.restaurant.findUniqueOrThrow({ where: { slug: 'grandmas-pot' } });
const anyOrder = () => db.order.findFirstOrThrow({ where: { status: 'DELIVERED' } });

describe('approval rules', () => {
  it('an unapproved restaurant cannot be set to accept orders', async () => {
    const r = await pendingRestaurant();
    await expect(db.restaurant.update({ where: { id: r.id }, data: { isAcceptingOrders: true } })).rejects.toThrow(
      /restaurants_accepting_requires_approval_chk/,
    );
  });

  it('an unapproved rider cannot go online', async () => {
    const r = await db.rider.findFirstOrThrow({ where: { verificationStatus: 'PENDING' } });
    await expect(db.rider.update({ where: { id: r.id }, data: { availability: 'ONLINE' } })).rejects.toThrow(
      /riders_online_requires_approval_chk/,
    );
  });
});

describe('order integrity', () => {
  it('rejects a total that does not equal subtotal + fees - discount', async () => {
    const o = await anyOrder();
    await expect(db.order.update({ where: { id: o.id }, data: { totalKobo: o.totalKobo + 1 } })).rejects.toThrow(/orders_total_formula_chk/);
  });

  it('rejects negative money and malformed delivery PINs', async () => {
    const o = await anyOrder();
    await expect(db.order.update({ where: { id: o.id }, data: { discountKobo: -100, totalKobo: o.totalKobo + 100 } })).rejects.toThrow(
      /orders_amounts_nonneg_chk/,
    );
    await expect(db.order.update({ where: { id: o.id }, data: { deliveryPin: '12a4' } })).rejects.toThrow(/orders_delivery_pin_chk/);
  });

  it('order status history is append-only', async () => {
    const h = await db.orderStatusHistory.findFirstOrThrow();
    await expect(db.orderStatusHistory.update({ where: { id: h.id }, data: { reason: 'edited' } })).rejects.toThrow(/append-only/);
    await expect(db.orderStatusHistory.delete({ where: { id: h.id } })).rejects.toThrow(/append-only/);
  });

  it('allows at most one successful payment per order', async () => {
    const o = await anyOrder();
    await db.payment.create({ data: { orderId: o.id, provider: 'MOCK', reference: `T1-${o.id}`, amountKobo: o.totalKobo, status: 'SUCCESSFUL' } });
    await expect(
      db.payment.create({ data: { orderId: o.id, provider: 'MOCK', reference: `T2-${o.id}`, amountKobo: o.totalKobo, status: 'SUCCESSFUL' } }),
    ).rejects.toThrow(/Unique constraint|payments_one_success_per_order_idx/);
  });

  it('treats a repeated webhook (same provider + dedupe key) as a duplicate', async () => {
    const data = { provider: 'PAYSTACK' as const, source: 'webhook', eventType: 'charge.success', dedupeKey: 'evt-123', signatureValid: true, payload: {} };
    await db.paymentEvent.create({ data });
    await expect(db.paymentEvent.create({ data })).rejects.toThrow(/Unique constraint/);
  });
});

describe('delivery integrity', () => {
  it('a delivery cannot be DELIVERED without pickup and proof of delivery', async () => {
    const d = await db.delivery.findFirstOrThrow({ where: { status: 'OFFERING' } });
    const rider = await db.rider.findFirstOrThrow({ where: { riderType: 'INDEPENDENT', verificationStatus: 'APPROVED' } });
    await expect(
      db.delivery.update({ where: { id: d.id }, data: { status: 'DELIVERED', currentRiderId: rider.id, deliveredAt: new Date() } }),
    ).rejects.toThrow(/deliveries_delivered_proof_chk/);
  });

  it('an assigned delivery must have a rider', async () => {
    const d = await db.delivery.findFirstOrThrow({ where: { status: 'OFFERING' } });
    await expect(db.delivery.update({ where: { id: d.id }, data: { status: 'ASSIGNED' } })).rejects.toThrow(/deliveries_rider_required_chk/);
  });

  it('a rider can hold only one active delivery and a delivery only one accepted offer', async () => {
    const d = await db.delivery.findFirstOrThrow({ where: { status: 'OFFERING' } });
    const [r1, r2] = await db.rider.findMany({ where: { verificationStatus: 'APPROVED' }, take: 2 });
    const expiresAt = new Date(Date.now() + 45_000);
    await db.deliveryOffer.create({ data: { deliveryId: d.id, riderId: r1!.id, tier: r1!.riderType, status: 'ACCEPTED', expiresAt } });
    await expect(
      db.deliveryOffer.create({ data: { deliveryId: d.id, riderId: r2!.id, tier: r2!.riderType, status: 'ACCEPTED', expiresAt } }),
    ).rejects.toThrow(/Unique constraint/);

    // Make a second active delivery for r1 and confirm the partial unique index blocks it.
    await db.delivery.update({ where: { id: d.id }, data: { status: 'ASSIGNED', currentRiderId: r1!.id } });
    const other = await db.order.findFirstOrThrow({ where: { status: 'PLACED' } });
    await expect(
      db.delivery.create({ data: { orderId: other.id, status: 'ASSIGNED', currentRiderId: r1!.id } }),
    ).rejects.toThrow(/Unique constraint/);
  });
});

describe('cash on delivery', () => {
  it('cannot record more cash collected than due, or reconcile more than collected', async () => {
    const c = await db.cashCollection.findFirstOrThrow({ where: { status: 'COLLECTED' } });
    await expect(db.cashCollection.update({ where: { id: c.id }, data: { amountCollectedKobo: c.amountDueKobo + 1 } })).rejects.toThrow(
      /cash_collections_amounts_chk/,
    );
    await expect(db.cashCollection.update({ where: { id: c.id }, data: { amountReconciledKobo: c.amountCollectedKobo + 1 } })).rejects.toThrow(
      /cash_collections_amounts_chk/,
    );
  });
});

describe('financial ledger', () => {
  it('commits a balanced journal and rejects an unbalanced one at commit time', async () => {
    const o = await anyOrder();
    const restaurantId = o.restaurantId;
    await db.financialTransaction.create({
      data: {
        type: 'ADJUSTMENT', idempotencyKey: `bal-${o.id}`, orderId: o.id, description: 'test balanced',
        entries: { create: [
          { account: 'ADJUSTMENTS', direction: 'DEBIT', amountKobo: 1000 },
          { account: 'VENDOR_PAYABLE', direction: 'CREDIT', amountKobo: 1000, restaurantId },
        ] },
      },
    });

    await expect(
      db.financialTransaction.create({
        data: {
          type: 'ADJUSTMENT', idempotencyKey: `unbal-${o.id}`, orderId: o.id, description: 'test unbalanced',
          entries: { create: [
            { account: 'ADJUSTMENTS', direction: 'DEBIT', amountKobo: 1000 },
            { account: 'VENDOR_PAYABLE', direction: 'CREDIT', amountKobo: 900, restaurantId },
          ] },
        },
      }),
    ).rejects.toThrow(/unbalanced/);
    expect(await db.financialTransaction.count({ where: { idempotencyKey: `unbal-${o.id}` } })).toBe(0);
  });

  it('posts each business event at most once (idempotency key) and never edits history', async () => {
    const o = await anyOrder();
    const tx = await db.financialTransaction.findUniqueOrThrow({ where: { idempotencyKey: `bal-${o.id}` }, include: { entries: true } });
    await expect(
      db.financialTransaction.create({ data: { type: 'ADJUSTMENT', idempotencyKey: `bal-${o.id}`, description: 'dup' } }),
    ).rejects.toThrow(/Unique constraint/);
    await expect(db.ledgerEntry.update({ where: { id: tx.entries[0]!.id }, data: { amountKobo: 1 } })).rejects.toThrow(/append-only/);
    await expect(db.financialTransaction.delete({ where: { id: tx.id } })).rejects.toThrow(/append-only|foreign key/);
  });

  it('vendor-payable entries must name the restaurant', async () => {
    await expect(
      db.financialTransaction.create({
        data: {
          type: 'ADJUSTMENT', idempotencyKey: 'no-subledger', description: 'missing restaurant',
          entries: { create: [
            { account: 'ADJUSTMENTS', direction: 'DEBIT', amountKobo: 500 },
            { account: 'VENDOR_PAYABLE', direction: 'CREDIT', amountKobo: 500 },
          ] },
        },
      }),
    ).rejects.toThrow(/ledger_entries_subledger_chk/);
  });
});
