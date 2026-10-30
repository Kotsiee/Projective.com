-- =============================================================================================
-- Probe: the group-sitting doors and their calendar mirror (SCHEDULING_COMPLETENESS_AUDIT D0, S-05).
--
--   1. projects.schedule_sitting — only the cohort's host, only a GROUP cohort, a real span in the
--      future, a free time on the provider's calendar; it writes the sitting AND a roster-less mirror
--      on the provider's schedule, anchored to the engagement, so the mirror occupies free/busy and
--      the slot predicate every booking gate asks (fn_slot_is_free).
--   2. No client writes the mirror (it is anchored to the engagement), and no reschedule round —
--      vote or 1-on-1 — opens on a group sitting's mirror, for the service role too
--      (trg_sitting_round_guard). A 1-1 sitting's mirror still takes a 1-on-1 round.
--   3. Once a seat is taken, a new sitting may not start before the cohort's first sitting (a seat is
--      refunded or forfeited against it), nor — with no sitting yet — inside the cancellation notice.
--   4. The mirrors' attendee_count follows the paid seats (fn_sync_sitting_mirrors), on a new sitting
--      and on a cancelled seat.
--   5. projects.retitle_sitting renames the sitting and its mirror, for the host only.
--   6. Grants: the two doors are signed-in only; the helpers are nobody's.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/group_sitting_doors.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts (non-zero exit under
-- ON_ERROR_STOP). The seed has no group engagement, so one is built for a seeded provider who
-- publishes a personal schedule: a group cohort of ten seats, and a 1-1 cohort beside it.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

-- #region 0. Fixtures (as postgres)
-- The first start at or after p_after, on the hour, that the provider's calendar has free for p_mins.
CREATE FUNCTION pg_temp.free_after(p_schedule uuid, p_after timestamptz, p_mins integer)
RETURNS timestamptz LANGUAGE plpgsql AS $$
DECLARE t timestamptz := date_trunc('hour', p_after) + interval '1 hour';
BEGIN
    FOR i IN 1 .. 2000 LOOP
        IF scheduling.fn_slot_is_free(p_schedule, t, t + make_interval(mins => p_mins)) THEN
            RETURN t;
        END IF;
        t := t + interval '1 hour';
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: no free hour on schedule %', p_schedule;
END $$;

DO $$
DECLARE
    v_host uuid; v_schedule uuid; v_buyer uuid; v_outsider uuid;
    v_group uuid; v_group_stage uuid; v_cohort uuid; v_cohort_sold uuid;
    v_one uuid; v_one_stage uuid; v_one_cohort uuid; v_one_sitting uuid; v_one_mirror uuid;
