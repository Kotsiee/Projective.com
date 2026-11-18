-- =============================================================================================
-- Probe: a bought service is activated by its money and cancelled by settling it (Decision #456).
--
-- A team's Pipeline service, bought by an individual: Publish is not the seller's (set_project_status
-- refuses them), the first held escrow moves the draft to active, and cancelling is the client's,
-- through projects.cancel_service only. That door settles before it cancels: a claimed ticket pays
-- its team the Fair Exit share chosen for its stage, an unclaimed prepaid one and a later-stage
-- reservation come back whole, the open tickets and stages close, and every unit of money that was
-- held lands somewhere. A plain cancel or archive is refused while anything is held, and an ended
-- service takes no new escrow.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a seeded local DB:
--   deno task test:probes service_cancel
--
-- Conservation is the identity's (finance.v_conservation_identity, FBP DB16): the cancellation leaves
-- every currency's imbalance where it was, measured after the fixture's own credit.
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_bp uuid;
    v_seller uuid;
    v_team uuid;
    v_member uuid;
    v_buyer uuid;
    v_stranger uuid;
    v_project uuid;
    v_currency text;
    v_wallet_type text;
    v_s1 uuid;
    v_s2 uuid;
    v_s3 uuid;
    v_t1 uuid;
    v_t2 uuid;
    v_t3 uuid;
    v_t4 uuid;
    v_out jsonb;
    v_preview jsonb;
    v_expected_return bigint;
    v_held_before bigint;
    v_imbalance jsonb;
    v_before bigint;
    v_after bigint;
    v_status project_status;
    v_detail text;
    v_n integer;
BEGIN
    -- #region 0. Fixtures (as postgres)
    SELECT sb.id, sb.freelancer_profile_id, sb.owner_team_id INTO v_bp, v_seller, v_team
      FROM marketplace.service_blueprints sb
     WHERE sb.delivery_model = 'pipeline' AND sb.is_published AND sb.owner_team_id IS NOT NULL
       AND jsonb_array_length(sb.stage_template) >= 3
       AND EXISTS (SELECT 1 FROM org.team_members tm
                    WHERE tm.team_id = sb.owner_team_id AND tm.status = 'active'
                      AND tm.user_id <> sb.freelancer_profile_id
                      AND finance.fn_freelancer_payout_ready(tm.user_id))
     ORDER BY sb.slug LIMIT 1;
    IF v_bp IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no published team pipeline of 3+ stages with a payout-ready member'; END IF;

    SELECT tm.user_id INTO v_member FROM org.team_members tm
     WHERE tm.team_id = v_team AND tm.status = 'active' AND tm.user_id <> v_seller
       AND finance.fn_freelancer_payout_ready(tm.user_id)
     ORDER BY tm.user_id LIMIT 1;
    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm WHERE tm.team_id = v_team AND tm.user_id = u.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.projects p WHERE p.client_user_id = u.user_id AND p.source_blueprint_id = v_bp)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id NOT IN (v_seller, v_member, v_buyer)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm WHERE tm.team_id = v_team AND tm.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    IF v_member IS NULL OR v_buyer IS NULL OR v_stranger IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: member=% buyer=% stranger=%', v_member, v_buyer, v_stranger;
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    v_out := marketplace.instantiate_service_blueprint(v_bp, '{}', NULL, 'probe-service-cancel-0001');
    v_project := (v_out->>'project_id')::uuid;
    PERFORM set_config('request.jwt.claims', '', true);

    SELECT upper(COALESCE(p.currency, 'USD')) INTO v_currency FROM projects.projects p WHERE p.id = v_project;
    SELECT id INTO v_s1 FROM projects.project_stages WHERE project_id = v_project ORDER BY sort_order LIMIT 1;
    SELECT id INTO v_s2 FROM projects.project_stages WHERE project_id = v_project ORDER BY sort_order OFFSET 1 LIMIT 1;
    SELECT id INTO v_s3 FROM projects.project_stages WHERE project_id = v_project ORDER BY sort_order OFFSET 2 LIMIT 1;

    v_wallet_type := finance.fn_person_wallet_type(v_buyer);
    PERFORM finance.fn_ensure_wallet(v_wallet_type, v_buyer, v_currency);
    PERFORM finance.fn_wallet_credit(v_buyer, v_wallet_type, v_currency, 50000000, 'topup', 'inbound_payments', gen_random_uuid());

    INSERT INTO projects.tickets (project_id, owner_user_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES
        (v_project, v_buyer, NULL, 'backlog', 'Probe 456 claimed', '{"t":"x"}', 'A description.',
         jsonb_build_array(jsonb_build_object('stage_id', v_s1, 'order', 0))),
        (v_project, v_buyer, NULL, 'backlog', 'Probe 456 prepaid', '{"t":"x"}', 'A description.',
         jsonb_build_array(jsonb_build_object('stage_id', v_s2, 'order', 0), jsonb_build_object('stage_id', v_s3, 'order', 1))),
        (v_project, v_buyer, NULL, 'backlog', 'Probe 456 unfunded', '{"t":"x"}', 'A description.',
         jsonb_build_array(jsonb_build_object('stage_id', v_s1, 'order', 0)));
    SELECT id INTO v_t1 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 456 claimed';
    SELECT id INTO v_t2 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 456 prepaid';
    SELECT id INTO v_t3 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 456 unfunded';
    RAISE NOTICE 'fixture bp=% project=% seller=% member=% buyer=% stages=%,%,%', v_bp, v_project, v_seller, v_member, v_buyer, v_s1, v_s2, v_s3;
    -- #endregion

    -- #region 1. No Publish for the seller; an unfunded draft still cancels directly
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.set_project_status(v_project, 'active'::project_status);
        RAISE EXCEPTION 'FAIL the seller published the bought service';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS 1 the seller cannot publish a bought service';
    END;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.set_project_status(v_project, 'cancelled'::project_status);
        RAISE EXCEPTION 'probe-rollback' USING ERRCODE = 'P0001';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'probe-rollback' THEN RAISE; END IF;
        RAISE NOTICE 'PASS 1 a draft holding nothing cancels through set_project_status';
    END;
    -- #endregion

    -- #region 2. The first held escrow activates it
    v_out := projects.fund_ticket(v_project, v_t1, ARRAY[v_s1]);
    SELECT status INTO v_status FROM projects.projects WHERE id = v_project;
    IF v_status <> 'active'::project_status OR NOT EXISTS (
        SELECT 1 FROM projects.project_status_history h
         WHERE h.project_id = v_project AND h.from_status = 'draft' AND h.to_status = 'active'
           AND h.reason = 'First stage funded' AND h.actor_user_id = v_buyer
    ) THEN
        RAISE EXCEPTION 'FAIL 2 the first held escrow left the service %', v_status;
    END IF;
    RAISE NOTICE 'PASS 2 the first held escrow moved the service draft -> active, recorded as the buyer''s';

    v_out := projects.fund_ticket(v_project, v_t2, ARRAY[v_s2, v_s3]);
    IF NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_t2 AND status = 'held' AND project_stage_id = v_s2)
        OR NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_t2 AND status = 'reserved' AND project_stage_id = v_s3) THEN
        RAISE EXCEPTION 'FAIL 2 the prepaid ticket is not held on stage 2 and reserved on stage 3: %', v_out;
    END IF;
    RAISE NOTICE 'PASS 2 a second ticket is held on stage 2 and reserved on stage 3';
    -- #endregion

    -- #region 3. A team member claims the first ticket
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    IF projects.claim_ticket(v_t1, v_member) IS NULL THEN RAISE EXCEPTION 'FAIL 3 the member''s claim was refused'; END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows
                    WHERE ticket_id = v_t1 AND status = 'held' AND payee_id = v_team AND payee_type = 'team') THEN
        RAISE EXCEPTION 'FAIL 3 the claim did not bind the escrow to the team';
    END IF;
    RAISE NOTICE 'PASS 3 a member claims through the team seat; the escrow pays the team';
    -- #endregion

    -- #region 4. The preview: one stage to settle, the rest back at once
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_expected_return
      FROM finance.escrows WHERE ticket_id = v_t2 AND status IN ('held', 'reserved');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    v_preview := projects.preview_service_cancel(v_project);
    IF (v_preview->>'cancellable')::boolean IS NOT TRUE OR v_preview->>'blocked' IS NOT NULL
        OR jsonb_array_length(v_preview->'stages') <> 1
        OR (v_preview->'stages'->0->>'stage_id')::uuid <> v_s1
        OR jsonb_array_length(v_preview->'stages'->0->'tiers') <> 3
        OR (v_preview->>'returned_cents')::bigint <> v_expected_return
        OR (v_preview->>'tickets_to_cancel')::integer <> 3 THEN
        RAISE EXCEPTION 'FAIL 4 preview: % (expected % back)', v_preview, v_expected_return;
    END IF;
    RAISE NOTICE 'PASS 4 preview: stage 1 needs a tier, % comes back at once, 3 tickets close', v_expected_return;
    -- #endregion

    -- #region 5. Refusals — nothing moves
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_held_before
      FROM finance.escrows e JOIN projects.project_stages ps ON ps.id = e.project_stage_id
     WHERE ps.project_id = v_project AND e.status IN ('held', 'reserved');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.cancel_service(v_project, jsonb_build_object(v_s1::text, 50));
        RAISE EXCEPTION 'FAIL 5 the seller cancelled the client''s service';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS 5 the seller cannot cancel';
    END;
    BEGIN
        PERFORM projects.preview_service_cancel(v_project);
        RAISE EXCEPTION 'FAIL 5 the seller read the cancellation preview';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS 5 the seller cannot read the cancellation preview';
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.cancel_service(v_project, jsonb_build_object(v_s1::text, 50));
        RAISE EXCEPTION 'FAIL 5 a stranger cancelled the service';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS 5 a stranger cannot cancel';
    END;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.set_project_status(v_project, 'cancelled'::project_status);
        RAISE EXCEPTION 'FAIL 5 a funded service was cancelled without settling';
    EXCEPTION WHEN SQLSTATE 'PF409' THEN
        RAISE NOTICE 'PASS 5 a plain cancel is refused while escrow is held (%)', SQLERRM;
    END;
    BEGIN
        PERFORM projects.set_project_status(v_project, 'archived'::project_status);
        RAISE EXCEPTION 'FAIL 5 a funded service was archived without settling';
    EXCEPTION WHEN SQLSTATE 'PF409' THEN
        RAISE NOTICE 'PASS 5 an archive is refused while escrow is held';
    END;
    BEGIN
        PERFORM projects.cancel_service(v_project, '{}'::jsonb);
        RAISE EXCEPTION 'FAIL 5 claimed work was cancelled with no tier';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        IF (v_detail::jsonb->>'reason') <> 'tier_required'
            OR (v_detail::jsonb->'stages'->0->>'stage_id')::uuid <> v_s1 THEN
            RAISE EXCEPTION 'FAIL 5 tier refusal detail: %', v_detail;
        END IF;
        RAISE NOTICE 'PASS 5 a missing tier is refused, naming stage 1';
    END;
    BEGIN
        PERFORM projects.cancel_service(v_project, jsonb_build_object(v_s1::text, 60));
        RAISE EXCEPTION 'FAIL 5 a 60%% tier was accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS 5 a tier outside 25/50/75 is refused';
    END;
    IF (SELECT COALESCE(SUM(amount_cents), 0)
          FROM finance.escrows e JOIN projects.project_stages ps ON ps.id = e.project_stage_id
         WHERE ps.project_id = v_project AND e.status IN ('held', 'reserved')) <> v_held_before THEN
        RAISE EXCEPTION 'FAIL 5 a refusal moved money';
    END IF;
    RAISE NOTICE 'PASS 5 every refusal left % held', v_held_before;
    -- #endregion

    -- #region 6. The client cancels: settled, then Cancelled
    SELECT balance_cents INTO v_before FROM finance.wallets
     WHERE owner_type = v_wallet_type AND owner_id = v_buyer AND currency = v_currency;
    v_imbalance := (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c);
    v_out := projects.cancel_service(v_project, jsonb_build_object(v_s1::text, 50), 'Changed my mind');
    SELECT balance_cents INTO v_after FROM finance.wallets
     WHERE owner_type = v_wallet_type AND owner_id = v_buyer AND currency = v_currency;

    IF v_out->>'status' <> 'cancelled'
        OR (SELECT status FROM projects.projects WHERE id = v_project) <> 'cancelled'::project_status
        OR NOT EXISTS (SELECT 1 FROM projects.project_status_history h
                        WHERE h.project_id = v_project AND h.to_status = 'cancelled' AND h.reason = 'Changed my mind') THEN
        RAISE EXCEPTION 'FAIL 6 the service did not land cancelled: %', v_out;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows e JOIN projects.project_stages ps ON ps.id = e.project_stage_id
                WHERE ps.project_id = v_project AND e.status IN ('held', 'reserved')) THEN
        RAISE EXCEPTION 'FAIL 6 escrow is still held or reserved after the cancellation';
    END IF;
    IF (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c) IS DISTINCT FROM v_imbalance THEN
        RAISE EXCEPTION 'FAIL 6 conservation: the cancellation moved the identity from % to %',
            v_imbalance, (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c);
    END IF;
    IF v_after - v_before <> (v_out->>'client_refunded_cents')::bigint THEN
        RAISE EXCEPTION 'FAIL 6 the buyer''s wallet moved % but the door reports % refunded',
            v_after - v_before, v_out->>'client_refunded_cents';
    END IF;
    IF (v_out->>'freelancer_paid_cents')::bigint <> (v_preview->'stages'->0->'tiers'->1->>'freelancer_paid_cents')::bigint
        OR (v_out->>'freelancer_paid_cents')::bigint <= 0 THEN
        RAISE EXCEPTION 'FAIL 6 the team was paid % but the 50%% quote said %',
            v_out->>'freelancer_paid_cents', v_preview->'stages'->0->'tiers'->1->>'freelancer_paid_cents';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_t1 AND status = 'released')
        OR EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_t2 AND status <> 'refunded') THEN
        RAISE EXCEPTION 'FAIL 6 the claimed escrow was not released or the prepaid one not refunded';
    END IF;
    RAISE NOTICE 'PASS 6 settled: team paid % at 50%%, fee %, % back to the buyer — % held in, all accounted for',
        v_out->>'freelancer_paid_cents', v_out->>'fee_cents', v_out->>'client_refunded_cents', v_held_before;

    SELECT count(*) INTO v_n FROM projects.tickets
     WHERE project_id = v_project AND status <> 'cancelled'::ticket_status;
    IF v_n <> 0 OR (v_out->>'tickets_cancelled')::integer <> 3 THEN
        RAISE EXCEPTION 'FAIL 6 % tickets still open; % reported cancelled', v_n, v_out->>'tickets_cancelled';
    END IF;
    IF EXISTS (SELECT 1 FROM projects.project_stages WHERE project_id = v_project
                AND status IN ('open', 'assigned', 'in_progress', 'submitted', 'revisions')) THEN
        RAISE EXCEPTION 'FAIL 6 a stage is still open on a cancelled service';
    END IF;
    RAISE NOTICE 'PASS 6 every ticket and stage closed cancelled';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    IF NOT projects.has_project_access(v_project) THEN
        RAISE EXCEPTION 'FAIL 6 the team member lost the cancelled engagement''s history';
    END IF;
    RAISE NOTICE 'PASS 6 the seats are kept: the team still reads the engagement';
    -- #endregion

    -- #region 7. An ended service takes no new money and cancels once
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.cancel_service(v_project, jsonb_build_object(v_s1::text, 50));
        RAISE EXCEPTION 'FAIL 7 a cancelled service was cancelled again';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        RAISE NOTICE 'PASS 7 a second cancellation is refused';
    END;

    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO projects.tickets (project_id, owner_user_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_project, v_buyer, v_s1, 'todo', 'Probe 456 late', '{"t":"x"}', 'A description.',
            jsonb_build_array(jsonb_build_object('stage_id', v_s1, 'order', 0)))
    RETURNING id INTO v_t4;
    BEGIN
        PERFORM finance.fn_hold_ticket_escrow(v_t4);
        RAISE EXCEPTION 'FAIL 7 escrow was held on a cancelled service';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        RAISE NOTICE 'PASS 7 a cancelled service takes no new escrow (%)', SQLERRM;
    END;
    -- #endregion
END $$;

ROLLBACK;
