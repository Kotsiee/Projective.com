-- ============================================================================
-- 00001250 functions finance auto-fund billing
-- Auto-funding, the low-balance warning, paying on account, the billing run and wallet statements
-- (PRODUCT_SPEC §Escrow, Wallets & Finance #4; finance-model.md §13 / §15; root CLAUDE.md §8
-- Decision #172). The consolidated invoice itself is finance.fn_generate_consolidated_invoice
-- (00001200); its trigger and grants are in 00001830 / 00002510.
-- ============================================================================

-- #region 1. Shared reads
-- A project's effective auto-fund mode: its own override, else its client business's mode. A project
-- with no client business is paid for by an individual and is never auto-funded.
CREATE OR REPLACE FUNCTION finance.fn_auto_fund_mode(p_project_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, finance, projects, org, comms, security, auth
AS $$
    SELECT CASE
        WHEN p.client_business_id IS NULL THEN 'off'
        ELSE COALESCE(p.auto_fund_override, b.auto_fund_mode, 'off')
    END
      FROM projects.projects p
      LEFT JOIN org.business_profiles b ON b.id = p.client_business_id
     WHERE p.id = p_project_id;
$$;

-- The billing period that contains p_at: [the latest billing day on or before it, one month later),
-- in UTC. A NULL day is the 1st (Decision #168); days stop at 28, so every month has the date.
CREATE OR REPLACE FUNCTION finance.fn_billing_period(p_billing_day integer, p_at timestamptz)
RETURNS TABLE (period_start timestamptz, period_end timestamptz)
LANGUAGE sql
IMMUTABLE
SET search_path = public, finance, projects, org, comms, security, auth
AS $$
    WITH d AS (
        SELECT pg_catalog.date_trunc('month', p_at AT TIME ZONE 'UTC')
             + (COALESCE(p_billing_day, 1) - 1) * interval '1 day' AS this_month
    ), s AS (
        SELECT CASE WHEN (d.this_month AT TIME ZONE 'UTC') > p_at
                    THEN d.this_month - interval '1 month' ELSE d.this_month END AS start_utc
          FROM d
    )
    SELECT s.start_utc AT TIME ZONE 'UTC', (s.start_utc + interval '1 month') AT TIME ZONE 'UTC' FROM s;
$$;

-- What a business owes on account in one currency: every on-account credit, less every invoice payment.
CREATE OR REPLACE FUNCTION finance.fn_on_account_owed(p_business_id uuid, p_currency text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, finance, projects, org, comms, security, auth
AS $$
    SELECT COALESCE(SUM(CASE WHEN t.reason = 'on_account_credit' THEN t.amount_cents ELSE -t.amount_cents END), 0)::bigint
      FROM finance.transactions t
      JOIN finance.wallets w ON w.id = t.wallet_id
     WHERE w.owner_type = 'business' AND w.owner_id = p_business_id
       AND pg_catalog.upper(w.currency) = pg_catalog.upper(p_currency)
       AND ((t.reason = 'on_account_credit' AND t.direction = 'credit')
            OR (t.reason = 'invoice_payment' AND t.direction = 'debit'));
$$;

-- Tell every member who may add funds to a business wallet that it is running low. `p_kind` is
-- `floor` (a debit crossed the floor) or `queue` (the From-wallet queue outgrew the balance).
CREATE OR REPLACE FUNCTION finance.fn_warn_low_balance(p_wallet_id uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, projects, org, comms, security, auth
AS $$
DECLARE
    w finance.wallets;
    v_slug text;
    v_member uuid;
BEGIN
    SELECT * INTO w FROM finance.wallets WHERE id = p_wallet_id;
    IF NOT FOUND OR w.owner_type <> 'business' THEN RETURN; END IF;
    SELECT b.slug INTO v_slug FROM org.business_profiles b WHERE b.id = w.owner_id;
    FOR v_member IN
        SELECT vp.member_user_id FROM finance.vault_permissions vp
         WHERE vp.wallet_id = w.id AND 'add_funds'::finance.vault_capability = ANY (vp.capabilities)
    LOOP
        PERFORM comms.fn_notify(
            v_member, 'wallet.low_balance',
            CASE p_kind WHEN 'queue' THEN 'Auto-funding is waiting on the wallet' ELSE 'Wallet balance is low' END,
            CASE p_kind
                WHEN 'queue' THEN pg_catalog.format(
                    'Tickets queued to auto-fund from the %s wallet now need more than it holds. Top it up so they can start.',
                    w.currency)
                ELSE pg_catalog.format(
                    'The %s wallet fell below the balance floor you set. Top it up so holds and auto-funding keep working.',
                    w.currency)
            END,
            'wallets', w.id,
            pg_catalog.jsonb_build_object('kind', p_kind, 'balance_minor', w.balance_cents, 'currency', w.currency),
            NULL, 'business', w.owner_id, NULL,
            '/businesses/' || COALESCE(v_slug, w.owner_id::text) || '/billing'
        );
    END LOOP;
END;
$$;
-- #endregion

-- #region 2. Auto-funding (PRODUCT_SPEC §Escrow, Wallets & Finance #4 "Auto-funding")
-- Called by projects.fn_mark_needs_funding when a business project's ticket ENTERS Needs funding.
-- `add_to_basket` puts the ticket in the business's default basket (the same line
-- BasketBackendService.addTicket writes; done here because the refusal happens inside a claim's
-- transaction, as whoever claimed); `from_wallet` queues it — the queue is the set of Needs-funding
-- tickets in from_wallet projects, so there is nothing to store — and warns when the queue now needs
-- more than the wallet holds. Returns what it did (`basketed` · `queued`) or NULL, for the caller's
-- notification. Never raises: a failure here must not undo the refusal it follows.
CREATE OR REPLACE FUNCTION finance.fn_auto_fund_on_needs_funding(p_ticket_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, projects, org, comms, security, auth
AS $$
DECLARE
    v record;
    v_mode text;
    v_basket uuid;
    v_wallet finance.wallets;
    v_queued bigint;
BEGIN
    SELECT t.id, t.title, t.current_stage_id, t.project_id,
           COALESCE(t.unit_price_cents, ps.unit_price_cents) AS amount,
           p.client_business_id, p.owner_user_id, pg_catalog.upper(COALESCE(p.currency, 'USD')) AS currency,
           p.format::text AS format, p.structure_variation::text AS structure_variation,
           ps.name AS stage_name
      INTO v
      FROM projects.tickets t
      JOIN projects.projects p ON p.id = t.project_id
      LEFT JOIN projects.project_stages ps ON ps.id = t.current_stage_id
     WHERE t.id = p_ticket_id;
    IF NOT FOUND OR v.client_business_id IS NULL THEN RETURN NULL; END IF;

    v_mode := finance.fn_auto_fund_mode(v.project_id);

    IF v_mode = 'add_to_basket' THEN
        IF v.amount IS NULL OR v.amount <= 0 THEN RETURN NULL; END IF;
        INSERT INTO finance.baskets (owner_type, owner_id, is_default)
        VALUES ('business', v.client_business_id, true)
        ON CONFLICT (owner_type, owner_id) WHERE is_default DO NOTHING;
        SELECT b.id INTO v_basket FROM finance.baskets b
         WHERE b.owner_type = 'business' AND b.owner_id = v.client_business_id AND b.is_default;
        INSERT INTO finance.basket_items (
            basket_id, item_type, item_id, stage_id, ticket_id, title, subtitle,
            unit_price_minor, currency, quantity, position, metadata
        )
        SELECT v_basket,
               (CASE WHEN v.format <> 'one_off' THEN 'project_ticket'
                     WHEN v.structure_variation = 'single_task' THEN 'one_off_task'
                     ELSE 'one_off_project' END)::finance.purchasable_item_kind,
               v.project_id, v.current_stage_id, v.id, pg_catalog.left(v.title, 200),
               pg_catalog.left(v.stage_name, 120),
               v.amount, v.currency, 1,
               LEAST(COALESCE((SELECT MAX(bi.position) FROM finance.basket_items bi WHERE bi.basket_id = v_basket), -1) + 1, 32767),
               pg_catalog.jsonb_build_object('auto_fund', true)
        ON CONFLICT DO NOTHING;
        INSERT INTO projects.ticket_history (ticket_id, actor_id, action_type, changes)
        VALUES (v.id, v.owner_user_id, 'auto_fund_basketed',
                pg_catalog.jsonb_build_object('basket_id', v_basket, 'amount_minor', v.amount, 'currency', v.currency));
        RETURN 'basketed';
    END IF;

    IF v_mode = 'from_wallet' THEN
        INSERT INTO projects.ticket_history (ticket_id, actor_id, action_type, changes)
        VALUES (v.id, v.owner_user_id, 'auto_fund_queued',
                pg_catalog.jsonb_build_object('amount_minor', v.amount, 'currency', v.currency));
        SELECT * INTO v_wallet FROM finance.wallets w
         WHERE w.owner_type = 'business' AND w.owner_id = v.client_business_id AND w.currency = v.currency;
        IF FOUND THEN
            SELECT COALESCE(SUM(COALESCE(t.unit_price_cents, ps.unit_price_cents)), 0) INTO v_queued
              FROM projects.tickets t
              JOIN projects.projects p ON p.id = t.project_id
              LEFT JOIN projects.project_stages ps ON ps.id = t.current_stage_id
             WHERE t.payment_status = 'needs_funding'::public.payment_status
               AND p.client_business_id = v.client_business_id
               AND pg_catalog.upper(COALESCE(p.currency, 'USD')) = v.currency
               AND finance.fn_auto_fund_mode(p.id) = 'from_wallet';
            -- Once per crossing: only the ticket that takes the queue past the balance warns.
            IF v_queued > v_wallet.balance_cents AND v_queued - COALESCE(v.amount, 0) <= v_wallet.balance_cents THEN
                PERFORM finance.fn_warn_low_balance(v_wallet.id, 'queue');
            END IF;
        END IF;
        RETURN 'queued';
    END IF;

    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'auto-fund skipped for ticket %: %', p_ticket_id, SQLERRM;
    RETURN NULL;
END;
$$;

-- Retry a business wallet's From-wallet queue, oldest ticket first, while the wallet covers the next
-- one. Run on every credit to the wallet except an on-account credit (which is already spoken for),
-- and when an auto-fund spend approval is approved. Each ticket is funded AS its project owner — the
-- spender whose envelope governs it: a ticket with a payee is held (fn_hold_ticket_escrow; the escrow
-- is marked auto_funded); one without (a refused claim was rolled back) returns to Draft, back on the
-- boards, and its next claim holds. A hold at or above the wallet's approval threshold
-- (finance.fn_business_threshold), or over the owner's envelope, needs an approved request for that
-- ticket: the drain asks finance.fn_redeem_spend_approval whether one is there (without spending it —
-- the hold's spend gate does), and where none is it files one request for the ticket and leaves it
-- queued until the approval lands. The threshold binds everyone, the owner included — an approval is
-- someone else's sign-off. Returns how many tickets moved. Never raises.
CREATE OR REPLACE FUNCTION finance.fn_auto_fund_drain(p_wallet_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, projects, org, comms, security, auth
AS $$
DECLARE
    w finance.wallets;
    t record;
    v_budget bigint;
    v_threshold bigint;
    v_escrow uuid;
    v_prev_sub text;
    v_moved integer := 0;
    v_ask boolean;
    v_detail text;
    v_reason text;
    v_approval uuid;
    v_approver uuid;
    v_href text;
BEGIN
    SELECT * INTO w FROM finance.wallets WHERE id = p_wallet_id;
    IF NOT FOUND OR w.owner_type <> 'business' THEN RETURN 0; END IF;
    v_budget := w.balance_cents;
    v_threshold := finance.fn_business_threshold(w.id);

    FOR t IN
        SELECT tk.id, tk.title, tk.slug, COALESCE(tk.unit_price_cents, ps.unit_price_cents) AS amount,
               p.id AS project_id, p.slug AS project_slug, p.owner_user_id
          FROM projects.tickets tk
          JOIN projects.projects p ON p.id = tk.project_id
          LEFT JOIN projects.project_stages ps ON ps.id = tk.current_stage_id
         WHERE tk.payment_status = 'needs_funding'::public.payment_status
           AND p.client_business_id = w.owner_id
           AND pg_catalog.upper(COALESCE(p.currency, 'USD')) = pg_catalog.upper(w.currency)
           AND finance.fn_auto_fund_mode(p.id) = 'from_wallet'
         ORDER BY tk.created_at, tk.id
           FOR UPDATE OF tk SKIP LOCKED
    LOOP
        CONTINUE WHEN t.amount IS NULL OR t.amount <= 0 OR t.amount > v_budget;
        v_href := '/projects/' || t.project_slug || '/board?tkv=' || t.slug;
        v_ask := false;

        IF v_threshold > 0 AND t.amount >= v_threshold THEN
            BEGIN
                PERFORM finance.fn_redeem_spend_approval(w.id, t.owner_user_id, t.amount, 'tickets', t.id, false);
            EXCEPTION WHEN SQLSTATE 'PA403' THEN
                v_ask := true;
            END;
        END IF;

        IF NOT v_ask THEN
            -- As the project owner, so the hold's own "Escrow held" notice is not sent to them twice.
            v_prev_sub := pg_catalog.current_setting('request.jwt.claim.sub', true);
            PERFORM pg_catalog.set_config('request.jwt.claim.sub', t.owner_user_id::text, true);
            BEGIN
                v_escrow := finance.fn_hold_ticket_escrow(t.id);
                UPDATE finance.escrows SET auto_funded = true WHERE id = v_escrow;
                INSERT INTO projects.ticket_history (ticket_id, actor_id, action_type, changes)
                VALUES (t.id, t.owner_user_id, 'auto_funded',
                        pg_catalog.jsonb_build_object('escrow_id', v_escrow, 'amount_minor', t.amount, 'currency', w.currency));
                PERFORM comms.fn_notify(
                    t.owner_user_id, 'escrow.funded', 'Auto-funded from wallet',
                    pg_catalog.format('"%s" was funded from the business wallet. Work can begin.', t.title),
                    'projects.tickets', t.id,
                    pg_catalog.jsonb_build_object('escrow_id', v_escrow, 'amount_minor', t.amount, 'currency', w.currency, 'auto_funded', true),
                    NULL, 'project', t.project_id, NULL, v_href
                );
                v_budget := v_budget - t.amount;
                v_moved := v_moved + 1;
            EXCEPTION
                WHEN check_violation THEN
                    -- No payee: the claim that needed this money was rolled back. Back to Draft — the
                    -- money is there now, and the next claim holds it.
                    UPDATE projects.tickets SET payment_status = 'unpaid'::public.payment_status
                     WHERE id = t.id AND payment_status = 'needs_funding'::public.payment_status;
                    INSERT INTO projects.ticket_history (ticket_id, actor_id, action_type, changes)
                    VALUES (t.id, t.owner_user_id, 'auto_fund_returned',
                            pg_catalog.jsonb_build_object('amount_minor', t.amount, 'currency', w.currency));
                    PERFORM comms.fn_notify(
                        t.owner_user_id, 'escrow.needs_funding', 'Back on the board',
                        pg_catalog.format('The business wallet now covers "%s", so it is open to claims again.', t.title),
                        'projects.tickets', t.id, '{}'::jsonb, NULL, 'project', t.project_id, NULL, v_href
                    );
                    -- Not reserved (Decision #165 flag (b)); counted so one credit reopens only what it covers.
                    v_budget := v_budget - t.amount;
                    v_moved := v_moved + 1;
                WHEN SQLSTATE 'PF402' THEN
                    -- Still refused: it stays queued. Refused for want of an approval (over the owner's
                    -- envelope, or the threshold) it also asks for one.
                    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
                    BEGIN
                        v_reason := NULLIF(v_detail, '')::jsonb ->> 'reason';
                    EXCEPTION WHEN OTHERS THEN
                        v_reason := NULL;
                    END;
                    v_ask := v_reason IN ('spending_limit', 'needs_approval');
            END;
            PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
        END IF;

        -- One open request per ticket: a pending one past its expiry is closed and asked again.
        IF v_ask THEN
            UPDATE finance.spend_approvals sa
               SET status = 'expired'::finance.approval_status
             WHERE sa.wallet_id = w.id AND sa.ref_table = 'tickets' AND sa.ref_id = t.id
               AND sa.status = 'pending'::finance.approval_status AND sa.expires_at <= pg_catalog.now();
            IF NOT EXISTS (
                SELECT 1 FROM finance.spend_approvals sa
                 WHERE sa.wallet_id = w.id AND sa.ref_table = 'tickets' AND sa.ref_id = t.id
                   AND sa.status = 'pending'::finance.approval_status)
            THEN
                INSERT INTO finance.spend_approvals (wallet_id, requested_by, amount_cents, currency, reason, ref_table, ref_id, status, expires_at)
                VALUES (w.id, t.owner_user_id, t.amount, w.currency,
                        pg_catalog.left(pg_catalog.format('Auto-fund "%s" from the business wallet', t.title), 400),
                        'tickets', t.id, 'pending', pg_catalog.now() + interval '7 days')
                RETURNING id INTO v_approval;
                FOR v_approver IN
                    SELECT vp.member_user_id FROM finance.vault_permissions vp
                     WHERE vp.wallet_id = w.id AND vp.member_user_id <> t.owner_user_id
                       AND 'approve_spend'::finance.vault_capability = ANY (vp.capabilities)
                LOOP
                    PERFORM comms.fn_notify(
                        v_approver, 'spend_approval.requested', 'A spend needs your approval',
                        pg_catalog.left(pg_catalog.format('Auto-fund "%s" from the business wallet', t.title), 200),
                        'spend_approvals', v_approval, '{}'::jsonb, t.owner_user_id, w.owner_type, w.owner_id
                    );
                END LOOP;
                INSERT INTO projects.ticket_history (ticket_id, actor_id, action_type, changes)
                VALUES (t.id, t.owner_user_id, 'auto_fund_approval_requested',
                        pg_catalog.jsonb_build_object('approval_id', v_approval, 'amount_minor', t.amount, 'currency', w.currency));
            END IF;
        END IF;
    END LOOP;
    RETURN v_moved;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'auto-fund drain skipped for wallet %: %', p_wallet_id, SQLERRM;
    RETURN v_moved;
END;
$$;

-- AFTER INSERT on finance.transactions, for business wallets only. A credit (not on account) retries
-- the auto-fund queue. A debit that takes the balance from at-or-above the business's floor to below
-- it — in the business's default currency — warns and runs any floor top-up. Stateless debounce: the
-- crossing is read off the debit itself (balance before = after + amount), so the warning re-arms
-- only once the balance is back at or above the floor. Never raises into the money movement.
CREATE OR REPLACE FUNCTION finance.fn_wallet_watch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, projects, org, comms, security, auth
AS $$
DECLARE
    w finance.wallets;
    v_floor bigint;
    v_default text;
BEGIN
    SELECT * INTO w FROM finance.wallets WHERE id = NEW.wallet_id;
    IF NOT FOUND OR w.owner_type <> 'business' THEN RETURN NULL; END IF;

    IF NEW.direction = 'credit' THEN
        IF NEW.reason <> 'on_account_credit' THEN
            PERFORM finance.fn_auto_fund_drain(w.id);
        END IF;
        RETURN NULL;
    END IF;

    SELECT b.low_balance_floor_cents, pg_catalog.upper(COALESCE(b.default_currency, 'USD'))
      INTO v_floor, v_default
      FROM org.business_profiles b WHERE b.id = w.owner_id;
    IF v_floor IS NULL OR pg_catalog.upper(w.currency) <> v_default OR NEW.balance_after_cents IS NULL THEN
        RETURN NULL;
    END IF;
    IF NEW.balance_after_cents + NEW.amount_cents >= v_floor AND NEW.balance_after_cents < v_floor THEN
        PERFORM finance.fn_warn_low_balance(w.id, 'floor');
        UPDATE finance.deposit_rules SET next_run_at = pg_catalog.now()
         WHERE wallet_id = w.id AND active AND interval = 'below_floor'::finance.deposit_interval;
    END IF;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'wallet watch skipped for transaction %: %', NEW.id, SQLERRM;
    RETURN NULL;
END;
$$;
-- #endregion

-- #region 3. Billing controls — auto-funding and the balance floor
-- A business's billing settings, for whoever may see its finances (org.business_profiles has no client
-- read policy): the Billing module, the board's "Will be invoiced on" and the project setup's inherited
-- auto-fund mode read through it. NULL for anyone else.
CREATE OR REPLACE FUNCTION finance.get_billing_settings(p_business_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    SELECT CASE WHEN finance.fn_owner_visible('business', b.id) THEN pg_catalog.jsonb_build_object(
        'business_id', b.id,
        'slug', b.slug,
        'currency', pg_catalog.upper(COALESCE(b.default_currency, 'USD')),
        'invoicing_mode', b.invoicing_mode,
        'billing_day', b.billing_day,
        'kyb_verified', finance.fn_business_kyb_verified(b.id),
        'auto_fund_mode', b.auto_fund_mode,
        'low_balance_floor_cents', b.low_balance_floor_cents,
        'can_manage', finance.fn_owner_capability('business', b.id, 'manage_billing'::finance.vault_capability),
        -- Whether Pay may be offered: pay_invoice's own conditions (the billing right, KYB, an active business).
        'can_pay', finance.fn_owner_capability('business', b.id, 'manage_billing'::finance.vault_capability)
            AND finance.fn_business_kyb_verified(b.id) AND b.status = 'active'
    ) END
      FROM org.business_profiles b
     WHERE b.id = p_business_id;
$$;

-- The Billing module's door for a business's auto-fund mode and balance floor. Same authority as
-- set_invoicing_terms: manage_billing on the business.
CREATE OR REPLACE FUNCTION finance.set_billing_controls(
    p_business_id uuid,
    p_auto_fund_mode text,
    p_low_balance_floor_cents bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to change billing' USING ERRCODE = '42501';
    END IF;
    IF p_auto_fund_mode IS NULL OR p_auto_fund_mode NOT IN ('off', 'add_to_basket', 'from_wallet') THEN
        RAISE EXCEPTION 'autoFundMode: choose off, add to basket or from wallet' USING ERRCODE = '22023';
    END IF;
    IF p_low_balance_floor_cents IS NOT NULL AND p_low_balance_floor_cents <= 0 THEN
        RAISE EXCEPTION 'lowBalanceFloorMinor: a floor is more than zero, or cleared' USING ERRCODE = '22023';
    END IF;
    IF NOT finance.fn_owner_capability('business', p_business_id, 'manage_billing'::finance.vault_capability) THEN
        RAISE EXCEPTION 'Only a member who manages this account''s billing can change it' USING ERRCODE = '42501';
    END IF;

    UPDATE org.business_profiles
       SET auto_fund_mode = p_auto_fund_mode,
           low_balance_floor_cents = p_low_balance_floor_cents,
           updated_at = pg_catalog.now()
     WHERE id = p_business_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Business not found' USING ERRCODE = 'P0002';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'auto_fund_mode', p_auto_fund_mode,
        'low_balance_floor_cents', p_low_balance_floor_cents
    );
END;
$$;
-- #endregion

-- #region 4. Paying on account (PRODUCT_SPEC §Escrow, Wallets & Finance #4 "Paying on account")
-- Checkout's Invoice route. The platform credits the business wallet with the order's amount
-- (`on_account_credit`) and the order is paid from it by place_wallet_order, in this one transaction —
-- so every hold still comes from a wallet, and a refused order takes its credit with it. Only a
-- KYB-verified business on monthly invoicing, with no overdue invoice, within its on-account limit
-- (`on_account_limit_cents`, finance-model §15). `p_amount` is the charge the checkout computed for
-- these lines — what place_wallet_order debits; a replayed key replays the order without crediting again.
CREATE OR REPLACE FUNCTION finance.place_on_account_order(
    p_basket_id uuid,
    p_item_ids uuid[],
    p_currency text,
    p_units jsonb,
    p_promo_code text,
    p_idempotency_key text,
    p_amount bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
DECLARE
    v_basket finance.baskets;
    v_business org.business_profiles;
    v_currency text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, '')));
    v_limit bigint;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to pay' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM finance.orders o WHERE o.idempotency_key = p_idempotency_key) THEN
        RETURN finance.place_wallet_order(p_basket_id, p_item_ids, p_currency, p_units, p_promo_code, p_idempotency_key);
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Nothing to pay on account' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_basket FROM finance.baskets WHERE id = p_basket_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That basket no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF v_basket.owner_type <> 'business' THEN
        RAISE EXCEPTION 'Paying by invoice is for business accounts' USING ERRCODE = '22023';
    END IF;
    IF NOT finance.fn_can_manage_basket(v_basket.owner_type, v_basket.owner_id) THEN
        RAISE EXCEPTION 'Only a member who can spend from this account can pay from it' USING ERRCODE = '42501';
    END IF;
    -- Buying as the business needs `purchase` as well as vault `spend`, as place_wallet_order (BB2).
    IF NOT security.is_admin() AND NOT org.fn_member_can('business', v_basket.owner_id, 'purchase') THEN
        RAISE EXCEPTION 'missing_permission: purchase'
            USING ERRCODE = 'PK403',
                  HINT = 'Ask the business owner or an admin for the "purchase" permission.';
    END IF;
    SELECT * INTO v_business FROM org.business_profiles WHERE id = v_basket.owner_id;
    IF NOT finance.fn_business_kyb_verified(v_business.id) THEN
        RAISE EXCEPTION 'Complete business verification (KYB) to pay by invoice' USING ERRCODE = 'PK403';
    END IF;
    IF v_business.invoicing_mode <> 'intervaled_monthly' THEN
        RAISE EXCEPTION 'Switch to monthly invoicing to pay by invoice' USING ERRCODE = 'PK403';
    END IF;
    IF EXISTS (
        SELECT 1 FROM finance.invoices i
         WHERE i.issue_to_business_id = v_business.id
           AND (i.status = 'overdue' OR (i.status = 'issued' AND i.due_date < pg_catalog.now()))
    ) THEN
        RAISE EXCEPTION 'Pay the overdue invoice before buying on account again' USING ERRCODE = 'PK403';
    END IF;
    SELECT COALESCE((pp.value #>> '{}')::bigint, 0) INTO v_limit
      FROM security.platform_params pp WHERE pp.key = 'on_account_limit_cents';
    IF finance.fn_on_account_owed(v_business.id, v_currency) + p_amount > COALESCE(v_limit, 0) THEN
        RAISE EXCEPTION 'This would take the business past its on-account limit — pay from the wallet instead'
            USING ERRCODE = 'PF402';
    END IF;

    -- The spend gate (KYB, the buyer's envelope, the threshold — BB3) runs once, in place_wallet_order
    -- below, on what the order actually charges; a refusal there takes this credit back with it.
    PERFORM finance.fn_ensure_wallet('business', v_business.id, v_currency);
    PERFORM finance.fn_wallet_credit(v_business.id, 'business', v_currency, p_amount, 'on_account_credit', 'baskets', v_basket.id);
    RETURN finance.place_wallet_order(p_basket_id, p_item_ids, p_currency, p_units, p_promo_code, p_idempotency_key);
END;
$$;

-- What the checkout and the Billing module need about paying on account: whether the business is on
-- monthly invoicing, whether an invoice is overdue, and what it owes against its limit in this currency.
CREATE OR REPLACE FUNCTION finance.get_on_account_standing(p_business_id uuid, p_currency text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    WITH f AS (
        SELECT COALESCE((SELECT (pp.value #>> '{}')::bigint FROM security.platform_params pp
                          WHERE pp.key = 'on_account_limit_cents'), 0) AS limit_minor,
               finance.fn_on_account_owed(p_business_id, p_currency) AS owed_minor
    )
    SELECT CASE WHEN NOT finance.fn_owner_visible('business', p_business_id) THEN NULL ELSE
        pg_catalog.jsonb_build_object(
            'monthly', COALESCE((SELECT b.invoicing_mode = 'intervaled_monthly' FROM org.business_profiles b WHERE b.id = p_business_id), false),
            'overdue', EXISTS (
                SELECT 1 FROM finance.invoices i
                 WHERE i.issue_to_business_id = p_business_id
                   AND (i.status = 'overdue' OR (i.status = 'issued' AND i.due_date < pg_catalog.now()))),
            'owed_minor', f.owed_minor,
            'limit_minor', f.limit_minor,
            'headroom_minor', GREATEST(f.limit_minor - f.owed_minor, 0)
        )
    END
      FROM f;
$$;
-- #endregion

-- #region 5. Paying an invoice
-- A billing member settles an invoice's amount due from the business wallet in its currency
-- (`invoice_payment`). Paying by card is a top-up of that wallet first (Decision #125). Only an active
-- business pays (55000 business_not_active, BB5) — archiving waits for its invoices to be paid.
CREATE OR REPLACE FUNCTION finance.pay_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
DECLARE
    v_inv finance.invoices;
    v_balance bigint;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to pay' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_inv FROM finance.invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That invoice no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF NOT finance.fn_owner_capability('business', v_inv.issue_to_business_id, 'manage_billing'::finance.vault_capability) THEN
        RAISE EXCEPTION 'Only a member who manages this account''s billing can pay its invoices' USING ERRCODE = '42501';
    END IF;
    PERFORM org.fn_assert_business_active(v_inv.issue_to_business_id);
    IF v_inv.status NOT IN ('issued', 'overdue') OR v_inv.amount_due_cents <= 0 THEN
        RAISE EXCEPTION 'This invoice has nothing to pay' USING ERRCODE = 'PC409';
    END IF;
    SELECT w.balance_cents INTO v_balance FROM finance.wallets w
     WHERE w.owner_type = 'business' AND w.owner_id = v_inv.issue_to_business_id
       AND pg_catalog.upper(w.currency) = pg_catalog.upper(v_inv.currency)
       FOR UPDATE;
    IF COALESCE(v_balance, 0) < v_inv.amount_due_cents THEN
        RAISE EXCEPTION 'The wallet doesn''t hold enough to pay this invoice — top it up first' USING ERRCODE = 'PF402';
    END IF;

    PERFORM finance.fn_wallet_debit(v_inv.issue_to_business_id, 'business', pg_catalog.upper(v_inv.currency),
        v_inv.amount_due_cents, 'invoice_payment', 'invoices', v_inv.id);
    UPDATE finance.invoices SET status = 'paid', paid_at = pg_catalog.now() WHERE id = v_inv.id;
    RETURN pg_catalog.jsonb_build_object('id', v_inv.id, 'status', 'paid', 'paid_minor', v_inv.amount_due_cents,
        'currency', v_inv.currency);
END;
$$;
-- #endregion

-- #region 6. Statements — finance.statements, the wallet's month as a PDF-ready document
-- One statement per wallet and calendar month (UTC) [p_start, p_end): money in, money out and fees
-- (platform and instant-payout fees, kept out of "money out"), with the opening balance worked back
-- from the wallet's balance now less every movement since p_start, and closing = opening + in − out −
-- fees. Derived from sums rather than from one ledger row's running balance, because the lines of one
-- transaction share a timestamp and cannot be ordered among themselves; exact while the ledger
-- reconciles (finance.v_wallet_reconciliation). Idempotent on uq_statement_period. Returns the
-- statement id, or NULL for a wallet with no ledger before p_end.
CREATE OR REPLACE FUNCTION finance.fn_generate_statement(p_wallet_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, projects, org, comms, security, auth
AS $$
DECLARE
    w finance.wallets;
    v_id uuid;
    v_open bigint;
    v_close bigint;
    v_in bigint;
    v_out bigint;
    v_fees bigint;
BEGIN
    SELECT * INTO w FROM finance.wallets WHERE id = p_wallet_id;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM finance.transactions t WHERE t.wallet_id = w.id AND t.created_at < p_end) THEN
        RETURN NULL;
    END IF;
    SELECT s.id INTO v_id FROM finance.statements s
     WHERE s.owner_type = w.owner_type AND s.owner_id = w.owner_id AND s.period_start = p_start
       AND s.currency = pg_catalog.upper(w.currency);
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;

    SELECT w.balance_cents - COALESCE(SUM(CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END), 0)
      INTO v_open
      FROM finance.transactions t
     WHERE t.wallet_id = w.id AND t.created_at >= p_start;
    SELECT COALESCE(SUM(t.amount_cents) FILTER (WHERE t.direction = 'credit'), 0),
           COALESCE(SUM(t.amount_cents) FILTER (WHERE t.direction = 'debit'
                                                  AND t.reason NOT IN ('platform_fee', 'instant_payout_fee')), 0),
           COALESCE(SUM(t.amount_cents) FILTER (WHERE t.direction = 'debit'
                                                  AND t.reason IN ('platform_fee', 'instant_payout_fee')), 0)
      INTO v_in, v_out, v_fees
      FROM finance.transactions t
     WHERE t.wallet_id = w.id AND t.created_at >= p_start AND t.created_at < p_end;
    v_close := v_open + v_in - v_out - v_fees;

    INSERT INTO finance.statements (
        owner_type, owner_id, period_start, period_end, currency,
        opening_balance_cents, closing_balance_cents, total_in_cents, total_out_cents, total_fees_cents,
        status, issued_at
    )
    VALUES (
        w.owner_type, w.owner_id, p_start, p_end, pg_catalog.upper(w.currency),
        v_open, v_close, v_in, v_out, v_fees, 'issued', pg_catalog.now()
    )
    ON CONFLICT ON CONSTRAINT uq_statement_period DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
-- #endregion

-- #region 7. The billing run (daily; scheduled in 00005060)
-- One pass, safe to repeat (every write is idempotent on its unique key):
--  1. every business on monthly invoicing gets the invoice for its last CLOSED billing period
--     (finance.fn_generate_consolidated_invoice) — a missed day catches up on the next run;
--  2. on and after the 1st, every wallet gets last month's statement, and its members hear it is ready;
--  3. an issued invoice past its due date becomes Overdue and the billing members are told.
-- Returns what it did, for the scheduler's log.
CREATE OR REPLACE FUNCTION finance.fn_run_billing_cycle(p_at timestamptz DEFAULT pg_catalog.now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, projects, org, comms, security, auth
AS $$
DECLARE
    b record;
    w record;
    i record;
    v_member uuid;
    v_period record;
    v_ids uuid[];
    v_invoices integer := 0;
    v_statements integer := 0;
    v_overdue integer := 0;
    v_month_start timestamptz := pg_catalog.date_trunc('month', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_stmt uuid;
BEGIN
    FOR b IN
        SELECT bp.id, bp.billing_day FROM org.business_profiles bp WHERE bp.invoicing_mode = 'intervaled_monthly'
    LOOP
        SELECT * INTO v_period FROM finance.fn_billing_period(b.billing_day, p_at);
        BEGIN
            v_ids := finance.fn_generate_consolidated_invoice(b.id, v_period.period_start - interval '1 month', v_period.period_start);
            v_invoices := v_invoices + COALESCE(pg_catalog.cardinality(v_ids), 0);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'invoice skipped for business %: %', b.id, SQLERRM;
        END;
    END LOOP;

    FOR w IN SELECT wl.id, wl.owner_type, wl.owner_id FROM finance.wallets wl LOOP
        IF NOT EXISTS (
            SELECT 1 FROM finance.statements s
             WHERE s.owner_type = w.owner_type AND s.owner_id = w.owner_id
               AND s.period_start = v_month_start - interval '1 month'
               AND s.currency = (SELECT pg_catalog.upper(x.currency) FROM finance.wallets x WHERE x.id = w.id))
        THEN
            BEGIN
                v_stmt := finance.fn_generate_statement(w.id, v_month_start - interval '1 month', v_month_start);
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'statement skipped for wallet %: %', w.id, SQLERRM;
                v_stmt := NULL;
            END;
            IF v_stmt IS NOT NULL THEN
                v_statements := v_statements + 1;
                FOR v_member IN
                    SELECT w.owner_id WHERE w.owner_type IN ('user', 'freelancer')
                    UNION
                    SELECT vp.member_user_id FROM finance.vault_permissions vp
                     WHERE vp.wallet_id = w.id AND 'manage_billing'::finance.vault_capability = ANY (vp.capabilities)
                LOOP
                    PERFORM comms.fn_notify(v_member, 'statement.ready', 'Your monthly statement is ready',
                        'Last month''s wallet statement is ready to download.', 'statements', v_stmt);
                END LOOP;
            END IF;
        END IF;
    END LOOP;

    FOR i IN
        UPDATE finance.invoices SET status = 'overdue'
         WHERE status = 'issued' AND due_date < p_at
        RETURNING id, issue_to_business_id, currency, amount_due_cents
    LOOP
        v_overdue := v_overdue + 1;
        FOR v_member IN
            SELECT DISTINCT vp.member_user_id FROM finance.vault_permissions vp
              JOIN finance.wallets wl ON wl.id = vp.wallet_id
             WHERE wl.owner_type = 'business' AND wl.owner_id = i.issue_to_business_id
               AND 'manage_billing'::finance.vault_capability = ANY (vp.capabilities)
        LOOP
            PERFORM comms.fn_notify(v_member, 'invoice.overdue', 'An invoice is overdue',
                pg_catalog.format('A %s invoice is past its due date. Pay it to keep buying on account.', i.currency),
                'invoices', i.id, pg_catalog.jsonb_build_object('amount_due_minor', i.amount_due_cents, 'currency', i.currency),
                NULL, 'business', i.issue_to_business_id);
        END LOOP;
    END LOOP;

    RETURN pg_catalog.jsonb_build_object('invoices', v_invoices, 'statements', v_statements, 'overdue', v_overdue);
END;
$$;

COMMENT ON FUNCTION finance.fn_run_billing_cycle(timestamptz) IS
'The daily billing run: monthly business invoices on each billing_day (catching up a missed day),
last month''s wallet statements from the 1st, and the overdue sweep. Idempotent; service role / pg_cron only.';

-- Scheduled daily at 02:20 UTC as `finance-billing-cycle` by the job registry (`ops.scheduled_jobs`,
-- 00005060).
-- #endregion