BEGIN
    SELECT s.owner_id, s.id INTO v_host, v_schedule
      FROM scheduling.schedules s
     WHERE s.owner_type = 'user' AND scheduling.fn_schedule_is_public(s.id)
     ORDER BY s.id LIMIT 1;
    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE u.user_id <> v_host AND NOT org.fn_is_minor(u.user_id) ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_outsider FROM org.users_public u
     WHERE u.user_id NOT IN (v_host, v_buyer) AND NOT org.fn_is_minor(u.user_id) ORDER BY u.user_id LIMIT 1;
    IF v_schedule IS NULL OR v_buyer IS NULL OR v_outsider IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a published personal schedule and two more adults (deno task db:reset)';
    END IF;

    INSERT INTO projects.projects (owner_user_id, title, format, session_kind, status, visibility, publish_visibility)
    VALUES (v_host, 'Probe group session', 'session', 'group', 'active', 'unlisted', 'unlisted')
    RETURNING id INTO v_group;
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_group, 'Sessions', 0)
    RETURNING id INTO v_group_stage;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_group, v_group_stage, 'Probe cohort', 10, 'enrolling') RETURNING id INTO v_cohort;
    -- A second group cohort with a seat already sold and no sitting yet.
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_group, v_group_stage, 'Probe sold cohort', 10, 'enrolling') RETURNING id INTO v_cohort_sold;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id, seats, status)
    VALUES (v_cohort_sold, v_buyer, 1, 'active');

    -- A 1-1 engagement with one booked sitting and its rostered mirror, as fn_book_session_slot leaves them.
    INSERT INTO projects.projects (owner_user_id, title, format, session_kind, status, visibility, publish_visibility)
    VALUES (v_host, 'Probe 1-1 session', 'session', 'normal', 'active', 'unlisted', 'unlisted')
    RETURNING id INTO v_one;
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_one, 'Sessions', 0)
    RETURNING id INTO v_one_stage;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_one, v_one_stage, 'Probe 1-1', 1, 'active') RETURNING id INTO v_one_cohort;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_one_cohort, 'Probe 1-1 sitting', now() + interval '40 days', now() + interval '40 days 1 hour')
    RETURNING id INTO v_one_sitting;
    INSERT INTO scheduling.events (schedule_id, project_id, kind, status, title, starts_at, ends_at,
                                   attendee_count, capacity, source_session_event_id, created_by)
    VALUES (v_schedule, v_one, 'session', 'confirmed', 'Probe 1-1 sitting', now() + interval '40 days',
            now() + interval '40 days 1 hour', 1, 1, v_one_sitting, v_host)
    RETURNING id INTO v_one_mirror;
    INSERT INTO scheduling.event_attendees (event_id, user_id, role, response)
    VALUES (v_one_mirror, v_host, 'host', 'accepted'), (v_one_mirror, v_buyer, 'participant', 'accepted');

    PERFORM set_config('probe.host', v_host::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.outsider', v_outsider::text, true);
    PERFORM set_config('probe.schedule', v_schedule::text, true);
    PERFORM set_config('probe.group', v_group::text, true);
    PERFORM set_config('probe.cohort', v_cohort::text, true);
    PERFORM set_config('probe.cohort_sold', v_cohort_sold::text, true);
    PERFORM set_config('probe.one_cohort', v_one_cohort::text, true);
    PERFORM set_config('probe.one_mirror', v_one_mirror::text, true);
    PERFORM set_config('probe.t1', pg_temp.free_after(v_schedule, now() + interval '20 days', 60)::text, true);
END $$;

-- #endregion

-- #region 1. The door: who, what and when (as the outsider, then the host)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.outsider'), 'role', 'authenticated')::text, true);

DO $$
DECLARE t1 timestamptz := current_setting('probe.t1')::timestamptz;
BEGIN
    BEGIN
        PERFORM projects.schedule_sitting(current_setting('probe.cohort')::uuid, 'Week 1', t1, t1 + interval '1 hour');
        RAISE EXCEPTION 'FAIL someone who does not host the cohort scheduled a sitting on it';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a non-host is refused [%]', SQLERRM;
    END;
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.host'), 'role', 'authenticated')::text, true);

DO $$
DECLARE
    t1 timestamptz := current_setting('probe.t1')::timestamptz;
    v_cohort uuid := current_setting('probe.cohort')::uuid;
    r jsonb;
    n int;
BEGIN
    BEGIN
        PERFORM projects.schedule_sitting(v_cohort, '   ', t1, t1 + interval '1 hour');
        RAISE EXCEPTION 'FAIL a blank title was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS a blank title is refused [%]', SQLERRM;
    END;
    BEGIN
        PERFORM projects.schedule_sitting(v_cohort, 'Marathon', t1, t1 + interval '25 hours');
        RAISE EXCEPTION 'FAIL a 25-hour sitting was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS a span over 24 hours is refused [%]', SQLERRM;
    END;
    BEGIN
        PERFORM projects.schedule_sitting(v_cohort, 'Yesterday', now() - interval '1 day', now() - interval '23 hours');
        RAISE EXCEPTION 'FAIL a sitting in the past was accepted (a sweep would complete it at once)';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS a start that has passed is refused [%]', SQLERRM;
    END;
    BEGIN
        PERFORM projects.schedule_sitting(current_setting('probe.one_cohort')::uuid, 'Extra', t1, t1 + interval '1 hour');
        RAISE EXCEPTION 'FAIL a sitting was added to a 1-1 booking''s cohort';
    EXCEPTION WHEN SQLSTATE 'PU422' THEN
        RAISE NOTICE 'PASS a 1-1 cohort takes no extra sitting [%]', SQLERRM;
    END;

    r := projects.schedule_sitting(v_cohort, '  Week 1: kickoff ', t1, t1 + interval '1 hour');
    PERFORM set_config('probe.sitting', r ->> 'sitting_id', true);
    PERFORM set_config('probe.mirror', r ->> 'calendar_event_id', true);
    IF r ->> 'title' <> 'Week 1: kickoff' OR (r ->> 'slug') !~ '^ssn-' OR r ->> 'calendar_event_id' IS NULL THEN
        RAISE EXCEPTION 'FAIL schedule_sitting answered %', r;
    END IF;
    RAISE NOTICE 'PASS the host schedules a sitting [%]', r ->> 'slug';

    BEGIN
        PERFORM projects.schedule_sitting(v_cohort, 'Clash', t1 + interval '30 minutes', t1 + interval '90 minutes');
        RAISE EXCEPTION 'FAIL a sitting was scheduled on top of another one';
    EXCEPTION WHEN SQLSTATE 'PS409' THEN
        RAISE NOTICE 'PASS a time that is not free is refused [%]', SQLERRM;
    END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 2. The mirror: on the calendar, in free/busy, rosterless (as postgres, then anon)
DO $$
DECLARE
    t1 timestamptz := current_setting('probe.t1')::timestamptz;
    ev scheduling.events;
    n int;
BEGIN
    SELECT * INTO ev FROM scheduling.events WHERE id = current_setting('probe.mirror')::uuid;
    IF ev.source_session_event_id IS DISTINCT FROM current_setting('probe.sitting')::uuid
       OR ev.schedule_id IS DISTINCT FROM current_setting('probe.schedule')::uuid
       OR ev.project_id IS DISTINCT FROM current_setting('probe.group')::uuid
       OR ev.kind <> 'session' OR ev.status IS DISTINCT FROM 'confirmed'
       OR ev.starts_at <> t1 OR ev.ends_at <> t1 + interval '1 hour' OR ev.capacity IS DISTINCT FROM 10 THEN
        RAISE EXCEPTION 'FAIL the mirror is not the sitting on the provider''s calendar: %', row_to_json(ev);
    END IF;
    RAISE NOTICE 'PASS the sitting is mirrored onto the provider''s schedule and engagement';

    SELECT count(*) INTO n FROM scheduling.event_attendees WHERE event_id = ev.id;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL the group mirror carries a roster of % (a vote''s electorate)', n; END IF;
    RAISE NOTICE 'PASS the group mirror carries no roster';

    IF scheduling.fn_slot_is_free(ev.schedule_id, t1 + interval '15 minutes', t1 + interval '45 minutes') THEN
        RAISE EXCEPTION 'FAIL the booking gates still read the sitting''s time as free';
    END IF;
    RAISE NOTICE 'PASS fn_slot_is_free (both booking gates) sees the sitting';
END $$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
DO $$
DECLARE t1 timestamptz := current_setting('probe.t1')::timestamptz; n int;
BEGIN
    SELECT count(*) INTO n
      FROM scheduling.get_free_busy(current_setting('probe.schedule')::uuid, t1 - interval '1 hour', t1 + interval '2 hours') fb
     WHERE fb.starts_at = t1 AND fb.ends_at = t1 + interval '1 hour';
    IF n <> 1 THEN RAISE EXCEPTION 'FAIL a visitor''s free/busy does not show the sitting (% spans)', n; END IF;
    RAISE NOTICE 'PASS a visitor''s free/busy shows the sitting as busy';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 3. Nobody moves a group sitting
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.host'), 'role', 'authenticated')::text, true);
DO $$
DECLARE n int;
BEGIN
    UPDATE scheduling.events SET starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day'
     WHERE id = current_setting('probe.mirror')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL the host moved a group sitting''s mirror directly'; END IF;
    RAISE NOTICE 'PASS the host cannot write the mirror (anchored to the engagement, no client policy)';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SET LOCAL ROLE service_role;
DO $$
DECLARE v_round uuid; v_plain uuid;
BEGIN
    BEGIN
        INSERT INTO scheduling.event_reschedules (event_id, round, mode, status, opened_by_user_id, opened_at)
        VALUES (current_setting('probe.mirror')::uuid, 0, 'vote', 'collecting', current_setting('probe.host')::uuid, now());
        RAISE EXCEPTION 'FAIL a vote was opened on a group sitting';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        RAISE NOTICE 'PASS no vote opens on a group sitting, even as the service role [%]', SQLERRM;
    END;
    BEGIN
        INSERT INTO scheduling.event_reschedules (event_id, round, mode, status, opened_by_user_id, opened_at)
        VALUES (current_setting('probe.mirror')::uuid, 0, 'counterparty', 'collecting', current_setting('probe.host')::uuid, now());
        RAISE EXCEPTION 'FAIL a 1-on-1 round was opened on a group sitting';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        RAISE NOTICE 'PASS no 1-on-1 round opens on a group sitting either [%]', SQLERRM;
    END;

    INSERT INTO scheduling.event_reschedules (event_id, round, mode, status, opened_by_user_id, opened_at)
    VALUES (current_setting('probe.one_mirror')::uuid, 0, 'counterparty', 'collecting', current_setting('probe.host')::uuid, now())
    RETURNING id INTO v_round;
    RAISE NOTICE 'PASS a 1-1 sitting still takes a 1-on-1 round';
    BEGIN
        UPDATE scheduling.event_reschedules SET mode = 'vote' WHERE id = v_round;
        RAISE EXCEPTION 'FAIL a 1-1 sitting''s round was turned into a vote';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        RAISE NOTICE 'PASS a 1-1 sitting''s round cannot become a vote [%]', SQLERRM;
    END;

    INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at)
    VALUES (current_setting('probe.schedule')::uuid, 'sync', 'confirmed', 'Probe sync',
            now() + interval '50 days', now() + interval '50 days 30 minutes')
    RETURNING id INTO v_plain;
    INSERT INTO scheduling.event_reschedules (event_id, round, mode, status, opened_by_user_id, opened_at)
    VALUES (v_plain, 0, 'vote', 'collecting', current_setting('probe.host')::uuid, now());
    RAISE NOTICE 'PASS an event that is no sitting still opens a vote';
