import { z } from 'zod';

/**
 * Runtime-configurable business rules, stored as one JSON document in platform_settings and edited
 * from the admin dashboard (audited). Orders snapshot the values they used, so changing a rule never
 * alters past orders. Defaults match docs/PRODUCT_REQUIREMENTS.md.
 * Money in kobo, percentages in basis points, durations in seconds unless named otherwise.
 */
const kobo = z.number().int().min(0);
const bps = z.number().int().min(0).max(10_000);

export const BusinessRulesSchema = z
  .object({
    pricing: z.object({
      commissionBps: bps.default(1500),
      deliveryBaseFeeKobo: kobo.default(50_000),
      deliveryIncludedMeters: z.number().int().min(0).default(2000),
      deliveryPerKmKobo: kobo.default(10_000),
      deliveryFeeCapKobo: kobo.default(150_000),
      riderShareOfDeliveryBps: bps.default(8000),
      riderMinEarningKobo: kobo.default(40_000),
      serviceFeeBps: bps.default(500),
      serviceFeeMinKobo: kobo.default(5_000),
      serviceFeeMaxKobo: kobo.default(30_000),
    }),
    cashOnDelivery: z.object({
      enabled: z.boolean().default(true),
      maxOrderTotalKobo: kobo.default(2_000_000),
      newCustomerMaxOrderTotalKobo: kobo.default(1_000_000),
      riderOutstandingCashLimitKobo: kobo.default(3_000_000),
      allowPartialCollection: z.boolean().default(false),
    }),
    dispatch: z.object({
      offerTimeoutSeconds: z.number().int().min(15).max(600).default(45),
      coreOnlyWindowSeconds: z.number().int().min(0).max(1800).default(120),
      alertOperationsAfterSeconds: z.number().int().min(60).max(3600).default(600),
      startDispatchOn: z.enum(['ACCEPTED', 'READY_FOR_PICKUP']).default('ACCEPTED'),
      maxPinAttempts: z.number().int().min(3).max(10).default(5),
    }),
    orders: z.object({
      vendorAcceptTimeoutSeconds: z.number().int().min(60).max(3600).default(600),
      /** Online orders still unpaid this long after placing are cancelled (promo released). */
      unpaidOnlineOrderTimeoutSeconds: z.number().int().min(300).max(86_400).default(1800),
      defaultDeliveryRadiusMeters: z.number().int().min(500).max(50_000).default(5000),
      maxItemQuantity: z.number().int().min(1).max(50).default(20),
      timezone: z.literal('Africa/Lagos').default('Africa/Lagos'),
    }),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.pricing.serviceFeeMinKobo > r.pricing.serviceFeeMaxKobo) {
      ctx.addIssue({ code: 'custom', path: ['pricing', 'serviceFeeMinKobo'], message: 'must not exceed serviceFeeMaxKobo' });
    }
    if (r.pricing.deliveryBaseFeeKobo > r.pricing.deliveryFeeCapKobo) {
      ctx.addIssue({ code: 'custom', path: ['pricing', 'deliveryFeeCapKobo'], message: 'must be at least the base fee' });
    }
  });

export type BusinessRules = z.infer<typeof BusinessRulesSchema>;

export function defaultBusinessRules(): BusinessRules {
  return BusinessRulesSchema.parse({ pricing: {}, cashOnDelivery: {}, dispatch: {}, orders: {} });
}
