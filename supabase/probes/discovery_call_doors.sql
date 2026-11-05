-- =============================================================================================
-- Probe: the discovery-call doors, their sweep, the reminder producer and the owner's settings read
-- (SCHEDULING_COMPLETENESS_AUDIT S-10, S-16, S-18; Decision #343, ruling C3; Decision #383).
--
--   1  confirm   only the counterparty of the last proposal; never a stranger; a replay refuses
--   2  decline   the host, from proposed; the slot is released
--   3  propose   outside the lockout at both ends, the length kept, the gate re-run without the
--                call itself; a move leaves `confirmed` and frees the old span in get_free_busy
--   4  cancel    either side from confirmed, a requester's withdrawal, lateness derived
--   5  no-show   from start + the presence window, never against yourself, never against evidence
--   6  the sweep completes courtesy calls past their end, and only those
--   7  reminders one row per person per reminder, re-timed by a move, withdrawn by a cancellation
--   8  S-16: a signed-in stranger cannot read the caps; the owner reads them through the door
--   9  grants and the job registry
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/discovery_call_doors.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. Fixtures are found
-- in the seed; no ids are hard-coded. `now()` is the transaction's start, so a call "in the past" is
-- written that way rather than waited for.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

-- #region 0. Helpers (as postgres)
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_user IS NULL THEN
        PERFORM set_config('role', 'postgres', true);
        PERFORM set_config('request.jwt.claims', '', true);
    ELSE
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
    END IF;
END $$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- Run a statement as p_user and require the door's refusal code.
CREATE FUNCTION pg_temp.refused(p_user uuid, p_sql text, p_code text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_user);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.act(NULL);
        IF SQLERRM NOT LIKE '%: ' || p_code THEN
            RAISE EXCEPTION 'FAIL % answered [%], wanted %', p_label, SQLERRM, p_code;
        END IF;
        RAISE NOTICE 'PASS % [%]', p_label, p_code;
        RETURN;
    END;
    PERFORM pg_temp.act(NULL);
    RAISE EXCEPTION 'FAIL % was allowed', p_label;
END $$;

-- A call written straight to the table: the fixture is the state a door starts from, not the request
-- door again. auth.uid() is NULL here, so the insert gate stands aside.
CREATE FUNCTION pg_temp.call(
    p_status scheduling.call_status, p_start timestamptz, p_end timestamptz,
    p_by scheduling.call_party DEFAULT 'requester'
) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO scheduling.discovery_calls (
        host_schedule_id, host_user_id, requester_user_id, call_type, status, proposed_start,
        proposed_end, proposed_by, confirmed_start, confirmed_end, confirmed_at
    ) VALUES (
        current_setting('probe.schedule')::uuid, current_setting('probe.host')::uuid,
        current_setting('probe.requester')::uuid, 'courtesy', p_status, p_start, p_end, p_by,
        CASE WHEN p_status = 'confirmed' THEN p_start END,
        CASE WHEN p_status = 'confirmed' THEN p_end END,
        CASE WHEN p_status = 'confirmed' THEN now() END
    ) RETURNING id;
$$;

CREATE FUNCTION pg_temp.notices(p_call uuid, p_type text, p_user uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM comms.notifications n
     WHERE n.type = p_type AND n.entity_table = 'scheduling.discovery_calls'
       AND n.entity_id = p_call AND n.user_id = p_user;
$$;

CREATE FUNCTION pg_temp.busy(p_start timestamptz, p_end timestamptz) RETURNS boolean LANGUAGE sql AS $$
    SELECT EXISTS (
        SELECT 1 FROM scheduling.get_free_busy(current_setting('probe.schedule')::uuid,
            now() - interval '1 day', now() + interval '60 days') b
         WHERE b.starts_at = p_start AND b.ends_at = p_end
    );
$$;

-- The first slot at or after p_after that the request gate accepts for this requester.
CREATE FUNCTION pg_temp.slot(p_after timestamptz, OUT o_start timestamptz, OUT o_end timestamptz)
LANGUAGE plpgsql AS $$
DECLARE
    v_schedule uuid := current_setting('probe.schedule')::uuid;
    v_requester uuid := current_setting('probe.requester')::uuid;
    v_minutes integer;
    t timestamptz := date_trunc('hour', p_after) + interval '1 hour';
BEGIN
    SELECT cs.courtesy_duration_minutes INTO v_minutes
      FROM scheduling.call_settings cs WHERE cs.schedule_id = v_schedule;
    WHILE t < now() + interval '55 days' LOOP
        IF scheduling.fn_call_request_refusal(v_schedule, v_requester, 'courtesy', t,
               t + make_interval(mins => v_minutes)) IS NULL THEN
            o_start := t;
            o_end := t + make_interval(mins => v_minutes);
            RETURN;
        END IF;
        t := t + interval '1 hour';
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: no courtesy slot after %', p_after;
END $$;

DO $$
DECLARE
    v_schedule uuid;
    v_requester uuid;
    v_stranger uuid;
    v_host uuid;
BEGIN
    SELECT sc.id INTO v_schedule
      FROM scheduling.schedules sc JOIN scheduling.call_settings cs ON cs.schedule_id = sc.id
     WHERE cs.accepts_calls AND cs.courtesy_enabled AND scheduling.fn_schedule_is_public(sc.id)
       AND scheduling.fn_schedule_host(sc.id) IS NOT NULL
     ORDER BY sc.id LIMIT 1;
    IF v_schedule IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a published schedule taking courtesy calls';
    END IF;
    v_host := scheduling.fn_schedule_host(v_schedule);
    SELECT p.user_id INTO v_requester FROM org.users_public p
     WHERE p.user_id <> v_host AND NOT org.fn_is_minor(p.user_id) ORDER BY p.user_id LIMIT 1;
    SELECT p.user_id INTO v_stranger FROM org.users_public p
     WHERE p.user_id NOT IN (v_host, v_requester) ORDER BY p.user_id LIMIT 1;

    -- The caps would otherwise refuse the slots these cases keep asking for.
    UPDATE scheduling.call_settings
       SET courtesy_max_per_week = 0, courtesy_cooldown_days = 0, min_notice_minutes = 0,
           auto_confirm = false, buffer_before_minutes = 0, buffer_after_minutes = 0
     WHERE schedule_id = v_schedule;

    PERFORM set_config('probe.schedule', v_schedule::text, true);
    PERFORM set_config('probe.host', v_host::text, true);
    PERFORM set_config('probe.requester', v_requester::text, true);
    PERFORM set_config('probe.stranger', v_stranger::text, true);
END $$;
-- #endregion

-- #region 1. Confirm: the counterparty of the last proposal
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_req uuid := current_setting('probe.requester')::uuid;
    v_stranger uuid := current_setting('probe.stranger')::uuid;
    s record;
    v_call uuid;
    c scheduling.discovery_calls;
BEGIN
    SELECT * INTO s FROM pg_temp.slot(now() + interval '2 days');
    v_call := pg_temp.call('proposed', s.o_start, s.o_end);

    PERFORM pg_temp.refused(v_req, format('SELECT scheduling.confirm_discovery_call(%L)', v_call),
        'not_your_move', 'a requester cannot confirm their own request');
    PERFORM pg_temp.refused(v_stranger, format('SELECT scheduling.confirm_discovery_call(%L)', v_call),
        'call_not_found', 'a stranger gets the answer a missing call gets');
    PERFORM pg_temp.refused(NULL, format('SELECT scheduling.confirm_discovery_call(%L)', gen_random_uuid()),
        'not_signed_in', 'nobody signed in cannot confirm');

    PERFORM pg_temp.act(v_host);
    PERFORM scheduling.confirm_discovery_call(v_call);
    PERFORM pg_temp.act(NULL);
    SELECT * INTO c FROM scheduling.discovery_calls WHERE id = v_call;
    PERFORM pg_temp.check(c.status = 'confirmed' AND c.confirmed_start = s.o_start
        AND c.confirmed_end = s.o_end AND c.confirmed_at IS NOT NULL AND c.responded_at IS NOT NULL,
        'the host confirms a request, and the trigger stamps it');
    PERFORM pg_temp.check(pg_temp.notices(v_call, 'call.confirmed', v_req) = 1, 'the requester is told once');

    PERFORM pg_temp.refused(v_host, format('SELECT scheduling.confirm_discovery_call(%L)', v_call),
        'not_open', 'replaying confirm is a refusal');
    PERFORM pg_temp.check(pg_temp.notices(v_call, 'call.confirmed', v_req) = 1, 'and sends no second notice');

    -- A time the host proposed waits for the requester.
    SELECT * INTO s FROM pg_temp.slot(s.o_end + interval '1 hour');
    v_call := pg_temp.call('proposed', s.o_start, s.o_end, 'host');
    PERFORM pg_temp.refused(v_host, format('SELECT scheduling.confirm_discovery_call(%L)', v_call),
        'not_your_move', 'a host cannot confirm their own proposal');
    PERFORM pg_temp.act(v_req);
    PERFORM scheduling.confirm_discovery_call(v_call);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((SELECT status = 'confirmed' FROM scheduling.discovery_calls WHERE id = v_call),
        'the requester confirms the host''s time');
    PERFORM pg_temp.check(pg_temp.notices(v_call, 'call.confirmed', v_host) = 1, 'and the host is told');

    v_call := pg_temp.call('proposed', now() - interval '1 hour', now() - interval '30 minutes');
    PERFORM pg_temp.refused(v_host, format('SELECT scheduling.confirm_discovery_call(%L)', v_call),
        'slot_passed', 'a time already gone cannot be confirmed');
END $$;
-- #endregion

-- #region 2. Decline: the host, from proposed
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_req uuid := current_setting('probe.requester')::uuid;
    s record;
    v_call uuid;
    c scheduling.discovery_calls;
BEGIN
    SELECT * INTO s FROM pg_temp.slot(now() + interval '6 days');
    v_call := pg_temp.call('proposed', s.o_start, s.o_end);
    PERFORM pg_temp.check(pg_temp.busy(s.o_start, s.o_end), 'a proposed call holds its span');
    PERFORM pg_temp.refused(v_req, format('SELECT scheduling.decline_discovery_call(%L)', v_call),
        'not_your_move', 'a requester cannot decline');

    PERFORM pg_temp.act(v_host);
    PERFORM scheduling.decline_discovery_call(v_call, repeat('x', 400));
    PERFORM pg_temp.act(NULL);
    SELECT * INTO c FROM scheduling.discovery_calls WHERE id = v_call;
    PERFORM pg_temp.check(c.status = 'declined' AND c.responded_at IS NOT NULL
        AND char_length(c.cancellation_reason) = 280, 'the host declines, and the reason is bounded');
    PERFORM pg_temp.check(NOT pg_temp.busy(s.o_start, s.o_end), 'a declined call releases its span');
    PERFORM pg_temp.check(pg_temp.notices(v_call, 'call.declined', v_req) = 1, 'the requester is told');
    PERFORM pg_temp.refused(v_host, format('SELECT scheduling.decline_discovery_call(%L)', v_call),
        'not_open', 'declined is terminal');
END $$;
-- #endregion

-- #region 3. Propose a new time
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_req uuid := current_setting('probe.requester')::uuid;
    s record;
    t record;
    v_call uuid;
    v_near uuid;
    c scheduling.discovery_calls;
    v_len interval;
BEGIN
    SELECT * INTO s FROM pg_temp.slot(now() + interval '8 days');
    SELECT * INTO t FROM pg_temp.slot(s.o_end + interval '1 day');
    v_len := s.o_end - s.o_start;
    v_call := pg_temp.call('confirmed', s.o_start, s.o_end);

    PERFORM pg_temp.refused(v_req,
        format('SELECT scheduling.propose_call_time(%L, %L, %L)', v_call, now() + interval '11 hours',
            now() + interval '11 hours' + v_len),
        'inside_lockout', 'a new time inside the lockout is refused');
    v_near := pg_temp.call('confirmed', now() + interval '11 hours', now() + interval '11 hours' + v_len);
    PERFORM pg_temp.refused(v_req,
        format('SELECT scheduling.propose_call_time(%L, %L, %L)', v_near, t.o_start, t.o_end),
        'inside_lockout', 'a call already inside the lockout cannot be moved');
    PERFORM pg_temp.refused(v_req,
        format('SELECT scheduling.propose_call_time(%L, %L, %L)', v_call, t.o_start,
            t.o_end + interval '15 minutes'),
        'duration_mismatch', 'a move keeps the call''s length');

    PERFORM pg_temp.act(v_req);
    PERFORM scheduling.propose_call_time(v_call, t.o_start, t.o_end);
    PERFORM pg_temp.act(NULL);
    SELECT * INTO c FROM scheduling.discovery_calls WHERE id = v_call;
    PERFORM pg_temp.check(c.status = 'proposed' AND c.proposed_by = 'requester'
        AND c.confirmed_start IS NULL AND c.confirmed_at IS NULL AND c.reschedule_count = 1,
        'a moved call waits for its counterparty, with its agreement cleared');
    PERFORM pg_temp.check(NOT pg_temp.busy(s.o_start, s.o_end), 'the old span is free');
    PERFORM pg_temp.check(pg_temp.busy(t.o_start, t.o_end), 'the new span is held');
    PERFORM pg_temp.check(pg_temp.notices(v_call, 'call.time_proposed', v_host) = 1, 'the host is told');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM scheduling.call_audit a
        WHERE a.call_id = v_call AND a.action = 'rescheduled' AND a.to_status = 'proposed'),
        'the move is on the audit trail');

    -- A move on a call still proposed changes no status, so the door counts it and the log writes it.
    PERFORM pg_temp.act(v_host);
    PERFORM scheduling.propose_call_time(v_call, s.o_start, s.o_end);
    PERFORM pg_temp.act(NULL);
    SELECT * INTO c FROM scheduling.discovery_calls WHERE id = v_call;
    PERFORM pg_temp.check(c.status = 'proposed' AND c.proposed_by = 'host' AND c.reschedule_count = 2,
        'a counter-proposal hands the acceptance back');
    PERFORM pg_temp.check((SELECT count(*) = 2 FROM scheduling.call_audit a
        WHERE a.call_id = v_call AND a.action = 'rescheduled'), 'and logs a second move');
    PERFORM pg_temp.check(scheduling.fn_slot_is_free(current_setting('probe.schedule')::uuid,
        s.o_start, s.o_end, v_call) AND NOT scheduling.fn_slot_is_free(
        current_setting('probe.schedule')::uuid, s.o_start, s.o_end),
        'the gate judges a call without counting itself, and only when told to');

    -- Somebody else's call on the new slot refuses the move.
    PERFORM pg_temp.call('confirmed', t.o_start, t.o_end);
    PERFORM pg_temp.refused(v_host,
        format('SELECT scheduling.propose_call_time(%L, %L, %L)', v_call, t.o_start, t.o_end),
        'slot_unavailable', 'a move cannot land on a taken slot');
