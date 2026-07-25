-- =============================================================================================
-- 00000004_enums_domains.sql — Consolidated ENUM types, part 2 (Category 0).
-- finance / comms / scheduling / integrations / analytics enums, gathered and deduplicated.
-- Sources: 20260723091000..094000 (finance kyc/method/deposit/payout/pot/vault/split/approval/
--          vault_action/fund_state/statement/chargeback), 20260724112000 (finance plan/billing/
--          subscription/entitlement enums); 20260724090000 (comms enums);
--          20260724100000/102000/103000 (scheduling enums); 20260724101000 (integrations enums);
--          20260724110000 (analytics.subject_kind).
-- =============================================================================================

-- #region finance
CREATE TYPE finance.kyc_status AS ENUM ('unverified', 'pending', 'verified', 'rejected', 'expired');

CREATE TYPE finance.method_role AS ENUM ('funding', 'payout', 'both');

CREATE TYPE finance.deposit_interval AS ENUM ('weekly', 'monthly');

CREATE TYPE finance.payout_mode AS ENUM ('manual', 'scheduled_weekly', 'scheduled_monthly', 'threshold');

CREATE TYPE finance.pot_purpose AS ENUM ('tax', 'savings', 'goal', 'general');

CREATE TYPE finance.vault_capability AS ENUM (
    'view', 'add_funds', 'spend', 'distribute', 'withdraw', 'manage_members', 'manage_billing'
);

CREATE TYPE finance.split_rule_type AS ENUM ('co_op', 'finders_fee', 'benevolent_dictator');

CREATE TYPE finance.approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TYPE finance.vault_action AS ENUM ('add_funds', 'spend', 'distribute', 'withdraw', 'transfer');

CREATE TYPE finance.fund_state AS ENUM ('locked', 'pending', 'available', 'on_hold');

CREATE TYPE finance.statement_status AS ENUM ('draft', 'issued', 'final');

CREATE TYPE finance.chargeback_status AS ENUM ('opened', 'under_review', 'won', 'lost', 'refunded');

CREATE TYPE finance.plan_audience AS ENUM ('individual', 'team', 'business', 'organisation');

CREATE TYPE finance.plan_tier AS ENUM ('free', 'pro', 'enterprise');

CREATE TYPE finance.billing_interval AS ENUM ('monthly', 'annual', 'custom');

CREATE TYPE finance.subscription_state AS ENUM
    ('trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired');

CREATE TYPE finance.entitlement_kind AS ENUM ('limit', 'flag');

CREATE TYPE finance.entitlement_scaling AS ENUM ('none', 'standing_base', 'standing_bonus');

