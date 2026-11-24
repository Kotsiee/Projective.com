-- =============================================================================================
-- Probe: either side raises a dispute on a ticket's stage money, the other responds, either can
-- offer, and an accepted offer or a ruling moves the money through its doors (PROJECTS EX2;
-- Decisions #548, #549; PJ-43).
--
--   1. Refusals and the raise: a stranger is refused (P0002); the client raises a dispute on the held,
--      bound escrow of a ticket in review: a live `ticket_escrow` case names the escrow, the ticket and
--      its stage, the client is its claimant and the freelancer (a team payee's owner) its respondent,
--      who is told; the escrow stays held. A second raise on the same money is refused (PD409).
--   2. While it is live the ticket neither moves (move_ticket, or a direct statement) nor is claimed
--      (PD409, ruling 5).
--   3. Offers (ruling 3): either side offers; a side cannot accept its own offer (42501) or a replaced
--      one (PS409); the freelancer accepts the client's standing offer and the case settles at once on
--      it as a Fair Exit split: the payout through the team's clearing rows, the rest back to the
--      client, the ticket cancelled, no operator; a closed case takes no offer and no ruling (PS409).
--   4. An operator's release ruling settles the work as an accepted submission does.
--   5. The freelancer raises (the other side), and an operator's refund ruling returns the money and
--      ends the ticket.
--   6. The pending window (ruling 1): once the stage's money is released, the client raises within the
--      7 days: the clearing rows freeze, the sweep leaves the case alone, and a split ruling takes back
--      what the freelancer is no longer due, in proportion, and gives the client that plus the fee no
--      longer earned (`fee_returned_minor`).
--   Every scenario leaves finance.v_conservation_identity where the fixture left it.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   deno task test:probes ticket_dispute
--
-- Fixtures are discovered from the seed: an active, non-session engagement with a ticket in review
-- whose current stage holds its bound escrow, a submission awaiting review, and no live dispute on
-- it. Each scenario after §2 starts from what came before it: each runs in a block that undoes itself.
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

-- The SQLSTATE a statement raises, or 'ok'. Runs in a subtransaction, so a refusal writes nothing.
CREATE FUNCTION pg_temp.state_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

CREATE FUNCTION pg_temp.imbalance() RETURNS jsonb LANGUAGE sql AS $$
    SELECT COALESCE(pg_catalog.jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb)
      FROM finance.v_conservation_identity c;
$$;
-- #endregion

DO $$
DECLARE
    v_project uuid;
    v_biz uuid;
    v_ticket uuid;
    v_stage uuid;
    v_escrow uuid;
    v_submission uuid;
    v_client uuid;
    v_freelancer uuid;
    v_assignee uuid;
    v_stranger uuid;
    v_operator uuid;
    v_amount bigint;
    v_currency text;
    v_fee_bp integer;
    v_imbalance jsonb;
    v_out jsonb;
    v_d finance.disputes;
    v_case jsonb;
    v_o1 uuid;
    v_o2 uuid;
    v_o3 uuid;
    v_split record;
    v_wallet_before bigint;
    v_wallet_after bigint;
    v_rows_before bigint;
    v_n integer;
    v_state text;
BEGIN
    -- #region 0. Fixture (as postgres)
    -- The seed's state drifts as sessions drive the shared DB, so the probe makes its own fixture: a funded
    -- ticket at work (or in review) on its current stage, put in review with a submission awaiting review.
    SELECT tk.id INTO v_ticket
      FROM projects.tickets tk
      JOIN projects.projects p ON p.id = tk.project_id
      JOIN finance.escrows e ON e.ticket_id = tk.id AND e.project_stage_id = tk.current_stage_id
                            AND e.status = 'held' AND e.payee_id IS NOT NULL
     WHERE p.status = 'active' AND p.format <> 'session' AND tk.current_assignee_id IS NOT NULL
       AND tk.status IN ('claimed', 'in_progress', 'in_review')
       AND NOT finance.fn_escrow_has_open_dispute(e.id)
       AND NOT EXISTS (SELECT 1 FROM finance.escrows o
                        WHERE o.ticket_id = tk.id AND o.status = 'held' AND o.id <> e.id)
     ORDER BY (tk.status = 'in_review') DESC, tk.id
     LIMIT 1;
    PERFORM pg_temp.ok(v_ticket IS NOT NULL, 'fixture: a funded ticket at work on its current stage');
    UPDATE projects.tickets SET status = 'in_review' WHERE id = v_ticket AND status <> 'in_review';
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status)
    SELECT tk.current_stage_id, tk.id, tk.current_assignee_id, 'Probe delivery', 'pending_review'
      FROM projects.tickets tk
     WHERE tk.id = v_ticket
       AND NOT EXISTS (SELECT 1 FROM projects.stage_submissions ss
                        WHERE ss.ticket_id = tk.id AND ss.project_stage_id = tk.current_stage_id
                          AND ss.status = 'pending_review');
    SELECT p.id, p.client_business_id, tk.id, e.project_stage_id, e.id, ss.id,
           COALESCE(p.client_user_id, p.owner_user_id),
           CASE WHEN e.payee_type = 'team' THEN t.owner_user_id ELSE e.payee_id END,
           tk.current_assignee_id, e.amount_cents, e.currency
      INTO v_project, v_biz, v_ticket, v_stage, v_escrow, v_submission, v_client, v_freelancer, v_assignee,
           v_amount, v_currency
      FROM projects.tickets tk
      JOIN projects.projects p ON p.id = tk.project_id
      JOIN finance.escrows e ON e.ticket_id = tk.id AND e.project_stage_id = tk.current_stage_id
                            AND e.status = 'held' AND e.payee_id IS NOT NULL
      JOIN projects.stage_submissions ss ON ss.ticket_id = tk.id AND ss.project_stage_id = e.project_stage_id
                                        AND ss.status = 'pending_review'
      LEFT JOIN org.teams t ON t.id = e.payee_id AND e.payee_type = 'team'
     WHERE tk.id = v_ticket AND p.status = 'active' AND p.format <> 'session' AND tk.status = 'in_review'
       AND NOT finance.fn_escrow_has_open_dispute(e.id)
       AND NOT EXISTS (SELECT 1 FROM finance.escrows o
                        WHERE o.ticket_id = tk.id AND o.status = 'held' AND o.id <> e.id)
     ORDER BY tk.id
     LIMIT 1;
    PERFORM pg_temp.ok(v_ticket IS NOT NULL,
        'fixture: a ticket in review whose current stage holds its bound escrow, with no live dispute');
    IF v_biz IS NOT NULL THEN
        UPDATE org.business_profiles SET status = 'active', kyb_status = 'verified' WHERE id = v_biz;
    END IF;
    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id NOT IN (v_client, v_freelancer)
       AND NOT EXISTS (SELECT 1 FROM projects.project_participants pp
                        WHERE pp.project_id = v_project AND pp.profile_id = u.user_id)
       AND (v_biz IS NULL OR NOT EXISTS (SELECT 1 FROM org.business_members bm
                                          WHERE bm.business_id = v_biz AND bm.user_id = u.user_id))
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT a.user_id INTO v_operator FROM ops.admin_users a ORDER BY a.user_id LIMIT 1;
    PERFORM pg_temp.ok(v_stranger IS NOT NULL AND v_operator IS NOT NULL, 'fixture: a stranger and an operator');
    SELECT finance.fn_escrow_fee_bp(e.payer_business_id, e.payer_user_id) INTO v_fee_bp
      FROM finance.escrows e WHERE e.id = v_escrow;
    v_imbalance := pg_temp.imbalance();
    RAISE NOTICE 'fixture project=% ticket=% escrow=% client=% freelancer=% amount=% %',
        v_project, v_ticket, v_escrow, v_client, v_freelancer, v_amount, v_currency;
    -- #endregion

    -- §1–§4 share the client's case and undo themselves, so §5 and §6 start from the fixture.
    BEGIN
    -- #region 1. Refusals and the raise
    PERFORM pg_temp.ok(pg_catalog.to_regproc('finance.open_ticket_dispute') IS NOT NULL,
        '1 a door raises a dispute on a held ticket escrow (finance.open_ticket_dispute)');
    PERFORM pg_temp.act(v_stranger);
    v_state := pg_temp.state_of(pg_catalog.format(
        'SELECT finance.open_ticket_dispute(%L, %L, %L, %L)', v_ticket, v_stage, 'Not delivered', 'It is not here.'));
    PERFORM pg_temp.ok(v_state = 'P0002', format('1 a stranger is refused as if the ticket did not exist (%s)', v_state));

    PERFORM pg_temp.ok(finance.ticket_dispute_state(v_ticket) IS NULL, '1 a stranger reads no dispute state');
    PERFORM pg_temp.act(v_client);
    PERFORM pg_temp.ok(projects.can_review_project(v_project), 'fixture: the client holds review authority');
    v_case := finance.ticket_dispute_state(v_ticket);
    PERFORM pg_temp.ok((v_case->>'can_raise')::boolean AND v_case->>'window' = 'held' AND v_case->>'side' = 'payer'
                       AND v_case->>'stage_id' = v_stage::text,
        format('1 the ticket view offers the client a dispute on the held money (%s)', v_case));
    v_out := finance.open_ticket_dispute(v_ticket, v_stage, 'The delivered work does not meet the brief.',
        'The submission leaves out two of the agreed deliverables.');
    SELECT * INTO v_d FROM finance.disputes WHERE id = (v_out->>'dispute_id')::uuid;
    PERFORM pg_temp.ok(v_d.id IS NOT NULL, '1 the door returns the dispute it opened');
    PERFORM pg_temp.ok(v_d.subject_kind = 'ticket_escrow' AND v_d.escrow_id = v_escrow,
        '1 it contests the ticket''s held escrow as a ticket_escrow dispute');
    PERFORM pg_temp.ok(pg_catalog.to_jsonb(v_d)->>'ticket_id' = v_ticket::text
                       AND pg_catalog.to_jsonb(v_d)->>'stage_id' = v_stage::text
                       AND v_d.claimant_side = 'payer',
        '1 it names the ticket, its stage and the client''s side');
    PERFORM pg_temp.ok(v_d.status = 'awaiting_response' AND v_d.respond_by > now(),
        '1 the other side has the response deadline');
    PERFORM pg_temp.ok(finance.fn_escrow_has_open_dispute(v_escrow), '1 the dispute is live');
    PERFORM pg_temp.ok(finance.fn_dispute_party(v_d.id, v_client) = 'claimant', '1 the client is the claimant');
    PERFORM pg_temp.ok(finance.fn_dispute_party(v_d.id, v_freelancer) = 'respondent',
        '1 the freelancer is the respondent');
    PERFORM pg_temp.ok(finance.fn_dispute_party(v_d.id, v_stranger) IS NULL, '1 a stranger is no party');
    PERFORM pg_temp.ok((SELECT e.status = 'held' FROM finance.escrows e WHERE e.id = v_escrow),
        '1 the escrow stays held');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications n
                                WHERE n.user_id = v_freelancer AND n.type = 'dispute.opened' AND n.entity_id = v_d.id),
        '1 the freelancer is told');
    PERFORM pg_temp.act(v_freelancer);
    v_case := finance.get_dispute(v_d.id);
    PERFORM pg_temp.ok(v_case->>'kind' = 'ticket' AND v_case->>'role' = 'respondent'
                       AND (v_case->>'can_offer')::boolean AND (v_case->'ticket'->>'window') = 'held'
                       AND (v_case->>'amount_minor')::bigint = v_amount,
        '1 the respondent reads a ticket case it may offer on, its money held');
    v_state := pg_temp.state_of(pg_catalog.format(
        'SELECT finance.open_ticket_dispute(%L, %L, %L, %L)', v_ticket, v_stage, 'Scope changed', 'Mid-way.'));
    PERFORM pg_temp.ok(v_state = 'PD409', format('1 a second dispute on the same money is refused (%s)', v_state));
    v_case := finance.ticket_dispute_state(v_ticket);
    PERFORM pg_temp.ok(v_case->>'side' = 'payee' AND v_case->>'dispute_id' = v_d.id::text
                       AND NOT (v_case->>'can_raise')::boolean,
        '1 the freelancer''s ticket view names the live case and offers no second one');
    -- #endregion

    -- #region 2. A live dispute freezes the ticket's work
    PERFORM pg_temp.act(v_client);
    v_state := pg_temp.state_of(pg_catalog.format(
        'SELECT projects.move_ticket(%L, %L::ticket_status)', v_ticket, 'in_progress'));
    PERFORM pg_temp.ok(v_state = 'PD409', format('2 the board cannot move it (%s)', v_state));
    BEGIN
        SET LOCAL ROLE authenticated;
        UPDATE projects.tickets SET status = 'in_progress' WHERE id = v_ticket;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_state := 'ok, ' || v_n || ' row(s)';
        RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
        v_state := SQLSTATE;
    END;
    RESET ROLE;
    PERFORM pg_temp.ok(v_state = 'PD409', format('2 a direct statement cannot move it (%s)', v_state));
    PERFORM pg_temp.act(v_assignee);
    v_state := pg_temp.state_of(pg_catalog.format('SELECT projects.claim_ticket(%L, %L)', v_ticket, v_assignee));
    PERFORM pg_temp.ok(v_state = 'PD409', format('2 it cannot be claimed (%s)', v_state));
    -- #endregion

    -- #region 3. Offers: the freelancer accepts the client's standing offer
    BEGIN
        PERFORM pg_temp.act(v_client);
        v_o1 := (finance.propose_dispute_offer(v_d.id, 5000, 'Half, for what was delivered.')->>'offer_id')::uuid;
        PERFORM pg_temp.act(v_freelancer);
        v_o2 := (finance.propose_dispute_offer(v_d.id, 7000)->>'offer_id')::uuid;
        PERFORM pg_temp.act(v_client);
        v_out := finance.propose_dispute_offer(v_d.id, 4000);
        v_o3 := (v_out->>'offer_id')::uuid;
        SELECT * INTO v_split FROM finance.fn_fair_exit_split(v_amount, 4000, v_fee_bp);
        PERFORM pg_temp.ok((v_out->>'payee_minor')::bigint = v_split.payout_cents
                           AND (v_out->>'refund_minor')::bigint = v_split.refund_cents,
            '3 an offer reports what it would move, by Fair Exit''s arithmetic');
        PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications n
                                    WHERE n.user_id = v_freelancer AND n.type = 'dispute.offer_made'
                                      AND n.entity_id = v_d.id),
            '3 the other side is told of an offer');
        v_state := pg_temp.state_of(pg_catalog.format('SELECT finance.accept_dispute_offer(%L)', v_o3));
        PERFORM pg_temp.ok(v_state = '42501', format('3 a side cannot accept its own offer (%s)', v_state));
        PERFORM pg_temp.act(v_freelancer);
        v_state := pg_temp.state_of(pg_catalog.format('SELECT finance.accept_dispute_offer(%L)', v_o1));
        PERFORM pg_temp.ok(v_state = 'PS409', format('3 a replaced offer cannot be accepted (%s)', v_state));
        v_case := finance.get_dispute(v_d.id);
        PERFORM pg_temp.ok((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_case->'offers') x
                             WHERE (x->>'can_accept')::boolean AND x->>'id' = v_o3::text) = 1,
            '3 the case offers the freelancer the client''s standing offer, and only it');
        SELECT w.balance_cents INTO v_wallet_before FROM finance.wallets w
         WHERE w.owner_id = COALESCE(v_biz, v_client) AND upper(w.currency) = upper(v_currency)
         ORDER BY w.id LIMIT 1;

        v_out := finance.accept_dispute_offer(v_o3);
        SELECT * INTO v_d FROM finance.disputes WHERE id = v_d.id;
        PERFORM pg_temp.ok(v_d.status = 'resolved_split' AND v_d.payee_share_bp = 4000 AND v_d.resolved_by IS NULL
                           AND v_d.settlement->>'offer_id' = v_o3::text,
            '3 the case settles as agreed, a split at the offer''s share, with no operator');
        PERFORM pg_temp.ok((SELECT o.accepted_by = v_freelancer FROM finance.dispute_offers o WHERE o.id = v_o3),
            '3 the offer records who accepted it');
        PERFORM pg_temp.ok((SELECT e.status = 'released' FROM finance.escrows e WHERE e.id = v_escrow),
            '3 the escrow is settled');
        PERFORM pg_temp.ok((SELECT pg_catalog.sum(pr.amount_cents) FROM finance.pending_releases pr
                             WHERE pr.escrow_id = v_escrow) = v_split.payout_cents
                           AND (v_d.settlement->>'payee_minor')::bigint = v_split.payout_cents
                           AND (v_d.settlement->>'refund_minor')::bigint = v_split.refund_cents,
            '3 the freelancer''s share clears through the pending window and the rest goes back');
        SELECT w.balance_cents INTO v_wallet_after FROM finance.wallets w
         WHERE w.owner_id = COALESCE(v_biz, v_client) AND upper(w.currency) = upper(v_currency)
         ORDER BY w.id LIMIT 1;
        PERFORM pg_temp.ok(v_wallet_after - v_wallet_before = v_split.refund_cents,
            format('3 the client''s wallet got the refund back (%s)', v_wallet_after - v_wallet_before));
        PERFORM pg_temp.ok((SELECT tk.status = 'cancelled' FROM projects.tickets tk WHERE tk.id = v_ticket),
            '3 the ticket ends cancelled, as a Fair Exit does');
        PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications n
                                    WHERE n.user_id = v_client AND n.type = 'dispute.resolved' AND n.entity_id = v_d.id)
                           AND EXISTS (SELECT 1 FROM comms.notifications n
                                        WHERE n.user_id = v_freelancer AND n.type = 'dispute.resolved'
                                          AND n.entity_id = v_d.id),
            '3 both sides are told');
        PERFORM pg_temp.ok(pg_temp.imbalance() = v_imbalance, '3 money is conserved');
        v_state := pg_temp.state_of(pg_catalog.format('SELECT finance.propose_dispute_offer(%L, 5000)', v_d.id));
        PERFORM pg_temp.ok(v_state = 'PS409', format('3 a closed case takes no offer (%s)', v_state));
        PERFORM pg_temp.act(v_operator);
        v_state := pg_temp.state_of(pg_catalog.format(
            'SELECT finance.resolve_dispute(%L, %L, NULL, %L)', v_d.id, 'refund', 'Too late.'));
        PERFORM pg_temp.ok(v_state = 'PS409', format('3 a closed case takes no ruling (%s)', v_state));
        RAISE EXCEPTION USING ERRCODE = 'PRB01';
    EXCEPTION WHEN SQLSTATE 'PRB01' THEN
        NULL;
    END;
    -- #endregion

    -- #region 4. An operator's release ruling
    BEGIN
        PERFORM pg_temp.act(v_operator);
        v_out := finance.resolve_dispute(v_d.id, 'release', NULL, 'The delivery matches the brief.');
        SELECT * INTO v_d FROM finance.disputes WHERE id = v_d.id;
        PERFORM pg_temp.ok(v_d.status = 'resolved_release' AND v_d.resolved_by = v_operator,
            '4 the operator''s ruling closes the case as a release');
        PERFORM pg_temp.ok((SELECT e.status = 'released' FROM finance.escrows e WHERE e.id = v_escrow)
                           AND (SELECT pg_catalog.sum(pr.amount_cents) FROM finance.pending_releases pr
                                 WHERE pr.escrow_id = v_escrow) = (v_d.settlement->>'payee_minor')::bigint
                           AND (v_d.settlement->>'refund_minor')::bigint = 0,
            '4 the whole payment clears to the freelancer');
        PERFORM pg_temp.ok((SELECT ss.status = 'accepted' FROM projects.stage_submissions ss WHERE ss.id = v_submission)
                           AND (SELECT tk.current_stage_id = v_stage FROM projects.tickets tk WHERE tk.id = v_ticket)
                           AND NOT finance.fn_ticket_has_live_dispute(v_ticket),
            '4 the submission is accepted and the ticket waits on its stage for the client to move it on');
        PERFORM pg_temp.act(v_client);
        v_state := pg_temp.state_of(pg_catalog.format(
            'SELECT projects.move_ticket(%L, %L::ticket_status)', v_ticket, 'completed'));
        PERFORM pg_temp.ok(v_state = 'ok' AND (SELECT tk.status = 'completed' FROM projects.tickets tk WHERE tk.id = v_ticket),
            format('4 the client then moves it on from the board, nothing left to release (%s)', v_state));
        PERFORM pg_temp.ok(pg_temp.imbalance() = v_imbalance, '4 money is conserved');
        RAISE EXCEPTION USING ERRCODE = 'PRB01';
    EXCEPTION WHEN SQLSTATE 'PRB01' THEN
        NULL;
    END;
    -- #endregion
        RAISE EXCEPTION USING ERRCODE = 'PRB02';
    EXCEPTION WHEN SQLSTATE 'PRB02' THEN
        NULL;
    END;

    -- #region 5. The freelancer raises; a refund ruling
    BEGIN
        PERFORM pg_temp.act(v_freelancer);
        v_out := finance.open_ticket_dispute(v_ticket, v_stage, 'The client keeps widening the scope.',
            'The brief asked for two screens; review asks for six.');
        PERFORM pg_temp.ok((SELECT d.claimant_side = 'payee' FROM finance.disputes d
                             WHERE d.id = (v_out->>'dispute_id')::uuid)
                           AND finance.fn_dispute_party((v_out->>'dispute_id')::uuid, v_client) = 'respondent'
                           AND EXISTS (SELECT 1 FROM comms.notifications n
                                        WHERE n.user_id = v_client AND n.type = 'dispute.opened'
                                          AND n.entity_id = (v_out->>'dispute_id')::uuid),
            '5 the freelancer raises it from their side, and the client is the respondent, told');
        SELECT w.balance_cents INTO v_wallet_before FROM finance.wallets w
         WHERE w.owner_id = COALESCE(v_biz, v_client) AND upper(w.currency) = upper(v_currency)
         ORDER BY w.id LIMIT 1;
        PERFORM pg_temp.act(v_operator);
        PERFORM finance.resolve_dispute((v_out->>'dispute_id')::uuid, 'refund', NULL, 'The work was not delivered.');
        SELECT w.balance_cents INTO v_wallet_after FROM finance.wallets w
         WHERE w.owner_id = COALESCE(v_biz, v_client) AND upper(w.currency) = upper(v_currency)
         ORDER BY w.id LIMIT 1;
        PERFORM pg_temp.ok((SELECT e.status = 'refunded' FROM finance.escrows e WHERE e.id = v_escrow)
                           AND v_wallet_after - v_wallet_before = v_amount,
            '5 the refund ruling returns the whole payment to the client');
        PERFORM pg_temp.ok((SELECT tk.status = 'cancelled' FROM projects.tickets tk WHERE tk.id = v_ticket),
            '5 the ticket ends cancelled');
        PERFORM pg_temp.ok(pg_temp.imbalance() = v_imbalance, '5 money is conserved');
        RAISE EXCEPTION USING ERRCODE = 'PRB01';
    EXCEPTION WHEN SQLSTATE 'PRB01' THEN
        NULL;
    END;
    -- #endregion

    -- #region 6. The pending window: money already released
    BEGIN
        PERFORM pg_temp.act(v_client);
        PERFORM projects.review_submission(v_submission, 'accept');
        SELECT pg_catalog.sum(pr.amount_cents), pg_catalog.count(*) INTO v_rows_before, v_n
          FROM finance.pending_releases pr WHERE pr.escrow_id = v_escrow AND pr.state = 'pending';
        PERFORM pg_temp.ok((SELECT e.status = 'released' FROM finance.escrows e WHERE e.id = v_escrow) AND v_n > 0,
            format('6 fixture: the accepted submission released the escrow into %s clearing row(s)', v_n));
        v_out := finance.open_ticket_dispute(v_ticket, v_stage, 'A defect found after approval.',
            'The exported files are corrupt.');
        PERFORM pg_temp.ok(v_out->>'window' = 'pending'
                           AND (SELECT pg_catalog.count(*) FROM finance.pending_releases pr
                                 WHERE pr.escrow_id = v_escrow AND pr.state = 'on_hold'
                                   AND pr.hold_dispute_id = (v_out->>'dispute_id')::uuid) = v_n,
            '6 a dispute within the 7 days freezes every clearing row');
        PERFORM finance.sweep_disputes();
        PERFORM pg_temp.ok((SELECT d.status = 'awaiting_response' FROM finance.disputes d
                             WHERE d.id = (v_out->>'dispute_id')::uuid),
            '6 the sweep does not close it because its escrow reads released');
        SELECT w.balance_cents INTO v_wallet_before FROM finance.wallets w
         WHERE w.owner_id = COALESCE(v_biz, v_client) AND upper(w.currency) = upper(v_currency)
         ORDER BY w.id LIMIT 1;
        SELECT * INTO v_split FROM finance.fn_fair_exit_split(v_amount, 2500, v_fee_bp);
        PERFORM pg_temp.act(v_operator);
        v_out := finance.resolve_dispute((v_out->>'dispute_id')::uuid, 'split', 2500, 'A quarter was usable.');
        SELECT * INTO v_d FROM finance.disputes WHERE id = (v_out->>'dispute_id')::uuid;
        SELECT w.balance_cents INTO v_wallet_after FROM finance.wallets w
         WHERE w.owner_id = COALESCE(v_biz, v_client) AND upper(w.currency) = upper(v_currency)
         ORDER BY w.id LIMIT 1;
        PERFORM pg_temp.ok(v_d.status = 'resolved_split' AND v_d.settlement->>'window' = 'pending'
                           AND (v_d.settlement->>'payee_minor')::bigint = LEAST(v_split.payout_cents, v_rows_before),
            '6 the split leaves the freelancer the ruled share');
        PERFORM pg_temp.ok((SELECT pg_catalog.sum(pr.amount_cents - pr.recovered_cents) FROM finance.pending_releases pr
                             WHERE pr.escrow_id = v_escrow) = (v_d.settlement->>'payee_minor')::bigint
                           AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr
                                            WHERE pr.escrow_id = v_escrow AND pr.state = 'on_hold'),
            '6 the rest is taken back from the clearing rows, which clear their remainder again');
        PERFORM pg_temp.ok((v_d.settlement->>'fee_returned_minor')::bigint > 0
                           AND v_wallet_after - v_wallet_before = (v_d.settlement->>'refund_minor')::bigint
                           AND (v_d.settlement->>'refund_minor')::bigint
                               = v_rows_before - (v_d.settlement->>'payee_minor')::bigint
                                 + (v_d.settlement->>'fee_returned_minor')::bigint,
            format('6 the client gets back what was taken plus the fee no longer earned (%s)', v_d.settlement));
        PERFORM pg_temp.ok(pg_temp.imbalance() = v_imbalance, '6 money is conserved');
        RAISE EXCEPTION USING ERRCODE = 'PRB01';
    EXCEPTION WHEN SQLSTATE 'PRB01' THEN
        NULL;
    END;
    -- #endregion
END $$;

ROLLBACK;
