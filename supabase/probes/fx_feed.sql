\set ON_ERROR_STOP on
-- =============================================================================================
-- Probe: the daily FX feed (FBP DB17; Decision #337, ruling M5 (f); Decision #471) —
-- finance.record_fx_rates (00001200) records a feed whole or refuses it whole. Since Decision #435 the
-- rates price conversions inside purchases, so a partial or malformed feed records nothing, leaves one
-- `finance.fx` error row (which the `finance.%` alert rules send), and the last rates stand. A replay
-- records nothing new.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/fx_feed.sql
--
-- A clean run prints only PASS notices; any failure raises `PROBE FAIL …` and aborts.
--
--   1  grants and shape: the door is a pinned definer only the service role may run; the currency set
--      is read only inside it, and is the seed floor's 12 GBP-based quotes
--   2  a full feed records exactly 12 rows at its as_of, each rate exactly as quoted, and a metric row
--   3  a replay records nothing new and says so
--   4  a feed missing one currency records none, names it, and leaves an error row that alerts
--   5  every other refusal records nothing and leaves its error row: an unexpected currency, a float,
--      zero, an exponent, eleven decimals, a base not 1, a future or missing as_of, `seed` or a
--      non-slug provider, rates that are not an object, a failed fetch with its reason, and a whole
--      feed the caller (FxService) refused first
--   6  the newest rates read as FxService and the quote door read them: the feed's, not the seed's
-- =============================================================================================

BEGIN;
-- The pg_temp helpers below run as service_role and authenticated, and 00002500 gives a new function
-- no PUBLIC EXECUTE; this hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region 0. Helpers (as postgres)
CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'PROBE FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- Call the door as `p_role`; the answer, or `ERROR <sqlstate>` when it raises. Role restored after.
CREATE FUNCTION pg_temp.record_as(p_role text, p_provider text, p_as_of timestamptz, p_rates jsonb,
                                  p_failure text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v jsonb;
    v_state text;
BEGIN
    PERFORM set_config('role', p_role, true);
    IF p_role = 'authenticated' THEN
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    END IF;
    v := finance.record_fx_rates(p_provider, p_as_of, p_rates, p_failure);
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN v;
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('error', v_state);
END $$;

-- A full feed's rates: every display currency against GBP, as decimal strings.
CREATE FUNCTION pg_temp.full_feed() RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'GBP', '1', 'USD', '1.2712345678', 'EUR', '1.1634', 'CAD', '1.7712', 'AUD', '1.9433',
        'JPY', '196.42', 'INR', '108.9', 'SGD', '1.7021', 'CHF', '1.1102', 'ZAR', '22.871',
        'NGN', '2034.5', 'AED', '4.6688');
$$;

CREATE FUNCTION pg_temp.fx_rows() RETURNS bigint LANGUAGE sql AS $$
    SELECT count(*) FROM finance.fx_rates;
$$;

CREATE FUNCTION pg_temp.fx_errors(p_reason text) RETURNS bigint LANGUAGE sql AS $$
    SELECT count(*) FROM ops.log_entries l
     WHERE l.scope = 'finance.fx' AND l.level = 'error' AND l.source = 'server'
       AND l.data ->> 'reason' = p_reason;
$$;
-- #endregion

-- #region 1. Grants and shape
DO $$
DECLARE
    v_def record;
    v_set text[];
BEGIN
    SELECT p.prosecdef, p.proconfig, p.provolatile INTO v_def
      FROM pg_proc p WHERE p.oid = 'finance.record_fx_rates(text,timestamptz,jsonb,text)'::regprocedure;
    PERFORM pg_temp.check(v_def.prosecdef AND 'search_path=""' = ANY (v_def.proconfig) AND v_def.provolatile = 'v',
        '1.1 record_fx_rates is a VOLATILE definer with a pinned search_path');
    PERFORM pg_temp.check(
        has_function_privilege('service_role', 'finance.record_fx_rates(text,timestamptz,jsonb,text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'finance.record_fx_rates(text,timestamptz,jsonb,text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'finance.record_fx_rates(text,timestamptz,jsonb,text)', 'EXECUTE'),
        '1.2 only the service role may record rates');
    PERFORM pg_temp.check(
        NOT has_function_privilege('anon', 'finance.fn_fx_feed_currencies()', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'finance.fn_fx_feed_currencies()', 'EXECUTE'),
        '1.3 no client role reads the feed''s currency set');
    v_set := finance.fn_fx_feed_currencies();
    PERFORM pg_temp.check(
        v_set = ARRAY['AED', 'AUD', 'CAD', 'CHF', 'EUR', 'GBP', 'INR', 'JPY', 'NGN', 'SGD', 'USD', 'ZAR'],
        '1.4 a feed must quote the seed floor''s 12 GBP-based currencies: ' || array_to_string(v_set, ' '));
    PERFORM pg_temp.check(
        (pg_temp.record_as('authenticated', 'probe', now() - interval '1 hour', pg_temp.full_feed())) ->> 'error' = '42501',
        '1.5 a signed-in caller is refused (42501)');
END $$;
-- #endregion

-- #region 2. A full feed records 12 rows, exactly as quoted
DO $$
DECLARE
    v_before bigint := pg_temp.fx_rows();
    v_as_of timestamptz := date_trunc('minute', now()) - interval '2 hours';
    v jsonb;
    v_usd numeric;
BEGIN
    v := pg_temp.record_as('service_role', 'probe-feed', v_as_of, pg_temp.full_feed());
    PERFORM pg_temp.check((v ->> 'recorded')::integer = 12 AND (v ->> 'replay')::boolean = false
        AND v ->> 'provider' = 'probe-feed', '2.1 a full feed records 12 rows: ' || v::text);
    PERFORM pg_temp.check(pg_temp.fx_rows() = v_before + 12, '2.2 the table grew by exactly 12');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM finance.fx_rates r
          WHERE r.base = 'GBP' AND r.as_of = v_as_of AND r.provider = 'probe-feed') = 12,
        '2.3 every row is GBP-based, at the feed''s as_of, under its provider');
    SELECT r.rate INTO v_usd FROM finance.fx_rates r
     WHERE r.base = 'GBP' AND r.quote = 'USD' AND r.as_of = v_as_of;
    PERFORM pg_temp.check(v_usd = 1.2712345678 AND v_usd::text = '1.2712345678',
        '2.4 a ten-place rate is stored exactly as quoted: ' || v_usd::text);
    PERFORM pg_temp.check(
        (SELECT r.rate FROM finance.fx_rates r WHERE r.quote = 'GBP' AND r.base = 'GBP' AND r.as_of = v_as_of) = 1,
        '2.5 the base quotes itself at 1');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM ops.log_entries l
                 WHERE l.scope = 'finance.fx' AND l.level = 'metric' AND l.data ->> 'provider' = 'probe-feed'
                   AND (l.data ->> 'recorded')::integer = 12),
        '2.6 a recorded feed leaves a metric row, which never alerts');
