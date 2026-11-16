-- =============================================================================================
-- Probe: FX conversion arithmetic (Decision #435) — finance.fn_fx_quote_minor against fixed vectors.
-- The principal is the mid-market cost truncated and the margin is truncated on it (Decision #187),
-- in exact integer arithmetic on the rates' ten decimal places and each currency's own exponent. The
-- same vectors pin `quoteConversionMinor` in packages/types/finance/fx.ts (fx-conversion.test.ts reads
-- the VALUES rows below), so the figure a buyer is shown and the figure the database charges are one.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/fx_rounding_parity.sql
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_fail text[] := '{}';
    r record;
BEGIN
    FOR r IN
        SELECT v.*, m.principal_minor AS got_principal, m.spread_minor AS got_spread, m.from_minor AS got_from
          FROM (VALUES
            -- (to_minor, from_currency, to_currency, from_rate, to_rate, spread_bp, principal, spread, from_minor)
            (9000, 'GBP', 'EUR', 1.0000000000, 1.1700000000, 150, 7692, 115, 7807),
            (11700, 'GBP', 'EUR', 1.0000000000, 1.1700000000, 150, 10000, 150, 10150),
            (10000, 'GBP', 'JPY', 1.0000000000, 192.0000000000, 150, 5208, 78, 5286),
            (1000, 'JPY', 'GBP', 192.0000000000, 1.0000000000, 0, 1920, 0, 1920),
            (9000, 'USD', 'EUR', 1.2700000000, 1.1700000000, 150, 9769, 146, 9915),
            (100000, 'GBP', 'ZAR', 1.0000000000, 23.1000000000, 300, 4329, 129, 4458),
            (12345, 'EUR', 'USD', 1.1700000000, 1.2700000000, 150, 11372, 170, 11542),
            (127, 'GBP', 'USD', 1.0000000000, 1.2700000000, 0, 100, 0, 100),
            (127, 'GBP', 'USD', 1.0000000000, 1.2700000001, 0, 99, 0, 99),
            (1, 'GBP', 'EUR', 1.0000000000, 1.1700000000, 150, 0, 0, 0)
          ) AS v (to_minor, from_currency, to_currency, from_rate, to_rate, spread_bp, principal, spread, from_minor)
          CROSS JOIN LATERAL finance.fn_fx_quote_minor(
              v.to_minor::bigint, v.from_currency, v.to_currency, v.from_rate, v.to_rate, v.spread_bp) m
    LOOP
        IF (r.got_principal, r.got_spread, r.got_from) IS DISTINCT FROM (r.principal::bigint, r.spread::bigint, r.from_minor::bigint) THEN
            v_fail := v_fail || pg_catalog.format('%s %s→%s at %s/%s, %s bp: expected %s+%s=%s, got %s+%s=%s',
                r.to_minor, r.from_currency, r.to_currency, r.from_rate, r.to_rate, r.spread_bp,
                r.principal, r.spread, r.from_minor, r.got_principal, r.got_spread, r.got_from);
        END IF;
    END LOOP;
    IF pg_catalog.cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'PROBE FAIL: fn_fx_quote_minor vectors: %', pg_catalog.array_to_string(v_fail, '; ');
    END IF;
    RAISE NOTICE 'PASS fn_fx_quote_minor matches every vector';

    IF finance.fn_fx_refund_minor(9000, 9000, 7807) <> 7807 THEN v_fail := v_fail || 'whole refund'::text; END IF;
    IF finance.fn_fx_refund_minor(4500, 9000, 7807) <> 3904 THEN v_fail := v_fail || 'half refund rounds up'::text; END IF;
    IF finance.fn_fx_refund_minor(1, 9000, 7807) <> 1 THEN v_fail := v_fail || 'smallest refund rounds up'::text; END IF;
    IF finance.fn_fx_refund_minor(9500, 9000, 7807) <> 7807 THEN v_fail := v_fail || 'over-refund capped'::text; END IF;
    IF finance.fn_fx_refund_minor(0, 9000, 7807) <> 0 THEN v_fail := v_fail || 'nothing refunded'::text; END IF;
    IF finance.fn_currency_exponent('JPY') <> 0 OR finance.fn_currency_exponent('kwd') <> 3
       OR finance.fn_currency_exponent('GBP') <> 2 OR finance.fn_currency_exponent(NULL) <> 2 THEN
        v_fail := v_fail || 'exponents'::text;
    END IF;
    IF pg_catalog.cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'PROBE FAIL: %', pg_catalog.array_to_string(v_fail, '; ');
    END IF;
    RAISE NOTICE 'PASS fn_fx_refund_minor and fn_currency_exponent';
END $$;

ROLLBACK;
