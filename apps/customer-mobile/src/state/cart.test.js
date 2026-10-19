jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { MAX_LINE_QUANTITY, cartSelectors, lineKey, useCart } from './cart';

const mama = { id: 'r-mama', slug: 'mama', name: "Mama Nkechi's Kitchen", minOrderKobo: 0 };
const bukka = { id: 'r-bukka', slug: 'bukka', name: 'Bukka Republic', minOrderKobo: 150000 };
const line = (over = {}) => ({
  menuItemId: 'item-jollof',
  name: 'Jollof Rice',
  variantId: 'v-lg',
  variantName: 'Large',
  extras: [{ id: 'e-chicken', name: 'Fried chicken', priceKobo: 150000, quantity: 1 }],
  quantity: 1,
  unitPriceKobo: 500000,
  ...over,
});

beforeEach(() => useCart.getState().clear());

describe('cart', () => {
  it('adds lines and totals them', () => {
    expect(useCart.getState().addLine(mama, line())).toBe('ADDED');
    useCart.getState().addLine(mama, line({ menuItemId: 'item-chapman', name: 'Chapman', variantId: null, extras: [], unitPriceKobo: 120000, quantity: 2 }));
    const s = useCart.getState();
    expect(s.restaurant.id).toBe('r-mama');
    expect(cartSelectors.count(s)).toBe(3);
    expect(cartSelectors.subtotalKobo(s)).toBe(500000 + 240000);
  });

  it('merges identical configurations but keeps different ones apart', () => {
    useCart.getState().addLine(mama, line());
    useCart.getState().addLine(mama, line({ quantity: 2 }));
    expect(useCart.getState().lines).toHaveLength(1);
    expect(useCart.getState().lines[0].quantity).toBe(3);

    useCart.getState().addLine(mama, line({ extras: [] }));
    useCart.getState().addLine(mama, line({ instructions: 'no pepper' }));
    expect(useCart.getState().lines).toHaveLength(3);
  });

  it('treats extras in any order as the same configuration', () => {
    const a = { id: 'a', quantity: 1 };
    const b = { id: 'b', quantity: 2 };
    expect(lineKey({ menuItemId: 'x', variantId: null, extras: [a, b] })).toBe(lineKey({ menuItemId: 'x', variantId: null, extras: [b, a] }));
  });

  it('allows one restaurant per cart and requires an explicit replace', () => {
    useCart.getState().addLine(mama, line());
    expect(useCart.getState().addLine(bukka, line({ menuItemId: 'item-party' }))).toBe('DIFFERENT_RESTAURANT');
    expect(useCart.getState().restaurant.id).toBe('r-mama');
    expect(useCart.getState().lines).toHaveLength(1);

    useCart.getState().replaceWith(bukka, line({ menuItemId: 'item-party' }));
    expect(useCart.getState().restaurant.id).toBe('r-bukka');
    expect(useCart.getState().lines.map((l) => l.menuItemId)).toEqual(['item-party']);
  });

  it('caps quantity and removes lines at zero; empty cart forgets the restaurant', () => {
    useCart.getState().addLine(mama, line({ quantity: 50 }));
    const key = useCart.getState().lines[0].key;
    expect(useCart.getState().lines[0].quantity).toBe(MAX_LINE_QUANTITY);
    useCart.getState().setQuantity(key, 0);
    expect(useCart.getState().lines).toHaveLength(0);
    expect(useCart.getState().restaurant).toBeNull();
  });
});
