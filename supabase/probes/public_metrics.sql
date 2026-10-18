-- =============================================================================================
-- Probe: the public site's live aggregates — finance.public_metrics() (00001265, Decision #277).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing that survives (the threshold
-- param is changed INSIDE the transaction to exercise every branch). Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/public_metrics.sql
--
-- Asserts: only the service role may execute it; it is a SECURITY DEFINER with an empty
-- search_path; the threshold param and its fallbacks (missing, malformed, zero, fractional); every
-- figure equals an independent recomputation when the threshold is lifted; NO figure leaves the
-- database when its count is below the threshold; refunded escrows are not "protected"; the fee and
-- base-currency params pass through. A clean run prints only PASS notices; any FAIL aborts it.
-- Fixtures are whatever the seed holds (deno task db:reset) — the comparisons hold for any data.
-- =============================================================================================

BEGIN;

-- #region 1. Grants and definition
DO $$
DECLARE
    v_def boolean;
    v_cfg text[];
BEGIN
    SELECT p.prosecdef, p.proconfig INTO v_def, v_cfg
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'finance' AND p.proname = 'public_metrics' AND p.pronargs = 0;
    IF v_def IS NOT TRUE THEN RAISE EXCEPTION 'FAIL finance.public_metrics() is missing or not SECURITY DEFINER'; END IF;
    IF NOT ('search_path=""' = ANY (v_cfg)) THEN
        RAISE EXCEPTION 'FAIL finance.public_metrics() must pin search_path to empty, has %', v_cfg;
    END IF;
    RAISE NOTICE 'PASS SECURITY DEFINER, search_path=""';

    IF has_function_privilege('anon', 'finance.public_metrics()', 'EXECUTE')
        OR has_function_privilege('authenticated', 'finance.public_metrics()', 'EXECUTE')
        OR has_function_privilege('public', 'finance.public_metrics()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL a client role may execute finance.public_metrics()';
    END IF;
    IF NOT has_function_privilege('service_role', 'finance.public_metrics()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL service_role may not execute finance.public_metrics()';
    END IF;
    RAISE NOTICE 'PASS service role only (anon, authenticated and PUBLIC hold no EXECUTE)';
END $$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
    PERFORM finance.public_metrics();
    RAISE EXCEPTION 'FAIL anon executed finance.public_metrics()';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS anon refused [%]', SQLERRM;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
DO $$
BEGIN
    PERFORM finance.public_metrics();
    RAISE EXCEPTION 'FAIL authenticated executed finance.public_metrics()';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS authenticated refused [%]', SQLERRM;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 2. The threshold param and its fallbacks (read as the service role, the real caller)
DO $$
DECLARE
    v jsonb;
    c record;
BEGIN
    FOR c IN SELECT * FROM (VALUES
        ('as seeded (00005001)', '10'::jsonb, 10, true),
        ('absent',               NULL::jsonb, 10, false),
        ('a string',             '"ten"'::jsonb, 10, false),
        ('zero',                 '0'::jsonb, 10, false),
        ('fractional',           '2.7'::jsonb, 2, true),
        ('huge',                 '9999999999'::jsonb, 2147483647, true)
    ) AS t(label, value, want_n, want_configured)
    LOOP
        DELETE FROM security.platform_params WHERE key = 'public_metrics_min_n';
        IF c.value IS NOT NULL THEN
            INSERT INTO security.platform_params (key, value, description)
            VALUES ('public_metrics_min_n', c.value, 'probe');
        END IF;
        SET LOCAL ROLE service_role;
        v := finance.public_metrics();
        RESET ROLE;
        IF (v->>'min_n')::bigint <> c.want_n OR (v->>'min_n_configured')::boolean <> c.want_configured THEN
            RAISE EXCEPTION 'FAIL threshold %: got min_n=% configured=%, want %/%',
                c.label, v->>'min_n', v->>'min_n_configured', c.want_n, c.want_configured;
        END IF;
        RAISE NOTICE 'PASS threshold % -> min_n=% configured=%', c.label, v->>'min_n', v->>'min_n_configured';
    END LOOP;
END $$;
-- #endregion

-- #region 3. Lifted threshold: every figure equals an independent recomputation
UPDATE security.platform_params SET value = '1'::jsonb WHERE key = 'public_metrics_min_n';
INSERT INTO security.platform_params (key, value, description)
SELECT 'public_metrics_min_n', '1'::jsonb, 'probe'
WHERE NOT EXISTS (SELECT 1 FROM security.platform_params WHERE key = 'public_metrics_min_n');

DO $$
DECLARE
    v jsonb;
    v_count integer;
    v_by jsonb;
    v_delivered integer;
    v_obs integer;
    v_median double precision;
    v_refunded integer;
    v_all integer;
BEGIN
    SET LOCAL ROLE service_role;
    v := finance.public_metrics();
    RESET ROLE;

    SELECT count(*) INTO v_count FROM finance.escrows WHERE status IN ('funded', 'held', 'disputed', 'released');
    SELECT count(*) INTO v_refunded FROM finance.escrows WHERE status = 'refunded';
    SELECT count(*) INTO v_all FROM finance.escrows;
    SELECT jsonb_agg(jsonb_build_object('currency', cur, 'amount_minor', amt) ORDER BY cur) INTO v_by
      FROM (SELECT upper(currency) AS cur, sum(amount_cents)::bigint AS amt
              FROM finance.escrows WHERE status IN ('funded', 'held', 'disputed', 'released')
             GROUP BY upper(currency)) s;
    SELECT count(*) INTO v_delivered FROM projects.project_stages WHERE status IN ('approved', 'paid');
    SELECT count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY h) INTO v_obs, v_median
      FROM (SELECT extract(epoch FROM (s.completed_at - min(e.created_at))) / 3600.0 AS h
              FROM projects.project_stages s
              JOIN finance.escrows e ON e.project_stage_id = s.id AND e.status = 'released'
             WHERE s.status IN ('approved', 'paid') AND s.completed_at IS NOT NULL
             GROUP BY s.id, s.completed_at
            HAVING s.completed_at >= min(e.created_at)) d;

    IF v_count > 0 THEN
        IF (v->>'protected_count')::integer <> v_count THEN
            RAISE EXCEPTION 'FAIL protected_count % <> %', v->>'protected_count', v_count;
        END IF;
        IF v->'protected_by_currency' <> v_by THEN
            RAISE EXCEPTION 'FAIL protected_by_currency % <> %', v->'protected_by_currency', v_by;
        END IF;
        RAISE NOTICE 'PASS value protected: % escrows, %', v_count, v_by;
    ELSE
        RAISE NOTICE 'PASS value protected: no escrows to count (% rows answered %)', v_all, v->'protected_count';
    END IF;
    IF v_count + v_refunded > v_all THEN
        RAISE EXCEPTION 'FAIL a refunded escrow was counted as protected';
    END IF;
    RAISE NOTICE 'PASS % refunded escrow(s) left out of the protected figure', v_refunded;

    IF v_delivered > 0 AND (v->>'stages_delivered')::integer <> v_delivered THEN
        RAISE EXCEPTION 'FAIL stages_delivered % <> %', v->>'stages_delivered', v_delivered;
    END IF;
    RAISE NOTICE 'PASS stages delivered: %', v_delivered;

    IF v_obs > 0 THEN
        IF (v->>'approval_count')::integer <> v_obs
            OR abs((v->>'median_funding_to_approval_hours')::double precision - v_median) > 1e-6 THEN
            RAISE EXCEPTION 'FAIL median % over % <> % over %',
                v->>'median_funding_to_approval_hours', v->>'approval_count', v_median, v_obs;
        END IF;
        RAISE NOTICE 'PASS median funding -> approval: % h over % stage(s)', round(v_median::numeric, 1), v_obs;
    ELSE
        RAISE NOTICE 'PASS median: no delivered stage with a funding instant';
    END IF;

    IF (v->>'platform_fee_bp')::integer IS DISTINCT FROM
        (SELECT (value #>> '{}')::integer FROM security.platform_params WHERE key = 'platform_fee_bp') THEN
        RAISE EXCEPTION 'FAIL platform_fee_bp % does not pass through', v->>'platform_fee_bp';
    END IF;
    IF (v->>'base_currency') IS DISTINCT FROM
        upper((SELECT value #>> '{}' FROM security.platform_params WHERE key = 'base_currency')) THEN
        RAISE EXCEPTION 'FAIL base_currency % does not pass through', v->>'base_currency';
    END IF;
    IF (v->>'as_of') IS NULL OR (v->>'as_of')::timestamptz IS NULL THEN
        RAISE EXCEPTION 'FAIL as_of is not a timestamp';
    END IF;
    RAISE NOTICE 'PASS fee %, base %, as_of %', v->>'platform_fee_bp', v->>'base_currency', v->>'as_of';
END $$;
-- #endregion

-- #region 4. Below the threshold no figure leaves the database
UPDATE security.platform_params SET value = '2147483647'::jsonb WHERE key = 'public_metrics_min_n';
DO $$
DECLARE
    v jsonb;
    k text;
BEGIN
    SET LOCAL ROLE service_role;
    v := finance.public_metrics();
    RESET ROLE;
    FOREACH k IN ARRAY ARRAY['protected_count', 'protected_by_currency', 'stages_delivered',
                             'approval_count', 'median_funding_to_approval_hours'] LOOP
        IF v->k <> 'null'::jsonb THEN
            RAISE EXCEPTION 'FAIL % left the database below the threshold: %', k, v->k;
        END IF;
    END LOOP;
    IF v->'platform_fee_bp' = 'null'::jsonb THEN
        RAISE EXCEPTION 'FAIL the fee is withheld too — it rests on no count and is always published';
    END IF;
    RAISE NOTICE 'PASS every counted figure is NULL below the threshold; the fee still answers';
END $$;
-- #endregion

-- #region 5. Unusable fee / base-currency params answer NULL (the service falls back and logs)
UPDATE security.platform_params SET value = '"five percent"'::jsonb WHERE key = 'platform_fee_bp';
UPDATE security.platform_params SET value = '42'::jsonb WHERE key = 'base_currency';
DO $$
DECLARE
    v jsonb;
BEGIN
    SET LOCAL ROLE service_role;
    v := finance.public_metrics();
    RESET ROLE;
    IF v->'platform_fee_bp' <> 'null'::jsonb OR v->'base_currency' <> 'null'::jsonb THEN
        RAISE EXCEPTION 'FAIL malformed params passed through: fee=% base=%', v->'platform_fee_bp', v->'base_currency';
    END IF;
    RAISE NOTICE 'PASS malformed fee and base currency answer NULL rather than raising';
END $$;
-- #endregion

ROLLBACK;