END $$;
RESET ROLE;
-- #endregion

-- #region 4. Paid seats: the first sitting holds, and the count follows them
DO $$
BEGIN
    INSERT INTO projects.cohort_memberships (cohort_id, user_id, seats, status)
    VALUES (current_setting('probe.cohort')::uuid, current_setting('probe.buyer')::uuid, 2, 'active');
    PERFORM set_config('probe.t2', pg_temp.free_after(current_setting('probe.schedule')::uuid,
        current_setting('probe.t1')::timestamptz + interval '7 days', 60)::text, true);
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.host'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    t1 timestamptz := current_setting('probe.t1')::timestamptz;
    t2 timestamptz := current_setting('probe.t2')::timestamptz;
    r jsonb;
BEGIN
    BEGIN
        PERFORM projects.schedule_sitting(current_setting('probe.cohort')::uuid, 'Week 0',
            t1 - interval '2 days', t1 - interval '2 days' + interval '1 hour');
        RAISE EXCEPTION 'FAIL a sitting before the first one was added once seats were sold';
    EXCEPTION WHEN SQLSTATE 'PS409' THEN
        RAISE NOTICE 'PASS a sold cohort''s first sitting is not moved earlier [%]', SQLERRM;
    END;
    BEGIN
        PERFORM projects.schedule_sitting(current_setting('probe.cohort_sold')::uuid, 'Tonight',
            now() + interval '3 hours', now() + interval '4 hours');
        RAISE EXCEPTION 'FAIL a sold cohort''s first sitting was set inside the cancellation notice';
    EXCEPTION WHEN SQLSTATE 'PS409' THEN
        RAISE NOTICE 'PASS a sold cohort''s first sitting must leave the cancellation notice [%]', SQLERRM;
    END;

    r := projects.schedule_sitting(current_setting('probe.cohort')::uuid, 'Week 2', t2, t2 + interval '1 hour');
    RAISE NOTICE 'PASS a later sitting is added to a sold cohort [%]', r ->> 'slug';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n
      FROM scheduling.events ev JOIN projects.session_events se ON se.id = ev.source_session_event_id
     WHERE se.cohort_id = current_setting('probe.cohort')::uuid AND ev.attendee_count IS DISTINCT FROM 2;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL % mirror(s) do not show the 2 paid seats', n; END IF;
    RAISE NOTICE 'PASS every mirror of the cohort shows its paid seats';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