END $$;
-- #endregion

-- #region 4. Cancel and withdraw
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_req uuid := current_setting('probe.requester')::uuid;
    v_call uuid;
    c scheduling.discovery_calls;
BEGIN
    v_call := pg_temp.call('proposed', now() + interval '20 days', now() + interval '20 days 30 minutes');
    PERFORM pg_temp.refused(v_host, format('SELECT scheduling.cancel_discovery_call(%L)', v_call),
        'not_open', 'a host declines a proposed call rather than cancelling it');
    PERFORM pg_temp.act(v_req);
    PERFORM scheduling.cancel_discovery_call(v_call);
    PERFORM pg_temp.act(NULL);
    SELECT * INTO c FROM scheduling.discovery_calls WHERE id = v_call;
    PERFORM pg_temp.check(c.status = 'cancelled' AND c.cancelled_by = 'requester' AND NOT c.is_late_cancel,
        'a requester withdraws a proposed call, and it is not late');
    PERFORM pg_temp.check(pg_temp.notices(v_call, 'call.cancelled', v_host) = 1, 'the host is told');

    v_call := pg_temp.call('confirmed', now() + interval '2 hours', now() + interval '2 hours 30 minutes');
    PERFORM pg_temp.act(v_host);
    PERFORM scheduling.cancel_discovery_call(v_call, 'Probe reason');
    PERFORM pg_temp.act(NULL);
    SELECT * INTO c FROM scheduling.discovery_calls WHERE id = v_call;
    PERFORM pg_temp.check(c.status = 'cancelled' AND c.cancelled_by = 'host' AND c.is_late_cancel
        AND c.cancellation_reason = 'Probe reason', 'a cancel inside the window is derived late');

    v_call := pg_temp.call('confirmed', now() - interval '2 hours', now() - interval '1 hour');
    PERFORM pg_temp.refused(v_req, format('SELECT scheduling.cancel_discovery_call(%L)', v_call),
        'slot_passed', 'a call already over cannot be cancelled');
