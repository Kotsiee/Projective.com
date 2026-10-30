-- =============================================================================
-- FUNCTION EXECUTE GRANTS / REVOKES
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================

-- #region org — deny by default (2026-09-28)
-- Postgres grants EXECUTE on every new function to PUBLIC, and `org` is exposed to PostgREST — so
-- every org function, predicate and internal helper was an RPC anybody could call, `anon` included.
-- Two of them were holes on their own: org.create_team trusted a caller-supplied owner and ran for a
-- signed-out caller, and org.get_dashboard_teams answered for any user id it was handed. EXECUTE is now
-- revoked from every client role on the whole schema, here at the top of the file, and every function
-- that SHOULD be reachable is granted back by name further down (or in the region at the end). A new
-- org function is therefore unreachable until somebody decides it should be — the safe default.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA org FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA org
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA org TO service_role;

-- The membership predicates ARE the SELECT policies of the org, projects, comms and files tables, and
-- a policy expression runs as the invoking role — so they stay executable by both client roles.
GRANT EXECUTE ON FUNCTION org.is_active_team_member (uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION org.is_active_business_member (uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION org.is_enterprise_member (uuid, org.enterprise_role) TO anon, authenticated;

-- org.profiles_index masks a minor's location with these, and a view's function calls run as the
-- reader. They compute only on their arguments and read no table, so granting them exposes nothing;
-- org.fn_is_minor, which reads a stored date of birth, stays service-role only.
GRANT EXECUTE ON FUNCTION org.fn_valid_time_zone (text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION org.fn_today_in (text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION org.fn_age_years (date, text) TO anon, authenticated;
-- #endregion

-- #region projects — deny by default
-- `projects` is exposed to PostgREST and `anon` holds USAGE on it (00002500), so the PUBLIC EXECUTE
-- every new function receives made each definer here an RPC a signed-out caller could reach. EXECUTE
-- is revoked from PUBLIC and `anon` on the whole schema before any per-function statement below, so
-- the grants in this file (and the `authenticated` grants beside their functions in 00001130) are the
-- complete list of client doors. A new projects function is unreachable until it is granted by name.
-- PUBLIC's EXECUTE comes from the global default privileges, which no per-schema ALTER DEFAULT
-- PRIVILEGES can revoke; this schema-wide REVOKE runs after every function exists, on every reset.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA projects FROM PUBLIC, anon;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA projects TO service_role;

-- The RLS predicates: policies on the projects tables, storage.objects and scheduling.events call
-- them, and a policy expression runs as the invoking role. Each answers only about auth.uid().
GRANT EXECUTE ON FUNCTION projects.has_project_access (uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION projects.has_stage_access (uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION projects.can_review_project (uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION projects.can_manage_project_members (uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION projects.is_ticket_manager (uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION projects.is_cohort_member (uuid) TO anon, authenticated;

-- Who may move a claimed ticket (Decision #293). trg_ticket_immutability_guard is INVOKER and calls
-- it for a statement PostgREST runs as `authenticated`, so that role must be able to execute it. It
-- writes nothing and answers only about auth.uid(); called directly it raises or returns, no more.
GRANT EXECUTE ON FUNCTION projects.fn_assert_ticket_move (uuid, uuid, public.ticket_status, public.ticket_status, uuid, uuid) TO authenticated;

-- The business-authority predicates (BB2): each answers only about auth.uid(), so a signed-in caller
-- may ask them of a project (the app reads them to decide which commit to offer). Not `anon`: a
-- signed-out caller holds no capability. The asserting twin is internal to the doors that call it.
GRANT EXECUTE ON FUNCTION projects.fn_business_actor_can (uuid, org.workspace_capability) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.fn_can_fund_project (uuid) TO authenticated;
REVOKE ALL ON FUNCTION projects.fn_assert_business_actor (uuid, org.workspace_capability, boolean)
FROM PUBLIC, anon, authenticated;

-- The doors the app calls with the user's JWT that are not granted elsewhere. Each resolves the caller
-- from auth.uid() and checks its own authority (review, staffing or project access).
GRANT EXECUTE ON FUNCTION projects.create_stage (uuid, text, jsonb, text, bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.delete_stage (uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.reorder_stages (uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.set_project_status (uuid, public.project_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.sanitize_single_room_topology (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.move_ticket (uuid, public.ticket_status, uuid, integer, timestamptz) TO authenticated;
-- The transactional write batch (DL S7) is SECURITY INVOKER: every statement it runs meets the
-- caller's own RLS and grants, and every RPC it calls is one of the doors above. Its reference
-- resolver is pure and is called by it as the caller, so the caller needs it too.
GRANT EXECUTE ON FUNCTION projects.apply_write_batch (jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.fn_batch_resolve (jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.submit_deliverable (uuid, uuid, text, jsonb, jsonb, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.send_submission_draft (uuid, jsonb, uuid[]) TO authenticated;
-- The review door's steps: called directly they would link any file or flip any ticket into Review.
REVOKE ALL ON FUNCTION projects.fn_assert_can_submit (uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_link_submission_files (uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_enter_review (uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.review_submission (uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.assign_from_application (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.fund_stage (uuid, uuid) TO authenticated;
-- The team apply gate is a step of apply_to_seat / apply_to_project, never a door of its own.
REVOKE ALL ON FUNCTION projects.fn_assert_team_can_apply (uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The two assignment doors: a self-claim (00001120) and the reviewer's pin (00001140). The claim core
-- they share, projects.fn_assign_ticket_core, takes any assignee and checks nothing, so it is not granted.
GRANT EXECUTE ON FUNCTION projects.claim_ticket (uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION projects.assign_ticket_manual (uuid, uuid) TO authenticated;
-- #endregion

-- #region public — deny by default
-- PostgREST always exposes `public`, and Supabase's default privileges grant EXECUTE on every function
-- postgres creates there to `anon` and `authenticated` on top of PUBLIC, so the provisioning definer
-- public.provision_user_profile (a profile for any uid it is handed) was callable signed-out. Every
-- app-owned function here is revoked from all three; the extension members (pgvector, pg_trgm) are
-- owned by supabase_admin and skipped so their operators and the search doors keep working.
DO $$
DECLARE
    v_fn regprocedure;
BEGIN
    FOR v_fn IN
        SELECT p.oid::regprocedure
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
            AND NOT EXISTS (
                SELECT 1 FROM pg_depend d
                WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
            )
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END LOOP;
END $$;

-- Removes Supabase's explicit client-role default for future postgres-owned functions here; PUBLIC's
-- comes from the global default and is closed by the loop above on every reset.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- Stated per function too, so a later broad grant cannot hand them out. provision_user_profile runs
-- only inside its two definer callers (handle_new_user, complete_onboarding), as their owner; the two
-- auth.users trigger functions are checked once, at CREATE TRIGGER.
REVOKE ALL ON FUNCTION public.provision_user_profile (uuid, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user () FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_email_confirmed () FROM PUBLIC, anon, authenticated;
-- #endregion

-- #region editorial + community — deny by default (Decision #274)
-- Both schemas are exposed to PostgREST with USAGE for `anon` (00002500), so the PUBLIC EXECUTE every
-- new function receives would make each one an RPC a signed-out caller could reach. EXECUTE is
-- revoked from PUBLIC and both client roles on the whole of both schemas here, after every function
-- exists, so the per-surface regions below are the complete list of client doors: a new editorial
-- or community function is unreachable until its surface grants it by name. A predicate an RLS
-- policy calls runs as the invoking role and must be granted back to the roles that policy names.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA editorial, community FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA editorial, community TO service_role;
-- #endregion

-- #region comms — deny by default (SECURITY_MODERATION_AND_AI_GAPS E3)
-- `comms` is exposed to PostgREST and every new function is EXECUTE-able by PUBLIC, so each definer
-- here was an RPC any signed-in user could reach: comms.fn_notify wrote a forged "payout failed"
-- notice, with any link, into anybody's inbox, and the queue / digest / escalation runners could be
-- forced. EXECUTE is revoked from PUBLIC and both client roles on the whole schema here, before the
-- per-function grants further down, so those grants and this region are the complete list of client
-- doors. A trigger function needs no EXECUTE to fire, and the service role keeps everything.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA comms FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA comms TO service_role;

-- The DM read predicates (policies run as the invoking role) and the DM doors the messaging service
-- calls under the user's JWT; each answers only for auth.uid().
GRANT EXECUTE ON FUNCTION comms.is_dm_participant (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION comms.can_read_message (text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION comms.get_or_create_dm_thread (uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION comms.dm_thread_roster (uuid[]) TO authenticated;
-- community.fn_feedback_idea_screen (INVOKER) masks a feedback idea through it; it reads no table.
GRANT EXECUTE ON FUNCTION comms.mask_pii (text) TO authenticated;
-- #endregion


-- #region [editorial.help]
-- #endregion


-- #region [editorial.changelog]
-- Nothing to grant back: editorial.fn_guard_release_version_immutable() is a trigger function, which
-- needs no EXECUTE for the writer that fires it, and the changelog is read straight from its table.
-- #endregion


-- #region [editorial.articles]
-- #endregion


-- #region [community.newsletter]
-- The opt-in's one writer. Service role only: the public form reaches it through
-- /api/newsletter/subscribe → NewsletterBackendService, never as a browser RPC (00002021).
REVOKE ALL ON FUNCTION community.subscribe_newsletter (text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION community.subscribe_newsletter (text, text, text) TO service_role;
-- #endregion


-- #region [community.help_feedback]
-- The vote's one writer, open to guests and members alike: it stamps the voter from auth.uid() itself
-- and rate-limits, so reaching it as a browser RPC grants nothing the help route does not.
REVOKE ALL ON FUNCTION community.submit_help_feedback (text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community.submit_help_feedback (text, boolean, text) TO anon, authenticated, service_role;
-- #endregion


-- #region [community.feedback]
-- The board's doors (00001320): each stamps auth.uid() itself, so a guest is refused by the grant and
-- a signed-in caller by the body. The trigger functions and internal helpers stay revoked (above).
REVOKE ALL ON FUNCTION community.submit_feedback_idea (text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION community.submit_feedback_idea (text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION community.vote_feedback_idea (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION community.vote_feedback_idea (text) TO authenticated;
REVOKE ALL ON FUNCTION community.unvote_feedback_idea (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION community.unvote_feedback_idea (text) TO authenticated;
REVOKE ALL ON FUNCTION community.set_feedback_idea_status (text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION community.set_feedback_idea_status (text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION community.respond_to_feedback_idea (text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION community.respond_to_feedback_idea (text, text) TO authenticated;
REVOKE ALL ON FUNCTION community.moderate_feedback_idea (text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION community.moderate_feedback_idea (text, text, text, text) TO authenticated;
-- The tab counts are an INVOKER read under the caller's own policies, so guests may run it too.
REVOKE ALL ON FUNCTION community.feedback_status_counts () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community.feedback_status_counts () TO anon, authenticated;
-- #endregion

-- --- from 0200_permissions.sql ---

GRANT
EXECUTE ON ALL FUNCTIONS IN SCHEMA search TO anon,
authenticated,
service_role;

-- A team's live W_i is maintained by triggers (Decision #235), never called by a client: the refresh
-- writes the index as its definer, and the sum reads tickets and memberships.
REVOKE ALL ON FUNCTION search.fn_refresh_team_workload (uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION search.fn_team_live_workload (uuid) FROM PUBLIC, anon, authenticated;

-- --- from 0219_search_engine_weights.sql ---

GRANT
EXECUTE ON FUNCTION search.is_admin (uuid) TO authenticated,
service_role;

-- --- from 0220_search_engine_rpc.sql ---

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT
EXECUTE ON FUNCTION search.fn_norm (
    double precision,
    double precision
) TO anon,
authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION search.fn_log_query (
    text,
    text,
    jsonb,
    integer,
    integer,
    integer,
    uuid,
    public.vector
) TO anon,
authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION search.fn_search_analytics (integer) TO authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION search.fn_get_weights () TO authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION search.fn_set_weight (text, numeric) TO authenticated,
service_role;

-- #region search: discovery signals (00001400)
-- Coefficients and k-anonymous aggregates: the guest catalogue reads both as `anon`.
GRANT EXECUTE ON FUNCTION search.ranking_weights () TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION search.trending_entities (integer, integer) TO anon, authenticated, service_role;

-- A viewing history belongs to a signed-in person. The schema-wide grant above reached `anon` and
-- PUBLIC too; the definer also refuses a NULL auth.uid(), but no guest should reach it at all.
REVOKE EXECUTE ON FUNCTION search.record_view (text, uuid, text[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION search.record_view (text, uuid, text[]) TO authenticated, service_role;
-- #endregion

-- #region search: embeddings (00001400, Decision #179)
-- Read doors over public index rows: ids and scores only, never a vector. The discovery service
-- calls them as `anon`, like the rest of the shared catalogue.
GRANT EXECUTE ON FUNCTION search.fn_nearest (public.vector, text[], uuid[], integer) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION search.fn_nearest_to_entity (text, uuid, text[], uuid[], integer) TO anon, authenticated, service_role;

-- The only writer of the embedding columns: the backfill script and the post-commit re-embed, both
-- with the service-role key. The schema-wide grant above reached PUBLIC, anon and authenticated.
REVOKE EXECUTE ON FUNCTION search.fn_set_embedding (text, uuid, public.vector, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION search.fn_set_embedding (text, uuid, public.vector, text, text) TO service_role;
-- #endregion

-- --- from 0304_onboarding_session_and_audit.sql ---

GRANT
EXECUTE ON FUNCTION public.complete_onboarding (jsonb) TO authenticated;

-- The caller's own profile-less identity, under 13 only (Decision #208).
REVOKE ALL ON FUNCTION public.discard_underage_signup (date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_underage_signup (date, text) TO authenticated, service_role;

-- --- from 0309_business_finance_overview.sql ---

-- #endregion

-- (The business finance / members / admin-profile / update RPCs of 0309 were retired 2026-09-28 in
-- favour of org.get_workspace_detail and org.update_workspace — see the workspace region at the end.)

-- --- from 0311_e7_private_channels_pii_handover.sql ---

GRANT
EXECUTE ON FUNCTION comms.can_access_scope (uuid, uuid, text) TO authenticated;

GRANT
EXECUTE ON FUNCTION comms.has_channel_access (uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION comms.get_stage_channels (uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION projects.is_protected_phase (uuid) TO authenticated;

-- --- from 0313_freelancer_conversion.sql ---

-- Stated per function, not left to the schema-wide revoke at the top of this file, so a later
-- `GRANT … ON ALL FUNCTIONS IN SCHEMA org` cannot silently hand a definer write to `anon`.
REVOKE EXECUTE ON FUNCTION org.enable_freelancer_profile (jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION org.enable_freelancer_profile (jsonb) TO authenticated;

-- The acting entity's name (00001020 §5b): answers only for an entity the caller holds a seat in.
REVOKE EXECUTE ON FUNCTION org.get_acting_context_details (text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION org.get_acting_context_details (text, uuid) TO authenticated;

-- The one write door on org.enterprises (00001020 §5c); the client UPDATE policy is gone.
REVOKE EXECUTE ON FUNCTION org.update_enterprise (uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION org.update_enterprise (uuid, jsonb) TO authenticated;

-- --- from 0315_create_enterprise_rpc.sql ---

-- Only the service-role backend provisions enterprises (after admin-creating the owner identity).
-- It trusts the `p_owner` it is handed, and Postgres grants a new `public` function to PUBLIC — so
-- until 2026-10-06 any signed-out caller could mint an enterprise owned by anybody. Revoked.
REVOKE EXECUTE ON FUNCTION public.create_enterprise (uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT
EXECUTE ON FUNCTION public.create_enterprise (uuid, jsonb) TO service_role;

-- --- from 20260709120000_business_teams_overhaul.sql ---

GRANT
EXECUTE ON FUNCTION org.set_operator_mode (boolean) TO authenticated;

-- --- from 20260715120000_access_token_context_hook.sql ---

GRANT
EXECUTE ON FUNCTION security.switch_enterprise_context (uuid) TO authenticated;

-- Only the GoTrue admin role may run the hook; no client role may.
GRANT
EXECUTE ON FUNCTION public.custom_access_token_hook (jsonb) TO supabase_auth_admin;

REVOKE
EXECUTE ON FUNCTION public.custom_access_token_hook (jsonb)
FROM authenticated, anon, public;

-- --- from 20260723091000_finance_verification_kyc.sql ---

-- Service role only. Both take ANY subject id, and once `finance` is exposed to PostgREST (00002500)
-- a client grant would let any signed-in account ask whether any other person has cleared KYC or any
-- business KYB. Nothing in the database calls them as a client: every caller is SECURITY DEFINER.
GRANT
EXECUTE ON FUNCTION finance.fn_freelancer_payout_ready (uuid) TO service_role;

GRANT
EXECUTE ON FUNCTION finance.fn_business_kyb_verified (uuid) TO service_role;

-- The earning gate's parts (Decision #196) answer about ANY person, team or wallet; they run only
-- inside the guarded doors, so no client role may call them.
REVOKE ALL ON FUNCTION finance.fn_team_shareholders (uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_assert_payout_ready (text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_wallet_holds_earnings (uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION projects.fn_ticket_assignee_payout_ready (uuid, uuid) FROM PUBLIC, anon, authenticated;

-- --- from 20260723092000_finance_payment_methods_money_movement.sql ---

GRANT
EXECUTE ON FUNCTION finance.fn_owner_visible (text, uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION finance.fn_can_view_wallet (uuid) TO authenticated;

-- Asked by the spending_limits / spend_approvals SELECT policies; it answers for the caller only.
GRANT
EXECUTE ON FUNCTION finance.fn_reads_wallet_envelopes (uuid) TO authenticated;

-- --- from 20260723093000_finance_vault_governance.sql ---

-- finance.fn_has_vault_capability is NOT granted to any client role (2026-09-28): it answers for an
-- arbitrary user id, so exposing it was a capability oracle, and no policy calls it — its callers are
-- the definer predicates and money RPCs, which run it as its owner.

-- --- from 20260724094000_comms_notification_rls_jobs.sql ---

-- #endregion

-- #region 7. Function grants
GRANT EXECUTE ON FUNCTION comms.mark_notifications_read(uuid[]) TO authenticated;

GRANT
EXECUTE ON FUNCTION comms.mark_all_notifications_read (comms.notification_category) TO authenticated;

GRANT
EXECUTE ON FUNCTION comms.mark_notifications_seen () TO authenticated;

GRANT EXECUTE ON FUNCTION comms.archive_notifications(uuid[]) TO authenticated;

GRANT
EXECUTE ON FUNCTION comms.get_notification_summary () TO authenticated;

GRANT
EXECUTE ON FUNCTION comms.register_device (
    text,
    comms.device_platform,
    text,
    text,
    text,
    text,
    text,
    text
) TO authenticated;

GRANT
EXECUTE ON FUNCTION comms.revoke_device (uuid, text) TO authenticated;

GRANT
EXECUTE ON FUNCTION comms.fn_resolve_type_key (text) TO authenticated;

-- The writer, the router and the schedulers are NOT granted to `authenticated`. A client that could
-- call fn_notify could spoof any notification to any user; a client that could call fn_process_queue
-- could force-send every pending reminder.
GRANT
EXECUTE ON FUNCTION comms.fn_notify (
    uuid,
    text,
    text,
    text,
    text,
    uuid,
    jsonb,
    uuid,
    text,
    uuid,
    text,
    text,
    comms.notification_urgency,
    timestamptz
) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_notify_many(uuid[], text, text, text, text, uuid, jsonb, uuid, text, uuid, text) TO service_role;

GRANT
EXECUTE ON FUNCTION comms.fn_enqueue (
    uuid,
    text,
    text,
    text,
    timestamptz,
    text,
    text,
    uuid,
    jsonb,
    text,
    uuid,
    uuid,
    text,
    text
) TO service_role;

GRANT
EXECUTE ON FUNCTION comms.fn_cancel_queued (text, text, uuid) TO service_role;

GRANT
EXECUTE ON FUNCTION comms.fn_process_queue (integer) TO service_role;

GRANT
EXECUTE ON FUNCTION comms.fn_is_quiet_hours (uuid, timestamptz) TO service_role;

GRANT
EXECUTE ON FUNCTION comms.fn_resolve_channels (uuid, text) TO service_role;

GRANT
EXECUTE ON FUNCTION comms.fn_is_suppressed (
    comms.notification_channel,
    text,
    comms.notification_category
) TO service_role;

GRANT
EXECUTE ON FUNCTION comms.fn_escalate_unread (integer) TO service_role;

GRANT
EXECUTE ON FUNCTION comms.fn_build_digests (comms.digest_frequency) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_sweep_expired () TO service_role;

GRANT
EXECUTE ON FUNCTION comms.fn_reap_dead_devices (smallint) TO service_role;

GRANT
EXECUTE ON FUNCTION comms.fn_compact_delivery_events (interval) TO service_role;

-- --- from 20260724100000_scheduling_schema_availability.sql ---

GRANT
EXECUTE ON FUNCTION scheduling.fn_owner_visible (scheduling.owner_type, uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_owner_manages (scheduling.owner_type, uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_can_view_schedule (uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_can_manage_schedule (uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_schedule_is_public (uuid) TO anon,
authenticated;

-- --- integrations: connector + plugin predicates ---

GRANT
EXECUTE ON FUNCTION integrations.fn_has_capability (
    uuid,
    integrations.provider_kind
) TO authenticated;

GRANT
EXECUTE ON FUNCTION integrations.fn_conferencing_provider (uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION integrations.fn_plugin_installed (uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION integrations.fn_plugin_has_scope (uuid, text) TO authenticated;

GRANT
EXECUTE ON FUNCTION integrations.fn_is_plugin_publisher (uuid) TO authenticated;

-- --- from 20260724102000_scheduling_events.sql ---

GRANT
EXECUTE ON FUNCTION scheduling.fn_has_conflicting_event (
    uuid,
    timestamptz,
    timestamptz
) TO anon,
authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_is_blacked_out (
    uuid,
    timestamptz,
    timestamptz
) TO anon,
authenticated;

-- --- from 20260724103000_scheduling_discovery_calls.sql ---

GRANT
EXECUTE ON FUNCTION scheduling.fn_is_call_party (uuid) TO authenticated;

-- The coordination policies' predicate: a policy expression runs as the invoking role, so
-- `authenticated` must hold it. Not granted to anon — coordination has no anonymous reader.
REVOKE ALL ON FUNCTION scheduling.fn_can_see_event_coordination (uuid)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION scheduling.fn_can_see_event_coordination (uuid) TO authenticated,
service_role;

-- The history probes behind projects.sanitize_single_room_topology are SECURITY DEFINER and answer
-- for any id, so a direct caller could learn what lies behind a stage or room it cannot read. Only
-- the sanitizer (which re-asks review authority) calls them, as their owner.
REVOKE ALL ON FUNCTION projects.fn_room_has_history (uuid) FROM public, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_stage_has_history (uuid) FROM public, anon, authenticated, service_role;

-- --- from 20260724104000_scheduling_booking_engine.sql ---

GRANT
EXECUTE ON FUNCTION scheduling.fn_local_minute_of_day (timestamptz, text) TO anon,
authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_local_weekday (timestamptz, text) TO anon,
authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_band_covers (
    uuid,
    scheduling.availability_kind,
    timestamptz,
    timestamptz,
    uuid
) TO anon,
authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_call_window_covers (
    uuid,
    timestamptz,
    timestamptz
) TO anon,
authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_slot_is_free (
    uuid,
    timestamptz,
    timestamptz
) TO anon,
authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_call_request_refusal (
    uuid,
    uuid,
    scheduling.call_type,
    timestamptz,
    timestamptz
) TO authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_can_request_call (
    uuid,
    uuid,
    scheduling.call_type,
    timestamptz,
    timestamptz
) TO authenticated;

-- --- from 20260724110000_analytics_event_substrate.sql ---

GRANT
EXECUTE ON FUNCTION analytics.fn_subject_visible (analytics.subject_kind, uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION analytics.fn_emit (
    text,
    analytics.subject_kind,
    uuid,
    jsonb,
    numeric,
    uuid,
    text,
    uuid
) TO authenticated;

-- --- from 20260724111000_standing_reputation.sql ---

GRANT
EXECUTE ON FUNCTION org.fn_level_for_score (numeric, integer) TO authenticated;

GRANT
EXECUTE ON FUNCTION org.fn_standing_level (org.standing_subject, uuid) TO authenticated;

-- Mutating functions stay service-role/definer-callable only: Standing is EARNED, never client-written.
REVOKE ALL ON FUNCTION org.fn_recompute_standing (org.standing_subject, uuid)
FROM public;

REVOKE ALL ON FUNCTION org.fn_award_achievement (
    org.standing_subject,
    uuid,
    text,
    uuid
)
FROM public;

REVOKE ALL ON FUNCTION org.fn_touch_streak (
    org.standing_subject,
    uuid,
    org.streak_kind,
    boolean
)
FROM public;

REVOKE ALL ON FUNCTION org.fn_record_mastery (
    org.standing_subject,
    uuid,
    org.create_category,
    numeric,
    boolean
)
FROM public;

GRANT
EXECUTE ON FUNCTION org.fn_recompute_standing (org.standing_subject, uuid) TO service_role;

GRANT
EXECUTE ON FUNCTION org.fn_award_achievement (
    org.standing_subject,
    uuid,
    text,
    uuid
) TO service_role;

GRANT
EXECUTE ON FUNCTION org.fn_touch_streak (
    org.standing_subject,
    uuid,
    org.streak_kind,
    boolean
) TO service_role;

GRANT
EXECUTE ON FUNCTION org.fn_record_mastery (
    org.standing_subject,
    uuid,
    org.create_category,
    numeric,
    boolean
) TO service_role;

-- Trust signals (Decision #155): derived by the platform only. The setup-progress read is the caller's
-- own (the function refuses another person's id), so it is open to a signed-in caller alone.
REVOKE ALL ON FUNCTION org.fn_verification_stamp (uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION org.fn_refresh_verification_stamp (uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION org.trg_freelancer_profiles_verification_stamp () FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION org.fn_refresh_active_adornments (org.standing_subject, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION org.fn_compute_profile_setup_progress (uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION org.fn_verification_stamp (uuid) TO service_role;
GRANT EXECUTE ON FUNCTION org.fn_refresh_verification_stamp (uuid) TO service_role;
GRANT EXECUTE ON FUNCTION org.fn_refresh_active_adornments (org.standing_subject, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION org.fn_compute_profile_setup_progress (uuid) TO authenticated, service_role;

-- --- from 20260724113000_entitlements_allowances_enforcement.sql ---

-- The pure mapping and the Standing rung stay client-callable: the rung is shown publicly on a
-- profile, and the mapping discloses nothing. The rest are SERVICE ROLE ONLY. Each takes ANY subject,
-- and with `finance` exposed to PostgREST (00002500) a client grant would hand any signed-in account
-- another subject's plan, usage counters, allowance and — worst — negotiated commission and platform
-- fee. Nothing in the database calls them as a client (every caller is SECURITY DEFINER); a surface
-- that needs the viewer's OWN figures should get a self-scoped wrapper, not a subject argument.
GRANT
EXECUTE ON FUNCTION finance.fn_audience_for (text) TO authenticated;

GRANT
EXECUTE ON FUNCTION finance.fn_active_plan (text, uuid) TO service_role;

GRANT
EXECUTE ON FUNCTION finance.fn_subject_standing_level (text, uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION finance.fn_effective_limit (
    text,
    uuid,
    finance.entitlement_key
) TO service_role;

GRANT
EXECUTE ON FUNCTION finance.fn_has_entitlement (
    text,
    uuid,
    finance.entitlement_key
) TO service_role;

GRANT
EXECUTE ON FUNCTION finance.fn_effective_commission_bp (text, uuid) TO service_role;

GRANT
EXECUTE ON FUNCTION finance.fn_effective_platform_fee_bp (text, uuid) TO service_role;

GRANT
EXECUTE ON FUNCTION finance.fn_current_allowance (
    text,
    uuid,
    finance.entitlement_key
) TO service_role;

REVOKE ALL ON FUNCTION finance.fn_consume_allowance (
    text,
    uuid,
    integer,
    finance.entitlement_key,
    text,
    text,
    uuid
)
FROM public;

REVOKE ALL ON FUNCTION finance.fn_refund_allowance (
    text,
    uuid,
    integer,
    finance.entitlement_key,
    text,
    text,
    uuid
)
FROM public;

GRANT
EXECUTE ON FUNCTION finance.fn_consume_allowance (
    text,
    uuid,
    integer,
    finance.entitlement_key,
    text,
    text,
    uuid
) TO service_role;

GRANT
EXECUTE ON FUNCTION finance.fn_refund_allowance (
    text,
    uuid,
    integer,
    finance.entitlement_key,
    text,
    text,
    uuid
) TO service_role;

-- The caller-scoped doors onto the proposal allowance. Each derives its subject from auth.uid() (and
-- an active team membership for a team), so neither can address another subject's allowance — which
-- is what keeps `fn_current_allowance` itself, which takes any subject id, service-role only.
REVOKE ALL ON FUNCTION finance.get_proposal_allowance (uuid)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION finance.get_proposal_allowance (uuid) TO authenticated;

REVOKE ALL ON FUNCTION finance.record_proposal_denial (text, uuid, text)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION finance.record_proposal_denial (text, uuid, text) TO authenticated;

GRANT
EXECUTE ON FUNCTION finance.fn_footprint_usage (
    text,
    uuid,
    finance.entitlement_key
) TO service_role;

GRANT
EXECUTE ON FUNCTION finance.fn_footprint_remaining (
    text,
    uuid,
    finance.entitlement_key
) TO service_role;

-- --- finance: basket, wishlist & saved cards ---
-- The two predicates ARE the RLS policies on finance.baskets / finance.basket_items, and a policy
-- expression runs as the invoking role, so revoking either would deny every basket read.

GRANT
EXECUTE ON FUNCTION finance.fn_can_manage_basket (text, uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION finance.fn_can_move_wallet_funds (uuid) TO authenticated;

-- ⚠️ finance.simulate_wallet_transaction MOVES REAL MONEY (see 00001210 §7). EXECUTE is granted to
-- `authenticated` and to NOBODY ELSE:
--   * never `anon` — an unauthenticated caller has no wallet to be authorised against;
--   * deliberately not `service_role` either. The whole safety model is "the caller must own the
--     wallets", and service_role has no auth.uid(), so it could only ever be refused by gate 2.
--     Granting it would advertise a door that is bolted shut and invite someone to unbolt it.
-- Even with EXECUTE held, the function refuses unless security.platform_params
-- finance_simulation_enabled is true — seeded false, and flipping it needs human sign-off.
REVOKE ALL ON FUNCTION finance.simulate_wallet_transaction (
    uuid,
    uuid,
    bigint,
    text,
    text
)
FROM public;

GRANT
EXECUTE ON FUNCTION finance.simulate_wallet_transaction (
    uuid,
    uuid,
    bigint,
    text,
    text
) TO authenticated;

-- The owner-capability predicate the payout-schedule, payment-method and saved-card policies call
-- (00002013). A policy expression runs as the invoking role, so it must be executable by it.
GRANT
EXECUTE ON FUNCTION finance.fn_owner_capability (
    text,
    uuid,
    finance.vault_capability
) TO authenticated;

-- The checkout's identity read (00001210 §8). Both answer only about the caller and the entities the
-- caller is a member of. `fn_purchase_owner_json` is their shared body and is NOT granted: a definer
-- calls it as its owner, and exposing it would let a client skip the anonymous-caller guard.
GRANT
EXECUTE ON FUNCTION finance.get_purchase_owner (text, uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION finance.list_purchase_owners () TO authenticated;

-- One typed code's worth (00001210 §9). The table itself stays unreadable: this answers for the one
-- code the buyer typed and never lists the book.
GRANT
EXECUTE ON FUNCTION finance.resolve_promo_code (text) TO authenticated;

-- A business's invoicing terms (00001210 §10) — gated inside on manage_billing and, for the monthly
-- mode, on KYB verification.
GRANT
EXECUTE ON FUNCTION finance.set_invoicing_terms (text, uuid, text, integer) TO authenticated;

-- Paying a basket from the wallet (00001210 §11). A money-moving function a client may call: it
-- authorises the caller itself (fn_can_manage_basket, KYB, spend limit), re-prices every line, and
-- moves money only through the service-role primitives it calls as its owner.
GRANT EXECUTE ON FUNCTION finance.place_wallet_order(uuid, uuid[], text, jsonb, text, text, bigint) TO authenticated;

-- Auto-funding and billing doors (00001250). Each authorises the caller itself: billing controls and
-- paying an invoice on manage_billing; paying on account on fn_can_manage_basket + KYB + monthly
-- invoicing + the on-account limit, crediting only through the primitives it calls as its owner; the
-- standing read answers only for a business the caller can see. Everything else in 00001250 (the
-- queue drain, the wallet watch, the billing run, the statement generator) stays service-role only.
GRANT EXECUTE ON FUNCTION finance.get_billing_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.set_billing_controls(uuid, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.place_on_account_order(uuid, uuid[], text, jsonb, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.get_on_account_standing(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.pay_invoice(uuid) TO authenticated;

-- The wallet's own movements (00001210 §12) — the same posture: each checks the caller's capability on
-- the wallet money leaves and membership of the wallet it lands in, then moves money only through the
-- primitives it calls as its owner. Deciding a spend request moves nothing; it is gated on
-- manage_members and refuses the requester.
GRANT
EXECUTE ON FUNCTION finance.transfer_funds (
    uuid,
    uuid,
    bigint,
    text,
    text
) TO authenticated;

GRANT
EXECUTE ON FUNCTION finance.distribute_vault (uuid, bigint, text) TO authenticated;

GRANT
EXECUTE ON FUNCTION finance.decide_spend_approval (uuid, text) TO authenticated;

-- Spending an approval is the spend gate's step inside a money movement, never a door of its own.
REVOKE ALL ON FUNCTION finance.fn_redeem_spend_approval (uuid, uuid, bigint, text, uuid, boolean)
FROM PUBLIC, anon, authenticated;

-- --- finance: no function is an API endpoint by default (the move off fixtures, 2026-09-23) ---
-- `finance` now has schema usage (00002500), and Postgres grants EXECUTE on every function to PUBLIC
-- by default. Until now nothing could reach them, because nobody had usage on the schema; from here
-- that default would make every finance function callable over the API. The dangerous ones are the
-- ledger and escrow PRIMITIVES — they move money and check nothing about who is asking, because the
-- guarded doors that call them (projects.fund_stage, complete_ticket, approve_stage, the claim path…)
-- do the checking and run them as their owner. Reachable directly, `rpc/fn_wallet_credit` would credit
-- any wallet with any amount.
--
-- So EXECUTE is revoked from PUBLIC and `anon` on EVERY finance function, and on future ones. The
-- explicit grants to `authenticated` above survive that: they are the predicates the RLS policies call
-- and the two public resolvers. Every SQL caller of a primitive is SECURITY DEFINER, so none of this
-- changes anything that works today. The service role — the backend's trusted door — keeps them all.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA finance FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA finance
REVOKE
EXECUTE ON FUNCTIONS
FROM PUBLIC;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA finance TO service_role;

-- …except the simulator, whose EXECUTE belongs to `authenticated` alone (the region above explains
-- why): the blanket grant just handed it to the service role, so take that back here.
REVOKE EXECUTE ON FUNCTION finance.simulate_wallet_transaction(uuid, uuid, bigint, text, text) FROM service_role;

-- Stated per primitive as well, so no client role can be found holding one even if a broad grant to
-- `authenticated` ever lands above this line.
REVOKE ALL ON FUNCTION finance.fn_wallet_credit (
    uuid,
    text,
    text,
    bigint,
    text,
    text,
    uuid
)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_wallet_debit (
    uuid,
    text,
    text,
    bigint,
    text,
    text,
    uuid
)
FROM authenticated;

-- Ledger reconciliation (Decision #186): writes ops rows and reveals every wallet's figures — the
-- service role and the pg_cron owner only.
REVOKE ALL ON FUNCTION finance.fn_reconcile_wallets () FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_reconcile_wallets () TO service_role;

REVOKE ALL ON FUNCTION finance.fn_transactions_append_only () FROM PUBLIC, anon, authenticated;

-- The pending window (Decision #191): the pending twin of fn_wallet_credit and the chargeback recovery
-- are internal like the primitives; the sweep is the service role's and the pg_cron owner's.
REVOKE ALL ON FUNCTION finance.fn_wallet_credit_pending (uuid, text, text, bigint, text, text, uuid)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION finance.fn_recover_from_pending (uuid, bigint) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION finance.fn_mature_pending_releases (integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_mature_pending_releases (integer) TO service_role;

REVOKE ALL ON FUNCTION finance.fn_hold_ticket_escrow (uuid)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_hold_revision_escrow (uuid)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_release_ticket_escrow (uuid)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_refund_ticket_escrow (uuid)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_fair_exit_release (uuid, integer)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_split_team_payout (uuid, uuid, bigint, text, text)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_generate_consolidated_invoice (
    uuid,
    timestamptz,
    timestamptz
)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_check_spending_limit (uuid, uuid, bigint)
FROM authenticated;

-- The business spend gate (BUSINESSES_AUDIT BF19, BF21, BF22): run only inside the money doors and holds.
REVOKE ALL ON FUNCTION finance.fn_business_threshold (uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_assert_business_spend (uuid, uuid, bigint, text, uuid, boolean)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_close_spend_cover (uuid) FROM PUBLIC, anon, authenticated;

-- #region [about_metrics] The public site's live aggregates (00001265, Decision #277)
-- Service role only: PublicMetricsService reads it and serves the cached answer to everyone. A
-- browser never calls it, so the thresholded figures and their freshness stay the service's to
-- decide; no client role may reach it even though the answer is public.
REVOKE ALL ON FUNCTION finance.public_metrics () FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.public_metrics () TO service_role;
-- #endregion


-- --- finance: the Stripe fiat rails (00001230, Decision #125) ---
-- USER doors: each authorises the caller with auth.uid() and records a REQUEST — it can never mark
-- money received, an account payable or an identity verified.
REVOKE ALL ON FUNCTION finance.begin_card_payment (text, uuid, uuid, uuid, bigint, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.begin_card_payment (text, uuid, uuid, uuid, bigint, text, text, uuid, uuid) TO authenticated;
-- Single-ticket funding (Decision #166): a signed-in payer's door, never anon's.
REVOKE ALL ON FUNCTION projects.fund_ticket (uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.fund_ticket (uuid, uuid) TO authenticated;
-- Stage funding (Decision #197): the quote is the payer's read; the need, the payee rule and the bind
-- run only inside the guarded doors (fund_stage, begin_card_payment, the claim trigger).
REVOKE ALL ON FUNCTION projects.get_stage_funding_quote (uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.get_stage_funding_quote (uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION projects.fn_stage_funding_need (uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_ticket_payee (uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_bind_ticket_escrow (uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.attach_card_payment (uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.attach_card_payment (uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION finance.abandon_card_payment (uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.abandon_card_payment (uuid, text) TO authenticated;
-- The checkout a card / express top-up pays for (Decision #153): a user door — the payer names the
-- order; only the service-role settle door ever places it from the webhook.
REVOKE ALL ON FUNCTION finance.attach_checkout_order (uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.attach_checkout_order (uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION finance.payout_account_for (text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.payout_account_for (text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION finance.record_payout_account (text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.record_payout_account (text, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION finance.begin_identity_verification () FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.begin_identity_verification () TO authenticated;
REVOKE ALL ON FUNCTION finance.attach_identity_session (uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.attach_identity_session (uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION finance.abandon_identity_verification (uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.abandon_identity_verification (uuid, text) TO authenticated;

-- PROCESSOR doors: they apply what Stripe REPORTS, so no client role may call them — a user who could
-- would be able to announce their own payment settled or their own account verified. Reached only
-- from the signature-verified webhook and the fat service's own status reads, as service_role.
REVOKE ALL ON FUNCTION finance.settle_card_payment (text, text, bigint, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.settle_card_payment (text, text, bigint, text, boolean, uuid) TO service_role;
-- The N1 recovery sweep's worklist: card payments still unsettled after the grace period.
REVOKE ALL ON FUNCTION finance.claim_unsettled_card_payments (interval, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.claim_unsettled_card_payments (interval, integer) TO service_role;
REVOKE ALL ON FUNCTION finance.record_card_payment_failure (text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.record_card_payment_failure (text, text, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION finance.apply_identity_event (text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.apply_identity_event (text, text, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION finance.sync_payout_account (text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.sync_payout_account (text, text) TO service_role;
REVOKE ALL ON FUNCTION finance.record_transfer_created (text, text, text, bigint, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.record_transfer_created (text, text, text, bigint, text, uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION finance.record_dispute_opened (text, text, text, bigint, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.record_dispute_opened (text, text, text, bigint, text, text, boolean) TO service_role;

-- Internal helpers: called only from inside the doors above, never over the API.
REVOKE ALL ON FUNCTION finance.fn_claim_stripe_event (text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_release_stripe_event (text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_complete_stripe_event (text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_stripe_event_replay (text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_payout_owner (text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- --- finance: money movement after the fiat rails (00001240, Decision #126) ---
-- USER doors: authorise the caller themselves; none can report that money arrived or left.
REVOKE ALL ON FUNCTION finance.begin_payout (uuid, bigint, text, boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.begin_payout (uuid, bigint, text, boolean, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION finance.card_owner_for (text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.card_owner_for (text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION finance.record_processor_customer (text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.record_processor_customer (text, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION finance.create_deposit_rule (uuid, bigint, text, finance.deposit_interval, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.create_deposit_rule (uuid, bigint, text, finance.deposit_interval, uuid) TO authenticated;
-- Pause / resume / re-price / archive (A13): the same authority as creating one; checked inside.
REVOKE ALL ON FUNCTION finance.update_deposit_rule (uuid, boolean, bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.update_deposit_rule (uuid, boolean, bigint, boolean) TO authenticated;
REVOKE ALL ON FUNCTION finance.fn_deposit_rules_immutable () FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.set_income_smoother (text, bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.set_income_smoother (text, bigint, boolean) TO authenticated;
REVOKE ALL ON FUNCTION finance.my_verification_status () FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.my_verification_status () TO authenticated;
REVOKE ALL ON FUNCTION finance.ensure_purchase_wallet (text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.ensure_purchase_wallet (text, uuid, text) TO authenticated;

-- PROCESSOR doors: service_role only (a client who could call them could announce their own payout
-- sent, their own chargeback won, or a card saved against somebody else's billing profile).
REVOKE ALL ON FUNCTION finance.record_dispute_closed (text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.record_dispute_closed (text, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION finance.complete_payout (uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.complete_payout (uuid, text) TO service_role;
REVOKE ALL ON FUNCTION finance.fail_payout (uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.fail_payout (uuid, text) TO service_role;
-- The withdrawal lifecycle after the transfer (Decision #202): a reversal, the bank payout's outcome and
-- the stale-pending sweep's claim.
REVOKE ALL ON FUNCTION finance.record_transfer_reversed (text, text, text, bigint, bigint, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.record_transfer_reversed (text, text, text, bigint, bigint, text, uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION finance.record_bank_payout (text, text, text, text, text, text, text[], text[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.record_bank_payout (text, text, text, text, text, text, text[], text[], boolean) TO service_role;
REVOKE ALL ON FUNCTION finance.fn_claim_stale_payouts (integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.fn_claim_stale_payouts (integer) TO service_role;
REVOKE ALL ON FUNCTION finance.record_saved_card (text, uuid, text, text, text, integer, integer, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.record_saved_card (text, uuid, text, text, text, integer, integer, uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION finance.claim_due_deposit_rules (integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.claim_due_deposit_rules (integer) TO service_role;
REVOKE ALL ON FUNCTION finance.bind_scheduled_payment (uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.bind_scheduled_payment (uuid, text, text) TO service_role;

-- Internal helpers.
REVOKE ALL ON FUNCTION finance.fn_payout_destination (finance.wallets) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_deposit_charge_target (finance.deposit_rules) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_min_withdrawal_minor (text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_minor_units_text (bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_escrow_payer_wallet_type (uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_escrow_fee_bp (uuid, uuid) FROM PUBLIC, anon, authenticated;


-- --- files: asset management ---
-- files.fn_can_read is deliberately left executable by PUBLIC: it IS the SELECT policy on
-- files.items, and a policy expression runs as the invoking role, so revoking it would deny every
-- read. It is safe to expose — it answers one boolean about one id and returns false by default.
--
-- The rest are internal. fn_recompute_usage rewrites a metered rollup and the two trigger functions
-- have no meaningful direct call, so none of them is a client entry point (the same discipline
-- applied to the Standing mutators and the allowance meters above).
REVOKE ALL ON FUNCTION files.fn_recompute_usage (files.owner_kind, uuid)
FROM public;

REVOKE ALL ON FUNCTION files.fn_usage_trigger () FROM public;

REVOKE ALL ON FUNCTION files.fn_check_storage_quota () FROM public;

REVOKE ALL ON FUNCTION files.fn_touch_updated_at () FROM public;

GRANT
EXECUTE ON FUNCTION files.fn_recompute_usage (files.owner_kind, uuid) TO service_role;

-- fn_mint_share_slug mints the credential for a share link. Minting is a server decision (the fat
-- backend writes files.share_links), so the client never calls it directly.
REVOKE ALL ON FUNCTION files.fn_mint_share_slug () FROM public;

GRANT EXECUTE ON FUNCTION files.fn_mint_share_slug () TO service_role;

-- fn_resolve_share is the ONLY visitor-reachable door into files.share_links (the table itself has
-- no anon grant on purpose — see 00002520). Executable by anon because an anonymous visitor holding
-- a slug is exactly the case it exists for; it takes the slug as INPUT, so holding EXECUTE grants
-- nothing without already holding a credential.
GRANT
EXECUTE ON FUNCTION files.fn_resolve_share (text) TO anon,
authenticated,
service_role;

-- --- group conversations (00001300: create_group_thread / add_dm_thread_members) ---

-- Both are SECURITY DEFINER and write comms.dm_threads / dm_participants, which carry no client
-- INSERT policy — so the EXECUTE grant IS the access decision, and it is scoped to signed-in
-- callers only. Each function additionally refuses a NULL auth.uid() itself.
REVOKE ALL ON FUNCTION comms.create_group_thread(text, uuid[]) FROM public, anon;

GRANT EXECUTE ON FUNCTION comms.create_group_thread(text, uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION comms.add_dm_thread_members(uuid, uuid[]) FROM public, anon;

GRANT EXECUTE ON FUNCTION comms.add_dm_thread_members(uuid, uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION comms.set_group_photo(uuid, uuid) FROM public, anon;

GRANT EXECUTE ON FUNCTION comms.set_group_photo(uuid, uuid) TO authenticated;

-- --- inbox folders + hiring requests (00001300: set_dm_inbox_folder / send_request_message) ---

-- Same footing as the group RPCs above: definer writes into dm_participants / dm_messages, so the
-- EXECUTE grant is the access decision, and each function re-checks auth.uid() itself.
REVOKE ALL ON FUNCTION comms.set_dm_inbox_folder(uuid, text) FROM public, anon;

GRANT EXECUTE ON FUNCTION comms.set_dm_inbox_folder(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION comms.set_dm_starred(uuid, boolean) FROM public, anon;

GRANT EXECUTE ON FUNCTION comms.set_dm_starred(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION comms.set_dm_muted(uuid, boolean) FROM public, anon;

GRANT EXECUTE ON FUNCTION comms.set_dm_muted(uuid, boolean) TO authenticated;

GRANT EXECUTE ON FUNCTION comms.mark_dm_read(uuid) TO authenticated;

REVOKE ALL ON FUNCTION comms.send_request_message(uuid, text, uuid) FROM public, anon;

GRANT EXECUTE ON FUNCTION comms.send_request_message(uuid, text, uuid) TO authenticated;

-- The DM PII filter's two lookups answer "which projects is this OTHER person party to" — a question
-- no client should be able to ask about anyone. Reached only from the definer trigger.
REVOKE ALL ON FUNCTION comms.fn_dm_protected_project(uuid, uuid, uuid) FROM public, anon, authenticated;

-- The reply guards (00001300) are trigger functions: EXECUTE is checked once, at CREATE TRIGGER,
-- against the trigger's creator, so no client role needs it and none is left holding it.
REVOKE ALL ON FUNCTION comms.tg_guard_message_reply() FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION comms.tg_guard_dm_message_reply() FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION projects.fn_engaged_projects(uuid) FROM public, anon, authenticated, service_role;

-- --- freelancer removal (00001120: release_ticket_to_backlog) ---

-- 🚨 `projects.release_ticket_to_backlog` is SECURITY DEFINER, releases a ticket's held escrow to
-- its assignee and resets the ticket to New — and it carried the default PUBLIC EXECUTE with NO
-- caller check of its own, so any signed-in caller who knew a ticket id could pay out its escrow
-- and un-claim it (the `reorder_stages` class, Decision #84). It has no application caller: its
-- one reachable door is `projects.remove_project_member` (00001130), a DEFINER function whose
-- owner still executes it after this revoke, and which checks project ownership first.
REVOKE ALL ON FUNCTION projects.release_ticket_to_backlog (uuid)
FROM public, anon, authenticated, service_role;

-- --- escrow settlement doors (00001120 / 00001130 / 00001150) ---

-- 🚨 Five SECURITY DEFINER functions that release or settle escrow carried the default PUBLIC
-- EXECUTE, and `anon` holds USAGE on `projects` (00002500), so each was an RPC a signed-out caller
-- could reach. complete_ticket and delete_ticket had no caller check at all; approve_stage,
-- force_complete_stage and cancel_stage_fair_exit checked only has_project_access, which the
-- assignee passes — so the payee could approve their own payout. Each body now requires a signed-in
-- caller with review authority (projects.can_review_project), and EXECUTE is held by
-- `authenticated` alone. Not `service_role`: every one of them attributes the decision to
-- auth.uid() and refuses without one, so a grant there could only ever produce a refusal.
REVOKE ALL ON FUNCTION projects.complete_ticket (uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.complete_ticket (uuid) TO authenticated;

REVOKE ALL ON FUNCTION projects.delete_ticket (uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.delete_ticket (uuid) TO authenticated;

REVOKE ALL ON FUNCTION projects.force_complete_stage (uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.force_complete_stage (uuid) TO authenticated;

REVOKE ALL ON FUNCTION projects.approve_stage (uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.approve_stage (uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION projects.cancel_stage_fair_exit (uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.cancel_stage_fair_exit (uuid, uuid, integer) TO authenticated;

-- The Fair Exit confirmation's read (Decision #198): it checks review authority itself, like the door.
REVOKE ALL ON FUNCTION projects.preview_stage_fair_exit (uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.preview_stage_fair_exit (uuid, uuid) TO authenticated;

-- Internal to preview_stage_fair_exit / cancel_stage_fair_exit; the split helper is pure arithmetic
-- shared with finance.fn_fair_exit_release.
REVOKE ALL ON FUNCTION projects.fn_fair_exit_quote (uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_fair_exit_split (bigint, integer, integer) FROM PUBLIC, anon, authenticated, service_role;

-- Internal to review_submission / approve_stage (Decision #194): the settler releases escrow and the
-- notifier writes to anybody's inbox, so neither is callable directly.
REVOKE ALL ON FUNCTION projects.fn_settle_ticket_stage (uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_notify_payees (uuid[], uuid[], text, text, text, text, uuid, uuid, text)
FROM PUBLIC, anon, authenticated, service_role;

-- 🚨 The claim-TTL sweep REFUNDS every claimed ticket older than the TTL measured from `p_now` — a
-- caller-supplied argument. With PUBLIC EXECUTE anybody could pass a far-future instant and refund and
-- evict every claimed ticket on the platform in one call. It is a cron job: service_role only.
REVOKE ALL ON FUNCTION projects.fn_release_expired_claims (timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION projects.fn_release_expired_claims (timestamptz) TO service_role;

-- Internal to the claim paths (Decision #165): callable directly, anybody could mark any unfunded
-- ticket Needs funding and notify its owner at will.
REVOKE ALL ON FUNCTION projects.fn_mark_needs_funding (uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Trigger function: EXECUTE is checked at CREATE TRIGGER, so no role needs it.
REVOKE ALL ON FUNCTION projects.fn_ticket_settlement_guard () FROM PUBLIC, anon, authenticated, service_role;

-- Paid revisions (Decision #167). The two doors check review authority / the payer rule themselves;
-- the notifier and the terms trigger are internal (a direct call could notify anybody about anything).
REVOKE ALL ON FUNCTION projects.request_paid_revision (uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION projects.request_paid_revision (uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION projects.fund_paid_revision (uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION projects.fund_paid_revision (uuid) TO authenticated;
REVOKE ALL ON FUNCTION projects.fn_notify_revision (uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_stage_revision_terms () FROM PUBLIC, anon, authenticated, service_role;

-- --- membership doors (00001135) ---

-- SECURITY DEFINER writes into security.audit_logs / comms.fn_notify, which no client role reaches, so
-- the grant is part of the access decision: signed-in callers only. Each body also refuses a NULL
-- auth.uid() itself and applies its own authority check (set_member_role and set_ticket_manager:
-- can_review_project + `hire`; invite_by_email, act_on_invitation and the stage invite-link doors:
-- can_manage_project_members; resolve/redeem_invite_link: any signed-in holder of the token).
REVOKE ALL ON FUNCTION projects.set_member_role (uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.set_member_role (uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION projects.set_ticket_manager (uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.set_ticket_manager (uuid, uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION projects.invite_by_email (uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.invite_by_email (uuid, uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION projects.act_on_invitation (uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.act_on_invitation (uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION projects.get_stage_invite_link (uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.get_stage_invite_link (uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION projects.revoke_stage_invite_link (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.revoke_stage_invite_link (uuid) TO authenticated;

REVOKE ALL ON FUNCTION projects.resolve_invite_link (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.resolve_invite_link (text) TO authenticated;

REVOKE ALL ON FUNCTION projects.redeem_invite_link (text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.redeem_invite_link (text, text) TO authenticated;

-- Internal: called by the two doors above as their owner, never an RPC of its own.
REVOKE ALL ON FUNCTION projects.fn_invite_link_state (projects.stage_invite_links, uuid)
FROM PUBLIC, anon, authenticated, service_role;

-- --- lane view activity marks (00001145) ---
--
-- SECURITY INVOKER reads and one own-row upsert: RLS is the gate, so the grant only keeps them off
-- the anonymous role, whose auth.uid() is NULL and which each body refuses anyway.
REVOKE ALL ON FUNCTION projects.get_nav_activity (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.get_nav_activity (text) TO authenticated;

REVOKE ALL ON FUNCTION projects.mark_view_seen (text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.mark_view_seen (text, text) TO authenticated;

REVOKE ALL ON FUNCTION projects.fn_touch_updated_at () FROM PUBLIC, anon, authenticated, service_role;

-- --- the public profile read + owner write path (00001040) and the media projection (00001160) ---
--
-- Internal predicates are revoked from PUBLIC: they are called by the definer functions below (as
-- their owner) and never need to be reachable as an RPC. org.fn_profile_visible is the exception —
-- it IS the SELECT policy on the profile detail tables, and a policy expression runs as the
-- invoking role, so it must stay executable by anon and authenticated (the files.fn_can_read rule).

REVOKE ALL ON FUNCTION org.fn_profile_manages (text, uuid)
FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION org.fn_resolve_profile (text)
FROM public, anon, authenticated;

GRANT
EXECUTE ON FUNCTION org.fn_profile_visible (text, uuid) TO anon,
authenticated,
service_role;

-- The reads: a guest reads a public profile exactly as a member does.
GRANT
EXECUTE ON FUNCTION org.get_profile_view (text) TO anon,
authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION org.get_profile_experience (text) TO anon,
authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION org.get_profile_reviews (text, integer) TO anon,
authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION org.get_profile_roster (text) TO anon,
authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION org.get_profile_portfolio (text) TO anon,
authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION org.get_profile_past_projects (text) TO anon,
authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION org.get_profile_owner (text) TO anon,
authenticated,
service_role;

-- Identity cards are read by signed-in surfaces (rosters, message senders, pickers).
REVOKE ALL ON FUNCTION org.get_party_cards(uuid[]) FROM public, anon;

GRANT EXECUTE ON FUNCTION org.get_party_cards(uuid[]) TO authenticated, service_role;

-- The owner's own date of birth and zone: answers only for auth.uid(), so a guest has nothing to read.
REVOKE ALL ON FUNCTION org.get_own_private_profile() FROM public, anon;

GRANT EXECUTE ON FUNCTION org.get_own_private_profile() TO authenticated, service_role;

-- Followers / following lists are public (a follow is a public edge), so anon may read the cards too;
-- the function itself drops every profile the caller may not see.
REVOKE ALL ON FUNCTION org.get_profile_cards(text[], uuid[]) FROM public;

GRANT EXECUTE ON FUNCTION org.get_profile_cards(text[], uuid[]) TO anon, authenticated, service_role;

-- The owner write path: a signed-in caller only; each function checks the caller manages the profile.
REVOKE ALL ON FUNCTION org.can_manage_profile (text, uuid)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION org.can_manage_profile (text, uuid) TO authenticated,
service_role;

REVOKE ALL ON FUNCTION org.save_profile (text, uuid, jsonb)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION org.save_profile (text, uuid, jsonb) TO authenticated,
service_role;

REVOKE ALL ON FUNCTION org.set_profile_avatar (text, uuid, uuid)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION org.set_profile_avatar (text, uuid, uuid) TO authenticated,
service_role;

REVOKE ALL ON FUNCTION org.save_showcase (text, uuid, jsonb)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION org.save_showcase (text, uuid, jsonb) TO authenticated,
service_role;

-- The media projection. The single-item form is internal to the definer reads; the batch form is
-- the door other readers use, and returns nothing that is not already world-readable.
REVOKE ALL ON FUNCTION files.fn_public_media_ref (uuid)
FROM public, anon, authenticated;

GRANT
EXECUTE ON FUNCTION files.fn_public_media_ref (uuid) TO service_role;

GRANT EXECUTE ON FUNCTION files.get_public_media(uuid[]) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION files.fn_guard_pipeline_columns () FROM public;

REVOKE ALL ON FUNCTION files.fn_guard_folder_columns () FROM public;

REVOKE ALL ON FUNCTION files.fn_guard_hard_delete () FROM public;

-- files.fn_owns_library is a POLICY predicate (the items/folders INSERT and UPDATE checks), so like
-- fn_can_read it must stay executable by the roles those policies run as.
GRANT
EXECUTE ON FUNCTION files.fn_owns_library (files.owner_kind, uuid) TO anon,
authenticated,
service_role;

-- files.fn_folder_in_library and files.fn_library_archived are called from inside both guards, which
-- run as the client's own role.
GRANT
EXECUTE ON FUNCTION files.fn_folder_in_library (uuid, files.owner_kind, uuid, uuid) TO anon,
authenticated,
service_role;

REVOKE ALL ON FUNCTION files.fn_library_archived (files.owner_kind, uuid) FROM public;

GRANT
EXECUTE ON FUNCTION files.fn_library_archived (files.owner_kind, uuid) TO anon,
authenticated,
service_role;

-- The storage meter's one door: it authorises the caller against the principal inside.
REVOKE ALL ON FUNCTION files.get_storage_quota (files.owner_kind, uuid)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION files.get_storage_quota (files.owner_kind, uuid) TO authenticated,
service_role;

-- The download ledger is written by the server only, after it has decided the caller may read the file.
REVOKE ALL ON FUNCTION files.fn_record_download (
    uuid,
    uuid,
    text,
    files.download_via,
    text
)
FROM public, anon, authenticated;

GRANT
EXECUTE ON FUNCTION files.fn_record_download (
    uuid,
    uuid,
    text,
    files.download_via,
    text
) TO service_role;

-- The owner's Availability editor (00001510). INVOKER: the scheduling policies are the gate.
REVOKE ALL ON FUNCTION scheduling.save_owner_availability (
    scheduling.owner_type,
    uuid,
    jsonb
)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION scheduling.save_owner_availability (
    scheduling.owner_type,
    uuid,
    jsonb
) TO authenticated,
service_role;

-- The booking reads and the one call-request write (00001520). `fn_schedule_host` is internal to the
-- definer functions; the free/busy read is public for a published schedule; a call request needs a
-- signed-in requester.
-- Closing a reschedule round moves an event. The rules that decide WHETHER it may are applied by the
-- scheduling service before it calls this, so a client able to call it directly could skip every one.
REVOKE ALL ON FUNCTION scheduling.close_reschedule_round (
    uuid,
    text,
    uuid,
    uuid,
    text,
    text
)
FROM public, anon, authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.close_reschedule_round (
    uuid,
    text,
    uuid,
    uuid,
    text,
    text
) TO service_role;

-- The ballot cap is a trigger function (00001510 §6d); nobody calls it, so nobody is granted it.
REVOKE ALL ON FUNCTION scheduling.fn_cap_reschedule_proposals () FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION scheduling.fn_guard_reschedule_write () FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION scheduling.fn_stamp_vote_deadline () FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION scheduling.fn_vote_deadline (uuid, timestamptz) FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION scheduling.fn_schedule_host (uuid)
FROM public, anon, authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_schedule_host (uuid) TO service_role;

REVOKE ALL ON FUNCTION scheduling.get_free_busy (
    uuid,
    timestamptz,
    timestamptz
)
FROM public;

GRANT
EXECUTE ON FUNCTION scheduling.get_free_busy (
    uuid,
    timestamptz,
    timestamptz
) TO anon,
authenticated,
service_role;

REVOKE ALL ON FUNCTION scheduling.request_discovery_call (
    uuid,
    scheduling.call_type,
    timestamptz,
    timestamptz,
    text,
    text,
    text,
    uuid
)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION scheduling.request_discovery_call (
    uuid,
    scheduling.call_type,
    timestamptz,
    timestamptz,
    text,
    text,
    text,
    uuid
) TO authenticated,
service_role;

-- The seller console's write doors (00001170). INVOKER: the catalogue and marketplace policies are the
-- gate, so a caller can only ever create, edit or publish their own listing. The sales read is a
-- definer scoped to the caller's own listings inside its WHERE.
REVOKE ALL ON FUNCTION catalogue.create_listing (text, text, text, uuid, text, text)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION catalogue.create_listing (text, text, text, uuid, text, text) TO authenticated,
service_role;

REVOKE ALL ON FUNCTION catalogue.save_listing (uuid, jsonb)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION catalogue.save_listing (uuid, jsonb) TO authenticated,
service_role;

REVOKE ALL ON FUNCTION catalogue.set_listing_status (uuid, text)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION catalogue.set_listing_status (uuid, text) TO authenticated,
service_role;

REVOKE ALL ON FUNCTION catalogue.get_listing_sales(uuid[], timestamptz) FROM public, anon;

GRANT EXECUTE ON FUNCTION catalogue.get_listing_sales(uuid[], timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION catalogue.get_listing_rollups(uuid[], date, date) FROM public, anon;

GRANT EXECUTE ON FUNCTION catalogue.get_listing_rollups(uuid[], date, date) TO authenticated, service_role;

-- The catalogue rebuild's doors (Decision #217): the showcase, the batch status action and duplicate.
-- INVOKER like the doors above, so the owner policies stay the gate. `fn_listing_file_ok` is the
-- file-ownership predicate those doors and save_listing call as the caller.
REVOKE ALL ON FUNCTION catalogue.apply_listing_media (uuid, jsonb) FROM public, anon;

GRANT EXECUTE ON FUNCTION catalogue.apply_listing_media (uuid, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION catalogue.set_listings_status (uuid[], text) FROM public, anon;

GRANT EXECUTE ON FUNCTION catalogue.set_listings_status (uuid[], text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION catalogue.duplicate_listing (uuid) FROM public, anon;

GRANT EXECUTE ON FUNCTION catalogue.duplicate_listing (uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION catalogue.fn_listing_file_ok (uuid, uuid, text) FROM public, anon;

GRANT EXECUTE ON FUNCTION catalogue.fn_listing_file_ok (uuid, uuid, text) TO authenticated, service_role;

-- The no-history hard delete and its engagement read (Decision #221). The count itself is internal:
-- only the two definers that gate it on the caller call it.
REVOKE ALL ON FUNCTION catalogue.fn_listing_engagements (uuid) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION catalogue.fn_listing_engagements (uuid) TO service_role;

REVOKE ALL ON FUNCTION catalogue.get_listing_engagement (uuid[]) FROM public, anon;

GRANT EXECUTE ON FUNCTION catalogue.get_listing_engagement (uuid[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION catalogue.delete_listing (uuid) FROM public, anon;

GRANT EXECUTE ON FUNCTION catalogue.delete_listing (uuid) TO authenticated, service_role;

-- --- the Project Details sidebar's Teams group (00001100: get_viewer_hired_teams) ---
--
-- Answers only about the caller's own team memberships, so it needs a signed-in caller; a guest has
-- no `auth.uid()` and would only ever read zero rows.
REVOKE ALL ON FUNCTION projects.get_viewer_hired_teams (uuid)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION projects.get_viewer_hired_teams (uuid) TO authenticated;

-- --- the Members tab's Requests section (00001130 §7b: reject_application) ---
--
-- The managing side's decline of an applicant. The function checks `can_manage_project_members` itself, so a signed-in
-- caller is the only gate needed here; a guest has no `auth.uid()` and nothing to review.
REVOKE ALL ON FUNCTION projects.reject_application (uuid)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION projects.reject_application (uuid) TO authenticated;

-- --- the applicant's side of a proposal (00001130 §6c withdraw_application, §6d list_my_applications) ---
--
-- Both resolve the caller from auth.uid(): withdrawal checks the caller filed the application (or may
-- bind the applying team), and the list returns only the caller's own and their teams' applications.
REVOKE ALL ON FUNCTION projects.withdraw_application (uuid)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION projects.withdraw_application (uuid) TO authenticated;

REVOKE ALL ON FUNCTION projects.list_my_applications (text, uuid)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION projects.list_my_applications (text, uuid) TO authenticated;

-- #region The workspace console (Teams & Businesses, Decision #122)
-- The write and read doors of /teams and /businesses. Each is a definer that resolves the caller from
-- auth.uid() and checks the workspace capability it needs (org.fn_member_can) — never a role name —
-- so all are safe to expose to a signed-in caller and none to a guest. The permission twin, the vault
-- projection, the handle helpers and the membership trigger function stay internal (service role
-- only, from the org region at the top).
GRANT EXECUTE ON FUNCTION org.check_handle (text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.create_workspace (text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.set_workspace_status (text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.update_workspace (text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION org.invite_workspace_member (text, uuid, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.respond_to_workspace_invitation (uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION org.revoke_workspace_invitation (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION org.resend_workspace_invitation (uuid) TO authenticated;
-- The ask-to-join link and its requests (00001020 §12b, Decision #318). The state rule, the token
-- minter, the link projection and the shared admission stay internal (the org region's blanket revoke).
GRANT EXECUTE ON FUNCTION org.get_workspace_invite_link (text, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION org.revoke_workspace_invite_link (text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION org.resolve_workspace_invite_link (text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.redeem_workspace_invite_link (text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.respond_to_join_request (uuid, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION org.withdraw_join_request (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION org.update_workspace_member (text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION org.transfer_workspace_ownership (text, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION org.upsert_workspace_role (text, uuid, uuid, text, text, org.workspace_capability[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.archive_workspace_role (text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION org.get_workspace_roster (text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.get_workspace_detail (text, text) TO authenticated;
-- The Talent module's bench (00001020 §17, BU5): answers `forbidden` to anybody without `hire`.
GRANT EXECUTE ON FUNCTION org.get_business_bench (text) TO authenticated;

-- Money governance (00001210 §13). The finance schema is deny-by-default (above), so each is granted.
GRANT EXECUTE ON FUNCTION finance.save_team_split (uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.save_split_rule (uuid, finance.split_rule_type, integer, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.preview_team_split (uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.save_spend_policy (uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.preview_spend_envelope (uuid, jsonb) TO authenticated;
-- The envelope reader behind the detail and the preview narrows by the caller, but answers for any
-- business; only those definers call it.
REVOKE ALL ON FUNCTION finance.fn_business_envelopes (uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.request_spend_approval (uuid, bigint, text, text, uuid) TO authenticated;
-- The requester's own door back out of a pending request (BU2, Decision #246).
REVOKE ALL ON FUNCTION finance.withdraw_spend_approval (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.withdraw_spend_approval (uuid) TO authenticated;
-- What a request is for: it reads any business's rows, so only the detail read (a definer) calls it.
REVOKE ALL ON FUNCTION finance.fn_spend_ref (text, uuid) FROM PUBLIC, anon, authenticated;

-- The wallet ledger reads (00001210 §14). SECURITY INVOKER: each answers under the caller's own RLS, so
-- granting them reaches no row the caller could not already select. A signed-out caller has nothing to
-- read, so `anon` is refused outright.
REVOKE EXECUTE ON FUNCTION finance.list_ledger (
    uuid[], integer, timestamptz, uuid, text, text[], timestamptz, timestamptz, text, text[], uuid[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.list_ledger (
    uuid[], integer, timestamptz, uuid, text, text[], timestamptz, timestamptz, text, text[], uuid[]
) TO authenticated;
REVOKE EXECUTE ON FUNCTION finance.ledger_flow (uuid[], timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.ledger_flow (uuid[], timestamptz, timestamptz, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION finance.ledger_first_at (uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.ledger_first_at (uuid[]) TO authenticated;

-- The acting-context switches (00001001). The shared writer they call is NOT reachable: it trusts its
-- arguments, and every switch re-checks the membership before calling it.
REVOKE ALL ON FUNCTION security.fn_set_session_context (public.profile_type, uuid, uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security.switch_session_context (public.profile_type, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION security.switch_team_context (uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION security.switch_enterprise_context (uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION security.clear_session_context () FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.switch_session_context (public.profile_type, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION security.switch_team_context (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION security.switch_enterprise_context (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION security.clear_session_context () TO authenticated;

-- The operator predicate (IW-M8). Executable by PUBLIC until now, i.e. by every role in the cluster.
-- It IS an arm of policies on tables a guest reads (integrations.plugins, plugin_versions, and the
-- `TO public` org policies), and a policy expression runs as the invoking role, so both client roles
-- keep it; it answers only about auth.uid(), which is false for a guest.
REVOKE ALL ON FUNCTION security.is_admin () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.is_admin () TO anon, authenticated, service_role;
-- #endregion

-- #region Scheduling privacy doors (2026-09-28)
-- fn_is_event_attendee IS a SELECT policy arm on scheduling.events (authenticated only — anon reads no
-- event row), so it stays executable by that role. get_event_rooms answers only for the caller's own
-- parties; get_public_blackouts is the visitor's blackout read. The two trigger functions are never
-- called directly.
REVOKE ALL ON FUNCTION scheduling.fn_is_event_attendee (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION scheduling.fn_is_event_attendee (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION scheduling.get_event_rooms (uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION scheduling.get_event_rooms (uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION scheduling.get_public_blackouts (uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduling.get_public_blackouts (uuid, timestamptz, timestamptz) TO anon, authenticated, service_role;
-- The guard is INVOKER (it must see the caller's role). EXECUTE on a trigger function is checked
-- once, at CREATE TRIGGER, against the trigger's creator (see 00001001 §4), so no client role needs it;
-- but the body runs as the INVOKING role, so the definer roster helper it calls must be executable by
-- `authenticated` (the only client role that can reach an UPDATE or DELETE on scheduling.events).
REVOKE ALL ON FUNCTION scheduling.fn_guard_rostered_event () FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION scheduling.fn_event_has_roster (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION scheduling.fn_event_has_roster (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION scheduling.fn_check_schedule_timezone () FROM PUBLIC, anon, authenticated;
-- #endregion

-- #region Availability presets & recurrence (00001510 §10, Decision #217)
-- The two editor doors need a signed-in caller (save is an invoker under the preset policies; archive
-- a definer that checks fn_can_manage_schedule itself). The occurrence door is the service role's
-- alone: a client able to write spans could open hours its owner never set. The parent-schedule
-- helpers are policy expressions on rules, bands and occurrences, so `authenticated` runs them; they
-- answer only "which schedule", never what is on it. fn_preset_for_blueprint resolves a public
-- listing's preset, like fn_band_covers answers for any schedule. The rest is internal to the gate
-- and the triggers.
REVOKE ALL ON FUNCTION scheduling.save_availability_preset (uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION scheduling.save_availability_preset (uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION scheduling.archive_availability_preset (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION scheduling.archive_availability_preset (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION scheduling.replace_preset_occurrences (uuid, timestamptz, timestamptz, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION scheduling.replace_preset_occurrences (uuid, timestamptz, timestamptz, jsonb)
TO service_role;
REVOKE ALL ON FUNCTION scheduling.fn_preset_schedule (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION scheduling.fn_preset_schedule (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION scheduling.fn_rule_schedule (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION scheduling.fn_rule_schedule (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION scheduling.fn_preset_for_blueprint (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduling.fn_preset_for_blueprint (uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION scheduling.fn_occurrence_covers (uuid, scheduling.availability_kind, timestamptz, timestamptz)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION scheduling.fn_occurrence_covers (uuid, scheduling.availability_kind, timestamptz, timestamptz)
TO service_role;
REVOKE ALL ON FUNCTION scheduling.fn_is_owner_schedule (uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION scheduling.fn_is_owner_schedule (uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION scheduling.trg_preset_guard () FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION scheduling.trg_blueprint_preset_binding () FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION scheduling.trg_invalidate_preset_compilation () FROM PUBLIC, anon, authenticated;
-- #endregion

-- #region Email addresses (00001050, 2026-10-06)
-- org.user_emails is read-only to a client; these definers are its write doors. Each resolves the
-- caller from auth.uid() and touches only the caller's own rows, so all five are safe for a signed-in
-- caller and none for a guest. (The org schema is deny-by-default at the top of this file; the guard
-- trigger function stays unreachable — EXECUTE on a trigger function is checked at CREATE TRIGGER.)
GRANT EXECUTE ON FUNCTION org.get_my_emails () TO authenticated;
GRANT EXECUTE ON FUNCTION org.add_user_email (text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.remove_user_email (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION org.set_primary_email (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION org.confirm_user_email (text) TO authenticated;
-- The token mint returns a RAW verification token, so it is the service role's alone. It lives in
-- `security` because the service role holds USAGE there and not on `org`; `authenticated` holds USAGE
-- on `security` too, which is why the revoke names it explicitly.
REVOKE ALL ON FUNCTION security.issue_email_verification (uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.issue_email_verification (uuid) TO service_role;
-- #endregion

-- #region Account lifecycle (00001060)
-- The handle policy and the scheduled removals act on the caller alone (auth.uid()), so they are safe
-- for a signed-in caller and none for a guest. The fn_* helpers stay definer-internal. The erasure
-- sweep is the service role's alone, through its security-schema door.
GRANT EXECUTE ON FUNCTION org.get_handle_policy () TO authenticated;
GRANT EXECUTE ON FUNCTION org.change_username (text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.get_account_lifecycle () TO authenticated;
GRANT EXECUTE ON FUNCTION org.schedule_freelancer_removal (text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.schedule_account_deletion (text) TO authenticated;
GRANT EXECUTE ON FUNCTION org.cancel_deletion_request (text) TO authenticated;
REVOKE ALL ON FUNCTION security.purge_due_account_deletions (integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.purge_due_account_deletions (integer) TO service_role;
-- #endregion

-- #region Auto-replies (00001300)
-- Whether a person is away, busy or out of hours is theirs to keep: the status predicate is reached
-- only from inside the definer trigger, never as an RPC (the comms schema does not revoke PUBLIC by
-- default, Decision #151(c)).
REVOKE ALL ON FUNCTION comms.fn_auto_reply_status (uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION comms.tg_dm_auto_reply () FROM PUBLIC, anon, authenticated;
-- #endregion

-- #region Sessions & cohorts (00001155, Decision #171)
-- `projects` does not revoke PUBLIC by default, so every function here is stated. The internal
-- primitives — above all fn_confirm_seat, which mints a membership and debits a wallet for whatever
-- it is handed — are reachable only from the definers that call them.
REVOKE ALL ON FUNCTION projects.fn_session_param (text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_is_session_host (uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_cohort_seats_taken (uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_confirm_seat (uuid, uuid, text, uuid, bigint, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_session_presence (uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION projects.fn_session_presence (uuid) TO service_role;
REVOKE ALL ON FUNCTION finance.fn_release_seat_escrow (uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_refund_seat_escrow (uuid) FROM PUBLIC, anon, authenticated;
-- The listing's public seat count and curriculum: guests read the entity view.
REVOKE ALL ON FUNCTION projects.get_cohort_offer (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION projects.get_cohort_offer (uuid) TO anon, authenticated, service_role;
-- Signed-in doors; each authorises the caller with auth.uid().
REVOKE ALL ON FUNCTION projects.reserve_seat (uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.reserve_seat (uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION projects.cancel_cohort_membership (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.cancel_cohort_membership (uuid) TO authenticated;
REVOKE ALL ON FUNCTION projects.record_host_attendance (uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.record_host_attendance (uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION projects.claim_session_no_show (uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.claim_session_no_show (uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION projects.session_join_link (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.session_join_link (uuid) TO authenticated;
REVOKE ALL ON FUNCTION projects.complete_lesson (uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.complete_lesson (uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION projects.get_session_workspace (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.get_session_workspace (uuid) TO authenticated;
-- Presence is the provider's signed webhook, through the app's service-role door — nobody else.
REVOKE ALL ON FUNCTION projects.record_presence (text, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION projects.record_presence (text, text, text, text, timestamptz, text) TO service_role;
-- The sweep pg_cron runs (as its owner); the service role may run it by hand.
REVOKE ALL ON FUNCTION finance.auto_release_session_escrow (timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.auto_release_session_escrow (timestamptz) TO service_role;
-- 1-1 sessions (Decision #211). fn_book_session_slot mints an engagement, a seat and per-sitting escrows
-- and debits whichever wallet it is handed, so only place_wallet_order reaches it; the helpers and the
-- trigger functions are internal; the handshake sweep is pg_cron's, and the service role's by hand.
REVOKE ALL ON FUNCTION projects.fn_session_engagement_for (uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_session_host_schedule (uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_settle_membership_state (uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_book_session_slot (uuid, uuid, text, uuid, bigint, integer, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.trg_sitting_follows_calendar () FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.trg_session_handshake_closed () FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.fn_lapse_session_handshakes (timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION projects.fn_lapse_session_handshakes (timestamptz) TO service_role;
-- Group sittings (00001155 §4c). The provider's two doors authorise the caller with auth.uid(); the
-- mirror count and the round guard are internal.
REVOKE ALL ON FUNCTION projects.schedule_sitting (uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.schedule_sitting (uuid, text, timestamptz, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION projects.retitle_sitting (uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.retitle_sitting (uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION projects.fn_sync_sitting_mirrors (uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.trg_sitting_round_guard () FROM PUBLIC, anon, authenticated, service_role;
-- #endregion

-- #region Disputes (00001260, Decision #212)
-- `finance` revokes PUBLIC by default (above); stated per function anyway. The internal steps move
-- money or skip the party check — reachable only from the doors that call them, as their owner.
REVOKE ALL ON FUNCTION finance.fn_dispute_context (uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_dispute_party (uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_dispute_review_by (timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_escrow_has_open_dispute (uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_dispute_attendance_audit (uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_split_seat_escrow (uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.fn_settle_dispute (uuid, text, integer, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_advance_dispute (uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_notify_dispute_escalated (uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_dispute_records_immutable () FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION finance.fn_guard_evidence_file () FROM PUBLIC, anon, authenticated, service_role;
-- Signed-in doors; each authorises the caller with auth.uid() (a party, or security.is_admin()).
REVOKE ALL ON FUNCTION finance.respond_to_dispute (uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.respond_to_dispute (uuid, text, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION finance.escalate_dispute (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.escalate_dispute (uuid) TO authenticated;
REVOKE ALL ON FUNCTION finance.get_dispute (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.get_dispute (uuid) TO authenticated;
REVOKE ALL ON FUNCTION finance.resolve_dispute (uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.resolve_dispute (uuid, text, integer, text) TO authenticated;
-- The operator queue: signed-in callers reach it, and it refuses anyone but security.is_admin() (42501).
REVOKE ALL ON FUNCTION finance.list_disputes_for_review (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance.list_disputes_for_review (text) TO authenticated;
-- The sweep pg_cron runs (as its owner); the service role may run it by hand.
REVOKE ALL ON FUNCTION finance.sweep_disputes (timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.sweep_disputes (timestamptz) TO service_role;
-- #endregion

-- #region ops — the job registry (00001650, Decision #203)
-- `ops` is exposed to PostgREST for ops.log_entries, so each of these would otherwise be an RPC. Only
-- the manual-run door is reachable, and only by the service role (`deno task cron:run`); pg_cron runs
-- the rest as their owner.
REVOKE ALL ON FUNCTION ops.fn_log_scheduler_event (text, text, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.fn_job_command (text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.fn_unschedule_job (text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.fn_schedule_job (text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.fn_touch_updated_at () FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.tg_scheduled_jobs_apply () FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.fn_dispatch_http_job (text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.fn_settle_http_dispatches () FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.fn_report_failed_runs () FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.fn_watch_jobs () FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.fn_prune_job_history (interval) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.run_job (text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.run_job (text) TO service_role;
-- #endregion

-- #region [contact] Contact requests (00001655, Decision #276)
-- The intake door is the one public RPC: a guest (`anon`) and a signed-in sender (`authenticated`)
-- both reach it, and it re-checks everything they send. The operator's status move is reachable by
-- a signed-in caller and refuses anyone but security.is_admin(). The reference generator and the
-- record guard run only inside them (as their owner), so no role holds them.
REVOKE ALL ON FUNCTION ops.fn_contact_reference () FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.fn_guard_contact_request () FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.submit_contact_request (text, text, boolean, jsonb, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.submit_contact_request (text, text, boolean, jsonb, uuid[]) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.set_contact_request_status (text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ops.set_contact_request_status (text, text) TO authenticated;
-- Remove on an unsent attachment: a signed-in sender, for their own files only (checked inside).
REVOKE ALL ON FUNCTION ops.discard_contact_attachment (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ops.discard_contact_attachment (uuid) TO authenticated, service_role;
-- The sweep's claim: the app's cron route only, as the service role.
REVOKE ALL ON FUNCTION ops.fn_claim_stale_contact_attachments (interval, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.fn_claim_stale_contact_attachments (interval, integer) TO service_role;
-- #endregion

-- #region Service instantiation (00001175, Decision #209)
-- `marketplace` has no deny-by-default sweep, so each function is stated. The three doors authorise the
-- caller with auth.uid() inside; the projection runs only inside them, as their owner.
REVOKE ALL ON FUNCTION marketplace.fn_service_draft_json (uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION marketplace.fn_service_draft_json (uuid) TO service_role;
REVOKE ALL ON FUNCTION marketplace.fn_plain_text_html (text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION marketplace.fn_plain_text_html (text) TO service_role;
REVOKE ALL ON FUNCTION marketplace.get_service_draft (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marketplace.get_service_draft (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION marketplace.instantiate_service_blueprint (uuid, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marketplace.instantiate_service_blueprint (uuid, jsonb, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION marketplace.archive_service_draft (text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marketplace.archive_service_draft (text, text) TO authenticated, service_role;
-- #endregion

-- #region Listing analytics and the client pipeline (Decision #217, C5)
-- The rollup writer and its backfill read every seller's interest, basket and order rows: the service
-- role and the job only. The pipeline is INVOKER and answers under the caller's own policies; its three
-- definer helpers answer only about listings the caller manages, so a signed-in caller may run them
-- and a guest may not.
REVOKE ALL ON FUNCTION analytics.fn_rollup_listings (date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION analytics.fn_rollup_listings (date) TO service_role;
REVOKE ALL ON FUNCTION analytics.fn_backfill_listing_rollups (date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION analytics.fn_backfill_listing_rollups (date, date) TO service_role;
REVOKE ALL ON FUNCTION catalogue.fn_manages_listing (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION catalogue.fn_manages_listing (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION catalogue.fn_candidate_listings (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION catalogue.fn_candidate_listings (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION catalogue.fn_seller_order_lines (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION catalogue.fn_seller_order_lines (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION catalogue.get_client_pipeline (uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION catalogue.get_client_pipeline (uuid, integer) TO authenticated, service_role;
-- #endregion

-- #region Entity channels (00001300, Decision #306)
-- The two doors are definers that write dm_threads / dm_participants (no client write policy), so the
-- grant is the access decision: signed-in callers only, each re-checking membership itself. The rest
-- are internals — the sync primitives write participant rows for whoever they are handed, and the list
-- answers for any viewer id — reached only from the doors, the triggers and org.get_workspace_detail.
REVOKE ALL ON FUNCTION comms.create_entity_channel (text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION comms.create_entity_channel (text, uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION comms.archive_entity_channel (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION comms.archive_entity_channel (uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION comms.update_entity_channel (uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION comms.update_entity_channel (uuid, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION comms.fn_can_manage_entity_channel (uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION comms.fn_channel_slug (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION comms.fn_channel_slug (text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION comms.fn_entity_member_ids (text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION comms.fn_entity_channel_list (text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION comms.fn_ensure_default_channel (text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION comms.fn_sync_channel_member (text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION comms.tg_entity_channel_seed_members () FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION comms.tg_entity_member_channels () FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION comms.tg_entity_default_channel () FROM PUBLIC, anon, authenticated;
-- #endregion
