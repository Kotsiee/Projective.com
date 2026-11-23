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
-- Seller codes (MARKETPLACE CK2, Decision #485), in this session as each actor's JWT:
--   5. A seller issues a code over their own products (finance.save_promo_code) and lists it
--      (list_own_promo_codes); a stranger cannot issue or list for them, nobody issues a platform code
--      through the door, a listing of another seller is refused as a scope, and a taken code refuses.
--   6. In a mixed basket the seller's code discounts only that seller's line: the preview covers only
--      their product, the other seller's line keeps its whole price and credit, and the seller's
--      commission is taken on the discounted price (the seller funds it).
--   7. A code scoped to one listing discounts that product and not the same seller's other one.
--   8. A platform code (no issuer) is the platform's cost: every line it discounts records
--      `promo_funded_by = 'platform'`, each seller's commission and credit are those of the line before
--      the code, and finance.v_conservation_identity's imbalance does not move.
--   9. The seller archives the code: it stays listed with its archive instant, the preview refuses it,
--      and a stranger cannot archive it.
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

-- Seller codes: the first product's owner is the seller; a second seller's product beside it; a second
-- product of the seller's own, published, for the listing scope. The business's wallet (at least 10,000,
-- §0) pays for every order here: 2,800 in §1–§3 and 6,950 in §6–§8.
DO $$
DECLARE
    v_fx probe_fx;
    v_seller uuid;
    v_other uuid;
    v_other_listing uuid;
    v_second uuid;
    v_second_listing uuid;
    v_suffix text := upper(substr(md5(gen_random_uuid()::text), 1, 6));
BEGIN
    SELECT * INTO v_fx FROM probe_fx;
    SELECT owner_user_id INTO v_seller FROM catalogue.products WHERE id = v_fx.product;
    SELECT p.id, l.id INTO v_other, v_other_listing
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.owner_team_id IS NULL AND p.owner_user_id NOT IN (v_seller, v_fx.buyer)
       AND upper(p.currency) = v_fx.currency
     ORDER BY p.id LIMIT 1;
    IF v_other IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no second seller''s published product in %', v_fx.currency; END IF;
    UPDATE catalogue.products SET price_cents = 2000 WHERE id = v_other;
    INSERT INTO catalogue.products (owner_user_id, title, price_cents, currency)
    VALUES (v_seller, 'Probe CK2 second product', 500, v_fx.currency) RETURNING id INTO v_second;
    INSERT INTO catalogue.listings (owner_user_id, kind, status, product_id, title, currency, published_at)
    VALUES (v_seller, 'product', 'published', v_second, 'Probe CK2 second product', v_fx.currency, now())
    RETURNING id INTO v_second_listing;
    PERFORM set_config('probe.seller', v_seller::text, false);
    PERFORM set_config('probe.other', v_other::text, false);
    PERFORM set_config('probe.other_listing', v_other_listing::text, false);
    PERFORM set_config('probe.second', v_second::text, false);
    PERFORM set_config('probe.second_listing', v_second_listing::text, false);
    PERFORM set_config('probe.seller_code', 'PROBESELL' || v_suffix, false);
    PERFORM set_config('probe.scoped_code', 'PROBESCOPE' || v_suffix, false);
    PERFORM set_config('probe.platform_code', 'PROBEPLAT' || v_suffix, false);
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

-- Seller codes run in this session, as each actor's JWT (transaction-local, so one DO block each).
CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims',
        CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
    EXECUTE q INTO r;
    RETURN 'ok ' || COALESCE(r, '');
EXCEPTION WHEN OTHERS THEN
    RETURN 'refused ' || SQLSTATE || ' ' || SQLERRM;
END $$;

-- A business basket carrying a code, and a product line at its catalogue price.
CREATE FUNCTION pg_temp.basket(p_promo text) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO finance.baskets (owner_type, owner_id, name, promo_code)
    VALUES ('business', (SELECT biz FROM probe_fx), 'Probe CK2 ' || gen_random_uuid(), p_promo) RETURNING id;
$$;

CREATE FUNCTION pg_temp.product_line(p_basket uuid, p_product uuid, p_position integer) RETURNS uuid
LANGUAGE sql AS $$
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency,
                                      destination_email, position)
    SELECT p_basket, 'digital_product', p.id, 'Probe product', p.price_cents, upper(p.currency),
           'probe@example.com', p_position
      FROM catalogue.products p WHERE p.id = p_product
    RETURNING id;