END $$;
-- #endregion

-- #region 5. No-show
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_req uuid := current_setting('probe.requester')::uuid;
    v_call uuid;
    c scheduling.discovery_calls;
BEGIN
    v_call := pg_temp.call('confirmed', now() - interval '10 minutes', now() + interval '20 minutes');
    PERFORM pg_temp.refused(v_host, format('SELECT scheduling.mark_call_no_show(%L, %L)', v_call, 'requester'),
        'too_early', 'a no-show waits for the presence window');

    v_call := pg_temp.call('confirmed', now() - interval '20 minutes', now() + interval '10 minutes');
    PERFORM pg_temp.refused(v_host, format('SELECT scheduling.mark_call_no_show(%L, %L)', v_call, 'host'),
        'not_your_move', 'a party never marks themselves');
    PERFORM pg_temp.refused(v_host, format('SELECT scheduling.mark_call_no_show(%L, %L)', v_call, 'both'),
        'not_your_move', 'and never both sides');

    INSERT INTO scheduling.call_attendance (call_id, user_id, joined_at)
    VALUES (v_call, v_req, now() - interval '18 minutes');
    PERFORM pg_temp.refused(v_host, format('SELECT scheduling.mark_call_no_show(%L, %L)', v_call, 'requester'),
        'attendance_contradicts', 'the room''s evidence beats the mark');

    PERFORM pg_temp.act(v_req);
    PERFORM scheduling.mark_call_no_show(v_call, 'host');
    PERFORM pg_temp.act(NULL);
    SELECT * INTO c FROM scheduling.discovery_calls WHERE id = v_call;
    PERFORM pg_temp.check(c.status = 'no_show' AND c.no_show_party = 'host',
        'an uncontradicted mark lands');
    PERFORM pg_temp.check(pg_temp.notices(v_call, 'call.no_show', v_host) = 1, 'and the host is told');
