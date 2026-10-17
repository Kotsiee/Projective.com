-- =============================================================================================
-- Probe: one business spend gate on every door (BUSINESSES_AUDIT BF19, BF21, BF22) —
-- finance.fn_assert_business_spend: KYB, the ACTOR's envelope counted once, the approval threshold
-- with the platform fallback — on fund_stage, fund_ticket, fund_paid_revision, the card escrow lock,
-- the basket and the automatic (claim-lock) hold; team and personal paths unchanged.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_spend_gate.sql
--
-- Before the gate: an escrow hold counted the PROJECT OWNER's envelope whoever funded it, so a funder
-- other than the owner spent nothing of their own and a basket ticket line counted twice (the buyer at
-- the basket, the owner at the hold); the basket ignored the platform threshold when the wallet had
-- none; and fund_stage / fund_ticket / fund_paid_revision / the card escrow lock / the claim-lock hold
-- applied neither KYB nor any threshold. Every case runs and reports; a clean run prints only PASS.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP SEQUENCE probe_sort;
CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

CREATE FUNCTION pg_temp.spent(p_wallet uuid, p_uid uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE((SELECT sl.spent_cents FROM finance.spending_limits sl
                      WHERE sl.wallet_id = p_wallet AND sl.member_user_id = p_uid), -1);
$$;

-- A stage on the project with n tickets at p_price each, all with a description (purchasable).
CREATE FUNCTION pg_temp.stage(p_project uuid, p_name text, p_price bigint, p_n int) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_stage uuid;
BEGIN
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (p_project, p_name, 900 + nextval('pg_temp.probe_sort')::int, 'open', p_price) RETURNING id INTO v_stage;
    FOR i IN 1..p_n LOOP
        INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description)
        VALUES (p_project, v_stage, p_name || ' T' || i, '{"t":"x"}', 'A description.');
    END LOOP;
    RETURN v_stage;
END $$;

CREATE FUNCTION pg_temp.ticket(p_stage uuid, p_n int DEFAULT 1) RETURNS uuid LANGUAGE sql AS $$
    SELECT t.id FROM projects.tickets t WHERE t.current_stage_id = p_stage ORDER BY t.title OFFSET p_n - 1 LIMIT 1;
$$;
-- #endregion

DO $$
DECLARE
    v_project uuid;
    v_biz uuid;
    v_owner uuid;      -- the business's owner: the FUNDER in these cases
    v_pm uuid;         -- the project's owner_user_id: a business admin who created it
    v_fl uuid;
    v_currency text;
    v_wallet uuid;
    v_basket uuid;
    v_line uuid;
    v_stage uuid;
    v_ticket uuid;
    v_sub uuid;
    v_rev uuid;
    v_personal uuid;
    v_pstage uuid;
    v_powner uuid;
    v_team_wallet uuid;
    v_team_member uuid;
    v_to uuid;
    v_o0 bigint;
    v_p0 bigint;
    v_code text;
    v_msg text;
    v_detail text;
    v_fail text[] := '{}';
    v_case text;
