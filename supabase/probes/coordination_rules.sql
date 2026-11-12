-- =============================================================================================
-- Probe: one majority denominator, a bounded ballot, and courtesy no-shows in Standing
-- (SCHEDULING_COMPLETENESS_AUDIT S-14, S-15, S-17; Decision #343, ruling C6 D5 / D7 / D8; the D7
-- weight is Decision #419).
--
--   1  D5  the session workspace's `voters` is eligibleVoterCount's: the host out, optional seats
--          in, a guest out (a host, two participants, three optional seats and a guest is 5)
--   2  D8  an attendee's fourth unapproved slot is refused (proposer_quota) while the host's slot and
--          another attendee's still land; a replacement of a different length is refused
--          (duration_changed); a 25-hour slot is refused by ck_proposal_span (23514)
--   3  D7  a presence-verified courtesy no-show writes one penalty and moves Standing; a second by the
--          same pair inside 30 days writes none; a self-reported one and a paid call's write none
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   deno task test:probes coordination_rules
--
-- A clean run prints only PASS notices; any failure raises `PROBE FAIL …` and aborts. Fixtures are
-- found in the seed; no ids are hard-coded. `now()` is the transaction's start, so a call "in the
-- past" is written that way rather than waited for.
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
        RAISE EXCEPTION 'PROBE FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- Insert one slot as the writer does (the service role's path, here postgres), and answer with what
-- the database said: 'ok', or the SQLSTATE plus the HINT or the constraint that refused it.
CREATE FUNCTION pg_temp.offer(
    p_round uuid, p_start timestamptz, p_end timestamptz, p_by uuid, p_role text
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_hint text;
    v_constraint text;
BEGIN
    INSERT INTO scheduling.reschedule_proposals (
        reschedule_id, starts_at, ends_at, proposed_by_user_id, proposed_by_role, approved
    ) VALUES (p_round, p_start, p_end, p_by, p_role, p_role = 'host');
    RETURN 'ok';
EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_constraint = CONSTRAINT_NAME;
    RETURN '23514 ' || COALESCE(NULLIF(v_hint, ''), v_constraint, '?');
END $$;

-- A confirmed call written straight to the table, already under way: the fixture is the state the
-- no-show door starts from. auth.uid() is NULL here, so the request gate stands aside.
CREATE FUNCTION pg_temp.call(p_host uuid, p_requester uuid, p_type scheduling.call_type)
RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO scheduling.discovery_calls (
        host_schedule_id, host_user_id, requester_user_id, call_type, status, proposed_start,
        proposed_end, confirmed_start, confirmed_end, confirmed_at, fee_amount_minor, fee_currency
    ) VALUES (
        current_setting('probe.schedule')::uuid, p_host, p_requester, p_type, 'confirmed',
        now() - interval '20 minutes', now() + interval '10 minutes',
        now() - interval '20 minutes', now() + interval '10 minutes', now() - interval '1 day',
        CASE WHEN p_type = 'paid' THEN 2500 END, CASE WHEN p_type = 'paid' THEN 'GBP' END
    ) RETURNING id;
$$;

CREATE FUNCTION pg_temp.penalties(p_subject uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM security.penalties p
     WHERE p.subject_id = p_subject AND p.source_type = 'no_show';
$$;
-- #endregion

-- #region 1. D5 — the workspace counts the voters settlement counts
DO $$
DECLARE
    v_project uuid;
    v_stage uuid;
    v_cohort uuid;
    v_sitting uuid;
    v_host uuid;
    v_event uuid;
    v_users uuid[];
    v_round integer;
    v_voters integer;
BEGIN
    -- A 1-1 engagement with one sitting ahead, built here: the seed has no session engagement. A
    -- sitting's mirror may only be negotiated 1-on-1 (trg_sitting_round_guard), so a 1-1 is the one
    -- place the workspace reports a round.
    SELECT p.id, s.id, p.owner_user_id INTO v_project, v_stage, v_host
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id IS NOT NULL AND p.owner_team_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM projects.cohorts c WHERE c.project_id = p.id)
       -- fn_project_shape_lock: a project's format is fixed once anybody is onboarded onto it.
       AND NOT EXISTS (
           SELECT 1 FROM projects.stage_assignments sa
             JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
            WHERE ps.project_id = p.id AND sa.status NOT IN ('declined', 'pending_funding'))
     ORDER BY p.id, s.id LIMIT 1;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL no fixture: need a person''s project to hold a 1-1 engagement';
    END IF;
    UPDATE projects.projects SET format = 'session', session_kind = 'normal' WHERE id = v_project;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (v_project, v_stage, 'Probe 1-1') RETURNING id INTO v_cohort;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, status)
    VALUES (v_cohort, 'Probe sitting', now() + interval '3 days', now() + interval '3 days 1 hour', 'scheduled')
    RETURNING id INTO v_sitting;
    PERFORM pg_temp.check(projects.fn_is_session_host(v_project, v_host), 'D5: fixture host hosts it');

    SELECT e.id INTO v_event FROM scheduling.events e WHERE e.source_session_event_id = v_sitting;
    IF v_event IS NULL THEN
        INSERT INTO scheduling.events (project_id, title, starts_at, ends_at, source_session_event_id)
        SELECT v_project, 'Probe sitting', se.start_time, se.end_time, se.id
          FROM projects.session_events se WHERE se.id = v_sitting
        RETURNING id INTO v_event;
    END IF;

    UPDATE scheduling.event_attendees SET archived_at = now()
     WHERE event_id = v_event AND archived_at IS NULL;
    SELECT array_agg(u.user_id ORDER BY u.user_id) INTO v_users
      FROM (SELECT user_id FROM org.users_public
             WHERE user_id <> v_host
               AND user_id NOT IN (SELECT a.user_id FROM scheduling.event_attendees a
                                    WHERE a.event_id = v_event AND a.user_id IS NOT NULL)
             ORDER BY user_id LIMIT 5) u;
    IF v_host IN (SELECT a.user_id FROM scheduling.event_attendees a WHERE a.event_id = v_event) THEN
        UPDATE scheduling.event_attendees SET archived_at = NULL, role = 'host'
         WHERE event_id = v_event AND user_id = v_host;
    ELSE
        INSERT INTO scheduling.event_attendees (event_id, user_id, role) VALUES (v_event, v_host, 'host');
    END IF;
    INSERT INTO scheduling.event_attendees (event_id, user_id, role) VALUES
        (v_event, v_users[1], 'participant'),
        (v_event, v_users[2], 'participant'),
        (v_event, v_users[3], 'optional'),
        (v_event, v_users[4], 'optional'),
        (v_event, v_users[5], 'optional');
    INSERT INTO scheduling.event_attendees (event_id, user_id, role, email)
    VALUES (v_event, NULL, 'participant', 'probe-guest@example.invalid');

    SELECT COALESCE(max(r.round) + 1, 0) INTO v_round
      FROM scheduling.event_reschedules r WHERE r.event_id = v_event;
    UPDATE scheduling.event_reschedules SET status = 'lapsed', updated_at = now()
     WHERE event_id = v_event AND status IN ('collecting', 'awaiting_counterparty', 'voting');
    INSERT INTO scheduling.event_reschedules (event_id, round, mode, status, opened_by_user_id, opened_at)
    VALUES (v_event, v_round, 'counterparty', 'collecting', v_host, now());

    PERFORM pg_temp.act(v_host);
    v_voters := (projects.get_session_workspace(v_project) -> 'reschedule' ->> 'voters')::integer;
    PERFORM pg_temp.act(NULL);
    -- eligibleVoterCount over this roster: two participants and three optional seats. The old count
    -- (role <> 'optional') said 4: the host and the guest in, the optional seats out.
    PERFORM pg_temp.check(v_voters = 5,
        format('D5: the workspace denominator is eligibleVoterCount''s (5), got %s', v_voters));
