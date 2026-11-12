-- =============================================================================================
-- Probe: pots are earmarks inside the wallet (FINANCE_AUDIT A2, A3, L7; Decision #337, ruling M6;
-- FINANCE_BUILD_PROMPTS DB5).
--
--   1. A 30% tax pot and a 10% savings pot on a matured £1,000.01 release earmark 300.00 and 100.00;
--      600.01 stays Available and the wallet's balance is the whole 1,000.01.
--   2. A replayed maturation, and a second allocation of the same credit, earmark nothing more.
--   3. Σ auto_allocate_bp over a wallet's active pots is at most 10000 (10001 refused, 10000 accepted);
--      a new tax pot's default share is tax_pot_default_bp, fitted into what the other pots leave.
--   4. A voluntary spend into earmarked money is refused PF402 `earmarked`; a spend of what is
--      Available goes through; a spend beyond the balance still fails as before; an unknown debit
--      reason raises.
--   5. Moving money into a pot needs that much Available, out of a pot that much in it; each move is
--      one finance.pot_movements row by its author; a stranger can neither move nor save.
--   6. A chargeback recovery takes earmarked money by shrinking the newest pot first, then the next; a
--      refund recovery the same; every shrink is a `recovery` movement keyed to its debit.
--   7. Archiving needs an empty pot; an archived pot takes no money and no longer counts towards Σbp.
--   8. With a zero-day window an earned credit is earmarked at once; a top-up never is; a non-income
--      reason is refused by the pending door.
--   9. On a shared vault a `spend`-only member cannot save a pot, a `distribute` holder can.
--  10. finance.pot_movements is append-only and clients cannot write it.
--  11. A payout schedule's run pays Available minus earmarks (DB4's fn_payout_schedule_available).
--  12. Through it all: Σ active pots ≤ balance, each pot's balance is Σ its movements, and the
--      reconciliation view shows no drift; an earmark never writes finance.transactions.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/wallet_pots.sql
--
-- Fixtures: a fresh GBP wallet for the first seeded freelancer who has none, any seeded escrow as the
-- release's source, any other person as the stranger, and the first seeded team or business wallet
-- with two seated, non-operator members. Other due pending rows are pushed out of the window so the
-- sweep matures only the probe's. A clean run prints only `ok`.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers + fixtures (as postgres)
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true),
           pg_catalog.set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN ''
               ELSE pg_catalog.json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$$;

