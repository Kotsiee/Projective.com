-- ============================================================================
-- 00001200 functions finance core
-- Consolidated verbatim from: 0009_finance_tables.sql, 0305_stage_funding_payout.sql, 0309_business_finance_overview.sql, 0310_ticket_automation_engine.sql
-- ============================================================================

-- Ledger helpers: credit / debit a wallet if one exists (balance CHECK enforces sufficient funds).
CREATE OR REPLACE FUNCTION finance.fn_wallet_credit(
    p_owner_id uuid, p_owner_type text, p_currency text, p_amount bigint,
    p_reason text, p_ref_table text, p_ref_id uuid
) RETURNS void AS $$
DECLARE
    v_wallet uuid;
    v_balance bigint;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;
    SELECT id INTO v_wallet FROM finance.wallets
    WHERE owner_type = p_owner_type AND owner_id = p_owner_id AND currency = p_currency;
    IF v_wallet IS NULL THEN RETURN; END IF;

    UPDATE finance.wallets SET balance_cents = balance_cents + p_amount
    WHERE id = v_wallet RETURNING balance_cents INTO v_balance;

    INSERT INTO finance.transactions (wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents)
    VALUES (v_wallet, 'credit', p_amount, p_currency, p_reason, p_ref_table, p_ref_id, v_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

CREATE OR REPLACE FUNCTION finance.fn_wallet_debit(
    p_owner_id uuid, p_owner_type text, p_currency text, p_amount bigint,
    p_reason text, p_ref_table text, p_ref_id uuid
) RETURNS void AS $$
DECLARE
    v_wallet uuid;
    v_balance bigint;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;
    SELECT id INTO v_wallet FROM finance.wallets
    WHERE owner_type = p_owner_type AND owner_id = p_owner_id AND currency = p_currency;
    IF v_wallet IS NULL THEN RETURN; END IF;

    UPDATE finance.wallets SET balance_cents = balance_cents - p_amount
    WHERE id = v_wallet RETURNING balance_cents INTO v_balance;

    INSERT INTO finance.transactions (wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents)
    VALUES (v_wallet, 'debit', p_amount, p_currency, p_reason, p_ref_table, p_ref_id, v_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

-- Enforce a member's spending cap on a wallet; increments spent_cents when allowed.
CREATE OR REPLACE FUNCTION finance.fn_check_spending_limit(
    p_wallet_id uuid, p_member uuid, p_amount bigint
) RETURNS boolean AS $$
DECLARE
    v_cap bigint;
    v_spent bigint;
BEGIN
    IF p_member IS NULL THEN RETURN true; END IF;
    SELECT cap_cents, spent_cents INTO v_cap, v_spent
    FROM finance.spending_limits
    WHERE wallet_id = p_wallet_id AND member_user_id = p_member;

    IF v_cap IS NULL THEN RETURN true; END IF;
    IF v_spent + p_amount > v_cap THEN RETURN false; END IF;

    UPDATE finance.spending_limits SET spent_cents = spent_cents + p_amount
    WHERE wallet_id = p_wallet_id AND member_user_id = p_member;
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

-- Distribute a team payout across the contribution agreement (falls back to the team wallet).
CREATE OR REPLACE FUNCTION finance.fn_split_team_payout(
    p_escrow_id uuid, p_team_id uuid, p_payout bigint, p_currency text
) RETURNS void AS $$
DECLARE
    m record;
    v_share bigint;
    v_found boolean := false;
BEGIN
    FOR m IN
        SELECT member_user_id, percent_bp FROM finance.contribution_agreements WHERE team_id = p_team_id
    LOOP
        v_found := true;
        v_share := (p_payout * m.percent_bp) / 10000;
        INSERT INTO finance.payout_splits (escrow_id, member_user_id, amount_cents, currency)
        VALUES (p_escrow_id, m.member_user_id, v_share, p_currency);
        PERFORM finance.fn_wallet_credit(m.member_user_id, 'user', p_currency, v_share, 'team_split', 'escrows', p_escrow_id);
    END LOOP;

    IF NOT v_found THEN
        PERFORM finance.fn_wallet_credit(p_team_id, 'team', p_currency, p_payout, 'escrow_release', 'escrows', p_escrow_id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

-- Ticket claim -> hold funds in escrow. Skips gracefully when prerequisites are absent
-- (e.g. individual/non-business client, or no unit price) rather than blocking the claim.
CREATE OR REPLACE FUNCTION finance.fn_hold_ticket_escrow(p_ticket_id uuid)
RETURNS uuid AS $$
DECLARE
    v record;
    v_amount bigint;
    v_escrow_id uuid;
    v_team_id uuid;
    v_payee_type assignment_type;
    v_payee_id uuid;
BEGIN
    SELECT
        t.current_stage_id AS stage_id,
        t.current_assignee_id AS payee_id,
        COALESCE(t.unit_price_cents, ps.unit_price_cents) AS amount,
        p.client_business_id AS payer,
        p.currency AS currency
    INTO v
    FROM projects.tickets t
    JOIN projects.projects p ON p.id = t.project_id
    LEFT JOIN projects.project_stages ps ON ps.id = t.current_stage_id
    WHERE t.id = p_ticket_id;

    v_amount := v.amount;

    -- Prefer an accepted team assignment on the ticket's current stage so the payout splits
    -- across the team at release (fn_split_team_payout keys off escrow.payee_type = 'team').
    -- Otherwise the payee is the individual freelancer assigned to the ticket.
    SELECT sa.team_id INTO v_team_id
    FROM projects.stage_assignments sa
    WHERE sa.project_stage_id = v.stage_id
        AND sa.assignee_type = 'team'
        AND sa.status = 'accepted'
        AND sa.team_id IS NOT NULL
    LIMIT 1;

    IF v_team_id IS NOT NULL THEN
        v_payee_type := 'team'::assignment_type;
        v_payee_id := v_team_id;
    ELSE
        v_payee_type := 'freelancer'::assignment_type;
        v_payee_id := v.payee_id;
    END IF;

    IF v.payer IS NULL OR v.stage_id IS NULL OR v_payee_id IS NULL
        OR v_amount IS NULL OR v_amount <= 0 THEN
        RETURN NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = p_ticket_id AND status = 'held') THEN
        RETURN NULL;
    END IF;

    IF NOT finance.fn_check_spending_limit(
        (SELECT id FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v.payer AND currency = COALESCE(v.currency, 'USD')),
        auth.uid(), v_amount
    ) THEN
        RAISE EXCEPTION 'Spending cap exceeded for this member on the business wallet.';
    END IF;

    INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_business_id, payee_type, payee_id, amount_cents, currency, status)
    VALUES (v.stage_id, p_ticket_id, v.payer, v_payee_type, v_payee_id, v_amount, COALESCE(v.currency, 'USD'), 'held')
    RETURNING id INTO v_escrow_id;

    PERFORM finance.fn_wallet_debit(v.payer, 'business', COALESCE(v.currency, 'USD'), v_amount, 'escrow_hold', 'escrows', v_escrow_id);

    UPDATE projects.tickets SET payment_status = 'escrow_funded'::payment_status WHERE id = p_ticket_id;
    RETURN v_escrow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, org, auth;

-- Release all held escrow for a ticket to its recorded payee (fee + bonus applied, splits for teams).
CREATE OR REPLACE FUNCTION finance.fn_release_ticket_escrow(p_ticket_id uuid)
RETURNS void AS $$
DECLARE
    r record;
    v_fee_bp integer;
    v_fee bigint;
    v_payout bigint;
    v_ticket_status ticket_status;
BEGIN
    SELECT (value #>> '{}')::integer INTO v_fee_bp FROM security.platform_params WHERE key = 'platform_fee_bp';
    v_fee_bp := COALESCE(v_fee_bp, 0);
    SELECT status INTO v_ticket_status FROM projects.tickets WHERE id = p_ticket_id;

    FOR r IN
        SELECT * FROM finance.escrows WHERE ticket_id = p_ticket_id AND status = 'held'
    LOOP
        v_fee := (r.amount_cents * v_fee_bp) / 10000;
        v_payout := r.amount_cents + COALESCE(r.deadline_bonus_cents, 0) - v_fee;
        IF v_payout < 0 THEN v_payout := 0; END IF;

        UPDATE finance.escrows SET status = 'released', platform_fee_cents = v_fee WHERE id = r.id;

        IF r.payee_type = 'team'::assignment_type THEN
            PERFORM finance.fn_split_team_payout(r.id, r.payee_id, v_payout, r.currency);
        ELSE
            PERFORM finance.fn_wallet_credit(r.payee_id, 'freelancer', r.currency, v_payout, 'escrow_release', 'escrows', r.id);
        END IF;

        UPDATE projects.tickets
        SET total_amount_paid = total_amount_paid + v_payout,
            payment_status = CASE
                WHEN v_ticket_status = 'completed'::ticket_status THEN 'released'::payment_status
                ELSE 'partially_released'::payment_status
            END
        WHERE id = p_ticket_id;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, security, org;

-- Consolidate a period's released escrows/fees/bonuses into one itemized monthly invoice.
CREATE OR REPLACE FUNCTION finance.fn_generate_consolidated_invoice(
    p_business_id uuid, p_start timestamptz, p_end timestamptz
) RETURNS uuid AS $$
DECLARE
    v_invoice uuid;
    v_subtotal bigint;
    v_fee bigint;
    v_currency text;
    r record;
BEGIN
    SELECT
        COALESCE(SUM(amount_cents + deadline_bonus_cents), 0),
        COALESCE(SUM(platform_fee_cents), 0),
        MAX(currency)
    INTO v_subtotal, v_fee, v_currency
    FROM finance.escrows
    WHERE payer_business_id = p_business_id
        AND status = 'released'
        AND created_at >= p_start AND created_at < p_end;

    IF v_subtotal IS NULL OR v_subtotal = 0 THEN
        RETURN NULL;
    END IF;

    INSERT INTO finance.invoices (
        project_stage_id, issue_to_business_id, issue_from_profile, invoice_type,
        billing_period_start, billing_period_end, amount_cents, subtotal_cents,
        platform_fee_cents, tax_cents, total_cents, currency, status
    )
    VALUES (
        NULL, p_business_id, p_business_id, 'consolidated_monthly',
        p_start, p_end, v_subtotal, v_subtotal,
        v_fee, 0, v_subtotal, COALESCE(v_currency, 'USD'), 'issued'
    )
    RETURNING id INTO v_invoice;

    FOR r IN
        SELECT id, amount_cents, deadline_bonus_cents, platform_fee_cents, currency
        FROM finance.escrows
        WHERE payer_business_id = p_business_id
            AND status = 'released'
            AND created_at >= p_start AND created_at < p_end
    LOOP
        INSERT INTO finance.invoice_line_items (invoice_id, ref_type, ref_id, description, amount_cents, currency)
        VALUES (v_invoice, 'escrow', r.id, 'Released escrow', r.amount_cents, r.currency);

        IF r.deadline_bonus_cents > 0 THEN
            INSERT INTO finance.invoice_line_items (invoice_id, ref_type, ref_id, description, amount_cents, currency)
            VALUES (v_invoice, 'bonus', r.id, 'Deadline bonus', r.deadline_bonus_cents, r.currency);
        END IF;

        IF r.platform_fee_cents > 0 THEN
            INSERT INTO finance.invoice_line_items (invoice_id, ref_type, ref_id, description, amount_cents, currency)
            VALUES (v_invoice, 'platform_fee', r.id, 'Platform fee', r.platform_fee_cents, r.currency);
        END IF;
    END LOOP;

    RETURN v_invoice;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, org;

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

-- =============================================================================
-- 0309_business_finance_overview.sql
-- US-008 · Business Administration & Financial Overview
--
-- Exposes the (otherwise hidden) `finance.*` ledger to the business admin dashboard through a small
-- set of SECURITY DEFINER read RPCs in the `org` schema (which IS in the PostgREST allow-list). The
-- dashboard reads live balances, transaction lines and escrow allocations straight from
-- finance.wallets / finance.transactions / finance.escrows — no seed data.
--
-- It also provisions every business wallet with a one-time opening platform credit so the internal
-- -wallet demo path is real: a business can fund a stage (debiting this credit → a live ledger
-- line) and watch escrow hold/release move the numbers. This "opening platform credit" is a
-- documented business rule (see documentation/business/brain.md · Internal Wallet).
-- =============================================================================

-- #region 1. Business wallet opening credit (provisioning)
-- Every business wallet is seeded once with a promotional platform credit so the internal-wallet
-- demo (fund → hold → release) has funds to move. Idempotent: only fires when the wallet has no
-- ledger history yet.
CREATE OR REPLACE FUNCTION finance.fn_seed_business_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public
AS $$
BEGIN
    IF NEW.owner_type = 'business'
       AND NOT EXISTS (SELECT 1 FROM finance.transactions WHERE wallet_id = NEW.id) THEN
        PERFORM finance.fn_wallet_credit(
            NEW.owner_id, 'business', NEW.currency, 2500000,
            'demo_opening_credit', NULL, NULL
        );
    END IF;
    RETURN NEW;
END;
$$;

-- #endregion

-- #region 2. Finance: refund path for parking auto-release
-- Distinct from finance.fn_release_ticket_escrow (which PAYS the payee). A parked claim never earned
-- anything, so held escrow is returned to the paying business wallet and the ticket is reset to
-- 'unpaid' so a future claim re-funds cleanly. Platform fee is only ever applied on release, so a
-- refund is exactly amount_cents back — no leakage.
CREATE OR REPLACE FUNCTION finance.fn_refund_ticket_escrow(p_ticket_id uuid)
RETURNS void AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT * FROM finance.escrows WHERE ticket_id = p_ticket_id AND status = 'held'
    LOOP
        UPDATE finance.escrows SET status = 'refunded' WHERE id = r.id;
        PERFORM finance.fn_wallet_credit(
            r.payer_business_id, 'business', r.currency, r.amount_cents,
            'escrow_refund', 'escrows', r.id
        );
    END LOOP;

    UPDATE projects.tickets
    SET payment_status = 'unpaid'::payment_status
    WHERE id = p_ticket_id
      AND NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = p_ticket_id AND status = 'held');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, org, auth;
