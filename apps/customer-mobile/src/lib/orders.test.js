import { createIdempotencyTracker, isTerminal, paymentLabel, statusLabel, toOrderItems } from './orders';

describe('toOrderItems', () => {
  it('sends ids and quantities only, never prices', () => {
    const items = toOrderItems([
      {
        key: 'k',
        menuItemId: 'm1',
        name: 'Jollof Rice',
        variantId: 'v1',
        variantName: 'Large',
        extras: [
          { id: 'e1', name: 'Chicken', priceKobo: 150000, quantity: 2 },
          { id: 'e2', name: 'Plantain', priceKobo: 50000, quantity: 0 },
        ],
        quantity: 3,
        unitPriceKobo: 650000,
        instructions: 'less pepper',
      },
      { key: 'k2', menuItemId: 'm2', name: 'Chapman', variantId: null, extras: [], quantity: 1, unitPriceKobo: 120000 },
    ]);
    expect(items).toEqual([
      { menuItemId: 'm1', variantId: 'v1', extras: [{ extraId: 'e1', quantity: 2 }], quantity: 3, specialInstructions: 'less pepper' },
      { menuItemId: 'm2', variantId: null, extras: [], quantity: 1 },
    ]);
    expect(JSON.stringify(items)).not.toMatch(/Kobo|price/i);
  });
});

describe('idempotency tracker', () => {
  const req = { restaurantId: 'r', items: [{ menuItemId: 'm', quantity: 1 }] };

  it('reuses the key when retrying after a network failure or "in progress"', () => {
    const t = createIdempotencyTracker();
    const k1 = t.keyFor(req);
    t.settle({ code: 'NETWORK_ERROR', status: 0 });
    expect(t.keyFor(req)).toBe(k1);
    t.settle({ status: 409, code: 'REQUEST_IN_PROGRESS' });
    expect(t.keyFor(req)).toBe(k1);
  });

  it('uses a new key after success, a definitive rejection, or a changed request', () => {
    const t = createIdempotencyTracker();
    const k1 = t.keyFor(req);
    t.settle(null);
    const k2 = t.keyFor(req);
    expect(k2).not.toBe(k1);
    t.settle({ status: 422, code: 'ORDER_NOT_PLACEABLE' });
    const k3 = t.keyFor(req);
    expect(k3).not.toBe(k2);
    expect(t.keyFor({ ...req, promoCode: 'WELCOME10' })).not.toBe(k3);
    expect(k1).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });
});

describe('labels', () => {
  it('describes statuses and payment in plain language', () => {
    expect(statusLabel('READY_FOR_PICKUP')).toBe('Ready for pickup');
    expect(paymentLabel({ paymentMethod: 'CASH_ON_DELIVERY', paymentStatus: 'PENDING' })).toBe('Pay cash on delivery');
    expect(paymentLabel({ paymentMethod: 'ONLINE', paymentStatus: 'PENDING' })).toBe('Awaiting payment');
    expect(paymentLabel({ paymentMethod: 'ONLINE', paymentStatus: 'REFUND_PENDING' })).toBe('Refund in progress');
    expect(isTerminal('DELIVERED')).toBe(true);
    expect(isTerminal('PICKED_UP')).toBe(false);
  });
});
