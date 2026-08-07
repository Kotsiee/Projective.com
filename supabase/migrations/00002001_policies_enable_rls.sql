-- =============================================================================
-- ENABLE / FORCE ROW LEVEL SECURITY (all tables) — must precede all policies
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0119_project_lifecycle.sql ---

-- New table -> own RLS (no later migration re-defines it, so it is safe to declare inline here).
ALTER TABLE projects.project_status_history ENABLE ROW LEVEL SECURITY;


-- --- from 0201_rls.sql ---

ALTER TABLE comms.channel_files ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.device_tokens ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.dm_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.dm_participants ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.dm_threads ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.message_attachments ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.notification_prefs ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.project_channel_participants ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.project_channels ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.project_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE marketplace.service_blueprints ENABLE ROW LEVEL SECURITY;

ALTER TABLE ops.admin_users ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.business_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.freelancer_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.org_invitations ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.portfolios ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.profile_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.skills ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.team_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.team_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.teams ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.user_bookmarks ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.user_emails ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.user_skills ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.users_public ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.cohort_memberships ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.cohorts ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.maintenance_contracts ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.project_activity ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.project_attachments ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.project_participants ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.project_stages ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.projects ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.session_attendance ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.session_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.stage_assignments ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.stage_budget_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.stage_open_seats ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.stage_revision_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.stage_staffing_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.stage_submissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.submission_files ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.tickets ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.ticket_workload_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.waitlists ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.escrows ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.spending_limits ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.invoice_line_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.contribution_agreements ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.payout_splits ENABLE ROW LEVEL SECURITY;

ALTER TABLE security.penalties ENABLE ROW LEVEL SECURITY;

ALTER TABLE security.platform_params ENABLE ROW LEVEL SECURITY;

ALTER TABLE reviews.entity_reviews ENABLE ROW LEVEL SECURITY;

ALTER TABLE search.profiles_index ENABLE ROW LEVEL SECURITY;

ALTER TABLE search.projects_index ENABLE ROW LEVEL SECURITY;

ALTER TABLE search.services_index ENABLE ROW LEVEL SECURITY;

ALTER TABLE search.user_affinity ENABLE ROW LEVEL SECURITY;

ALTER TABLE search.query_logs ENABLE ROW LEVEL SECURITY;


-- --- from 0205_security.sql ---

ALTER TABLE security.session_context ENABLE ROW LEVEL SECURITY;


-- --- from 0208_files.sql ---

ALTER TABLE files.items ENABLE ROW LEVEL SECURITY;

-- --- files: asset management ---
-- ⚠️ files.folders had NEVER had RLS enabled. It has existed since 0002 holding `owner_user_id`,
-- and because the schema-wide grant in 00002500 hands `authenticated` full DML on every table in
-- `files`, every signed-in user could read, rename, re-parent and delete every other user's folder
-- tree. This is a real, pre-existing hole being closed, not new hardening.
ALTER TABLE files.folders ENABLE ROW LEVEL SECURITY;

ALTER TABLE files.share_links ENABLE ROW LEVEL SECURITY;

-- Download audit + the metered rollup: read-own, write-NEVER from a client (the server writes
-- them, exactly like comms.notifications). RLS on + no INSERT/UPDATE policy is what makes the
-- blanket schema grant harmless.
ALTER TABLE files.download_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE files.storage_usage ENABLE ROW LEVEL SECURITY;


-- --- from 0211_business.sql ---

ALTER TABLE org.business_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.business_roles ENABLE ROW LEVEL SECURITY;


-- --- from 0213_user_preferences.sql ---

ALTER TABLE org.user_preferences ENABLE ROW LEVEL SECURITY;


-- --- from 0218_search_engine_signals.sql ---

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
ALTER TABLE search.talent_signals  ENABLE ROW LEVEL SECURITY;

ALTER TABLE search.interest_events ENABLE ROW LEVEL SECURITY;


-- --- from 0219_search_engine_weights.sql ---

-- -----------------------------------------------------------------------------
-- RLS: only admins may read/write the raw config table directly. The ranking RPC
-- is SECURITY DEFINER and reads it regardless.
-- -----------------------------------------------------------------------------
ALTER TABLE search.search_weights ENABLE ROW LEVEL SECURITY;


-- --- from 0307_stage_staffing.sql ---

ALTER TABLE projects.stage_open_seat_skills ENABLE ROW LEVEL SECURITY;

-- #endregion

-- #region 9. RLS — applications visible to their applicant and the project owner
ALTER TABLE projects.project_applications ENABLE ROW LEVEL SECURITY;

ALTER TABLE projects.project_application_targets ENABLE ROW LEVEL SECURITY;


-- --- from 0314_organisations.sql ---

-- #endregion

-- #region RLS
ALTER TABLE org.organisations ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.organisation_members ENABLE ROW LEVEL SECURITY;


-- --- from 20260723090000_finance_currency_fx.sql ---

-- Reference data: readable by any authenticated caller (like security.platform_params); writes are
-- service-role / SECURITY DEFINER only (an ingestion job owns rate publication).
ALTER TABLE finance.fx_rates ENABLE ROW LEVEL SECURITY;