CREATE TYPE finance.entitlement_key AS ENUM (
    -- Footprint (buyer side)
    'active_public_projects',
    'private_drafts',
    -- Footprint (seller side)
    'published_listings',
    -- Distribution
    'weekly_proposals',
    'proposal_buffer_per_10h',
    -- Ownership umbrella (how many entities a PERSON may spin up)
    'teams_owned',
    'businesses_owned',
    'teams_joined',
    'businesses_joined',
    -- Entity muscle (what an entity's OWN plan powers)
    'team_seats',
    'team_public_projects',
    'business_public_projects',
    'business_managers',
    'organisation_seats',
    'organisation_businesses',
    'departments',
    -- Capability flags
    'promoted_placement',
    'advanced_analytics',
    'discovery_boost',
    'instant_payouts_included',
    'pooled_wallet_full',
    'advanced_vault_splits',
    'intervaled_invoicing',
    'sso_enabled',
    'api_access',
    'audit_log_retention_days',
    'dedicated_support',
    'negotiated_platform_fee'
);
-- #endregion

-- #region comms
CREATE TYPE comms.notification_channel AS ENUM ('in_app', 'push', 'email', 'sms', 'webhook');

CREATE TYPE comms.notification_urgency AS ENUM ('critical', 'high', 'medium', 'low');

CREATE TYPE comms.notification_category AS ENUM (
    'money',      -- escrow, payouts, wallet, invoices, disputes over funds
    'work',       -- projects, stages, tickets, submissions, applications
    'messages',   -- DMs, channel messages, mentions, reactions
    'schedule',   -- sessions, bookings, reminders, reschedules
    'discovery',  -- marketplace, catalogue, reviews, follows, suggestions
    'account',    -- identity, verification, team/org membership, permissions
    'system',     -- security, moderation, policy, maintenance
    'marketing'   -- opt-in only; never mandatory
);

CREATE TYPE comms.delivery_status AS ENUM (
    'pending', 'queued', 'sent', 'delivered', 'failed', 'suppressed', 'skipped'
);

CREATE TYPE comms.digest_frequency AS ENUM ('off', 'daily', 'weekly');

CREATE TYPE comms.device_platform AS ENUM ('web', 'ios', 'android');

CREATE TYPE comms.queue_status AS ENUM ('scheduled', 'processing', 'sent', 'cancelled', 'failed');
-- #endregion

-- #region scheduling
CREATE TYPE scheduling.owner_type AS ENUM ('user', 'freelancer', 'team', 'business', 'organisation');

CREATE TYPE scheduling.availability_kind AS ENUM ('working_hours', 'call_window');

CREATE TYPE scheduling.event_kind AS ENUM (
    'deadline', 'milestone', 'sync', 'session', 'booking',
    'availability', 'busy', 'holiday', 'general'
);

CREATE TYPE scheduling.event_status AS ENUM (
    'confirmed', 'tentative', 'busy', 'available', 'cancelled'
);

CREATE TYPE scheduling.call_type AS ENUM ('courtesy', 'paid');

CREATE TYPE scheduling.call_status AS ENUM (
    'proposed', 'confirmed', 'declined', 'cancelled', 'completed', 'no_show', 'expired'
);

CREATE TYPE scheduling.call_party AS ENUM ('host', 'requester', 'both');

CREATE TYPE scheduling.call_action AS ENUM (
    'requested', 'confirmed', 'declined', 'rescheduled', 'cancelled',
    'completed', 'marked_no_show', 'expired', 'link_generated', 'reminder_sent'
);
-- #endregion

-- #region integrations
-- The `integrations` schema is the platform's connector + plugin substrate. It models the two
-- axes the architecture is built on (SYSTEM_ARCHITECTURE.md §Integration & Plugin Platform):
--   * User CONNECTORS — a user's stored authorization to act at a third party (calendar, storage…).
--   * The PLUGIN ecosystem — third-party code injected into the app through governed extension points.
-- Platform AUTH (SSO/OAuth login) and INFRA (Stripe, Maps) are deliberately NOT modelled here:
-- auth is GoTrue's, infra is platform-owned server keys behind the service layer.

-- `provider_kind` — the fine-grained CAPABILITY axis: what a connection is authorized to DO. This
-- is the unit of consent (a user may grant calendar but not storage at the same vendor), so it is
-- what `user_connections.granted_kinds` records — never collapse two of these into one chip.
-- `calendar`/`conferencing` are the original two; the rest are additive.
CREATE TYPE integrations.provider_kind AS ENUM (
    'calendar', 'conferencing', 'freebusy', 'storage', 'docs',
    'contacts', 'code', 'issues', 'crm', 'messaging', 'identity', 'payments'
);

-- `provider_category` — the coarse FAMILY axis: how the catalogue groups a vendor in the UI. One
-- value per provider row (a vendor's category), distinct from the multi-valued capability array.
CREATE TYPE integrations.provider_category AS ENUM (
    'identity', 'payments', 'calendar', 'conferencing',
    'storage', 'productivity', 'developer', 'crm', 'communication', 'automation'
);

-- `auth_scheme` — how the platform obtains authorization at a provider. Drives the connect flow;
-- the actual client secret always lives in env, never in a table.
CREATE TYPE integrations.auth_scheme AS ENUM ('oauth2', 'oauth1', 'api_key', 'app_password', 'none');

-- `connection_status` — the connection STATE MACHINE. `pending` (consent started, not completed)
-- → `active` → `degraded` (token refresh failing but recoverable) → `expired` (recoverable by a
-- refresh) / `revoked` (terminal — needs a fresh consent) / `disconnected` (user removed) /
-- `error` (unexpected). `active`/`expired`/`revoked`/`error` are the original four.
CREATE TYPE integrations.connection_status AS ENUM (
    'pending', 'active', 'degraded', 'expired', 'revoked', 'disconnected', 'error'
);

-- `sync_direction` — read-only inbound is the MVP default; `outbound`/`bidirectional` are V2+ per
-- connector (bidirectional carries echo-suppression + conflict cost, SYSTEM_ARCHITECTURE.md).
CREATE TYPE integrations.sync_direction AS ENUM ('inbound', 'outbound', 'bidirectional');

-- `webhook_status` — a provider push channel's lifecycle. `expiring` is the renewal trigger
-- (Google/Microsoft channels lapse on a schedule and must be re-registered before `expires_at`).
CREATE TYPE integrations.webhook_status AS ENUM ('active', 'expiring', 'expired', 'failed');

CREATE TYPE integrations.connection_action AS ENUM (
    'connected', 'reconnected', 'refreshed', 'refresh_failed', 'scope_changed',
    'sync_started', 'sync_completed', 'sync_failed',
    'webhook_registered', 'webhook_renewed', 'webhook_expired',
    'expired', 'revoked', 'error', 'synced'
);

-- The PLUGIN ecosystem vocabulary (all post-MVP; the schema is laid down now so the later build is
-- not a rewrite — SYSTEM_ARCHITECTURE.md §Plugin Ecosystem).

-- `plugin_status` — a plugin's marketplace lifecycle. Nothing is hard-deleted: `delisted` is the
-- archived terminal (root CLAUDE.md §5).
CREATE TYPE integrations.plugin_status AS ENUM (
    'draft', 'submitted', 'in_review', 'approved', 'published', 'suspended', 'delisted'
);

-- `plugin_version_status` — an individual version's review/publish state. `yanked` pulls a bad
-- version without delisting the plugin.
CREATE TYPE integrations.plugin_version_status AS ENUM (
    'draft', 'submitted', 'in_review', 'approved', 'published', 'deprecated', 'yanked'
);

-- `plugin_runtime` — the isolation/UI model a version uses. `iframe` = sandboxed cross-origin UI
-- (the zero-trust default, Figma/Shopify model); `declarative` = a Block-Kit-style host-rendered
-- descriptor (no third-party code in our origin); `headless` = no UI, server/automation only.
CREATE TYPE integrations.plugin_runtime AS ENUM ('iframe', 'declarative', 'headless');

-- `plugin_surface` — the KIND of extension point a plugin contributes to. Mirrors the app's own
-- slot-resolver pattern (channelHeaderFor/laneFor/…) so first-party slots and plugin slots share
-- one registry.
CREATE TYPE integrations.plugin_surface AS ENUM (
    'page_tab', 'panel', 'dashboard_widget', 'sidebar_item',
    'command', 'settings_section', 'automation_action'
);

-- `install_status` — a per-user/workspace installation's state.
CREATE TYPE integrations.install_status AS ENUM ('active', 'disabled', 'revoked');

-- `install_scope` — WHERE an installation runs and whose data it may touch. Mirrors the platform's
-- owner axis (personal vs team/business/organisation vault).
CREATE TYPE integrations.install_scope AS ENUM ('user', 'team', 'business', 'organisation');

-- `scope_risk` — drives how loudly the consent UI must surface a requested Plugin-API scope.
CREATE TYPE integrations.scope_risk AS ENUM ('low', 'medium', 'high');

-- `plugin_action` — the plugin install/consent/invocation audit vocabulary.
CREATE TYPE integrations.plugin_action AS ENUM (
    'installed', 'updated', 'enabled', 'disabled', 'uninstalled',
    'scope_granted', 'scope_revoked', 'version_pinned', 'invoked', 'api_call', 'error'
);
-- #endregion

-- #region analytics
CREATE TYPE analytics.subject_kind AS ENUM (
    'user', 'freelancer', 'business', 'team', 'organisation',
    'project', 'stage', 'ticket', 'listing', 'platform'
);
-- #endregion

-- #region files
-- The rich, searchable file taxonomy. Values are the CANONICAL FileCategory literals from the Zod
-- SSOT (@projective/types/files, `FileCategory`) verbatim — PascalCase, not the usual snake_case —
-- so `files.items.category` stores exactly what `describeFile().category` returns, with no mapping
-- layer to drift. The extension→category MAP that produces these stays in the TS SSOT (the database
-- never classifies; the fat backend classifies on upload and writes the result here).
CREATE TYPE files.file_category AS ENUM (
    'Document', 'Presentation', 'Spreadsheet', 'Audio', 'Video', 'Image', 'Vector',
    'Medical', 'Scientific', 'Compression', 'Executable', 'Code', '3D', 'Database',
    'Data', 'Font', 'Security', 'System', 'Email', 'DiskImage', 'VMImage',
    'ContainerImage', 'CAD', 'GIS', 'Ebook', 'Config', 'Package', 'Other'
);
-- #endregion
