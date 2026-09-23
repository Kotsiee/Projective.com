-- =============================================================================
-- TABLE & SEQUENCE GRANTS / REVOKES
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0200_permissions.sql ---

GRANT
INSERT
,
UPDATE,
DELETE ON search.user_affinity TO authenticated;

GRANT INSERT ON search.query_logs TO authenticated, anon;


-- --- from 0205_security.sql ---

GRANT
SELECT,
INSERT
,
UPDATE ON
TABLE security.session_context TO authenticated;

GRANT ALL ON TABLE security.session_context TO service_role;

-- #region Penalties & platform params
GRANT SELECT ON TABLE security.penalties TO authenticated;

GRANT ALL ON TABLE security.penalties TO service_role;

GRANT SELECT ON TABLE security.platform_params TO authenticated;

GRANT ALL ON TABLE security.platform_params TO service_role;

-- #endregion

-- #region Finance: escrow visibility (writes are SECURITY DEFINER only)
GRANT SELECT ON TABLE finance.escrows TO authenticated;

GRANT ALL ON TABLE finance.escrows TO service_role;


-- --- from 0218_search_engine_signals.sql ---

GRANT SELECT ON search.talent_signals TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON search.talent_signals TO service_role;

GRANT INSERT ON search.interest_events TO anon, authenticated;

GRANT SELECT ON search.interest_events TO authenticated;

GRANT ALL ON search.interest_events TO service_role;


-- --- from 0219_search_engine_weights.sql ---

GRANT SELECT ON search.search_weights TO authenticated;

GRANT ALL ON search.search_weights TO service_role;


-- NOTE: grants on views live in 00003005_permissions_view_grants.sql (they must run after the views
-- are created in Category 3): comms.message_file_details, org.view_business_staff, and others below.


-- --- from 20260723090000_finance_currency_fx.sql ---

