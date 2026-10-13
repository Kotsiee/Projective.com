-- =============================================================================================
-- Probe: the dispute lifecycle (00001260, Decision #212) — every resolution branch.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/dispute_resolution.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. The seed has no
-- cohorts, so each case builds its own sitting + seat + held escrow on one seeded project (its owner is
-- the host), and switches identity with set_config('role' / 'request.jwt.claims') inside the block.
--
--   1  audit → resolved_refund   tracked room, the host never joined (provider_no_show)
--   2  audit → resolved_release  both in the room the whole sitting; seat completes, escrow released
--   3  audit → resolved_release  deferred: a whole-cohort seat with a sitting still ahead stays held
--   4  ambiguous → awaiting_response → respond (claimant, then respondent + evidence) → under_review →
--      operator split 25 %; evidence readable by the parties only; evidence undeletable while live;
--      the ruling is final, the rows immutable and undeletable
--   5  awaiting_response past respond_by → sweep → under_review → operator refund
--   6  escalate by a party → under_review → operator release
--   7  open while the sitting runs: escalate refused, sweep waits; after it ends the sweep audits it
--   8  settled by fact: the escrow refunded outside the dispute → sweep closes it resolved_refund
--   9  per-sitting escrow (Decision #211): a dismissal releases now even with a sitting ahead
--  10  idempotency, refusals and grants
--  11  the session workspace: the caller's claims and the sitting they may report
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

-- A cohort with one sitting [p_start, p_end) — tracked when p_room — a seat for p_user and a held
-- escrow of 10,000 minor units on it. p_ahead adds a later sitting; p_per_sitting binds the escrow to
-- the first sitting (Decision #211). Returns (event, escrow, membership) via set_config.
CREATE FUNCTION pg_temp.seat(
    p_tag text, p_user uuid, p_start timestamptz, p_end timestamptz, p_room boolean,
    p_ahead boolean DEFAULT false, p_per_sitting boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_project uuid := current_setting('probe.project')::uuid;
    v_stage uuid := current_setting('probe.stage')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v_cohort uuid; v_event uuid; v_member uuid; v_escrow uuid;
BEGIN
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (v_project, v_stage, 'Probe ' || p_tag) RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, p_user) RETURNING id INTO v_member;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, meeting_provider, provider_meeting_id)
    VALUES (v_cohort, 'Probe sitting ' || p_tag, p_start, p_end,
            CASE WHEN p_room THEN 'zoom' END, CASE WHEN p_room THEN 'probe-room-' || p_tag END)
    RETURNING id INTO v_event;
    IF p_ahead THEN
        INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
        VALUES (v_cohort, 'Probe later ' || p_tag, now() + interval '2 days', now() + interval '2 days 1 hour');
    END IF;
    INSERT INTO finance.escrows (project_stage_id, cohort_membership_id, session_event_id, payer_user_id,
                                 payee_type, payee_id, amount_cents, currency, status)
    VALUES (v_stage, v_member, CASE WHEN p_per_sitting THEN v_event END, p_user,
            'freelancer', v_host, 10000, 'GBP', 'held')
    RETURNING id INTO v_escrow;
    PERFORM set_config('probe.event', v_event::text, true);
    PERFORM set_config('probe.escrow', v_escrow::text, true);
    PERFORM set_config('probe.member', v_member::text, true);
END $$;

-- A webhook presence row (the provider's evidence) for p_user on the current probe sitting.
CREATE FUNCTION pg_temp.presence(p_user uuid, p_join timestamptz, p_left timestamptz) RETURNS void
LANGUAGE sql AS $$
    INSERT INTO projects.session_attendance (session_event_id, user_id, joined_at, left_at, source, provider_event_id)
    VALUES (current_setting('probe.event')::uuid, p_user, p_join, p_left, 'webhook', gen_random_uuid()::text);
$$;

-- The caller's claim on the current probe sitting.
CREATE FUNCTION pg_temp.claim(p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    PERFORM pg_temp.act(p_user);
    v := projects.claim_session_no_show(current_setting('probe.event')::uuid, 'Probe: the host never came.');
    PERFORM pg_temp.act(NULL);
    RETURN v;
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

DO $$
DECLARE v_project uuid; v_stage uuid; v_host uuid; v_a uuid; v_c uuid; v_op uuid;
BEGIN
    SELECT p.id, p.owner_user_id, s.id INTO v_project, v_host, v_stage
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id IS NOT NULL
     ORDER BY p.id, s.id LIMIT 1;
    SELECT u.user_id INTO v_a FROM org.users_public u WHERE u.user_id <> v_host ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_c FROM org.users_public u WHERE u.user_id NOT IN (v_host, v_a) ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_op FROM org.users_public u WHERE u.user_id NOT IN (v_host, v_a, v_c)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm WHERE tm.user_id = u.user_id) ORDER BY u.user_id LIMIT 1;
    IF v_op IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a seeded project and four users (deno task db:reset)';
    END IF;
    INSERT INTO ops.admin_users (user_id) VALUES (v_op) ON CONFLICT DO NOTHING;
    PERFORM set_config('probe.project', v_project::text, true);
    PERFORM set_config('probe.stage', v_stage::text, true);
    PERFORM set_config('probe.host', v_host::text, true);
    PERFORM set_config('probe.a', v_a::text, true);
    PERFORM set_config('probe.c', v_c::text, true);
    PERFORM set_config('probe.op', v_op::text, true);
END $$;
-- #endregion

-- #region 1. Audit → resolved_refund (provider no-show on a tracked room)
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v jsonb; v_d finance.disputes;
BEGIN
    PERFORM pg_temp.seat('r1', v_a, now() - interval '2 hours', now() - interval '1 hour', true);
    PERFORM pg_temp.presence(v_a, now() - interval '2 hours', NULL);
    v := pg_temp.claim(v_a);
    SELECT * INTO v_d FROM finance.disputes WHERE id = (v ->> 'dispute_id')::uuid;
    PERFORM pg_temp.check(v_d.status = 'resolved_refund' AND v ->> 'status' = 'resolved_refund', '1a no-show audit rules refund');
    PERFORM pg_temp.check(v_d.resolved_by IS NULL AND v_d.audit ->> 'verdict' = 'refund' AND v_d.resolved_at IS NOT NULL,
        '1b the platform ruled, audit snapshot kept');
    PERFORM pg_temp.check((SELECT status FROM finance.escrows WHERE id = v_d.escrow_id) = 'refunded', '1c escrow refunded');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM finance.transactions t WHERE t.ref_id = v_d.escrow_id
                                   AND t.reason = 'escrow_refund' AND t.amount_cents = 10000), '1d payer credited 10,000');
    PERFORM pg_temp.check((SELECT status FROM projects.cohort_memberships WHERE id = current_setting('probe.member')::uuid)
                          = 'cancelled', '1e seat cancelled');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM comms.notifications n WHERE n.entity_id = v_d.id AND n.user_id = v_host
                                   AND n.type = 'dispute.opened'), '1f host told a claim was opened');
    PERFORM pg_temp.check((SELECT count(*) FROM comms.notifications n WHERE n.entity_id = v_d.id
                            AND n.type = 'dispute.resolved' AND n.user_id IN (v_a, v_host)) = 2, '1g both parties told the ruling');
    PERFORM pg_temp.check(NOT finance.fn_escrow_has_open_dispute(v_d.escrow_id), '1h nothing open on the escrow');