CREATE FUNCTION pg_temp.bal(p_wallet uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = p_wallet;
$$;

CREATE FUNCTION pg_temp.pot(p_id uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallet_pots WHERE id = p_id;
$$;

CREATE FUNCTION pg_temp.moves(p_wallet uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT pg_catalog.count(*) FROM finance.pot_movements WHERE wallet_id = p_wallet;
$$;

CREATE FUNCTION pg_temp.lines(p_wallet uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT pg_catalog.count(*) FROM finance.transactions WHERE wallet_id = p_wallet;
$$;

-- The pot invariants for one wallet: Σ active pots ≤ balance, every pot's balance = Σ its movements =
-- its newest movement's balance_after, an archived pot holds nothing, and the reconciliation view agrees.
CREATE FUNCTION pg_temp.pots_ok(p_wallet uuid) RETURNS boolean LANGUAGE sql AS $$
    SELECT (SELECT COALESCE(pg_catalog.sum(p.balance_cents), 0) FROM finance.wallet_pots p
             WHERE p.wallet_id = p_wallet AND p.active) <= pg_temp.bal(p_wallet)
       AND NOT EXISTS (
            SELECT 1 FROM finance.wallet_pots p
             WHERE p.wallet_id = p_wallet
               AND (p.balance_cents <> COALESCE((
                        SELECT pg_catalog.sum(CASE m.direction WHEN 'in' THEN m.amount_cents ELSE -m.amount_cents END)
                          FROM finance.pot_movements m WHERE m.pot_id = p.id), 0)
                 OR p.balance_cents <> COALESCE((
                        SELECT m.balance_after_cents FROM finance.pot_movements m
                         WHERE m.pot_id = p.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1), 0)
                 OR (NOT p.active AND p.balance_cents <> 0)))
       AND (SELECT r.drift_cents = 0 AND r.pot_drift_cents = 0 AND r.earmarked_cents <= r.balance_cents
              FROM finance.v_wallet_reconciliation r WHERE r.wallet_id = p_wallet);
$$;

DO $$
DECLARE
    v_owner uuid;
    v_type text;
    v_wallet uuid;
    v_stranger uuid;
    v_escrow uuid;
BEGIN
    SELECT f.user_id INTO v_owner FROM org.freelancer_profiles f
     WHERE NOT EXISTS (SELECT 1 FROM finance.wallets w WHERE w.owner_id = f.user_id AND w.currency = 'GBP')
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = f.user_id)
     ORDER BY f.user_id LIMIT 1;
    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id <> v_owner AND NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT e.id INTO v_escrow FROM finance.escrows e ORDER BY e.created_at, e.id LIMIT 1;
    IF v_owner IS NULL OR v_stranger IS NULL OR v_escrow IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixtures missing (a freelancer without a GBP wallet, a stranger, an escrow): run deno task db:reset';
    END IF;
    v_type := finance.fn_person_wallet_type(v_owner);
    v_wallet := finance.fn_ensure_wallet(v_type, v_owner, 'GBP');

    UPDATE security.platform_params SET value = '7'::jsonb WHERE key = 'pending_release_days';
    UPDATE security.platform_params SET value = '0'::jsonb WHERE key = 'tax_pot_default_bp';
    UPDATE finance.pending_releases SET available_at = available_at + interval '100 years'
     WHERE state = 'pending' AND available_at <= pg_catalog.now();

    PERFORM pg_catalog.set_config('probe.owner', v_owner::text, true);
    PERFORM pg_catalog.set_config('probe.type', v_type, true);
    PERFORM pg_catalog.set_config('probe.wallet', v_wallet::text, true);
    PERFORM pg_catalog.set_config('probe.stranger', v_stranger::text, true);
    PERFORM pg_catalog.set_config('probe.escrow', v_escrow::text, true);
END $$;
-- #endregion

-- #region 1. A 30% tax pot and a 10% savings pot earmark a matured £1,000.01 release
SELECT pg_temp.as_user(pg_temp.s('owner')::uuid);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('probe.tax',
    finance.save_wallet_pot(pg_temp.s('wallet')::uuid, NULL, 'tax', 'Tax set-aside', 3000, NULL) ->> 'id', true);
SELECT pg_catalog.set_config('probe.savings',
    finance.save_wallet_pot(pg_temp.s('wallet')::uuid, NULL, 'savings', 'Rainy day', 1000, 50000) ->> 'id', true);
RESET ROLE;
SELECT pg_temp.as_user(NULL);

DO $$
DECLARE
    v_wallet uuid := pg_temp.s('wallet')::uuid;
    v_tax uuid := pg_temp.s('tax')::uuid;
    v_savings uuid := pg_temp.s('savings')::uuid;
    v_matured integer;
    v_tx uuid;
BEGIN
    PERFORM pg_temp.ok(v_tax IS NOT NULL AND v_savings IS NOT NULL
        AND (SELECT goal_cents FROM finance.wallet_pots WHERE id = v_savings) = 50000,
        '1 the owner saves a 30% tax pot and a 10% savings pot with a goal');

    PERFORM finance.fn_wallet_credit_pending(pg_temp.s('owner')::uuid, pg_temp.s('type'), 'GBP', 100001,
        'escrow_release', 'escrows', pg_temp.s('escrow')::uuid);
    PERFORM pg_temp.ok(pg_temp.bal(v_wallet) = 0 AND pg_temp.pot(v_tax) = 0,
        '1 a release in the window is neither Available nor earmarked');

    UPDATE finance.pending_releases SET available_at = released_at WHERE wallet_id = v_wallet AND state = 'pending';
    v_matured := finance.fn_mature_pending_releases(1000);
    SELECT t.id INTO v_tx FROM finance.transactions t
     WHERE t.wallet_id = v_wallet AND t.direction = 'credit' AND t.reason = 'escrow_release';
    PERFORM pg_catalog.set_config('probe.credit', v_tx::text, true);

    PERFORM pg_temp.ok(v_matured = 1 AND pg_temp.bal(v_wallet) = 100001,
        '1 the release matures into a balance of 1,000.01');
    PERFORM pg_temp.ok(pg_temp.pot(v_tax) = 30000 AND pg_temp.pot(v_savings) = 10000,
        '1 the pots earmark 300.00 and 100.00 (each share floored)');
    PERFORM pg_temp.ok(finance.fn_available_cents(v_wallet) = 60001, '1 600.01 stays Available, the dust included');
    PERFORM pg_temp.ok((SELECT pg_catalog.count(*) FROM finance.pot_movements
                         WHERE wallet_id = v_wallet AND reason = 'allocation' AND ref_table = 'transactions'
                           AND ref_id = v_tx AND actor_user_id IS NULL) = 2,
        '1 two allocation movements, each keyed to the matured credit');
    PERFORM pg_temp.ok(pg_temp.lines(v_wallet) = 1, '1 the earmark wrote no ledger row');
    PERFORM pg_temp.ok(pg_temp.pots_ok(v_wallet), '1 the pot invariants hold');
END $$;
-- #endregion

-- #region 2. A replayed maturation earmarks nothing more
DO $$
DECLARE
    v_wallet uuid := pg_temp.s('wallet')::uuid;
    v_moves bigint := pg_temp.moves(v_wallet);
BEGIN
    PERFORM pg_temp.ok(finance.fn_mature_pending_releases(1000) = 0, '2 a second sweep matures nothing');
    PERFORM pg_temp.ok(finance.fn_apply_pot_allocations(v_wallet, 100001, 'escrow_release', 'transactions',
            pg_temp.s('credit')::uuid) = 0,
        '2 allocating the same credit again earmarks nothing');
    PERFORM pg_temp.ok(pg_temp.moves(v_wallet) = v_moves AND finance.fn_available_cents(v_wallet) = 60001,
        '2 the pots and Available are unchanged');
    BEGIN
        PERFORM finance.fn_apply_pot_allocations(v_wallet, 100, 'topup', 'transactions', pg_temp.s('credit')::uuid);
        RAISE EXCEPTION 'PROBE FAIL: 2 a top-up was earmarked';
    EXCEPTION WHEN invalid_parameter_value THEN
        PERFORM pg_temp.ok(true, '2 a non-income credit is never earmarked (22023)');
    END;
END $$;
-- #endregion

-- #region 3. Σ auto_allocate_bp ≤ 10000; the tax default fits what is left
SELECT pg_temp.as_user(pg_temp.s('owner')::uuid);
DO $$
DECLARE
    v_wallet uuid := pg_temp.s('wallet')::uuid;
    v_tax uuid := pg_temp.s('tax')::uuid;
    v_pot jsonb;
BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM finance.save_wallet_pot(v_wallet, NULL, 'goal', 'Holiday', 6001, NULL);
        RAISE EXCEPTION 'PROBE FAIL: 3 a pot taking Σbp to 10001 was saved';
    EXCEPTION WHEN invalid_parameter_value THEN
        PERFORM pg_temp.ok(SQLERRM LIKE 'autoAllocateBp:%set aside 40\% of income%at most 60\%',
            '3 Σbp 10001 refused (' || SQLERRM || ')');
    END;
    BEGIN
        PERFORM finance.save_wallet_pot(v_wallet, v_tax, 'tax', 'Tax set-aside', 9001, NULL);
        RAISE EXCEPTION 'PROBE FAIL: 3 re-weighting a pot to Σbp 10001 was saved';
    EXCEPTION WHEN invalid_parameter_value THEN
        PERFORM pg_temp.ok(true, '3 re-weighting an existing pot past 10000 refused');
    END;
    BEGIN
        v_pot := finance.save_wallet_pot(v_wallet, NULL, 'goal', 'Holiday', 6000, NULL);
        PERFORM pg_temp.ok((v_pot ->> 'auto_allocate_bp')::int = 6000, '3 Σbp exactly 10000 accepted');
        RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'undo';
    EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
    END;
    RESET ROLE;
    UPDATE security.platform_params SET value = '9500'::jsonb WHERE key = 'tax_pot_default_bp';
    SET LOCAL ROLE authenticated;
    BEGIN
        v_pot := finance.save_wallet_pot(v_wallet, NULL, 'tax', 'Second tax pot', NULL, NULL);
        PERFORM pg_temp.ok((v_pot ->> 'auto_allocate_bp')::int = 6000,
            '3 a new tax pot''s default share is tax_pot_default_bp fitted into what is left (6000)');
        RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'undo';
    EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
    END;
    BEGIN
        v_pot := finance.save_wallet_pot(v_wallet, NULL, 'general', 'Plain pot', NULL, NULL);
        PERFORM pg_temp.ok((v_pot ->> 'auto_allocate_bp')::int = 0, '3 any other new pot defaults to 0');
        RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'undo';
    EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
    END;
    RESET ROLE;
    UPDATE security.platform_params SET value = '0'::jsonb WHERE key = 'tax_pot_default_bp';
END $$;
SELECT pg_temp.as_user(NULL);
-- #endregion

-- #region 4. A voluntary spend never reaches earmarked money
DO $$
DECLARE
    v_owner uuid := pg_temp.s('owner')::uuid;
    v_type text := pg_temp.s('type');
    v_wallet uuid := pg_temp.s('wallet')::uuid;
BEGIN
    BEGIN
        PERFORM finance.fn_wallet_debit(v_owner, v_type, 'GBP', 60002, 'payout', 'payouts', pg_catalog.gen_random_uuid());
        RAISE EXCEPTION 'PROBE FAIL: 4 a payout into earmarked money went through';
    EXCEPTION WHEN SQLSTATE 'PF402' THEN
        PERFORM pg_temp.ok(SQLERRM LIKE 'earmarked:%', '4 a spend into an earmark refused PF402 (' || SQLERRM || ')');
    END;
    BEGIN
        PERFORM finance.fn_wallet_debit(v_owner, v_type, 'GBP', 100002, 'escrow_hold', 'escrows', pg_catalog.gen_random_uuid());
        RAISE EXCEPTION 'PROBE FAIL: 4 a spend beyond the balance went through';
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.ok(true, '4 a spend beyond the whole balance still fails on the balance CHECK');
    END;
    BEGIN
        PERFORM finance.fn_wallet_debit(v_owner, v_type, 'GBP', 1, 'gift', NULL, NULL);
        RAISE EXCEPTION 'PROBE FAIL: 4 an unknown debit reason was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN
        PERFORM pg_temp.ok(true, '4 a debit reason in neither list raises (22023)');
    END;
    BEGIN
        PERFORM finance.fn_wallet_debit(v_owner, v_type, 'GBP', 60001, 'transfer_out', 'wallets', pg_catalog.gen_random_uuid());
        PERFORM pg_temp.ok(pg_temp.bal(v_wallet) = 40000 AND finance.fn_available_cents(v_wallet) = 0
            AND pg_temp.pots_ok(v_wallet), '4 spending exactly what is Available goes through, the pots untouched');
        RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'undo';
    EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
    END;
END $$;
-- #endregion

-- #region 5. Moving money into and out of a pot
SELECT pg_temp.as_user(pg_temp.s('owner')::uuid);
DO $$
DECLARE
    v_wallet uuid := pg_temp.s('wallet')::uuid;
    v_tax uuid := pg_temp.s('tax')::uuid;
    v_savings uuid := pg_temp.s('savings')::uuid;
    v_out jsonb;
    v_lines bigint := pg_temp.lines(v_wallet);
BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM finance.move_pot_funds(v_savings, 60002, 'in');
        RAISE EXCEPTION 'PROBE FAIL: 5 more than Available was moved into a pot';
    EXCEPTION WHEN SQLSTATE 'PF402' THEN
        PERFORM pg_temp.ok(true, '5 moving more than Available into a pot refused (PF402)');
    END;
    v_out := finance.move_pot_funds(v_savings, 1, 'in');
    PERFORM pg_temp.ok((v_out ->> 'balance_cents')::bigint = 10001 AND (v_out ->> 'available_cents')::bigint = 60000,
        '5 a move in earmarks Available money');
    BEGIN
        PERFORM finance.move_pot_funds(v_tax, 30001, 'out');
        RAISE EXCEPTION 'PROBE FAIL: 5 more than a pot holds was moved out';
    EXCEPTION WHEN SQLSTATE 'PF402' THEN
        PERFORM pg_temp.ok(true, '5 moving more out than the pot holds refused (PF402)');
    END;
    v_out := finance.move_pot_funds(v_savings, 1, 'out');
    PERFORM pg_temp.ok((v_out ->> 'balance_cents')::bigint = 10000 AND (v_out ->> 'available_cents')::bigint = 60001,
        '5 a move out releases it back to Available');
    BEGIN
        PERFORM finance.move_pot_funds(v_savings, 0, 'in');
        RAISE EXCEPTION 'PROBE FAIL: 5 a zero move was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN
        PERFORM pg_temp.ok(true, '5 a zero amount refused');
    END;
    RESET ROLE;
    PERFORM pg_temp.ok((SELECT pg_catalog.count(*) FROM finance.pot_movements
                         WHERE pot_id = v_savings AND reason IN ('move_in', 'move_out')
                           AND actor_user_id = pg_temp.s('owner')::uuid) = 2,
        '5 each move is one movement row by its author');
    PERFORM pg_temp.ok(pg_temp.bal(v_wallet) = 100001 AND pg_temp.lines(v_wallet) = v_lines,
        '5 a move changes neither the balance nor the ledger');
    PERFORM pg_temp.ok(pg_temp.pots_ok(v_wallet), '5 the pot invariants hold');
END $$;

SELECT pg_temp.as_user(pg_temp.s('stranger')::uuid);
DO $$
DECLARE
    v_wallet uuid := pg_temp.s('wallet')::uuid;
    v_savings uuid := pg_temp.s('savings')::uuid;
BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM finance.move_pot_funds(v_savings, 1, 'out');
        RAISE EXCEPTION 'PROBE FAIL: 5 a stranger moved money in another person''s pot';
    EXCEPTION WHEN insufficient_privilege THEN
        PERFORM pg_temp.ok(true, '5 a stranger cannot move money in the pot (42501)');
    END;
    BEGIN
        PERFORM finance.save_wallet_pot(v_wallet, NULL, 'general', 'Mine now', 0, NULL);
        RAISE EXCEPTION 'PROBE FAIL: 5 a stranger saved a pot on another person''s wallet';
    EXCEPTION WHEN insufficient_privilege THEN
        PERFORM pg_temp.ok(true, '5 a stranger cannot save a pot on the wallet (42501)');
    END;
    RESET ROLE;
END $$;
SELECT pg_temp.as_user(NULL);
-- #endregion

-- #region 6. A chargeback, then a refund, recover earmarked money newest pot first
DO $$
DECLARE
    v_owner uuid := pg_temp.s('owner')::uuid;
    v_type text := pg_temp.s('type');
    v_wallet uuid := pg_temp.s('wallet')::uuid;
    v_tax uuid := pg_temp.s('tax')::uuid;
    v_savings uuid := pg_temp.s('savings')::uuid;
    v_tx uuid;
BEGIN
    PERFORM finance.fn_wallet_debit(v_owner, v_type, 'GBP', 70001, 'chargeback', 'chargebacks', pg_catalog.gen_random_uuid());
    SELECT t.id INTO v_tx FROM finance.transactions t
     WHERE t.wallet_id = v_wallet AND t.reason = 'chargeback' ORDER BY t.created_at DESC LIMIT 1;
    PERFORM pg_temp.ok(pg_temp.bal(v_wallet) = 30000, '6 a chargeback takes 700.01, earmarked money included');
    PERFORM pg_temp.ok(pg_temp.pot(v_savings) = 0 AND pg_temp.pot(v_tax) = 30000,
        '6 the newest pot (savings) shrinks first, the tax pot keeps 300.00');
    PERFORM pg_temp.ok((SELECT pg_catalog.count(*) FROM finance.pot_movements
                         WHERE pot_id = v_savings AND reason = 'recovery' AND direction = 'out'
                           AND amount_cents = 10000 AND ref_table = 'transactions' AND ref_id = v_tx) = 1,
        '6 the shrink is one recovery movement keyed to the chargeback debit');

    PERFORM finance.fn_wallet_debit(v_owner, v_type, 'GBP', 5000, 'refund', 'inbound_payments', pg_catalog.gen_random_uuid());
    PERFORM pg_temp.ok(pg_temp.bal(v_wallet) = 25000 AND pg_temp.pot(v_tax) = 25000 AND pg_temp.pot(v_savings) = 0,
        '6 a refund recovery then shrinks the next pot');
    PERFORM pg_temp.ok(finance.fn_available_cents(v_wallet) = 0 AND pg_temp.pots_ok(v_wallet),
        '6 Σ pots never exceeds the balance');
    BEGIN
        PERFORM finance.fn_wallet_debit(v_owner, v_type, 'GBP', 1, 'order_payment', 'orders', pg_catalog.gen_random_uuid());
        RAISE EXCEPTION 'PROBE FAIL: 6 a spend reached the earmarked balance';
    EXCEPTION WHEN SQLSTATE 'PF402' THEN
        PERFORM pg_temp.ok(true, '6 with everything earmarked, a checkout payment is refused');
    END;
END $$;
-- #endregion

-- #region 7. Archiving
SELECT pg_temp.as_user(pg_temp.s('owner')::uuid);
DO $$
DECLARE
    v_wallet uuid := pg_temp.s('wallet')::uuid;
    v_tax uuid := pg_temp.s('tax')::uuid;
    v_savings uuid := pg_temp.s('savings')::uuid;
    v_pot jsonb;
BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM finance.save_wallet_pot(v_wallet, v_tax, 'tax', 'Tax set-aside', NULL, NULL, true);
        RAISE EXCEPTION 'PROBE FAIL: 7 a pot holding money was archived';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        PERFORM pg_temp.ok(true, '7 a pot holding money cannot be archived (PC409)');
    END;
    v_pot := finance.save_wallet_pot(v_wallet, v_savings, 'savings', 'Rainy day', NULL, NULL, true);
    PERFORM pg_temp.ok((v_pot ->> 'active')::boolean = false AND v_pot ->> 'archived_at' IS NOT NULL,
        '7 an empty pot is archived, not deleted');
    BEGIN
        PERFORM finance.move_pot_funds(v_savings, 1, 'in');
        RAISE EXCEPTION 'PROBE FAIL: 7 money moved into an archived pot';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        PERFORM pg_temp.ok(true, '7 an archived pot takes no money');
    END;
    BEGIN
        PERFORM finance.save_wallet_pot(v_wallet, v_savings, 'savings', 'Back again', 0, NULL);
        RAISE EXCEPTION 'PROBE FAIL: 7 an archived pot was changed';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        PERFORM pg_temp.ok(true, '7 an archived pot is never changed again');
    END;
    BEGIN
        v_pot := finance.save_wallet_pot(v_wallet, NULL, 'goal', 'Holiday', 7000, NULL);
        PERFORM pg_temp.ok((v_pot ->> 'auto_allocate_bp')::int = 7000,
            '7 an archived pot no longer counts towards Σbp (3000 + 7000)');
        RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'undo';
    EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
    END;
    RESET ROLE;
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM finance.wallet_pots WHERE id = v_savings), '7 the archived pot is kept');
END $$;
SELECT pg_temp.as_user(NULL);
-- #endregion

-- #region 8. Zero-day window; top-ups and non-income reasons
DO $$
DECLARE
    v_owner uuid := pg_temp.s('owner')::uuid;
    v_type text := pg_temp.s('type');
    v_wallet uuid := pg_temp.s('wallet')::uuid;
    v_tax uuid := pg_temp.s('tax')::uuid;
BEGIN
    UPDATE security.platform_params SET value = '0'::jsonb WHERE key = 'pending_release_days';
    PERFORM finance.fn_wallet_credit_pending(v_owner, v_type, 'GBP', 10000, 'product_sale', 'escrows',
        pg_temp.s('escrow')::uuid);
    PERFORM pg_temp.ok(pg_temp.bal(v_wallet) = 35000 AND pg_temp.pot(v_tax) = 28000,
        '8 with no window, an earned credit is Available and earmarked at once (30% of 100.00)');
    PERFORM finance.fn_wallet_credit(v_owner, v_type, 'GBP', 10000, 'topup', 'inbound_payments', pg_catalog.gen_random_uuid());
    PERFORM pg_temp.ok(pg_temp.bal(v_wallet) = 45000 AND pg_temp.pot(v_tax) = 28000, '8 a top-up is never earmarked');
    BEGIN
        PERFORM finance.fn_wallet_credit_pending(v_owner, v_type, 'GBP', 100, 'topup', 'escrows', pg_temp.s('escrow')::uuid);
        RAISE EXCEPTION 'PROBE FAIL: 8 the pending door took a non-income reason';
    EXCEPTION WHEN invalid_parameter_value THEN
        PERFORM pg_temp.ok(true, '8 the pending door refuses a non-income reason (22023)');
    END;
    PERFORM pg_temp.ok(pg_temp.pots_ok(v_wallet), '8 the pot invariants hold');
    UPDATE security.platform_params SET value = '7'::jsonb WHERE key = 'pending_release_days';
END $$;
-- #endregion

-- #region 9. A shared vault: `distribute` saves pots, `spend` does not
DO $$
DECLARE
    v_vault uuid;
    v_spender uuid;
    v_manager uuid;
BEGIN
    SELECT w.id, a.member_user_id, b.member_user_id INTO v_vault, v_spender, v_manager
      FROM finance.wallets w
      JOIN finance.vault_permissions a ON a.wallet_id = w.id
      JOIN finance.vault_permissions b ON b.wallet_id = w.id AND b.member_user_id <> a.member_user_id
     WHERE w.owner_type IN ('team', 'business')
       AND EXISTS (SELECT 1 FROM org.fn_member_seat(w.owner_type, w.owner_id, a.member_user_id))
       AND EXISTS (SELECT 1 FROM org.fn_member_seat(w.owner_type, w.owner_id, b.member_user_id))
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users x WHERE x.user_id IN (a.member_user_id, b.member_user_id))
     ORDER BY w.created_at, w.id, a.member_user_id, b.member_user_id
     LIMIT 1;
    IF v_vault IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: 9 fixture missing: no team or business wallet with two seated members';
    END IF;
    UPDATE finance.vault_permissions SET capabilities = '{spend}' WHERE wallet_id = v_vault AND member_user_id = v_spender;
    UPDATE finance.vault_permissions SET capabilities = '{distribute}' WHERE wallet_id = v_vault AND member_user_id = v_manager;
    PERFORM pg_catalog.set_config('probe.vault', v_vault::text, true);
    PERFORM pg_catalog.set_config('probe.spender', v_spender::text, true);
    PERFORM pg_catalog.set_config('probe.manager', v_manager::text, true);
