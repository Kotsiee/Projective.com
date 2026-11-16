-- =============================================================================================
-- Probe: FX quotes (Decision #435) — finance.quote_fx_conversion refuses before writing anything while
-- paying in another currency is off (PX503 fx_unavailable), with no margin (PX500), for a currency
-- outside settlement_currencies (PX422, Decision #423), on a stale rate (PX503 fx_rate_stale), for the
-- same currency (22023) and for someone else's basket (42501); it prices the principal and margin as
-- fn_fx_quote_minor does, charges the higher of the two currencies' margins, and the quote row is
-- frozen except for its use (PL403).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/fx_quote_guards.sql
--
-- Fixture: two seeded people, each with a basket of their own; fresh GBP-based rates inserted inside the
-- transaction (the seed's are dated 2026-08-01, so a pair without one is stale). A clean run prints only
-- PASS notices; any failure ends the run in an error listing every failed case.
-- =============================================================================================

BEGIN;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

CREATE FUNCTION pg_temp.try_as(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    PERFORM pg_temp.act(p_uid);
    EXECUTE p_sql;
    PERFORM pg_temp.act(NULL);
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    PERFORM pg_temp.act(NULL);
    RETURN v_state || ': ' || v_msg;
END $$;

CREATE FUNCTION pg_temp.quote_sql(p_owner uuid, p_basket uuid, p_from text, p_to text, p_minor bigint) RETURNS text
LANGUAGE sql AS $$
    SELECT pg_catalog.format(
        'SELECT finance.quote_fx_conversion(%L, %L, %L, %L, %s, %L, %L, %L)',
        'user', p_owner, p_from, p_to, p_minor, 'checkout', 'baskets', p_basket);
$$;

DO $$
DECLARE
    v_buyer uuid;
    v_other uuid;
    v_basket uuid;
    v_other_basket uuid;
    v_q jsonb;
    v_r text;
    v_fail text[] := '{}';
BEGIN
    -- #region Fixture (as postgres)
    SELECT u.id INTO v_buyer FROM auth.users u
      JOIN org.users_public up ON up.user_id = u.id
     ORDER BY u.id LIMIT 1;
    SELECT u.id INTO v_other FROM auth.users u
      JOIN org.users_public up ON up.user_id = u.id
     WHERE u.id <> v_buyer ORDER BY u.id LIMIT 1;
    IF v_buyer IS NULL OR v_other IS NULL THEN RAISE EXCEPTION 'FAIL fixture: two seeded people are needed'; END IF;
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('user', v_buyer, 'Probe FX') RETURNING id INTO v_basket;
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('user', v_other, 'Probe FX other') RETURNING id INTO v_other_basket;
    INSERT INTO finance.fx_rates (base, quote, rate, as_of, provider) VALUES
        ('GBP', 'EUR', 1.1700000000, pg_catalog.now(), 'probe'),
        ('GBP', 'USD', 1.2700000000, pg_catalog.now(), 'probe'),
        ('GBP', 'JPY', 192.0000000000, pg_catalog.now(), 'probe'),
        ('GBP', 'ZAR', 23.1000000000, pg_catalog.now(), 'probe'),
        ('GBP', 'AED', 4.6600000000, pg_catalog.now(), 'probe');
    -- #endregion

    -- #region 1. Switched off by default
    v_r := pg_temp.try_as(v_buyer, pg_temp.quote_sql(v_buyer, v_basket, 'GBP', 'EUR', 9000));
    IF v_r NOT LIKE 'PX503: fx_unavailable%' THEN v_fail := v_fail || ('off: ' || v_r); END IF;
    UPDATE security.platform_params SET value = 'true'::jsonb WHERE key = 'fx_checkout_enabled';
    -- #endregion

    -- #region 2. The price: principal and margin truncated, the pair's mid rate, 30 minutes
    PERFORM pg_temp.act(v_buyer);
    v_q := finance.quote_fx_conversion('user', v_buyer, 'gbp', 'eur', 9000, 'checkout', 'baskets', v_basket);
    PERFORM pg_temp.act(NULL);
    IF (v_q ->> 'principal_minor')::bigint <> 7692 OR (v_q ->> 'spread_minor')::bigint <> 115
       OR (v_q ->> 'from_minor')::bigint <> 7807 OR (v_q ->> 'spread_bp')::int <> 150
       OR (v_q ->> 'mid_rate')::numeric <> 1.17 OR v_q ->> 'from_currency' <> 'GBP' OR v_q ->> 'to_currency' <> 'EUR'
       OR (v_q ->> 'expires_at')::timestamptz <> pg_catalog.now() + interval '30 minutes'
       OR (v_q ->> 'created_by')::uuid <> v_buyer OR v_q ->> 'rate_provider' <> 'probe' THEN
        v_fail := v_fail || ('price: ' || v_q::text);
    END IF;
    PERFORM pg_temp.act(v_buyer);
    v_q := finance.quote_fx_conversion('user', v_buyer, 'GBP', 'JPY', 10000, 'checkout', 'baskets', v_basket);
    PERFORM pg_temp.act(NULL);
    IF (v_q ->> 'from_minor')::bigint <> 5286 THEN v_fail := v_fail || ('JPY exponent: ' || v_q::text); END IF;
    PERFORM pg_temp.act(v_buyer);
    v_q := finance.quote_fx_conversion('user', v_buyer, 'USD', 'EUR', 9000, 'checkout', 'baskets', v_basket);
    PERFORM pg_temp.act(NULL);
    IF (v_q ->> 'from_minor')::bigint <> 9915 OR (v_q ->> 'mid_rate')::numeric <> 0.9212598425 THEN
        v_fail := v_fail || ('cross rate: ' || v_q::text);
    END IF;
    -- #endregion

    -- #region 3. The higher of the two currencies' margins
    UPDATE security.platform_params SET value = '{"default": 150, "ZAR": 300}'::jsonb WHERE key = 'fx_spread_bp';
    PERFORM pg_temp.act(v_buyer);
    v_q := finance.quote_fx_conversion('user', v_buyer, 'GBP', 'ZAR', 100000, 'checkout', 'baskets', v_basket);
    PERFORM pg_temp.act(NULL);
    IF (v_q ->> 'spread_bp')::int <> 300 OR (v_q ->> 'from_minor')::bigint <> 4458 THEN
        v_fail := v_fail || ('higher margin: ' || v_q::text);
    END IF;
    UPDATE security.platform_params SET value = 'null'::jsonb WHERE key = 'fx_spread_bp';
    v_r := pg_temp.try_as(v_buyer, pg_temp.quote_sql(v_buyer, v_basket, 'GBP', 'EUR', 9000));
    IF v_r NOT LIKE 'PX500: fx_spread_not_configured%' THEN v_fail := v_fail || ('no margin: ' || v_r); END IF;
    UPDATE security.platform_params SET value = '{"default": 150}'::jsonb WHERE key = 'fx_spread_bp';
    -- #endregion

    -- #region 4. Refusals
    v_r := pg_temp.try_as(v_buyer, pg_temp.quote_sql(v_buyer, v_basket, 'GBP', 'AED', 9000));
    IF v_r NOT LIKE 'PX422: currency_not_settled%' THEN v_fail := v_fail || ('display-only currency: ' || v_r); END IF;
    v_r := pg_temp.try_as(v_buyer, pg_temp.quote_sql(v_buyer, v_basket, 'GBP', 'CAD', 9000));
    IF v_r NOT LIKE 'PX503: fx_rate_stale%' THEN v_fail := v_fail || ('stale rate: ' || v_r); END IF;
    v_r := pg_temp.try_as(v_buyer, pg_temp.quote_sql(v_buyer, v_basket, 'GBP', 'GBP', 9000));
    IF v_r NOT LIKE '22023:%' THEN v_fail := v_fail || ('same currency: ' || v_r); END IF;
    v_r := pg_temp.try_as(v_buyer, pg_temp.quote_sql(v_other, v_other_basket, 'GBP', 'EUR', 9000));
    IF v_r NOT LIKE '42501:%' THEN v_fail := v_fail || ('another''s basket: ' || v_r); END IF;
    v_r := pg_temp.try_as(v_buyer, pg_temp.quote_sql(v_buyer, v_basket, 'GBP', 'EUR', 0));
    IF v_r NOT LIKE '22023:%' THEN v_fail := v_fail || ('nothing to convert: ' || v_r); END IF;
    v_r := pg_temp.try_as(v_buyer, pg_temp.quote_sql(v_buyer, v_basket, 'GBP', 'EUR', 1));
    IF v_r NOT LIKE '22023:%' THEN v_fail := v_fail || ('too small: ' || v_r); END IF;
    v_r := pg_temp.try_as(NULL, pg_temp.quote_sql(v_buyer, v_basket, 'GBP', 'EUR', 9000));
    IF v_r NOT LIKE '42501:%' THEN v_fail := v_fail || ('signed out: ' || v_r); END IF;
    -- #endregion

    -- #region 5. A quote is frozen except for its use
    PERFORM pg_temp.act(v_buyer);
    v_q := finance.quote_fx_conversion('user', v_buyer, 'GBP', 'EUR', 9000, 'checkout', 'baskets', v_basket);
    PERFORM pg_temp.act(NULL);
    v_r := pg_temp.try_as(NULL, pg_catalog.format('UPDATE finance.fx_quotes SET to_minor = 1 WHERE id = %L', v_q ->> 'id'));
    IF v_r NOT LIKE 'PL403:%' THEN v_fail := v_fail || ('rewrite: ' || v_r); END IF;
    v_r := pg_temp.try_as(NULL, pg_catalog.format('DELETE FROM finance.fx_quotes WHERE id = %L', v_q ->> 'id'));
    IF v_r NOT LIKE 'PL403:%' THEN v_fail := v_fail || ('delete: ' || v_r); END IF;
    v_r := pg_temp.try_as(NULL, pg_catalog.format('UPDATE finance.fx_quotes SET consumed_at = now() WHERE id = %L', v_q ->> 'id'));
    IF v_r <> 'ok' THEN v_fail := v_fail || ('record its use: ' || v_r); END IF;
    v_r := pg_temp.try_as(NULL, pg_catalog.format('UPDATE finance.fx_quotes SET consumed_at = now() + interval ''1 hour'' WHERE id = %L', v_q ->> 'id'));
    IF v_r NOT LIKE 'PL403:%' THEN v_fail := v_fail || ('use recorded twice: ' || v_r); END IF;
    -- #endregion

    IF pg_catalog.cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'PROBE FAIL: %', pg_catalog.array_to_string(v_fail, ' | ');
    END IF;
    RAISE NOTICE 'PASS quote_fx_conversion: off by default, priced and truncated, higher margin, every refusal, frozen row';
END $$;

ROLLBACK;