END $$;
-- #endregion

-- #region 2. Audit → resolved_release (both present ≥ 80 %), cohort over
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v jsonb; v_d finance.disputes;
BEGIN
    PERFORM pg_temp.seat('r2', v_a, now() - interval '3 hours', now() - interval '2 hours', true);
    PERFORM pg_temp.presence(v_a, now() - interval '3 hours', now() - interval '2 hours');
    PERFORM pg_temp.presence(v_host, now() - interval '3 hours', NULL);
    v := pg_temp.claim(v_a);
    SELECT * INTO v_d FROM finance.disputes WHERE id = (v ->> 'dispute_id')::uuid;
    PERFORM pg_temp.check(v_d.status = 'resolved_release' AND v_d.audit ->> 'verdict' = 'dismiss'
                          AND (v_d.audit ->> 'host_presence_pct')::int = 100, '2a full room dismisses the claim');
    PERFORM pg_temp.check((SELECT status FROM finance.escrows WHERE id = v_d.escrow_id) = 'released'
                          AND (v_d.settlement ->> 'payee_minor')::bigint > 0, '2b escrow released to the host');
    PERFORM pg_temp.check((SELECT status FROM projects.cohort_memberships WHERE id = current_setting('probe.member')::uuid)
                          = 'completed', '2c seat completed');