END $$;
-- #endregion

-- #region 3. A replay records nothing new
DO $$
DECLARE
    v_before bigint := pg_temp.fx_rows();
    v_as_of timestamptz := date_trunc('minute', now()) - interval '2 hours';
    v jsonb;
BEGIN
    v := pg_temp.record_as('service_role', 'probe-feed', v_as_of, pg_temp.full_feed());
    PERFORM pg_temp.check((v ->> 'recorded')::integer = 0 AND (v ->> 'replay')::boolean
        AND v ->> 'refused' IS NULL, '3.1 a replay records nothing and says so: ' || v::text);
    PERFORM pg_temp.check(pg_temp.fx_rows() = v_before, '3.2 the table is unchanged by the replay');
END $$;
-- #endregion

-- #region 4. A missing currency records none and logs
DO $$
DECLARE
    v_before bigint := pg_temp.fx_rows();
    v_errors bigint := pg_temp.fx_errors('currency_missing');
    v jsonb;
BEGIN
    v := pg_temp.record_as('service_role', 'probe-feed', now() - interval '1 hour', pg_temp.full_feed() - 'NGN');
    PERFORM pg_temp.check((v ->> 'recorded')::integer = 0 AND v ->> 'refused' = 'currency_missing'
        AND v -> 'currencies' = '["NGN"]'::jsonb, '4.1 a feed missing NGN is refused and names it: ' || v::text);
    PERFORM pg_temp.check(pg_temp.fx_rows() = v_before, '4.2 none of its 11 rates was recorded');
    PERFORM pg_temp.check(pg_temp.fx_errors('currency_missing') = v_errors + 1,
        '4.3 one finance.fx error row names the refusal');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM ops.alert_rules x
                 WHERE x.enabled AND x.kind = 'level' AND 'finance.fx' LIKE x.scope_pattern
                   AND x.min_level IN ('warn', 'error')),
        '4.4 the error row is one an enabled alert rule sends');
END $$;
-- #endregion

-- #region 5. Every other refusal records nothing and logs
DO $$
DECLARE
    v_before bigint := pg_temp.fx_rows();
    v_ago timestamptz := now() - interval '1 hour';
    v_case record;
    v jsonb;
    v_errors bigint;
