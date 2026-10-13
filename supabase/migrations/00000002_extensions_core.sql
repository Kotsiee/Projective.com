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

-- The scheduler's two extensions, guarded end to end: a database without them (a plain Postgres, or a
-- role that may not create them) must still migrate, but never quietly. Each failure raises a
-- WARNING here, and every job the registry then cannot schedule or dispatch writes its own
-- `ops.log_entries` row (`ops.fn_schedule_job` / `ops.fn_dispatch_http_job`, 00001650, Decision #203).
-- The `ops` tables do not exist yet at this point, so this block can only warn. The Supabase image
-- ships both, local `supabase start` included.
DO $$
BEGIN
    -- No `WITH SCHEMA` — pg_cron insists on its own `cron` schema.
    CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron unavailable (%): no job in ops.scheduled_jobs will run on a schedule here; run them with deno task cron:run <job>.', SQLERRM;
END $$;

-- pg_net sends the HTTP sweeps. Its functions live in `net` whatever the extension schema; Supabase
-- keeps the extension row in `extensions`.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_net unavailable (%): every http job in ops.scheduled_jobs will skip and log instead of running.', SQLERRM;
END $$;