END $$;

-- A host-attested claimant row cannot dismiss a claim (only the provider's webhook counts).
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v jsonb;
BEGIN
    PERFORM pg_temp.seat('r2b', v_a, now() - interval '3 hours', now() - interval '2 hours', true);
    PERFORM pg_temp.presence(v_host, now() - interval '3 hours', NULL);
    INSERT INTO projects.session_attendance (session_event_id, user_id, joined_at, source)
    VALUES (current_setting('probe.event')::uuid, v_a, now() - interval '3 hours', 'host');
    v := pg_temp.claim(v_a);
    PERFORM pg_temp.check(v ->> 'status' = 'awaiting_response', '2d a host attestation does not dismiss');
END $$;
-- #endregion

-- #region 3. Dismissal deferred: a whole-cohort seat with a sitting still ahead
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v jsonb; v_d finance.disputes;
BEGIN
    PERFORM pg_temp.seat('r3', v_a, now() - interval '3 hours', now() - interval '2 hours', true, true);
    PERFORM pg_temp.presence(v_a, now() - interval '3 hours', NULL);
    PERFORM pg_temp.presence(v_host, now() - interval '3 hours', NULL);
    v := pg_temp.claim(v_a);
    SELECT * INTO v_d FROM finance.disputes WHERE id = (v ->> 'dispute_id')::uuid;
    PERFORM pg_temp.check(v_d.status = 'resolved_release' AND (v_d.settlement ->> 'deferred')::boolean,
        '3a dismissed, release deferred');
    PERFORM pg_temp.check((SELECT status FROM finance.escrows WHERE id = v_d.escrow_id) = 'held'
                          AND NOT finance.fn_escrow_has_open_dispute(v_d.escrow_id),
        '3b escrow still held for the later sitting, no longer blocked');
    PERFORM pg_temp.check((SELECT status FROM projects.cohort_memberships WHERE id = current_setting('probe.member')::uuid)
                          = 'active', '3c seat stays active');
END $$;
-- #endregion

-- #region 4. Ambiguous → respond → under_review → operator split; evidence; finality
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_c uuid := current_setting('probe.c')::uuid;
    v_op uuid := current_setting('probe.op')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v jsonb; v_id uuid; v_d finance.disputes; v_file uuid; v_read jsonb;
    v_payer_before bigint; v_split record;
BEGIN
    PERFORM pg_temp.seat('r4', v_a, now() - interval '3 hours', now() - interval '2 hours', false);
    v := pg_temp.claim(v_a);
    v_id := (v ->> 'dispute_id')::uuid;
    SELECT * INTO v_d FROM finance.disputes WHERE id = v_id;
    PERFORM pg_temp.check(v_d.status = 'awaiting_response' AND v_d.audit ->> 'verdict' = 'ambiguous'
                          AND v_d.respond_by BETWEEN now() + interval '47 hours' AND now() + interval '49 hours',
        '4a untracked room → awaiting_response, 48h deadline');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM comms.notifications n WHERE n.entity_id = v_id AND n.user_id = v_host
                                   AND n.type = 'dispute.response_requested'), '4b host asked to respond');

    -- A stranger sees nothing and can do nothing.
    PERFORM pg_temp.act(v_c);
    PERFORM pg_temp.check(finance.get_dispute(v_id) IS NULL, '4c stranger reads nothing');
    PERFORM pg_temp.check((SELECT count(*) FROM finance.disputes WHERE id = v_id) = 0, '4d stranger blocked by RLS');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(pg_temp.state_of(v_c, format('SELECT finance.respond_to_dispute(%L, %L)', v_id, 'hi')) = 'P0002',
        '4e stranger cannot respond');

    -- The claimant adds a statement: still waiting on the respondent.
    PERFORM pg_temp.act(v_a);
    v := finance.respond_to_dispute(v_id, 'I waited twenty minutes; nobody came.');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v ->> 'status' = 'awaiting_response', '4f claimant statement keeps awaiting_response');

    -- The respondent answers with a file: under_review.
    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name, mime_type, size_bytes, status)
    VALUES (v_host, 'personal', v_host || '/probe-evidence.png', 'evidence.png', 'evidence.png', 'image/png', 10, 'uploaded')
    RETURNING id INTO v_file;
    PERFORM pg_temp.check(pg_temp.state_of(v_host, format('SELECT finance.respond_to_dispute(%L, %L, ARRAY[%L]::uuid[])',
        v_id, 'x', gen_random_uuid())) = '22023', '4g only your own uploaded files are evidence');
    PERFORM pg_temp.act(v_host);
    v := finance.respond_to_dispute(v_id, 'I was in the room; screenshot attached.', ARRAY[v_file]);
    PERFORM pg_temp.act(NULL);
    SELECT * INTO v_d FROM finance.disputes WHERE id = v_id;
    PERFORM pg_temp.check(v_d.status = 'under_review' AND v_d.responded_at IS NOT NULL AND v_d.escalated_at IS NOT NULL,
        '4h respondent answer → under_review');
    PERFORM pg_temp.check((SELECT count(*) FROM comms.notifications n WHERE n.entity_id = v_id
                            AND n.type = 'dispute.escalated') = 2, '4i both told it went to an auditor');

    -- The evidence: the claimant and the operator read it, a stranger does not; get_dispute lists it.
    PERFORM pg_temp.act(v_a);
    PERFORM pg_temp.check(files.fn_can_read(v_file), '4j claimant can open the respondent''s evidence');
    v_read := finance.get_dispute(v_id);
    -- Both statements share one transaction's now(), so their order is not asserted.
    PERFORM pg_temp.check(v_read ->> 'role' = 'claimant' AND jsonb_array_length(v_read -> 'messages') = 2
                          AND (SELECT count(*) FROM jsonb_array_elements(v_read -> 'messages') m
                                WHERE m ->> 'party' = 'respondent' AND NOT (m ->> 'mine')::boolean
                                  AND jsonb_array_length(m -> 'files') = 1) = 1
                          AND NOT (v_read ->> 'can_resolve')::boolean, '4k claimant read: two statements, one file');
    PERFORM pg_temp.act(v_c);
    PERFORM pg_temp.check(NOT files.fn_can_read(v_file), '4l stranger cannot open the evidence');
    PERFORM pg_temp.act(v_op);
    PERFORM pg_temp.check(files.fn_can_read(v_file) AND (finance.get_dispute(v_id) ->> 'role') = 'operator'
                          AND (finance.get_dispute(v_id) ->> 'can_resolve')::boolean, '4m operator reads and may rule');
    PERFORM pg_temp.act(NULL);

    -- Evidence in a live case cannot be deleted.
    PERFORM pg_temp.check(pg_temp.state_of(NULL, format('UPDATE files.items SET deleted_at = now() WHERE id = %L', v_file))
                          = 'PS409', '4n evidence undeletable while the case is live');

    -- Only an operator rules; a party is refused.
    PERFORM pg_temp.check(pg_temp.state_of(v_a, format('SELECT finance.resolve_dispute(%L, %L, NULL, %L)', v_id, 'refund', 'mine'))
                          = '42501', '4o a party cannot rule');
    PERFORM pg_temp.check(pg_temp.state_of(v_op, format('SELECT finance.resolve_dispute(%L, %L, 25000, %L)', v_id, 'split', 'too much'))
                          = '22023', '4p split share out of range refused');
    PERFORM pg_temp.check(pg_temp.state_of(v_op, format('SELECT finance.resolve_dispute(%L, %L, 2500, NULL)', v_id, 'split'))
                          = '22023', '4q a ruling needs reasons');

    SELECT * INTO v_split FROM finance.fn_fair_exit_split(10000, 2500,
        finance.fn_escrow_fee_bp(NULL, v_a));
    PERFORM pg_temp.act(v_op);
    v := finance.resolve_dispute(v_id, 'split', 2500, 'Both accounts are credible; the provider joined late.');
    PERFORM pg_temp.act(NULL);
    SELECT * INTO v_d FROM finance.disputes WHERE id = v_id;
    PERFORM pg_temp.check(v_d.status = 'resolved_split' AND v_d.payee_share_bp = 2500 AND v_d.resolved_by = v_op,
        '4r operator split recorded');
    PERFORM pg_temp.check((v_d.settlement ->> 'payee_minor')::bigint = v_split.payout_cents
                          AND (v_d.settlement ->> 'refund_minor')::bigint = v_split.refund_cents
                          AND (v_d.settlement ->> 'fee_minor')::bigint = v_split.fee_cents,
        format('4s split figures match fn_fair_exit_split (%s / %s / %s)', v_split.payout_cents, v_split.fee_cents, v_split.refund_cents));
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM finance.transactions t WHERE t.ref_id = v_d.escrow_id
                                   AND t.reason = 'escrow_refund' AND t.amount_cents = v_split.refund_cents),
        '4t payer refunded the unearned share');
    PERFORM pg_temp.check((SELECT status FROM finance.escrows WHERE id = v_d.escrow_id) = 'released'
                          AND (SELECT status FROM projects.cohort_memberships WHERE id = current_setting('probe.member')::uuid) = 'completed',
        '4u escrow settled, seat completed (the provider was paid a share)');

    -- Final and immutable.
    PERFORM pg_temp.check(pg_temp.state_of(v_op, format('SELECT finance.resolve_dispute(%L, %L, NULL, %L)', v_id, 'refund', 'again'))
                          = 'PS409', '4v a second ruling is refused');
    PERFORM pg_temp.check(pg_temp.state_of(NULL, format('UPDATE finance.disputes SET status = %L WHERE id = %L', 'open', v_id))
                          = '42501', '4w a resolved row cannot be rewritten, even by the owner');
    PERFORM pg_temp.check(pg_temp.state_of(NULL, format('DELETE FROM finance.disputes WHERE id = %L', v_id)) = '42501'
                          AND pg_temp.state_of(NULL, format('DELETE FROM finance.dispute_messages WHERE dispute_id = %L', v_id)) = '42501'
                          AND pg_temp.state_of(NULL, format('UPDATE finance.dispute_evidence SET created_at = now() WHERE dispute_id = %L', v_id)) = '42501',
        '4x disputes, statements and evidence are never deleted or rewritten');
    PERFORM pg_temp.check(pg_temp.state_of(v_a, format('SELECT finance.respond_to_dispute(%L, %L)', v_id, 'late')) = 'PS409',
        '4y no statements after the ruling');
    PERFORM pg_temp.check(pg_temp.state_of(NULL, format('UPDATE files.items SET deleted_at = now() WHERE id = %L', v_file)) = '',
        '4z evidence deletable once resolved');
