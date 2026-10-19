-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "bankReference" TEXT;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "chargeTo" TEXT,
ADD COLUMN     "method" TEXT;

-- Integrity (hand-written): refund attribution and completion records.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_charge_to_chk" CHECK ("chargeTo" IS NULL OR "chargeTo" IN ('CUSTOMER_FUNDS', 'RESTAURANT', 'PLATFORM', 'UNAPPLIED_PAYMENT'));
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_method_chk" CHECK ("method" IS NULL OR "method" IN ('PROVIDER', 'MANUAL'));
-- An approved or later refund always knows whose money it is.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_charge_to_required_chk" CHECK ("status" IN ('REQUESTED', 'REJECTED') OR "chargeTo" IS NOT NULL);
-- A successful payout records the bank reference it was made under.
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_bank_reference_chk" CHECK ("status" <> 'SUCCESSFUL' OR "bankReference" IS NOT NULL);
-- At most one live (not failed) payout per settlement.
CREATE UNIQUE INDEX "payouts_one_live_vendor_settlement_idx" ON "payouts" ("vendorSettlementId") WHERE "status" <> 'FAILED' AND "vendorSettlementId" IS NOT NULL;
CREATE UNIQUE INDEX "payouts_one_live_rider_settlement_idx" ON "payouts" ("riderSettlementId") WHERE "status" <> 'FAILED' AND "riderSettlementId" IS NOT NULL;