END $$;
-- #endregion

-- #region 6. The sweep
DO $$
DECLARE
    v_over uuid;
    v_running uuid;
    v_paid uuid;
    n integer;
BEGIN
    v_over := pg_temp.call('confirmed', now() - interval '2 hours', now() - interval '1 hour');
    v_running := pg_temp.call('confirmed', now() - interval '10 minutes', now() + interval '20 minutes');
    v_paid := pg_temp.call('confirmed', now() - interval '3 hours', now() - interval '2 hours 30 minutes');
    UPDATE scheduling.discovery_calls
       SET call_type = 'paid', fee_amount_minor = 5000, fee_currency = 'GBP' WHERE id = v_paid;

    PERFORM scheduling.fn_expire_discovery_calls();
    PERFORM pg_temp.check((SELECT status = 'completed' AND completed_at IS NOT NULL
        FROM scheduling.discovery_calls WHERE id = v_over), 'a courtesy call past its end completes');
    PERFORM pg_temp.check((SELECT status = 'confirmed' FROM scheduling.discovery_calls WHERE id = v_running),
        'a call still running does not');
    PERFORM pg_temp.check((SELECT status = 'confirmed' FROM scheduling.discovery_calls WHERE id = v_paid),
        'a paid call never completes here');
    n := scheduling.fn_expire_discovery_calls();
    PERFORM pg_temp.check(n = 0, 'a second run changes nothing');