END $$;
-- #endregion

-- #region 5. Auto-escalation past respond_by → operator refund
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_op uuid := current_setting('probe.op')::uuid;
    v jsonb; v_id uuid; v_sweep jsonb;
BEGIN
    PERFORM pg_temp.seat('r5', v_a, now() - interval '3 hours', now() - interval '2 hours', false);
    v_id := (pg_temp.claim(v_a) ->> 'dispute_id')::uuid;
    UPDATE finance.disputes SET respond_by = now() - interval '1 minute' WHERE id = v_id;
    v_sweep := finance.sweep_disputes();
    PERFORM pg_temp.check((SELECT status FROM finance.disputes WHERE id = v_id) = 'under_review'
                          AND (v_sweep ->> 'escalated')::int >= 1, '5a deadline passed → under_review by the sweep');
    PERFORM pg_temp.act(v_op);
    v := finance.resolve_dispute(v_id, 'refund', NULL, 'No response and no logs; refunded.');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((SELECT status FROM finance.disputes WHERE id = v_id) = 'resolved_refund'
                          AND (SELECT status FROM finance.escrows WHERE id = current_setting('probe.escrow')::uuid) = 'refunded',
        '5b operator refund settles the escrow');
END $$;
-- #endregion

-- #region 6. A party escalates → operator release
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_op uuid := current_setting('probe.op')::uuid;
    v jsonb; v_id uuid;
