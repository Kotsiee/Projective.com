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
CREATE TYPE integrations.provider_kind AS ENUM ('calendar', 'conferencing');

CREATE TYPE integrations.connection_status AS ENUM ('active', 'expired', 'revoked', 'error');

CREATE TYPE integrations.connection_action AS ENUM (
    'connected', 'refreshed', 'scope_changed', 'expired', 'revoked', 'error', 'synced'
);
-- #endregion

-- #region analytics
CREATE TYPE analytics.subject_kind AS ENUM (
    'user', 'freelancer', 'business', 'team', 'organisation',
    'project', 'stage', 'ticket', 'listing', 'platform'
);
-- #endregion
