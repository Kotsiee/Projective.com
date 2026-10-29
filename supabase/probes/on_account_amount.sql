-- =============================================================================================
-- Probe: paying on account credits exactly what the order charges (FINANCE_COMPLETENESS_AUDIT CO20).
--
-- finance.place_on_account_order credits the business wallet with `p_amount` (`on_account_credit`)
-- and then lets place_wallet_order debit the order's own server-priced total. The function is granted
-- to `authenticated`, so `p_amount` is caller input: before the guard an inflated amount left the
-- surplus in the wallet as Available, withdrawable balance (invoiced later as if it had been spent),
-- and a short amount quietly took the rest from money already in the wallet. Now any amount that is
-- not the order's charge is refused PC409 (the checkout's "price changed") and the credit goes with
-- it. A replayed idempotency key still replays the order and credits nothing, whatever amount it
-- carries.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/on_account_amount.sql
--
-- Fixture (seeded): the first open business pipeline project owned by a member other than the
-- business's owner; the owner (who holds `purchase` and `spend`) buys one priced ticket line per case.
-- The business is made KYB-verified and switched to monthly invoicing inside the transaction. A clean
-- run prints only PASS notices; any failure ends the run in an error listing every failed case.
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

-- A fresh business basket holding one priced ticket line on a new stage of the project; the line id.
CREATE FUNCTION pg_temp.line(p_project uuid, p_biz uuid, p_currency text, p_price bigint) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_n int := nextval('pg_temp.probe_sort')::int;
    v_stage uuid;
    v_ticket uuid;
    v_basket uuid;
    v_line uuid;
BEGIN
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (p_project, 'Probe OA ' || v_n, 900 + v_n, 'open', p_price) RETURNING id INTO v_stage;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description)
    VALUES (p_project, v_stage, 'Probe OA T' || v_n, '{"t":"x"}', 'A description.') RETURNING id INTO v_ticket;
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('business', p_biz, 'Probe OA ' || v_n)
    RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, ticket_id, title, unit_price_minor, currency)
    VALUES (v_basket, 'project_ticket', p_project, v_stage, v_ticket, 'Probe line', p_price, p_currency)
    RETURNING id INTO v_line;
    RETURN v_line;
END $$;

CREATE FUNCTION pg_temp.basket_of(p_line uuid) RETURNS uuid LANGUAGE sql AS $$
    SELECT basket_id FROM finance.basket_items WHERE id = p_line;
$$;