BEGIN
    PERFORM pg_temp.seat('r6', v_a, now() - interval '3 hours', now() - interval '2 hours', false);
    v_id := (pg_temp.claim(v_a) ->> 'dispute_id')::uuid;
    PERFORM pg_temp.act(v_a);
    v := finance.escalate_dispute(v_id);
    v := finance.escalate_dispute(v_id);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v ->> 'status' = 'under_review', '6a claimant escalates (idempotent)');
    PERFORM pg_temp.act(v_op);
    v := finance.resolve_dispute(v_id, 'release', NULL, 'The provider''s calendar and messages show attendance.');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((SELECT status FROM finance.disputes WHERE id = v_id) = 'resolved_release'
                          AND (SELECT status FROM finance.escrows WHERE id = current_setting('probe.escrow')::uuid) = 'released',
        '6b operator release pays the provider');
END $$;
-- #endregion

-- #region 7. Open while the sitting runs; the sweep audits it once it ends
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_id uuid;
BEGIN
    PERFORM pg_temp.seat('r7', v_a, now() - interval '10 minutes', now() + interval '50 minutes', false);
    v_id := (pg_temp.claim(v_a) ->> 'dispute_id')::uuid;
    PERFORM pg_temp.check((SELECT status FROM finance.disputes WHERE id = v_id) = 'open', '7a claim mid-sitting stays open');
    PERFORM pg_temp.check(pg_temp.state_of(v_a, format('SELECT finance.escalate_dispute(%L)', v_id)) = 'PS409',
        '7b cannot escalate before the audit');
    PERFORM finance.sweep_disputes();
    PERFORM pg_temp.check((SELECT status FROM finance.disputes WHERE id = v_id) = 'open', '7c sweep waits for the end');
    UPDATE projects.session_events SET start_time = now() - interval '2 hours', end_time = now() - interval '1 hour'
     WHERE id = current_setting('probe.event')::uuid;
    PERFORM finance.sweep_disputes();
    PERFORM pg_temp.check((SELECT status FROM finance.disputes WHERE id = v_id) = 'awaiting_response',
        '7d sweep audits it after the sitting ends');
    PERFORM pg_temp.check(finance.fn_escrow_has_open_dispute(current_setting('probe.escrow')::uuid),
        '7e the live claim blocks release');
