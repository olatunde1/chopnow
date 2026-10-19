import { initialVariantId, priceSelection } from './menu-pricing';

const jollof = {
  id: 'item-1',
  name: 'Jollof Rice',
  priceKobo: 250000,
  isAvailable: true,
  variants: [
    { id: 'v-reg', name: 'Regular', priceKobo: 250000, isDefault: true, isAvailable: true },
    { id: 'v-lg', name: 'Large', priceKobo: 350000, isDefault: false, isAvailable: true },
    { id: 'v-xl', name: 'Party tray', priceKobo: 900000, isDefault: false, isAvailable: false },
  ],
  extras: [
    { id: 'e-chicken', name: 'Fried chicken', priceKobo: 150000, maxQuantity: 2, isAvailable: true },
    { id: 'e-plantain', name: 'Plantain', priceKobo: 50000, maxQuantity: 1, isAvailable: true },
    { id: 'e-egg', name: 'Egg', priceKobo: 30000, maxQuantity: 1, isAvailable: false },
  ],
};

describe('menu pricing preview', () => {
  it('preselects the default available variant', () => {
    expect(initialVariantId(jollof)).toBe('v-reg');
    const noDefault = { ...jollof, variants: jollof.variants.map((v) => ({ ...v, isDefault: false, isAvailable: v.id !== 'v-reg' })) };
    expect(initialVariantId(noDefault)).toBe('v-lg');
  });

  it('prices variant + extras × quantity in integer kobo', () => {
    const r = priceSelection(jollof, { variantId: 'v-lg', extras: { 'e-chicken': 2, 'e-plantain': 1 }, quantity: 3 });
    expect(r.ok).toBe(true);
    expect(r.unitPriceKobo).toBe(350000 + 2 * 150000 + 50000);
    expect(r.lineTotalKobo).toBe(3 * 700000);
    expect(r.extras).toEqual([
      { id: 'e-chicken', name: 'Fried chicken', priceKobo: 150000, quantity: 2 },
      { id: 'e-plantain', name: 'Plantain', priceKobo: 50000, quantity: 1 },
    ]);
  });

  it('requires a variant when the item has variants', () => {
    const r = priceSelection(jollof, { variantId: null, extras: {}, quantity: 1 });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/choose/i);
  });

  it('rejects sold-out variants and extras, and over-limit extras', () => {
    expect(priceSelection(jollof, { variantId: 'v-xl', extras: {}, quantity: 1 }).ok).toBe(false);
    expect(priceSelection(jollof, { variantId: 'v-reg', extras: { 'e-egg': 1 }, quantity: 1 }).ok).toBe(false);
    expect(priceSelection(jollof, { variantId: 'v-reg', extras: { 'e-chicken': 3 }, quantity: 1 }).problems.join()).toMatch(/up to 2/);
  });

  it('rejects sold-out items and bad quantities', () => {
    expect(priceSelection({ ...jollof, isAvailable: false }, { variantId: 'v-reg', extras: {}, quantity: 1 }).ok).toBe(false);
    expect(priceSelection(jollof, { variantId: 'v-reg', extras: {}, quantity: 0 }).ok).toBe(false);
    expect(priceSelection(jollof, { variantId: 'v-reg', extras: {}, quantity: 21 }).ok).toBe(false);
  });

  it('uses the base price for items without variants', () => {
    const chapman = { id: 'c', name: 'Chapman', priceKobo: 120000, isAvailable: true, variants: [], extras: [] };
    expect(priceSelection(chapman, { variantId: null, extras: {}, quantity: 2 }).lineTotalKobo).toBe(240000);
  });
});