BEGIN
    FOR v_case IN
        SELECT * FROM (VALUES
            ('5.1 an unexpected currency', 'probe-feed', v_ago, pg_temp.full_feed() || '{"XAU": "0.0004"}'::jsonb, NULL::text, 'currency_unexpected'),
            ('5.2 a float rather than a decimal string', 'probe-feed', v_ago, jsonb_set(pg_temp.full_feed(), '{USD}', '1.27'::jsonb), NULL, 'rate_invalid'),
            ('5.3 a zero rate', 'probe-feed', v_ago, jsonb_set(pg_temp.full_feed(), '{EUR}', '"0"'::jsonb), NULL, 'rate_invalid'),
            ('5.4 a negative rate', 'probe-feed', v_ago, jsonb_set(pg_temp.full_feed(), '{EUR}', '"-1.16"'::jsonb), NULL, 'rate_invalid'),
            ('5.5 an exponent', 'probe-feed', v_ago, jsonb_set(pg_temp.full_feed(), '{JPY}', '"1.96e2"'::jsonb), NULL, 'rate_invalid'),
            ('5.6 eleven decimal places', 'probe-feed', v_ago, jsonb_set(pg_temp.full_feed(), '{USD}', '"1.27123456789"'::jsonb), NULL, 'rate_invalid'),
            ('5.7 text that is no number', 'probe-feed', v_ago, jsonb_set(pg_temp.full_feed(), '{CHF}', '"n/a"'::jsonb), NULL, 'rate_invalid'),
            ('5.8 the base not at 1', 'probe-feed', v_ago, jsonb_set(pg_temp.full_feed(), '{GBP}', '"1.01"'::jsonb), NULL, 'rate_invalid'),
            ('5.9 an as_of in the future', 'probe-feed', now() + interval '1 hour', pg_temp.full_feed(), NULL, 'as_of_in_future'),
            ('5.10 no as_of', 'probe-feed', NULL::timestamptz, pg_temp.full_feed(), NULL, 'as_of_missing'),
            ('5.11 the seed''s provider name', 'seed', v_ago, pg_temp.full_feed(), NULL, 'provider_invalid'),
            ('5.12 a provider that is no slug', 'Probe Feed!', v_ago, pg_temp.full_feed(), NULL, 'provider_invalid'),
            ('5.13 rates that are not an object', 'probe-feed', v_ago, '["1.27"]'::jsonb, NULL, 'rates_invalid'),
            ('5.14 a failed fetch, with its reason', 'probe-feed', NULL::timestamptz, NULL::jsonb, 'http_503', 'http_503'),
            ('5.15 a failed fetch, with no reason', 'probe-feed', NULL::timestamptz, NULL::jsonb, NULL, 'feed_unavailable'),
            ('5.16 a reason that is not a code', 'probe-feed', NULL::timestamptz, NULL::jsonb, 'Timed out; retry?', 'feed_unavailable'),
            ('5.17 a whole feed the caller refused first', 'probe-feed', v_ago, pg_temp.full_feed(), 'base_invalid', 'base_invalid')
        ) AS c (label, provider, as_of, rates, failure, reason)
    LOOP
        v_errors := pg_temp.fx_errors(v_case.reason);
        v := pg_temp.record_as('service_role', v_case.provider, v_case.as_of, v_case.rates, v_case.failure);
        PERFORM pg_temp.check((v ->> 'recorded')::integer = 0 AND v ->> 'refused' = v_case.reason
            AND pg_temp.fx_errors(v_case.reason) = v_errors + 1,
            v_case.label || ' is refused (' || v_case.reason || '), logged, recorded nothing: ' || v::text);
    END LOOP;
    PERFORM pg_temp.check(pg_temp.fx_rows() = v_before, '5.18 no refused feed recorded a row');
END $$;
-- #endregion

-- #region 6. The newest rates are the feed's
DO $$
DECLARE
    v_as_of timestamptz := date_trunc('minute', now()) - interval '2 hours';
    v_newest record;
BEGIN
    -- FxService reads base = GBP newest-first and keeps each quote's first row; the quote door orders
    -- by as_of DESC, created_at DESC per pair. Both now land on the feed's row, not the seed's.
    SELECT r.rate, r.as_of, r.provider INTO v_newest FROM finance.fx_rates r
     WHERE r.base = 'GBP' AND r.quote = 'USD' ORDER BY r.as_of DESC, r.created_at DESC LIMIT 1;
    PERFORM pg_temp.check(v_newest.provider = 'probe-feed' AND v_newest.as_of = v_as_of
        AND v_newest.rate = 1.2712345678, '6.1 the newest GBP → USD is the feed''s');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM finance.fx_rates r WHERE r.provider = 'seed') = 23,
        '6.2 the seed floor is untouched (12 GBP-based and 11 inverse rows)');
END $$;
-- #endregion

ROLLBACK;