-- `anon` too: the FX floor is public reference data that SSR reads to convert a price for a
-- signed-out visitor (Decision #69). The only `finance` table `anon` holds a privilege on.
GRANT SELECT ON TABLE finance.fx_rates TO anon, authenticated;

GRANT ALL ON TABLE finance.fx_rates TO service_role;


-- --- from 20260723091000_finance_verification_kyc.sql ---

GRANT SELECT ON TABLE finance.verification_cases TO authenticated;

GRANT ALL ON TABLE finance.verification_cases TO service_role;


-- --- from 20260723092000_finance_payment_methods_money_movement.sql ---

-- No INSERT: a payment method is created by the processor's setup handshake (service role), the only
-- party that can say an instrument exists. The owner may relabel one or change the default.
GRANT SELECT, UPDATE ON TABLE finance.payment_methods TO authenticated;

GRANT ALL ON TABLE finance.payment_methods TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE finance.deposit_rules TO authenticated;

GRANT ALL ON TABLE finance.deposit_rules TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE finance.payout_schedules TO authenticated;

GRANT ALL ON TABLE finance.payout_schedules TO service_role;

-- SELECT only: enrolment is an eligibility decision made server-side (see the policy in 00002013).
GRANT SELECT ON TABLE finance.income_smoothing TO authenticated;

GRANT ALL ON TABLE finance.income_smoothing TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE finance.wallet_pots TO authenticated;

GRANT ALL ON TABLE finance.wallet_pots TO service_role;


-- --- from 20260723093000_finance_vault_governance.sql ---

GRANT SELECT ON TABLE finance.vault_permissions TO authenticated;

GRANT ALL ON TABLE finance.vault_permissions TO service_role;

GRANT SELECT ON TABLE finance.split_rules TO authenticated;

GRANT ALL ON TABLE finance.split_rules TO service_role;

GRANT SELECT, INSERT ON TABLE finance.spend_approvals TO authenticated;

GRANT ALL ON TABLE finance.spend_approvals TO service_role;

GRANT SELECT ON TABLE finance.ledger_audit TO authenticated;

GRANT ALL ON TABLE finance.ledger_audit TO service_role;


-- --- from 20260723094000_finance_statements_settlement.sql ---

GRANT SELECT ON TABLE finance.pending_releases TO authenticated;

GRANT ALL ON TABLE finance.pending_releases TO service_role;

GRANT SELECT ON TABLE finance.statements TO authenticated;

GRANT ALL ON TABLE finance.statements TO service_role;

GRANT SELECT ON TABLE finance.chargebacks TO authenticated;

GRANT ALL ON TABLE finance.chargebacks TO service_role;

GRANT ALL ON TABLE finance.idempotency_keys TO service_role;

-- finance.v_wallet_reconciliation grant → 00003005_permissions_view_grants.sql (view, Category 3).


-- --- from 20260724094000_comms_notification_rls_jobs.sql ---

-- =============================================================================================
-- 20260724094000_comms_notification_rls_jobs.sql
-- Notification engine foundation (5/5) — RLS policies, grants, realtime, the scheduled jobs and
-- the outbound dispatch webhook.
--
-- ADDITIVE ONLY. New policies, grants, functions and (guarded) cron schedules. Nothing existing is
-- dropped or altered. Authored, NOT applied to any live database.
--
-- ⚠️ THE BUG THIS FIXES FIRST. `comms.notifications`, `comms.notification_prefs` and
-- `comms.device_tokens` have had ROW LEVEL SECURITY ENABLED since migration 0201 and ZERO POLICIES
-- ever since. RLS with no policy is default-deny, so `authenticated` could not read a single
-- notification — and because Supabase Realtime enforces the same SELECT policy before it will emit
-- a row, the in-app channel could never have delivered anything even though the table has been in
-- the `supabase_realtime` publication since migration 0206. The policies in §2 are what make the
-- in-app channel actually work.
--
-- The write side stays closed on purpose: no INSERT policy exists on `comms.notifications`. Rows
-- are created ONLY by `comms.fn_notify` (SECURITY DEFINER) or the service role. A client cannot
-- forge a notification for itself or anyone else.
-- =============================================================================================

-- #region 1. Grants — the new tables (0200's blanket comms grant predates them)
GRANT SELECT ON TABLE comms.notification_types TO authenticated;

GRANT ALL ON TABLE comms.notification_types TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE comms.notification_category_prefs TO authenticated;

GRANT ALL ON TABLE comms.notification_category_prefs TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE comms.notification_type_mutes TO authenticated;

GRANT ALL ON TABLE comms.notification_type_mutes TO service_role;

GRANT SELECT ON TABLE comms.notification_deliveries TO authenticated;

GRANT ALL ON TABLE comms.notification_deliveries TO service_role;

GRANT SELECT ON TABLE comms.notification_queue TO authenticated;

GRANT ALL ON TABLE comms.notification_queue TO service_role;

GRANT SELECT ON TABLE comms.notification_digests TO authenticated;

GRANT ALL ON TABLE comms.notification_digests TO service_role;

-- Provider callbacks and suppressions are operational data. `authenticated` gets a read on its own
-- suppressions only (so the settings screen can explain "we stopped emailing you because…"), and
-- no access at all to raw gateway events.
GRANT SELECT ON TABLE comms.channel_suppressions TO authenticated;

GRANT ALL ON TABLE comms.channel_suppressions TO service_role;

GRANT ALL ON TABLE comms.delivery_events TO service_role;

-- comms notification view grants → 00003005_permissions_view_grants.sql (views, Category 3).


-- --- from 20260724100000_scheduling_schema_availability.sql ---

GRANT SELECT ON TABLE scheduling.schedules TO anon,
authenticated;

GRANT SELECT ON TABLE scheduling.availability_rules TO anon,
authenticated;

GRANT SELECT ON TABLE scheduling.blackout_dates TO anon,
authenticated;

GRANT
INSERT,
UPDATE,
DELETE ON TABLE scheduling.schedules TO authenticated;

GRANT
INSERT,
UPDATE,
DELETE ON TABLE scheduling.availability_rules TO authenticated;

GRANT
INSERT,
UPDATE,
DELETE ON TABLE scheduling.blackout_dates TO authenticated;

GRANT ALL ON TABLE scheduling.schedules TO service_role;

GRANT ALL ON TABLE scheduling.availability_rules TO service_role;

GRANT ALL ON TABLE scheduling.blackout_dates TO service_role;


-- --- integrations: connectors ---

GRANT SELECT ON TABLE integrations.providers TO anon,
authenticated;

GRANT ALL ON TABLE integrations.providers TO service_role;

-- Deliberately NO grant to `authenticated` and NO policy: the connection + token store is
-- definer-only. Clients read integrations.v_my_connections (Category 3).
GRANT ALL ON TABLE integrations.user_connections TO service_role;

-- The token VAULT and every operational table are service-role only — no anon/authenticated grant.
GRANT ALL ON TABLE integrations.connection_secrets TO service_role;
GRANT ALL ON TABLE integrations.connection_sync_state TO service_role;
GRANT ALL ON TABLE integrations.webhook_subscriptions TO service_role;
GRANT ALL ON TABLE integrations.webhook_deliveries TO service_role;

GRANT SELECT ON TABLE integrations.connection_audit TO authenticated;

GRANT ALL ON TABLE integrations.connection_audit TO service_role;

-- --- integrations: plugin ecosystem ---
-- Catalogues are public-readable reference data.
GRANT SELECT ON TABLE integrations.extension_points TO anon,
authenticated;

GRANT SELECT ON TABLE integrations.plugin_scopes TO anon,
authenticated;

-- Publishers (authenticated) create/update their own plugins + versions; RLS scopes to own rows.
GRANT SELECT, INSERT, UPDATE ON TABLE integrations.plugins TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE integrations.plugin_versions TO authenticated;

-- Installers create/update their own installations; uninstall is a soft UPDATE.
GRANT SELECT, INSERT, UPDATE ON TABLE integrations.plugin_installations TO authenticated;

GRANT SELECT ON TABLE integrations.plugin_audit TO authenticated;

-- plugin_grants holds hashed client secrets → service-role only, no anon/authenticated grant.
GRANT ALL ON TABLE integrations.extension_points TO service_role;
GRANT ALL ON TABLE integrations.plugin_scopes TO service_role;
GRANT ALL ON TABLE integrations.plugins TO service_role;
GRANT ALL ON TABLE integrations.plugin_versions TO service_role;
GRANT ALL ON TABLE integrations.plugin_installations TO service_role;
GRANT ALL ON TABLE integrations.plugin_grants TO service_role;
GRANT ALL ON TABLE integrations.plugin_audit TO service_role;


-- --- from 20260724102000_scheduling_events.sql ---

GRANT SELECT ON TABLE scheduling.events TO anon,
authenticated;

GRANT
INSERT,
UPDATE,
DELETE ON TABLE scheduling.events TO authenticated;

GRANT ALL ON TABLE scheduling.events TO service_role;

-- Event coordination: read by the event's parties under RLS, written only by the service role (see
-- the policies in 00002015 for why there is no client write path).
GRANT SELECT ON TABLE scheduling.event_attendees,
scheduling.event_reschedules,
scheduling.reschedule_proposals,
scheduling.proposal_votes,
scheduling.event_history,
scheduling.event_attachments TO authenticated;

