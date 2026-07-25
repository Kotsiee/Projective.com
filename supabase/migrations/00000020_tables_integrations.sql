-- =============================================================================================
-- 00000020_tables_integrations.sql — integrations schema tables (Category 0).
-- Source: 20260724101000_integrations_connections.sql.
-- =============================================================================================

CREATE TABLE integrations.providers (
    slug text PRIMARY KEY,
    label text NOT NULL,
    capabilities integrations.provider_kind[] NOT NULL,
    is_enabled boolean NOT NULL DEFAULT false,
    default_scopes text[] NOT NULL DEFAULT '{}',
    docs_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_provider_has_capability CHECK (array_length (capabilities, 1) IS NOT NULL)
);

CREATE TABLE integrations.user_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    provider_slug text NOT NULL REFERENCES integrations.providers (slug) ON DELETE RESTRICT,
    status integrations.connection_status NOT NULL DEFAULT 'active',
    granted_kinds integrations.provider_kind[] NOT NULL DEFAULT '{}',
    granted_scopes text[] NOT NULL DEFAULT '{}',
    external_account_id text,
    external_account_label text,
    -- Ciphertext only — encrypted in an Edge Function with ENCRYPTION_KEY. Never a raw token.
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

CREATE TABLE integrations.connection_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid REFERENCES integrations.user_connections (id) ON DELETE SET NULL,
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    provider_slug text NOT NULL,
    action integrations.connection_action NOT NULL,
    detail text,
    created_at timestamptz NOT NULL DEFAULT now()
);
