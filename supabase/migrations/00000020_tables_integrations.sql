-- =============================================================================================
-- 00000020_tables_integrations.sql — integrations schema tables (Category 0).
--
-- The `integrations` schema is the platform's CONNECTOR + PLUGIN substrate. It is deliberately
-- built as a generic provider/consent/sync framework, not a per-vendor set of tables, so adding a
-- 50th connector is a seed row + adapter code, never a schema change (SYSTEM_ARCHITECTURE.md
-- §Integration & Plugin Platform).
--
-- Two subsystems, one schema:
--   A. User CONNECTORS — providers, per-user connections, the token vault, sync cursors and the
--      webhook (provider push) machinery.
--   B. The PLUGIN ecosystem — the developer registry, versions, the extension-point + scope
--      catalogues, per-user/workspace installations, API grants and the audit trail.
--
-- NOT modelled here (by design): platform AUTH (SSO/OAuth login is GoTrue's; no third-party token
-- is retained) and platform INFRA (Stripe, Maps — server-owned keys behind the service layer).
-- Authentication ≠ authorization: a user signed in "with Google" still grants a Google Calendar
-- CONNECTION separately, and its token lives in the vault below.
--
-- Zod SSOT: packages/types/integrations/*. Docs: documentation/database/integrations/*.
-- =============================================================================================

-- =============================================================================================
-- A. CONNECTOR SUBSTRATE
-- =============================================================================================

-- #region integrations.providers
-- The public, non-sensitive catalogue: one row per integrable third party. Reference DATA — a new
-- provider is a seed row, not a migration. `slug` is the stable identity that scheduling and the
-- connection rows reference; it is a VENDOR key (`google`, `microsoft`), with the fine-grained
-- consent handled per-capability on the connection.
CREATE TABLE integrations.providers (
    slug text PRIMARY KEY,
    label text NOT NULL,
    category integrations.provider_category NOT NULL,
    -- Every capability this vendor can offer. Consent is per-capability (see granted_kinds), so the
    -- catalogue advertises the full set and the connection records the subset actually granted.
    capabilities integrations.provider_kind[] NOT NULL,
    auth_scheme integrations.auth_scheme NOT NULL DEFAULT 'oauth2',
    -- Platform kill-switch. A row may exist (so historical connections still resolve) while new
    -- consents are refused. Ships false — enabling one is an operator decision requiring credentials.
    is_enabled boolean NOT NULL DEFAULT false,
    is_beta boolean NOT NULL DEFAULT false,
    -- Which broker fronts this provider: 'direct', 'nylas', 'merge', … Documents the integration
    -- strategy (unified API vs direct) so the adapter layer knows where to route.
    broker text NOT NULL DEFAULT 'direct',
    supports_webhooks boolean NOT NULL DEFAULT false,
    -- Scopes requested at consent time. CONFIG/DOCUMENTATION ONLY — never a credential.
    default_scopes text[] NOT NULL DEFAULT '{}',
    -- Non-secret endpoint/PKCE config: { authorize_url, token_url, revoke_url, pkce, audience }.
    -- The client SECRET is never stored here — it lives in the Environment Variable Contract.
    auth_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    docs_url text,
    icon_url text,
    sort_order integer NOT NULL DEFAULT 100,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_provider_has_capability CHECK (array_length (capabilities, 1) IS NOT NULL)
);
-- #endregion

-- #region integrations.user_connections
-- One row per (user, provider, external account) — a user's stored authorization. `id` is the
-- stable identity scheduling.events / discovery_calls reference. DEFINER-ONLY: RLS on, no policy,
-- no `authenticated` grant; clients read integrations.v_my_connections (which cannot project a
-- token). The state machine lives in `status`.
CREATE TABLE integrations.user_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    provider_slug text NOT NULL REFERENCES integrations.providers (slug) ON DELETE RESTRICT,
    status integrations.connection_status NOT NULL DEFAULT 'pending',
    -- What the consent actually granted — may be narrower than the provider's capabilities.
    granted_kinds integrations.provider_kind[] NOT NULL DEFAULT '{}',
    granted_scopes text[] NOT NULL DEFAULT '{}',
    sync_direction integrations.sync_direction NOT NULL DEFAULT 'inbound',
    -- WHICH account at the far end is linked. Modelling the account explicitly lets one user connect
    -- two Google accounts (personal + work) without a painful later migration.
    external_account_id text,
    external_account_label text,
    -- When a unified broker (Nylas/Merge) fronts this provider, its grant id for this connection.
    broker_account_id text,
    -- Cached, NON-secret expiry so the settings UI can show "reconnect soon" without touching the
    -- vault. The authoritative expiry is in integrations.connection_secrets.
    token_expires_at timestamptz,
    last_synced_at timestamptz,
    last_error text,
    error_count integer NOT NULL DEFAULT 0,
    connected_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- One connection per account. NULLS NOT DISTINCT so two pending rows (account not yet known)
    -- for the same provider collapse instead of duplicating.
    CONSTRAINT uq_user_connection UNIQUE NULLS NOT DISTINCT (user_id, provider_slug, external_account_id)
);
-- #endregion

-- #region integrations.connection_secrets
-- The TOKEN VAULT, split from the connection so the RLS/grant story is airtight and structural:
-- this table is definer-only AND has no client-facing view at all — service-role (Edge Functions)
-- only. Envelope encryption: `*_cipher` is ciphertext produced with a data key wrapped by the KMS
-- master key identified by `key_id`; `nonce` is the AEAD IV. A plaintext token is NEVER written.
CREATE TABLE integrations.connection_secrets (
    connection_id uuid PRIMARY KEY REFERENCES integrations.user_connections (id) ON DELETE CASCADE,
    access_token_cipher bytea,
    refresh_token_cipher bytea,
    token_type text NOT NULL DEFAULT 'bearer',
    access_token_expires_at timestamptz,
    refresh_token_expires_at timestamptz,
    -- Envelope-encryption metadata. `key_id` identifies the wrapping KMS key for rotation.
    key_id text NOT NULL,
    encryption_alg text NOT NULL DEFAULT 'aes-256-gcm',
    nonce bytea,
    rotated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region integrations.connection_sync_state
-- Per-resource sync cursors — the delta tokens that make incremental sync possible (Google
-- `syncToken`, Microsoft `deltaLink`, an opaque page cursor). Split from the connection because one
-- connection may sync several resources (primary calendar + a shared calendar; drive root + a
-- folder), each with its own cursor and its own last-error.
CREATE TABLE integrations.connection_sync_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid NOT NULL REFERENCES integrations.user_connections (id) ON DELETE CASCADE,
    -- The synced resource, e.g. 'calendar:primary', 'drive:root', 'contacts'.
    resource text NOT NULL,
    kind integrations.provider_kind NOT NULL,
    sync_token text,
    full_sync_completed_at timestamptz,
    last_delta_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_sync_resource UNIQUE (connection_id, resource)
);
-- #endregion

-- #region integrations.webhook_subscriptions
-- Provider PUSH channels. Change notifications from a provider (calendar/storage) require a
-- registered channel that EXPIRES and must be re-registered before `expires_at` — a cron reads
-- `status = 'expiring'` to renew. Missing that window silently stops sync, so the expiry is a
-- first-class, indexed column.
CREATE TABLE integrations.webhook_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid NOT NULL REFERENCES integrations.user_connections (id) ON DELETE CASCADE,
    provider_slug text NOT NULL,
    resource text NOT NULL,
    -- The provider's identifiers for this channel, used to correlate an inbound push.
    external_channel_id text,
    external_resource_id text,
    -- Provider-issued token echoed on each push so we can verify it. Not a user credential.
    verification_token text,
    callback_url text,
    status integrations.webhook_status NOT NULL DEFAULT 'active',
    -- THE renewal driver.
    expires_at timestamptz,
    last_renewed_at timestamptz,
    last_delivery_at timestamptz,
    failure_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_webhook_resource UNIQUE (connection_id, resource)
);
-- #endregion

-- #region integrations.webhook_deliveries
-- The idempotency ledger for INBOUND provider pushes. Providers redeliver and reorder; this table
-- dedupes on the provider's own delivery id and records whether the signature verified, so a
-- replayed or forged push cannot double-process. Same discipline as comms.delivery_events.
CREATE TABLE integrations.webhook_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subscription_id uuid REFERENCES integrations.webhook_subscriptions (id) ON DELETE SET NULL,
    provider_slug text NOT NULL,
    -- The provider's message id. Unique with the slug — the idempotency key.
    external_delivery_id text NOT NULL,
    signature_verified boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'received',
    payload_digest text,
    error text,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    CONSTRAINT uq_webhook_delivery UNIQUE (provider_slug, external_delivery_id)
);
-- #endregion

-- #region integrations.connection_audit
-- The consent trail — "when did I grant this, and what has happened since?" Denormalised
-- provider_slug so a line reads standalone; `detail` carries human context but NEVER a token or PII
-- beyond the account label.
CREATE TABLE integrations.connection_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid REFERENCES integrations.user_connections (id) ON DELETE SET NULL,
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    provider_slug text NOT NULL,
    action integrations.connection_action NOT NULL,
    detail text,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- =============================================================================================
-- B. PLUGIN ECOSYSTEM
--
-- Post-MVP by roadmap, but the schema is laid down now so the later build is not a rewrite. The
-- trust model is adversarial (Figma/Shopify, NOT Obsidian): third-party code never runs in our
-- origin (sandboxed iframe / declarative), and every data touch goes through capability-scoped
-- consent that reuses the same machinery as connection scopes.
-- =============================================================================================

-- #region integrations.extension_points
-- The SLOT registry: the catalogue of surfaces a plugin may inject into. Reference data, and the
-- first-party counterpart of the app's own URL-keyed slot resolvers (channelHeaderFor, laneFor…).
-- A plugin can only target a `key` that exists and is enabled here.
CREATE TABLE integrations.extension_points (
    key text PRIMARY KEY,
    surface integrations.plugin_surface NOT NULL,
    label text NOT NULL,
    description text,
    -- Which runtimes may render into this slot (some slots forbid iframes, some require them).
    allowed_runtimes integrations.plugin_runtime[] NOT NULL DEFAULT '{iframe,declarative}',
    is_enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region integrations.plugin_scopes
-- The Plugin-API PERMISSION vocabulary as DATA — 'read:messages', 'write:files', 'read:calendar'.
-- A plugin version requests a subset; the user consents; the host mediates every call against the
-- installation's granted set. Kept a table (not an enum) so a new capability is a seed row.
CREATE TABLE integrations.plugin_scopes (
    key text PRIMARY KEY,
    label text NOT NULL,
    description text,
    -- Which data domain it reaches (messaging, files, projects, calendar, …).
    domain text NOT NULL,
    risk integrations.scope_risk NOT NULL DEFAULT 'medium',
    created_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region integrations.plugins
-- The developer REGISTRY: one row per published (or in-development) plugin. Hosted from a GitHub
-- repo, connected through the Developer Kit. `install_count` is a denormalised counter maintained
-- by a trigger; the currently-published version is derived (a view), not a stored back-pointer, to
-- avoid a circular FK with plugin_versions.
CREATE TABLE integrations.plugins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    tagline text,
    description text,
    developer_user_id uuid REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    developer_name text,
    homepage_url text,
    repo_url text,
    icon_url text,
    category text,
    status integrations.plugin_status NOT NULL DEFAULT 'draft',
    -- The default runtime; a version may narrow it. iframe = zero-trust sandbox default.
    runtime integrations.plugin_runtime NOT NULL DEFAULT 'iframe',
    -- First-party / reviewed badge.
    is_verified boolean NOT NULL DEFAULT false,
    install_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region integrations.plugin_versions
-- An immutable, reviewable version of a plugin. The `manifest` is the source of truth for what the
-- version declares (targeted extension points, requested scopes, entry points); `bundle_url` serves
-- the sandboxed bundle from a SEPARATE origin and `bundle_integrity` is its SRI hash. `source_commit`
-- pins the GitHub commit the bundle was built from.
CREATE TABLE integrations.plugin_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    plugin_id uuid NOT NULL REFERENCES integrations.plugins (id) ON DELETE CASCADE,
    semver text NOT NULL,
    status integrations.plugin_version_status NOT NULL DEFAULT 'draft',
    runtime integrations.plugin_runtime NOT NULL DEFAULT 'iframe',
    -- The declared plugin manifest: surfaces[], scopes[], entry points, config schema.
    manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
    bundle_url text,
    bundle_integrity text,
    source_commit text,
    -- The capability scopes this version asks for (keys into integrations.plugin_scopes).
    requested_scopes text[] NOT NULL DEFAULT '{}',
    min_platform_version text,
    changelog text,
    reviewed_by uuid REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    submitted_at timestamptz,
    approved_at timestamptz,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_plugin_version UNIQUE (plugin_id, semver)
);
-- #endregion

-- #region integrations.plugin_installations
-- A user's (or workspace's) install of a plugin, with the consented scope set. `install_scope` +
-- `owner_id` mirror the platform owner axis (personal vs a team/business/org vault); `version_id`
-- is the pinned installed version. Uninstall is soft (`revoked`), nothing is hard-deleted.
CREATE TABLE integrations.plugin_installations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    plugin_id uuid NOT NULL REFERENCES integrations.plugins (id) ON DELETE RESTRICT,
    version_id uuid NOT NULL REFERENCES integrations.plugin_versions (id) ON DELETE RESTRICT,
    installer_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    install_scope integrations.install_scope NOT NULL DEFAULT 'user',
    -- The team/business/org id when install_scope is not 'user'; NULL for a personal install.
    owner_id uuid,
    status integrations.install_status NOT NULL DEFAULT 'active',
    -- The capability scopes the installer actually consented to (a subset of the version's request).
    granted_scopes text[] NOT NULL DEFAULT '{}',
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    auto_update boolean NOT NULL DEFAULT false,
    installed_at timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz,
    revoked_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_plugin_installation UNIQUE NULLS NOT DISTINCT (plugin_id, installer_user_id, install_scope, owner_id)
);
-- #endregion

-- #region integrations.plugin_grants
-- OAuth-client-style credentials for HEADLESS/automation plugins that call the Plugin API
-- server-to-server. The secret is stored HASHED (never ciphertext-decryptable, never plaintext) —
-- a leaked table row cannot be replayed. Scoped to one installation.
CREATE TABLE integrations.plugin_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    installation_id uuid NOT NULL REFERENCES integrations.plugin_installations (id) ON DELETE CASCADE,
    client_id text NOT NULL UNIQUE,
    secret_hash text NOT NULL,
    scopes text[] NOT NULL DEFAULT '{}',
    last_used_at timestamptz,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region integrations.plugin_audit
-- The install/consent/invocation trail for a plugin — the plugin counterpart of connection_audit.
CREATE TABLE integrations.plugin_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    plugin_id uuid REFERENCES integrations.plugins (id) ON DELETE SET NULL,
    installation_id uuid REFERENCES integrations.plugin_installations (id) ON DELETE SET NULL,
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    action integrations.plugin_action NOT NULL,
    detail text,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion
