-- currency_integrity.sql — every currency column holds an ISO code, every escrow status, wallet owner
-- type and ledger reason a known value, and amounts print with their currency's own exponent (FINANCE
-- DB8: FA C14, C10, Z5; FCA N24, N36).
--
-- Rolled back; writes nothing:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/currency_integrity.sql
--   1. Every column of an application schema whose name holds `currency`, and finance's `fx_base` and
--      fx_rates `base` / `quote`, carries a CHECK against '^[A-Z]{3}$'.
--   2. 'usd' and 'US' are refused (23514) on a text and on a char(3) column; 'EURO' on a text column.
--   3. finance.escrows.status admits only what a function writes, and defaults to `held`; an unknown
--      status, wallet owner type or ledger reason is refused (23514).
--   4. Every code finance.fn_wallet_debit's two lists and finance.fn_is_income_reason name is a code
--      the transactions.reason CHECK admits, and the seeded ledger uses only admitted codes.
--   5. A pot name over 120 characters and an approval reason over 2000 are refused (23514).
--   6. finance.fn_minor_units_text reads finance.fn_currency_exponent: KWD 1234 → 1.234, JPY and ISK
--      1234 → 1,234, GBP 123456 → 1,234.56.
\set ON_ERROR_STOP on
\set QUIET on

BEGIN;

