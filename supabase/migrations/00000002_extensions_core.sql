-- =============================================================================================
-- 00000002_extensions_core.sql — Consolidated PostgreSQL extensions (Category 0).
-- Every unique CREATE EXTENSION gathered from the historical migration set, deduplicated.
-- Sources: 0003_org_tables.sql / 0099_helpers_functions.sql (pgcrypto);
--          0010_search_tables.sql / 0217_search_engine_pgvector.sql (vector); 0010 (pg_trgm);
--          20260724094000_comms_notification_rls_jobs.sql (conditional pg_cron block).
-- =============================================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE EXTENSION IF NOT EXISTS vector;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Guarded end to end: the extension may not be installed (local `supabase start` does not ship it
-- by default), and `cron.schedule` needs privileges a migration run may not have. A failure here
-- must not block the rest of the migration — the jobs can be scheduled by hand afterwards.
DO $$
BEGIN
    -- No `WITH SCHEMA` — pg_cron insists on its own `cron` schema.
    CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable — notification jobs must be scheduled manually.';
END $$;
