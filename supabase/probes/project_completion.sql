-- =============================================================================================
-- Probe: a project completes when its last money settles or when its client completes it, completing
-- it opens its reviews, and a completed project is extended by reopening it (PROJECTS EX1, PJ-40;
-- Decision #546, owner rulings 1 and 2).
--
--   1. Automatic: the client approves the last unsettled stage of a funded engagement whose other
--      tickets have ended. Its escrow releases, nothing is left held or reserved, and the project
--      reads `completed` with a status-history row, its handover unlocked, the client's review offer
--      open, and the freelancer told; money is conserved.
--   2. A completed project takes no new escrow (the ended-engagement guard), and set_project_status
--      cannot move it.
--   3. Refused with held money: the preview says `held`, can_complete_project is false, and
--      complete_project refuses PF409 (HINT `held`); nothing moves.
--   4. Refused with a live dispute: the preview says `dispute`, and complete_project refuses PD409.
--   5. The client completes an engagement holding nothing but unfunded work: a stranger and a seated
--      freelancer are refused 42501; the preview counts what closes; the open tickets close as
--      `cancelled` and the open stages close; it reads `completed`; the freelancer is told.
--   6. Reopen: refused to a stranger; the client reopens it (`completed → active`, history-logged); a
--      second reopen is refused 55000. A new open stage keeps set_project_status from completing it
--      (a stage still open), and complete_project closes that stage and completes it again.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/project_completion.sql
--
-- Fixtures are discovered from the seed: (A) an active business engagement whose last unsettled stage
-- holds every open ticket's bound, held escrow; (B) an active engagement holding nothing with open,
-- unfunded tickets and a seated freelancer; (C) an active engagement holding escrow that nothing else
-- blocks. A clean run prints only `ok` notices.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

-- Run a statement; 'ok', or the SQLSTATE and message it raised (and its HINT, when it set one).
CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_hint text;
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    RETURN SQLSTATE || CASE WHEN COALESCE(v_hint, '') <> '' THEN ' [' || v_hint || ']' ELSE '' END || ': ' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.imbalance(p_currency text) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE((SELECT imbalance_minor FROM finance.v_conservation_identity WHERE currency = p_currency), 0);
$$;

CREATE FUNCTION pg_temp.status(p_project uuid) RETURNS text LANGUAGE sql AS $$
    SELECT status::text FROM projects.projects WHERE id = p_project;
$$;

-- Someone with no seat, membership or authority on the project.
CREATE FUNCTION pg_temp.stranger(p_project uuid) RETURNS uuid LANGUAGE sql AS $$
    SELECT u.user_id FROM org.users_public u
     WHERE NOT EXISTS (SELECT 1 FROM projects.projects p WHERE p.id = p_project
                          AND u.user_id IN (p.owner_user_id, COALESCE(p.client_user_id, p.owner_user_id)))
       AND NOT EXISTS (SELECT 1 FROM projects.project_participants pp
                        WHERE pp.project_id = p_project AND pp.profile_id = u.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.projects p JOIN org.business_members bm ON bm.business_id = p.client_business_id
                        WHERE p.id = p_project AND bm.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
$$;
-- #endregion

DO $$
DECLARE
    v_a uuid; v_a_stage uuid; v_a_client uuid; v_a_biz uuid; v_a_payee uuid; v_a_currency text;
    v_b uuid; v_b_client uuid; v_b_freelancer uuid; v_b_open integer;
    v_c uuid; v_c_client uuid; v_c_escrow uuid; v_c_held bigint;
    v_out jsonb;
    v_r text;
    v_before bigint;
    v_stage uuid;
BEGIN
    -- #region 0. Fixtures (as postgres)
    SELECT p.id, s.id, COALESCE(p.client_user_id, p.owner_user_id), p.client_business_id,
           upper(COALESCE(p.currency, 'USD'))
      INTO v_a, v_a_stage, v_a_client, v_a_biz, v_a_currency
      FROM projects.projects p
      JOIN projects.project_stages s ON s.project_id = p.id AND s.archived_at IS NULL
                                    AND s.status NOT IN ('paid', 'cancelled')
     WHERE p.status = 'active' AND p.format <> 'session' AND p.client_business_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM projects.project_stages o
                        WHERE o.project_id = p.id AND o.id <> s.id AND o.archived_at IS NULL
                          AND o.status NOT IN ('paid', 'cancelled'))
       AND NOT EXISTS (SELECT 1 FROM projects.tickets t
                        WHERE t.project_id = p.id AND t.status NOT IN ('completed', 'cancelled')
                          AND (t.current_stage_id IS DISTINCT FROM s.id
                               OR NOT EXISTS (SELECT 1 FROM finance.escrows e
                                               WHERE e.ticket_id = t.id AND e.project_stage_id = s.id
                                                 AND e.status = 'held' AND e.payee_id IS NOT NULL)))
       AND EXISTS (SELECT 1 FROM finance.escrows e
                    WHERE e.project_stage_id = s.id AND e.status = 'held' AND e.payee_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM finance.escrows e JOIN projects.project_stages x ON x.id = e.project_stage_id
                        WHERE x.project_id = p.id
                          AND (e.status = 'reserved' OR (e.status = 'held' AND e.payee_id IS NULL)))
     ORDER BY p.id
     LIMIT 1;
    PERFORM pg_temp.ok(v_a IS NOT NULL,
        'fixture A: an active business engagement whose last unsettled stage holds every open ticket''s escrow');
    SELECT t.current_assignee_id INTO v_a_payee FROM projects.tickets t
     WHERE t.project_id = v_a AND t.current_stage_id = v_a_stage AND t.current_assignee_id IS NOT NULL
     ORDER BY t.id LIMIT 1;
    UPDATE org.business_profiles SET status = 'active', kyb_status = 'verified' WHERE id = v_a_biz;

    SELECT p.id, COALESCE(p.client_user_id, p.owner_user_id), sa.freelancer_profile_id
      INTO v_b, v_b_client, v_b_freelancer
      FROM projects.projects p
      JOIN projects.project_stages ps ON ps.project_id = p.id
      JOIN projects.stage_assignments sa ON sa.project_stage_id = ps.id AND sa.assignee_type = 'freelancer'
                                        AND sa.status IN ('assigned', 'accepted')
     WHERE p.status = 'active' AND p.format <> 'session' AND p.id <> v_a AND COALESCE(p.is_personal, false) = false
       AND NOT EXISTS (SELECT 1 FROM finance.escrows e JOIN projects.project_stages x ON x.id = e.project_stage_id
                        WHERE x.project_id = p.id AND e.status IN ('held', 'reserved'))
       AND EXISTS (SELECT 1 FROM projects.tickets t WHERE t.project_id = p.id AND t.status NOT IN ('completed', 'cancelled'))
     ORDER BY p.id
     LIMIT 1;
    PERFORM pg_temp.ok(v_b IS NOT NULL, 'fixture B: an active engagement holding nothing, with unfunded open tickets and a seat');
    SELECT count(*) INTO v_b_open FROM projects.tickets WHERE project_id = v_b AND status NOT IN ('completed', 'cancelled');

    SELECT p.id, COALESCE(p.client_user_id, p.owner_user_id), e.id
      INTO v_c, v_c_client, v_c_escrow
      FROM projects.projects p
      JOIN projects.project_stages ps ON ps.project_id = p.id
      JOIN finance.escrows e ON e.project_stage_id = ps.id AND e.status = 'held' AND e.ticket_id IS NOT NULL
     WHERE p.status = 'active' AND p.format <> 'session' AND p.id NOT IN (v_a, v_b)
       AND projects.fn_project_cancel_blocked(p.id) IS NULL
     ORDER BY p.id, e.id
     LIMIT 1;
    PERFORM pg_temp.ok(v_c IS NOT NULL, 'fixture C: an active engagement holding escrow that nothing else blocks');
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_c_held FROM finance.escrows e
      JOIN projects.project_stages ps ON ps.id = e.project_stage_id
     WHERE ps.project_id = v_c AND e.status IN ('held', 'reserved');
    RAISE NOTICE 'fixtures A=% B=% C=%', v_a, v_b, v_c;
    -- #endregion

    -- #region 1. Approving the last stage completes the project
    v_before := pg_temp.imbalance(v_a_currency);
    PERFORM pg_temp.act(v_a_client);
    PERFORM pg_temp.ok(projects.can_review_project(v_a), 'fixture A: the client holds review authority');
    v_out := projects.approve_stage(v_a, v_a_stage);
    PERFORM pg_temp.ok((v_out->>'released_count')::integer > 0, '1 the approval released the stage''s held escrow');
    PERFORM pg_temp.ok(NOT EXISTS (
        SELECT 1 FROM finance.escrows e JOIN projects.project_stages x ON x.id = e.project_stage_id
         WHERE x.project_id = v_a AND e.status IN ('held', 'reserved')), '1 nothing is held or reserved');
    PERFORM pg_temp.ok(pg_temp.status(v_a) = 'completed',
        format('1 the project reads completed (it reads %s)', pg_temp.status(v_a)));
    PERFORM pg_temp.ok(EXISTS (
        SELECT 1 FROM projects.project_status_history h
         WHERE h.project_id = v_a AND h.from_status = 'active' AND h.to_status = 'completed'
           AND h.actor_user_id = v_a_client),
        '1 a status-history row records active -> completed by the approver');
    PERFORM pg_temp.ok((SELECT handover_unlocked_at IS NOT NULL FROM projects.projects WHERE id = v_a),
        '1 the handover is unlocked');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM reviews.fn_engagement_targets(v_a, v_a_client) t
                                WHERE t.opened_at IS NOT NULL),
        '1 the client''s review offer is open');
    PERFORM pg_temp.ok(v_a_payee IS NULL OR EXISTS (
        SELECT 1 FROM comms.notifications n
         WHERE n.user_id = v_a_payee AND n.entity_id = v_a AND n.type IN ('project.handover', 'project.completed')),
        '1 the freelancer is told the project is complete');
    PERFORM pg_temp.ok(pg_temp.imbalance(v_a_currency) = v_before, '1 money is conserved');
    -- #endregion

    -- #region 2. A completed project takes no new escrow and set_project_status cannot move it
    PERFORM pg_temp.act(NULL);
    v_r := pg_temp.try(format(
        'INSERT INTO finance.escrows (project_stage_id, payer_business_id, payee_type, payee_id, amount_cents, currency, status)
         VALUES (%L, %L, ''freelancer'', %L, 1000, %L, ''held'')',
        v_a_stage, v_a_biz, COALESCE(v_a_payee, v_a_client), v_a_currency));
    PERFORM pg_temp.ok(v_r LIKE '55000%', '2 new escrow on a completed project is refused: ' || v_r);
    PERFORM pg_temp.act(v_a_client);
    v_r := pg_temp.try(format('SELECT projects.set_project_status(%L, ''archived'')', v_a));
    PERFORM pg_temp.ok(v_r LIKE '23514%', '2 set_project_status cannot move a completed project: ' || v_r);
    -- #endregion

    -- #region 3. Held money refuses the completion
    PERFORM pg_temp.act(v_c_client);
    v_out := projects.preview_project_complete(v_c);
    PERFORM pg_temp.ok((v_out->>'completable')::boolean = false AND v_out->>'blocked' = 'held',
        '3 the preview says held: ' || v_out::text);
    PERFORM pg_temp.ok(projects.can_complete_project(v_c) = false, '3 can_complete_project is false');
    v_r := pg_temp.try(format('SELECT projects.complete_project(%L)', v_c));
    PERFORM pg_temp.ok(v_r LIKE 'PF409 [held]%', '3 complete_project refuses PF409 with HINT held: ' || v_r);
    PERFORM pg_temp.ok(pg_temp.status(v_c) = 'active' AND (
        SELECT COALESCE(SUM(amount_cents), 0) FROM finance.escrows e JOIN projects.project_stages ps ON ps.id = e.project_stage_id
         WHERE ps.project_id = v_c AND e.status IN ('held', 'reserved')) = v_c_held, '3 nothing moved');
    -- #endregion

    -- #region 4. A live dispute refuses the completion
    PERFORM pg_temp.act(NULL);
    INSERT INTO finance.disputes (escrow_id, opened_by_profile, reason)
    VALUES (v_c_escrow, v_c_client, 'Probe EX1: the work is disputed');
    PERFORM pg_temp.act(v_c_client);
    v_out := projects.preview_project_complete(v_c);
    PERFORM pg_temp.ok(v_out->>'blocked' = 'dispute', '4 the preview says dispute: ' || v_out::text);
    v_r := pg_temp.try(format('SELECT projects.complete_project(%L)', v_c));
    PERFORM pg_temp.ok(v_r LIKE 'PD409%', '4 complete_project refuses PD409: ' || v_r);
    -- #endregion

    -- #region 5. The client completes an engagement holding nothing
    PERFORM pg_temp.act(pg_temp.stranger(v_b));
    v_r := pg_temp.try(format('SELECT projects.complete_project(%L)', v_b));
    PERFORM pg_temp.ok(v_r LIKE '42501%', '5 a stranger cannot complete: ' || v_r);
    v_r := pg_temp.try(format('SELECT projects.preview_project_complete(%L)', v_b));
    PERFORM pg_temp.ok(v_r LIKE '42501%', '5 a stranger cannot read the preview: ' || v_r);
    PERFORM pg_temp.ok(projects.can_complete_project(v_b) = false, '5 can_complete_project is false for a stranger');
    PERFORM pg_temp.act(v_b_freelancer);
    v_r := pg_temp.try(format('SELECT projects.complete_project(%L)', v_b));
    PERFORM pg_temp.ok(v_r LIKE '42501%', '5 the seated freelancer cannot complete: ' || v_r);

    PERFORM pg_temp.act(v_b_client);
    PERFORM pg_temp.ok(projects.can_complete_project(v_b), '5 can_complete_project is true for the client');
    v_out := projects.preview_project_complete(v_b);
    PERFORM pg_temp.ok((v_out->>'completable')::boolean AND v_out->>'blocked' IS NULL
        AND (v_out->>'tickets_to_close')::integer = v_b_open
        AND (v_out->>'stages_to_close')::integer = (SELECT count(*) FROM projects.project_stages
                                                     WHERE project_id = v_b AND archived_at IS NULL
                                                       AND status NOT IN ('paid', 'cancelled')),
        '5 the preview counts what closes: ' || v_out::text);
    v_out := projects.complete_project(v_b, 'Probe EX1: done');
    PERFORM pg_temp.ok(v_out->>'status' = 'completed' AND (v_out->>'tickets_closed')::integer = v_b_open,
        '5 complete_project answers completed: ' || v_out::text);
    PERFORM pg_temp.ok(pg_temp.status(v_b) = 'completed', '5 the project reads completed');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM projects.tickets WHERE project_id = v_b AND status NOT IN ('completed', 'cancelled'))
        AND NOT EXISTS (SELECT 1 FROM projects.project_stages WHERE project_id = v_b AND archived_at IS NULL
                                                             AND status NOT IN ('paid', 'cancelled')),
        '5 every ticket and stage is closed');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM projects.ticket_history th JOIN projects.tickets t ON t.id = th.ticket_id
                                WHERE t.project_id = v_b AND th.new_status = 'cancelled'
                                  AND th.changes->>'reason' = 'project_completed'),
        '5 each closed ticket has its history row');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM projects.project_status_history
                                WHERE project_id = v_b AND to_status = 'completed' AND reason = 'Probe EX1: done'),
        '5 the history records the client''s reason');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications
                                WHERE user_id = v_b_freelancer AND type = 'project.completed' AND entity_id = v_b),
        '5 the freelancer is told (project.completed)');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM comms.notifications
                                    WHERE user_id = v_b_client AND type = 'project.completed' AND entity_id = v_b),
        '5 the client who completed it is not told');
    -- #endregion

    -- #region 6. Reopen to extend
    PERFORM pg_temp.act(pg_temp.stranger(v_b));
    v_r := pg_temp.try(format('SELECT projects.reopen_project(%L)', v_b));
    PERFORM pg_temp.ok(v_r LIKE '42501%', '6 a stranger cannot reopen: ' || v_r);
    PERFORM pg_temp.act(v_b_client);
    v_out := projects.reopen_project(v_b);
    PERFORM pg_temp.ok(v_out->>'status' = 'active' AND pg_temp.status(v_b) = 'active', '6 the client reopens it');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM projects.project_status_history
                                WHERE project_id = v_b AND from_status = 'completed' AND to_status = 'active'
                                  AND actor_user_id = v_b_client),
        '6 the history records completed -> active');
    v_r := pg_temp.try(format('SELECT projects.reopen_project(%L)', v_b));
    PERFORM pg_temp.ok(v_r LIKE '55000%', '6 an active project cannot be reopened: ' || v_r);

    PERFORM pg_temp.act(NULL);
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_b, 'Probe EX1 extension', 995, 'open', 10000) RETURNING id INTO v_stage;
    PERFORM pg_temp.act(v_b_client);
    v_r := pg_temp.try(format('SELECT projects.set_project_status(%L, ''completed'')', v_b));
    PERFORM pg_temp.ok(v_r LIKE '23514%' AND v_r LIKE '%stage is still open%',
        '6 an open stage keeps set_project_status from completing it: ' || v_r);
    v_out := projects.complete_project(v_b);
    PERFORM pg_temp.ok(pg_temp.status(v_b) = 'completed' AND (v_out->>'stages_closed')::integer = 1
        AND (SELECT status::text FROM projects.project_stages WHERE id = v_stage) = 'cancelled',
        '6 complete_project closes the unfunded stage and completes it again: ' || v_out::text);
    -- #endregion
END $$;

ROLLBACK;
