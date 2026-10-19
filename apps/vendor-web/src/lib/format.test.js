import { describe, expect, it } from 'vitest';
import { daysAgo, koboToNairaInput, lagosToday, nairaToKobo, orderStatus } from './format';

describe('money input helpers', () => {
  it('parses naira text into integer kobo', () => {
    expect(nairaToKobo('2500')).toBe(250_000);
    expect(nairaToKobo('₦2,500.50')).toBe(250_050);
    expect(nairaToKobo(' 0 ')).toBe(0);
  });

  it('rejects text that is not an amount', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '12e3']) expect(nairaToKobo(bad)).toBeNull();
  });

  it('formats kobo back for editing without float noise', () => {
    expect(koboToNairaInput(250_000)).toBe('2500');
    expect(koboToNairaInput(250_050)).toBe('2500.50');
    expect(koboToNairaInput(null)).toBe('');
    expect(nairaToKobo(koboToNairaInput(10_001))).toBe(10_001);
  });
});

describe('dates', () => {
  it('uses the Lagos calendar day (UTC+1)', () => {
    expect(lagosToday(new Date('2026-10-14T22:59:00Z'))).toBe('2026-10-14');
    expect(lagosToday(new Date('2026-10-14T23:00:00Z'))).toBe('2026-10-15');
  });

  it('counts back whole days across month ends', () => {
    expect(daysAgo('2026-10-03', 6)).toBe('2026-09-27');
    expect(daysAgo('2026-10-03', 0)).toBe('2026-10-03');
  });
});

describe('orderStatus', () => {
  it('labels vendor-facing statuses and falls back safely', () => {
    expect(orderStatus('REJECTED')).toEqual({ label: 'Declined', tone: 'bad' });
    expect(orderStatus('SOMETHING_NEW')).toEqual({ label: 'SOMETHING_NEW', tone: 'neutral' });
  });
});