END $$;

SELECT pg_temp.as_user(pg_temp.s('spender')::uuid);
DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM finance.save_wallet_pot(pg_temp.s('vault')::uuid, NULL, 'savings', 'Vault reserve', 1000, NULL);
        RAISE EXCEPTION 'PROBE FAIL: 9 a spend-only member saved a vault pot';
    EXCEPTION WHEN insufficient_privilege THEN
        PERFORM pg_temp.ok(true, '9 a spend-only member cannot save a vault pot (42501)');
    END;
    RESET ROLE;
END $$;

SELECT pg_temp.as_user(pg_temp.s('manager')::uuid);
DO $$
DECLARE v_pot jsonb;
BEGIN
    SET LOCAL ROLE authenticated;
    v_pot := finance.save_wallet_pot(pg_temp.s('vault')::uuid, NULL, 'savings', 'Vault reserve', 1000, NULL);
    RESET ROLE;
    PERFORM pg_temp.ok((v_pot ->> 'wallet_id')::uuid = pg_temp.s('vault')::uuid,
        '9 a distribute holder saves a vault pot');
END $$;
SELECT pg_temp.as_user(NULL);
-- #endregion

-- #region 10. The pot ledger is append-only and clients cannot write it
DO $$
DECLARE
    v_wallet uuid := pg_temp.s('wallet')::uuid;
    v_tax uuid := pg_temp.s('tax')::uuid;
