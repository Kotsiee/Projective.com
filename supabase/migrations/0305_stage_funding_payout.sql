-- US-005 · Stage Escrow Funding  +  US-007 · Approval, Smart Payouts & Fair Exit
--
-- Wires the *internal* escrow loop (pre-loaded wallet balances only — no Stripe) on top of the
-- finance engine in 0009_finance_tables.sql. The engine is ticket-centric (escrow is held per
-- ticket by finance.fn_hold_ticket_escrow); these projects.* wrappers add the client-facing,
-- STAGE-level actions the product spec calls for:
--
--   * projects.fund_stage            — client secures escrow for an assigned stage's tickets and
--                                      moves the stage assigned -> in_progress ("active").
--   * projects.approve_stage         — client releases the stage's held escrow (5% fee + team
--                                      smart-splits applied by the engine).
--   * projects.cancel_stage_fair_exit— fair-exit cancellation: freelancer keeps 25/50/75% of the
--                                      principal, the remainder is refunded to the client wallet.
--   * projects.get_stage_finance     — read model powering the stage Finance tab (escrow, splits).
--   * comms.fn_notify                — the notifications *writer* the pipeline lacked; rows already
--                                      stream to clients via the realtime publication (0206).
--
-- All projects.* wrappers are SECURITY DEFINER and guarded by projects.has_project_access (0105);
-- they invoke the unexposed finance.* engine internally (finance stays off the PostgREST list).

-- #region Platform fee: activate the canonical 5% service fee.
-- 0004 seeded platform_fee_bp = 0 pending a doc conflict (finance-model.md 5% vs
-- investor-summary.md 10%). The US-005 AC6 / US-007 AC2 acceptance criteria and the Wallet Hub
-- ledger both treat 5% as canonical, so resolve it here.
UPDATE security.platform_params
SET value = '500'::jsonb,
    description = 'Platform service fee in basis points. Canonical 5% (finance-model.md, US-005 AC6 / US-007 AC2).',
    updated_at = now()
WHERE key = 'platform_fee_bp';
-- #endregion

-- #region Stage lifecycle: allow a fair-exit cancellation terminal state.
ALTER TYPE stage_status ADD VALUE IF NOT EXISTS 'cancelled';
-- #endregion

