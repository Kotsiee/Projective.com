-- =============================================================================================
-- Probe: the claim TTL (projects.fn_release_expired_claims; PM-WP1, Decision #516, PRD-G2).
--   1 a claim younger than claim_ttl_minutes is not touched
--   2 a lapsed claim on an escrow held AT the claim: refunded once and whole to the payer, the ticket
--     back in the backlog (New, unpaid, nobody on it), one claim_expired history row, the claimant
--     told (ticket.claim_expired) and the client told (escrow.refunded)
--   3 a lapsed claim on a PREPAID escrow (funded before anyone claimed it, Decision #428): re-armed, not
--     refunded (owner ruling D3 A). The escrow stays held, unbound again (payee NULL), on a fresh
--     prepaid clock from the sweep's own clock; the stage the client prepaid beyond it stays reserved
--     (Decision #430); the ticket goes back to Ready (todo, still funded); clearing the assignee
--     released nothing to the lapsed claimant (D5); both sides are told (ticket.claim_expired)
--   4 an in_progress, in_review or reported_hidden ticket past the TTL is untouched
--   5 a ticket that fails mid-release is rolled back alone, logged (WARNING + ops.log_entries) and the
--     run goes on
--   6 p_limit is honoured, oldest claim first; a second run returns 0 and moves nothing
--   7 a re-armed ticket is claimed again and binds; a second lapse re-arms it on the dial; left
--     unclaimed, the prepaid sweep refunds it and its reservation
--   8 the conservation identity (finance.v_conservation_identity, FBP DB16) does not move
--   9 the grant: service_role only, the old one-argument signature gone; the catalogue row; the job
--     row enabled and registered with pg_cron
-- The prepaid marker (#516 (B)) is pinned here: an escrow created before the claim's own transaction
-- was prepaid; a hold the claim made has created_at = claimed_at (one transaction, one now()).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a seeded local DB:
--   deno task test:probes claim_ttl_sweep
-- A clean run prints only PASS.
-- =============================================================================================

BEGIN;

-- #region Helpers
-- The payer wallet of an escrow, what it refunded, and what it paid anyone else.
CREATE FUNCTION pg_temp.wp1_payer_wallet(p_escrow uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT w.id FROM finance.escrows e
      JOIN finance.wallets w
        ON w.owner_type = finance.fn_escrow_payer_wallet_type(e.payer_business_id, e.payer_user_id)
       AND w.owner_id = COALESCE(e.payer_business_id, e.payer_user_id) AND w.currency = e.currency
     WHERE e.id = p_escrow;
$$;
CREATE FUNCTION pg_temp.wp1_refunded(p_escrow uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(t.amount_cents), 0)::bigint FROM finance.transactions t
     WHERE t.ref_table = 'escrows' AND t.ref_id = p_escrow AND t.direction = 'credit'
       AND t.wallet_id = pg_temp.wp1_payer_wallet(p_escrow);
$$;
CREATE FUNCTION pg_temp.wp1_paid(p_escrow uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT (COALESCE((SELECT SUM(pr.amount_cents) FROM finance.pending_releases pr
                       WHERE pr.escrow_id = p_escrow), 0)
          + COALESCE((SELECT SUM(t.amount_cents) FROM finance.transactions t
                       WHERE t.ref_table = 'escrows' AND t.ref_id = p_escrow AND t.direction = 'credit'
                         AND t.wallet_id IS DISTINCT FROM pg_temp.wp1_payer_wallet(p_escrow)
                         AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr
                                          WHERE pr.transaction_id = t.id)), 0))::bigint;
$$;
-- The conservation identity's imbalances now, and a check that nothing since moved them.
CREATE FUNCTION pg_temp.wp1_mark() RETURNS void
LANGUAGE sql AS $$
    SELECT set_config('probe.imbalance', (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c)::text, true);
$$;
CREATE FUNCTION pg_temp.wp1_assert_conserved(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c) IS DISTINCT FROM current_setting('probe.imbalance')::jsonb THEN
        RAISE EXCEPTION 'FAIL % conservation: the identity moved from % to %',
            p_label, current_setting('probe.imbalance'), (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c);
    END IF;
END;
$$;
-- Claim a ticket as the freelancer, then return to the platform (no JWT), as the cron job runs.
CREATE FUNCTION pg_temp.wp1_claim(p_ticket uuid, p_fl uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_fl, 'role', 'authenticated')::text, true);
    IF projects.claim_ticket(p_ticket, p_fl) IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: the claim of % by % was refused', p_ticket, p_fl;
    END IF;
    PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
CREATE FUNCTION pg_temp.wp1_base(p_ticket uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT e.id FROM finance.escrows e
     WHERE e.ticket_id = p_ticket AND e.revision_id IS NULL AND e.status IN ('held', 'refunded', 'released')
       AND e.project_stage_id = (SELECT t.current_stage_id FROM projects.tickets t WHERE t.id = p_ticket)
     ORDER BY (e.status = 'held') DESC, e.created_at DESC LIMIT 1;
$$;
-- #endregion

DO $$
DECLARE
    v_project uuid;
    v_owner uuid;
    v_client uuid;
    v_biz uuid;
    v_currency text;
    v_fl1 uuid;
    v_fl2 uuid;
    v_fl3 uuid;
    v_sa uuid;
    v_sb uuid;
    v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid; v_t5 uuid; v_t6 uuid; v_t7 uuid; v_t8 uuid;
    v_e1 uuid; v_e2 uuid; v_e2b uuid; v_e7 uuid;
    v_now timestamptz := now() + interval '1441 minutes';
    v_ttl integer;
    v_n integer;
    v_tx bigint;
    v_hist bigint;
    v_row record;
    r record;
BEGIN
    -- #region Fixture (as postgres; every write below is rolled back)
    FOR r IN
        SELECT p.id, p.owner_user_id, p.client_business_id, upper(COALESCE(p.currency, 'USD')) AS currency,
               COALESCE(p.client_user_id, p.owner_user_id) AS client_person
          FROM projects.projects p
         WHERE p.client_business_id IS NOT NULL AND p.format = 'pipeline' AND p.structure_variation = 'standard'
           AND p.source_blueprint_id IS NULL
         ORDER BY p.id
    LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', r.owner_user_id, 'role', 'authenticated')::text, true);
        IF finance.fn_owner_capability('business', r.client_business_id, 'spend'::finance.vault_capability) THEN
            v_project := r.id; v_owner := r.owner_user_id; v_biz := r.client_business_id;
            v_currency := r.currency; v_client := r.client_person;
            EXIT;
        END IF;
    END LOOP;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_project IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no business client project whose owner can spend'; END IF;

    SELECT fp.user_id INTO v_fl1 FROM org.freelancer_profiles fp
     WHERE fp.user_id NOT IN (v_owner, v_client) AND finance.fn_freelancer_payout_ready(fp.user_id)
     ORDER BY fp.user_id LIMIT 1;
    SELECT fp.user_id INTO v_fl2 FROM org.freelancer_profiles fp
     WHERE fp.user_id NOT IN (v_owner, v_client, v_fl1) AND finance.fn_freelancer_payout_ready(fp.user_id)
     ORDER BY fp.user_id LIMIT 1;
    SELECT fp.user_id INTO v_fl3 FROM org.freelancer_profiles fp
     WHERE fp.user_id NOT IN (v_owner, v_client, v_fl1, v_fl2) AND finance.fn_freelancer_payout_ready(fp.user_id)
     ORDER BY fp.user_id LIMIT 1;
    IF v_fl3 IS NULL THEN RAISE EXCEPTION 'FAIL fixture: need three payout-ready freelancers'; END IF;

    UPDATE org.business_profiles SET kyb_status = 'verified' WHERE id = v_biz;
    PERFORM finance.fn_ensure_wallet('business', v_biz, v_currency);
    PERFORM finance.fn_wallet_credit(v_biz, 'business', v_currency, 1000000, 'topup', 'inbound_payments', gen_random_uuid());
    -- That credit has no payment behind it; every movement after this mark must leave the identity be.
    PERFORM pg_temp.wp1_mark();

    -- Every claim already in the database is moved out of the window, so each run's count is exactly
    -- this probe's tickets.
    UPDATE projects.tickets SET claimed_at = now() + interval '30 days' WHERE status = 'claimed';

    SELECT (pp.value #>> '{}')::integer INTO v_ttl FROM security.platform_params pp WHERE pp.key = 'claim_ttl_minutes';
    IF COALESCE(v_ttl, 1440) <> 1440 THEN RAISE EXCEPTION 'FAIL fixture: claim_ttl_minutes is %, the probe assumes 1440', v_ttl; END IF;

    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe WP1 A', 980, 'open', 40000) RETURNING id INTO v_sa;
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe WP1 B', 981, 'open', 60000) RETURNING id INTO v_sb;
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, is_client_managed, status)
    VALUES (v_sa, 'freelancer', v_fl1, v_owner, false, 'assigned'),
           (v_sa, 'freelancer', v_fl2, v_owner, false, 'assigned'),
           (v_sa, 'freelancer', v_fl3, v_owner, false, 'assigned');

    FOR v_n IN 1..8 LOOP
        INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
        VALUES (v_project, v_sa, 'backlog', 'Probe WP1 T' || v_n, '{"t":"x"}', 'A description.',
                CASE WHEN v_n = 2
                     THEN jsonb_build_array(jsonb_build_object('stage_id', v_sa, 'order', 0), jsonb_build_object('stage_id', v_sb, 'order', 1))
                     ELSE jsonb_build_array(jsonb_build_object('stage_id', v_sa, 'order', 0)) END)
        RETURNING id INTO r;
    END LOOP;
    SELECT id INTO v_t1 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe WP1 T1';
    SELECT id INTO v_t2 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe WP1 T2';
    SELECT id INTO v_t3 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe WP1 T3';
    SELECT id INTO v_t4 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe WP1 T4';
    SELECT id INTO v_t5 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe WP1 T5';
    SELECT id INTO v_t6 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe WP1 T6';
    SELECT id INTO v_t7 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe WP1 T7';
    SELECT id INTO v_t8 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe WP1 T8';

    -- T1: claimed from New, so the claim itself holds the escrow (ordinary).
    PERFORM pg_temp.wp1_claim(v_t1, v_fl1);
    -- T2: the client funds stage A and prepays stage B before anyone is hired (prepaid, #428 + #430).
    -- The funding is backdated an hour: in one probe transaction now() never moves, and a real claim
    -- always runs in a later transaction than the funding it binds.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    PERFORM projects.fund_ticket(v_project, v_t2, ARRAY[v_sa, v_sb]);
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE finance.escrows SET created_at = created_at - interval '1 hour' WHERE ticket_id = v_t2;
    PERFORM pg_temp.wp1_claim(v_t2, v_fl1);
    -- T3 in progress, T4 in review, T5 suspended by a workload report: all past the TTL, none parked.
    PERFORM pg_temp.wp1_claim(v_t3, v_fl2);
    UPDATE projects.tickets SET status = 'in_progress' WHERE id = v_t3;
    PERFORM pg_temp.wp1_claim(v_t4, v_fl2);
    UPDATE projects.tickets SET status = 'in_progress' WHERE id = v_t4;
    UPDATE projects.tickets SET status = 'in_review' WHERE id = v_t4;
    PERFORM pg_temp.wp1_claim(v_t5, v_fl3);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fl3, 'role', 'authenticated')::text, true);
    PERFORM projects.file_workload_report(v_t5, 'Probe WP1: the scope is larger than its intensity.');
    PERFORM set_config('request.jwt.claims', '', true);
    -- T7: an ordinary claim that will fail mid-release (5).
    PERFORM pg_temp.wp1_claim(v_t7, v_fl3);

    v_e1 := pg_temp.wp1_base(v_t1);
    v_e2 := pg_temp.wp1_base(v_t2);
    v_e7 := pg_temp.wp1_base(v_t7);
    SELECT e.id INTO v_e2b FROM finance.escrows e WHERE e.ticket_id = v_t2 AND e.project_stage_id = v_sb;

    SELECT t.status::text AS s2, t5.status::text AS s5, e.payee_id AS payee2, e.expires_at AS exp2, b.status AS sb INTO v_row
      FROM projects.tickets t, projects.tickets t5, finance.escrows e, finance.escrows b
     WHERE t.id = v_t2 AND t5.id = v_t5 AND e.id = v_e2 AND b.id = v_e2b;
    IF v_row.s2 <> 'claimed' OR v_row.s5 <> 'reported_hidden' OR v_row.payee2 IS DISTINCT FROM v_fl1
       OR v_row.exp2 IS NOT NULL OR v_row.sb <> 'reserved' THEN
        RAISE EXCEPTION 'FAIL fixture: %', row_to_json(v_row);
    END IF;
    -- The marker the sweep reads (#516 (B)), on both sides of it.
    IF NOT EXISTS (SELECT 1 FROM finance.escrows e JOIN projects.tickets t ON t.id = e.ticket_id
                    WHERE e.id = v_e1 AND e.created_at = t.claimed_at) THEN
        RAISE EXCEPTION 'FAIL fixture: a hold made by the claim should share its transaction''s now()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows e JOIN projects.tickets t ON t.id = e.ticket_id
                    WHERE e.id = v_e2 AND e.created_at < t.claimed_at) THEN
        RAISE EXCEPTION 'FAIL fixture: the prepaid escrow should predate the claim that bound it';
    END IF;
    PERFORM pg_temp.wp1_assert_conserved('fixture');
    RAISE NOTICE 'PASS 0 fixture: T1 held at its claim, T2 prepaid (B reserved) then claimed, T3 in_progress, T4 in_review, T5 reported_hidden, T7 claimed';
    -- #endregion

    -- #region 1. A claim younger than the TTL is not touched
    v_n := projects.fn_release_expired_claims(now() + interval '1439 minutes');
    IF v_n <> 0 OR (SELECT status FROM projects.tickets WHERE id = v_t1) <> 'claimed' THEN
        RAISE EXCEPTION 'FAIL 1: a claim inside its TTL was released (%)', v_n;
    END IF;
    RAISE NOTICE 'PASS 1 inside the TTL: nothing released';
    -- #endregion

    -- #region 5 (set-up). T7's release fails on its history row; the trigger dies with the rollback.
    EXECUTE format($f$
        CREATE FUNCTION public.probe_wp1_fail() RETURNS trigger LANGUAGE plpgsql AS $b$
        BEGIN
            RAISE EXCEPTION 'probe WP1: forced failure';
        END $b$;
        CREATE TRIGGER probe_wp1_fail BEFORE INSERT ON projects.ticket_history
            FOR EACH ROW WHEN (NEW.ticket_id = %L::uuid AND NEW.action_type = 'claim_expired')
            EXECUTE FUNCTION public.probe_wp1_fail();
    $f$, v_t7);
    -- #endregion

    -- #region 2–5. One run, past the TTL
    v_n := projects.fn_release_expired_claims(v_now);

    -- 2. T1: refunded once and whole, back in New, logged, both sides told.
    SELECT t.status::text AS status, t.current_assignee_id, t.claimed_at, t.payment_status::text AS pay,
           e.status AS escrow_status INTO v_row
      FROM projects.tickets t JOIN finance.escrows e ON e.id = v_e1
     WHERE t.id = v_t1;
    IF v_row.status <> 'backlog' OR v_row.current_assignee_id IS NOT NULL OR v_row.claimed_at IS NOT NULL
       OR v_row.pay <> 'unpaid' OR v_row.escrow_status <> 'refunded' THEN
        RAISE EXCEPTION 'FAIL 2: T1 %', row_to_json(v_row);
    END IF;
    IF pg_temp.wp1_refunded(v_e1) <> 40000 OR pg_temp.wp1_paid(v_e1) <> 0 THEN
        RAISE EXCEPTION 'FAIL 2: T1 refunded % and paid % (want 40000 and 0)', pg_temp.wp1_refunded(v_e1), pg_temp.wp1_paid(v_e1);
    END IF;
    SELECT count(*) AS n, min(h.actor_id::text) AS actor, min(h.previous_status::text) AS prev,
           min(h.new_status::text) AS next, bool_and(h.previous_stage_id = v_sa AND h.new_stage_id = v_sa) AS stages,
           min(h.changes::text) AS changes INTO v_row
      FROM projects.ticket_history h WHERE h.ticket_id = v_t1 AND h.action_type = 'claim_expired';
    IF v_row.n <> 1 OR v_row.actor <> v_fl1::text OR v_row.prev <> 'claimed' OR v_row.next <> 'backlog'
       OR NOT v_row.stages
       OR (v_row.changes::jsonb ->> 'refunded_cents')::bigint <> 40000
       OR (v_row.changes::jsonb ->> 'ttl_minutes')::integer <> 1440
       OR (v_row.changes::jsonb ->> 'prepaid')::boolean IS NOT FALSE
       OR (v_row.changes::jsonb ->> 'prepaid_stages_refunded')::integer <> 0
       OR (v_row.changes::jsonb ->> 'claimed_at') IS NULL THEN
        RAISE EXCEPTION 'FAIL 2: T1 history %', row_to_json(v_row);
    END IF;
    IF (SELECT count(*) FROM comms.notifications n WHERE n.entity_id = v_t1 AND n.type = 'ticket.claim_expired' AND n.user_id = v_fl1) <> 1
       OR (SELECT count(*) FROM comms.notifications n WHERE n.entity_id = v_t1 AND n.type = 'escrow.refunded' AND n.user_id = v_client) <> 1
       OR (SELECT count(*) FROM comms.notifications n WHERE n.entity_id = v_t1 AND n.type IN ('ticket.claim_expired', 'escrow.refunded')) <> 2 THEN
        RAISE EXCEPTION 'FAIL 2: T1 notices %', (SELECT jsonb_agg(jsonb_build_object('type', n.type, 'to', n.user_id))
                                                     FROM comms.notifications n WHERE n.entity_id = v_t1);
    END IF;
    RAISE NOTICE 'PASS 2 a lapsed claim held at the claim: refunded 40000 once, back in New and unpaid, one history row, claimant and client told';

    -- 3. T2: re-armed, still funded, back in Ready; its reservation untouched; nothing paid or refunded.
    SELECT t.status::text AS status, t.current_assignee_id, t.claimed_at, t.payment_status::text AS pay,
           e.status AS escrow_status, e.payee_id, e.payee_type::text AS payee_type, e.expires_at,
           b.status AS reserved_status INTO v_row
      FROM projects.tickets t JOIN finance.escrows e ON e.id = v_e2 JOIN finance.escrows b ON b.id = v_e2b
     WHERE t.id = v_t2;
    IF v_row.status <> 'todo' OR v_row.current_assignee_id IS NOT NULL OR v_row.claimed_at IS NOT NULL
       OR v_row.pay <> 'escrow_funded' OR v_row.escrow_status <> 'held' OR v_row.payee_id IS NOT NULL
       OR v_row.payee_type IS NOT NULL
       OR v_row.expires_at IS DISTINCT FROM v_now + make_interval(hours => finance.fn_prepaid_escrow_ttl_hours(v_project))
       OR v_row.reserved_status <> 'reserved' THEN
        RAISE EXCEPTION 'FAIL 3: T2 %', row_to_json(v_row);
    END IF;
    IF pg_temp.wp1_refunded(v_e2) <> 0 OR pg_temp.wp1_paid(v_e2) <> 0
       OR pg_temp.wp1_refunded(v_e2b) <> 0 OR pg_temp.wp1_paid(v_e2b) <> 0 THEN
        RAISE EXCEPTION 'FAIL 3: T2 moved money: refunded %/% paid %/% (D5: clearing the assignee must leave an unbound escrow held)',
            pg_temp.wp1_refunded(v_e2), pg_temp.wp1_refunded(v_e2b), pg_temp.wp1_paid(v_e2), pg_temp.wp1_paid(v_e2b);
    END IF;
    SELECT count(*) AS n, min(h.actor_id::text) AS actor, min(h.previous_status::text) AS prev,
           min(h.new_status::text) AS next, min(h.changes::text) AS changes INTO v_row
      FROM projects.ticket_history h WHERE h.ticket_id = v_t2 AND h.action_type = 'claim_expired';
    IF v_row.n <> 1 OR v_row.actor <> v_fl1::text OR v_row.prev <> 'claimed' OR v_row.next <> 'todo'
       OR (v_row.changes::jsonb ->> 'prepaid')::boolean IS NOT TRUE
       OR (v_row.changes::jsonb ->> 'refunded_cents')::bigint <> 0
       OR (v_row.changes::jsonb ->> 'escrow_id')::uuid <> v_e2
       OR (v_row.changes::jsonb ->> 'expires_at')::timestamptz IS DISTINCT FROM v_now + make_interval(hours => finance.fn_prepaid_escrow_ttl_hours(v_project)) THEN
        RAISE EXCEPTION 'FAIL 3: T2 history %', row_to_json(v_row);
    END IF;
    IF (SELECT count(*) FROM comms.notifications n WHERE n.entity_id = v_t2 AND n.type = 'ticket.claim_expired' AND n.user_id = v_fl1) <> 1
       OR (SELECT count(*) FROM comms.notifications n WHERE n.entity_id = v_t2 AND n.type = 'ticket.claim_expired' AND n.user_id = v_client) <> 1
       OR EXISTS (SELECT 1 FROM comms.notifications n WHERE n.entity_id = v_t2 AND n.type = 'escrow.refunded') THEN
        RAISE EXCEPTION 'FAIL 3: T2 notices %', (SELECT jsonb_agg(jsonb_build_object('type', n.type, 'to', n.user_id))
                                                     FROM comms.notifications n WHERE n.entity_id = v_t2);
    END IF;
    RAISE NOTICE 'PASS 3 a lapsed claim on a prepaid escrow: re-armed (held, unbound, % h from the sweep''s clock), B still reserved, Ready and funded, nothing moved, both sides told',
        finance.fn_prepaid_escrow_ttl_hours(v_project);

    -- 4. Work that started, or is suspended, is not parking.
    SELECT count(*) AS n INTO v_row
      FROM projects.tickets t
      JOIN finance.escrows e ON e.ticket_id = t.id AND e.status = 'held' AND e.revision_id IS NULL
     WHERE (t.id, t.status::text, t.current_assignee_id) IN ((v_t3, 'in_progress', v_fl2), (v_t4, 'in_review', v_fl2), (v_t5, 'reported_hidden', v_fl3))
       AND t.claimed_at IS NOT NULL AND e.payee_id = t.current_assignee_id;
    IF v_row.n <> 3 OR EXISTS (SELECT 1 FROM projects.ticket_history h WHERE h.ticket_id IN (v_t3, v_t4, v_t5) AND h.action_type = 'claim_expired') THEN
        RAISE EXCEPTION 'FAIL 4: a started or suspended ticket was touched (% of 3 intact)', v_row.n;
    END IF;
    RAISE NOTICE 'PASS 4 in_progress, in_review and reported_hidden past the TTL: untouched, escrow still held for the assignee';

    -- 5. T7 failed on its own and was logged; the run counted only what it released.
    IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL 5: the run returned % (want 2: T1 and T2; T7 failed)', v_n; END IF;
    SELECT t.status::text AS status, t.current_assignee_id, e.status AS escrow_status INTO v_row
      FROM projects.tickets t JOIN finance.escrows e ON e.id = v_e7 WHERE t.id = v_t7;
    IF v_row.status <> 'claimed' OR v_row.current_assignee_id IS DISTINCT FROM v_fl3 OR v_row.escrow_status <> 'held'
       OR pg_temp.wp1_refunded(v_e7) <> 0 THEN
        RAISE EXCEPTION 'FAIL 5: T7 was not rolled back alone %', row_to_json(v_row);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ops.log_entries l
                    WHERE l.client_id = 'scheduler:projects-release-expired-claims:release_failed'
                      AND l.level = 'error' AND l.data ->> 'ticket_id' = v_t7::text
                      AND l.data ->> 'sqlstate' = 'P0001') THEN
        RAISE EXCEPTION 'FAIL 5: the failed release wrote no ops.log_entries row';
    END IF;
    PERFORM pg_temp.wp1_assert_conserved('5');
    RAISE NOTICE 'PASS 5 a release that fails is rolled back alone and logged (release_failed); the run goes on';
    DROP TRIGGER probe_wp1_fail ON projects.ticket_history;
    DROP FUNCTION public.probe_wp1_fail();
    -- #endregion

    -- #region 6. p_limit, oldest first; then a second run moves nothing
    PERFORM pg_temp.wp1_claim(v_t6, v_fl2);
    PERFORM pg_temp.wp1_claim(v_t8, v_fl1);
    UPDATE projects.tickets SET claimed_at = claimed_at - interval '10 minutes' WHERE id = v_t6;
    v_n := projects.fn_release_expired_claims(v_now, 1);
    IF v_n <> 1 OR (SELECT status FROM projects.tickets WHERE id = v_t6) <> 'backlog'
       OR (SELECT status FROM projects.tickets WHERE id = v_t7) <> 'claimed'
       OR (SELECT status FROM projects.tickets WHERE id = v_t8) <> 'claimed' THEN
        RAISE EXCEPTION 'FAIL 6: p_limit 1 released % (want 1, the oldest claim T6)', v_n;
    END IF;
    v_n := projects.fn_release_expired_claims(v_now);
    IF v_n <> 2 OR (SELECT status FROM projects.tickets WHERE id = v_t7) <> 'backlog'
       OR (SELECT status FROM projects.tickets WHERE id = v_t8) <> 'backlog' THEN
        RAISE EXCEPTION 'FAIL 6: the next run released % (want 2: T7 and T8)', v_n;
    END IF;
    SELECT count(*) INTO v_tx FROM finance.transactions;
    SELECT count(*) INTO v_hist FROM projects.ticket_history;
    v_n := projects.fn_release_expired_claims(v_now);
    IF v_n <> 0 OR (SELECT count(*) FROM finance.transactions) <> v_tx OR (SELECT count(*) FROM projects.ticket_history) <> v_hist THEN
        RAISE EXCEPTION 'FAIL 6: a second run returned % and moved % ledger / % history rows',
            v_n, (SELECT count(*) FROM finance.transactions) - v_tx, (SELECT count(*) FROM projects.ticket_history) - v_hist;
    END IF;
    IF pg_temp.wp1_refunded(v_e7) <> 40000 THEN RAISE EXCEPTION 'FAIL 6: T7 refunded %', pg_temp.wp1_refunded(v_e7); END IF;
    PERFORM pg_temp.wp1_assert_conserved('6');
    RAISE NOTICE 'PASS 6 p_limit 1 took the oldest claim; the next run the other two; a third run returned 0 and moved nothing';
    -- #endregion

    -- #region 7. The re-armed ticket: claimed again, re-armed again on the dial, then swept unclaimed
    PERFORM pg_temp.wp1_claim(v_t2, v_fl2);
    SELECT e.payee_id, e.expires_at, e.status INTO v_row FROM finance.escrows e WHERE e.id = v_e2;
    IF v_row.payee_id IS DISTINCT FROM v_fl2 OR v_row.expires_at IS NOT NULL OR v_row.status <> 'held' THEN
        RAISE EXCEPTION 'FAIL 7: the re-armed escrow did not bind to the next claim %', row_to_json(v_row);
    END IF;
    UPDATE security.platform_params SET value = '72'::jsonb WHERE key = 'prepaid_project_ttl_hours';
    v_n := projects.fn_release_expired_claims(v_now);
    SELECT t.status::text AS status, e.payee_id, e.expires_at, b.status AS reserved_status INTO v_row
      FROM projects.tickets t JOIN finance.escrows e ON e.id = v_e2 JOIN finance.escrows b ON b.id = v_e2b
     WHERE t.id = v_t2;
    IF v_n <> 1 OR v_row.status <> 'todo' OR v_row.payee_id IS NOT NULL
       OR v_row.expires_at IS DISTINCT FROM v_now + interval '72 hours' OR v_row.reserved_status <> 'reserved'
       OR (SELECT count(*) FROM projects.ticket_history h WHERE h.ticket_id = v_t2 AND h.action_type = 'claim_expired') <> 2 THEN
        RAISE EXCEPTION 'FAIL 7: the second lapse (% released) %', v_n, row_to_json(v_row);
    END IF;
    v_n := finance.fn_sweep_expired_prepaid_escrows(v_now + interval '73 hours');
    SELECT t.status::text AS status, t.payment_status::text AS pay, e.status AS escrow_status, b.status AS reserved_status INTO v_row
      FROM projects.tickets t JOIN finance.escrows e ON e.id = v_e2 JOIN finance.escrows b ON b.id = v_e2b
     WHERE t.id = v_t2;
    IF v_row.escrow_status <> 'refunded' OR v_row.reserved_status <> 'refunded' OR v_row.pay <> 'unpaid'
       OR pg_temp.wp1_refunded(v_e2) <> 40000 OR pg_temp.wp1_refunded(v_e2b) <> 60000
       OR pg_temp.wp1_paid(v_e2) <> 0 OR pg_temp.wp1_paid(v_e2b) <> 0 THEN
        RAISE EXCEPTION 'FAIL 7: the prepaid sweep after the re-arm %', row_to_json(v_row);
    END IF;
    UPDATE security.platform_params SET value = '168'::jsonb WHERE key = 'prepaid_project_ttl_hours';
    PERFORM pg_temp.wp1_assert_conserved('7');
    RAISE NOTICE 'PASS 7 re-armed T2: the next claim binds, a second lapse re-arms on the dial (72h), the prepaid sweep then refunds 40000 + the 60000 reservation';
    -- #endregion

    -- #region 8. Nothing anywhere was paid out to a claimant whose claim lapsed
    IF EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id IN (v_t1, v_t2, v_t6, v_t7, v_t8)
                AND (e.status = 'released' OR pg_temp.wp1_paid(e.id) <> 0)) THEN
        RAISE EXCEPTION 'FAIL 8: a lapsed claim was paid';
    END IF;
    RAISE NOTICE 'PASS 8 no lapsed claim earned anything; the conservation identity never moved';
    -- #endregion
END $$;

-- #region 9. The grant, the catalogue row and the job
DO $$
BEGIN
    IF to_regprocedure('projects.fn_release_expired_claims(timestamp with time zone)') IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 9: the one-argument signature still exists beside the new one';
    END IF;
    IF has_function_privilege('anon', 'projects.fn_release_expired_claims(timestamp with time zone, integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fn_release_expired_claims(timestamp with time zone, integer)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'projects.fn_release_expired_claims(timestamp with time zone, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 9: the sweep must be service_role only';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notification_types nt WHERE nt.key = 'ticket.claim_expired' AND nt.category = 'work') THEN
        RAISE EXCEPTION 'FAIL 9: no ticket.claim_expired catalogue row';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ops.scheduled_jobs j WHERE j.name = 'projects-release-expired-claims' AND j.enabled
                    AND j.command = 'SELECT projects.fn_release_expired_claims();') THEN
        RAISE EXCEPTION 'FAIL 9: the job row is not enabled';
    END IF;
    IF to_regclass('cron.job') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM cron.job c WHERE c.jobname = 'projects-release-expired-claims' AND c.schedule = '3,18,33,48 * * * *') THEN
        RAISE EXCEPTION 'FAIL 9: pg_cron has no projects-release-expired-claims job';
    END IF;
    RAISE NOTICE 'PASS 9 service_role only, one signature, ticket.claim_expired catalogued, the job enabled and scheduled';
END $$;
-- #endregion

ROLLBACK;
