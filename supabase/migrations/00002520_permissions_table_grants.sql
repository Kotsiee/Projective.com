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

-- Read-only to the client: every write is a security.switch_* definer.
GRANT SELECT ON TABLE security.session_context TO authenticated;

GRANT ALL ON TABLE security.session_context TO service_role;

-- #region Penalties & platform params
GRANT SELECT ON TABLE security.penalties TO authenticated;

GRANT ALL ON TABLE security.penalties TO service_role;

GRANT SELECT ON TABLE security.platform_params TO authenticated;

GRANT ALL ON TABLE security.platform_params TO service_role;

-- #endregion

-- #region org: email addresses + verification tokens (00001050, 2026-10-06)
-- 00002500 grants ALL on every org table to both client roles. org.user_emails keeps SELECT (filtered
-- to the caller's own rows by its one policy, 00002010) and loses every write verb: its writers are
-- definers, because `verified_at` unlocks invitations. The token table is definer-only — no client
-- verb at all, so not even a policy mistake could expose a token hash.
REVOKE INSERT, UPDATE, DELETE ON TABLE org.user_emails FROM anon, authenticated;

REVOKE ALL ON TABLE org.email_verification_tokens FROM anon, authenticated;
-- #endregion

-- #region org: handle history + scheduled removals (00001060)
-- Read-own through their policies; written only by the 00001060 definers.
REVOKE INSERT, UPDATE, DELETE ON TABLE org.handle_changes FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE org.deletion_requests FROM anon, authenticated;

REVOKE ALL ON TABLE org.handle_changes, org.deletion_requests FROM anon;
-- #endregion

-- #region org: discovery history (00001400 search.record_view)
-- Read and clear your own through the two policies (00002010); written only by the definer, so the
-- client keeps SELECT + DELETE and a guest holds nothing at all.
REVOKE INSERT, UPDATE ON TABLE org.recent_views FROM anon, authenticated;

REVOKE ALL ON TABLE org.recent_views FROM anon;
-- #endregion

-- #region org: supported locales (00005050 reference data, Decision #207)
-- Readable by everyone through its policy (00002010); written only by the seed.
REVOKE INSERT, UPDATE, DELETE ON TABLE org.supported_locales FROM anon, authenticated;
-- #endregion

-- #region org: users_public private columns (IDENTITY_AND_WORKSPACES_AUDIT IW-C1)
-- Its SELECT policy (00002010) admits every signed-in reader to every row, and a policy is row-level,
-- so the table-level grant from 00002500 is taken back and re-issued per column WITHOUT dob · city ·
-- country · timezone. A PostgREST select of any of them — or of * — is refused; others see a person's
-- location and local time only through get_profile_view / profiles_index, which mask a minor's, and
-- the owner reads their own through org.get_own_private_profile (00001040). A guest reads no row
-- through the policy, so it keeps no column either.
REVOKE SELECT ON org.users_public FROM anon, authenticated;

GRANT SELECT (user_id, username, first_name, last_name, avatar_file_id, banner_file_id, headline,
    languages, visibility, bio, interests, rating_average, rating_count, active_project_count,
    total_project_count, service_count, product_count, created_at, updated_at, is_freelancer,
    has_business, has_team, is_operator)
    ON org.users_public TO authenticated;
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


-- --- ops.log_entries (production log + web-vitals ingestion) ---

GRANT INSERT ON ops.log_entries TO anon, authenticated;

GRANT SELECT ON ops.log_entries TO authenticated;

GRANT ALL ON ops.log_entries TO service_role;


-- --- ops.scheduled_jobs / ops.http_job_dispatches (the job registry, Decision #203) ---

GRANT SELECT ON ops.scheduled_jobs TO authenticated;

-- UPDATE is how a cadence changes or a job pauses; new jobs arrive with a migration.
GRANT SELECT, UPDATE ON ops.scheduled_jobs TO service_role;

GRANT SELECT ON ops.http_job_dispatches TO authenticated, service_role;


-- #region [contact] ops.contact_requests / ops.contact_request_attachments (Decision #276)
-- SELECT only, and only operators pass the policy (00002019). No client role holds INSERT, UPDATE or
-- DELETE: requests arrive through ops.submit_contact_request and move through
-- ops.set_contact_request_status, both definers; nothing is ever deleted.
GRANT SELECT ON ops.contact_requests TO authenticated, service_role;

GRANT SELECT ON ops.contact_request_attachments TO authenticated, service_role;
-- #endregion


-- --- from 0219_search_engine_weights.sql ---

GRANT SELECT ON search.search_weights TO authenticated;

GRANT ALL ON search.search_weights TO service_role;


-- #region search: embedding columns (Decision #179)
-- The index rows are public reads; their vectors are not. 00002500 granted SELECT on every search
-- table, so the table-level grant is taken back and re-issued per column without embedding ·
-- embedding_model · embedding_hash · embedded_at (query_embedding on query_logs). A PostgREST select
-- of any of them — or of * — is then refused for anon and authenticated; vectors leave the database
-- only as ids + scores (search.fn_nearest). service_role keeps ALL for the backfill.
REVOKE SELECT ON search.profiles_index, search.projects_index, search.services_index,
    search.catalogue_index, search.query_logs FROM anon, authenticated;

GRANT SELECT (entity_id, entity_type, display_name, headline, fts, metadata, rating_average,
    rating_count, current_workload_intensity, available_since, discovery_penalty, is_active, updated_at)
    ON search.profiles_index TO anon, authenticated;

GRANT SELECT (project_id, title, fts, industry_category_id, status, target_start_date, is_active,
    updated_at)
    ON search.projects_index TO anon, authenticated;

GRANT SELECT (service_id, title, tags, fts, is_public, rating_average, rating_count, updated_at)
    ON search.services_index TO anon, authenticated;

GRANT SELECT (entity_type, entity_id, title, tags, fts, is_public, updated_at)
    ON search.catalogue_index TO anon, authenticated;

GRANT SELECT (id, user_id, search_query, filters_applied, created_at, entity_type, duration_ms,
    result_count, matched_density)
    ON search.query_logs TO anon, authenticated;
-- #endregion


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

-- Read only: a rule is written through finance.create_deposit_rule and the scheduler (00002013).
GRANT SELECT ON TABLE finance.deposit_rules TO authenticated;

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

-- Read-only to the client: filing is finance.request_spend_approval, deciding decide_spend_approval.
GRANT SELECT ON TABLE finance.spend_approvals TO authenticated;

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
-- #endregion

-- #region 2. Column-scoped UPDATE and INSERT — what a row policy cannot say
-- 00002500 grants `ALL ON ALL TABLES IN SCHEMA comms` to `authenticated`. An UPDATE policy answers
-- WHOSE row may change, never WHICH columns, so on the two comms tables carrying an own-row UPDATE
-- policy over server-authored content the blanket grant made that content writable:
--
--  · comms.notifications ("Users update own notification state", 00002012) — a recipient could
--    rewrite their own title, body, action_url, category or payload, i.e. forge a platform message
--    (a fake "Payout failed — re-enter your bank details at <url>") inside the trusted inbox. The
--    recipient's genuine state is three timestamps; everything else is written by comms.fn_notify
--    (SECURITY DEFINER), which runs as its owner and is unaffected. The inbox RPCs in 00001310 §8 are
--    SECURITY INVOKER and touch only these three columns.
--  · comms.project_messages ("edit_own_messages", 00002012) — a sender could clear pii_masked /
--    pii_categories (unmasking during the protected phase), backdate created_at, flip
--    has_attachments / is_audio, or re-home the message to another channel they belong to. Editing is
--    body + Delta + the two soft-state stamps.
--
-- Audited and left as they are: notification_prefs, notification_category_prefs,
-- notification_type_mutes, auto_responses and device_tokens are the caller's own settings with no
-- server-authored column a rewrite could forge (device_tokens.failure_count is also reset by
-- comms.register_device, so writing it grants nothing new). Every other comms table has no UPDATE
-- policy, which RLS reads as deny.
--
-- Order matters: revoking the table-level privilege also drops column-level ones, so REVOKE first.
REVOKE UPDATE ON TABLE comms.notifications FROM authenticated;

GRANT UPDATE (read_at, seen_at, archived_at) ON TABLE comms.notifications TO authenticated;

REVOKE UPDATE ON TABLE comms.project_messages FROM authenticated;

GRANT UPDATE (body, body_delta, edited_at, deleted_at) ON TABLE comms.project_messages TO authenticated;

-- INSERT is column-scoped on both message tables for the same reason (SEC L5). An INSERT policy
-- answers whether the sender may post into this room, never which columns a post may set, so the
-- blanket grant let a client insert `created_at` (backdating dispute evidence), `edited_at`,
-- `deleted_at`, or `pii_masked` / `pii_categories` (the mask triggers own those). A post names its
-- room, its author (the policies pin it to the caller), its words, its reply and its two media flags;
-- a DM may also name the project or service it is about, which comms.fn_dm_protected_project can only
-- turn into MORE masking. Everything else is a default or a trigger's. The definer doors
-- (send_request_message, the auto-reply) run as their owner and are unaffected.
REVOKE INSERT ON TABLE comms.project_messages FROM authenticated;

GRANT INSERT (channel_id, sender_user_id, body, body_delta, reply_to_id, has_attachments, is_audio)
    ON TABLE comms.project_messages TO authenticated;

REVOKE INSERT ON TABLE comms.dm_messages FROM authenticated;

GRANT INSERT (thread_id, sender_user_id, project_id, service_id, body, body_delta, reply_to_id, has_attachments, is_audio)
    ON TABLE comms.dm_messages TO authenticated;
-- #endregion

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

-- Availability presets (Decision #217). Column-level on the preset: a client names, describes and
-- defaults a preset, but never stamps its compiled window (replace_preset_occurrences does) nor
-- archives it outside archive_availability_preset (which unbinds the services first). No DELETE —
-- presets are archived. Rules and bands are replaced wholesale by save_availability_preset (an
-- invoker), hence DELETE on those. Occurrences are read-only to the client.
GRANT SELECT ON TABLE scheduling.availability_presets TO authenticated;

GRANT INSERT (schedule_id, scope, blueprint_id, name, description, is_default)
ON TABLE scheduling.availability_presets TO authenticated;

GRANT UPDATE (name, description, is_default) ON TABLE scheduling.availability_presets TO authenticated;

GRANT
SELECT,
INSERT,
UPDATE,
DELETE ON TABLE scheduling.recurrence_rules TO authenticated;

GRANT
SELECT,
INSERT,
UPDATE,
DELETE ON TABLE scheduling.recurrence_rule_bands TO authenticated;

GRANT SELECT ON TABLE scheduling.availability_occurrences TO authenticated;

GRANT ALL ON TABLE scheduling.availability_presets TO service_role;

GRANT ALL ON TABLE scheduling.recurrence_rules TO service_role;

GRANT ALL ON TABLE scheduling.recurrence_rule_bands TO service_role;

GRANT ALL ON TABLE scheduling.availability_occurrences TO service_role;


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

-- Column-level: the meeting ROOM (meeting_url, meeting_passcode, meeting_details) is withheld from
-- every client role. RLS is row-level, and the rows a member may see (a project's meetings) are not
-- the rows whose room they may hold; a party reads the room through scheduling.get_event_rooms. anon
-- reads no event row at all (no policy): a visitor's free/busy is scheduling.get_free_busy.
GRANT SELECT (
    id, schedule_id, project_id, channel_id, kind, status, title, starts_at, ends_at, all_day,
    is_masked, accent, location, meeting_provider, meeting_provider_label, meeting_pending, meta,
    attendee_count, capacity, href, source_connection_id, external_event_id, source_session_event_id,
    created_by, created_at, updated_at
) ON TABLE scheduling.events TO authenticated;

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

-- Read-only to the client: a call is requested by scheduling.request_discovery_call; there is no
-- client INSERT or UPDATE policy (00002015).
GRANT SELECT ON TABLE scheduling.discovery_calls TO authenticated;

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

GRANT SELECT ON TABLE finance.dispute_evidence TO authenticated;

GRANT SELECT ON TABLE finance.contribution_agreements TO authenticated;

GRANT SELECT ON TABLE finance.payout_splits TO authenticated;

GRANT SELECT ON TABLE finance.spending_limits TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE finance.buyer_details TO authenticated;

GRANT ALL ON TABLE finance.wallets, finance.payouts, finance.payout_accounts,
    finance.orders, finance.order_lines, finance.invoices, finance.invoice_line_items,
    finance.disputes, finance.dispute_messages, finance.dispute_evidence, finance.contribution_agreements,
    finance.payout_splits, finance.spending_limits, finance.buyer_details, finance.promo_codes,
    finance.ratings
TO service_role;

-- The ledger is append-only (Decision #186): the service role reads and appends, never rewrites. The
-- trigger in 00001830 is the guarantee; this keeps the grant from claiming otherwise.
GRANT SELECT, INSERT ON TABLE finance.transactions TO service_role;

-- The inbound card-payment log (Stripe Phase 1, Decision #125): SELECT only, filtered by its policy
-- in 00002013. Started, bound, settled and failed exclusively through the 00001230 definers.
GRANT SELECT ON TABLE finance.inbound_payments TO authenticated;

GRANT ALL ON TABLE finance.inbound_payments TO service_role;

-- Processor customers (Decision #126): definer-only, so no client grant at all.
REVOKE ALL ON TABLE finance.processor_customers FROM anon, authenticated;
GRANT ALL ON TABLE finance.processor_customers TO service_role;


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
catalogue.collections,
catalogue.collection_listings TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA catalogue TO service_role;


-- --- editorial + community (Decision #274) ---
--
-- No schema-wide grant to a client role, on purpose: a table in either schema is reachable by
-- `anon` / `authenticated` only once its surface's region below names it, with the narrowest verbs it
-- needs — SELECT on an editorial table (its rows are written by the generated seed migrations and
-- the service role, never a client); for community, SELECT where the surface reads directly and
-- nothing at all where a definer door writes. Never `GRANT ALL` to a client role here: ALL carries
-- TRUNCATE, which RLS does not bound (Decision #83). The service role holds every table of both
-- schemas, including the ones a region adds later, because this runs after every table exists.
GRANT ALL ON ALL TABLES IN SCHEMA editorial, community TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA editorial, community TO service_role;

-- #region [editorial.help]
-- Read-only for both client roles; the help_articles_select_published policy decides which rows.
GRANT SELECT ON editorial.help_categories, editorial.help_articles TO anon, authenticated;
-- #endregion


-- #region [editorial.changelog]
-- Read-only for the client roles; the SELECT policy (00002021) decides which releases they see.
GRANT SELECT ON editorial.changelog_releases TO anon, authenticated;
-- #endregion


-- #region [editorial.articles]
GRANT SELECT ON editorial.article_authors, editorial.articles TO anon, authenticated;
-- #endregion


-- #region [community.newsletter]
-- ⚠️ community.newsletter_subscriptions gets NO anon or authenticated grant, and must never get one:
-- every row is an address paired with its unsubscribe token (00002021). The service role's grant
-- above is the only privilege on it; community.subscribe_newsletter is its one writer.
-- #endregion


-- #region [community.help_feedback]
-- community.help_feedback gets NO anon or authenticated grant: votes are written only through
-- community.submit_help_feedback (00002510) and read only by the service role.
-- #endregion


-- #region [community.feedback]
-- Reads only, column by column; no client role holds INSERT, UPDATE or DELETE on any board table —
-- every write is a definer door. Withheld from clients: an idea's `pii_categories` (screening
-- evidence) and `team_response_by`, and a history row's `actor_id` and `note` (operator-side).
GRANT SELECT (
    id, slug, title, impact, body, category, status, author_id, vote_count, team_response,
    team_response_at, created_at, updated_at, status_changed_at, archived_at
) ON community.feedback_ideas TO anon, authenticated;
GRANT SELECT (idea_id, user_id, created_at) ON community.feedback_votes TO authenticated;
GRANT SELECT (id, idea_id, from_status, to_status, created_at)
    ON community.feedback_status_events TO anon, authenticated;
-- #endregion


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


-- --- projects: sessions & cohorts (00001155, Decision #171) ---
--
-- Evidence and money-adjacent state is definer-written only: a seat hold is placed by
-- projects.reserve_seat (under a row lock) and converted by fn_confirm_seat, attendance by
-- record_presence / record_host_attendance, progress by complete_lesson. Cohorts, seats and sittings
-- are written by fn_book_session_slot, fn_confirm_seat, cancel_cohort_membership and the payout sweep:
-- the sweep releases a held escrow on a sitting's `status` and `end_time`, so an owner able to write a
-- sitting could mark a future one completed and be paid for it, and one able to write a seat could
-- strand the buyer's escrow. 00002500's blanket grant is narrowed back to SELECT for the client roles.
REVOKE INSERT, UPDATE, DELETE ON projects.cohort_seat_holds,
projects.session_attendance,
projects.lesson_progress,
projects.cohorts,
projects.cohort_memberships,
projects.session_events FROM anon, authenticated;

-- The two join URLs are handed out only by projects.session_join_link — to the right party, once the
-- seat is funded and the join window is open — so no client role may SELECT them; every other column
-- of a sitting stays readable under its policy.
REVOKE SELECT ON projects.session_events FROM anon, authenticated;

GRANT SELECT (
    id,
    cohort_id,
    title,
    slug,
    start_time,
    end_time,
    meeting_provider,
    provider_meeting_id,
    status,
    created_at,
    updated_at
) ON projects.session_events TO authenticated;
