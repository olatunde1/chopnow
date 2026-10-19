import { describe, expect, it } from 'vitest';
import { slugify } from '../src/modules/catalog/vendor-catalog.service.js';

describe('slugify', () => {
  it('makes URL-safe restaurant slugs', () => {
    expect(slugify("Mama Nkechi's Kitchen")).toBe('mama-nkechis-kitchen');
    expect(slugify('Mama Nkechi’s Kitchen')).toBe('mama-nkechis-kitchen');
    expect(slugify('Café Àbúlé  &  Grill!')).toBe('cafe-abule-grill');
    expect(slugify('   ')).toBe('restaurant');
    expect(slugify('x'.repeat(100))).toHaveLength(60);
  });
});