END $$;
-- #endregion

-- #region 7. Reminders
DO $$
DECLARE
    v_host uuid;
    v_req uuid := current_setting('probe.requester')::uuid;
    v_project uuid;
    v_stage uuid;
    v_cohort uuid;
    v_event uuid;
    v_start timestamptz := now() + interval '90 minutes';
    v_call uuid;
BEGIN
    SELECT p.id, s.id, p.owner_user_id INTO v_project, v_stage, v_host
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id IS NOT NULL AND p.owner_user_id <> v_req
     ORDER BY p.id LIMIT 1;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (v_project, v_stage, 'Probe reminders') RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_req);
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_cohort, 'Probe sitting', v_start, v_start + interval '1 hour') RETURNING id INTO v_event;

    v_call := pg_temp.call('confirmed', now() + interval '100 minutes', now() + interval '130 minutes');

    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.check((SELECT count(*) = 6 FROM comms.notification_queue q
        WHERE q.entity_id = v_event AND q.status = 'scheduled'),
        'a sitting queues its three reminders for each of its two people');
    PERFORM pg_temp.check((SELECT count(*) = 2 FROM comms.notification_queue q
        WHERE q.entity_id = v_call AND q.status = 'scheduled' AND q.type = 'call.reminder'),
        'a call queues one reminder for each party');
    PERFORM pg_temp.check((SELECT bool_and(q.scheduled_for = v_start - interval '15 minutes')
        FROM comms.notification_queue q WHERE q.entity_id = v_event AND q.type = 'session.reminder_15m'),
        'a reminder lands at its lead before the start');

    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.check((SELECT count(*) = 6 FROM comms.notification_queue q WHERE q.entity_id = v_event),
        'a second pass writes no new rows');

    UPDATE projects.session_events
       SET start_time = v_start + interval '10 minutes', end_time = v_start + interval '70 minutes'
     WHERE id = v_event;
    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.check((SELECT count(*) = 6 FROM comms.notification_queue q
        WHERE q.entity_id = v_event AND q.status = 'scheduled'), 'a small move keeps six live reminders');
    PERFORM pg_temp.check((SELECT bool_and(q.scheduled_for = v_start - interval '5 minutes')
        FROM comms.notification_queue q WHERE q.entity_id = v_event AND q.status = 'scheduled'
          AND q.type = 'session.reminder_15m'), 'at the new time');

    UPDATE projects.session_events
       SET start_time = now() + interval '5 days', end_time = now() + interval '5 days 1 hour'
     WHERE id = v_event;
    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM comms.notification_queue q
        WHERE q.entity_id = v_event AND q.status = 'scheduled'),
        'a move out of the horizon withdraws them');

    PERFORM pg_temp.act(current_setting('probe.host')::uuid);
    PERFORM scheduling.cancel_discovery_call(v_call);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM comms.notification_queue q
        WHERE q.entity_id = v_call AND q.status = 'scheduled'), 'a cancelled call withdraws its reminders');