END $$;
-- #endregion

-- #region 2. D8 — a bounded ballot
DO $$
DECLARE
    v_schedule uuid;
    v_host uuid;
    v_a uuid;
    v_b uuid;
    v_event uuid;
    v_long uuid;
    v_round uuid;
    v_long_round uuid;
    v_start timestamptz := date_trunc('hour', now()) + interval '10 days';
    v_answer text;
    i integer;
BEGIN
    SELECT sc.id INTO v_schedule FROM scheduling.schedules sc
     WHERE scheduling.fn_schedule_host(sc.id) IS NOT NULL ORDER BY sc.id LIMIT 1;
    v_host := scheduling.fn_schedule_host(v_schedule);
    SELECT u.user_id INTO v_a FROM org.users_public u WHERE u.user_id <> v_host ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_b FROM org.users_public u
     WHERE u.user_id NOT IN (v_host, v_a) ORDER BY u.user_id LIMIT 1;

    INSERT INTO scheduling.events (schedule_id, title, starts_at, ends_at)
    VALUES (v_schedule, 'Probe crit', v_start, v_start + interval '1 hour') RETURNING id INTO v_event;
    INSERT INTO scheduling.events (schedule_id, title, starts_at, ends_at)
    VALUES (v_schedule, 'Probe offsite', v_start, v_start + interval '25 hours') RETURNING id INTO v_long;
    INSERT INTO scheduling.event_attendees (event_id, user_id, role) VALUES
        (v_event, v_host, 'host'), (v_event, v_a, 'participant'), (v_event, v_b, 'participant'),
        (v_long, v_host, 'host'), (v_long, v_a, 'participant'), (v_long, v_b, 'participant');
    INSERT INTO scheduling.event_reschedules (event_id, mode, status, opened_by_user_id, opened_at)
    VALUES (v_event, 'vote', 'collecting', v_host, now()) RETURNING id INTO v_round;
    INSERT INTO scheduling.event_reschedules (event_id, mode, status, opened_by_user_id, opened_at)
    VALUES (v_long, 'vote', 'collecting', v_host, now()) RETURNING id INTO v_long_round;

    FOR i IN 1..3 LOOP
        v_answer := pg_temp.offer(v_round, v_start + make_interval(days => i),
            v_start + make_interval(days => i) + interval '1 hour', v_a, 'attendee');
        PERFORM pg_temp.check(v_answer = 'ok', format('D8: attendee slot %s of 3 lands (%s)', i, v_answer));
    END LOOP;
    v_answer := pg_temp.offer(v_round, v_start + interval '4 days', v_start + interval '4 days 1 hour',
        v_a, 'attendee');
    PERFORM pg_temp.check(v_answer = '23514 proposer_quota',
        format('D8: a fourth unapproved attendee slot is refused (%s)', v_answer));

    v_answer := pg_temp.offer(v_round, v_start + interval '5 days', v_start + interval '5 days 1 hour',
        v_host, 'host');
    PERFORM pg_temp.check(v_answer = 'ok', format('D8: the host''s slot still lands (%s)', v_answer));
    v_answer := pg_temp.offer(v_round, v_start + interval '6 days', v_start + interval '6 days 1 hour',
        v_b, 'attendee');
    PERFORM pg_temp.check(v_answer = 'ok',
        format('D8: another attendee has a quota of their own (%s)', v_answer));

    UPDATE scheduling.reschedule_proposals SET approved = true
     WHERE reschedule_id = v_round AND proposed_by_user_id = v_a
       AND starts_at = v_start + interval '1 day';
    v_answer := pg_temp.offer(v_round, v_start + interval '8 days', v_start + interval '8 days 1 hour',
        v_a, 'attendee');
    PERFORM pg_temp.check(v_answer = 'ok',
        format('D8: once the host answers one, the attendee may offer another (%s)', v_answer));

    v_answer := pg_temp.offer(v_round, v_start + interval '7 days', v_start + interval '7 days 2 hours',
        v_host, 'host');
    PERFORM pg_temp.check(v_answer = '23514 duration_changed',
        format('D8: a longer replacement is refused, whoever offers it (%s)', v_answer));
    v_answer := pg_temp.offer(v_round, v_start + interval '7 days', v_start + interval '7 days 30 minutes',
        v_b, 'attendee');
    PERFORM pg_temp.check(v_answer = '23514 duration_changed',
        format('D8: and so is a shorter one (%s)', v_answer));

    v_answer := pg_temp.offer(v_long_round, v_start + interval '3 days',
        v_start + interval '3 days 25 hours', v_host, 'host');
    PERFORM pg_temp.check(v_answer = '23514 ck_proposal_span',
        format('D8: a 25-hour slot is never stored, even for a 25-hour event (%s)', v_answer));