BEGIN
    BEGIN
        UPDATE finance.pot_movements SET amount_cents = amount_cents + 1 WHERE pot_id = v_tax;
        RAISE EXCEPTION 'PROBE FAIL: 10 a pot movement was rewritten';
    EXCEPTION WHEN SQLSTATE 'PL403' THEN
        PERFORM pg_temp.ok(true, '10 UPDATE refused for every role (PL403)');
    END;
    BEGIN
        DELETE FROM finance.pot_movements WHERE pot_id = v_tax;
        RAISE EXCEPTION 'PROBE FAIL: 10 a pot movement was deleted';
    EXCEPTION WHEN SQLSTATE 'PL403' THEN
        PERFORM pg_temp.ok(true, '10 DELETE refused for every role (PL403)');
    END;
    BEGIN
        UPDATE finance.wallet_pots SET balance_cents = 1, active = false, archived_at = pg_catalog.now()
         WHERE id = pg_temp.s('savings')::uuid;
        RAISE EXCEPTION 'PROBE FAIL: 10 an archived pot was given money';
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.ok(true, '10 an archived pot can hold nothing (ck_wallet_pots_archived_empty)');
    END;
END $$;

SELECT pg_temp.as_user(pg_temp.s('owner')::uuid);
DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
        INSERT INTO finance.pot_movements (pot_id, wallet_id, direction, amount_cents, currency, reason, balance_after_cents)
        VALUES (pg_temp.s('tax')::uuid, pg_temp.s('wallet')::uuid, 'in', 1, 'GBP', 'move_in', 1);
        RAISE EXCEPTION 'PROBE FAIL: 10 a client wrote a pot movement';
    EXCEPTION WHEN insufficient_privilege THEN
        PERFORM pg_temp.ok(true, '10 a client cannot write a pot movement (42501)');
    END;
    PERFORM pg_temp.ok((SELECT pg_catalog.count(*) FROM finance.pot_movements
                         WHERE wallet_id = pg_temp.s('wallet')::uuid) > 0,
        '10 the owner reads their pot movements');
    RESET ROLE;
