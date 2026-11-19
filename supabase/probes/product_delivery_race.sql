-- product_delivery_race.sql — two checkouts of one product at once each write exactly their own
-- entitlement (MARKETPLACE CK1, Decision #488; ASSET_DELIVERY_ARCHITECTURE.md §10 "Money path").
--
--   A. The same attempt twice (one basket, one idempotency key, two sessions): session A pays and
--      holds the basket lock; session B, sent at the same moment, waits on it, then replays A's order.
--      One order, one product line, one entitlement.
--   B. Two buyers paying for the same product at the same moment, each from their own basket: both
--      orders land, each line with its own entitlement and slug, both on the same frozen version, and
--      neither session deadlocks on the seller's wallet they both credit.
--
-- Both sessions must commit for the second to see the first, so the fixture and the races COMMIT:
-- the file refuses to start without `-v disposable=1`. Run it only against a database about to be
-- reset, as `deno task test:probes:fresh` does:
--   docker exec -i supabase_db_Projective psql -U supabase_admin -d postgres -X -q -v disposable=1 \
--     < supabase/probes/product_delivery_race.sql
-- `supabase_admin`: only a superuser may open a passwordless dblink session. The buyers pay from
-- wallet balances the seed already funded, so the races move money only through the purchase door
-- and finance.v_conservation_identity is left balanced.
\set ON_ERROR_STOP on
\set QUIET on
\if :{?disposable}
\else
\echo 'product_delivery_race.sql commits its checkout races; rerun with -v disposable=1 against a throwaway database.'
\quit
\endif

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- Open a dblink session acting as one person.
CREATE FUNCTION pg_temp.session_as(p_name text, p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM extensions.dblink_connect(p_name, 'dbname=' || current_database());
    PERFORM * FROM extensions.dblink(p_name, format(
        'SELECT set_config(%L, %L, false), set_config(%L, %L, false)',
        'request.jwt.claim.sub', p_uid::text,
        'request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text)) AS t (a text, b text);
END $$;

-- The SQL one session runs to pay for one basket line.
CREATE FUNCTION pg_temp.pay_sql(p_line uuid, p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT format(
        'SELECT finance.place_wallet_order(%L::uuid, ARRAY[%L::uuid], ''USD'', %L::jsonb, NULL, %L, %s)::text',
        bi.basket_id, bi.id, jsonb_build_object(bi.id::text, p.price_cents), p_key, p.price_cents)
      FROM finance.basket_items bi
      JOIN catalogue.products p ON p.id = bi.item_id
     WHERE bi.id = p_line;
$$;

-- #region Fixture (COMMITS): a product with a frozen version, two funded buyers, three baskets
CREATE TEMP TABLE probe_race (k text PRIMARY KEY, v text NOT NULL);
DO $$
DECLARE
    v_product record;
    v_one uuid;
    v_two uuid;
    v_file uuid;
    v_version uuid;
    v_line uuid;
    v_basket uuid;
    v_buyer uuid;
    v_n integer := 0;
BEGIN
    SELECT p.id, p.owner_user_id, p.price_cents INTO v_product
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.currency = 'USD' AND p.price_cents > 0 AND p.owner_team_id IS NULL
     ORDER BY p.price_cents, p.id LIMIT 1;
    PERFORM pg_temp.ok(v_product.id IS NOT NULL, 'fixture: a published USD product sold by a person');

    -- Two adults with a seeded USD balance for two purchases, neither the seller.
    SELECT w.owner_id INTO v_one FROM finance.wallets w
     WHERE w.currency = 'USD' AND w.owner_id <> v_product.owner_user_id
       AND w.owner_type = finance.fn_person_wallet_type(w.owner_id)
       AND w.balance_cents >= v_product.price_cents * 2 AND NOT org.fn_is_minor(w.owner_id)
     ORDER BY w.balance_cents DESC, w.owner_id LIMIT 1;
    SELECT w.owner_id INTO v_two FROM finance.wallets w
     WHERE w.currency = 'USD' AND w.owner_id NOT IN (v_product.owner_user_id, v_one)
       AND w.owner_type = finance.fn_person_wallet_type(w.owner_id)
       AND w.balance_cents >= v_product.price_cents AND NOT org.fn_is_minor(w.owner_id)
     ORDER BY w.balance_cents DESC, w.owner_id LIMIT 1;
    PERFORM pg_temp.ok(v_one IS NOT NULL AND v_two IS NOT NULL, 'fixture: two adult buyers with a seeded USD balance');

    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes, status, owner_type, source)
    VALUES (v_product.owner_user_id, 'personal', 'users/' || v_product.owner_user_id || '/library/probe-race/race.zip',
            'race.zip', 'race.zip', 'application/zip', 2048, 'uploaded', 'user', 'supabase')
    RETURNING id INTO v_file;
    INSERT INTO catalogue.product_versions (product_id, version, manifest, ready_at)
    VALUES (v_product.id,
            COALESCE((SELECT max(version) FROM catalogue.product_versions WHERE product_id = v_product.id), 0) + 1,
            jsonb_build_array(jsonb_build_object('fileId', v_file, 'name', 'race.zip', 'label', 'Source',
                'extension', '.zip', 'bytes', 2048, 'mime', 'application/zip')),
            now())
    RETURNING id INTO v_version;

    -- Basket a (race A, buyer one) · basket b (race B, buyer one) · basket c (race B, buyer two).
    FOREACH v_buyer IN ARRAY ARRAY[v_one, v_one, v_two] LOOP
        v_n := v_n + 1;
        INSERT INTO finance.baskets (owner_type, owner_id, name)
        VALUES (finance.fn_person_wallet_type(v_buyer), v_buyer, 'Probe CK1 race ' || v_n) RETURNING id INTO v_basket;
        INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency,
                                          destination_email, metadata)
        VALUES (v_basket, 'digital_product', v_product.id, 'Probe race', v_product.price_cents, 'USD',
                'probe-ck1@example.com', '{"deliveryTermsAccepted": true}'::jsonb)
        RETURNING id INTO v_line;
        INSERT INTO probe_race VALUES ('line_' || v_n, v_line::text);
    END LOOP;
    INSERT INTO probe_race VALUES ('one', v_one::text), ('two', v_two::text), ('version', v_version::text),
        ('key', 'probe-ck1-race-' || gen_random_uuid());
END $$;
-- #endregion

-- #region A. The same attempt twice
DO $$
DECLARE
    v_line uuid := (SELECT v::uuid FROM probe_race WHERE k = 'line_1');
    v_key text := (SELECT v FROM probe_race WHERE k = 'key');
    v_sql text := pg_temp.pay_sql((SELECT v::uuid FROM probe_race WHERE k = 'line_1'), (SELECT v FROM probe_race WHERE k = 'key'));
    v_a jsonb;
    v_b jsonb;
    v_busy integer;
BEGIN
    PERFORM pg_temp.session_as('race_a', (SELECT v::uuid FROM probe_race WHERE k = 'one'));
    PERFORM pg_temp.session_as('race_b', (SELECT v::uuid FROM probe_race WHERE k = 'one'));
    BEGIN
        PERFORM extensions.dblink_exec('race_a', 'BEGIN');
        SELECT r::jsonb INTO v_a FROM extensions.dblink('race_a', v_sql) AS t (r text);
        -- B asks for the same order while A still holds the basket lock.
        PERFORM extensions.dblink_send_query('race_b', v_sql);
        PERFORM pg_sleep(0.5);
        v_busy := extensions.dblink_is_busy('race_b');
        PERFORM extensions.dblink_exec('race_a', 'COMMIT');
        SELECT r::jsonb INTO v_b FROM extensions.dblink_get_result('race_b') AS t (r text);
        PERFORM extensions.dblink_get_result('race_b');
    EXCEPTION WHEN OTHERS THEN
        PERFORM extensions.dblink_disconnect('race_a');
        PERFORM extensions.dblink_disconnect('race_b');
        RAISE;
    END;
    PERFORM extensions.dblink_disconnect('race_a');
    PERFORM extensions.dblink_disconnect('race_b');

    PERFORM pg_temp.ok(v_busy = 1, 'A the second session waited on the first''s basket lock');
    PERFORM pg_temp.ok(NOT (v_a ->> 'replayed')::boolean AND (v_b ->> 'replayed')::boolean
        AND v_a ->> 'order_id' = v_b ->> 'order_id', 'A the second session replayed the first''s order');
    PERFORM pg_temp.ok((SELECT count(*) FROM finance.orders WHERE idempotency_key = v_key) = 1
        AND (SELECT count(*) FROM finance.order_lines ol JOIN finance.orders o ON o.id = ol.order_id
              WHERE o.idempotency_key = v_key) = 1
        AND (SELECT count(*) FROM catalogue.entitlements e JOIN finance.order_lines ol ON ol.id = e.order_line_id
              JOIN finance.orders o ON o.id = ol.order_id WHERE o.idempotency_key = v_key) = 1,
        'A one order, one line, one entitlement');
END $$;
-- #endregion

-- #region B. Two buyers at once
DO $$
DECLARE
    v_sql_one text := pg_temp.pay_sql((SELECT v::uuid FROM probe_race WHERE k = 'line_2'), 'probe-ck1-race-b1-' || gen_random_uuid());
    v_sql_two text := pg_temp.pay_sql((SELECT v::uuid FROM probe_race WHERE k = 'line_3'), 'probe-ck1-race-b2-' || gen_random_uuid());
    v_a jsonb;
    v_b jsonb;
    v_ents record;
BEGIN
    PERFORM pg_temp.session_as('race_a', (SELECT v::uuid FROM probe_race WHERE k = 'one'));
    PERFORM pg_temp.session_as('race_b', (SELECT v::uuid FROM probe_race WHERE k = 'two'));
    BEGIN
        PERFORM extensions.dblink_exec('race_a', 'BEGIN');
        SELECT r::jsonb INTO v_a FROM extensions.dblink('race_a', v_sql_one) AS t (r text);
        PERFORM extensions.dblink_send_query('race_b', v_sql_two);
        PERFORM pg_sleep(0.3);
        PERFORM extensions.dblink_exec('race_a', 'COMMIT');
        SELECT r::jsonb INTO v_b FROM extensions.dblink_get_result('race_b') AS t (r text);
        PERFORM extensions.dblink_get_result('race_b');
    EXCEPTION WHEN OTHERS THEN
        PERFORM extensions.dblink_disconnect('race_a');
        PERFORM extensions.dblink_disconnect('race_b');
        RAISE;
    END;
    PERFORM extensions.dblink_disconnect('race_a');
    PERFORM extensions.dblink_disconnect('race_b');

    SELECT count(*) AS n, count(DISTINCT e.slug) AS slugs, count(DISTINCT e.holder_id) AS holders,
           bool_and(e.version_id = (SELECT v::uuid FROM probe_race WHERE k = 'version')) AS same_version,
           bool_and(e.status = 'active' AND e.delivery_terms_accepted_at IS NOT NULL) AS active
      INTO v_ents
      FROM catalogue.entitlements e
      JOIN finance.order_lines ol ON ol.id = e.order_line_id
     WHERE ol.order_id IN ((v_a ->> 'order_id')::uuid, (v_b ->> 'order_id')::uuid);
    PERFORM pg_temp.ok(v_a ->> 'order_id' <> v_b ->> 'order_id' AND v_ents.n = 2 AND v_ents.slugs = 2
        AND v_ents.holders = 2 AND v_ents.same_version AND v_ents.active,
        'B both orders landed, each with its own active entitlement on the same version');
END $$;
-- #endregion
