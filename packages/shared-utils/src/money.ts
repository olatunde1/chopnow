/**
 * Money handling.
 *
 * All amounts in ChopNow are integers in MINOR units of the platform currency.
 * For the pilot the currency is NGN, so 1 naira = 100 kobo and ₦2,500.00 is stored as 250000.
 * Never use floating-point naira values in business logic, storage or API payloads.
 */

export const CURRENCY = 'NGN' as const;
export const MINOR_UNITS_PER_MAJOR = 100;

export type MinorAmount = number;

export function assertMinorAmount(value: number, label = 'amount'): asserts value is MinorAmount {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer in minor units, got ${value}`);
  }
}

/** Converts a major-unit decimal string such as "2500.50" to minor units without float arithmetic. */
export function parseMajorToMinor(input: string): MinorAmount {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) throw new RangeError(`Invalid money string: "${input}"`);
  const [, sign, whole, frac = ''] = match;
  const minor = Number(whole) * MINOR_UNITS_PER_MAJOR + Number(frac.padEnd(2, '0'));
  assertMinorAmount(minor);
  return sign ? -minor : minor;
}

/** Formats minor units for display, e.g. 250050 -> "₦2,500.50". */
export function formatMinor(amount: MinorAmount, opts: { showKobo?: boolean } = {}): string {
  assertMinorAmount(amount);
  const showKobo = opts.showKobo ?? amount % MINOR_UNITS_PER_MAJOR !== 0;
  const abs = Math.abs(amount);
  const whole = Math.trunc(abs / MINOR_UNITS_PER_MAJOR);
  const frac = abs % MINOR_UNITS_PER_MAJOR;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = showKobo ? `${grouped}.${frac.toString().padStart(2, '0')}` : grouped;
  return `${amount < 0 ? '-' : ''}₦${body}`;
}

/**
 * Percentage of an amount expressed in basis points (1 bp = 0.01%), rounded half-up to the
 * nearest minor unit. Example: 15% commission on 250000 -> applyBasisPoints(250000, 1500) = 37500.
 */
export function applyBasisPoints(amount: MinorAmount, basisPoints: number): MinorAmount {
  assertMinorAmount(amount);
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new RangeError(`basisPoints must be a non-negative integer, got ${basisPoints}`);
  }
  const sign = amount < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(amount) * basisPoints + 5000) / 10000);
}

export function sumMinor(amounts: readonly MinorAmount[]): MinorAmount {
  let total = 0;
  for (const a of amounts) {
    assertMinorAmount(a);
    total += a;
  }
  assertMinorAmount(total, 'total');
  return total;
}