END $$;
-- #endregion

-- #region 3. D7 — courtesy no-shows in Standing
DO $$
DECLARE
    v_schedule uuid;
    v_host uuid;
    v_req uuid;
    v_call uuid;
    v_before numeric;
    v_after numeric;
    v_component numeric;
    v_points integer := projects.fn_session_param('call_no_show_penalty_points', 2);
    v_days integer := projects.fn_session_param('call_no_show_penalty_days', 90);
    p security.penalties;
BEGIN
    -- A host who is a seller with a Standing row, so the mark has a rung to move.
    SELECT sc.id INTO v_schedule
      FROM scheduling.schedules sc
     WHERE scheduling.fn_schedule_host(sc.id) IS NOT NULL
       AND EXISTS (SELECT 1 FROM org.freelancer_profiles fp WHERE fp.user_id = scheduling.fn_schedule_host(sc.id))
       AND EXISTS (SELECT 1 FROM org.entity_standing es
                    WHERE es.subject_type = 'freelancer' AND es.subject_id = scheduling.fn_schedule_host(sc.id))
     ORDER BY sc.id LIMIT 1;
    IF v_schedule IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL no fixture: need a schedule whose host has a Standing row';
    END IF;
    v_host := scheduling.fn_schedule_host(v_schedule);
    SELECT u.user_id INTO v_req FROM org.users_public u
     WHERE u.user_id <> v_host AND NOT org.fn_is_minor(u.user_id) ORDER BY u.user_id LIMIT 1;
    PERFORM set_config('probe.schedule', v_schedule::text, true);
    PERFORM pg_temp.check(v_points = 2 AND v_days = 90, 'D7: the dials are seeded at 2 points and 90 days');

    SELECT es.penalty_severity INTO v_before FROM org.entity_standing es
     WHERE es.subject_type = 'freelancer' AND es.subject_id = v_host;

    -- A paid call: money answers its no-show, so Standing never does.
    v_call := pg_temp.call(v_host, v_req, 'paid');
    INSERT INTO scheduling.call_attendance (call_id, user_id, joined_at) VALUES (v_call, v_req, now() - interval '18 minutes');
    PERFORM pg_temp.act(v_req);
    PERFORM scheduling.mark_call_no_show(v_call, 'host');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(pg_temp.penalties(v_host) = 0, 'D7: a paid call''s no-show writes no penalty');

    -- Self-reported: the room recorded nobody, so the mark lands and costs nothing.
    v_call := pg_temp.call(v_host, v_req, 'courtesy');
    PERFORM pg_temp.act(v_host);
    PERFORM scheduling.mark_call_no_show(v_call, 'requester');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((SELECT status FROM scheduling.discovery_calls WHERE id = v_call) = 'no_show'
        AND pg_temp.penalties(v_req) = 0, 'D7: a self-reported mark lands but writes no penalty');

    -- Also self-reported: a marker who arrived after the presence window was not there to see.
    v_call := pg_temp.call(v_host, v_req, 'courtesy');
    INSERT INTO scheduling.call_attendance (call_id, user_id, joined_at) VALUES (v_call, v_req, now() - interval '2 minutes');
    PERFORM pg_temp.act(v_req);
    PERFORM scheduling.mark_call_no_show(v_call, 'host');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(pg_temp.penalties(v_host) = 0,
        'D7: a marker who joined after the presence window writes no penalty');

    -- Verified: the requester was in the room inside the window, the host was not.
    v_call := pg_temp.call(v_host, v_req, 'courtesy');
    INSERT INTO scheduling.call_attendance (call_id, user_id, joined_at) VALUES (v_call, v_req, now() - interval '18 minutes');
    PERFORM pg_temp.act(v_req);
    PERFORM scheduling.mark_call_no_show(v_call, 'host');
    PERFORM pg_temp.act(NULL);
    SELECT * INTO p FROM security.penalties WHERE source_type = 'no_show' AND source_id = v_call;
    PERFORM pg_temp.check(pg_temp.penalties(v_host) = 1 AND p.subject_type = 'freelancer'
        AND p.penalty_type = 'trust_score' AND p.severity = v_points AND p.status = 'active'
        AND p.expires_at = now() + make_interval(days => v_days),
        'D7: a verified courtesy no-show writes one trust_score penalty of 2, lapsing in 90 days');
    PERFORM pg_temp.check(EXISTS (
        SELECT 1 FROM comms.notifications n
         WHERE n.type = 'call.no_show' AND n.entity_id = v_call AND n.user_id = v_host
           AND n.body LIKE '%Standing%'), 'D7: and the absent host is told it costs Standing');

    SELECT es.penalty_severity, (es.components ->> 'penalty')::numeric INTO v_after, v_component
      FROM org.entity_standing es WHERE es.subject_type = 'freelancer' AND es.subject_id = v_host;
    PERFORM pg_temp.check(v_after = v_before + v_points,
        format('D7: the cached penalty term rises by 2 (%s → %s)', v_before, v_after));
    PERFORM pg_temp.check(v_component = -LEAST(v_after, 100),
        format('D7: Standing''s components show the penalty (%s)', v_component));

    -- The same pair again inside 30 days: the mark lands, the penalty does not.
    v_call := pg_temp.call(v_host, v_req, 'courtesy');
    INSERT INTO scheduling.call_attendance (call_id, user_id, joined_at) VALUES (v_call, v_req, now() - interval '18 minutes');
    PERFORM pg_temp.act(v_req);
    PERFORM scheduling.mark_call_no_show(v_call, 'host');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(pg_temp.penalties(v_host) = 1
        AND (SELECT penalty_severity FROM org.entity_standing
              WHERE subject_type = 'freelancer' AND subject_id = v_host) = v_after,
        'D7: a second mark by the same pair inside 30 days writes none');

    PERFORM pg_temp.check(NOT has_function_privilege('authenticated',
        'scheduling.fn_charge_call_no_show(scheduling.discovery_calls,uuid,uuid,timestamptz)', 'EXECUTE'),
        'D7: the charge is the door''s internal, nobody''s to call');
END $$;
-- #endregion

ROLLBACK;
