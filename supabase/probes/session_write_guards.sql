-- =============================================================================================
-- Probe: session write guards and https-only join links (SCHEDULING_COMPLETENESS_AUDIT S-01, S-30).
--
--   1. A session's owner cannot write its sittings, cohorts or seats (no client INSERT / UPDATE /
--      DELETE on projects.session_events, cohorts, cohort_memberships, 00002520): the payout sweep
--      releases a held escrow on a sitting's status and end_time, so a writable sitting was a way
--      to be paid for a session that never happened.
--   2. A meeting or join URL is https or nothing (ck_event_meeting_url_https,
--      ck_call_meeting_url_https, ck_session_events_join_urls_https) — for a schedule's owner
--      writing their own event, and for every role.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/session_write_guards.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts (non-zero exit under
-- ON_ERROR_STOP). The seed has no cohorts, so one is built on a seeded project, with one seat held
-- by somebody other than its owner and one sitting two days ahead.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_project uuid; v_stage uuid; v_owner uuid; v_buyer uuid; v_cohort uuid; v_sitting uuid;
    v_schedule uuid;
BEGIN
    SELECT p.id, p.owner_user_id, s.id INTO v_project, v_owner, v_stage
      FROM projects.projects p
      JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id IS NOT NULL
     ORDER BY p.id, s.id LIMIT 1;
    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE u.user_id <> v_owner ORDER BY u.user_id LIMIT 1;
    IF v_project IS NULL OR v_buyer IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a seeded project with a stage and a second user (deno task db:reset)';
    END IF;

    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (v_project, v_stage, 'Probe cohort') RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_buyer);
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, host_join_url)
    VALUES (v_cohort, 'Probe sitting', now() + interval '2 days', now() + interval '2 days 1 hour',
            'https://host.example/probe')
    RETURNING id INTO v_sitting;

    INSERT INTO scheduling.schedules (owner_type, owner_id)
    VALUES ('user', v_owner)
    ON CONFLICT (owner_type, owner_id) DO NOTHING;
    SELECT id INTO v_schedule FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_owner;

    PERFORM set_config('probe.owner', v_owner::text, true);
    PERFORM set_config('probe.cohort', v_cohort::text, true);
    PERFORM set_config('probe.sitting', v_sitting::text, true);
    PERFORM set_config('probe.schedule', v_schedule::text, true);
END $$;
-- #endregion

-- #region 1. The session's owner (authenticated)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM projects.session_events WHERE id = current_setting('probe.sitting')::uuid;
    IF n <> 1 THEN RAISE EXCEPTION 'FAIL fixture: the owner cannot read their own sitting'; END IF;
    RAISE NOTICE 'PASS the owner still reads their sitting';

    BEGIN
        UPDATE projects.session_events
           SET status = 'completed', start_time = now() - interval '26 hours', end_time = now() - interval '25 hours'
         WHERE id = current_setting('probe.sitting')::uuid;
        RAISE EXCEPTION 'FAIL the owner marked a future sitting completed in the past (self-payout)';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS sitting UPDATE refused [%]', SQLERRM;
    END;

    BEGIN
        DELETE FROM projects.session_events WHERE id = current_setting('probe.sitting')::uuid;
        RAISE EXCEPTION 'FAIL the owner deleted a sitting';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS sitting DELETE refused [%]', SQLERRM;
    END;

    BEGIN
        INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
        VALUES (current_setting('probe.cohort')::uuid, 'Probe extra', now() - interval '2 hours', now() - interval '1 hour');
        RAISE EXCEPTION 'FAIL the owner inserted a sitting';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS sitting INSERT refused [%]', SQLERRM;
    END;

    BEGIN
        UPDATE projects.cohort_memberships SET status = 'cancelled'
         WHERE cohort_id = current_setting('probe.cohort')::uuid;
        RAISE EXCEPTION 'FAIL the owner rewrote a buyer''s seat';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS seat UPDATE refused [%]', SQLERRM;
    END;

    BEGIN
        UPDATE projects.cohorts SET status = 'completed' WHERE id = current_setting('probe.cohort')::uuid;
        RAISE EXCEPTION 'FAIL the owner rewrote a cohort';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS cohort UPDATE refused [%]', SQLERRM;
    END;

    -- Their own calendar entry: an https room is fine, a javascript: one is not.
    INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at, meeting_provider, meeting_url)
    VALUES (current_setting('probe.schedule')::uuid, 'sync', 'confirmed', 'Probe sync',
            now() + interval '3 days', now() + interval '3 days 30 minutes', 'custom', 'https://meet.example/room');
    RAISE NOTICE 'PASS the schedule owner stores an https room';

    BEGIN
        INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at, meeting_provider, meeting_url)
        VALUES (current_setting('probe.schedule')::uuid, 'sync', 'confirmed', 'Probe sync',
                now() + interval '4 days', now() + interval '4 days 30 minutes', 'custom', 'javascript:alert(document.cookie)');
        RAISE EXCEPTION 'FAIL the schedule owner stored a javascript: room';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS javascript: room refused [%]', SQLERRM;
    END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 2. Every role: join URLs are https or nothing
DO $$
DECLARE v_call uuid;
BEGIN
    BEGIN
        UPDATE projects.session_events SET attendee_join_url = 'javascript:alert(1)'
         WHERE id = current_setting('probe.sitting')::uuid;
        RAISE EXCEPTION 'FAIL a javascript: attendee join URL was stored';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS javascript: attendee join URL refused [%]', SQLERRM;
    END;

    UPDATE projects.session_events SET attendee_join_url = 'https://attendee.example/probe'
     WHERE id = current_setting('probe.sitting')::uuid;
    RAISE NOTICE 'PASS an https attendee join URL is stored';

    SELECT id INTO v_call FROM scheduling.discovery_calls ORDER BY id LIMIT 1;
    IF v_call IS NULL THEN
        RAISE NOTICE 'SKIP no seeded discovery call to test ck_call_meeting_url_https against';
    ELSE
        BEGIN
            UPDATE scheduling.discovery_calls SET meeting_url = 'https://room.example/a b' WHERE id = v_call;
            RAISE EXCEPTION 'FAIL a call meeting URL with whitespace was stored';
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS call meeting URL with whitespace refused [%]', SQLERRM;
        END;
        BEGIN
            UPDATE scheduling.discovery_calls SET meeting_url = 'data:text/html,<script>1</script>' WHERE id = v_call;
            RAISE EXCEPTION 'FAIL a data: call meeting URL was stored';
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS data: call meeting URL refused [%]', SQLERRM;
        END;
    END IF;
END $$;
-- #endregion

ROLLBACK;
