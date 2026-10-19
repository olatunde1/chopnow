-- ChopNow: integrity rules Prisma's schema language cannot express.
-- Hand-written; keep in sync with docs/DATABASE_SCHEMA.md (Constraints section).
-- Keep this file ASCII-only: databases created with a non-UTF8 encoding reject other characters.

-- ---- Extensions & search ----
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "menu_items_name_trgm_idx" ON "menu_items" USING gin (lower("name") gin_trgm_ops);
CREATE INDEX "restaurants_name_trgm_idx" ON "restaurants" USING gin (lower("name") gin_trgm_ops);

-- ---- Identity ----
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email"));
ALTER TABLE "users" ADD CONSTRAINT "users_phone_e164_chk" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "users" ADD CONSTRAINT "users_failed_login_chk" CHECK ("failedLoginCount" >= 0);

-- ---- Restaurants & menus ----
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_amounts_chk" CHECK (
  "minOrderKobo" >= 0 AND "prepTimeMinutes" BETWEEN 1 AND 240 AND "deliveryRadiusMeters" BETWEEN 100 AND 50000
  AND ("commissionBpsOverride" IS NULL OR "commissionBpsOverride" BETWEEN 0 AND 10000)
);
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_coords_chk" CHECK (
  ("latitude" IS NULL AND "longitude" IS NULL)
  OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);
-- An unapproved restaurant can never be "accepting orders".
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_accepting_requires_approval_chk" CHECK (
  NOT "isAcceptingOrders" OR "verificationStatus" = 'APPROVED'
);

ALTER TABLE "restaurant_hours" ADD CONSTRAINT "restaurant_hours_window_chk" CHECK (
  "dayOfWeek" BETWEEN 0 AND 6 AND "opensAt" >= 0 AND "closesAt" <= 1440 AND "opensAt" < "closesAt"
);

ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_price_chk" CHECK ("priceKobo" >= 0);
ALTER TABLE "menu_item_variants" ADD CONSTRAINT "menu_item_variants_price_chk" CHECK ("priceKobo" >= 0);
ALTER TABLE "menu_item_extras" ADD CONSTRAINT "menu_item_extras_chk" CHECK ("priceKobo" >= 0 AND "maxQuantity" BETWEEN 1 AND 20);
-- At most one default variant per item.
CREATE UNIQUE INDEX "menu_item_variants_one_default_idx" ON "menu_item_variants" ("menuItemId") WHERE "isDefault" AND "deletedAt" IS NULL;

ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_owner_chk" CHECK (
  num_nonnulls("restaurantId", "riderId") = 1
);
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_size_chk" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760);

-- ---- Orders ----
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_nonneg_chk" CHECK (
  "subtotalKobo" >= 0 AND "deliveryFeeKobo" >= 0 AND "serviceFeeKobo" >= 0 AND "discountKobo" >= 0
  AND "totalKobo" >= 0 AND "commissionKobo" >= 0 AND "riderEarningKobo" >= 0
  AND "commissionBps" BETWEEN 0 AND 10000
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_formula_chk" CHECK (
  "totalKobo" = "subtotalKobo" + "deliveryFeeKobo" + "serviceFeeKobo" - "discountKobo"
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_pin_chk" CHECK ("deliveryPin" ~ '^[0-9]{4}$');
ALTER TABLE "orders" ADD CONSTRAINT "orders_idempotency_key_chk" CHECK (length("idempotencyKey") BETWEEN 8 AND 128);

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_chk" CHECK (
  "quantity" BETWEEN 1 AND 50 AND "unitPriceKobo" >= 0 AND "lineTotalKobo" >= 0
);
ALTER TABLE "order_item_extras" ADD CONSTRAINT "order_item_extras_chk" CHECK ("quantity" >= 1 AND "unitPriceKobo" >= 0);

-- ---- Payments & refunds ----
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_chk" CHECK ("amountKobo" > 0 AND "currency" = 'NGN');
-- An order can be successfully paid at most once (a second success is a duplicate charge to refund).
CREATE UNIQUE INDEX "payments_one_success_per_order_idx" ON "payments" ("orderId") WHERE "status" = 'SUCCESSFUL';

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_chk" CHECK ("amountKobo" > 0);