$$;

-- Pay for every line of a basket as the business owner, at the basket's prices; the order id.
CREATE FUNCTION pg_temp.pay(p_basket uuid, p_promo text, p_expected bigint) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_ids uuid[];
    v_units jsonb;
    v_out jsonb;
BEGIN
    SELECT array_agg(bi.id ORDER BY bi.position), jsonb_object_agg(bi.id::text, bi.unit_price_minor)
      INTO v_ids, v_units
      FROM finance.basket_items bi WHERE bi.basket_id = p_basket;
    PERFORM pg_temp.act((SELECT buyer FROM probe_fx));
    v_out := finance.place_wallet_order(p_basket, v_ids, (SELECT currency FROM probe_fx), v_units, p_promo,
        'probe-ck2-' || gen_random_uuid(), p_expected);
    PERFORM pg_temp.act(NULL);
    RETURN (v_out ->> 'order_id')::uuid;
END $$;

CREATE FUNCTION pg_temp.line_of(p_order uuid, p_item uuid) RETURNS finance.order_lines LANGUAGE sql AS $$
    SELECT * FROM finance.order_lines WHERE order_id = p_order AND item_id = p_item;
$$;

-- What one order credited one seller (pending, Decision #191).
CREATE FUNCTION pg_temp.credited(p_order uuid, p_owner uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE(sum(pr.amount_cents), 0)::bigint FROM finance.pending_releases pr
      JOIN finance.wallets w ON w.id = pr.wallet_id
     WHERE pr.order_id = p_order AND pr.reason = 'product_sale' AND w.owner_id = p_owner;
$$;

CREATE FUNCTION pg_temp.imbalance() RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE(sum(c.imbalance_minor), 0)::bigint FROM finance.v_conservation_identity c
     WHERE c.currency = (SELECT currency FROM probe_fx);
$$;
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

-- #region 5. A seller issues and lists a code; nobody else issues it, and no one a platform code
DO $$
DECLARE
    v_seller uuid := current_setting('probe.seller')::uuid;
    v_code text := current_setting('probe.seller_code');
    v_issue text := 'SELECT finance.save_promo_code(%L, %L::uuid, %L, %L, %L, %s)::text';
    v_out text;
    v_platform text;
    v_foreign text;
    v_taken text;
    v_list text;
    v_stranger text;
    v_peek text;
    v_row finance.promo_codes;
BEGIN
    PERFORM pg_temp.act(v_seller);
    v_out := pg_temp.try(format(v_issue, 'user', v_seller, lower(v_code), 'Probe seller 20% off', 'percent', 2000));
    v_platform := pg_temp.try(format(v_issue, NULL, NULL, v_code || 'P', 'Probe platform', 'percent', 1000));
    v_foreign := pg_temp.try(format(
        'SELECT finance.save_promo_code(%L, %L::uuid, %L, %L, %L, 1000, p_listing_ids => ARRAY[%L]::uuid[])::text',
        'user', v_seller, v_code || 'F', 'Probe foreign scope', 'percent', current_setting('probe.other_listing')));
    v_taken := pg_temp.try(format(v_issue, 'user', v_seller, v_code, 'Probe again', 'percent', 500));
    v_list := pg_temp.try(format('SELECT finance.list_own_promo_codes(%L, %L::uuid)::text', 'user', v_seller));
    PERFORM pg_temp.act((SELECT buyer FROM probe_fx));
    v_stranger := pg_temp.try(format(v_issue, 'user', v_seller, v_code || 'S', 'Probe stranger', 'percent', 1000));
    v_peek := pg_temp.try(format('SELECT finance.list_own_promo_codes(%L, %L::uuid)::text', 'user', v_seller));
    PERFORM pg_temp.act(NULL);
    SELECT * INTO v_row FROM finance.promo_codes WHERE code = v_code;
    PERFORM set_config('probe.seller_code_id', COALESCE(v_row.id::text, ''), false);
    PERFORM pg_temp.probe_record('5 a seller issues and lists their own code',
        v_out LIKE 'ok %' AND to_jsonb(v_row) ->> 'issuer_type' = 'user'
        AND (to_jsonb(v_row) ->> 'issuer_id')::uuid = v_seller
        AND v_list LIKE 'ok %' AND substr(v_list, 4)::jsonb @> jsonb_build_array(
            jsonb_build_object('code', v_code, 'redemption_count', 0, 'max_redemptions_per_account', 1)),
        format('issue %s; list %s', left(v_out, 120), left(v_list, 160)));
    PERFORM pg_temp.probe_record('5 nobody else issues it, nor a platform code',
        v_stranger LIKE 'refused 42501%' AND v_peek LIKE 'refused 42501%' AND v_platform LIKE 'refused 42501%'
        AND v_foreign LIKE 'refused 22023%' AND v_taken LIKE 'refused PC409 promo_code_taken:%',
        format('stranger %s; stranger list %s; platform %s; foreign scope %s; taken %s', left(v_stranger, 70),
               left(v_peek, 70), left(v_platform, 70), left(v_foreign, 90), left(v_taken, 90)));
END $$;
-- #endregion

-- #region 6. A mixed basket: the seller's code discounts only the seller's line
-- 20% of 1,000 is 200 on the seller's line; the other seller's 2,000 is untouched. The seller funds the
-- code: their commission is on the 800 paid, and they are credited 800 less it.
DO $$
DECLARE
    v_fx probe_fx;
    v_seller uuid := current_setting('probe.seller')::uuid;
    v_code text := current_setting('probe.seller_code');
    v_other uuid := current_setting('probe.other')::uuid;
    v_other_seller uuid;
    v_basket uuid;
    v_order uuid;
    v_preview jsonb;
    v_a finance.order_lines;
    v_b finance.order_lines;
BEGIN
    SELECT * INTO v_fx FROM probe_fx;
    SELECT owner_user_id INTO v_other_seller FROM catalogue.products WHERE id = v_other;
    v_basket := pg_temp.basket(v_code);
    PERFORM pg_temp.product_line(v_basket, v_fx.product, 0);
    PERFORM pg_temp.product_line(v_basket, v_other, 1);
    PERFORM pg_temp.act(v_fx.buyer);
    EXECUTE 'SELECT finance.resolve_promo_code($1, $2, $3, $4)'
       INTO v_preview USING v_code, 'business', v_fx.biz, ARRAY[v_fx.product, v_other];
    PERFORM pg_temp.act(NULL);
    v_order := pg_temp.pay(v_basket, v_code, 2800);
    v_a := pg_temp.line_of(v_order, v_fx.product);
    v_b := pg_temp.line_of(v_order, v_other);
    PERFORM pg_temp.probe_record('6 the preview covers only the seller''s product',
        (v_preview ->> 'valid')::boolean AND v_preview -> 'covers' = jsonb_build_array(v_fx.product),
        format('preview %s', v_preview));
    PERFORM pg_temp.probe_record('6 the seller''s code discounts only the seller''s line',
        v_a.promo_discount_minor = 200 AND v_b.promo_discount_minor = 0
        AND to_jsonb(v_a) ->> 'promo_funded_by' = 'seller' AND to_jsonb(v_b) ->> 'promo_funded_by' IS NULL
        AND (SELECT promo_discount_minor FROM finance.orders WHERE id = v_order) = 200,
        format('seller line %s off (%s), other line %s off', v_a.promo_discount_minor,
               to_jsonb(v_a) ->> 'promo_funded_by', v_b.promo_discount_minor));
    PERFORM pg_temp.probe_record('6 the seller''s commission is on the discounted price',
        v_a.platform_fee_minor = (800 * v_a.platform_fee_bp) / 10000
        AND pg_temp.credited(v_order, v_seller) = 800 - v_a.platform_fee_minor
        AND v_b.platform_fee_minor = (2000 * v_b.platform_fee_bp) / 10000
        AND pg_temp.credited(v_order, v_other_seller) = 2000 - v_b.platform_fee_minor,
        format('seller fee %s at %s bp, credited %s; other fee %s at %s bp, credited %s',
               v_a.platform_fee_minor, v_a.platform_fee_bp, pg_temp.credited(v_order, v_seller),
               v_b.platform_fee_minor, v_b.platform_fee_bp, pg_temp.credited(v_order, v_other_seller)));
EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.probe_record('6 a mixed basket', false, SQLSTATE || ' ' || SQLERRM);
END $$;
-- #endregion

-- #region 7. A code scoped to one listing discounts that product only
DO $$
DECLARE
    v_fx probe_fx;
    v_seller uuid := current_setting('probe.seller')::uuid;
    v_code text := current_setting('probe.scoped_code');
    v_second uuid := current_setting('probe.second')::uuid;
    v_out text;
    v_basket uuid;
    v_order uuid;
BEGIN
    SELECT * INTO v_fx FROM probe_fx;
    PERFORM pg_temp.act(v_seller);
    v_out := pg_temp.try(format(
        'SELECT finance.save_promo_code(%L, %L::uuid, %L, %L, %L, 1000, p_listing_ids => ARRAY[%L]::uuid[])::text',
        'user', v_seller, v_code, 'Probe scoped 10% off', 'percent', current_setting('probe.second_listing')));
    PERFORM pg_temp.act(NULL);
    v_basket := pg_temp.basket(v_code);
    PERFORM pg_temp.product_line(v_basket, v_fx.product, 0);
    PERFORM pg_temp.product_line(v_basket, v_second, 1);
    v_order := pg_temp.pay(v_basket, v_code, 1450);
    PERFORM pg_temp.probe_record('7 a listing-scoped code discounts that listing only',
        v_out LIKE 'ok %' AND (pg_temp.line_of(v_order, v_fx.product)).promo_discount_minor = 0
        AND (pg_temp.line_of(v_order, v_second)).promo_discount_minor = 50,
        format('issue %s; in-scope line %s off, other line %s off', left(v_out, 60),
               (pg_temp.line_of(v_order, v_second)).promo_discount_minor,
               (pg_temp.line_of(v_order, v_fx.product)).promo_discount_minor));
EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.probe_record('7 a listing-scoped code', false, SQLSTATE || ' ' || SQLERRM);
END $$;
-- #endregion

-- #region 8. A platform code is the platform's cost
-- 10% of 3,000 is 300, shared 100 and 200. Each seller is credited as if no code applied: commission
-- on 1,000 and 2,000. The 300 is the platform's, a conservation term, so the identity does not move.
DO $$
DECLARE
    v_fx probe_fx;
    v_seller uuid := current_setting('probe.seller')::uuid;
    v_code text := current_setting('probe.platform_code');
    v_other uuid := current_setting('probe.other')::uuid;
    v_other_seller uuid;
    v_before bigint;
    v_basket uuid;
    v_order uuid;
    v_a finance.order_lines;
    v_b finance.order_lines;
BEGIN
    SELECT * INTO v_fx FROM probe_fx;
    SELECT owner_user_id INTO v_other_seller FROM catalogue.products WHERE id = v_other;
    INSERT INTO finance.promo_codes (code, label, kind, value_bp) VALUES (v_code, 'Probe platform 10% off', 'percent', 1000);
    v_basket := pg_temp.basket(v_code);
    PERFORM pg_temp.product_line(v_basket, v_fx.product, 0);
    PERFORM pg_temp.product_line(v_basket, v_other, 1);
    v_before := pg_temp.imbalance();
    v_order := pg_temp.pay(v_basket, v_code, 2700);
    v_a := pg_temp.line_of(v_order, v_fx.product);
    v_b := pg_temp.line_of(v_order, v_other);
    PERFORM pg_temp.probe_record('8 the lines record the platform as the funder',
        v_a.promo_discount_minor = 100 AND v_b.promo_discount_minor = 200
        AND to_jsonb(v_a) ->> 'promo_funded_by' = 'platform' AND to_jsonb(v_b) ->> 'promo_funded_by' = 'platform',
        format('shares %s + %s, funded by %s / %s', v_a.promo_discount_minor, v_b.promo_discount_minor,
               to_jsonb(v_a) ->> 'promo_funded_by', to_jsonb(v_b) ->> 'promo_funded_by'));
    PERFORM pg_temp.probe_record('8 each seller is credited as if the code had not applied',
        v_a.platform_fee_minor = (1000 * v_a.platform_fee_bp) / 10000
        AND pg_temp.credited(v_order, v_seller) = 1000 - v_a.platform_fee_minor
        AND v_b.platform_fee_minor = (2000 * v_b.platform_fee_bp) / 10000
        AND pg_temp.credited(v_order, v_other_seller) = 2000 - v_b.platform_fee_minor,
        format('fees %s / %s, credited %s / %s', v_a.platform_fee_minor, v_b.platform_fee_minor,
               pg_temp.credited(v_order, v_seller), pg_temp.credited(v_order, v_other_seller)));
    PERFORM pg_temp.probe_record('8 the conservation identity holds across the order',
        pg_temp.imbalance() = v_before,
        format('imbalance %s before, %s after', v_before, pg_temp.imbalance()));
EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.probe_record('8 a platform code', false, SQLSTATE || ' ' || SQLERRM);
END $$;
-- #endregion

-- #region 9. The seller archives the code
DO $$
DECLARE
    v_seller uuid := current_setting('probe.seller')::uuid;
    v_code text := current_setting('probe.seller_code');
    v_id text := current_setting('probe.seller_code_id');
    v_stranger text;
    v_out text;
    v_again text;
    v_list text;
    v_preview jsonb;
BEGIN
    PERFORM pg_temp.act((SELECT buyer FROM probe_fx));
    v_stranger := pg_temp.try(format('SELECT finance.archive_promo_code(%L::uuid)::text', v_id));
    v_preview := finance.resolve_promo_code(v_code);
    PERFORM pg_temp.act(v_seller);
    v_out := pg_temp.try(format('SELECT finance.archive_promo_code(%L::uuid)::text', v_id));
    v_again := pg_temp.try(format('SELECT finance.archive_promo_code(%L::uuid)::text', v_id));
    v_list := pg_temp.try(format('SELECT finance.list_own_promo_codes(%L, %L::uuid)::text', 'user', v_seller));
    PERFORM pg_temp.act((SELECT buyer FROM probe_fx));
    v_preview := finance.resolve_promo_code(v_code);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.probe_record('9 the seller archives it; the preview refuses it; a stranger cannot',
        v_stranger LIKE 'refused P0002%' AND v_out LIKE 'ok %' AND v_again LIKE 'ok %'
        AND (SELECT deactivated_at FROM finance.promo_codes WHERE code = v_code) IS NOT NULL
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(substr(v_list, 4)::jsonb) e
                     WHERE e ->> 'code' = v_code AND e ->> 'deactivated_at' IS NOT NULL
                       AND (e ->> 'redemption_count')::int = 1)
        AND NOT (v_preview ->> 'valid')::boolean AND v_preview ->> 'reason' = 'This code is no longer active.',
        format('stranger %s; archive %s; again %s; preview %s', left(v_stranger, 70), left(v_out, 60),
               left(v_again, 40), v_preview ->> 'reason'));
EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.probe_record('9 archive', false, SQLSTATE || ' ' || SQLERRM);
END $$;
-- #endregion

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_results WHERE verdict = 'FAIL') THEN
        RAISE EXCEPTION 'FAIL %', (SELECT string_agg(scenario || ': ' || detail, E'\n     ') FROM probe_results WHERE verdict = 'FAIL');
    END IF;
END $$;
