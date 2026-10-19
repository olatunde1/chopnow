import { applyBasisPoints, assertMinorAmount, type MinorAmount } from './money.js';

/**
 * Fee rules (all amounts in kobo, rates in basis points). These mirror the `pricing` block of the
 * API's business rules. The API is the only authority on what a customer is charged; clients may
 * call these functions to show estimates.
 */
export interface PricingRules {
  commissionBps: number;
  deliveryBaseFeeKobo: MinorAmount;
  deliveryIncludedMeters: number;
  deliveryPerKmKobo: MinorAmount;
  deliveryFeeCapKobo: MinorAmount;
  riderShareOfDeliveryBps: number;
  riderMinEarningKobo: MinorAmount;
  serviceFeeBps: number;
  serviceFeeMinKobo: MinorAmount;
  serviceFeeMaxKobo: MinorAmount;
}

/**
 * Base fee covers the first `deliveryIncludedMeters`; each started kilometre beyond adds
 * `deliveryPerKmKobo`; the result is capped.
 */
export function computeDeliveryFee(distance: number, rules: PricingRules): MinorAmount {
  if (!Number.isFinite(distance) || distance < 0) throw new RangeError(`Invalid distance ${distance}`);
  const extraMeters = Math.max(0, distance - rules.deliveryIncludedMeters);
  const extraKm = Math.ceil(extraMeters / 1000);
  return Math.min(rules.deliveryFeeCapKobo, rules.deliveryBaseFeeKobo + extraKm * rules.deliveryPerKmKobo);
}

export function computeServiceFee(subtotal: MinorAmount, rules: PricingRules): MinorAmount {
  assertMinorAmount(subtotal, 'subtotal');
  if (subtotal === 0) return 0;
  const raw = applyBasisPoints(subtotal, rules.serviceFeeBps);
  return Math.min(rules.serviceFeeMaxKobo, Math.max(rules.serviceFeeMinKobo, raw));
}

/** The rider's share of a delivery fee, never below the minimum earning. */
export function computeRiderEarning(deliveryFee: MinorAmount, rules: PricingRules): MinorAmount {
  assertMinorAmount(deliveryFee, 'deliveryFee');
  return Math.max(rules.riderMinEarningKobo, applyBasisPoints(deliveryFee, rules.riderShareOfDeliveryBps));
}

export function computeCommission(subtotal: MinorAmount, commissionBps: number): MinorAmount {
  return applyBasisPoints(subtotal, commissionBps);
}