END $$;
-- #endregion

-- #region 8. Settled by fact
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_id uuid; v_d finance.disputes;
BEGIN
    PERFORM pg_temp.seat('r8', v_a, now() - interval '3 hours', now() - interval '2 hours', false);
    v_id := (pg_temp.claim(v_a) ->> 'dispute_id')::uuid;
    PERFORM finance.fn_refund_seat_escrow(current_setting('probe.escrow')::uuid);
    PERFORM finance.sweep_disputes();
    SELECT * INTO v_d FROM finance.disputes WHERE id = v_id;
    PERFORM pg_temp.check(v_d.status = 'resolved_refund' AND (v_d.settlement ->> 'by_fact')::boolean,
        '8a a dispute whose escrow was refunded elsewhere closes resolved_refund');
END $$;
-- #endregion

-- #region 9. Per-sitting escrow: dismissal releases now
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v jsonb;
BEGIN
    PERFORM pg_temp.seat('r9', v_a, now() - interval '3 hours', now() - interval '2 hours', true, true, true);
    PERFORM pg_temp.presence(v_a, now() - interval '3 hours', NULL);
    PERFORM pg_temp.presence(v_host, now() - interval '3 hours', NULL);
    v := pg_temp.claim(v_a);
    PERFORM pg_temp.check(v ->> 'status' = 'resolved_release'
                          AND (SELECT status FROM finance.escrows WHERE id = current_setting('probe.escrow')::uuid) = 'released',
        '9a a sitting''s own escrow is released at once');
