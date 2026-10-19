-- ChopNow database roles for staging/production. Run once per database as a superuser (or the
-- provider's admin user), after creating the database. Replace both passwords with values from the
-- secret manager. Placeholders are deliberately invalid so a copy-paste run fails loudly.
--
--   chopnow_migrator  owns the schema; used ONLY by the migrate job (`prisma migrate deploy`).
--   chopnow_app       what the API/worker connect as: read/write data, no DDL, no TRUNCATE,
--                     and no UPDATE/DELETE on the append-only audit and ledger tables.
--
-- psql -v ON_ERROR_STOP=1 -d chopnow -v migrator_pw="'...'" -v app_pw="'...'" -f database/roles.sql

\if :{?migrator_pw}
\else
  \echo 'Pass -v migrator_pw=... and -v app_pw=... (quoted).' \quit
\endif

-- Extensions the migrations use need database-level rights the migrator doesn't have; create them
-- here as admin (the migration's CREATE EXTENSION IF NOT EXISTS then does nothing).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE ROLE chopnow_migrator LOGIN PASSWORD :migrator_pw;
CREATE ROLE chopnow_app      LOGIN PASSWORD :app_pw;

-- Nobody but the migrator creates objects in the schema.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"DBNAME" TO chopnow_migrator, chopnow_app;
ALTER SCHEMA public OWNER TO chopnow_migrator;
GRANT USAGE ON SCHEMA public TO chopnow_app;

-- Every table and sequence the migrator creates (now or in future migrations) is usable by the app.
ALTER DEFAULT PRIVILEGES FOR ROLE chopnow_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chopnow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE chopnow_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO chopnow_app;

-- If tables already exist (roles added to an existing database), grant on them too and hand them
-- to the migrator. Safe to re-run this block on its own.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO chopnow_migrator', t.tablename);
    IF t.tablename IN ('audit_logs', 'order_status_history', 'financial_transactions', 'ledger_entries') THEN
      -- Append-only (also enforced by triggers): the app may add rows, never change or remove them.
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO chopnow_app', t.tablename);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO chopnow_app', t.tablename);
    END IF;
  END LOOP;
  FOR t IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO chopnow_migrator', t.sequencename);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO chopnow_app', t.sequencename);
  END LOOP;
END $$;
