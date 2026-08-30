-- =============================================================================
-- SCHEMA-LEVEL GRANTS / REVOKES & ALTER DEFAULT PRIVILEGES
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0200_permissions.sql ---

REVOKE USAGE ON SCHEMA analytics,
comms,
files,
finance,
integrations,
marketplace,
ops,
org,
projects,
search,
security
FROM
    anon,
    authenticated,
    service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA analytics,
comms,
files,
finance,
integrations,
marketplace,
ops,
org,
projects,
search,
security
FROM
    anon,
    authenticated,
    service_role;

GRANT USAGE ON SCHEMA org TO anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA org TO anon, authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA org TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA org
GRANT ALL ON TABLES TO anon,
authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA org
GRANT ALL ON SEQUENCES TO anon,
authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,
authenticated,
service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon,
authenticated,
service_role;

GRANT USAGE ON SCHEMA comms TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA comms TO authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA comms TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA comms
GRANT ALL ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA comms
GRANT ALL ON SEQUENCES TO authenticated;

-- TRUNCATE is not row-level, so RLS does not bound it. `GRANT ALL` above includes
-- it, which means the policies added in 00002012 could be stepped around entirely:
-- a caller who cannot SELECT one row of comms.dm_messages could still discard the
-- whole table. Revoked here, and again from the default privileges so a table added
-- tomorrow does not quietly re-acquire it.
--
-- Nothing in the application truncates as `authenticated`; truncation is a
-- maintenance act and belongs to the service role, which is unaffected by this.
--
-- SCOPE, stated rather than assumed: the same `GRANT ALL` pattern is used for
-- `org`, `public`, `files`, `projects`, `marketplace` and `reviews`, so the same
-- reasoning applies to every one of them. Only `comms` is revoked here because
-- that is the schema this change is about; the rest is recorded in
-- documentation/architecture/READ_API_FINDINGS.md for a human to decide, since a
-- platform-wide privilege change deserves its own review rather than riding along.

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA comms
FROM
    authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA comms
REVOKE TRUNCATE ON TABLES
FROM
    authenticated;

GRANT USAGE ON SCHEMA files TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA files TO authenticated,
service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA files TO authenticated,
service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA files
GRANT ALL ON TABLES TO authenticated,
service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA files
GRANT ALL ON SEQUENCES TO authenticated,
service_role;

GRANT USAGE ON SCHEMA projects TO authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA projects TO authenticated,
service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA projects TO authenticated,
service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA projects
GRANT ALL ON TABLES TO authenticated,
service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA projects
GRANT ALL ON SEQUENCES TO authenticated,
service_role;

GRANT USAGE ON SCHEMA search TO anon, authenticated, service_role;

GRANT SELECT ON ALL TABLES IN SCHEMA search TO anon, authenticated;

GRANT
SELECT
    ON ALL SEQUENCES IN SCHEMA search TO anon,
    authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA search TO service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA search TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA search
GRANT
SELECT ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA search
GRANT
SELECT ON SEQUENCES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA search
GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA search
GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA search
GRANT
EXECUTE ON ROUTINES TO anon,
authenticated,
service_role;

GRANT USAGE ON SCHEMA marketplace TO anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA marketplace TO anon, authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA marketplace TO anon,
authenticated;

GRANT USAGE ON SCHEMA reviews TO anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA reviews TO anon, authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA reviews TO anon, authenticated;


-- --- from 0205_security.sql ---

GRANT USAGE ON SCHEMA security TO authenticated;

GRANT USAGE ON SCHEMA security TO service_role;


-- --- from 0208_files.sql ---

GRANT USAGE ON SCHEMA files TO service_role, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA files TO service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA files TO service_role;

GRANT
SELECT,
INSERT
,
UPDATE,
DELETE ON ALL TABLES IN SCHEMA files TO authenticated;

GRANT USAGE,
SELECT
    ON ALL SEQUENCES IN SCHEMA files TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA files
GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA files
GRANT
SELECT,
INSERT
,
UPDATE,
DELETE ON TABLES TO authenticated;


-- --- from 20260724100000_scheduling_schema_availability.sql ---

-- `anon` needs schema usage because a PUBLISHED schedule is deliberately visitor-readable (a
-- visitor must see when someone is free in order to book them). Row-level exposure is still
-- governed entirely by the policies in §7 — usage on the schema grants nothing by itself.
GRANT USAGE ON SCHEMA scheduling TO anon,
authenticated;

GRANT USAGE ON SCHEMA scheduling TO service_role;


-- --- from 20260724101000_integrations_connections.sql ---

-- =============================================================================================
-- 20260724101000_integrations_connections.sql
-- Availability & Discovery Calls foundation (2/5) — the FIRST tables in the `integrations` schema:
-- the third-party provider catalogue and per-user OAuth connections (calendar sync + conferencing).
--
-- ADDITIVE ONLY. The `integrations` schema has existed since `0001_init_schemas.sql` (declared,
-- described in `documentation/database/Schemas.md` as "OAuth connections and third-party app
-- installations") but has been EMPTY — zero tables. Nothing is altered here; this populates it.
-- Authored, NOT applied to any live database.
--
-- ⚠️ AUTHENTICATION ≠ AUTHORIZATION. The existing Google OAuth (`supabase/config.toml`,
-- `apps/web/features/auth/core/oauth.ts`, Decision #7) is SIGN-IN only — GoTrue owns that identity
-- handshake and no third-party API token is retained. This table models a DIFFERENT, additional
-- consent: a long-lived API authorization the platform stores so it can act on the user's behalf
-- later (read free/busy, mint a meeting room). The two flows must never be conflated or share a
-- token store.
--
-- ⚠️ NO PLAINTEXT SECRETS. `access_token_cipher` / `refresh_token_cipher` hold ciphertext produced
-- in an Edge Function with `ENCRYPTION_KEY` (SYSTEM_ARCHITECTURE.md §Environment Variable Contract),
-- exactly like the PII posture in PRODUCT_SPEC.md §Data Privacy & The "Vault". The base table is
-- DEFINER-ONLY (RLS on, no policy, no `authenticated` grant) — the hidden-ledger posture the
-- `finance` schema already uses. Clients read `integrations.v_my_connections`, which cannot project
-- a token column.
-- =============================================================================================

-- `anon` needs schema usage only to read the public provider CATALOGUE (§2) — the token store in
-- §3 has no grant to any client role at all.
GRANT USAGE ON SCHEMA integrations TO anon,
authenticated;

GRANT USAGE ON SCHEMA integrations TO service_role;


-- --- from 20260724110000_analytics_event_substrate.sql ---

GRANT USAGE ON SCHEMA analytics TO authenticated;
