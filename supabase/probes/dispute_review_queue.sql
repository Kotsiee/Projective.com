-- =============================================================================================
-- Probe: the operator side of the dispute lifecycle (00001260) — the review SLA (`review_by`, the
-- sweep's overdue alert) and the operator queue (`finance.list_disputes_for_review`).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/dispute_review_queue.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. Like
-- dispute_resolution.sql, each case builds its own untracked sitting + seat + held escrow on one
-- seeded project (its owner is the host), so the attendance audit is `ambiguous` and the claim lands
-- in `awaiting_response`.
--
--   1  every door into under_review stamps review_by = then + dispute_review_hours (72):
--      the claimant's escalation, the respondent's statement, the sweep's auto-escalation
--   2  ck_disputes_review_deadline: no under_review row without a review_by
--   3  the queue: operator only (42501 otherwise, anon has no EXECUTE), live rows only, oldest-due
--      first, filter by one live status, 22023 on anything else, counts over the whole live set
--   4  the review SLA: an overdue case is NOT ruled — the escrow stays held, the status stays
--      under_review; one ops.log_entries warn row and one dispute.review_overdue per operator, at
--      most once a day per case; the queue marks it overdue; a ruling still works and it leaves
--   5  get_dispute carries review_by; grants
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures and helpers (as postgres)
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

-- An untracked, ended sitting with a seat for p_user and a held 10,000 escrow; claims a no-show on it
-- as p_user (the audit is ambiguous → awaiting_response) and returns the dispute id.
CREATE FUNCTION pg_temp.case_for(p_tag text, p_user uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_project uuid := current_setting('probe.project')::uuid;
    v_stage uuid := current_setting('probe.stage')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v_cohort uuid; v_event uuid; v_member uuid; v_escrow uuid; v jsonb;
BEGIN
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (v_project, v_stage, 'Queue probe ' || p_tag) RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, p_user) RETURNING id INTO v_member;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_cohort, 'Queue probe sitting ' || p_tag, now() - interval '3 hours', now() - interval '2 hours')
    RETURNING id INTO v_event;
    INSERT INTO finance.escrows (project_stage_id, cohort_membership_id, payer_user_id, payee_type, payee_id,
                                 amount_cents, currency, status)
    VALUES (v_stage, v_member, p_user, 'freelancer', v_host, 10000, 'GBP', 'held')
    RETURNING id INTO v_escrow;
    PERFORM pg_temp.act(p_user);
    v := projects.claim_session_no_show(v_event, 'Queue probe: the host never came.');
    PERFORM pg_temp.act(NULL);
    RETURN (v ->> 'dispute_id')::uuid;
END $$;

-- The SQLSTATE a statement raises as p_user ('' when it does not raise).
CREATE FUNCTION pg_temp.state_of(p_user uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text := '';
BEGIN
    PERFORM pg_temp.act(p_user);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        v := SQLSTATE;
    END;
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

-- The queue as p_user sees it.
CREATE FUNCTION pg_temp.queue(p_user uuid, p_status text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    PERFORM pg_temp.act(p_user);
    v := finance.list_disputes_for_review(p_status);
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

DO $$
DECLARE v_project uuid; v_stage uuid; v_host uuid; v_a uuid; v_op uuid;
BEGIN
    SELECT p.id, p.owner_user_id, s.id INTO v_project, v_host, v_stage
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id IS NOT NULL
     ORDER BY p.id, s.id LIMIT 1;
    SELECT u.user_id INTO v_a FROM org.users_public u WHERE u.user_id <> v_host ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_op FROM org.users_public u WHERE u.user_id NOT IN (v_host, v_a)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm WHERE tm.user_id = u.user_id) ORDER BY u.user_id LIMIT 1;
    IF v_op IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a seeded project and three users (deno task db:reset)';
    END IF;
    -- Start from a known queue: nothing live left over from the seed.
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM finance.disputes
                                       WHERE status IN ('open', 'awaiting_response', 'under_review')),
        '0a no live dispute in the seed');
    INSERT INTO ops.admin_users (user_id) VALUES (v_op) ON CONFLICT DO NOTHING;
    PERFORM set_config('probe.project', v_project::text, true);
    PERFORM set_config('probe.stage', v_stage::text, true);
    PERFORM set_config('probe.host', v_host::text, true);
    PERFORM set_config('probe.a', v_a::text, true);
    PERFORM set_config('probe.op', v_op::text, true);
