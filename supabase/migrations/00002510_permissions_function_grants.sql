-- =============================================================================
-- FUNCTION EXECUTE GRANTS / REVOKES
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================

-- --- from 0200_permissions.sql ---

GRANT
EXECUTE ON ALL FUNCTIONS IN SCHEMA search TO anon,
authenticated,
service_role;

-- --- from 0217_search_engine_pgvector.sql ---

GRANT
EXECUTE ON FUNCTION search.fn_mock_embedding (text) TO authenticated,
service_role;

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
EXECUTE ON FUNCTION search.fn_search_entities (
    text,
    text,
    jsonb,
    text,
    integer,
    integer,
    uuid
) TO anon,
authenticated,
service_role;

GRANT
EXECUTE ON FUNCTION search.fn_search_global (text, uuid, integer) TO anon,
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
    uuid
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

-- --- from 0304_onboarding_session_and_audit.sql ---

GRANT
EXECUTE ON FUNCTION public.complete_onboarding (jsonb) TO authenticated;

-- --- from 0309_business_finance_overview.sql ---

-- #endregion

-- #region 6. Grants — expose the read/update RPCs to authenticated callers.
GRANT
EXECUTE ON FUNCTION org.get_business_finance (uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION org.get_business_members (uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION org.get_business_admin_profile (uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION org.update_business (uuid, jsonb) TO authenticated;

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

GRANT
EXECUTE ON FUNCTION org.enable_freelancer_profile (jsonb) TO authenticated;

-- --- from 0315_create_organisation_rpc.sql ---

-- Only the service-role backend provisions organisations (after admin-creating the owner identity).
GRANT
EXECUTE ON FUNCTION public.create_organisation (uuid, jsonb) TO service_role;

-- --- from 20260709120000_business_teams_overhaul.sql ---

GRANT
EXECUTE ON FUNCTION org.set_operator_mode (boolean) TO authenticated;

-- --- from 20260715120000_access_token_context_hook.sql ---

GRANT
EXECUTE ON FUNCTION security.switch_organisation_context (uuid) TO authenticated;

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

-- --- from 20260723092000_finance_payment_methods_money_movement.sql ---

GRANT
EXECUTE ON FUNCTION finance.fn_owner_visible (text, uuid) TO authenticated;

GRANT
EXECUTE ON FUNCTION finance.fn_can_view_wallet (uuid) TO authenticated;

-- --- from 20260723093000_finance_vault_governance.sql ---

GRANT
EXECUTE ON FUNCTION finance.fn_has_vault_capability (
    uuid,
    uuid,
    finance.vault_capability
) TO authenticated;

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
    timestamptz
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
GRANT EXECUTE ON FUNCTION finance.place_wallet_order(uuid, uuid[], text, jsonb, text, text) TO authenticated;

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

REVOKE ALL ON FUNCTION finance.fn_hold_ticket_escrow (uuid)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_release_ticket_escrow (uuid)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_refund_ticket_escrow (uuid)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_fair_exit_release (uuid, integer)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_split_team_payout (uuid, uuid, bigint, text)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_generate_consolidated_invoice (
    uuid,
    timestamptz,
    timestamptz
)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_check_spending_limit (uuid, uuid, bigint)
FROM authenticated;

REVOKE ALL ON FUNCTION finance.fn_seed_business_wallet ()
FROM authenticated;

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

-- --- freelancer removal (00001120: release_ticket_to_backlog) ---

-- 🚨 `projects.release_ticket_to_backlog` is SECURITY DEFINER, releases a ticket's held escrow to
-- its assignee and resets the ticket to New — and it carried the default PUBLIC EXECUTE with NO
-- caller check of its own, so any signed-in caller who knew a ticket id could pay out its escrow
-- and un-claim it (the `reorder_stages` class, Decision #84). It has no application caller: its
-- one reachable door is `projects.remove_project_member` (00001130), a DEFINER function whose
-- owner still executes it after this revoke, and which checks project ownership first.
REVOKE ALL ON FUNCTION projects.release_ticket_to_backlog (uuid)
FROM public, anon, authenticated;

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

-- files.fn_owns_library is a POLICY predicate (the items/folders INSERT and UPDATE checks), so like
-- fn_can_read it must stay executable by the roles those policies run as.
GRANT
EXECUTE ON FUNCTION files.fn_owns_library (files.owner_kind, uuid) TO anon,
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
REVOKE ALL ON FUNCTION catalogue.create_listing (text, text, text, uuid)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION catalogue.create_listing (text, text, text, uuid) TO authenticated,
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

-- --- the Project Details sidebar's Teams group (00001100: get_viewer_hired_teams) ---
--
-- Answers only about the caller's own team memberships, so it needs a signed-in caller; a guest has
-- no `auth.uid()` and would only ever read zero rows.
REVOKE ALL ON FUNCTION projects.get_viewer_hired_teams (uuid)
FROM public, anon;

GRANT
EXECUTE ON FUNCTION projects.get_viewer_hired_teams (uuid) TO authenticated;