DO $$
DECLARE v_membership uuid; r jsonb;
BEGIN
    SELECT id INTO v_membership FROM projects.cohort_memberships
     WHERE cohort_id = current_setting('probe.cohort')::uuid AND user_id = auth.uid();
    r := projects.cancel_cohort_membership(v_membership);
    IF r ->> 'outcome' <> 'refunded' THEN RAISE EXCEPTION 'FAIL fixture: the early cancel answered %', r; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n
      FROM scheduling.events ev JOIN projects.session_events se ON se.id = ev.source_session_event_id
     WHERE se.cohort_id = current_setting('probe.cohort')::uuid AND ev.attendee_count IS DISTINCT FROM 0;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL % mirror(s) still count a cancelled seat', n; END IF;
    RAISE NOTICE 'PASS a cancelled seat leaves the mirrors'' count';
END $$;
-- #endregion

-- #region 5. Renaming
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.outsider'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM projects.retitle_sitting(current_setting('probe.sitting')::uuid, 'Hijacked');
        RAISE EXCEPTION 'FAIL a non-host renamed a sitting';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a non-host cannot rename a sitting [%]', SQLERRM;
    END;
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.host'), 'role', 'authenticated')::text, true);
DO $$
DECLARE r jsonb;
BEGIN
    BEGIN
        PERFORM projects.retitle_sitting(current_setting('probe.sitting')::uuid, '');
        RAISE EXCEPTION 'FAIL a sitting was renamed to nothing';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS an empty title is refused [%]', SQLERRM;
    END;
    BEGIN
        PERFORM projects.retitle_sitting(gen_random_uuid(), 'Nowhere');
        RAISE EXCEPTION 'FAIL a missing sitting was renamed';
    EXCEPTION WHEN no_data_found THEN
        RAISE NOTICE 'PASS a missing sitting is P0002 [%]', SQLERRM;
    END;
    r := projects.retitle_sitting(current_setting('probe.sitting')::uuid, 'Week 1: orientation');
    IF r ->> 'title' <> 'Week 1: orientation' THEN RAISE EXCEPTION 'FAIL retitle answered %', r; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

