-- =============================================================================================
-- Probe: age policy v2 (Decision #208) — under 13 leaves nothing behind; a restricted (13–17) account
-- creates and joins no team, business or organisation, opens no payout account, schedules nothing
-- with other people, is not profiled, does not broadcast its location, stays unlisted, and messages
-- only people it follows who follow it back; anyone may create a personal project.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/age_policy_v2.sql
--
-- Every refusal is caught by its SQLSTATE; a clean run prints only PASS.
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_kid uuid := gen_random_uuid();
    v_teen uuid := gen_random_uuid();
    v_adult uuid := gen_random_uuid();
    v_tag text := substr(md5(random()::text), 1, 8);
    v_progress jsonb;
    v_profile jsonb;
    v_thread uuid;
    v_project jsonb;
    v_rows integer;
BEGIN
    -- #region Fixture: a profile-less identity (an OAuth sign-up), a 16-year-old and an adult
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    SELECT u, 'v2-probe-' || u || '@projective.invalid', 'authenticated', 'authenticated', '{}'::jsonb, now()
      FROM unnest(ARRAY[v_kid, v_teen, v_adult]) AS u;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teen, 'role', 'authenticated')::text, true);
    PERFORM public.complete_onboarding(jsonb_build_object(
        'username', 'v2probe_teen_' || v_tag, 'dob', (CURRENT_DATE - interval '16 years')::date, 'timezone', 'UTC'));
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role', 'authenticated')::text, true);
    PERFORM public.complete_onboarding(jsonb_build_object(
        'username', 'v2probe_adult_' || v_tag, 'dob', (CURRENT_DATE - interval '30 years')::date, 'timezone', 'UTC'));
    UPDATE org.users_public SET city = 'Leeds', country = 'GB' WHERE user_id IN (v_teen, v_adult);
    -- #endregion

    -- #region Under 13: the identity is deleted, and nothing else can be
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role', 'authenticated')::text, true);
    IF public.discard_underage_signup((CURRENT_DATE - interval '12 years')::date, 'UTC') THEN
        RAISE EXCEPTION 'FAIL an onboarded account was discarded';
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_kid, 'role', 'authenticated')::text, true);
    IF public.discard_underage_signup((CURRENT_DATE - interval '14 years')::date, 'UTC')
       OR public.discard_underage_signup((CURRENT_DATE + 1), 'UTC') THEN
        RAISE EXCEPTION 'FAIL a 14-year-old or future date discarded an identity';
    END IF;
    IF NOT public.discard_underage_signup((CURRENT_DATE - interval '12 years')::date, 'UTC') THEN
        RAISE EXCEPTION 'FAIL the under-13 discard refused';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_kid) THEN
        RAISE NOTICE 'PASS an under-13 OAuth sign-up is deleted with its email; adults and real ages are untouched';
    ELSE
        RAISE EXCEPTION 'FAIL the under-13 identity survived';
    END IF;
    -- #endregion

    -- #region Teams, businesses, payout accounts
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teen, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM org.create_workspace('business', 'Teen Ventures', 'v2probe-biz-' || v_tag);
        RAISE EXCEPTION 'FAIL a 16-year-old created a business';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old cannot create a team or business (PM403)';
    END;
    BEGIN
        INSERT INTO org.team_members (team_id, user_id, role, status)
        SELECT t.id, v_teen, 'member', 'active' FROM org.teams t LIMIT 1;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows = 0 THEN
            RAISE NOTICE 'SKIP no seeded team to join';
        ELSE
            RAISE EXCEPTION 'FAIL a 16-year-old joined a team';
        END IF;
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old cannot be made a team member, by any path (PM403)';
    END;
    BEGIN
        PERFORM finance.record_payout_account('personal', NULL, 'acct_v2probe');
        RAISE EXCEPTION 'FAIL a 16-year-old recorded a payout account';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old cannot open a payout account (PM403)';
    END;
    -- #endregion

    -- #region Scheduling
    INSERT INTO scheduling.schedules (owner_type, owner_id) VALUES ('user', v_teen);
    BEGIN
        UPDATE scheduling.schedules SET is_published = true WHERE owner_type = 'user' AND owner_id = v_teen;
        RAISE EXCEPTION 'FAIL a 16-year-old published working hours';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old keeps a private calendar but cannot publish hours (PM403)';
    END;
    BEGIN
        INSERT INTO scheduling.call_settings (schedule_id, accepts_calls)
        SELECT s.id, true FROM scheduling.schedules s WHERE s.owner_type = 'user' AND s.owner_id = v_teen;
        RAISE EXCEPTION 'FAIL a 16-year-old took discovery calls';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old cannot take discovery calls (PM403)';
    END;
    BEGIN
        PERFORM scheduling.request_discovery_call(gen_random_uuid(), 'courtesy', now() + interval '1 day',
            now() + interval '1 day 30 minutes', NULL, 'UTC', NULL, NULL);
        RAISE EXCEPTION 'FAIL a 16-year-old booked a call';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old cannot book a discovery call (PM403)';
    END;
    BEGIN
        PERFORM projects.reserve_seat(gen_random_uuid(), 1);
        RAISE EXCEPTION 'FAIL a 16-year-old held a session seat';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old cannot hold a session seat (PM403)';
    END;

    v_progress := org.fn_compute_profile_setup_progress(v_teen);
    IF v_progress -> 'not_applicable_keys' = '["working_hours"]'::jsonb
       AND v_progress ->> 'next_suggested_action' IS DISTINCT FROM 'publish_hours'
       AND v_progress ->> 'next_suggested_action' IS DISTINCT FROM 'become_partner' THEN
        RAISE NOTICE 'PASS setup progress: working hours do not apply to a minor (%)', v_progress;
    ELSE
        RAISE EXCEPTION 'FAIL setup progress for a minor: %', v_progress;
    END IF;
    -- #endregion

    -- #region Privacy: no profiling, no location, unlisted only
    PERFORM search.record_view('user', v_adult, '{}');
    IF NOT EXISTS (SELECT 1 FROM org.recent_views WHERE user_id = v_teen) THEN
        RAISE NOTICE 'PASS a 16-year-old''s views are not recorded';
    ELSE
        RAISE EXCEPTION 'FAIL a minor''s viewing history was kept';
    END IF;
    INSERT INTO search.interest_events (user_id, event_type, entity_type, entity_id)
    VALUES (v_teen, 'click', 'user', v_adult);
    IF NOT EXISTS (SELECT 1 FROM search.interest_events WHERE user_id = v_teen) THEN
        RAISE NOTICE 'PASS a 16-year-old''s interest events are dropped';
    ELSE
        RAISE EXCEPTION 'FAIL a minor''s interest event was stored';
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role', 'authenticated')::text, true);
    v_profile := org.get_profile_view('v2probe_teen_' || v_tag);
    IF v_profile IS NOT NULL AND (v_profile ->> 'city') IS NULL AND (v_profile ->> 'country') IS NULL
       AND (v_profile ->> 'timezone') IS NULL
       AND (SELECT city IS NULL AND location IS NULL AND timezone IS NULL FROM org.profiles_index WHERE entity_id = v_teen) THEN
        RAISE NOTICE 'PASS a 16-year-old''s location and local time are hidden from others';
    ELSE
        RAISE EXCEPTION 'FAIL a minor''s location was broadcast: %', v_profile;
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teen, 'role', 'authenticated')::text, true);
    IF (org.get_profile_view('v2probe_teen_' || v_tag) ->> 'city') = 'Leeds' THEN
        RAISE NOTICE 'PASS the owner still sees their own location';
    ELSE
        RAISE EXCEPTION 'FAIL the owner lost their own location';
    END IF;
    BEGIN
        UPDATE org.users_public SET visibility = 'public' WHERE user_id = v_teen;
        RAISE EXCEPTION 'FAIL a 16-year-old''s profile went public';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old''s profile stays unlisted (PM403)';
    END;
    -- #endregion

    -- #region Direct messages: mutual follows only
    BEGIN
        PERFORM comms.get_or_create_dm_thread(v_adult);
        RAISE EXCEPTION 'FAIL a 16-year-old opened a DM with a stranger';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a 16-year-old cannot open a DM with someone who is not a mutual follow (PM403)';
    END;
    INSERT INTO org.profile_follows (follower_user_id, target_entity_type, target_entity_id)
    VALUES (v_teen, 'user', v_adult), (v_adult, 'user', v_teen);
    v_thread := comms.get_or_create_dm_thread(v_adult);
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
    VALUES (v_thread, v_teen, 'hi');
    RAISE NOTICE 'PASS mutual follows may message';
    DELETE FROM org.profile_follows WHERE follower_user_id = v_adult AND target_entity_id = v_teen;
    BEGIN
        INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
        VALUES (v_thread, v_adult, 'still there?');
        RAISE EXCEPTION 'FAIL a message went through after the follow ended';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS an unfollow ends the conversation (PM403)';
    END;
    -- #endregion

    -- #region Personal projects for everyone
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role', 'authenticated')::text, true);
    v_project := projects.create_project(jsonb_build_object(
        'title', 'Home renovation', 'format', 'pipeline', 'currency', 'GBP', 'is_personal', true));
    IF (SELECT is_personal AND visibility = 'invite_only' FROM projects.projects WHERE id = (v_project ->> 'id')::uuid) THEN
        RAISE NOTICE 'PASS an adult can choose a personal project';
    ELSE
        RAISE EXCEPTION 'FAIL the personal choice was ignored';
    END IF;
    -- #endregion
END;
$$;

ROLLBACK;
