import { describe, expect, it } from 'vitest';
import { applyBasisPoints, formatMinor, parseMajorToMinor, sumMinor } from '../src/money.js';

describe('money', () => {
  it('parses major-unit strings into integer kobo without float error', () => {
    expect(parseMajorToMinor('2500')).toBe(250000);
    expect(parseMajorToMinor('2500.5')).toBe(250050);
    expect(parseMajorToMinor('0.10')).toBe(10);
    expect(parseMajorToMinor('-12.34')).toBe(-1234);
    expect(() => parseMajorToMinor('12.345')).toThrow();
    expect(() => parseMajorToMinor('abc')).toThrow();
  });

  it('formats kobo for display', () => {
    expect(formatMinor(250000)).toBe('₦2,500');
    expect(formatMinor(250050)).toBe('₦2,500.50');
    expect(formatMinor(123456789, { showKobo: true })).toBe('₦1,234,567.89');
    expect(formatMinor(-500)).toBe('-₦5');
  });

  it('applies basis points with half-up rounding', () => {
    expect(applyBasisPoints(250000, 1500)).toBe(37500);
    expect(applyBasisPoints(333, 1500)).toBe(50); // 49.95 -> 50
    expect(applyBasisPoints(1, 4999)).toBe(0);
    expect(() => applyBasisPoints(100, 1.5)).toThrow();
  });

  it('rejects non-integer amounts', () => {
    expect(() => sumMinor([100, 0.5])).toThrow();
    expect(sumMinor([100, 250, -50])).toBe(300);
  });
});