DO $$
BEGIN
    IF (SELECT title FROM projects.session_events WHERE id = current_setting('probe.sitting')::uuid) <> 'Week 1: orientation'
       OR (SELECT title FROM scheduling.events WHERE id = current_setting('probe.mirror')::uuid) <> 'Week 1: orientation' THEN
        RAISE EXCEPTION 'FAIL the sitting and its mirror disagree after a rename';
    END IF;
    RAISE NOTICE 'PASS the host renames the sitting and its mirror together';
END $$;
-- #endregion

-- #region 6. Grants
DO $$
BEGIN
    IF has_function_privilege('anon', 'projects.schedule_sitting(uuid,text,timestamptz,timestamptz)', 'EXECUTE')
       OR has_function_privilege('anon', 'projects.retitle_sitting(uuid,text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'projects.schedule_sitting(uuid,text,timestamptz,timestamptz)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'projects.retitle_sitting(uuid,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fn_sync_sitting_mirrors(uuid)', 'EXECUTE')
       OR has_function_privilege('service_role', 'projects.fn_sync_sitting_mirrors(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL the sitting doors'' grants are not signed-in only, or a helper is reachable';
    END IF;
    RAISE NOTICE 'PASS the doors are signed-in only and the helpers are internal';
END $$;
-- #endregion

ROLLBACK;