-- #region Helpers
CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- Runs one statement inside a subtransaction; returns its SQLSTATE, or 'accepted'.
CREATE OR REPLACE FUNCTION pg_temp.refusal(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
        RETURN v_state;
    END;
    RETURN 'accepted';
END $$;

-- The codes a CHECK's `IN (...)` / `= ANY (ARRAY[...])` list names.
CREATE OR REPLACE FUNCTION pg_temp.check_codes(p_table regclass, p_column text) RETURNS text[] LANGUAGE sql AS $$
    SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
     WHERE c.conrelid = p_table AND c.contype = 'c' AND a.attname = p_column
       AND array_length(c.conkey, 1) = 1;
$$;

-- The quoted codes inside one function's body, optionally only those of one `name := ARRAY[...]`.
CREATE OR REPLACE FUNCTION pg_temp.body_codes(p_fn regprocedure, p_array text DEFAULT NULL) RETURNS text[] LANGUAGE sql AS $$
    SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
      FROM pg_proc p
     CROSS JOIN LATERAL (SELECT CASE WHEN p_array IS NULL THEN p.prosrc
                                     ELSE substring(p.prosrc FROM p_array || '[^:]*:=\s*ARRAY\[([^]]*)\]') END AS src) s
     CROSS JOIN LATERAL regexp_matches(s.src, '''([a-z_]+)''', 'g') m
     WHERE p.oid = p_fn;
$$;
-- #endregion

-- #region 1. Every currency column is CHECKed against an ISO shape
SELECT pg_temp.ok(
    count(*) = 0,
    '1: every currency column carries a CHECK against ''^[A-Z]{3}$'''
       || COALESCE(' (missing: ' || string_agg(n.nspname || '.' || cl.relname || '.' || a.attname, ', ') || ')', ''))
  FROM pg_attribute a
  JOIN pg_class cl ON cl.oid = a.attrelid AND cl.relkind IN ('r', 'p')
  JOIN pg_namespace n ON n.oid = cl.relnamespace
 WHERE n.nspname IN ('analytics', 'catalogue', 'comms', 'community', 'editorial', 'files', 'finance', 'integrations',
                     'marketplace', 'ops', 'org', 'projects', 'reviews', 'scheduling', 'search', 'security')
   AND a.attnum > 0 AND NOT a.attisdropped
   AND (a.attname ~ 'currency' OR (n.nspname = 'finance' AND a.attname = 'fx_base')
        OR (n.nspname = 'finance' AND cl.relname = 'fx_rates' AND a.attname IN ('base', 'quote')))
   AND NOT EXISTS (SELECT 1 FROM pg_constraint c
                    WHERE c.conrelid = cl.oid AND c.contype = 'c' AND a.attnum = ANY (c.conkey)
                      AND pg_get_constraintdef(c.oid) LIKE '%^[A-Z]{3}$%');
-- #endregion

-- #region 2. Malformed codes are refused
SELECT id AS any_wallet FROM finance.wallets ORDER BY id LIMIT 1 \gset
SELECT pg_temp.ok(pg_temp.refusal(format(
    'INSERT INTO finance.wallets (owner_type, owner_id, currency) VALUES (''user'', gen_random_uuid (), %L)', v)) = '23514',
    format('2: wallets.currency (text) refuses %L with 23514', v))
  FROM unnest(ARRAY['usd', 'US', 'EURO']) v;
SELECT pg_temp.ok(pg_temp.refusal(format(
    'INSERT INTO finance.fx_rates (base, quote, rate, as_of, provider) VALUES (%L, ''GBP'', 1, now (), ''probe'')', v)) = '23514',
    format('2: fx_rates.base (char(3)) refuses %L with 23514', v))
  FROM unnest(ARRAY['usd', 'US']) v;
SELECT pg_temp.ok(pg_temp.refusal(
    'INSERT INTO finance.fx_rates (base, quote, rate, as_of, provider) VALUES (''EURO'', ''GBP'', 1, now (), ''probe'')') = '22001',
    '2: a char(3) column refuses EURO as too long (22001) before any CHECK runs');
SELECT pg_temp.ok(pg_temp.refusal(
    'UPDATE projects.projects SET currency = ''usd'' WHERE id = (SELECT id FROM projects.projects LIMIT 1)') = '23514',
    '2: projects.currency refuses usd with 23514');
SELECT pg_temp.ok(pg_temp.refusal(
    'UPDATE org.business_profiles SET default_currency = ''EURO'' WHERE id = (SELECT id FROM org.business_profiles LIMIT 1)') = '23514',
    '2: business_profiles.default_currency refuses EURO with 23514');
-- #endregion

-- #region 3. Escrow status, wallet owner type and ledger reason are known values
SELECT pg_temp.ok(
    pg_temp.check_codes('finance.escrows', 'status') = ARRAY['disputed', 'held', 'refunded', 'released', 'reserved'],
    '3: escrows.status admits held, reserved, released, refunded and disputed, and nothing else');
SELECT pg_temp.ok(
    (SELECT pg_get_expr(d.adbin, d.adrelid) = '''held''::text'
       FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'finance.escrows'::regclass AND a.attname = 'status'),
    '3: escrows.status defaults to held, the value the hold doors write');
SELECT pg_temp.ok(pg_temp.refusal(format(
    'UPDATE finance.escrows SET status = %L WHERE id = (SELECT id FROM finance.escrows WHERE payee_id IS NOT NULL LIMIT 1)', v)) = '23514',
    format('3: an escrow refuses status %L with 23514', v))
  FROM unnest(ARRAY['funded', 'frozen']) v;
SELECT pg_temp.ok(
    pg_temp.check_codes('finance.wallets', 'owner_type') = ARRAY['business', 'enterprise', 'freelancer', 'team', 'user'],
    '3: wallets.owner_type admits the five finance owner types');
SELECT pg_temp.ok(pg_temp.refusal(
    'INSERT INTO finance.wallets (owner_type, owner_id, currency) VALUES (''system'', gen_random_uuid (), ''GBP'')') = '23514',
    '3: a system wallet is refused with 23514 (ruling M2: system accounts are not materialised)');
SELECT pg_temp.ok(pg_temp.refusal(format(
    'INSERT INTO finance.transactions (wallet_id, direction, amount_cents, currency, reason, balance_after_cents)
     SELECT id, ''credit'', 1, currency, %L, balance_cents FROM finance.wallets WHERE id = %L', v, :'any_wallet')) = '23514',
    format('3: a ledger row with reason %L is refused with 23514', v))
  FROM unnest(ARRAY['service_sale', 'platform_fee', 'instant_payout_fee']) v;
-- #endregion

-- #region 4. The guards name only admitted reasons
SELECT pg_temp.check_codes('finance.transactions', 'reason') AS reasons \gset
SELECT pg_temp.ok(cardinality(:'reasons'::text[]) > 0, '4: transactions.reason carries a CHECK list');
SELECT pg_temp.ok(
    pg_temp.body_codes('finance.fn_wallet_debit_fx(uuid,text,text,bigint,text,text,uuid,text,numeric,timestamptz)', 'v_voluntary')
        <@ :'reasons'::text[]
    AND pg_temp.body_codes('finance.fn_wallet_debit_fx(uuid,text,text,bigint,text,text,uuid,text,numeric,timestamptz)', 'v_involuntary')
        <@ :'reasons'::text[],
    '4: every debit reason finance.fn_wallet_debit knows is admitted');
SELECT pg_temp.ok(
    pg_temp.body_codes('finance.fn_is_income_reason(text)') <@ :'reasons'::text[],
    '4: every earned-credit reason finance.fn_is_income_reason knows is admitted');
SELECT pg_temp.ok(
    (SELECT count(*) FROM unnest(:'reasons'::text[]) r WHERE r LIKE 'simulated\_%') = 6,
    '4: the simulator''s six simulated_* codes are admitted');
SELECT pg_temp.ok(
    NOT EXISTS (SELECT 1 FROM finance.transactions t WHERE NOT (t.reason = ANY (:'reasons'::text[])))
    AND NOT EXISTS (SELECT 1 FROM finance.pending_releases p WHERE NOT finance.fn_is_income_reason(p.reason)),
    '4: the seeded ledger and pending window use only admitted reasons');
-- #endregion

-- #region 5. SV1's two lengths
SELECT pg_temp.ok(pg_temp.refusal(
    'INSERT INTO finance.wallet_pots (wallet_id, purpose, name, currency)
     SELECT wallet_id, purpose, repeat(''x'', 121), currency FROM finance.wallet_pots LIMIT 1') = '23514',
    '5: a pot name over 120 characters is refused with 23514');
SELECT pg_temp.ok(pg_temp.refusal(
    'UPDATE finance.spend_approvals SET reason = repeat(''x'', 2001) WHERE id = (SELECT id FROM finance.spend_approvals LIMIT 1)') = '23514',
    '5: an approval reason over 2000 characters is refused with 23514');
-- #endregion

-- #region 6. Amounts print with their currency's exponent
SELECT pg_temp.ok(finance.fn_minor_units_text(1234, 'KWD') = '1.234', '6: KWD 1234 prints 1.234');
SELECT pg_temp.ok(finance.fn_minor_units_text(1234, 'JPY') = '1,234', '6: JPY 1234 prints 1,234');
SELECT pg_temp.ok(finance.fn_minor_units_text(1234, 'ISK') = '1,234', '6: ISK 1234 prints 1,234');
SELECT pg_temp.ok(finance.fn_minor_units_text(123456, 'GBP') = '1,234.56', '6: GBP 123456 prints 1,234.56');
SELECT pg_temp.ok(finance.fn_minor_units_text(5, 'gbp') = '0.05', '6: a lower-case code reads its exponent too');
SELECT pg_temp.ok(finance.fn_minor_units_text(1000, 'MGA') = '10.00', '6: MGA keeps ISO 4217''s two decimals');
-- #endregion

ROLLBACK;