BEGIN
    -- #region Fixture (as postgres)
    SELECT p.id, p.client_business_id, bp.owner_user_id, p.owner_user_id, upper(COALESCE(p.currency, 'USD'))
      INTO v_project, v_biz, v_owner, v_pm, v_currency
      FROM projects.projects p
      JOIN org.business_profiles bp ON bp.id = p.client_business_id
     WHERE p.owner_user_id <> bp.owner_user_id
       AND p.format = 'pipeline' AND p.structure_variation = 'standard'
       AND p.status NOT IN ('completed', 'cancelled', 'archived')
     ORDER BY p.id LIMIT 1;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: no business pipeline project owned by a member other than the business owner — run deno task db:reset';
    END IF;
    SELECT fp.user_id INTO v_fl FROM org.freelancer_profiles fp
     WHERE fp.user_id NOT IN (v_owner, v_pm) AND finance.fn_freelancer_payout_ready(fp.user_id)
     ORDER BY fp.user_id LIMIT 1;
    IF v_fl IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no payout-ready freelancer'; END IF;

    -- The business owner reaches the project as its client business (has_project_access).
    INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
    SELECT v_project, 'business', v_biz, 'client'
     WHERE NOT EXISTS (SELECT 1 FROM projects.project_participants pp
                        WHERE pp.project_id = v_project AND pp.profile_type = 'business' AND pp.profile_id = v_biz);

    UPDATE org.business_profiles SET kyb_status = 'verified' WHERE id = v_biz;
    v_wallet := finance.fn_ensure_wallet('business', v_biz, v_currency);
    PERFORM finance.fn_wallet_credit(v_biz, 'business', v_currency, 2000000, 'topup', 'inbound_payments', gen_random_uuid());
    UPDATE finance.wallets SET approval_threshold_cents = NULL WHERE id = v_wallet;
    UPDATE security.platform_params SET value = '0'::jsonb WHERE key = 'vault_approval_threshold_cents';
    -- Both envelopes uncapped and empty, counted over the whole life of the row.
    DELETE FROM finance.spending_limits WHERE wallet_id = v_wallet AND member_user_id IN (v_owner, v_pm);
    INSERT INTO finance.spending_limits (wallet_id, member_user_id, cap_cents, per_transaction_cents, period_interval, spent_cents)
    VALUES (v_wallet, v_owner, NULL, NULL, 'total', 0), (v_wallet, v_pm, NULL, NULL, 'total', 0);
    RAISE NOTICE 'fixture project=% business=% funder(owner)=% project owner=% wallet=% %',
        v_project, v_biz, v_owner, v_pm, v_wallet, v_currency;
    -- #endregion

    PERFORM pg_temp.act(v_owner);

    -- #region 1. fund_stage counts the FUNDER's envelope, not the project owner's (BF21)
    v_case := '1 fund_stage counts the funder';
    v_stage := pg_temp.stage(v_project, 'Probe S1', 10000, 2);
    v_o0 := pg_temp.spent(v_wallet, v_owner); v_p0 := pg_temp.spent(v_wallet, v_pm);
    BEGIN
        PERFORM projects.fund_stage(v_project, v_stage);
        IF pg_temp.spent(v_wallet, v_owner) - v_o0 = 20000 AND pg_temp.spent(v_wallet, v_pm) = v_p0 THEN
            RAISE NOTICE 'PASS %: funder +20000, project owner unchanged', v_case;
        ELSE
            v_fail := v_fail || format('%s: funder +%s, project owner +%s (expected +20000 / +0)', v_case,
                pg_temp.spent(v_wallet, v_owner) - v_o0, pg_temp.spent(v_wallet, v_pm) - v_p0);
        END IF;
    EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
    END;
    -- #endregion

    -- #region 2. A basket ticket line counts once, against the buyer (BF22)
    v_case := '2 basket ticket line counts once';
    v_stage := pg_temp.stage(v_project, 'Probe S2', 15000, 1);
    v_ticket := pg_temp.ticket(v_stage);
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('business', v_biz, 'Probe basket 2') RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, ticket_id, title, unit_price_minor, currency)
    VALUES (v_basket, 'project_ticket', v_project, v_stage, v_ticket, 'Probe line', 15000, v_currency) RETURNING id INTO v_line;
    v_o0 := pg_temp.spent(v_wallet, v_owner); v_p0 := pg_temp.spent(v_wallet, v_pm);
    BEGIN
        PERFORM finance.place_wallet_order(v_basket, ARRAY[v_line], v_currency, jsonb_build_object(v_line::text, 15000), NULL, 'probe-gate-order-2');
        IF pg_temp.spent(v_wallet, v_owner) - v_o0 = 15000 AND pg_temp.spent(v_wallet, v_pm) = v_p0
           -- and the order leaves no cover behind for a later door in this transaction to ride on
           AND COALESCE(NULLIF(current_setting('finance.spend_cover', true), '')::jsonb -> 'budget' ->> v_wallet::text, '0') = '0'
           AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(NULLIF(current_setting('finance.spend_cover', true), '')::jsonb -> 'refs', '{}')) k
                            WHERE k LIKE v_wallet::text || '|%') THEN
            RAISE NOTICE 'PASS %: buyer +15000 once, project owner unchanged, no cover left open', v_case;
        ELSE
            v_fail := v_fail || format('%s: buyer +%s, project owner +%s (expected +15000 / +0)', v_case,
                pg_temp.spent(v_wallet, v_owner) - v_o0, pg_temp.spent(v_wallet, v_pm) - v_p0);
        END IF;
    EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
    END;
    -- #endregion

    -- #region 3. fund_ticket counts the funder once (BF21, BF22)
    v_case := '3 fund_ticket counts the funder once';
    v_stage := pg_temp.stage(v_project, 'Probe S3', 12000, 1);
    v_o0 := pg_temp.spent(v_wallet, v_owner); v_p0 := pg_temp.spent(v_wallet, v_pm);
    BEGIN
        PERFORM projects.fund_ticket(v_project, pg_temp.ticket(v_stage));
        IF pg_temp.spent(v_wallet, v_owner) - v_o0 = 12000 AND pg_temp.spent(v_wallet, v_pm) = v_p0 THEN
            RAISE NOTICE 'PASS %: funder +12000, project owner unchanged', v_case;
        ELSE
            v_fail := v_fail || format('%s: funder +%s, project owner +%s (expected +12000 / +0)', v_case,
                pg_temp.spent(v_wallet, v_owner) - v_o0, pg_temp.spent(v_wallet, v_pm) - v_p0);
        END IF;
    EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
    END;
    -- #endregion

    -- #region 4. An automatic claim-lock hold has no human funder: the project owner spends (unchanged)
    v_case := '4 claim-lock hold counts the project owner';
    v_stage := pg_temp.stage(v_project, 'Probe S4', 8000, 1);
    v_ticket := pg_temp.ticket(v_stage);
    v_o0 := pg_temp.spent(v_wallet, v_owner); v_p0 := pg_temp.spent(v_wallet, v_pm);
    PERFORM pg_temp.act(v_fl);
    BEGIN
        UPDATE projects.tickets SET current_assignee_id = v_fl, status = 'claimed' WHERE id = v_ticket;
        IF pg_temp.spent(v_wallet, v_pm) - v_p0 = 8000 AND pg_temp.spent(v_wallet, v_owner) = v_o0
           AND EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = v_ticket AND e.status = 'held') THEN
            RAISE NOTICE 'PASS %: held, project owner +8000, business owner unchanged', v_case;
        ELSE
            v_fail := v_fail || format('%s: project owner +%s, business owner +%s (expected +8000 / +0)', v_case,
                pg_temp.spent(v_wallet, v_pm) - v_p0, pg_temp.spent(v_wallet, v_owner) - v_o0);
        END IF;
    EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
    END;
    PERFORM pg_temp.act(v_owner);
    -- #endregion

    -- #region 5. Platform threshold, wallet threshold NULL → needs_approval at the basket and fund_stage (BF19)
    UPDATE security.platform_params SET value = '30000'::jsonb WHERE key = 'vault_approval_threshold_cents';
    v_case := '5a basket at the platform threshold';
    v_stage := pg_temp.stage(v_project, 'Probe S5a', 30000, 1);
    v_ticket := pg_temp.ticket(v_stage);
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('business', v_biz, 'Probe basket 5') RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, ticket_id, title, unit_price_minor, currency)
    VALUES (v_basket, 'project_ticket', v_project, v_stage, v_ticket, 'Probe line', 30000, v_currency) RETURNING id INTO v_line;
    BEGIN
        PERFORM finance.place_wallet_order(v_basket, ARRAY[v_line], v_currency, jsonb_build_object(v_line::text, 30000), NULL, 'probe-gate-order-5');
        v_fail := v_fail || format('%s: passed (expected PA403 needs_approval)', v_case);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        IF v_code = 'PA403' AND v_msg LIKE 'needs_approval:%' THEN RAISE NOTICE 'PASS %: PA403 needs_approval', v_case;
        ELSE v_fail := v_fail || format('%s: %s %s (expected PA403 needs_approval)', v_case, v_code, v_msg); END IF;
    END;

    v_case := '5b fund_stage at the platform threshold';
    v_stage := pg_temp.stage(v_project, 'Probe S5b', 20000, 2);
    BEGIN
        PERFORM projects.fund_stage(v_project, v_stage);
        v_fail := v_fail || format('%s: passed (expected PA403 needs_approval)', v_case);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        IF v_code = 'PA403' AND v_msg LIKE 'needs_approval:%' THEN RAISE NOTICE 'PASS %: PA403 needs_approval (40000 >= 30000)', v_case;
        ELSE v_fail := v_fail || format('%s: %s %s (expected PA403 needs_approval)', v_case, v_code, v_msg); END IF;
    END;

    v_case := '5c fund_stage under the platform threshold';
    v_stage := pg_temp.stage(v_project, 'Probe S5c', 10000, 2);
    BEGIN
        PERFORM projects.fund_stage(v_project, v_stage);
        RAISE NOTICE 'PASS %: 20000 < 30000 funds', v_case;
    EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
    END;

    v_case := '5d claim-lock hold at the threshold becomes Needs funding';
    v_stage := pg_temp.stage(v_project, 'Probe S5d', 30000, 1);
    v_ticket := pg_temp.ticket(v_stage);
    PERFORM pg_temp.act(v_fl);
    BEGIN
        UPDATE projects.tickets SET current_assignee_id = v_fl, status = 'claimed' WHERE id = v_ticket;
        v_fail := v_fail || format('%s: held (expected PF402 needs_approval)', v_case);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
        IF v_code = 'PF402' AND NULLIF(v_detail, '')::jsonb ->> 'reason' = 'needs_approval' THEN
            RAISE NOTICE 'PASS %: PF402 reason needs_approval', v_case;
        ELSE v_fail := v_fail || format('%s: %s %s (expected PF402 needs_approval)', v_case, v_code, v_detail); END IF;
    END;
    PERFORM pg_temp.act(v_owner);
    UPDATE security.platform_params SET value = '0'::jsonb WHERE key = 'vault_approval_threshold_cents';
    -- #endregion

    -- #region 6. Over the funder's per-transaction ceiling → over_limit (the actor's envelope bites)
    v_case := '6 fund_ticket over the funder''s ceiling';
    UPDATE finance.spending_limits SET per_transaction_cents = 5000 WHERE wallet_id = v_wallet AND member_user_id = v_owner;
    v_stage := pg_temp.stage(v_project, 'Probe S6', 9000, 1);
    BEGIN
        PERFORM projects.fund_ticket(v_project, pg_temp.ticket(v_stage));
        v_fail := v_fail || format('%s: passed (expected PA403 over_limit)', v_case);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        IF v_code = 'PA403' AND v_msg LIKE 'over_limit:%' THEN RAISE NOTICE 'PASS %: PA403 over_limit', v_case;
        ELSE v_fail := v_fail || format('%s: %s %s (expected PA403 over_limit)', v_case, v_code, v_msg); END IF;
    END;
    UPDATE finance.spending_limits SET per_transaction_cents = NULL WHERE wallet_id = v_wallet AND member_user_id = v_owner;
    -- #endregion

    -- #region 7. An unverified business moves no money through any funding door (BF21)
    -- The paid revision is raised while verified, so only the gate stands between it and the hold.
    v_stage := pg_temp.stage(v_project, 'Probe S7 revision', 10000, 0);
    UPDATE projects.project_stages SET file_revisions_allowed = 0, extra_revision_price_cents = 5000 WHERE id = v_stage;
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, status, title, description, text_description)
    VALUES (v_project, v_stage, v_fl, 'in_review', 'Probe S7 R', '{"t":"x"}', 'A description.') RETURNING id INTO v_ticket;
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status, number)
    VALUES (v_stage, v_ticket, v_fl, 'Probe v1', 'pending_review', 9301) RETURNING id INTO v_sub;
    INSERT INTO projects.stage_revision_requests (project_stage_id, ticket_id, requested_by, request_type, reason, status, submission_id, price_cents)
    VALUES (v_stage, v_ticket, v_owner, 'paid_revision', 'Swap the palette', 'awaiting_payment', v_sub, 5000) RETURNING id INTO v_rev;

    UPDATE org.business_profiles SET kyb_status = 'pending' WHERE id = v_biz;

    v_case := '7a fund_stage unverified';
    v_stage := pg_temp.stage(v_project, 'Probe S7a', 10000, 1);
    BEGIN
        PERFORM projects.fund_stage(v_project, v_stage);
        v_fail := v_fail || format('%s: passed (expected PK403 kyb_required)', v_case);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        IF v_code = 'PK403' AND v_msg LIKE 'kyb_required:%' THEN RAISE NOTICE 'PASS %: PK403 kyb_required', v_case;
        ELSE v_fail := v_fail || format('%s: %s %s (expected PK403 kyb_required)', v_case, v_code, v_msg); END IF;
    END;

    v_case := '7b fund_ticket unverified';
    BEGIN
        PERFORM projects.fund_ticket(v_project, pg_temp.ticket(v_stage));
        v_fail := v_fail || format('%s: passed (expected PK403 kyb_required)', v_case);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        IF v_code = 'PK403' AND v_msg LIKE 'kyb_required:%' THEN RAISE NOTICE 'PASS %: PK403 kyb_required', v_case;
        ELSE v_fail := v_fail || format('%s: %s %s (expected PK403 kyb_required)', v_case, v_code, v_msg); END IF;
    END;

    v_case := '7c fund_paid_revision unverified';
    BEGIN
        PERFORM projects.fund_paid_revision(v_rev);
        v_fail := v_fail || format('%s: passed (expected PK403 kyb_required)', v_case);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        IF v_code = 'PK403' AND v_msg LIKE 'kyb_required:%' THEN RAISE NOTICE 'PASS %: PK403 kyb_required', v_case;
        ELSE v_fail := v_fail || format('%s: %s %s (expected PK403 kyb_required)', v_case, v_code, v_msg); END IF;
    END;

    v_case := '7d card escrow lock unverified';
    BEGIN
        PERFORM finance.begin_card_payment('escrow_lock', NULL, v_project, v_stage, 10000, v_currency, 'probe-gate-card-7d');
        v_fail := v_fail || format('%s: passed (expected PK403 kyb_required)', v_case);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        IF v_code = 'PK403' AND v_msg LIKE 'kyb_required:%' THEN RAISE NOTICE 'PASS %: PK403 kyb_required', v_case;
        ELSE v_fail := v_fail || format('%s: %s %s (expected PK403 kyb_required)', v_case, v_code, v_msg); END IF;
    END;

    v_case := '7e claim-lock hold unverified';
    v_ticket := pg_temp.ticket(v_stage);
    PERFORM pg_temp.act(v_fl);
    BEGIN
        UPDATE projects.tickets SET current_assignee_id = v_fl, status = 'claimed' WHERE id = v_ticket;
        v_fail := v_fail || format('%s: held (expected PF402 kyb_required)', v_case);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
        IF v_code = 'PF402' AND NULLIF(v_detail, '')::jsonb ->> 'reason' = 'kyb_required' THEN
            RAISE NOTICE 'PASS %: PF402 reason kyb_required', v_case;
        ELSE v_fail := v_fail || format('%s: %s %s (expected PF402 kyb_required)', v_case, v_code, v_detail); END IF;
    END;
    PERFORM pg_temp.act(v_owner);
    UPDATE org.business_profiles SET kyb_status = 'verified' WHERE id = v_biz;
    -- #endregion

    -- #region 8. Regression: an individual client's funding ignores the vault rules
    UPDATE security.platform_params SET value = '1'::jsonb WHERE key = 'vault_approval_threshold_cents';
    v_case := '8 personal fund_ticket under a platform threshold';
    SELECT p.id, p.owner_user_id INTO v_personal, v_powner
      FROM projects.projects p
     WHERE p.client_business_id IS NULL AND p.format = 'pipeline' AND p.structure_variation = 'standard'
       AND p.status NOT IN ('completed', 'cancelled', 'archived') AND upper(COALESCE(p.currency, 'USD')) = v_currency
     ORDER BY p.id LIMIT 1;
    IF v_personal IS NULL THEN
        v_fail := v_fail || (v_case || ': no fixture');
    ELSE
        PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_powner), v_powner, v_currency);
        PERFORM finance.fn_wallet_credit(v_powner, finance.fn_person_wallet_type(v_powner), v_currency, 100000, 'topup', 'inbound_payments', gen_random_uuid());
        v_pstage := pg_temp.stage(v_personal, 'Probe S8', 10000, 1);
        PERFORM pg_temp.act(v_powner);
        BEGIN
            PERFORM projects.fund_ticket(v_personal, pg_temp.ticket(v_pstage));
            RAISE NOTICE 'PASS %: funded', v_case;
        EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
        END;
    END IF;
    -- #endregion

    -- #region 9. Regression: a team vault transfer keeps its own envelope and ignores the platform threshold
    v_case := '9 team transfer under a platform threshold';
    SELECT vp.wallet_id, vp.member_user_id INTO v_team_wallet, v_team_member
      FROM finance.vault_permissions vp
      JOIN finance.wallets w ON w.id = vp.wallet_id
     WHERE w.owner_type = 'team' AND 'withdraw'::finance.vault_capability = ANY (vp.capabilities)
       AND w.currency = v_currency
     ORDER BY vp.wallet_id, vp.member_user_id LIMIT 1;
    IF v_team_wallet IS NULL THEN
        v_fail := v_fail || (v_case || ': no fixture');
    ELSE
        UPDATE finance.wallets SET approval_threshold_cents = NULL WHERE id = v_team_wallet;
        PERFORM finance.fn_wallet_credit(w.owner_id, 'team', w.currency, 50000, 'topup', 'inbound_payments', gen_random_uuid())
           FROM finance.wallets w WHERE w.id = v_team_wallet;
        v_to := finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_team_member), v_team_member, v_currency);
        DELETE FROM finance.spending_limits WHERE wallet_id = v_team_wallet AND member_user_id = v_team_member;
        INSERT INTO finance.spending_limits (wallet_id, member_user_id, cap_cents, period_interval, spent_cents)
        VALUES (v_team_wallet, v_team_member, NULL, 'total', 0);
        PERFORM pg_temp.act(v_team_member);
        BEGIN
            PERFORM finance.transfer_funds(v_team_wallet, v_to, 7000, 'probe', 'probe-gate-transfer-9');
            IF pg_temp.spent(v_team_wallet, v_team_member) = 7000 THEN
                RAISE NOTICE 'PASS %: moved, member envelope +7000', v_case;
            ELSE
                v_fail := v_fail || format('%s: member envelope +%s (expected 7000)', v_case, pg_temp.spent(v_team_wallet, v_team_member));
            END IF;
        EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
        END;
    END IF;
    UPDATE security.platform_params SET value = '0'::jsonb WHERE key = 'vault_approval_threshold_cents';
    PERFORM pg_temp.act(NULL);
    -- #endregion

    -- #region 10. A card stage lock: checked at begin (nothing counted), counted once at settlement
    v_case := '10 card stage lock counts the payer once';
    v_stage := pg_temp.stage(v_project, 'Probe S10', 11000, 1);
    v_o0 := pg_temp.spent(v_wallet, v_owner); v_p0 := pg_temp.spent(v_wallet, v_pm);
    PERFORM pg_temp.act(v_owner);
    BEGIN
        v_msg := finance.begin_card_payment('escrow_lock', NULL, v_project, v_stage, 11000, v_currency, 'probe-gate-card-10') ->> 'id';
        IF pg_temp.spent(v_wallet, v_owner) <> v_o0 THEN
            v_fail := v_fail || format('%s: begin counted %s', v_case, pg_temp.spent(v_wallet, v_owner) - v_o0);
        END IF;
        PERFORM finance.attach_card_payment(v_msg::uuid, 'pi_probe_gate_10');
        PERFORM pg_temp.act(NULL);
        v_detail := finance.settle_card_payment('evt_probe_gate_10', 'pi_probe_gate_10', 11000, v_currency, false) ->> 'lock_status';
        IF v_detail = 'locked' AND pg_temp.spent(v_wallet, v_owner) - v_o0 = 11000 AND pg_temp.spent(v_wallet, v_pm) = v_p0 THEN
            RAISE NOTICE 'PASS %: locked, payer +11000 once, project owner unchanged', v_case;
        ELSE
            v_fail := v_fail || format('%s: lock %s, payer +%s, project owner +%s (expected locked, +11000 / +0)', v_case,
                v_detail, pg_temp.spent(v_wallet, v_owner) - v_o0, pg_temp.spent(v_wallet, v_pm) - v_p0);
        END IF;
    EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
    END;
    PERFORM pg_temp.act(NULL);
    -- #endregion

    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION E'FAIL %/% case(s):\n  %', cardinality(v_fail), 17, array_to_string(v_fail, E'\n  ');
    END IF;
    RAISE NOTICE 'PASS all business spend gate cases';
END $$;

ROLLBACK;
