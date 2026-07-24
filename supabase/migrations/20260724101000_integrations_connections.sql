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

-- #region 1. Vocabulary
-- What a provider can be used FOR. A provider may be capable of both (Google mints a Meet room
-- through the Calendar API), which is why this is an array on the catalogue row rather than a
-- single column — `google` must not be duplicated into two rows that need two OAuth consents.
DO $$ BEGIN
    CREATE TYPE integrations.provider_kind AS ENUM ('calendar', 'conferencing');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- The connection lifecycle. `expired` is recoverable by a refresh; `revoked` is terminal for that
-- connection row and requires a fresh consent. Nothing is hard-deleted (root CLAUDE.md §5).
DO $$ BEGIN
    CREATE TYPE integrations.connection_status AS ENUM ('active', 'expired', 'revoked', 'error');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- The audit vocabulary for every state change on a connection.
DO $$ BEGIN
    CREATE TYPE integrations.connection_action AS ENUM (
        'connected', 'refreshed', 'scope_changed', 'expired', 'revoked', 'error', 'synced'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- #endregion

-- #region 2. integrations.providers — the third-party catalogue
-- A reference table, not user data: one row per integrable third party. Seeded below with the five
-- calendar sources the app already advertises (`INTEGRATION_SOURCES` in
-- `@projective/types/scheduling`) plus the conferencing providers the Session Engine needs
-- (SYSTEM_ARCHITECTURE.md §Conferencing). `is_enabled` is the platform kill-switch — a provider row
-- may exist (so historical connections keep resolving) while new consents are turned off.
CREATE TABLE IF NOT EXISTS integrations.providers (
    slug text PRIMARY KEY,
    label text NOT NULL,
    -- No DEFAULT: a catalogue row that can do nothing is meaningless, and the CHECK below makes
    -- omitting it an explicit error rather than a silently useless row.
    capabilities integrations.provider_kind[] NOT NULL,
    is_enabled boolean NOT NULL DEFAULT false,
    -- Default OAuth scopes requested at consent time. Documentation/config only — the real request
    -- is assembled by the Edge Function; no secret ever lands in this table.
    default_scopes text[] NOT NULL DEFAULT '{}',
    -- Provider docs the operator needs when wiring credentials (no keys, no secrets).
    docs_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_provider_has_capability CHECK (array_length (capabilities, 1) IS NOT NULL)
);

INSERT INTO
    integrations.providers (
        slug,
        label,
        capabilities,
        is_enabled,
        default_scopes
    )
VALUES (
        'google',
        'Google',
        ARRAY['calendar', 'conferencing']::integrations.provider_kind[],
        false,
        ARRAY['https://www.googleapis.com/auth/calendar.events']
    ),
    (
        'outlook',
        'Outlook',
        ARRAY['calendar', 'conferencing']::integrations.provider_kind[],
        false,
        ARRAY['Calendars.ReadWrite', 'OnlineMeetings.ReadWrite']
    ),
    (
        'apple',
        'Apple',
        ARRAY['calendar']::integrations.provider_kind[],
        false,
        ARRAY[]::text[]
    ),
    (
        'samsung',
        'Samsung',
        ARRAY['calendar']::integrations.provider_kind[],
        false,
        ARRAY[]::text[]
    ),
    (
        'notion',
        'Notion',
        ARRAY['calendar']::integrations.provider_kind[],
        false,
        ARRAY[]::text[]
    ),
    (
        'zoom',
        'Zoom',
        ARRAY['conferencing']::integrations.provider_kind[],
        false,
        ARRAY['meeting:write']
    ),
    (
        'microsoft_teams',
        'Microsoft Teams',
        ARRAY['conferencing']::integrations.provider_kind[],
        false,
        ARRAY['OnlineMeetings.ReadWrite']
    ),
    (
        'discord',
        'Discord',
        ARRAY['conferencing']::integrations.provider_kind[],
        false,
        ARRAY[]::text[]
    ) ON CONFLICT (slug) DO NOTHING;

ALTER TABLE integrations.providers ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE integrations.providers TO anon,
authenticated;

GRANT ALL ON TABLE integrations.providers TO service_role;

-- The catalogue is public, non-sensitive reference data (labels + capabilities drive the settings
-- UI's provider chips). Writes are service-role only.
DROP POLICY IF EXISTS "View integration providers" ON integrations.providers;

CREATE POLICY "View integration providers" ON integrations.providers FOR
SELECT TO anon,
authenticated USING (true);
-- #endregion

-- #region 3. integrations.user_connections — the stored OAuth authorization (DEFINER-ONLY)
-- One row per (user, provider). Holds ciphertext credentials and is deliberately unreadable from a
-- client JWT: no `authenticated` grant and no SELECT policy. Everything a client needs is projected
-- by `integrations.v_my_connections` (§4), which physically cannot leak a token column.
CREATE TABLE IF NOT EXISTS integrations.user_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    provider_slug text NOT NULL REFERENCES integrations.providers (slug) ON DELETE RESTRICT,
    status integrations.connection_status NOT NULL DEFAULT 'active',
    -- What this consent actually granted, which may be narrower than the provider's defaults.
    granted_kinds integrations.provider_kind[] NOT NULL DEFAULT '{}',
    granted_scopes text[] NOT NULL DEFAULT '{}',
    -- The account at the far end, so the settings UI can say WHICH Google account is linked. The
    -- label is the user's own identifier (usually an email) and is visible only to that user.
    external_account_id text,
    external_account_label text,
    -- ⚠️ Ciphertext only — encrypted in an Edge Function with `ENCRYPTION_KEY`. Never a raw token.
    access_token_cipher text,
    refresh_token_cipher text,
    token_expires_at timestamptz,
    last_synced_at timestamptz,
    last_error text,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_connection UNIQUE (user_id, provider_slug)
);

CREATE INDEX IF NOT EXISTS idx_user_connections_user ON integrations.user_connections (user_id, status);

CREATE INDEX IF NOT EXISTS idx_user_connections_provider ON integrations.user_connections (provider_slug, status);

ALTER TABLE integrations.user_connections ENABLE ROW LEVEL SECURITY;

-- Deliberately NO grant to `authenticated` and NO policy: the token store is definer-only.
GRANT ALL ON TABLE integrations.user_connections TO service_role;
-- #endregion

-- #region 4. integrations.v_my_connections — the safe client projection
-- A non-`security_invoker` view (so it runs as its owner and can read the un-policied base table)
-- filtered to the caller. Token columns are simply not selected — the safety is structural, not a
-- policy that could be mis-edited later.
CREATE OR REPLACE VIEW
    integrations.v_my_connections AS
SELECT
    c.id,
    c.user_id,
    c.provider_slug,
    p.label AS provider_label,
    p.capabilities AS provider_capabilities,
    c.status,
    c.granted_kinds,
    c.granted_scopes,
    c.external_account_label,
    c.token_expires_at,
    c.last_synced_at,
    c.last_error,
    c.revoked_at,
    c.created_at,
    c.updated_at
FROM
    integrations.user_connections c
    JOIN integrations.providers p ON p.slug = c.provider_slug
WHERE
    c.user_id = auth.uid ();

GRANT SELECT ON integrations.v_my_connections TO authenticated;
-- #endregion

-- #region 5. integrations.connection_audit — the consent trail
-- Every connect / refresh / revoke, so a user can answer "when did I grant this, and what happened
-- since?". Append-only in practice; the connection FK is SET NULL rather than CASCADE so the trail
-- survives a connection row being replaced.
CREATE TABLE IF NOT EXISTS integrations.connection_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid REFERENCES integrations.user_connections (id) ON DELETE SET NULL,
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    provider_slug text NOT NULL,
    action integrations.connection_action NOT NULL,
    -- Human-readable context (no tokens, no scopes-with-secrets, no PII beyond the account label).
    detail text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connection_audit_user ON integrations.connection_audit (user_id, created_at DESC);

ALTER TABLE integrations.connection_audit ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE integrations.connection_audit TO authenticated;

GRANT ALL ON TABLE integrations.connection_audit TO service_role;

-- A user reads their own consent history; writes are service-role only (the OAuth Edge Function).
DROP POLICY IF EXISTS "View own connection audit" ON integrations.connection_audit;

CREATE POLICY "View own connection audit" ON integrations.connection_audit FOR
SELECT TO authenticated USING (
        user_id = auth.uid ()
        OR security.is_admin ()
    );
-- #endregion

-- #region 6. Capability predicates
-- "Can this user's stored consents do X?" — the in-DB gates the booking flow needs without ever
-- exposing the token store. SECURITY DEFINER so they can read the definer-only table.

-- Does the user hold an ACTIVE connection capable of the given kind?
CREATE OR REPLACE FUNCTION integrations.fn_has_capability(
    p_user uuid, p_kind integrations.provider_kind
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM integrations.user_connections c
        WHERE c.user_id = p_user
          AND c.status = 'active'::integrations.connection_status
          AND p_kind = ANY (c.granted_kinds)
    );
$$;

-- The provider slug that should mint a meeting room for this user, or NULL when none is connected
-- (the caller then falls back to a platform-hosted room or a manual link).
CREATE OR REPLACE FUNCTION integrations.fn_conferencing_provider(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = integrations, public
AS $$
    SELECT c.provider_slug
    FROM integrations.user_connections c
    WHERE c.user_id = p_user
      AND c.status = 'active'::integrations.connection_status
      AND 'conferencing'::integrations.provider_kind = ANY (c.granted_kinds)
    ORDER BY c.updated_at DESC
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION integrations.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_user_connections_touch
    BEFORE UPDATE ON integrations.user_connections
    FOR EACH ROW EXECUTE FUNCTION integrations.fn_touch_updated_at ();

GRANT
EXECUTE ON FUNCTION integrations.fn_has_capability (uuid, integrations.provider_kind) TO authenticated;

GRANT
EXECUTE ON FUNCTION integrations.fn_conferencing_provider (uuid) TO authenticated;
-- #endregion