END $$;
-- #endregion

-- #region 8. S-16: the caps are the owner's
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_stranger uuid := current_setting('probe.stranger')::uuid;
    v_schedule uuid := current_setting('probe.schedule')::uuid;
    n integer;
BEGIN
    PERFORM pg_temp.act(v_stranger);
    BEGIN
        PERFORM courtesy_max_per_week FROM scheduling.call_settings WHERE schedule_id = v_schedule;
        RAISE EXCEPTION 'FAIL a signed-in stranger read the weekly cap';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a signed-in stranger reading the weekly cap gets 42501';
    END;
    SELECT count(*) INTO n FROM scheduling.get_own_call_settings(v_schedule);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(n = 0, 'the owner door answers nothing to a stranger');

    PERFORM pg_temp.act(v_host);
    SELECT count(*) INTO n FROM scheduling.get_own_call_settings(v_schedule);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(n = 1, 'and the whole row to its owner');
END $$;
-- #endregion

-- #region 9. Grants and the registry
DO $$
BEGIN
    PERFORM pg_temp.check(NOT has_function_privilege('anon', 'scheduling.confirm_discovery_call(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'scheduling.propose_call_time(uuid,timestamptz,timestamptz)', 'EXECUTE'),
        'a visitor runs no door');
    PERFORM pg_temp.check(NOT has_function_privilege('authenticated', 'scheduling.fn_lock_call(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'scheduling.fn_enqueue_due_reminders()', 'EXECUTE'),
        'a signed-in caller runs neither the lock nor the sweep');
    PERFORM pg_temp.check(has_function_privilege('authenticated', 'scheduling.mark_call_no_show(uuid,scheduling.call_party)', 'EXECUTE'),
        'a signed-in caller may try a door');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM ops.scheduled_jobs j
        WHERE j.name = 'scheduling-reminders' AND j.kind = 'sql'), 'the reminder job is registered');
    PERFORM pg_temp.check((SELECT count(*) = 6 FROM comms.notification_types t WHERE t.key IN
        ('call.confirmed', 'call.declined', 'call.time_proposed', 'call.cancelled', 'call.no_show', 'call.reminder')),
        'the six notices are in the catalog');
END $$;
-- #endregion

ROLLBACK;
