-- =============================================================================================
-- Probe: a capped promo code, one account's redemptions and an attempt key under concurrency
-- (finance.place_wallet_order, finance.resolve_promo_code; FINANCE_BUILD_PROMPTS DB7 and DB19, audit
-- CO6 / CO11 / CO13).
--
-- Two real sessions (dblink 'a' and 'b'). A runs first and keeps its transaction open; B is sent and
-- the probe waits until B is blocked on one of A's locks; A commits; B finishes and commits.
--   1. Two baskets, one code with max_redemptions = 1 and no per-account limit: A's order redeems it;
--      B, blocked on the code's row lock, then refuses PC409 `promo_exhausted:`. Exactly one order
--      carries the code and its redemption_count is 1.
--   2. One basket, one attempt key, twice: B, blocked on the basket lock, replays A's order
--      (`"replayed": true`) instead of refusing on lines A already consumed. One order exists.
--   3. One account, two baskets, one uncapped code allowing one use per account (the default): A's
--      order redeems it; B, blocked on the code's row lock, then refuses PC409 `promo_already_used:`.
--      The preview (resolve_promo_code with the account) now refuses the code to that account, and
--      still offers it to the buyer's personal account and to a caller who names no account.
--   4. Another account (the buyer's personal one) redeems the same code: two accounts, two orders,
--      redemption_count 2.
--
-- COMMITS. A race needs both sessions to commit, so this probe cannot run inside a rolled-back
-- transaction. It refuses the shared dev database `postgres`; run it against a disposable copy:
--   docker exec supabase_db_Projective sh -c "psql -U postgres -c 'DROP DATABASE IF EXISTS promo_probe' \
--     -c 'CREATE DATABASE promo_probe' && pg_dump -U postgres -d postgres --no-owner --no-acl \
--     | psql -U postgres -d promo_probe -q >/dev/null 2>&1"
--   docker exec -i supabase_db_Projective psql -U supabase_admin -d promo_probe -v ON_ERROR_STOP=1 \
--     < supabase/probes/promo_redemption_concurrency.sql
--   docker exec supabase_db_Projective psql -U postgres -c 'DROP DATABASE promo_probe'
-- `supabase_admin`, not `postgres`: only a superuser may open a passwordless dblink session.
-- The sessions keep that superuser role and act as the buyer through the JWT claims only: the copy is
-- dumped without ACLs, and what is raced here is the doors' locks, not their grants.
--
-- Fixture (seeded): as checkout_charge_assert.sql — a KYB-verified business with a funded wallet, its
-- owner buying a published single-owner product repriced to 1,000. A clean run prints only PASS
-- notices; any FAIL ends the run in an error.
-- =============================================================================================

-- #region 0. Guard, extension, fixture
DO $$
BEGIN
    IF current_database() = 'postgres' AND current_setting('probe.allow_commit', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'promo_redemption_concurrency COMMITS — run it against a disposable copy (see header), not the shared dev DB';
    END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET search_path = public, extensions;

CREATE TEMP TABLE probe_fx (biz uuid, buyer uuid, currency text, product uuid, l1 uuid, l2 uuid, l3 uuid,
                            l4 uuid, l5 uuid, l6 uuid);
CREATE TEMP TABLE probe_results (scenario text, verdict text, detail text);

DO $$
DECLARE
    v_biz uuid;
    v_buyer uuid;
    v_currency text;
    v_wallet uuid;
    v_product uuid;
    v_code text := 'PROBERACE' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    v_once text := 'PROBEONCE' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    v_l uuid[] := '{}';
    v_basket uuid;
    v_one uuid;
    i int;
BEGIN
    SELECT b.id, b.owner_user_id, w.currency, w.id INTO v_biz, v_buyer, v_currency, v_wallet
      FROM org.business_profiles b
      JOIN finance.wallets w ON w.owner_type = 'business' AND w.owner_id = b.id AND w.balance_cents >= 10000
     WHERE b.kyb_status = 'verified' AND b.owner_user_id IS NOT NULL
     ORDER BY b.id LIMIT 1;
    IF v_biz IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no verified business with a funded wallet — run deno task db:reset'; END IF;
    SELECT p.id INTO v_product
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.owner_team_id IS NULL AND p.owner_user_id <> v_buyer AND upper(p.currency) = v_currency
     ORDER BY p.id LIMIT 1;
    IF v_product IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no published single-owner product in %', v_currency; END IF;
    UPDATE catalogue.products SET price_cents = 1000 WHERE id = v_product;
    UPDATE finance.wallets SET approval_threshold_cents = NULL WHERE id = v_wallet;
    UPDATE security.platform_params SET value = '{"default": 0}'::jsonb WHERE key = 'vault_approval_threshold_cents';
    INSERT INTO finance.promo_codes (code, label, kind, value_bp, max_redemptions, max_redemptions_per_account)
    VALUES (v_code, 'Probe race 10% off', 'percent', 1000, 1, NULL);
    -- Uncapped, one use per account (the column's default).
    INSERT INTO finance.promo_codes (code, label, kind, value_bp)
    VALUES (v_once, 'Probe once 10% off', 'percent', 1000);
    -- The buyer's personal account is the second account of scenario 4.
    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_buyer), v_buyer, v_currency);
    PERFORM finance.fn_wallet_credit(v_buyer, finance.fn_person_wallet_type(v_buyer), v_currency, 10000,
        'topup', 'inbound_payments', gen_random_uuid());
    -- Baskets 1 and 2 carry the race code; basket 3 is the same-key race; baskets 4 and 5 (the business)
    -- and 6 (the buyer's personal account) carry the once-per-account code.
    FOR i IN 1..6 LOOP
        INSERT INTO finance.baskets (owner_type, owner_id, name, promo_code)
        VALUES (CASE WHEN i = 6 THEN finance.fn_person_wallet_type(v_buyer) ELSE 'business' END,
                CASE WHEN i = 6 THEN v_buyer ELSE v_biz END, 'Probe race ' || i,
                CASE WHEN i < 3 THEN v_code WHEN i > 3 THEN v_once END) RETURNING id INTO v_basket;
        INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, destination_email)
        VALUES (v_basket, 'digital_product', v_product, 'Probe product', 1000, v_currency, 'probe@example.com')
        RETURNING id INTO v_one;
        v_l := v_l || v_one;
    END LOOP;
    INSERT INTO probe_fx VALUES (v_biz, v_buyer, v_currency, v_product, v_l[1], v_l[2], v_l[3], v_l[4], v_l[5], v_l[6]);
    PERFORM set_config('probe.code', v_code, false);
    PERFORM set_config('probe.once', v_once, false);
END $$;
-- #endregion

-- #region Harness
CREATE FUNCTION pg_temp.order_sql(p_line uuid, p_promo text, p_key text, p_expected bigint) RETURNS text
LANGUAGE sql AS $$
    SELECT format(
        'SELECT finance.place_wallet_order(%L::uuid, ARRAY[%L]::uuid[], %L, %L::jsonb, %L, %L, %s)::text',
        (SELECT basket_id FROM finance.basket_items WHERE id = p_line), p_line, (SELECT currency FROM probe_fx),
        jsonb_build_object(p_line::text, 1000), p_promo, p_key, p_expected);
$$;

CREATE FUNCTION pg_temp.probe_open(p_conn text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM dblink_connect(p_conn, 'dbname=' || current_database());
    PERFORM dblink_exec(p_conn, $q$
        CREATE FUNCTION pg_temp.try_sql(q text) RETURNS text LANGUAGE plpgsql AS $f$
        DECLARE r text;
        BEGIN
            EXECUTE q INTO r;
            RETURN 'ok ' || COALESCE(r, '');
        EXCEPTION WHEN OTHERS THEN
            RETURN 'refused ' || SQLSTATE || ' ' || SQLERRM;
        END $f$
    $q$);
    PERFORM dblink_exec(p_conn, format('SET request.jwt.claims = %L',
        json_build_object('sub', (SELECT buyer FROM probe_fx), 'role', 'authenticated')::text));
    PERFORM dblink_exec(p_conn, 'BEGIN');
END $$;

CREATE FUNCTION pg_temp.probe_close() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
    FOREACH c IN ARRAY ARRAY['a', 'b'] LOOP
        IF c = ANY (COALESCE(dblink_get_connections(), '{}')) THEN
            PERFORM dblink_disconnect(c);
        END IF;
    END LOOP;
END $$;

-- A runs p_a and keeps its transaction open; B is sent p_b and must block on A; A commits; B completes
-- and commits. Returns A's and B's answers and whether B blocked.
CREATE FUNCTION pg_temp.probe_race(p_a text, p_b text, OUT ra text, OUT rb text, OUT blocked boolean)
LANGUAGE plpgsql AS $$
DECLARE
    v_pid int;
    v_tries int := 0;
BEGIN
    PERFORM pg_temp.probe_open('a');
    PERFORM pg_temp.probe_open('b');
    SELECT r INTO ra FROM dblink('a', format('SELECT pg_temp.try_sql(%L)', p_a)) AS t(r text);
    SELECT p INTO v_pid FROM dblink('b', 'SELECT pg_backend_pid()') AS t(p int);
    PERFORM dblink_send_query('b', format('SELECT pg_temp.try_sql(%L)', p_b));
    LOOP
        blocked := cardinality(pg_blocking_pids(v_pid)) > 0;
        EXIT WHEN blocked OR dblink_is_busy('b') = 0 OR v_tries >= 200;
        v_tries := v_tries + 1;
        PERFORM pg_sleep(0.05);
    END LOOP;
    PERFORM dblink_exec('a', 'COMMIT');
    SELECT r INTO rb FROM dblink_get_result('b') AS t(r text);
    PERFORM * FROM dblink_get_result('b') AS t(r text);
    PERFORM dblink_exec('b', 'COMMIT');
    PERFORM pg_temp.probe_close();
EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.probe_close();
    RAISE;
END $$;

CREATE FUNCTION pg_temp.probe_record(p_scenario text, p_ok boolean, p_detail text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO probe_results VALUES (p_scenario, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_detail);
    RAISE NOTICE '% %: %', CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_scenario, p_detail;
END $$;
-- #endregion

-- #region 1. Two orders race for the last redemption
DO $$
DECLARE
    v_code text := current_setting('probe.code');
    r record;
    v_orders int;
    v_count int;
BEGIN
    SELECT * INTO r FROM pg_temp.probe_race(
        pg_temp.order_sql((SELECT l1 FROM probe_fx), v_code, 'probe-race-promo-a-' || v_code, 900),
        pg_temp.order_sql((SELECT l2 FROM probe_fx), v_code, 'probe-race-promo-b-' || v_code, 900));
    SELECT count(*) INTO v_orders FROM finance.orders WHERE promo_code = v_code;
    SELECT redemption_count INTO v_count FROM finance.promo_codes WHERE code = v_code;
    PERFORM pg_temp.probe_record('1 last redemption',
        r.ra LIKE 'ok %' AND r.rb LIKE 'refused PC409 promo_exhausted:%' AND v_orders = 1 AND v_count = 1,
        format('A=%s; B (%s) %s; %s order(s) carry the code, redemption_count %s',
               left(r.ra, 60), CASE WHEN r.blocked THEN 'blocked on A' ELSE 'never blocked' END,
               left(r.rb, 90), v_orders, v_count));
END $$;
-- #endregion

-- #region 2. One attempt key, twice at once
DO $$
DECLARE
    v_key text := 'probe-race-key-' || current_setting('probe.code');
    v_sql text := pg_temp.order_sql((SELECT l3 FROM probe_fx), NULL, v_key, 1000);
    r record;
    v_orders int;
BEGIN
    SELECT * INTO r FROM pg_temp.probe_race(v_sql, v_sql);
    SELECT count(*) INTO v_orders FROM finance.orders WHERE idempotency_key = v_key;
    PERFORM pg_temp.probe_record('2 same key replays',
        r.ra LIKE 'ok %' AND r.rb LIKE 'ok %' AND (substr(r.rb, 4)::jsonb ->> 'replayed')::boolean AND v_orders = 1,
        format('A=%s; B (%s) %s; %s order(s)', left(r.ra, 60),
               CASE WHEN r.blocked THEN 'blocked on A' ELSE 'never blocked' END, left(r.rb, 160), v_orders));
END $$;
-- #endregion

-- #region 3. One account races itself for a once-per-account code
DO $$
DECLARE
    v_once text := current_setting('probe.once');
    r record;
    v_orders int;
    v_preview jsonb;
    v_personal jsonb;
    v_unnamed jsonb;
BEGIN
    SELECT * INTO r FROM pg_temp.probe_race(
        pg_temp.order_sql((SELECT l4 FROM probe_fx), v_once, 'probe-once-a-' || v_once, 900),
        pg_temp.order_sql((SELECT l5 FROM probe_fx), v_once, 'probe-once-b-' || v_once, 900));
    SELECT count(*) INTO v_orders FROM finance.orders
     WHERE promo_code = v_once AND owner_type = 'business' AND owner_id = (SELECT biz FROM probe_fx);
    PERFORM pg_temp.probe_record('3 one use per account at commit',
        r.ra LIKE 'ok %' AND r.rb LIKE 'refused PC409 promo_already_used:%' AND v_orders = 1,
        format('A=%s; B (%s) %s; the account has %s order(s) with the code', left(r.ra, 60),
               CASE WHEN r.blocked THEN 'blocked on A' ELSE 'never blocked' END, left(r.rb, 90), v_orders));

    -- The preview, as the buyer: refused for the business that used it, offered elsewhere.
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', (SELECT buyer FROM probe_fx), 'role', 'authenticated')::text, true);
    v_preview := finance.resolve_promo_code(v_once, 'business', (SELECT biz FROM probe_fx));
    v_personal := finance.resolve_promo_code(v_once, finance.fn_person_wallet_type((SELECT buyer FROM probe_fx)),
        (SELECT buyer FROM probe_fx));
    v_unnamed := finance.resolve_promo_code(v_once);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM pg_temp.probe_record('3 one use per account at preview',
        NOT (v_preview ->> 'valid')::boolean AND v_preview ->> 'reason' = 'You''ve already used this code.'
        AND (v_personal ->> 'valid')::boolean AND (v_unnamed ->> 'valid')::boolean,
        format('business %s; personal %s; no account %s', v_preview, v_personal ->> 'valid', v_unnamed ->> 'valid'));
END $$;
-- #endregion

-- #region 4. Another account redeems the same code
DO $$
DECLARE
    v_once text := current_setting('probe.once');
    v_out text;
    v_count int;
    v_accounts int;
BEGIN
    PERFORM dblink_connect('c', 'dbname=' || current_database());
    PERFORM dblink_exec('c', format('SET request.jwt.claims = %L',
        json_build_object('sub', (SELECT buyer FROM probe_fx), 'role', 'authenticated')::text));
    SELECT r INTO v_out FROM dblink('c',
        pg_temp.order_sql((SELECT l6 FROM probe_fx), v_once, 'probe-once-c-' || v_once, 900)) AS t(r text);
    PERFORM dblink_disconnect('c');
    SELECT redemption_count INTO v_count FROM finance.promo_codes WHERE code = v_once;
    SELECT count(DISTINCT (owner_type, owner_id)) INTO v_accounts FROM finance.orders WHERE promo_code = v_once;
    PERFORM pg_temp.probe_record('4 two accounts both redeem',
        v_out IS NOT NULL AND v_count = 2 AND v_accounts = 2,
        format('personal order %s; redemption_count %s across %s accounts', left(v_out, 80), v_count, v_accounts));
EXCEPTION WHEN OTHERS THEN
    IF 'c' = ANY (COALESCE(dblink_get_connections(), '{}')) THEN PERFORM dblink_disconnect('c'); END IF;
    PERFORM pg_temp.probe_record('4 two accounts both redeem', false, SQLSTATE || ' ' || SQLERRM);
END $$;
-- #endregion

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_results WHERE verdict = 'FAIL') THEN
        RAISE EXCEPTION 'FAIL %', (SELECT string_agg(scenario || ': ' || detail, E'\n     ') FROM probe_results WHERE verdict = 'FAIL');
    END IF;
END $$;
