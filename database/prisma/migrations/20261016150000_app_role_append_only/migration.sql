-- Defence in depth for the append-only tables: when the restricted application role exists
-- (staging/production, created by database/roles.sql), it may insert and read but never update,
-- delete or truncate them. The mutation-blocking triggers stay as the first line. No-op in
-- development and test, where everything runs as the owner.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chopnow_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, order_status_history, financial_transactions, ledger_entries FROM chopnow_app;
  END IF;
END $$;