-- #region Notifications writer (shared pipeline dependency).
CREATE OR REPLACE FUNCTION comms.fn_notify(
    p_user_id uuid,
    p_type text,
    p_title text,
    p_body text,
    p_entity_table text DEFAULT NULL,
    p_entity_id uuid DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN NULL;
    END IF;
    INSERT INTO comms.notifications (user_id, type, title, body, entity_table, entity_id)
    VALUES (p_user_id, p_type, p_title, p_body, p_entity_table, p_entity_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, comms;
-- #endregion

-- #region US-005 — Fund an assigned stage's escrow.
CREATE OR REPLACE FUNCTION projects.fund_stage(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_status stage_status;
    v_currency text;
    v_stage_name text;
    t record;
    a record;
    v_escrow uuid;
    v_funded int := 0;
    v_total bigint := 0;
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.status, ps.name, p.currency
    INTO v_status, v_stage_name, v_currency
    FROM projects.project_stages ps
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.';
    END IF;

    -- AC1: only an assigned stage may be funded.
    IF v_status <> 'assigned'::stage_status THEN
        RAISE EXCEPTION 'Stage must be in the assigned state to fund escrow (current: %).', v_status;
    END IF;

    -- Hold escrow for each assigned, not-yet-funded ticket in the stage. fn_hold_ticket_escrow
    -- reuses fn_check_spending_limit (AC2), isolates the escrow to project_stage_id (AC3) and
    -- writes the wallet-debit ledger entry (AC6).
    FOR t IN
        SELECT id FROM projects.tickets
        WHERE current_stage_id = p_stage_id
          AND current_assignee_id IS NOT NULL
          AND payment_status = 'unpaid'::payment_status
    LOOP
        v_escrow := finance.fn_hold_ticket_escrow(t.id);
        IF v_escrow IS NOT NULL THEN
            v_funded := v_funded + 1;
        END IF;
    END LOOP;

    IF v_funded = 0 THEN
        RAISE EXCEPTION 'No assigned, unfunded tickets available to fund in this stage.';
    END IF;

    SELECT COALESCE(SUM(amount_cents), 0) INTO v_total
    FROM finance.escrows
    WHERE project_stage_id = p_stage_id AND status = 'held';

    -- AC4: assigned -> active (in_progress).
    UPDATE projects.project_stages
    SET status = 'in_progress'::stage_status
    WHERE id = p_stage_id;

    -- AC5: notify each assignee the stage is funded (streamed via realtime).
    FOR a IN
        SELECT DISTINCT current_assignee_id AS uid
        FROM projects.tickets
        WHERE current_stage_id = p_stage_id AND current_assignee_id IS NOT NULL
    LOOP
        PERFORM comms.fn_notify(
            a.uid, 'stage_funded', 'Stage funded',
            format('Escrow for "%s" is secured — work can begin.', v_stage_name),
            'project_stages', p_stage_id
        );
    END LOOP;

    RETURN jsonb_build_object(
        'funded_count', v_funded,
        'total_held_cents', v_total,
        'currency', COALESCE(v_currency, 'USD'),
        'stage_status', 'in_progress'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, comms, org, auth;
-- #endregion

-- #region US-007 AC1/AC2/AC3 — Final approval: release the stage's escrow.
CREATE OR REPLACE FUNCTION projects.approve_stage(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_currency text;
    v_stage_name text;
    t record;
    a record;
    v_released int := 0;
    v_paid bigint := 0;
    v_fee bigint := 0;
    v_splits jsonb;
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.name, p.currency INTO v_stage_name, v_currency
    FROM projects.project_stages ps
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;

    IF v_stage_name IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.';
    END IF;

    -- Release every held escrow for this stage's tickets. fn_release_ticket_escrow applies the
    -- 5% platform fee (AC2) and routes team payees through fn_split_team_payout (AC3).
    FOR t IN
        SELECT DISTINCT ticket_id
        FROM finance.escrows
        WHERE project_stage_id = p_stage_id AND status = 'held' AND ticket_id IS NOT NULL
    LOOP
        PERFORM finance.fn_release_ticket_escrow(t.ticket_id);
        v_released := v_released + 1;
    END LOOP;

    IF v_released = 0 THEN
        RAISE EXCEPTION 'No funded (held) escrow to release for this stage.';
    END IF;

    SELECT COALESCE(SUM(amount_cents + deadline_bonus_cents - platform_fee_cents), 0),
           COALESCE(SUM(platform_fee_cents), 0)
    INTO v_paid, v_fee
    FROM finance.escrows
    WHERE project_stage_id = p_stage_id AND status = 'released';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'member_user_id', psp.member_user_id,
        'amount_cents', psp.amount_cents,
        'currency', psp.currency)), '[]'::jsonb)
    INTO v_splits
    FROM finance.payout_splits psp
    JOIN finance.escrows e ON e.id = psp.escrow_id
    WHERE e.project_stage_id = p_stage_id;

    UPDATE projects.project_stages
    SET status = 'paid'::stage_status, completed_at = now()
    WHERE id = p_stage_id;

    FOR a IN
        SELECT DISTINCT current_assignee_id AS uid
        FROM projects.tickets
        WHERE current_stage_id = p_stage_id AND current_assignee_id IS NOT NULL
    LOOP
        PERFORM comms.fn_notify(
            a.uid, 'stage_approved', 'Stage approved & paid',
            format('"%s" was approved — your payout has been released.', v_stage_name),
            'project_stages', p_stage_id
        );
    END LOOP;

    RETURN jsonb_build_object(
        'released_count', v_released,
        'total_paid_cents', v_paid,
        'fee_cents', v_fee,
        'splits', v_splits,
        'stage_status', 'paid'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, comms, security, org;
-- #endregion

-- #region US-007 AC4 — Fair-exit cancellation split (net-new).
-- Pays the payee p_bp basis-points of each held escrow's principal (net of the platform fee) and
-- refunds the unearned remainder to the client (payer) business wallet.
CREATE OR REPLACE FUNCTION finance.fn_fair_exit_release(p_ticket_id uuid, p_bp integer)
RETURNS void AS $$
DECLARE
    r record;
    v_fee_bp integer;
    v_share bigint;
    v_fee bigint;
    v_payout bigint;
    v_refund bigint;
BEGIN
    SELECT (value #>> '{}')::integer INTO v_fee_bp FROM security.platform_params WHERE key = 'platform_fee_bp';
    v_fee_bp := COALESCE(v_fee_bp, 0);

    FOR r IN SELECT * FROM finance.escrows WHERE ticket_id = p_ticket_id AND status = 'held' LOOP
        v_share := (r.amount_cents * p_bp) / 10000;          -- earned portion by progress tier
        v_fee := (v_share * v_fee_bp) / 10000;               -- platform fee on the earned portion
        v_payout := v_share - v_fee;
        IF v_payout < 0 THEN v_payout := 0; END IF;
        v_refund := r.amount_cents - v_share;                -- unearned remainder -> client
        IF v_refund < 0 THEN v_refund := 0; END IF;

        UPDATE finance.escrows SET status = 'released', platform_fee_cents = v_fee WHERE id = r.id;

        IF r.payee_type = 'team'::assignment_type THEN
            PERFORM finance.fn_split_team_payout(r.id, r.payee_id, v_payout, r.currency);
        ELSE
            PERFORM finance.fn_wallet_credit(r.payee_id, 'freelancer', r.currency, v_payout, 'fair_exit_release', 'escrows', r.id);
        END IF;

        PERFORM finance.fn_wallet_credit(r.payer_business_id, 'business', r.currency, v_refund, 'fair_exit_refund', 'escrows', r.id);

        UPDATE projects.tickets
        SET total_amount_paid = total_amount_paid + v_payout,
            payment_status = 'partially_released'::payment_status
        WHERE id = p_ticket_id;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, security, org;

CREATE OR REPLACE FUNCTION projects.cancel_stage_fair_exit(p_project_id uuid, p_stage_id uuid, p_tier integer)
RETURNS jsonb AS $$
DECLARE
    v_stage_name text;
    v_bp integer;
    t record;
    a record;
    v_cnt int := 0;
    v_paid bigint := 0;
    v_refunded bigint := 0;
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;

    IF p_tier NOT IN (25, 50, 75) THEN
        RAISE EXCEPTION 'Fair-exit tier must be 25, 50, or 75 (got %).', p_tier;
    END IF;
    v_bp := p_tier * 100;   -- percent -> basis points

    SELECT name INTO v_stage_name
    FROM projects.project_stages
    WHERE id = p_stage_id AND project_id = p_project_id;

    IF v_stage_name IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.';
    END IF;

    FOR t IN
        SELECT DISTINCT ticket_id
        FROM finance.escrows
        WHERE project_stage_id = p_stage_id AND status = 'held' AND ticket_id IS NOT NULL
    LOOP
        PERFORM finance.fn_fair_exit_release(t.ticket_id, v_bp);
        v_cnt := v_cnt + 1;
    END LOOP;

    IF v_cnt = 0 THEN
        RAISE EXCEPTION 'No funded (held) escrow to cancel for this stage.';
    END IF;

    -- Settlement totals, read back from the ledger for this stage's escrows.
    SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE reason IN ('fair_exit_release', 'team_split')), 0),
        COALESCE(SUM(amount_cents) FILTER (WHERE reason = 'fair_exit_refund'), 0)
    INTO v_paid, v_refunded
    FROM finance.transactions
    WHERE ref_table = 'escrows'
      AND ref_id IN (SELECT id FROM finance.escrows WHERE project_stage_id = p_stage_id);

    UPDATE projects.project_stages
    SET status = 'cancelled'::stage_status
    WHERE id = p_stage_id;

    FOR a IN
        SELECT DISTINCT current_assignee_id AS uid
        FROM projects.tickets
        WHERE current_stage_id = p_stage_id AND current_assignee_id IS NOT NULL
    LOOP
        PERFORM comms.fn_notify(
            a.uid, 'stage_cancelled', 'Stage cancelled (fair exit)',
            format('"%s" was cancelled — you were paid %s%% for work delivered.', v_stage_name, p_tier),
            'project_stages', p_stage_id
        );
    END LOOP;

    RETURN jsonb_build_object(
        'tier', p_tier,
        'cancelled_count', v_cnt,
        'freelancer_paid_cents', v_paid,
        'client_refunded_cents', v_refunded,
        'stage_status', 'cancelled'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, comms, org;
-- #endregion

-- #region Stage finance read model (powers the Finance tab).
CREATE OR REPLACE FUNCTION projects.get_stage_finance(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_status stage_status;
    v_currency text;
    v_assignment jsonb;
    v_escrowed bigint;
    v_released bigint;
    v_fee bigint;
    v_tickets jsonb;
    v_splits jsonb;
    v_fundable_tickets int;
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.status, p.currency INTO v_status, v_currency
    FROM projects.project_stages ps
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.';
    END IF;

    SELECT jsonb_build_object(
        'type', sa.assignee_type,
        'name', COALESCE(tm.name, NULLIF(TRIM(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''))
    )
    INTO v_assignment
    FROM projects.stage_assignments sa
    LEFT JOIN org.teams tm ON tm.id = sa.team_id
    LEFT JOIN org.users_public up ON up.user_id = sa.freelancer_profile_id
    WHERE sa.project_stage_id = p_stage_id AND sa.status = 'accepted'
    ORDER BY sa.created_at DESC
    LIMIT 1;

    SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'held'), 0),
        COALESCE(SUM(amount_cents + deadline_bonus_cents - platform_fee_cents) FILTER (WHERE status = 'released'), 0),
        COALESCE(SUM(platform_fee_cents) FILTER (WHERE status = 'released'), 0)
    INTO v_escrowed, v_released, v_fee
    FROM finance.escrows
    WHERE project_stage_id = p_stage_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticket_id', tk.id,
        'title', tk.title,
        'amount_cents', COALESCE(tk.unit_price_cents, ps2.unit_price_cents),
        'payment_status', tk.payment_status,
        'assignee_id', tk.current_assignee_id
    ) ORDER BY tk.sort_order NULLS LAST, tk.created_at), '[]'::jsonb)
    INTO v_tickets
    FROM projects.tickets tk
    LEFT JOIN projects.project_stages ps2 ON ps2.id = tk.current_stage_id
    WHERE tk.current_stage_id = p_stage_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'member_user_id', psp.member_user_id,
        'amount_cents', psp.amount_cents,
        'name', NULLIF(TRIM(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), '')
    )), '[]'::jsonb)
    INTO v_splits
    FROM finance.payout_splits psp
    JOIN finance.escrows e ON e.id = psp.escrow_id
    LEFT JOIN org.users_public up ON up.user_id = psp.member_user_id
    WHERE e.project_stage_id = p_stage_id;

    SELECT count(*) INTO v_fundable_tickets
    FROM projects.tickets
    WHERE current_stage_id = p_stage_id
      AND current_assignee_id IS NOT NULL
      AND payment_status = 'unpaid'::payment_status;

    RETURN jsonb_build_object(
        'stage_id', p_stage_id,
        'stage_status', v_status,
        'currency', COALESCE(v_currency, 'USD'),
        'assignment', v_assignment,
        'total_escrowed_cents', v_escrowed,
        'total_released_cents', v_released,
        'platform_fee_cents', v_fee,
        'tickets', v_tickets,
        'splits', v_splits,
        'fundable', (v_status = 'assigned'::stage_status AND v_fundable_tickets > 0)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org;
-- #endregion
