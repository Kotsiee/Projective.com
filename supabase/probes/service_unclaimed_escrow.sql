-- =============================================================================================
-- Probe: an escrow nobody claimed can only be refunded, never paid out (Decision #466, PRD-F24).
--
-- The payee binds at the claim, for every kind of project (finance.fn_ticket_payee): a team seat on a
-- stage no longer binds an unclaimed ticket's escrow at the hold. Before this, a team seller's bought
-- Pipeline service (and a brief whose stage hired a team) held every funded ticket bound to the team,
-- so the prepaid TTL never swept it, approve_stage paid it out and a stage Fair Exit paid a share.
--   1 a funded, unclaimed service ticket holds with payee NULL and expires_at = now() + the service
--     window; the quote calls it prepaid
--   2 before anyone claims: approve_stage is refused and moves nothing; a stage Fair Exit refunds
--     every unclaimed escrow whole and pays nobody
--   3 move_ticket refuses an unclaimed funded ticket entering work (PF402, reason `unclaimed`), for
--     the client and for a seated team member alike
--   4 a member's claim binds the team and stops the clock; a claimed ticket enters work
--   5 the TTL sweep: nothing before the window; after it the unclaimed escrow comes back whole and
--     the claimed one stays held
--   6 approve_stage: the claimed ticket pays the team (split across its members), the unclaimed one
--     comes back whole and pays nothing
--   7 a stage Fair Exit at 50%: the claimed ticket splits, the unclaimed one comes back whole
--   8 a brief whose stage hired a team: unclaimed held prepaid on the project window; approve_stage
--     pays the claimed ticket and refunds the unclaimed one
--   9 a solo seller's service is unchanged: prepaid until the claim, then bound to the claimant
--  10 nowhere in the database is a held ticket escrow bound while nobody holds its ticket
-- FBP DB16 (conservation_identity.sql) has not landed, so every settlement here asserts its own
-- conservation: for each escrow, paid out + platform fee + refunded = held.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a seeded local DB:
--   deno task test:probes service_unclaimed_escrow
-- A clean run prints only PASS.
-- =============================================================================================

BEGIN;

-- What an escrow paid out and what it refunded. Paid: every earned credit that names it, to any wallet
-- but its payer's, whether still in the pending window (finance.pending_releases) or already in the
-- ledger (a matured row's transaction is counted once). Refunded: credits to its payer's wallet. Its
-- fee is escrows.platform_fee_cents.
CREATE FUNCTION pg_temp.mr1_payer_wallet(p_escrow uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT w.id FROM finance.escrows e
      JOIN finance.wallets w
        ON w.owner_type = finance.fn_escrow_payer_wallet_type(e.payer_business_id, e.payer_user_id)
       AND w.owner_id = COALESCE(e.payer_business_id, e.payer_user_id) AND w.currency = e.currency
     WHERE e.id = p_escrow;
$$;
CREATE FUNCTION pg_temp.mr1_paid(p_escrow uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT (COALESCE((SELECT SUM(pr.amount_cents) FROM finance.pending_releases pr
                       WHERE pr.escrow_id = p_escrow), 0)
          + COALESCE((SELECT SUM(t.amount_cents) FROM finance.transactions t
                       WHERE t.ref_table = 'escrows' AND t.ref_id = p_escrow AND t.direction = 'credit'
                         AND t.wallet_id IS DISTINCT FROM pg_temp.mr1_payer_wallet(p_escrow)
                         AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr
                                          WHERE pr.transaction_id = t.id)), 0))::bigint;
$$;
CREATE FUNCTION pg_temp.mr1_refunded(p_escrow uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(t.amount_cents), 0)::bigint FROM finance.transactions t
     WHERE t.ref_table = 'escrows' AND t.ref_id = p_escrow AND t.direction = 'credit'
       AND t.wallet_id = pg_temp.mr1_payer_wallet(p_escrow);
$$;
-- Every escrow on these tickets: paid + fee + refunded = held, and nothing still held. Raises.
CREATE FUNCTION pg_temp.mr1_assert_conserved(p_tickets uuid[], p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT e.id, e.status, e.amount_cents, COALESCE(e.platform_fee_cents, 0) AS fee
               FROM finance.escrows e
              WHERE e.ticket_id = ANY (p_tickets) AND e.revision_id IS NULL AND e.status IN ('released', 'refunded')
    LOOP
        IF pg_temp.mr1_paid(r.id) + r.fee + pg_temp.mr1_refunded(r.id) <> r.amount_cents THEN
            RAISE EXCEPTION 'FAIL % conservation on escrow %: paid % + fee % + refunded % <> held %',
                p_label, r.id, pg_temp.mr1_paid(r.id), r.fee, pg_temp.mr1_refunded(r.id), r.amount_cents;
        END IF;
    END LOOP;
END;
$$;

DO $$
DECLARE
    v_bp uuid;
    v_seller uuid;
    v_team uuid;
    v_member uuid;
    v_buyer uuid;
    v_project uuid;
    v_currency text;
    v_wallet_type text;
    v_wallet uuid;
    v_ttl integer;
    v_s1 uuid;
    v_ta uuid;
    v_tb uuid;
    v_ea uuid;
    v_eb uuid;
    v_amount_a bigint;
    v_amount_b bigint;
    v_out jsonb;
    v_before bigint;
    v_after bigint;
    v_detail text;
    v_n integer;
    v_members integer;
    -- the brief
    v_brief uuid;
    v_brief_stage uuid;
    v_brief_team uuid;
    v_brief_owner uuid;
    v_brief_member uuid;
    v_brief_payer uuid;
    v_brief_payer_type text;
    v_brief_currency text;
    v_bc uuid;
    v_bd uuid;
    -- the solo service
    v_solo_bp uuid;
    v_solo_seller uuid;
    v_solo_project uuid;
    v_solo_s1 uuid;
    v_solo_t uuid;
BEGIN
    -- #region 0. Fixtures (as postgres): a team's Pipeline service bought by an individual
    SELECT sb.id, sb.freelancer_profile_id, sb.owner_team_id INTO v_bp, v_seller, v_team
      FROM marketplace.service_blueprints sb
     WHERE sb.delivery_model = 'pipeline' AND sb.is_published AND sb.owner_team_id IS NOT NULL
       AND jsonb_array_length(sb.stage_template) >= 2
       AND EXISTS (SELECT 1 FROM org.team_members tm
                    WHERE tm.team_id = sb.owner_team_id AND tm.status = 'active'
                      AND tm.user_id <> sb.freelancer_profile_id
                      AND finance.fn_freelancer_payout_ready(tm.user_id))
     ORDER BY sb.slug LIMIT 1;
    IF v_bp IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no published team pipeline with a payout-ready member'; END IF;
    SELECT tm.user_id INTO v_member FROM org.team_members tm
     WHERE tm.team_id = v_team AND tm.status = 'active' AND tm.user_id <> v_seller
       AND finance.fn_freelancer_payout_ready(tm.user_id)
     ORDER BY tm.user_id LIMIT 1;
    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm WHERE tm.team_id = v_team AND tm.user_id = u.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.projects p WHERE p.client_user_id = u.user_id AND p.source_blueprint_id = v_bp)
     ORDER BY u.user_id LIMIT 1;
    IF v_member IS NULL OR v_buyer IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: member=% buyer=%', v_member, v_buyer;
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    v_out := marketplace.instantiate_service_blueprint(v_bp, '{}', NULL, 'probe-unclaimed-escrow-0001');
    v_project := (v_out->>'project_id')::uuid;
    PERFORM set_config('request.jwt.claims', '', true);

    SELECT upper(COALESCE(p.currency, 'USD')) INTO v_currency FROM projects.projects p WHERE p.id = v_project;
    SELECT id INTO v_s1 FROM projects.project_stages WHERE project_id = v_project ORDER BY sort_order LIMIT 1;
    v_ttl := finance.fn_prepaid_escrow_ttl_hours(v_project);
    v_wallet_type := finance.fn_person_wallet_type(v_buyer);
    PERFORM finance.fn_ensure_wallet(v_wallet_type, v_buyer, v_currency);
    PERFORM finance.fn_wallet_credit(v_buyer, v_wallet_type, v_currency, 50000000, 'topup', 'inbound_payments', gen_random_uuid());
    SELECT id INTO v_wallet FROM finance.wallets
     WHERE owner_type = v_wallet_type AND owner_id = v_buyer AND currency = v_currency;

    INSERT INTO projects.tickets (project_id, owner_user_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES
        (v_project, v_buyer, NULL, 'backlog', 'Probe 466 claimed', '{"t":"x"}', 'A description.',
         jsonb_build_array(jsonb_build_object('stage_id', v_s1, 'order', 0))),
        (v_project, v_buyer, NULL, 'backlog', 'Probe 466 unclaimed', '{"t":"x"}', 'A description.',
         jsonb_build_array(jsonb_build_object('stage_id', v_s1, 'order', 0)));
    SELECT id INTO v_ta FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 466 claimed';
    SELECT id INTO v_tb FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 466 unclaimed';
    RAISE NOTICE 'fixture bp=% team=% member=% buyer=% project=% ttl=%h', v_bp, v_team, v_member, v_buyer, v_project, v_ttl;
    -- #endregion

    -- #region 1. Funded and unclaimed: held prepaid, on the service window
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    IF (projects.get_ticket_funding_quote(v_project, v_ta)->>'prepaid')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL 1 the quote does not call an unclaimed ticket on a team seat prepaid';
    END IF;
    v_out := projects.fund_ticket(v_project, v_ta, ARRAY[v_s1]);
    IF (v_out->>'prepaid')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL 1 fund_ticket reports the unclaimed hold bound: %', v_out;
    END IF;
    v_out := projects.fund_ticket(v_project, v_tb, ARRAY[v_s1]);
    SELECT id, amount_cents INTO v_ea, v_amount_a FROM finance.escrows WHERE ticket_id = v_ta AND status = 'held';
    SELECT id, amount_cents INTO v_eb, v_amount_b FROM finance.escrows WHERE ticket_id = v_tb AND status = 'held';
    IF v_ea IS NULL OR v_eb IS NULL THEN RAISE EXCEPTION 'FAIL 1 the two tickets are not held'; END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows
                WHERE id IN (v_ea, v_eb)
                  AND (payee_id IS NOT NULL OR payee_type IS NOT NULL
                       OR expires_at IS DISTINCT FROM now() + make_interval(hours => v_ttl))) THEN
        RAISE EXCEPTION 'FAIL 1 an unclaimed service escrow was bound or has no clock: %',
            (SELECT jsonb_agg(jsonb_build_object('payee', payee_id, 'expires_at', expires_at))
               FROM finance.escrows WHERE id IN (v_ea, v_eb));
    END IF;
    RAISE NOTICE 'PASS 1 two funded, unclaimed service tickets hold with no payee, refunded after %h unless claimed', v_ttl;
    -- #endregion

    -- #region 2. Before anyone claims: nothing can be paid out
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    BEGIN
        PERFORM projects.approve_stage(v_project, v_s1);
        RAISE EXCEPTION 'FAIL 2 approve_stage settled a stage nobody claimed';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        IF EXISTS (SELECT 1 FROM finance.escrows WHERE id IN (v_ea, v_eb) AND status <> 'held') THEN
            RAISE EXCEPTION 'FAIL 2 the refused approval moved money';
        END IF;
        RAISE NOTICE 'PASS 2 approve_stage refuses a stage nobody claimed and moves nothing (%)', SQLERRM;
    END;
    BEGIN
        v_out := projects.cancel_stage_fair_exit(v_project, v_s1, 50);
        SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
        IF EXISTS (SELECT 1 FROM finance.escrows WHERE id IN (v_ea, v_eb) AND status <> 'refunded')
            OR pg_temp.mr1_paid(v_ea) + pg_temp.mr1_paid(v_eb) <> 0
            OR v_after - v_before <> v_amount_a + v_amount_b THEN
            RAISE EXCEPTION 'FAIL 2 a Fair Exit on unclaimed work paid % and refunded % of %',
                pg_temp.mr1_paid(v_ea) + pg_temp.mr1_paid(v_eb), v_after - v_before, v_amount_a + v_amount_b;
        END IF;
        PERFORM pg_temp.mr1_assert_conserved(ARRAY[v_ta, v_tb], '2');
        RAISE NOTICE 'PASS 2 a stage Fair Exit on unclaimed work pays nobody and refunds % whole', v_after - v_before;
        RAISE EXCEPTION 'probe-undo';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'probe-undo' THEN RAISE; END IF;
    END;
    -- #endregion

    -- #region 3. Nobody holds it, so it can't be moved into work
    BEGIN
        PERFORM projects.move_ticket(v_tb, 'in_progress'::ticket_status, v_s1);
        RAISE EXCEPTION 'FAIL 3 the client moved an unclaimed funded ticket into In progress';
    EXCEPTION WHEN SQLSTATE 'PF402' THEN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        IF v_detail::jsonb->>'reason' <> 'unclaimed' THEN
            RAISE EXCEPTION 'FAIL 3 the refusal is not the unclaimed one: % (%)', SQLERRM, v_detail;
        END IF;
        RAISE NOTICE 'PASS 3 the client cannot move an unclaimed ticket into work (%)', SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.move_ticket(v_tb, 'in_progress'::ticket_status, v_s1);
        RAISE EXCEPTION 'FAIL 3 a team member moved an unclaimed funded ticket into In progress';
    EXCEPTION WHEN SQLSTATE 'PF402' THEN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        IF v_detail::jsonb->>'reason' <> 'unclaimed' THEN
            RAISE EXCEPTION 'FAIL 3 the member''s refusal is not the unclaimed one: % (%)', SQLERRM, v_detail;
        END IF;
        RAISE NOTICE 'PASS 3 a seated team member cannot either';
    END;
    BEGIN
        PERFORM projects.move_ticket(v_tb, 'in_review'::ticket_status, v_s1);
        RAISE EXCEPTION 'FAIL 3 an unclaimed funded ticket was moved into In review';
    EXCEPTION WHEN SQLSTATE 'PF402' THEN
        RAISE NOTICE 'PASS 3 nor into In review';
    END;
    IF (SELECT status FROM projects.tickets WHERE id = v_tb) IN ('claimed', 'in_progress', 'in_review') THEN
        RAISE EXCEPTION 'FAIL 3 the refused moves left the ticket in work';
    END IF;
    -- #endregion

    -- #region 4. The claim binds the team and stops the clock
    IF projects.claim_ticket(v_ta, v_member) IS NULL THEN RAISE EXCEPTION 'FAIL 4 the member''s claim was refused'; END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows
                    WHERE id = v_ea AND status = 'held' AND payee_type = 'team' AND payee_id = v_team AND expires_at IS NULL) THEN
        RAISE EXCEPTION 'FAIL 4 the claim did not bind the escrow to the team and clear its clock';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows WHERE id = v_eb AND status = 'held' AND payee_id IS NULL AND expires_at IS NOT NULL) THEN
        RAISE EXCEPTION 'FAIL 4 the claim of one ticket bound the other';
    END IF;
    PERFORM projects.move_ticket(v_ta, 'in_progress'::ticket_status, v_s1);
    IF (SELECT status FROM projects.tickets WHERE id = v_ta) <> 'in_progress'::ticket_status THEN
        RAISE EXCEPTION 'FAIL 4 the claimed ticket could not start';
    END IF;
    RAISE NOTICE 'PASS 4 a member''s claim binds the team seat and stops the clock; the claimed ticket starts';
    -- #endregion

    -- #region 5. The prepaid TTL refunds the unclaimed escrow whole, and only it
    PERFORM set_config('request.jwt.claims', '', true);
    BEGIN
        PERFORM finance.fn_sweep_expired_prepaid_escrows(now() + make_interval(hours => v_ttl) - interval '1 minute', 100000);
        IF EXISTS (SELECT 1 FROM finance.escrows WHERE id IN (v_ea, v_eb) AND status <> 'held') THEN
            RAISE EXCEPTION 'FAIL 5 the sweep refunded before the window closed';
        END IF;
        SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
        PERFORM finance.fn_sweep_expired_prepaid_escrows(now() + make_interval(hours => v_ttl) + interval '1 minute', 100000);
        SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
        IF (SELECT status FROM finance.escrows WHERE id = v_eb) <> 'refunded'
            OR v_after - v_before <> v_amount_b
            OR pg_temp.mr1_paid(v_eb) <> 0
            OR NOT EXISTS (SELECT 1 FROM projects.ticket_history
                            WHERE ticket_id = v_tb AND action_type = 'prepaid_ttl_expired') THEN
            RAISE EXCEPTION 'FAIL 5 after the window: escrow %, wallet moved % of %, paid %',
                (SELECT status FROM finance.escrows WHERE id = v_eb), v_after - v_before, v_amount_b, pg_temp.mr1_paid(v_eb);
        END IF;
        IF (SELECT status FROM finance.escrows WHERE id = v_ea) <> 'held' THEN
            RAISE EXCEPTION 'FAIL 5 the sweep touched the claimed ticket''s escrow';
        END IF;
        PERFORM pg_temp.mr1_assert_conserved(ARRAY[v_tb], '5');
        RAISE NOTICE 'PASS 5 the TTL leaves both before %h; after it % comes back whole, logged, and the claimed escrow stays held', v_ttl, v_amount_b;
        RAISE EXCEPTION 'probe-undo';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'probe-undo' THEN RAISE; END IF;
    END;
    -- #endregion

    -- #region 6. approve_stage: pays the claimed ticket, refunds the unclaimed one
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    BEGIN
        SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
        v_out := projects.approve_stage(v_project, v_s1);
        SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
        IF (v_out->>'released_count')::integer <> 1 OR (v_out->>'refunded_count')::integer <> 1
            OR (v_out->>'refunded_cents')::bigint <> v_amount_b THEN
            RAISE EXCEPTION 'FAIL 6 approve_stage reported %', v_out;
        END IF;
        IF (SELECT status FROM finance.escrows WHERE id = v_ea) <> 'released'
            OR (SELECT status FROM finance.escrows WHERE id = v_eb) <> 'refunded'
            OR pg_temp.mr1_paid(v_eb) <> 0
            OR v_after - v_before <> v_amount_b THEN
            RAISE EXCEPTION 'FAIL 6 the unclaimed escrow was paid % (wallet back %, expected %)',
                pg_temp.mr1_paid(v_eb), v_after - v_before, v_amount_b;
        END IF;
        SELECT count(DISTINCT pr.wallet_id) INTO v_members FROM finance.pending_releases pr
         WHERE pr.escrow_id = v_ea AND pr.reason = 'team_split';
        IF pg_temp.mr1_paid(v_ea) <= 0 OR v_members < 1 THEN
            RAISE EXCEPTION 'FAIL 6 the claimed ticket did not pay the team through its split (paid %, % members)',
                pg_temp.mr1_paid(v_ea), v_members;
        END IF;
        PERFORM pg_temp.mr1_assert_conserved(ARRAY[v_ta, v_tb], '6');
        RAISE NOTICE 'PASS 6 approval paid the claimed ticket % across % team wallet(s) and refunded the unclaimed % whole',
            pg_temp.mr1_paid(v_ea), v_members, v_amount_b;
        RAISE EXCEPTION 'probe-undo';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'probe-undo' THEN RAISE; END IF;
    END;
    -- #endregion

    -- #region 7. A stage Fair Exit: the claimed ticket splits, the unclaimed one comes back whole
    BEGIN
        SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
        v_out := projects.cancel_stage_fair_exit(v_project, v_s1, 50);
        SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
        IF (SELECT status FROM finance.escrows WHERE id = v_ea) <> 'released'
            OR (SELECT status FROM finance.escrows WHERE id = v_eb) <> 'refunded'
            OR pg_temp.mr1_paid(v_eb) <> 0 OR pg_temp.mr1_refunded(v_eb) <> v_amount_b THEN
            RAISE EXCEPTION 'FAIL 7 the unclaimed escrow was paid % on a Fair Exit', pg_temp.mr1_paid(v_eb);
        END IF;
        IF pg_temp.mr1_paid(v_ea) <= 0 OR pg_temp.mr1_refunded(v_ea) <> v_amount_a - (v_amount_a * 5000) / 10000 THEN
            RAISE EXCEPTION 'FAIL 7 the claimed escrow did not split at 50%%: paid %, refunded %',
                pg_temp.mr1_paid(v_ea), pg_temp.mr1_refunded(v_ea);
        END IF;
        IF v_after - v_before <> v_amount_b + pg_temp.mr1_refunded(v_ea) THEN
            RAISE EXCEPTION 'FAIL 7 the buyer got % back, expected %', v_after - v_before, v_amount_b + pg_temp.mr1_refunded(v_ea);
        END IF;
        PERFORM pg_temp.mr1_assert_conserved(ARRAY[v_ta, v_tb], '7');
        RAISE NOTICE 'PASS 7 Fair Exit at 50%%: the claimed ticket paid % and refunded %; the unclaimed % came back whole',
            pg_temp.mr1_paid(v_ea), pg_temp.mr1_refunded(v_ea), v_amount_b;
        RAISE EXCEPTION 'probe-undo';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'probe-undo' THEN RAISE; END IF;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    -- #endregion

    -- #region 8. A brief whose stage hired a team holds by the same rule
    SELECT p.id, ps.id, sa.team_id, p.owner_user_id, p.client_business_id, upper(COALESCE(p.currency, 'USD'))
      INTO v_brief, v_brief_stage, v_brief_team, v_brief_owner, v_brief_payer, v_brief_currency
      FROM projects.stage_assignments sa
      JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
      JOIN projects.projects p ON p.id = ps.project_id
     WHERE sa.assignee_type = 'team' AND sa.status = 'accepted' AND p.source_blueprint_id IS NULL
       AND p.client_user_id IS NULL AND p.status = 'active'
       -- A One-Off holds a single ticket (fn_enforce_structure_variation); this needs two.
       AND p.format <> 'one_off'
       AND ps.status IN ('open', 'assigned', 'in_progress')
       AND NOT projects.fn_is_personal_project(p.id)
       AND EXISTS (SELECT 1 FROM org.team_members tm
                    WHERE tm.team_id = sa.team_id AND tm.status = 'active'
                      AND tm.user_id <> p.owner_user_id AND finance.fn_freelancer_payout_ready(tm.user_id))
     ORDER BY p.slug, ps.sort_order LIMIT 1;
    IF v_brief IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no active brief with an accepted team seat'; END IF;
    SELECT tm.user_id INTO v_brief_member FROM org.team_members tm
     WHERE tm.team_id = v_brief_team AND tm.status = 'active' AND tm.user_id <> v_brief_owner
       AND finance.fn_freelancer_payout_ready(tm.user_id)
     ORDER BY tm.user_id LIMIT 1;
    -- The business spend gate is not under test here (business_spend_gate.sql owns it).
    UPDATE org.business_profiles SET kyb_status = 'verified' WHERE id = v_brief_payer;
    v_brief_payer_type := finance.fn_escrow_payer_wallet_type(v_brief_payer, CASE WHEN v_brief_payer IS NULL THEN v_brief_owner END);
    PERFORM finance.fn_ensure_wallet(v_brief_payer_type, COALESCE(v_brief_payer, v_brief_owner), v_brief_currency);
    PERFORM finance.fn_wallet_credit(COALESCE(v_brief_payer, v_brief_owner), v_brief_payer_type, v_brief_currency,
                                     50000000, 'topup', 'inbound_payments', gen_random_uuid());
    -- No approval threshold and an uncapped envelope, as business_spend_gate.sql sets them up.
    UPDATE finance.wallets SET approval_threshold_cents = NULL
     WHERE owner_type = v_brief_payer_type AND owner_id = COALESCE(v_brief_payer, v_brief_owner) AND currency = v_brief_currency;
    UPDATE security.platform_params SET value = '{"default": 0}'::jsonb WHERE key = 'vault_approval_threshold_cents';
    DELETE FROM finance.spending_limits sl
     USING finance.wallets w
     WHERE sl.wallet_id = w.id AND sl.member_user_id = v_brief_owner
       AND w.owner_type = v_brief_payer_type AND w.owner_id = COALESCE(v_brief_payer, v_brief_owner) AND w.currency = v_brief_currency;

    INSERT INTO projects.tickets (project_id, owner_user_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES
        (v_brief, v_brief_owner, NULL, 'backlog', 'Probe 466 brief claimed', '{"t":"x"}', 'A description.',
         jsonb_build_array(jsonb_build_object('stage_id', v_brief_stage, 'order', 0))),
        (v_brief, v_brief_owner, NULL, 'backlog', 'Probe 466 brief unclaimed', '{"t":"x"}', 'A description.',
         jsonb_build_array(jsonb_build_object('stage_id', v_brief_stage, 'order', 0)));
    SELECT id INTO v_bc FROM projects.tickets WHERE project_id = v_brief AND title = 'Probe 466 brief claimed';
    SELECT id INTO v_bd FROM projects.tickets WHERE project_id = v_brief AND title = 'Probe 466 brief unclaimed';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_brief_owner, 'role', 'authenticated')::text, true);
    PERFORM projects.fund_ticket(v_brief, v_bc, ARRAY[v_brief_stage]);
    PERFORM projects.fund_ticket(v_brief, v_bd, ARRAY[v_brief_stage]);
    IF EXISTS (SELECT 1 FROM finance.escrows
                WHERE ticket_id IN (v_bc, v_bd) AND status = 'held'
                  AND (payee_id IS NOT NULL
                       OR expires_at IS DISTINCT FROM now() + make_interval(hours => finance.fn_prepaid_escrow_ttl_hours(v_brief))))
        OR (SELECT count(*) FROM finance.escrows WHERE ticket_id IN (v_bc, v_bd) AND status = 'held') <> 2 THEN
        RAISE EXCEPTION 'FAIL 8 the team-hired brief bound an unclaimed escrow at the hold';
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_brief_member, 'role', 'authenticated')::text, true);
    IF projects.claim_ticket(v_bc, v_brief_member) IS NULL THEN RAISE EXCEPTION 'FAIL 8 the brief member''s claim was refused'; END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows
                    WHERE ticket_id = v_bc AND status = 'held' AND payee_type = 'team' AND payee_id = v_brief_team) THEN
        RAISE EXCEPTION 'FAIL 8 the brief member''s claim did not bind the team';
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_brief_owner, 'role', 'authenticated')::text, true);
    BEGIN
        v_out := projects.approve_stage(v_brief, v_brief_stage);
        IF EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_bd AND status <> 'refunded')
            OR (SELECT pg_temp.mr1_paid(id) FROM finance.escrows WHERE ticket_id = v_bd) <> 0
            OR NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_bc AND status = 'released')
            OR (SELECT pg_temp.mr1_paid(id) FROM finance.escrows WHERE ticket_id = v_bc) <= 0 THEN
            RAISE EXCEPTION 'FAIL 8 approving the brief''s stage: %', v_out;
        END IF;
        PERFORM pg_temp.mr1_assert_conserved(ARRAY[v_bc, v_bd], '8');
        RAISE NOTICE 'PASS 8 a team-hired brief holds unclaimed work prepaid; approval pays the claimed ticket and refunds the other whole';
        RAISE EXCEPTION 'probe-undo';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'probe-undo' THEN RAISE; END IF;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    -- #endregion

    -- #region 9. A solo seller's service: prepaid until the claim, as before
    SELECT sb.id, sb.freelancer_profile_id INTO v_solo_bp, v_solo_seller
      FROM marketplace.service_blueprints sb
     WHERE sb.delivery_model = 'pipeline' AND sb.is_published AND sb.owner_team_id IS NULL
       AND sb.freelancer_profile_id <> v_buyer AND finance.fn_freelancer_payout_ready(sb.freelancer_profile_id)
     ORDER BY sb.slug LIMIT 1;
    IF v_solo_bp IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no published solo pipeline with a payout-ready seller'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    v_out := marketplace.instantiate_service_blueprint(v_solo_bp, '{}', NULL, 'probe-unclaimed-escrow-0002');
    v_solo_project := (v_out->>'project_id')::uuid;
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT upper(COALESCE(p.currency, 'USD')) INTO v_currency FROM projects.projects p WHERE p.id = v_solo_project;
    PERFORM finance.fn_ensure_wallet(v_wallet_type, v_buyer, v_currency);
    PERFORM finance.fn_wallet_credit(v_buyer, v_wallet_type, v_currency, 50000000, 'topup', 'inbound_payments', gen_random_uuid());
    SELECT id INTO v_solo_s1 FROM projects.project_stages WHERE project_id = v_solo_project ORDER BY sort_order LIMIT 1;
    INSERT INTO projects.tickets (project_id, owner_user_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_solo_project, v_buyer, NULL, 'backlog', 'Probe 466 solo', '{"t":"x"}', 'A description.',
            jsonb_build_array(jsonb_build_object('stage_id', v_solo_s1, 'order', 0)))
    RETURNING id INTO v_solo_t;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    PERFORM projects.fund_ticket(v_solo_project, v_solo_t, ARRAY[v_solo_s1]);
    IF NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_solo_t AND status = 'held'
                    AND payee_id IS NULL AND expires_at IS NOT NULL) THEN
        RAISE EXCEPTION 'FAIL 9 the solo service''s unclaimed hold is not prepaid';
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_solo_seller, 'role', 'authenticated')::text, true);
    IF projects.claim_ticket(v_solo_t, v_solo_seller) IS NULL THEN RAISE EXCEPTION 'FAIL 9 the solo seller''s claim was refused'; END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_solo_t AND status = 'held'
                    AND payee_type = 'freelancer' AND payee_id = v_solo_seller AND expires_at IS NULL) THEN
        RAISE EXCEPTION 'FAIL 9 the solo seller''s claim did not bind them';
    END IF;
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE NOTICE 'PASS 9 a solo seller''s service holds prepaid and binds the seller at their claim';
    -- #endregion

    -- #region 10. Bound means somebody holds the ticket
    SELECT count(*) INTO v_n
      FROM finance.escrows e JOIN projects.tickets t ON t.id = e.ticket_id
     WHERE e.status = 'held' AND e.revision_id IS NULL AND e.payee_id IS NOT NULL AND t.current_assignee_id IS NULL;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FAIL 10 % held ticket escrow(s) are bound while nobody holds the ticket', v_n;
    END IF;
    RAISE NOTICE 'PASS 10 no held ticket escrow is bound while nobody holds its ticket';
    -- #endregion
END;
$$;

ROLLBACK;
