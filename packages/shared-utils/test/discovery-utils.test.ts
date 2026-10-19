import { describe, expect, it } from 'vitest';
import { distanceMeters, isValidLatLng } from '../src/geo.js';
import { hhmmToMinutes, isOpenAt, localDayAndMinute, minutesToHHMM, validateOpeningWindows } from '../src/hours.js';
import { computeCommission, computeDeliveryFee, computeRiderEarning, computeServiceFee, type PricingRules } from '../src/pricing.js';

const rules: PricingRules = {
  commissionBps: 1500,
  deliveryBaseFeeKobo: 50_000,
  deliveryIncludedMeters: 2000,
  deliveryPerKmKobo: 10_000,
  deliveryFeeCapKobo: 150_000,
  riderShareOfDeliveryBps: 8000,
  riderMinEarningKobo: 40_000,
  serviceFeeBps: 500,
  serviceFeeMinKobo: 5_000,
  serviceFeeMaxKobo: 30_000,
};

describe('geo', () => {
  it('computes straight-line distance', () => {
    const yaba = { latitude: 6.5095, longitude: 3.3711 };
    expect(distanceMeters(yaba, yaba)).toBe(0);
    // ~0.01 degrees latitude ≈ 1.11 km
    expect(distanceMeters(yaba, { latitude: 6.5195, longitude: 3.3711 })).toBeGreaterThan(1100);
    expect(distanceMeters(yaba, { latitude: 6.5195, longitude: 3.3711 })).toBeLessThan(1120);
  });

  it('validates coordinates', () => {
    expect(isValidLatLng({ latitude: 6.5, longitude: 3.3 })).toBe(true);
    expect(isValidLatLng({ latitude: 91, longitude: 3.3 })).toBe(false);
    expect(isValidLatLng({ latitude: Number.NaN, longitude: 3.3 })).toBe(false);
    expect(isValidLatLng(null)).toBe(false);
  });
});

describe('opening hours (Africa/Lagos, UTC+1)', () => {
  const daily = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, opensAt: 8 * 60, closesAt: 22 * 60 }));

  it('converts UTC instants to Lagos local time', () => {
    // 2026-10-14 is a Wednesday. 07:30Z = 08:30 Lagos.
    expect(localDayAndMinute(new Date('2026-10-14T07:30:00Z'))).toEqual({ dayOfWeek: 3, minute: 510 });
    // 23:30Z Wednesday = 00:30 Thursday in Lagos.
    expect(localDayAndMinute(new Date('2026-10-14T23:30:00Z'))).toEqual({ dayOfWeek: 4, minute: 30 });
  });

  it('is open inside a window and closed outside', () => {
    expect(isOpenAt(daily, new Date('2026-10-14T07:30:00Z'))).toBe(true); // 08:30
    expect(isOpenAt(daily, new Date('2026-10-14T06:30:00Z'))).toBe(false); // 07:30
    expect(isOpenAt(daily, new Date('2026-10-14T21:00:00Z'))).toBe(false); // 22:00 (closing minute is exclusive)
    expect(isOpenAt([], new Date())).toBe(false);
  });

  it('rejects invalid or overlapping windows', () => {
    expect(validateOpeningWindows(daily)).toBeNull();
    expect(validateOpeningWindows([{ dayOfWeek: 1, opensAt: 600, closesAt: 500 }])).toMatch(/open before/);
    expect(validateOpeningWindows([{ dayOfWeek: 7, opensAt: 0, closesAt: 60 }])).toMatch(/dayOfWeek/);
    expect(
      validateOpeningWindows([
        { dayOfWeek: 1, opensAt: 480, closesAt: 900 },
        { dayOfWeek: 1, opensAt: 840, closesAt: 1200 },
      ]),
    ).toMatch(/overlap/);
  });

  it('converts HH:MM', () => {
    expect(hhmmToMinutes('08:30')).toBe(510);
    expect(hhmmToMinutes('24:00')).toBe(1440);
    expect(minutesToHHMM(1290)).toBe('21:30');
    expect(() => hhmmToMinutes('24:30')).toThrow();
    expect(() => hhmmToMinutes('8:30')).toThrow();
  });
});

describe('pricing', () => {
  it('charges the base delivery fee within the included distance, then per started km, capped', () => {
    expect(computeDeliveryFee(0, rules)).toBe(50_000);
    expect(computeDeliveryFee(2000, rules)).toBe(50_000);
    expect(computeDeliveryFee(2001, rules)).toBe(60_000);
    expect(computeDeliveryFee(4500, rules)).toBe(80_000);
    expect(computeDeliveryFee(50_000, rules)).toBe(150_000);
    expect(() => computeDeliveryFee(-1, rules)).toThrow();
  });

  it('applies service fee bounds', () => {
    expect(computeServiceFee(0, rules)).toBe(0);
    expect(computeServiceFee(50_000, rules)).toBe(5_000); // 5% = 2,500 -> min 5,000
    expect(computeServiceFee(400_000, rules)).toBe(20_000);
    expect(computeServiceFee(2_000_000, rules)).toBe(30_000); // capped
  });

  it('computes rider earnings and commission', () => {
    expect(computeRiderEarning(50_000, rules)).toBe(40_000);
    expect(computeRiderEarning(100_000, rules)).toBe(80_000);
    expect(computeCommission(400_000, 1500)).toBe(60_000);
  });
});