GRANT ALL ON TABLE scheduling.event_attendees,
scheduling.event_reschedules,
scheduling.reschedule_proposals,
scheduling.proposal_votes,
scheduling.event_history,
scheduling.event_attachments TO service_role;


-- --- from 20260724103000_scheduling_discovery_calls.sql ---

GRANT SELECT ON TABLE scheduling.call_settings TO anon,
authenticated;

GRANT
INSERT,
UPDATE,
DELETE ON TABLE scheduling.call_settings TO authenticated;

GRANT SELECT,
INSERT,
UPDATE ON TABLE scheduling.discovery_calls TO authenticated;

GRANT SELECT ON TABLE scheduling.call_attendance TO authenticated;

GRANT SELECT ON TABLE scheduling.call_audit TO authenticated;

GRANT ALL ON TABLE scheduling.call_settings TO service_role;

GRANT SELECT ON TABLE scheduling.call_platforms TO anon,
authenticated;

GRANT
INSERT,
UPDATE,
DELETE ON TABLE scheduling.call_platforms TO authenticated;

GRANT ALL ON TABLE scheduling.call_platforms TO service_role;

GRANT ALL ON TABLE scheduling.discovery_calls TO service_role;

GRANT ALL ON TABLE scheduling.call_attendance TO service_role;

GRANT ALL ON TABLE scheduling.call_audit TO service_role;


-- --- from 20260724110000_analytics_event_substrate.sql ---

GRANT SELECT ON TABLE analytics.event_catalogue TO authenticated;

GRANT ALL ON TABLE analytics.event_catalogue TO service_role;

GRANT SELECT ON TABLE analytics.events TO authenticated;

GRANT ALL ON TABLE analytics.events TO service_role;

