-- =============================================================================================
-- Probe: no evidence, no automatic release (audit S-08, S-09; Decision #343, ruling C5 (a);
-- Decision #383, ruling R6).
--
--   1  a sitting with no evidence does not release at +24 h: its attendee is asked, once
--   2  a yes is evidence, and the next sweep releases; the sweep stays the only thing moving money
--   3  a no is a no-show claim
--   4  silence for session_review_hold_days opens a case on the desk
--   5  the host cannot answer, and a sitting with evidence is not asked about
--   6  a tracked sitting still releases at +24 h, and a provider no-show still refunds
--   7  S-09: a cancelled block's started sitting keeps its claim and its join link
--   8  replaying the sweep moves nothing twice
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/session_settlement_edges.sql
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

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

DO $$
DECLARE v_project uuid; v_stage uuid; v_host uuid; v_a uuid;
BEGIN
    SELECT p.id, s.id, p.owner_user_id INTO v_project, v_stage, v_host
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id IS NOT NULL AND p.owner_team_id IS NULL
     ORDER BY p.id, s.id LIMIT 1;
    SELECT u.user_id INTO v_a FROM org.users_public u
     WHERE u.user_id <> v_host
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    PERFORM set_config('probe.project', v_project::text, true);
    PERFORM set_config('probe.stage', v_stage::text, true);
    PERFORM set_config('probe.host', v_host::text, true);
    PERFORM set_config('probe.a', v_a::text, true);
END $$;

-- A sitting ended p_ago ago with a per-sitting escrow held for the attendee. Answers the sitting id;
-- the escrow is in probe.escrow.
CREATE FUNCTION pg_temp.sitting(p_tag text, p_ago interval, p_room boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_cohort uuid; v_member uuid; v_event uuid; v_escrow uuid;
BEGIN
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid, 'Probe ' || p_tag)
    RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_a) RETURNING id INTO v_member;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, status, meeting_provider, provider_meeting_id)
    VALUES (v_cohort, 'Probe ' || p_tag, now() - p_ago - interval '1 hour', now() - p_ago, 'scheduled',
            CASE WHEN p_room THEN 'zoom' END, CASE WHEN p_room THEN 'edge-' || p_tag END)
    RETURNING id INTO v_event;
    INSERT INTO finance.escrows (project_stage_id, cohort_membership_id, session_event_id, payer_user_id,
                                 payee_type, payee_id, amount_cents, currency, status)
    VALUES (current_setting('probe.stage')::uuid, v_member, v_event, v_a, 'freelancer',
            current_setting('probe.host')::uuid, 10000, 'GBP', 'held')
    RETURNING id INTO v_escrow;
    IF p_room THEN
        UPDATE scheduling.rooms SET provider_host_id = 'host-account' WHERE session_event_id = v_event;
    END IF;
    PERFORM set_config('probe.escrow', v_escrow::text, true);
    RETURN v_event;
END $$;

CREATE FUNCTION pg_temp.escrow_status(p_event uuid) RETURNS text LANGUAGE sql AS $$
    SELECT status::text FROM finance.escrows WHERE session_event_id = p_event;
$$;

CREATE FUNCTION pg_temp.sweep() RETURNS jsonb LANGUAGE sql AS $$
    SELECT finance.auto_release_session_escrow(now());
$$;

-- #region 1. No evidence: held, and asked once
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_event uuid := pg_temp.sitting('held', interval '25 hours');
    v jsonb;
BEGIN
    v := pg_temp.sweep();
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'held', '1 no evidence does not release at +24 h');
    PERFORM pg_temp.check((SELECT count(*) = 1 FROM comms.notifications n
        WHERE n.type = 'session.review_requested' AND n.entity_id = v_event AND n.user_id = v_a),
        '1 the attendee is asked');
    PERFORM pg_temp.sweep();
    PERFORM pg_temp.check((SELECT count(*) = 1 FROM comms.notifications n
        WHERE n.type = 'session.review_requested' AND n.entity_id = v_event), '1 once');
    PERFORM set_config('probe.held', v_event::text, true);
END $$;
-- #endregion

-- #region 2. A yes
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_event uuid := current_setting('probe.held')::uuid;
BEGIN
    PERFORM pg_temp.act(v_a);
    PERFORM projects.answer_session_review(v_event, true);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'held', '2 the answer itself moves no money');
    PERFORM pg_temp.check(projects.fn_session_presence(v_event) ->> 'outcome' = 'successful', '2 it is evidence');
    PERFORM pg_temp.sweep();
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'released', '2 and the next sweep releases');
END $$;
-- #endregion

-- #region 3. A no
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_event uuid := pg_temp.sitting('no', interval '25 hours');
    v jsonb;
BEGIN
    PERFORM pg_temp.sweep();
    PERFORM pg_temp.act(v_a);
    v := projects.answer_session_review(v_event, false);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v ->> 'dispute_id' IS NOT NULL AND pg_temp.escrow_status(v_event) = 'held',
        '3 a no is a no-show claim, and the money stays held');
    PERFORM pg_temp.sweep();
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'held', '3 the sweep leaves a disputed sitting alone');
END $$;
-- #endregion