END $$;
-- #endregion

-- #region 11. The session workspace lists the caller's claims and the sitting they may report
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v_ws jsonb;
BEGIN
    UPDATE projects.projects SET format = 'session' WHERE id = current_setting('probe.project')::uuid;
    PERFORM pg_temp.seat('r11', v_a, now() - interval '30 minutes', now() + interval '30 minutes', false);
    PERFORM pg_temp.act(v_host);
    v_ws := projects.get_session_workspace(current_setting('probe.project')::uuid);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v_ws ->> 'role' = 'host' AND jsonb_array_length(v_ws -> 'disputes') >= 10
                          AND v_ws -> 'claimable_sitting_id' = 'null'::jsonb, '11a host sees every claim, reports none');
    PERFORM pg_temp.act(v_a);
    v_ws := projects.get_session_workspace(current_setting('probe.project')::uuid);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v_ws IS NOT NULL AND v_ws ->> 'claimable_sitting_id' = current_setting('probe.event'),
        '11b attendee may report the running sitting');
    PERFORM pg_temp.claim(v_a);
    PERFORM pg_temp.act(v_a);
    v_ws := projects.get_session_workspace(current_setting('probe.project')::uuid);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((v_ws ->> 'claimable_sitting_id') IS DISTINCT FROM current_setting('probe.event')
                          AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_ws -> 'disputes') x
                                       WHERE x ->> 'session_event_id' = current_setting('probe.event')
                                         AND x ->> 'status' = 'open' AND (x ->> 'mine')::boolean),
        '11c once claimed: listed as open, no longer reportable');
END $$;
-- #endregion

-- #region 10. Idempotency, refusals and grants
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v1 jsonb; v2 jsonb;
BEGIN
    PERFORM pg_temp.seat('r10', v_a, now() - interval '3 hours', now() - interval '2 hours', false);
    v1 := pg_temp.claim(v_a);
    v2 := pg_temp.claim(v_a);
    PERFORM pg_temp.check(v1 ->> 'dispute_id' = v2 ->> 'dispute_id', '10a a second claim returns the first');

    PERFORM pg_temp.seat('r10b', v_a, now() + interval '1 hour', now() + interval '2 hours', false);
    PERFORM pg_temp.check(pg_temp.state_of(v_a, format('SELECT projects.claim_session_no_show(%L)',
        current_setting('probe.event'))) = 'PS409', '10b no claim before the sitting starts');

    PERFORM pg_temp.check(NOT has_function_privilege('authenticated', 'finance.fn_settle_dispute(uuid, text, integer, uuid, text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'finance.fn_split_seat_escrow(uuid, integer)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'finance.sweep_disputes(timestamptz)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'finance.resolve_dispute(uuid, text, integer, text)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'finance.resolve_dispute(uuid, text, integer, text)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'finance.respond_to_dispute(uuid, text, uuid[])', 'EXECUTE')
        AND has_function_privilege('service_role', 'finance.sweep_disputes(timestamptz)', 'EXECUTE'),
        '10c grants: primitives internal, doors signed-in, sweep service-role');
    PERFORM pg_temp.check(NOT has_table_privilege('authenticated', 'finance.disputes', 'INSERT, UPDATE, DELETE')
        AND NOT has_table_privilege('authenticated', 'finance.dispute_evidence', 'INSERT, UPDATE, DELETE'),
        '10d no client writes to dispute tables');
END $$;
-- #endregion

ROLLBACK;
