import { describe, expect, it } from 'vitest';
import * as shared from '@chopnow/shared-schemas';
import * as db from '../src/generated/prisma/enums.js';
import { BusinessRulesSchema, defaultBusinessRules } from '../src/modules/settings/business-rules.js';

describe('shared enums match the database enums', () => {
  const pairs: [string, readonly string[], Record<string, string>][] = [
    ['Role', shared.ROLES, db.Role],
    ['ApprovalStatus', shared.APPROVAL_STATUSES, db.ApprovalStatus],
    ['OrderStatus', shared.ORDER_STATUSES, db.OrderStatus],
    ['PaymentStatus', shared.PAYMENT_STATUSES, db.PaymentStatus],
    ['PaymentMethod', shared.PAYMENT_METHODS, db.PaymentMethod],
    ['RiderType', shared.RIDER_TYPES, db.RiderType],
    ['VehicleType', shared.VEHICLE_TYPES, db.VehicleType],
  ];
  for (const [name, sharedValues, dbEnum] of pairs) {
    it(name, () => expect([...sharedValues].sort()).toEqual(Object.values(dbEnum).sort()));
  }
});

describe('business rules', () => {
  it('defaults match the documented MVP pricing', () => {
    const r = defaultBusinessRules();
    expect(r.pricing.commissionBps).toBe(1500);
    expect(r.pricing.deliveryBaseFeeKobo).toBe(50_000);
    expect(r.cashOnDelivery.maxOrderTotalKobo).toBe(2_000_000);
    expect(r.dispatch.offerTimeoutSeconds).toBe(45);
  });

  it('rejects inconsistent or non-integer money settings', () => {
    const r = defaultBusinessRules();
    expect(BusinessRulesSchema.safeParse({ ...r, pricing: { ...r.pricing, serviceFeeMinKobo: 50_000 } }).success).toBe(false);
    expect(BusinessRulesSchema.safeParse({ ...r, pricing: { ...r.pricing, deliveryBaseFeeKobo: 500.5 } }).success).toBe(false);
    expect(BusinessRulesSchema.safeParse({ ...r, pricing: { ...r.pricing, commissionBps: 12_000 } }).success).toBe(false);
  });
});