-- --- from 20260723091000_finance_verification_kyc.sql ---

ALTER TABLE finance.verification_cases ENABLE ROW LEVEL SECURITY;


-- --- from 20260723092000_finance_payment_methods_money_movement.sql ---

ALTER TABLE finance.payment_methods ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.deposit_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.payout_schedules ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.income_smoothing ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.wallet_pots ENABLE ROW LEVEL SECURITY;


-- --- from 20260723093000_finance_vault_governance.sql ---

ALTER TABLE finance.vault_permissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.split_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.spend_approvals ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.ledger_audit ENABLE ROW LEVEL SECURITY;


-- --- from 20260723094000_finance_statements_settlement.sql ---

ALTER TABLE finance.pending_releases ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.statements ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.chargebacks ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.idempotency_keys ENABLE ROW LEVEL SECURITY;


-- --- from 20260724094000_comms_notification_rls_jobs.sql ---

ALTER TABLE comms.notification_category_prefs ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.notification_type_mutes ENABLE ROW LEVEL SECURITY;

-- #endregion

-- #region 4. Catalog — readable by everyone signed in (the preference centre renders from it)
ALTER TABLE comms.notification_types ENABLE ROW LEVEL SECURITY;

-- #endregion

-- #region 6. Delivery, queue, digests, suppressions — read-own, write-never
ALTER TABLE comms.notification_deliveries ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.notification_queue ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.notification_digests ENABLE ROW LEVEL SECURITY;

ALTER TABLE comms.channel_suppressions ENABLE ROW LEVEL SECURITY;

-- Raw provider callbacks: no `authenticated` policy at all. Service role only.
ALTER TABLE comms.delivery_events ENABLE ROW LEVEL SECURITY;


-- --- from 20260724100000_scheduling_schema_availability.sql ---

-- #endregion

-- #region 7. RLS
ALTER TABLE scheduling.schedules ENABLE ROW LEVEL SECURITY;

ALTER TABLE scheduling.availability_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE scheduling.blackout_dates ENABLE ROW LEVEL SECURITY;


-- --- integrations: connectors + plugin ecosystem ---
-- Every integrations table is RLS-on. The operational/secret tables (connection_secrets,
-- connection_sync_state, webhook_*, plugin_grants) get NO policy — default-deny, service-role only.

ALTER TABLE integrations.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.user_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.connection_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.connection_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.connection_audit ENABLE ROW LEVEL SECURITY;

ALTER TABLE integrations.extension_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.plugin_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.plugins ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.plugin_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.plugin_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.plugin_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.plugin_audit ENABLE ROW LEVEL SECURITY;


-- --- from 20260724102000_scheduling_events.sql ---

-- #endregion

-- #region 3. RLS
-- Two reader classes: a project-anchored row follows the existing `projects.has_project_access`
-- gate; a schedule-anchored row is readable by the schedule's own side, and additionally by the
-- world when the schedule is published AND the row is a masked/free-busy overlay. A published
-- schedule therefore leaks its SHAPE (when someone is free) but never its CONTENT.
ALTER TABLE scheduling.events ENABLE ROW LEVEL SECURITY;


-- --- from 20260724103000_scheduling_discovery_calls.sql ---

-- #endregion

-- #region 7. RLS
ALTER TABLE scheduling.call_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE scheduling.discovery_calls ENABLE ROW LEVEL SECURITY;

ALTER TABLE scheduling.call_attendance ENABLE ROW LEVEL SECURITY;

ALTER TABLE scheduling.call_audit ENABLE ROW LEVEL SECURITY;


-- --- from 20260724110000_analytics_event_substrate.sql ---

ALTER TABLE analytics.event_catalogue ENABLE ROW LEVEL SECURITY;

ALTER TABLE analytics.events ENABLE ROW LEVEL SECURITY;

ALTER TABLE analytics.daily_rollups ENABLE ROW LEVEL SECURITY;


-- --- from 20260724111000_standing_reputation.sql ---

ALTER TABLE org.standing_levels ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.entity_standing ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.standing_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.create_mastery ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.achievements ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.entity_achievements ENABLE ROW LEVEL SECURITY;

ALTER TABLE org.quality_streaks ENABLE ROW LEVEL SECURITY;


-- --- from 20260724112000_billing_plans_entitlements.sql ---

ALTER TABLE finance.plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.plan_entitlements ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.subscription_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.entitlement_grants ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.standing_commission_tiers ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.negotiated_rates ENABLE ROW LEVEL SECURITY;


-- --- from 20260724113000_entitlements_allowances_enforcement.sql ---

ALTER TABLE finance.allowance_periods ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.allowance_ledger ENABLE ROW LEVEL SECURITY;


-- --- finance: basket, wishlist & saved cards ---
-- All three are user-facing (unlike most of the hidden ledger) and therefore ship with real
-- policies in 00002013 — RLS on with zero policies is default-deny and is a bug, not a lock
-- (root CLAUDE.md, Decision #57).

ALTER TABLE finance.baskets ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.basket_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.saved_cards ENABLE ROW LEVEL SECURITY;