-- ---- Riders & delivery ----
ALTER TABLE "riders" ADD CONSTRAINT "riders_cash_limit_chk" CHECK ("cashLimitKoboOverride" IS NULL OR "cashLimitKoboOverride" >= 0);
-- An unapproved rider cannot be online (and therefore cannot receive offers).
ALTER TABLE "riders" ADD CONSTRAINT "riders_online_requires_approval_chk" CHECK (
  "availability" = 'OFFLINE' OR "verificationStatus" = 'APPROVED'
);

ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_cash_chk" CHECK ("cashToCollectKobo" >= 0 AND "pinFailedAttempts" >= 0);
-- Assigned states require a rider.
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_rider_required_chk" CHECK (
  "status" NOT IN ('ASSIGNED', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'DELIVERED') OR "currentRiderId" IS NOT NULL
);
-- Delivered requires a recorded pickup and a proof (PIN verified or audited staff override).
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_delivered_proof_chk" CHECK (
  "status" <> 'DELIVERED' OR (
    "pickedUpAt" IS NOT NULL AND "deliveredAt" IS NOT NULL
    AND ("pinVerifiedAt" IS NOT NULL OR ("proofOverrideById" IS NOT NULL AND "proofOverrideReason" IS NOT NULL))
  )
);
-- A rider holds at most one active delivery.
CREATE UNIQUE INDEX "deliveries_one_active_per_rider_idx" ON "deliveries" ("currentRiderId")
  WHERE "status" IN ('ASSIGNED', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP');

-- A delivery has at most one accepted (active) offer, and a rider at most one pending offer per delivery.
CREATE UNIQUE INDEX "delivery_offers_one_accepted_idx" ON "delivery_offers" ("deliveryId") WHERE "status" = 'ACCEPTED';
CREATE UNIQUE INDEX "delivery_offers_one_pending_per_rider_idx" ON "delivery_offers" ("deliveryId", "riderId") WHERE "status" = 'PENDING';
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_expiry_chk" CHECK ("expiresAt" > "offeredAt");

-- ---- Cash on delivery ----
ALTER TABLE "cash_collections" ADD CONSTRAINT "cash_collections_amounts_chk" CHECK (
  "amountDueKobo" >= 0
  AND "amountCollectedKobo" BETWEEN 0 AND "amountDueKobo"
  AND "amountReconciledKobo" BETWEEN 0 AND "amountCollectedKobo"
);
ALTER TABLE "cash_remittances" ADD CONSTRAINT "cash_remittances_amount_chk" CHECK ("amountKobo" > 0);
ALTER TABLE "cash_remittance_allocations" ADD CONSTRAINT "cash_remittance_allocations_amount_chk" CHECK ("amountKobo" > 0);

-- ---- Ledger & settlements ----
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_chk" CHECK ("amountKobo" > 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_subledger_chk" CHECK (
  ("account" <> 'VENDOR_PAYABLE' OR "restaurantId" IS NOT NULL)
  AND ("account" NOT IN ('RIDER_PAYABLE', 'RIDER_CASH_HELD') OR "riderId" IS NOT NULL)
);

ALTER TABLE "rider_earnings" ADD CONSTRAINT "rider_earnings_amount_chk" CHECK ("type" = 'ADJUSTMENT' OR "amountKobo" >= 0);
-- One live delivery-fee earning per delivery.
CREATE UNIQUE INDEX "rider_earnings_one_fee_per_delivery_idx" ON "rider_earnings" ("deliveryId")
  WHERE "type" = 'DELIVERY_FEE' AND "status" <> 'VOIDED';

ALTER TABLE "vendor_settlements" ADD CONSTRAINT "vendor_settlements_period_chk" CHECK ("periodEnd" > "periodStart" AND "orderCount" >= 0);
ALTER TABLE "rider_settlements" ADD CONSTRAINT "rider_settlements_period_chk" CHECK ("periodEnd" > "periodStart" AND "deliveryCount" >= 0);

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_amount_chk" CHECK ("amountKobo" > 0);
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_beneficiary_chk" CHECK (
  ("beneficiary" = 'VENDOR' AND "restaurantId" IS NOT NULL AND "riderId" IS NULL AND "riderSettlementId" IS NULL)
  OR ("beneficiary" = 'RIDER' AND "riderId" IS NOT NULL AND "restaurantId" IS NULL AND "vendorSettlementId" IS NULL)
);

-- ---- Engagement ----
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_chk" CHECK (
  "restaurantRating" BETWEEN 1 AND 5 AND ("riderRating" IS NULL OR "riderRating" BETWEEN 1 AND 5)
);

ALTER TABLE "promotions" ADD CONSTRAINT "promotions_code_uppercase_chk" CHECK ("code" = upper("code"));
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_window_chk" CHECK ("endsAt" > "startsAt");
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_type_fields_chk" CHECK (
  ("type" = 'PERCENT_OFF' AND "percentBps" BETWEEN 1 AND 10000)
  OR ("type" = 'FIXED_OFF' AND "amountKobo" > 0)
  OR ("type" = 'FREE_DELIVERY')
);
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_limits_chk" CHECK (
  "minSubtotalKobo" >= 0 AND ("maxDiscountKobo" IS NULL OR "maxDiscountKobo" > 0)
  AND ("usageLimit" IS NULL OR "usageLimit" > 0) AND "perCustomerLimit" > 0
);
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_amount_chk" CHECK ("discountKobo" >= 0);

-- ---- Append-only history ----
-- UPDATE and DELETE are rejected on financial and audit history. Corrections are new rows
-- (e.g. an ADJUSTMENT transaction). TRUNCATE is still possible for test databases.
CREATE FUNCTION chopnow_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER financial_transactions_append_only BEFORE UPDATE OR DELETE ON "financial_transactions"
  FOR EACH ROW EXECUTE FUNCTION chopnow_reject_mutation();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION chopnow_reject_mutation();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION chopnow_reject_mutation();
CREATE TRIGGER order_status_history_append_only BEFORE UPDATE OR DELETE ON "order_status_history"
  FOR EACH ROW EXECUTE FUNCTION chopnow_reject_mutation();

-- ---- Balanced journals ----
-- Checked at COMMIT so all entries of a transaction can be inserted first.
CREATE FUNCTION chopnow_check_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  debits bigint;
  credits bigint;
BEGIN
  SELECT
    COALESCE(SUM("amountKobo") FILTER (WHERE "direction" = 'DEBIT'), 0),
    COALESCE(SUM("amountKobo") FILTER (WHERE "direction" = 'CREDIT'), 0)
  INTO debits, credits
  FROM "ledger_entries" WHERE "transactionId" = NEW."transactionId";
  IF debits <> credits THEN
    RAISE EXCEPTION 'Financial transaction % is unbalanced: debits % <> credits %', NEW."transactionId", debits, credits
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION chopnow_check_journal_balanced();
