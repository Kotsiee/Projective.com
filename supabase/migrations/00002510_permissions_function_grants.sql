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

GRANT EXECUTE ON FUNCTION search.fn_mock_embedding(text) TO authenticated, service_role;


-- --- from 0219_search_engine_weights.sql ---

GRANT EXECUTE ON FUNCTION search.is_admin(uuid) TO authenticated, service_role;


-- --- from 0220_search_engine_rpc.sql ---

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION search.fn_norm(double precision, double precision) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION search.fn_search_entities(text, text, jsonb, text, integer, integer, uuid) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION search.fn_search_global(text, uuid, integer) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION search.fn_log_query(text, text, jsonb, integer, integer, integer, uuid) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION search.fn_search_analytics(integer) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION search.fn_get_weights() TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION search.fn_set_weight(text, numeric) TO authenticated, service_role;


-- --- from 0304_onboarding_session_and_audit.sql ---

GRANT EXECUTE ON FUNCTION public.complete_onboarding(jsonb) TO authenticated;


-- --- from 0309_business_finance_overview.sql ---

-- #endregion

-- #region 6. Grants — expose the read/update RPCs to authenticated callers.
GRANT EXECUTE ON FUNCTION org.get_business_finance(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION org.get_business_members(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION org.get_business_admin_profile(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION org.update_business(uuid, jsonb) TO authenticated;


-- --- from 0311_e7_private_channels_pii_handover.sql ---

GRANT EXECUTE ON FUNCTION comms.can_access_scope(uuid, uuid, text) TO authenticated;

GRANT EXECUTE ON FUNCTION comms.has_channel_access(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION comms.get_stage_channels(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION projects.is_protected_phase(uuid) TO authenticated;


-- --- from 0313_freelancer_conversion.sql ---

GRANT EXECUTE ON FUNCTION org.enable_freelancer_profile(jsonb) TO authenticated;


-- --- from 0315_create_organisation_rpc.sql ---

-- Only the service-role backend provisions organisations (after admin-creating the owner identity).
GRANT EXECUTE ON FUNCTION public.create_organisation(uuid, jsonb) TO service_role;


-- --- from 20260709120000_business_teams_overhaul.sql ---

GRANT EXECUTE ON FUNCTION org.set_operator_mode(boolean) TO authenticated;


-- --- from 20260715120000_access_token_context_hook.sql ---

GRANT EXECUTE ON FUNCTION security.switch_organisation_context(uuid) TO authenticated;

-- Only the GoTrue admin role may run the hook; no client role may.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;


-- --- from 20260723091000_finance_verification_kyc.sql ---

GRANT EXECUTE ON FUNCTION finance.fn_freelancer_payout_ready(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_business_kyb_verified(uuid) TO authenticated;


-- --- from 20260723092000_finance_payment_methods_money_movement.sql ---

GRANT EXECUTE ON FUNCTION finance.fn_owner_visible(text, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_can_view_wallet(uuid) TO authenticated;


-- --- from 20260723093000_finance_vault_governance.sql ---

GRANT EXECUTE ON FUNCTION finance.fn_has_vault_capability(uuid, uuid, finance.vault_capability) TO authenticated;


-- --- from 20260724094000_comms_notification_rls_jobs.sql ---

-- #endregion

-- #region 7. Function grants
GRANT EXECUTE ON FUNCTION comms.mark_notifications_read(uuid[]) TO authenticated;

GRANT EXECUTE ON FUNCTION comms.mark_all_notifications_read(comms.notification_category) TO authenticated;

GRANT EXECUTE ON FUNCTION comms.mark_notifications_seen() TO authenticated;

GRANT EXECUTE ON FUNCTION comms.archive_notifications(uuid[]) TO authenticated;

GRANT EXECUTE ON FUNCTION comms.get_notification_summary() TO authenticated;

GRANT EXECUTE ON FUNCTION comms.register_device(text, comms.device_platform, text, text, text, text, text, text) TO authenticated;

GRANT EXECUTE ON FUNCTION comms.revoke_device(uuid, text) TO authenticated;

GRANT EXECUTE ON FUNCTION comms.fn_resolve_type_key(text) TO authenticated;

-- The writer, the router and the schedulers are NOT granted to `authenticated`. A client that could
-- call fn_notify could spoof any notification to any user; a client that could call fn_process_queue
-- could force-send every pending reminder.
GRANT EXECUTE ON FUNCTION comms.fn_notify(uuid, text, text, text, text, uuid, jsonb, uuid, text, uuid, text, text, comms.notification_urgency, timestamptz) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_notify_many(uuid[], text, text, text, text, uuid, jsonb, uuid, text, uuid, text) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_enqueue(uuid, text, text, text, timestamptz, text, text, uuid, jsonb, text, uuid, uuid, text, text) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_cancel_queued(text, text, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_process_queue(integer) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_is_quiet_hours(uuid, timestamptz) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_resolve_channels(uuid, text) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_is_suppressed(comms.notification_channel, text, comms.notification_category) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_escalate_unread(integer) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_build_digests(comms.digest_frequency) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_sweep_expired() TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_reap_dead_devices(smallint) TO service_role;

GRANT EXECUTE ON FUNCTION comms.fn_compact_delivery_events(interval) TO service_role;


-- --- from 20260724100000_scheduling_schema_availability.sql ---

GRANT EXECUTE ON FUNCTION scheduling.fn_owner_visible(scheduling.owner_type, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION scheduling.fn_owner_manages(scheduling.owner_type, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION scheduling.fn_can_view_schedule(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION scheduling.fn_can_manage_schedule(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION scheduling.fn_schedule_is_public(uuid) TO anon,
authenticated;


-- --- from 20260724101000_integrations_connections.sql ---

GRANT
EXECUTE ON FUNCTION integrations.fn_has_capability (uuid, integrations.provider_kind) TO authenticated;

GRANT
EXECUTE ON FUNCTION integrations.fn_conferencing_provider (uuid) TO authenticated;


-- --- from 20260724102000_scheduling_events.sql ---

GRANT
EXECUTE ON FUNCTION scheduling.fn_has_conflicting_event (uuid, timestamptz, timestamptz) TO anon,
authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_is_blacked_out (uuid, timestamptz, timestamptz) TO anon,
authenticated;


-- --- from 20260724103000_scheduling_discovery_calls.sql ---

GRANT
EXECUTE ON FUNCTION scheduling.fn_is_call_party (uuid) TO authenticated;


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
EXECUTE ON FUNCTION scheduling.fn_call_window_covers (uuid, timestamptz, timestamptz) TO anon,
authenticated;

GRANT
EXECUTE ON FUNCTION scheduling.fn_slot_is_free (uuid, timestamptz, timestamptz) TO anon,
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

GRANT EXECUTE ON FUNCTION analytics.fn_subject_visible(analytics.subject_kind, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION analytics.fn_emit(
    text, analytics.subject_kind, uuid, jsonb, numeric, uuid, text, uuid
) TO authenticated;


-- --- from 20260724111000_standing_reputation.sql ---

GRANT EXECUTE ON FUNCTION org.fn_level_for_score(numeric, integer) TO authenticated;

GRANT EXECUTE ON FUNCTION org.fn_standing_level(org.standing_subject, uuid) TO authenticated;

-- Mutating functions stay service-role/definer-callable only: Standing is EARNED, never client-written.
REVOKE ALL ON FUNCTION org.fn_recompute_standing(org.standing_subject, uuid) FROM public;

REVOKE ALL ON FUNCTION org.fn_award_achievement(org.standing_subject, uuid, text, uuid) FROM public;

REVOKE ALL ON FUNCTION org.fn_touch_streak(org.standing_subject, uuid, org.streak_kind, boolean) FROM public;

REVOKE ALL ON FUNCTION org.fn_record_mastery(org.standing_subject, uuid, org.create_category, numeric, boolean) FROM public;

GRANT EXECUTE ON FUNCTION org.fn_recompute_standing(org.standing_subject, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION org.fn_award_achievement(org.standing_subject, uuid, text, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION org.fn_touch_streak(org.standing_subject, uuid, org.streak_kind, boolean) TO service_role;

GRANT EXECUTE ON FUNCTION org.fn_record_mastery(org.standing_subject, uuid, org.create_category, numeric, boolean) TO service_role;


-- --- from 20260724113000_entitlements_allowances_enforcement.sql ---

GRANT EXECUTE ON FUNCTION finance.fn_audience_for(text) TO authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_active_plan(text, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_subject_standing_level(text, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_effective_limit(text, uuid, finance.entitlement_key) TO authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_has_entitlement(text, uuid, finance.entitlement_key) TO authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_effective_commission_bp(text, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_effective_platform_fee_bp(text, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_current_allowance(text, uuid, finance.entitlement_key) TO authenticated;

REVOKE ALL ON FUNCTION finance.fn_consume_allowance(text, uuid, integer, finance.entitlement_key, text, text, uuid) FROM public;

REVOKE ALL ON FUNCTION finance.fn_refund_allowance(text, uuid, integer, finance.entitlement_key, text, text, uuid) FROM public;

GRANT EXECUTE ON FUNCTION finance.fn_consume_allowance(text, uuid, integer, finance.entitlement_key, text, text, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION finance.fn_refund_allowance(text, uuid, integer, finance.entitlement_key, text, text, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION finance.fn_footprint_usage(text, uuid, finance.entitlement_key) TO authenticated;

GRANT EXECUTE ON FUNCTION finance.fn_footprint_remaining(text, uuid, finance.entitlement_key) TO authenticated;