END $$;
SELECT pg_temp.as_user(pg_temp.s('stranger')::uuid);
DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.ok((SELECT pg_catalog.count(*) FROM finance.pot_movements
                         WHERE wallet_id = pg_temp.s('wallet')::uuid) = 0,
        '10 a stranger reads none of them');
    RESET ROLE;
END $$;
SELECT pg_temp.as_user(NULL);
-- #endregion

-- #region 11. A scheduled payout pays Available minus earmarks (DB4's claim)
DO $$
DECLARE
    v_wallet finance.wallets;
    v_schedule uuid;
BEGIN
    SELECT * INTO v_wallet FROM finance.wallets WHERE id = pg_temp.s('wallet')::uuid;
    PERFORM pg_temp.ok(finance.fn_payout_schedule_available(v_wallet) = 17000
        AND finance.fn_payout_schedule_available(v_wallet) = finance.fn_available_cents(v_wallet.id),
        '11 a payout schedule''s run pays 170.00: the 450.00 balance minus the 280.00 earmarked');
    INSERT INTO finance.payout_schedules (owner_type, owner_id, mode, threshold_cents, currency, created_by)
    VALUES (pg_temp.s('type'), pg_temp.s('owner')::uuid, 'threshold', 20000, 'GBP', pg_temp.s('owner')::uuid)
    RETURNING id INTO v_schedule;
    PERFORM pg_catalog.set_config('probe.schedule', v_schedule::text, true);
    PERFORM pg_temp.ok(NOT EXISTS (
            SELECT 1 FROM pg_catalog.jsonb_array_elements(finance.fn_claim_due_payout_schedules(200)) x
             WHERE x ->> 'schedule_id' = v_schedule::text)
        AND pg_temp.bal(v_wallet.id) = 45000,
        '11 a 200.00 threshold is not met while only 170.00 of the 450.00 is Available: not claimed');