-- Every on-account credit ever written against one basket.
CREATE FUNCTION pg_temp.credited(p_basket uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE(sum(amount_cents), 0)::bigint FROM finance.transactions
     WHERE reason = 'on_account_credit' AND ref_table = 'baskets' AND ref_id = p_basket;
$$;
-- #endregion

DO $$
DECLARE
    c_price constant bigint := 15000;
    v_project uuid;
    v_biz uuid;
    v_owner uuid;
    v_currency text;
    v_wallet uuid;
    v_line uuid;
    v_basket uuid;
    v_b0 bigint;
    v_out jsonb;
    v_fail text[] := '{}';
    v_case text;
BEGIN
    -- #region Fixture (as postgres)
    SELECT p.id, p.client_business_id, bp.owner_user_id, upper(COALESCE(p.currency, 'USD'))
      INTO v_project, v_biz, v_owner, v_currency
      FROM projects.projects p
      JOIN org.business_profiles bp ON bp.id = p.client_business_id
     WHERE p.owner_user_id <> bp.owner_user_id
       AND p.format = 'pipeline' AND p.structure_variation = 'standard'
       AND p.status NOT IN ('completed', 'cancelled', 'archived')
     ORDER BY p.id LIMIT 1;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: no business pipeline project owned by a member other than the business owner — run deno task db:reset';
    END IF;
    INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
    SELECT v_project, 'business', v_biz, 'client'
     WHERE NOT EXISTS (SELECT 1 FROM projects.project_participants pp
                        WHERE pp.project_id = v_project AND pp.profile_type = 'business' AND pp.profile_id = v_biz);
    UPDATE org.business_profiles SET kyb_status = 'verified', invoicing_mode = 'intervaled_monthly' WHERE id = v_biz;
    IF EXISTS (SELECT 1 FROM finance.invoices i
                WHERE i.issue_to_business_id = v_biz
                  AND (i.status = 'overdue' OR (i.status = 'issued' AND i.due_date < now()))) THEN
        RAISE EXCEPTION 'FAIL fixture: the business has an overdue invoice';
    END IF;
    v_wallet := finance.fn_ensure_wallet('business', v_biz, v_currency);
    UPDATE finance.wallets SET approval_threshold_cents = NULL WHERE id = v_wallet;
    UPDATE security.platform_params SET value = '0'::jsonb WHERE key = 'vault_approval_threshold_cents';
    DELETE FROM finance.spending_limits WHERE wallet_id = v_wallet AND member_user_id = v_owner;
    -- Money already in the wallet: what a short `p_amount` used to take the rest from.
    PERFORM finance.fn_wallet_credit(v_biz, 'business', v_currency, 100000, 'topup', 'inbound_payments', gen_random_uuid());
    RAISE NOTICE 'fixture project=% business=% buyer(owner)=% wallet=% %', v_project, v_biz, v_owner, v_wallet, v_currency;
    -- #endregion

    PERFORM pg_temp.act(v_owner);

    -- #region 1. An inflated amount is refused, and no credit survives
    v_case := '1 inflated amount refused';
    v_line := pg_temp.line(v_project, v_biz, v_currency, c_price);
    v_basket := pg_temp.basket_of(v_line);
    v_b0 := (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet);
    BEGIN
        PERFORM finance.place_on_account_order(v_basket, ARRAY[v_line], v_currency,
            jsonb_build_object(v_line::text, c_price), NULL, 'probe-oa-1', c_price + 500000);
        v_fail := v_fail || format('%s: accepted — wallet %s, on-account credit %s', v_case,
            (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet) - v_b0, pg_temp.credited(v_basket));
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = 'PC409' THEN
            RAISE NOTICE 'PASS %: % %', v_case, SQLSTATE, SQLERRM;
        ELSE
            v_fail := v_fail || format('%s: refused %s %s (expected PC409)', v_case, SQLSTATE, SQLERRM);
        END IF;
    END;
    IF pg_temp.credited(v_basket) <> 0 OR EXISTS (SELECT 1 FROM finance.orders WHERE idempotency_key = 'probe-oa-1') THEN
        v_fail := v_fail || format('%s: left a credit of %s or an order behind', v_case, pg_temp.credited(v_basket));
    END IF;
    -- #endregion

    -- #region 2. A short amount is refused rather than topped up from the wallet's own money
    v_case := '2 short amount refused';
    v_line := pg_temp.line(v_project, v_biz, v_currency, c_price);
    v_basket := pg_temp.basket_of(v_line);
    v_b0 := (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet);
    BEGIN
        PERFORM finance.place_on_account_order(v_basket, ARRAY[v_line], v_currency,
            jsonb_build_object(v_line::text, c_price), NULL, 'probe-oa-2', c_price - 10000);
        v_fail := v_fail || format('%s: accepted — wallet %s', v_case,
            (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet) - v_b0);
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = 'PC409' THEN
            RAISE NOTICE 'PASS %: % %', v_case, SQLSTATE, SQLERRM;
        ELSE
            v_fail := v_fail || format('%s: refused %s %s (expected PC409)', v_case, SQLSTATE, SQLERRM);
        END IF;
    END;
    -- #endregion

    -- #region 3. The exact amount pays: credit = charge, the wallet's own money untouched
    v_case := '3 exact amount pays';
    v_line := pg_temp.line(v_project, v_biz, v_currency, c_price);
    v_basket := pg_temp.basket_of(v_line);
    v_b0 := (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet);
    BEGIN
        PERFORM finance.place_on_account_order(v_basket, ARRAY[v_line], v_currency,
            jsonb_build_object(v_line::text, c_price), NULL, 'probe-oa-3', c_price);
        IF (SELECT charged_minor FROM finance.orders WHERE idempotency_key = 'probe-oa-3') = c_price
           AND pg_temp.credited(v_basket) = c_price
           AND (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet) = v_b0 THEN
            RAISE NOTICE 'PASS %: charged %, credited %, wallet unchanged', v_case, c_price, c_price;
        ELSE
            v_fail := v_fail || format('%s: charged %s, credited %s, wallet %s', v_case,
                (SELECT charged_minor FROM finance.orders WHERE idempotency_key = 'probe-oa-3'),
                pg_temp.credited(v_basket), (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet) - v_b0);
        END IF;
    EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
    END;
    -- #endregion

    -- #region 4. A replayed key replays the order and credits nothing, whatever amount it carries
    v_case := '4 replay credits nothing';
    v_b0 := (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet);
    BEGIN
        v_out := finance.place_on_account_order(v_basket, ARRAY[v_line], v_currency,
            jsonb_build_object(v_line::text, c_price), NULL, 'probe-oa-3', c_price + 999999);
        IF pg_temp.credited(v_basket) = c_price
           AND (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet) = v_b0
           AND (SELECT count(*) FROM finance.orders WHERE idempotency_key = 'probe-oa-3') = 1 THEN
            RAISE NOTICE 'PASS %: one order, credit still %', v_case, c_price;
        ELSE
            v_fail := v_fail || format('%s: credited %s, wallet %s', v_case, pg_temp.credited(v_basket),
                (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet) - v_b0);
        END IF;
    EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
    END;
    -- #endregion

    PERFORM pg_temp.act(NULL);
    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL %', array_to_string(v_fail, E'\n     ');
    END IF;
END $$;

ROLLBACK;