GRANT SELECT ON TABLE analytics.daily_rollups TO authenticated;

GRANT ALL ON TABLE analytics.daily_rollups TO service_role;

-- analytics.v_unregistered_events grant → 00003005_permissions_view_grants.sql (view, Category 3).


-- --- from 20260724111000_standing_reputation.sql ---

GRANT SELECT ON TABLE org.standing_levels TO authenticated;

GRANT ALL ON TABLE org.standing_levels TO service_role;

GRANT SELECT ON TABLE org.entity_standing TO authenticated;

GRANT ALL ON TABLE org.entity_standing TO service_role;

GRANT SELECT ON TABLE org.standing_events TO authenticated;

GRANT ALL ON TABLE org.standing_events TO service_role;

GRANT SELECT ON TABLE org.create_mastery TO authenticated;

GRANT ALL ON TABLE org.create_mastery TO service_role;

GRANT SELECT ON TABLE org.achievements TO authenticated;

GRANT ALL ON TABLE org.achievements TO service_role;

GRANT SELECT ON TABLE org.entity_achievements TO authenticated;

GRANT ALL ON TABLE org.entity_achievements TO service_role;

GRANT SELECT ON TABLE org.quality_streaks TO authenticated;

GRANT ALL ON TABLE org.quality_streaks TO service_role;


-- --- from 20260724112000_billing_plans_entitlements.sql ---

GRANT SELECT ON TABLE finance.plans TO authenticated;

GRANT ALL ON TABLE finance.plans TO service_role;

GRANT SELECT ON TABLE finance.plan_entitlements TO authenticated;

GRANT ALL ON TABLE finance.plan_entitlements TO service_role;

GRANT SELECT ON TABLE finance.subscriptions TO authenticated;

GRANT ALL ON TABLE finance.subscriptions TO service_role;

GRANT SELECT ON TABLE finance.subscription_events TO authenticated;

GRANT ALL ON TABLE finance.subscription_events TO service_role;

GRANT SELECT ON TABLE finance.entitlement_grants TO authenticated;

GRANT ALL ON TABLE finance.entitlement_grants TO service_role;

GRANT SELECT ON TABLE finance.standing_commission_tiers TO authenticated;

GRANT ALL ON TABLE finance.standing_commission_tiers TO service_role;

GRANT SELECT ON TABLE finance.negotiated_rates TO authenticated;

GRANT ALL ON TABLE finance.negotiated_rates TO service_role;


-- --- from 20260724113000_entitlements_allowances_enforcement.sql ---

GRANT SELECT ON TABLE finance.allowance_periods TO authenticated;

GRANT ALL ON TABLE finance.allowance_periods TO service_role;

GRANT SELECT ON TABLE finance.allowance_ledger TO authenticated;

GRANT ALL ON TABLE finance.allowance_ledger TO service_role;


-- --- finance: basket, wishlist & saved cards ---
-- DELETE is granted here, unlike every sibling finance table, and the reason is that these three
-- hold PRE-transaction state. Root CLAUDE.md §5 ("nothing is hard-deleted, use Archived") governs
-- lifecycle entities and financial records; a basket line is neither — it is an intent that has
-- never moved money, and removing an item from a cart is genuinely a delete, not an archive. The
-- soft path still exists where it means something: `saved_for_later` keeps a line without buying it.
-- Nothing downstream of checkout is deletable: escrows, transactions and invoices keep their
-- append-only posture untouched.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE finance.baskets TO authenticated;

GRANT ALL ON TABLE finance.baskets TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE finance.basket_items TO authenticated;

GRANT ALL ON TABLE finance.basket_items TO service_role;

-- No INSERT: a card is saved by the processor's handshake. DELETE stays — removing a saved card is
-- the owner's call, and a saved card has never moved money.
GRANT SELECT, UPDATE, DELETE ON TABLE finance.saved_cards TO authenticated;

GRANT ALL ON TABLE finance.saved_cards TO service_role;


-- --- finance: the ledger and commerce tables (the move off fixtures, 2026-09-23) ---
-- The schema is exposed to PostgREST (00002500). Every client grant here is SELECT: money moves only
-- through SECURITY DEFINER functions, so no client role holds a write on the ledger, an order, an
-- invoice or a payout. `buyer_details` is the one exception, the buyer's own form. `promo_codes` and
-- `ratings` get no client grant at all (see 00002001) — only the service role and definer functions.

