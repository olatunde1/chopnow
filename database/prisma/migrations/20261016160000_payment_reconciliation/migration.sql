-- Reconciliation sweep bookkeeping: when the provider was last asked about an unconfirmed attempt.
ALTER TABLE "payments" ADD COLUMN "lastReconciledAt" TIMESTAMP(3);
