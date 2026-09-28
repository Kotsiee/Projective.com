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

-- A person's own wallet type. People hold `freelancer` wallets when they sell and `user` wallets when
-- they only buy; the money functions must credit the one the person actually has. An existing wallet
-- decides (a freelancer wallet wins over a user wallet); with none, a freelancer profile makes it
-- `freelancer`, anything else `user`.
CREATE OR REPLACE FUNCTION finance.fn_person_wallet_type(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT w.owner_type FROM finance.wallets w
          WHERE w.owner_id = p_user AND w.owner_type IN ('freelancer', 'user')
          ORDER BY (w.owner_type = 'freelancer') DESC LIMIT 1),
        CASE WHEN EXISTS (SELECT 1 FROM org.freelancer_profiles f WHERE f.user_id = p_user) THEN 'freelancer' ELSE 'user' END
    );
$$;

-- Make sure an owner holds a wallet in a currency, creating it if not. A credit must never land on a
-- wallet that does not exist: fn_wallet_credit is a silent no-op then, and the money simply vanishes.
CREATE OR REPLACE FUNCTION finance.fn_ensure_wallet(p_owner_type text, p_owner_id uuid, p_currency text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO finance.wallets (owner_type, owner_id, currency)
    VALUES (p_owner_type, p_owner_id, upper(p_currency))
    ON CONFLICT (owner_type, owner_id, currency) DO NOTHING;
    SELECT w.id INTO v_id FROM finance.wallets w
     WHERE w.owner_type = p_owner_type AND w.owner_id = p_owner_id AND w.currency = upper(p_currency);
    RETURN v_id;
END;
$$;

-- The team payout plan (finance-model §5) — ONE implementation read by the release
-- (fn_split_team_payout) and the console's preview (preview_team_split), so what a team is shown it
-- will receive is what it does receive. Integer arithmetic, floored at every cut:
--   benevolent_dictator → everything to the vault;
--   finders_fee         → the finder's fixed cut first, then as co_op on the remainder;
--   co_op               → the vault's `vault_bp` cut, then each ACTIVE member's `percent_bp` of the
--                         rest; whatever does not divide (and any stake left unallocated) is dust
--                         that goes to the vault.
-- No active rule is a co_op rule with no vault cut.
CREATE OR REPLACE FUNCTION finance.fn_team_split_plan(p_team_id uuid, p_payout bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rule record;
    v_rest bigint;
    v_finder bigint := 0;
    v_vault bigint := 0;
    v_pool bigint;
    v_paid bigint := 0;
    v_members jsonb := '[]'::jsonb;
    m record;
    v_share bigint;
BEGIN
    IF p_payout IS NULL OR p_payout <= 0 THEN
        RETURN jsonb_build_object('payout_minor', 0, 'rule_type', NULL, 'vault_bp', 0, 'finder_user_id', NULL,
            'finder_minor', 0, 'vault_minor', 0, 'members', '[]'::jsonb, 'dust_minor', 0, 'vault_total_minor', 0);
    END IF;
    SELECT r.rule_type::text AS rule_type, r.vault_bp, r.finder_user_id, COALESCE(r.finder_bp, 0) AS finder_bp
      INTO v_rule
      FROM finance.split_rules r WHERE r.team_id = p_team_id AND r.active;

    v_rest := p_payout;
    IF v_rule.rule_type = 'benevolent_dictator' THEN
        RETURN jsonb_build_object('payout_minor', p_payout, 'rule_type', v_rule.rule_type, 'vault_bp', 10000,
            'finder_user_id', NULL, 'finder_minor', 0, 'vault_minor', p_payout, 'members', '[]'::jsonb,
            'dust_minor', 0, 'vault_total_minor', p_payout);
    END IF;
    IF v_rule.rule_type = 'finders_fee' AND v_rule.finder_user_id IS NOT NULL THEN
        v_finder := (p_payout * v_rule.finder_bp) / 10000;
        v_rest := p_payout - v_finder;
    END IF;
    v_vault := (v_rest * COALESCE(v_rule.vault_bp, 0)) / 10000;
    v_pool := v_rest - v_vault;

    FOR m IN
        SELECT ca.member_user_id, ca.percent_bp
          FROM finance.contribution_agreements ca
          JOIN org.team_members tm ON tm.team_id = ca.team_id AND tm.user_id = ca.member_user_id AND tm.status = 'active'
         WHERE ca.team_id = p_team_id AND ca.percent_bp > 0
         ORDER BY ca.percent_bp DESC, ca.member_user_id
    LOOP
        v_share := (v_pool * m.percent_bp) / 10000;
        v_paid := v_paid + v_share;
        v_members := v_members || jsonb_build_object('member_user_id', m.member_user_id, 'percent_bp', m.percent_bp, 'amount_minor', v_share);
    END LOOP;

    RETURN jsonb_build_object(
        'payout_minor', p_payout,
        'rule_type', COALESCE(v_rule.rule_type, 'co_op'),
        'vault_bp', COALESCE(v_rule.vault_bp, 0),
        'finder_user_id', CASE WHEN v_finder > 0 THEN v_rule.finder_user_id END,
        'finder_minor', v_finder,
        'vault_minor', v_vault,
        'members', v_members,
        'dust_minor', v_pool - v_paid,
        'vault_total_minor', v_vault + (v_pool - v_paid)
    );
END;
$$;

-- Pay a team's released escrow out by its plan. Every share is a real credit to a real wallet (a
-- missing one is created), a `payout_splits` row is written only beside its credit, and the vault is
-- credited with its cut plus the dust — so the payout is conserved to the minor unit. Rewritten
-- 2026-09-28 (signed off by the product owner): the previous body credited `user` wallets that
-- freelancers do not hold, so every share vanished silently, and it ignored the vault cut entirely.
CREATE OR REPLACE FUNCTION finance.fn_split_team_payout(
    p_escrow_id uuid, p_team_id uuid, p_payout bigint, p_currency text, p_reason text DEFAULT 'escrow_release'
) RETURNS void AS $$
DECLARE
    v_plan jsonb;
    m jsonb;
    v_user uuid;
    v_amount bigint;
    v_type text;
    v_vault bigint;
BEGIN
    IF p_payout IS NULL OR p_payout <= 0 THEN
        RETURN;
    END IF;
    v_plan := finance.fn_team_split_plan(p_team_id, p_payout);

    FOR m IN SELECT * FROM jsonb_array_elements(v_plan->'members') LOOP
        v_user := (m->>'member_user_id')::uuid;
        v_amount := (m->>'amount_minor')::bigint;
        CONTINUE WHEN v_amount <= 0;
        v_type := finance.fn_person_wallet_type(v_user);
        PERFORM finance.fn_ensure_wallet(v_type, v_user, p_currency);
        INSERT INTO finance.payout_splits (escrow_id, member_user_id, amount_cents, currency)
        VALUES (p_escrow_id, v_user, v_amount, p_currency);
        PERFORM finance.fn_wallet_credit(v_user, v_type, p_currency, v_amount, 'team_split', 'escrows', p_escrow_id);
    END LOOP;

    IF (v_plan->>'finder_minor')::bigint > 0 THEN
        v_user := (v_plan->>'finder_user_id')::uuid;
        v_type := finance.fn_person_wallet_type(v_user);
        PERFORM finance.fn_ensure_wallet(v_type, v_user, p_currency);
        INSERT INTO finance.payout_splits (escrow_id, member_user_id, amount_cents, currency)
        VALUES (p_escrow_id, v_user, (v_plan->>'finder_minor')::bigint, p_currency);
        PERFORM finance.fn_wallet_credit(v_user, v_type, p_currency, (v_plan->>'finder_minor')::bigint, 'team_finder_fee', 'escrows', p_escrow_id);
    END IF;

    v_vault := (v_plan->>'vault_total_minor')::bigint;
    IF v_vault > 0 THEN
        PERFORM finance.fn_ensure_wallet('team', p_team_id, p_currency);
        PERFORM finance.fn_wallet_credit(p_team_id, 'team', p_currency, v_vault, p_reason || '_vault_retention', 'escrows', p_escrow_id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

-- Enforce a member's spending envelope on a wallet, and count the spend against it — atomically. The
-- row is locked, the period rolled when it has lapsed (weekly/monthly; `total` never resets), the
-- per-transaction ceiling and the remaining cap checked, and the spend added, in one statement's
-- worth of locking so two concurrent spends cannot both fit under one cap. A NULL cap is "no ceiling"
-- (the row may still carry a per-transaction ceiling); no row at all is no envelope. Rewritten
-- 2026-09-28 (signed off by the product owner): the previous body read then wrote without a lock,
-- ignored `per_transaction_cents` and `period_interval`, and so counted a lifetime total as the month.
CREATE OR REPLACE FUNCTION finance.fn_check_spending_limit(
    p_wallet_id uuid, p_member uuid, p_amount bigint
) RETURNS boolean AS $$
DECLARE
    v_row finance.spending_limits;
    v_spent bigint;
    v_resets timestamptz;
BEGIN
    IF p_member IS NULL OR p_wallet_id IS NULL THEN RETURN true; END IF;
    SELECT * INTO v_row FROM finance.spending_limits
     WHERE wallet_id = p_wallet_id AND member_user_id = p_member
     FOR UPDATE;
    IF NOT FOUND THEN RETURN true; END IF;

    v_spent := v_row.spent_cents;
    v_resets := v_row.resets_at;
    IF v_row.period_interval <> 'total' AND (v_resets IS NULL OR v_resets <= now()) THEN
        IF v_resets IS NOT NULL THEN
            v_spent := 0;
        END IF;
        v_resets := CASE v_row.period_interval
            WHEN 'weekly' THEN date_trunc('week', now()) + interval '1 week'
            ELSE date_trunc('month', now()) + interval '1 month'
        END;
    END IF;

    IF v_row.per_transaction_cents IS NOT NULL AND p_amount > v_row.per_transaction_cents THEN
        UPDATE finance.spending_limits SET spent_cents = v_spent, resets_at = v_resets WHERE id = v_row.id;
        RETURN false;
    END IF;
    IF v_row.cap_cents IS NOT NULL AND v_spent + p_amount > v_row.cap_cents THEN
        UPDATE finance.spending_limits SET spent_cents = v_spent, resets_at = v_resets WHERE id = v_row.id;
        RETURN false;
    END IF;

    UPDATE finance.spending_limits SET spent_cents = v_spent + p_amount, resets_at = v_resets WHERE id = v_row.id;
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

-- A team's split must always describe the whole payout: the active stakes sum to exactly 100%, or
-- (a team nobody has agreed a split for yet) to nothing. Deferred to the end of the transaction so a
-- rebalance may move basis points between rows one statement at a time.
CREATE OR REPLACE FUNCTION finance.fn_assert_team_split_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total bigint;
BEGIN
    SELECT COALESCE(sum(ca.percent_bp), 0) INTO v_total
      FROM finance.contribution_agreements ca WHERE ca.team_id = NEW.team_id;
    IF v_total NOT IN (0, 10000) THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = 'stakes: a team''s split must total 100% (it totals ' || trim_scale(round(v_total / 100.0, 2))::text || '%)';
    END IF;
    RETURN NULL;
END;
$$;

-- A new team or business wallet is governed from birth: project the entity's members onto it.
CREATE OR REPLACE FUNCTION finance.fn_sync_vault_on_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.owner_type IN ('team', 'business') THEN
        PERFORM org.fn_sync_vault_permissions(NEW.owner_type, NEW.owner_id, NULL);
    END IF;
    RETURN NULL;
END;
$$;

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
        p.owner_user_id AS spender,
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

    -- The envelope is the SPENDER's: the project owner who commits the business's money. auth.uid()
    -- here is the freelancer whose claim triggered the hold, who never has an envelope on the payer's
    -- wallet, so checking them waved every hold through.
    IF NOT finance.fn_check_spending_limit(
        (SELECT id FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v.payer AND currency = COALESCE(v.currency, 'USD')),
        v.spender, v_amount
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'spend: this would exceed the project owner''s spending limit on the business wallet';
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
            PERFORM finance.fn_split_team_payout(r.id, r.payee_id, v_payout, r.currency, 'fair_exit_release');
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

-- No wallet is minted money. A business wallet used to be credited 2,500,000 minor units in whatever
-- currency it was opened in (a demo "opening platform credit", fn_seed_business_wallet), so every new
-- business, in every currency, started with spendable funds nobody had paid in. Removed 2026-09-28: a
-- wallet's balance is only ever the sum of real movements (top-ups, releases, transfers).

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
