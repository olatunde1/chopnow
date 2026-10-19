-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "estimatedReadyAt" TIMESTAMP(3);

-- Orders the restaurant must act on (accept-deadline sweep and the vendor "incoming" board).
CREATE INDEX "orders_status_acceptDeadlineAt_idx" ON "orders" ("status", "acceptDeadlineAt") WHERE "status" = 'PLACED' AND "visibleToVendorAt" IS NOT NULL;