GRANT SELECT ON TABLE finance.wallets TO authenticated;

GRANT SELECT ON TABLE finance.transactions TO authenticated;

GRANT SELECT ON TABLE finance.payouts TO authenticated;

GRANT SELECT ON TABLE finance.payout_accounts TO authenticated;

GRANT SELECT ON TABLE finance.orders TO authenticated;

GRANT SELECT ON TABLE finance.order_lines TO authenticated;

GRANT SELECT ON TABLE finance.invoices TO authenticated;

GRANT SELECT ON TABLE finance.invoice_line_items TO authenticated;

GRANT SELECT ON TABLE finance.disputes TO authenticated;

GRANT SELECT ON TABLE finance.dispute_messages TO authenticated;

GRANT SELECT ON TABLE finance.contribution_agreements TO authenticated;

GRANT SELECT ON TABLE finance.payout_splits TO authenticated;

GRANT SELECT ON TABLE finance.spending_limits TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE finance.buyer_details TO authenticated;

GRANT ALL ON TABLE finance.wallets, finance.transactions, finance.payouts, finance.payout_accounts,
    finance.orders, finance.order_lines, finance.invoices, finance.invoice_line_items,
    finance.disputes, finance.dispute_messages, finance.contribution_agreements,
    finance.payout_splits, finance.spending_limits, finance.buyer_details, finance.promo_codes,
    finance.ratings
TO service_role;


-- --- files: asset management (anon reach for the public tier) ---
-- `anon` already holds USAGE on the `files` schema (00002500) but no table grant, so the anon
-- policy in 00002011 would have been unreachable. This is the schema's ONLY anon table grant and it
-- is SELECT-only; row-level exposure is still governed entirely by the policy, which admits nothing
-- but `visibility = 'public'` and not-soft-deleted.
GRANT SELECT ON TABLE files.items TO anon;

-- ⚠️ files.share_links deliberately gets NO anon or authenticated table grant. A share SLUG is a
-- credential, and RLS filters rows without being able to require that the caller already knew one —
-- so a visitor grant here would permit `SELECT slug FROM files.share_links`, i.e. harvesting every
-- live share credential on the platform. The one sanctioned visitor operation is the definer
-- resolver files.fn_resolve_share(slug), which takes the slug as INPUT (00001160 / 00002510). Same
-- structural discipline as integrations.connection_secrets. DO NOT add a grant here.

-- `authenticated` and `service_role` already hold their grants on every files table through the
-- schema-wide GRANT in 00002500 — deliberately not restated here. What keeps the audit and rollup
-- tables safe is not a narrower grant, it is that RLS is on and no INSERT/UPDATE policy exists for
-- them (00002011): the write path is the SECURITY DEFINER trigger and the fat backend, full stop.


-- --- catalogue: the seller publication layer (discovery reads it live, 2026-09-22) ---
--
-- SELECT to both client roles on every table; row-level visibility is 00002020's job ("published is
-- public, everything else is its owner's"). Writes go to `authenticated` only, and only the verbs the
-- policies grant a meaning to: INSERT/UPDATE on the three subject tables (no DELETE — a listing is
-- archived, never hard-deleted, root CLAUDE.md §5), and the full set on the child and junction
-- tables, where removing a tag or reordering a gallery IS a delete.
GRANT SELECT ON ALL TABLES IN SCHEMA catalogue TO anon, authenticated;

GRANT INSERT, UPDATE ON catalogue.listings, catalogue.products, catalogue.articles TO authenticated;

GRANT INSERT, UPDATE, DELETE ON catalogue.listing_media,
catalogue.listing_skills,
catalogue.listing_tags,
catalogue.listing_availability,
catalogue.collections,
catalogue.collection_listings TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA catalogue TO service_role;


-- --- projects: what a signed-out visitor may read about a PUBLIC project ---
--
-- Exactly the tables the public project page and the discovery card read, and SELECT only. Each is
-- already governed by a `TO public` policy scoped to `status = 'active' AND visibility = 'public'`
-- (00002011), except `project_required_skills`, whose public policy lands beside this grant. Nothing
-- about a project's tickets, money, members or messages is reachable from here.
GRANT SELECT ON projects.projects,
projects.project_stages,
projects.stage_staffing_roles,
projects.stage_open_seats,
projects.stage_open_seat_skills,
projects.project_required_skills TO anon;