END $$;
-- #endregion

-- #region 1. Every door into under_review stamps the review SLA
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v_esc uuid; v_resp uuid; v_swept uuid; v_sweep jsonb; v_d finance.disputes;
BEGIN
    v_esc := pg_temp.case_for('esc', v_a);
    SELECT * INTO v_d FROM finance.disputes WHERE id = v_esc;
    PERFORM pg_temp.check(v_d.status = 'awaiting_response' AND v_d.review_by IS NULL,
        '1a an awaiting case has no review deadline yet');

    PERFORM pg_temp.act(v_a);
    PERFORM finance.escalate_dispute(v_esc);
    PERFORM pg_temp.act(NULL);
    SELECT * INTO v_d FROM finance.disputes WHERE id = v_esc;
    PERFORM pg_temp.check(v_d.status = 'under_review' AND v_d.review_by = now() + interval '72 hours',
        '1b an escalation stamps review_by = now + 72 h');

    v_resp := pg_temp.case_for('resp', v_a);
    PERFORM pg_temp.act(v_host);
    PERFORM finance.respond_to_dispute(v_resp, 'I was there; the room did not report it.');
    PERFORM pg_temp.act(NULL);
    SELECT * INTO v_d FROM finance.disputes WHERE id = v_resp;
    PERFORM pg_temp.check(v_d.status = 'under_review' AND v_d.review_by = now() + interval '72 hours',
        '1c the respondent''s statement stamps review_by');

    -- A second statement on an under_review case leaves its deadline where it was.
    UPDATE finance.disputes SET review_by = now() + interval '5 hours' WHERE id = v_resp;
    PERFORM pg_temp.act(v_host);
    PERFORM finance.respond_to_dispute(v_resp, 'One more thing.');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((SELECT review_by FROM finance.disputes WHERE id = v_resp) = now() + interval '5 hours',
        '1d a later statement does not move review_by');

    v_swept := pg_temp.case_for('swept', v_a);
    UPDATE finance.disputes SET respond_by = now() - interval '1 minute' WHERE id = v_swept;
    v_sweep := finance.sweep_disputes(now() + interval '1 hour');
    SELECT * INTO v_d FROM finance.disputes WHERE id = v_swept;
    PERFORM pg_temp.check(v_d.status = 'under_review' AND v_d.review_by = now() + interval '73 hours'
                          AND (v_sweep ->> 'escalated')::int = 1 AND (v_sweep ->> 'overdue')::int = 0,
        '1e the auto-escalation stamps review_by = p_now + 72 h');

    -- The window is a platform param.
    INSERT INTO security.platform_params (key, value, description)
    VALUES ('dispute_review_hours', '24'::jsonb, 'probe') ON CONFLICT (key) DO UPDATE SET value = '24'::jsonb;
    PERFORM pg_temp.check(finance.fn_dispute_review_by(now()) = now() + interval '24 hours',
        '1f dispute_review_hours drives the window');
    UPDATE security.platform_params SET value = '72'::jsonb WHERE key = 'dispute_review_hours';

    PERFORM set_config('probe.esc', v_esc::text, true);
    PERFORM set_config('probe.resp', v_resp::text, true);
    PERFORM set_config('probe.swept', v_swept::text, true);
END $$;
-- #endregion

-- #region 2. No under_review row without a review deadline
DO $$
DECLARE
    v_id uuid := pg_temp.case_for('ck', current_setting('probe.a')::uuid);
BEGIN
    PERFORM pg_temp.check(pg_temp.state_of(NULL, format(
        'UPDATE finance.disputes SET status = %L WHERE id = %L', 'under_review', v_id)) = '23514',
        '2a ck_disputes_review_deadline refuses an under_review row with no review_by');
    PERFORM set_config('probe.ck', v_id::text, true);
END $$;
-- #endregion

-- #region 3. The operator queue
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v_op uuid := current_setting('probe.op')::uuid;
    v jsonb; v_item jsonb; v_ids uuid[];