-- #region 4. Silence
DO $$
DECLARE
    v_event uuid := pg_temp.sitting('silent', interval '8 days');
    v_status text;
BEGIN
    PERFORM pg_temp.sweep();
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'held'
        AND NOT EXISTS (SELECT 1 FROM finance.disputes d WHERE d.session_event_id = v_event),
        '4 the attendee is asked before anything else, however late');
    PERFORM pg_temp.sweep();
    SELECT d.status::text INTO v_status FROM finance.disputes d WHERE d.session_event_id = v_event;
    PERFORM pg_temp.check(v_status = 'awaiting_response', '4 silence past the hold opens a case');
    PERFORM pg_temp.check((SELECT audit ->> 'verdict' = 'ambiguous' FROM finance.disputes d
        WHERE d.session_event_id = v_event), '4 which the logs cannot settle');
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'held', '4 and the money stays held');
END $$;
-- #endregion

-- #region 5. Who may answer
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_event uuid := pg_temp.sitting('who', interval '25 hours');
BEGIN
    PERFORM pg_temp.sweep();
    PERFORM pg_temp.act(v_host);
    BEGIN
        PERFORM projects.answer_session_review(v_event, true);
        RAISE EXCEPTION 'FAIL 5 a host answered their own review';
    EXCEPTION WHEN SQLSTATE 'PS409' THEN
        RAISE NOTICE 'PASS 5 a host''s word is not evidence [%]', SQLERRM;
    END;
    PERFORM pg_temp.act(NULL);

    v_event := pg_temp.sitting('tracked', interval '25 hours', true);
    INSERT INTO projects.session_attendance (session_event_id, user_id, joined_at, source)
    VALUES (v_event, v_host, now() - interval '26 hours', 'webhook'),
           (v_event, current_setting('probe.a')::uuid, now() - interval '26 hours', 'webhook');
    PERFORM pg_temp.act(current_setting('probe.a')::uuid);
    BEGIN
        PERFORM projects.answer_session_review(v_event, true);
        RAISE EXCEPTION 'FAIL 5 a sitting with evidence took an answer';
    EXCEPTION WHEN SQLSTATE 'PS409' THEN
        RAISE NOTICE 'PASS 5 a sitting with evidence is not waiting for an answer [%]', SQLERRM;
    END;
    PERFORM pg_temp.act(NULL);
    PERFORM set_config('probe.tracked', v_event::text, true);
END $$;
-- #endregion

-- #region 6. Evidence still settles
DO $$
DECLARE
    v_event uuid := current_setting('probe.tracked')::uuid;
    v_noshow uuid := pg_temp.sitting('noshow', interval '2 hours', true);
BEGIN
    INSERT INTO projects.session_attendance (session_event_id, user_id, joined_at, source)
    VALUES (v_noshow, current_setting('probe.a')::uuid, now() - interval '3 hours', 'webhook');
    PERFORM pg_temp.sweep();
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'released', '6 a tracked sitting releases at +24 h');
    PERFORM pg_temp.check(pg_temp.escrow_status(v_noshow) = 'refunded', '6 a provider no-show refunds at once');
    PERFORM set_config('probe.noshow', v_noshow::text, true);
END $$;
-- #endregion

-- #region 7. S-09
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_event uuid := pg_temp.sitting('block', interval '-10 minutes');
    v jsonb;
BEGIN
    UPDATE projects.session_events
       SET start_time = now() - interval '5 minutes', end_time = now() + interval '55 minutes',
           attendee_join_url = 'https://zoom.us/j/block'
     WHERE id = v_event;
    UPDATE projects.cohort_memberships cm SET status = 'cancelled', cancelled_at = now()
      FROM projects.session_events se
     WHERE se.id = v_event AND cm.cohort_id = se.cohort_id;

    PERFORM pg_temp.check(projects.fn_seated_on(v_event, v_a), '7 a held sitting keeps its seat after the block is cancelled');
    -- As their session, but not as a client role: only definers may call this door.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    v := projects.session_join_link(v_event);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v ->> 'state' = 'open', '7 and its join link');
    PERFORM pg_temp.act(v_a);
    v := projects.claim_session_no_show(v_event, 'Probe');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v ->> 'dispute_id' IS NOT NULL, '7 and its no-show claim');

    UPDATE finance.escrows SET status = 'refunded' WHERE session_event_id = v_event;
    PERFORM pg_temp.check(NOT projects.fn_seated_on(v_event, v_a), '7 a cancelled seat with nothing held has no seat');
END $$;
-- #endregion

-- #region 8. Replay
DO $$
DECLARE
    v jsonb;
BEGIN
    PERFORM pg_temp.sweep();
    v := pg_temp.sweep();
    PERFORM pg_temp.check((v ->> 'released')::integer = 0 AND (v ->> 'refunded')::integer = 0
        AND (v ->> 'review_cases')::integer = 0, '8 replaying the sweep moves nothing twice');
END $$;
-- #endregion

ROLLBACK;
