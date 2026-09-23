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

-- Same reasoning as the `comms` revoke above, and now the same need: with RLS
-- newly enabled on projects.ticket_history, user_preferences,
-- project_required_skills and project_invitations (00002001), `GRANT ALL` would
-- otherwise leave TRUNCATE as a way straight around every policy in 00002011 —
-- TRUNCATE is not row-level, so a caller who cannot SELECT one row of the ticket
-- audit log could still discard the whole table, which is exactly the outcome
-- those policies exist to prevent.
--
-- Nothing in the application truncates as `authenticated`; truncation is a
-- maintenance act and belongs to the service role, which is unaffected.
--
-- SCOPE, unchanged: `org`, `public`, `files`, `marketplace` and `reviews` still
-- carry the same `GRANT ALL` pattern and are recorded in
-- documentation/architecture/READ_API_FINDINGS.md for a human, since a
-- platform-wide privilege change deserves its own review.

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA projects
FROM
    authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA projects
REVOKE TRUNCATE ON TABLES
FROM
    authenticated;

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


-- --- the move off fixtures (2026-09-22): discovery reads the database ---
--
-- `catalogue` shipped with no privileges at all. Usage for all three roles: a signed-out visitor
-- browses published listings exactly as a signed-in one does, and every row-level decision is made
-- by the policies in 00002020 — usage on the schema grants nothing by itself.
GRANT USAGE ON SCHEMA catalogue TO anon, authenticated, service_role;

-- `finance` is exposed to PostgREST under RLS (Decision #68(a), lifted 2026-09-23 with the product
-- owner's approval). Usage grants nothing by itself — and nothing broad follows it: every table a
-- client role reaches is named in 00002520 with the narrowest privilege it needs, has RLS on
-- (00002001) and is filtered by the policies in 00002013; the tables with no grant (promo codes,
-- idempotency keys, ratings, the reconciliation view) stay reachable only through SECURITY DEFINER
-- functions and the service role. The functions matter as much as the tables: Postgres grants
-- EXECUTE to PUBLIC by default, and with usage granted the ledger primitives would be callable over
-- the API — 00002510 revokes them before anything can reach them. `anon` reads one table, the FX floor.
GRANT USAGE ON SCHEMA finance TO anon, authenticated, service_role;

-- Guests read PUBLIC projects. Nine `FOR SELECT TO public` policies in 00002011 were written for
-- exactly this visitor (`status = 'active' AND visibility = 'public'`) and were unreachable, because
-- `anon` had no usage on the schema (Decision #85(e)). Usage alone still grants nothing — the
-- table-level SELECTs in 00002520 name the handful of tables a public project page reads, and no
-- write privilege reaches `anon` here.
GRANT USAGE ON SCHEMA projects TO anon;

-- TRUNCATE is not row-level, so RLS does not bound it (Decision #83). `marketplace` and `reviews` are
-- `GRANT ALL` to both client roles, which included TRUNCATE; exposing both to PostgREST is what makes
-- that worth closing. PostgREST never issues TRUNCATE, so this is defence in depth — but it is the
-- only thing between a leaked session and an empty review table if anything else ever does.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA marketplace FROM anon, authenticated;

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA reviews FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA reviews REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- The same for `org` and `files` (2026-09-23), the two schemas the public profile and its media
-- pipeline live in. Both are `GRANT ALL` above — `org` to `anon` as well — so every profile table,
-- including the showcase, the privacy switches and the certifications, and every media row and WebP
-- tier, could be emptied by a caller RLS would not let read a single row of it. The service role and
-- the definer functions are unaffected; nothing in the application truncates as a client.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA org FROM anon, authenticated;

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA files FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA org REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA files REVOKE TRUNCATE ON TABLES FROM anon, authenticated;