BEGIN
    PERFORM pg_temp.check(pg_temp.state_of(v_a, 'SELECT finance.list_disputes_for_review()') = '42501',
        '3a a party is refused the queue');
    PERFORM pg_temp.check(pg_temp.state_of(v_host, 'SELECT finance.list_disputes_for_review()') = '42501',
        '3b the respondent is refused the queue');
    PERFORM pg_temp.check(NOT has_function_privilege('anon', 'finance.list_disputes_for_review(text)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'finance.list_disputes_for_review(text)', 'EXECUTE'),
        '3c anon cannot call it; signed-in callers can (and are checked inside)');
    PERFORM pg_temp.check(pg_temp.state_of(v_op, format('SELECT finance.list_disputes_for_review(%L)', 'resolved_refund'))
        = '22023', '3d a non-live status filter is refused');

    v := pg_temp.queue(v_op);
    PERFORM pg_temp.check((v -> 'counts' ->> 'under_review')::int = 3
                          AND (v -> 'counts' ->> 'awaiting_response')::int = 1
                          AND (v -> 'counts' ->> 'open')::int = 0
                          AND (v -> 'counts' ->> 'overdue')::int = 0,
        '3e counts: three under review, one awaiting, none overdue');
    SELECT array_agg((e ->> 'id')::uuid ORDER BY o) INTO v_ids
      FROM jsonb_array_elements(v -> 'items') WITH ORDINALITY AS t(e, o);
    PERFORM pg_temp.check(v_ids = ARRAY[current_setting('probe.resp')::uuid, current_setting('probe.esc')::uuid,
                                        current_setting('probe.swept')::uuid, current_setting('probe.ck')::uuid],
        '3f oldest-due first: under_review by review_by, then awaiting_response');

    SELECT e INTO v_item FROM jsonb_array_elements(v -> 'items') e
     WHERE e ->> 'id' = current_setting('probe.resp');
    PERFORM pg_temp.check(v_item ->> 'status' = 'under_review' AND v_item ->> 'kind' = 'no_show'
                          AND (v_item ->> 'amount_minor')::int = 10000 AND v_item ->> 'currency' = 'GBP'
                          AND (v_item ->> 'statements')::int = 2 AND (v_item ->> 'evidence')::int = 0
                          AND (v_item ->> 'overdue')::boolean = false
                          AND v_item -> 'sitting' ->> 'title' = 'Queue probe sitting resp'
                          AND v_item -> 'project' ->> 'slug' IS NOT NULL
                          AND v_item -> 'claimant' ? 'name' AND v_item -> 'respondent' ? 'handle',
        '3g an item carries status, money, sitting, parties and the statement count');

    v := pg_temp.queue(v_op, 'awaiting_response');
    PERFORM pg_temp.check(jsonb_array_length(v -> 'items') = 1
                          AND v -> 'items' -> 0 ->> 'id' = current_setting('probe.ck')
                          AND (v -> 'counts' ->> 'under_review')::int = 3,
        '3h a status filter narrows the items, not the counts');
END $$;
-- #endregion

-- #region 4. The review SLA alerts and never rules
DO $$
DECLARE
    v_op uuid := current_setting('probe.op')::uuid;
    v_a uuid := current_setting('probe.a')::uuid;
    v_id uuid := current_setting('probe.esc')::uuid;
    v_escrow uuid; v_sweep jsonb; v jsonb; v_item jsonb;
BEGIN
    SELECT escrow_id INTO v_escrow FROM finance.disputes WHERE id = v_id;
    UPDATE finance.disputes SET review_by = now() - interval '1 minute' WHERE id = v_id;

    v_sweep := finance.sweep_disputes();
    PERFORM pg_temp.check((v_sweep ->> 'overdue')::int = 1, '4a the sweep counts one overdue case');
    PERFORM pg_temp.check((SELECT status FROM finance.disputes WHERE id = v_id) = 'under_review'
                          AND (SELECT resolved_at FROM finance.disputes WHERE id = v_id) IS NULL
                          AND (SELECT status FROM finance.escrows WHERE id = v_escrow) = 'held',
        '4b an overdue case is not ruled: still under review, the escrow still held');
    PERFORM pg_temp.check((SELECT count(*) FROM ops.log_entries l
                            WHERE l.client_id = 'dispute:review_overdue:' || v_id
                              AND l.level = 'warn' AND l.source = 'server'
                              AND l.scope = 'finance.sweep_disputes'
                              AND l.data ->> 'dispute_id' = v_id::text) = 1,
        '4c one ops alert row');
    PERFORM pg_temp.check((SELECT count(*) FROM comms.notifications n
                            WHERE n.entity_id = v_id AND n.type = 'dispute.review_overdue' AND n.user_id = v_op) = 1
                          AND NOT EXISTS (SELECT 1 FROM comms.notifications n
                                           WHERE n.entity_id = v_id AND n.type = 'dispute.review_overdue'
                                             AND n.user_id <> v_op),
        '4d the operator is told, nobody else');
    PERFORM pg_temp.check((SELECT review_alerted_at FROM finance.disputes WHERE id = v_id) = now(),
        '4e review_alerted_at stamped');

    -- (At +23 h the `resp` case, due at +5 h, is overdue too — it alerts for itself, not for this one.)
    v_sweep := finance.sweep_disputes(now() + interval '23 hours');
    PERFORM pg_temp.check((SELECT count(*) FROM ops.log_entries l
                            WHERE l.client_id = 'dispute:review_overdue:' || v_id) = 1
                          AND (SELECT count(*) FROM ops.log_entries l
                                WHERE l.client_id = 'dispute:review_overdue:' || current_setting('probe.resp')) = 1,
        '4f no second alert for a case within the day; each overdue case alerts for itself');
    v_sweep := finance.sweep_disputes(now() + interval '25 hours');
    PERFORM pg_temp.check((v_sweep ->> 'overdue')::int = 1
                          AND (SELECT count(*) FROM ops.log_entries l
                                WHERE l.client_id = 'dispute:review_overdue:' || v_id) = 2
                          AND (SELECT status FROM finance.disputes WHERE id = v_id) = 'under_review',
        '4g a day later it alerts again, and still does not rule');

    v := pg_temp.queue(v_op);
    SELECT e INTO v_item FROM jsonb_array_elements(v -> 'items') e WHERE e ->> 'id' = v_id::text;
    PERFORM pg_temp.check((v_item ->> 'overdue')::boolean AND (v -> 'counts' ->> 'overdue')::int = 1
                          AND v -> 'items' -> 0 ->> 'id' = v_id::text,
        '4h the queue marks it overdue and puts it first');

    PERFORM pg_temp.act(v_op);
    v := finance.resolve_dispute(v_id, 'split', 5000, 'Both accounts are plausible; split evenly.');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((SELECT status FROM finance.disputes WHERE id = v_id) = 'resolved_split'
                          AND (SELECT status FROM finance.escrows WHERE id = v_escrow) <> 'held',
        '4i an operator can still rule on an overdue case');
    v := pg_temp.queue(v_op);
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'items') e WHERE e ->> 'id' = v_id::text)
                          AND (v -> 'counts' ->> 'overdue')::int = 0,
        '4j a ruled case leaves the queue');
    v_sweep := finance.sweep_disputes(now() + interval '3 days');
    PERFORM pg_temp.check((SELECT count(*) FROM ops.log_entries l
                            WHERE l.client_id = 'dispute:review_overdue:' || v_id) = 2,
        '4k a resolved case never alerts again');
END $$;
-- #endregion

-- #region 5. The case read and the grants
DO $$
DECLARE
    v_op uuid := current_setting('probe.op')::uuid;
    v_a uuid := current_setting('probe.a')::uuid;
    v jsonb;
BEGIN
    PERFORM pg_temp.act(v_op);
    v := finance.get_dispute(current_setting('probe.resp')::uuid);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v ->> 'role' = 'operator' AND (v ->> 'can_resolve')::boolean
                          AND (v ->> 'review_by')::timestamptz = now() + interval '5 hours',
        '5a get_dispute gives the operator review_by and the ruling door');
    PERFORM pg_temp.act(v_a);
    v := finance.get_dispute(current_setting('probe.resp')::uuid);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v ->> 'role' = 'claimant' AND NOT (v ->> 'can_resolve')::boolean,
        '5b a party reads the case without the ruling door');
    PERFORM pg_temp.check(NOT has_function_privilege('authenticated', 'finance.fn_dispute_review_by(timestamptz)', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'finance.fn_dispute_review_by(timestamptz)', 'EXECUTE'),
        '5c the SLA helper is internal');
END $$;
-- #endregion

ROLLBACK;
