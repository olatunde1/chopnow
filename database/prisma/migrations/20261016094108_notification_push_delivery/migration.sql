-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "pushAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pushError" TEXT;

-- Hand-written: the push sender scans only notifications still to deliver.
CREATE INDEX "notifications_push_pending_idx" ON "notifications" ("createdAt") WHERE "pushedAt" IS NULL;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_push_attempts_chk" CHECK ("pushAttempts" >= 0);