END $$;

SELECT pg_temp.as_user(pg_temp.s('owner')::uuid);
SET LOCAL ROLE authenticated;
SELECT finance.move_pot_funds(pg_temp.s('tax')::uuid, 3001, 'out');
RESET ROLE;
SELECT pg_temp.as_user(NULL);

DO $$
DECLARE
    v_entry jsonb;
BEGIN
    SELECT x INTO v_entry FROM pg_catalog.jsonb_array_elements(finance.fn_claim_due_payout_schedules(200)) x
     WHERE x ->> 'schedule_id' = pg_temp.s('schedule');
    PERFORM pg_temp.ok(v_entry IS NOT NULL AND pg_temp.pot(pg_temp.s('tax')::uuid) = 24999,
        '11 once 200.01 is Available the threshold run is claimed (' || COALESCE(v_entry ->> 'outcome', 'none')
            || '), and the earmarked 249.99 is never paid out');
    PERFORM pg_temp.ok(pg_temp.pots_ok(pg_temp.s('wallet')::uuid), '11 the pot invariants hold after the run');
END $$;
-- #endregion

-- #region 12. The invariants hold across every wallet
DO $$
BEGIN
    PERFORM pg_temp.ok(NOT EXISTS (
            SELECT 1 FROM finance.v_wallet_reconciliation r
             WHERE r.pot_drift_cents <> 0 OR r.earmarked_cents > r.balance_cents),
        '12 no wallet''s pots drift from their movements or earmark more than it holds');
    PERFORM pg_temp.ok(pg_temp.pots_ok(pg_temp.s('wallet')::uuid), '12 the probe wallet''s pot invariants hold');
END $$;
-- #endregion

ROLLBACK;
