-- =============================================================================================
-- Probe: the seller tax-reporting reader (00001200 "Seller tax reporting", LEGAL LG6; Decision #527)
-- — per seller, currency and calendar quarter: what the ledger credited them, the platform fees
-- attributed to it, and how many paid activities it came from, for an operator to export.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/seller_tax_report.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. The fixture lives in
-- calendar year 2009, which no seed row reaches, so the seed never moves the figures it asserts.
--
--   1  grants and shape: the operator door is a STABLE definer with a pinned search_path that
--      authenticated may call and anon may not; the internal reader is STABLE and no client role
--      may call it
--   2  the gate: a member, and a caller with no JWT, get 42501; an operator gets what the internal
--      reader computes; a year that is not one gets 22023
--   3  the figures on a fixture: a direct payee's credit and its escrow's whole fee; a team escrow's
--      fee shared by credit across members and the team's vault; an unmatured release still counts
--      in its escrow's denominator; top-ups, debits and another year's credits are left out; the
--      profile country and the Stripe account reference ride on each row
--   4  the seed's sellers match the ledger: each row's credit is the ledger's own sum, a direct
--      payee's fee is its escrows' recorded fee, a team escrow's shares add up to its fee to the
--      minor unit per credit, and each order's sellers carry exactly its lines' fees and what the
--      buyer paid for them
--   5  it moves nothing
-- =============================================================================================

BEGIN;
-- The pg_temp helpers below run as anon and authenticated, and 00002500 gives a new function no PUBLIC
-- EXECUTE; this hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region 0. Fixtures and helpers (as postgres)
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_user IS NULL THEN
        PERFORM set_config('role', 'postgres', true);
        PERFORM set_config('request.jwt.claims', '', true);
    ELSE
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
    END IF;
END $$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- The SQLSTATE `finance.read_seller_tax_report(p_year)` raises for p_user ('' when it answers).
-- p_user NULL with p_authenticated: the authenticated role with no JWT subject.
CREATE FUNCTION pg_temp.read_state(p_user uuid, p_year integer, p_authenticated boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text := '';
BEGIN
    IF p_user IS NULL AND p_authenticated THEN
        PERFORM set_config('request.jwt.claims', '', true);
        PERFORM set_config('role', 'authenticated', true);
    ELSE
        PERFORM pg_temp.act(p_user);
    END IF;
    BEGIN
        PERFORM finance.read_seller_tax_report(p_year);
    EXCEPTION WHEN OTHERS THEN
        v := SQLSTATE;
    END;
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.read_as(p_user uuid, p_year integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    PERFORM pg_temp.act(p_user);
    v := finance.read_seller_tax_report(p_year);
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

-- One seller's row for a quarter in a reader's answer.
CREATE FUNCTION pg_temp.row_of(p_read jsonb, p_type text, p_id uuid, p_quarter integer) RETURNS jsonb
LANGUAGE sql AS $$
    SELECT r FROM jsonb_array_elements(p_read -> 'rows') r
     WHERE r ->> 'seller_type' = p_type AND (r ->> 'seller_id')::uuid = p_id
       AND (r ->> 'quarter')::integer = p_quarter AND r ->> 'currency' = 'GBP';
$$;

CREATE FUNCTION pg_temp.expect(
    p_read jsonb, p_label text, p_type text, p_id uuid, p_quarter integer,
    p_credited bigint, p_fees bigint, p_activities integer
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb := pg_temp.row_of(p_read, p_type, p_id, p_quarter);
BEGIN
    PERFORM pg_temp.check(
        r IS NOT NULL
        AND (r ->> 'credited_minor')::bigint = p_credited
        AND (r ->> 'fees_minor')::bigint = p_fees
        AND (r ->> 'gross_minor')::bigint = p_credited + p_fees
        AND (r ->> 'activities')::integer = p_activities,
        p_label || ': credited ' || p_credited || ', fees ' || p_fees || ', ' || p_activities || ' activities'
            || ' (got ' || COALESCE(r::text, 'no row') || ')');
END $$;

-- An instant in 2009 (UTC).
CREATE FUNCTION pg_temp.at(p_month integer, p_day integer) RETURNS timestamptz LANGUAGE sql AS $$
    SELECT make_timestamptz(2009, p_month, p_day, 12, 0, 0, 'UTC');
$$;

-- One ledger credit (or debit) written straight in, at a chosen instant.
CREATE FUNCTION pg_temp.post(
    p_wallet uuid, p_amount bigint, p_reason text, p_ref_table text, p_ref uuid, p_at timestamptz,
    p_direction text DEFAULT 'credit'
) RETURNS void LANGUAGE sql AS $$
    INSERT INTO finance.transactions (wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id,
                                      balance_after_cents, created_at)
    VALUES (p_wallet, p_direction, p_amount, 'GBP', p_reason, p_ref_table, p_ref, p_amount, p_at);
$$;

DO $$
DECLARE
    v_project uuid; v_stage uuid; v_payer uuid; v_payee uuid; v_mate uuid; v_team uuid;
    v_member uuid; v_op uuid;
    v_e1 uuid; v_e2 uuid; v_e3 uuid;
    w_payee uuid; w_mate uuid; w_team uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM finance.transactions t
                WHERE t.created_at >= make_timestamptz(2009, 1, 1, 0, 0, 0, 'UTC')
                  AND t.created_at < make_timestamptz(2010, 1, 1, 0, 0, 0, 'UTC')) THEN
        RAISE EXCEPTION 'FAIL no fixture: the ledger already holds a 2009 row';
    END IF;
    SELECT p.id INTO v_project FROM projects.projects p
     WHERE p.owner_user_id IS NOT NULL AND p.status::text NOT IN ('cancelled', 'archived')
     ORDER BY p.id LIMIT 1;
    SELECT t.id INTO v_team FROM org.teams t ORDER BY t.id LIMIT 1;
    SELECT fp.user_id INTO v_payee FROM org.freelancer_profiles fp ORDER BY fp.user_id LIMIT 1;
    SELECT fp.user_id INTO v_mate FROM org.freelancer_profiles fp WHERE fp.user_id <> v_payee
     ORDER BY fp.user_id LIMIT 1;
    SELECT u.user_id INTO v_payer FROM org.users_public u
     WHERE u.user_id NOT IN (v_payee, v_mate)
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_member FROM org.users_public u
     WHERE u.user_id NOT IN (v_payee, v_mate, v_payer)
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_op FROM org.users_public u
     WHERE u.user_id NOT IN (v_payee, v_mate, v_payer, v_member)
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    IF v_project IS NULL OR v_team IS NULL OR v_mate IS NULL OR v_op IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a live project, a team, two freelancers and three other users (deno task db:reset)';
    END IF;
    INSERT INTO ops.admin_users (user_id) VALUES (v_op) ON CONFLICT DO NOTHING;
    UPDATE org.users_public SET country = 'GB' WHERE user_id = v_payee;
    IF NOT EXISTS (SELECT 1 FROM finance.payout_accounts pa WHERE pa.owner_type = 'freelancer' AND pa.owner_id = v_payee) THEN
        INSERT INTO finance.payout_accounts (owner_type, owner_id, provider, account_id, status)
        VALUES ('freelancer', v_payee, 'stripe', 'acct_probe_lg6_payee', 'verified');
    END IF;
    PERFORM set_config('probe.acct', (SELECT pa.account_id FROM finance.payout_accounts pa
                                       WHERE pa.owner_type = 'freelancer' AND pa.owner_id = v_payee
                                       ORDER BY pa.created_at DESC LIMIT 1), true);
    PERFORM set_config('probe.payee', v_payee::text, true);
    PERFORM set_config('probe.mate', v_mate::text, true);
    PERFORM set_config('probe.team', v_team::text, true);
    PERFORM set_config('probe.member', v_member::text, true);
    PERFORM set_config('probe.op', v_op::text, true);

    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Seller tax probe', 996, 'open', 10000) RETURNING id INTO v_stage;
    -- E1: a direct payee's escrow, 10,500 less a 500 fee, paid out 10,000.
    INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id, amount_cents,
                                 platform_fee_cents, currency, status, created_at, released_at)
    VALUES (v_stage, v_payer, 'freelancer', v_payee, 10500, 500, 'GBP', 'released', pg_temp.at(1, 5), pg_temp.at(2, 3))
    RETURNING id INTO v_e1;
    -- E2: a team's escrow, 20,000 less a 1,000 fee, paid out 19,000: 12,000 · 6,000 · the vault's 1,000.
    INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id, amount_cents,
                                 platform_fee_cents, currency, status, created_at, released_at)
    VALUES (v_stage, v_payer, 'team', v_team, 20000, 1000, 'GBP', 'released', pg_temp.at(4, 1), pg_temp.at(4, 25))
    RETURNING id INTO v_e2;
    -- E3: a team's escrow, fee 100, paid out 2,000: the payee's 1,000 has matured, the mate's has not.
    INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id, amount_cents,
                                 platform_fee_cents, currency, status, created_at, released_at)
    VALUES (v_stage, v_payer, 'team', v_team, 2100, 100, 'GBP', 'released', pg_temp.at(10, 1), pg_temp.at(10, 20))
    RETURNING id INTO v_e3;

    w_payee := finance.fn_ensure_wallet('freelancer', v_payee, 'GBP');
    w_mate := finance.fn_ensure_wallet('freelancer', v_mate, 'GBP');
    w_team := finance.fn_ensure_wallet('team', v_team, 'GBP');
    SELECT id INTO w_payee FROM finance.wallets WHERE owner_type = 'freelancer' AND owner_id = v_payee AND currency = 'GBP';
    SELECT id INTO w_mate FROM finance.wallets WHERE owner_type = 'freelancer' AND owner_id = v_mate AND currency = 'GBP';
    SELECT id INTO w_team FROM finance.wallets WHERE owner_type = 'team' AND owner_id = v_team AND currency = 'GBP';

    PERFORM pg_temp.post(w_payee, 10000, 'escrow_release', 'escrows', v_e1, pg_temp.at(2, 10));
    PERFORM pg_temp.post(w_mate, 12000, 'team_split', 'escrows', v_e2, pg_temp.at(5, 2));
    PERFORM pg_temp.post(w_payee, 6000, 'team_split', 'escrows', v_e2, pg_temp.at(5, 2));
    PERFORM pg_temp.post(w_team, 1000, 'escrow_release_vault_retention', 'escrows', v_e2, pg_temp.at(5, 2));
    PERFORM pg_temp.post(w_payee, 1000, 'team_split', 'escrows', v_e3, pg_temp.at(10, 27));
    INSERT INTO finance.pending_releases (escrow_id, wallet_id, reason, amount_cents, currency, released_at,
                                          available_at, state)
    VALUES (v_e3, w_mate, 'team_split', 1000, 'GBP', pg_temp.at(12, 29), pg_temp.at(12, 29) + interval '7 days', 'pending');
    -- Not income: a top-up, and a debit under an income word; and an income credit a year later.
    PERFORM pg_temp.post(w_payee, 777, 'topup', 'inbound_payments', gen_random_uuid(), pg_temp.at(3, 1));
    PERFORM pg_temp.post(w_payee, 55, 'escrow_release', 'escrows', v_e1, pg_temp.at(3, 2), 'debit');
    INSERT INTO finance.transactions (wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id,
                                      balance_after_cents, created_at)
    VALUES (w_payee, 'credit', 999, 'GBP', 'escrow_release', 'escrows', gen_random_uuid(), 999,
            make_timestamptz(2010, 1, 1, 0, 0, 1, 'UTC'));
END $$;
-- #endregion

-- #region 1. Grants and shape
DO $$
DECLARE
    v_door oid := 'finance.read_seller_tax_report(integer)'::regprocedure;
    v_core oid := 'finance.fn_seller_tax_report(integer)'::regprocedure;
BEGIN
    PERFORM pg_temp.check(
        (SELECT p.provolatile = 's' AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
           FROM pg_proc p WHERE p.oid = v_door),
        '1a read_seller_tax_report is a STABLE definer with an empty search_path');
    PERFORM pg_temp.check(
        (SELECT p.provolatile = 's' AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
           FROM pg_proc p WHERE p.oid = v_core),
        '1b fn_seller_tax_report is STABLE (it cannot write), runs as its caller, with an empty search_path');
    PERFORM pg_temp.check(
        has_function_privilege('authenticated', v_door, 'EXECUTE')
        AND NOT has_function_privilege('anon', v_door, 'EXECUTE'),
        '1c the operator door: authenticated may call it, anon may not');
    PERFORM pg_temp.check(
        NOT has_function_privilege('anon', v_core, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', v_core, 'EXECUTE'),
        '1d the internal reader: no client role may call it');
END $$;
-- #endregion

-- #region 2. The gate
DO $$
DECLARE
    v_member uuid := current_setting('probe.member')::uuid;
    v_payee uuid := current_setting('probe.payee')::uuid;
    v_op uuid := current_setting('probe.op')::uuid;
    v jsonb;
BEGIN
    PERFORM pg_temp.check(pg_temp.read_state(v_member, 2009) = '42501', '2a a member is refused (42501)');
    PERFORM pg_temp.check(pg_temp.read_state(v_payee, 2009) = '42501', '2b the seller themself is refused (42501)');
    PERFORM pg_temp.check(pg_temp.read_state(NULL, 2009, true) = '42501', '2c a caller with no JWT is refused (42501)');
    PERFORM pg_temp.check(pg_temp.read_state(v_op, 2009) = '', '2d an operator is answered');
    PERFORM pg_temp.check(pg_temp.read_state(v_op, NULL) = '22023' AND pg_temp.read_state(v_op, 1999) = '22023',
        '2e a year that is not one is refused (22023)');
    v := pg_temp.read_as(v_op, 2009);
    PERFORM pg_temp.check(v = finance.fn_seller_tax_report(2009),
        '2f the operator door answers exactly what the internal reader computes');
    PERFORM pg_temp.check((v ->> 'year')::integer = 2009 AND jsonb_typeof(v -> 'rows') = 'array',
        '2g the answer carries its year and a rows array');
END $$;
-- #endregion

-- #region 3. The figures on a fixture
DO $$
DECLARE
    v jsonb := finance.fn_seller_tax_report(2009);
    v_payee uuid := current_setting('probe.payee')::uuid;
    v_mate uuid := current_setting('probe.mate')::uuid;
    v_team uuid := current_setting('probe.team')::uuid;
    r jsonb;
BEGIN
    PERFORM pg_temp.expect(v, '3a a direct payee carries its escrow''s whole fee (Q1)', 'freelancer', v_payee, 1, 10000, 500, 1);
    -- 1,000 × 6,000 / 19,000 = 315.8 → 315; 1,000 × 12,000 / 19,000 = 631.6 → 631; the vault 52.
    PERFORM pg_temp.expect(v, '3b a team member''s share of the team escrow''s fee (Q2)', 'freelancer', v_payee, 2, 6000, 315, 1);
    PERFORM pg_temp.expect(v, '3c the other member''s share (Q2)', 'freelancer', v_mate, 2, 12000, 631, 1);
    PERFORM pg_temp.expect(v, '3d the team''s vault is a seller too (Q2)', 'team', v_team, 2, 1000, 52, 1);
    -- E3 paid out 2,000, half still pending: the matured half carries half the fee, never all of it.
    PERFORM pg_temp.expect(v, '3e an unmatured release still counts in its escrow''s denominator (Q4)', 'freelancer', v_payee, 4, 1000, 50, 1);
    PERFORM pg_temp.check(pg_temp.row_of(v, 'freelancer', v_mate, 4) IS NULL,
        '3f money still pending is not yet credited, so it has no row');
    PERFORM pg_temp.check(pg_temp.row_of(v, 'freelancer', v_payee, 3) IS NULL
                          AND (pg_temp.row_of(v, 'freelancer', v_payee, 1) ->> 'credited_minor')::bigint = 10000,
        '3g a top-up, a debit and a credit dated 2010 are left out');
    r := pg_temp.row_of(v, 'freelancer', v_payee, 1);
    PERFORM pg_temp.check(r ->> 'profile_country' = 'GB' AND r ->> 'payout_provider' = 'stripe'
                          AND r ->> 'payout_account_id' = current_setting('probe.acct'),
        '3h the row carries the seller''s profile country and Stripe account reference');
    r := pg_temp.row_of(v, 'team', v_team, 2);
    PERFORM pg_temp.check(r ? 'profile_country' AND r ->> 'profile_country' IS NULL,
        '3i a team holds no country, and says so with a null');
    PERFORM pg_temp.check(
        (SELECT (r2 ->> 'activities')::integer FROM jsonb_array_elements(finance.fn_seller_tax_report(2010) -> 'rows') r2
          WHERE (r2 ->> 'seller_id')::uuid = v_payee AND r2 ->> 'currency' = 'GBP') = 1,
        '3j the credit dated 2010 opens 2010''s report instead');
END $$;
-- #endregion

-- #region 4. The seed's sellers match the ledger
DO $$
DECLARE
    v_year integer;
    v jsonb;
    v_bad integer;
BEGIN
    SELECT extract(year FROM max(t.created_at) AT TIME ZONE 'UTC')::integer INTO v_year
      FROM finance.transactions t
     WHERE t.direction = 'credit' AND finance.fn_is_income_reason(t.reason)
       AND t.created_at >= make_timestamptz(2011, 1, 1, 0, 0, 0, 'UTC');
    IF v_year IS NULL THEN
        RAISE EXCEPTION 'FAIL no seeded earnings (deno task db:reset)';
    END IF;
    v := finance.fn_seller_tax_report(v_year);
    PERFORM pg_temp.check(jsonb_array_length(v -> 'rows') > 0, '4a the seed''s newest year has seller rows (' || v_year || ')');

    -- Each row's credit and activity count, against the ledger summed independently.
    SELECT count(*) INTO v_bad
      FROM jsonb_array_elements(v -> 'rows') r
      FULL JOIN (
          SELECT w.owner_type, w.owner_id, t.currency,
                 extract(quarter FROM t.created_at AT TIME ZONE 'UTC')::integer AS quarter,
                 sum(t.amount_cents) AS credited, count(DISTINCT (t.ref_table, t.ref_id)) AS activities
            FROM finance.transactions t JOIN finance.wallets w ON w.id = t.wallet_id
           WHERE t.direction = 'credit' AND finance.fn_is_income_reason(t.reason)
             AND extract(year FROM t.created_at AT TIME ZONE 'UTC') = v_year
           GROUP BY 1, 2, 3, 4
      ) l ON l.owner_type = r ->> 'seller_type' AND l.owner_id = (r ->> 'seller_id')::uuid
         AND l.currency = r ->> 'currency' AND l.quarter = (r ->> 'quarter')::integer
     WHERE l.credited IS DISTINCT FROM (r ->> 'credited_minor')::bigint
        OR l.activities IS DISTINCT FROM (r ->> 'activities')::bigint;
    PERFORM pg_temp.check(v_bad = 0, '4b every row''s credit and activity count is the ledger''s own sum');

    -- A seller paid only as an escrow's direct payee carries exactly those escrows' recorded fees.
    SELECT count(*) INTO v_bad
      FROM (
          SELECT w.owner_type, w.owner_id, t.currency,
                 extract(quarter FROM t.created_at AT TIME ZONE 'UTC')::integer AS quarter,
                 sum(e.platform_fee_cents) AS fee
            FROM finance.transactions t
            JOIN finance.wallets w ON w.id = t.wallet_id
            JOIN finance.escrows e ON e.id = t.ref_id AND t.ref_table = 'escrows'
           WHERE t.direction = 'credit' AND t.reason = 'escrow_release' AND e.payee_id = w.owner_id
             AND extract(year FROM t.created_at AT TIME ZONE 'UTC') = v_year
             AND NOT EXISTS (SELECT 1 FROM finance.transactions t2
                              WHERE t2.ref_id = t.ref_id AND t2.id <> t.id AND t2.direction = 'credit')
           GROUP BY 1, 2, 3, 4
      ) d
      JOIN jsonb_array_elements(v -> 'rows') r
        ON d.owner_type = r ->> 'seller_type' AND d.owner_id = (r ->> 'seller_id')::uuid
       AND d.currency = r ->> 'currency' AND d.quarter = (r ->> 'quarter')::integer
     WHERE NOT EXISTS (SELECT 1 FROM finance.transactions t3 JOIN finance.wallets w3 ON w3.id = t3.wallet_id
                        WHERE w3.owner_id = d.owner_id AND t3.direction = 'credit'
                          AND finance.fn_is_income_reason(t3.reason) AND t3.reason <> 'escrow_release'
                          AND extract(year FROM t3.created_at AT TIME ZONE 'UTC') = v_year)
       AND d.fee <> (r ->> 'fees_minor')::bigint;
    PERFORM pg_temp.check(v_bad = 0, '4c a direct payee''s fees are its escrows'' recorded platform fees');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM finance.transactions t JOIN finance.escrows e ON e.id = t.ref_id
                 WHERE t.ref_table = 'escrows' AND t.reason = 'escrow_release' AND e.platform_fee_cents > 0
                   AND extract(year FROM t.created_at AT TIME ZONE 'UTC') = v_year),
        '4d the seed holds a direct payee with a fee, so 4c tested something');

    -- Each released escrow's shares, across every seller it paid, fall short of its fee by less than
    -- one minor unit per credit (each share is floored), and never exceed it.
    SELECT count(*) INTO v_bad
      FROM finance.escrows e
      JOIN LATERAL (
          SELECT count(*) AS n, sum(f.fee) AS shares
            FROM (SELECT div(e.platform_fee_cents::numeric * t.amount_cents,
                             sum(t.amount_cents) OVER ())::bigint AS fee
                    FROM finance.transactions t
                   WHERE t.ref_table = 'escrows' AND t.ref_id = e.id AND t.direction = 'credit'
                     AND finance.fn_is_income_reason(t.reason)) f
      ) s ON s.n > 0
     WHERE e.status = 'released'
       AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.escrow_id = e.id AND pr.state <> 'available')
       AND (s.shares > e.platform_fee_cents OR e.platform_fee_cents - s.shares >= s.n);
    PERFORM pg_temp.check(v_bad = 0, '4e each escrow''s fee shares add up to its fee, short by under one unit per credit');

    -- Each seeded order: its sellers' fees are exactly its lines' fees, and credit + fee is exactly
    -- what the buyer paid for each seller's lines.
    SELECT count(*) INTO v_bad
      FROM (
          SELECT t.ref_id AS order_id, w.owner_type, w.owner_id, sum(t.amount_cents) AS credited
            FROM finance.transactions t JOIN finance.wallets w ON w.id = t.wallet_id
           WHERE t.ref_table = 'orders' AND t.reason = 'product_sale' AND t.direction = 'credit'
           GROUP BY 1, 2, 3
      ) s
      JOIN LATERAL (
          SELECT sum(ol.platform_fee_minor) AS fee, sum(ol.line_total_minor - ol.promo_discount_minor) AS paid
            FROM finance.order_lines ol JOIN catalogue.products p ON p.id = ol.item_id
           WHERE ol.order_id = s.order_id AND ol.item_type = 'digital_product'
             AND COALESCE(p.owner_team_id, p.owner_user_id) = s.owner_id
      ) l ON true
     WHERE l.fee IS NULL OR s.credited + l.fee <> l.paid;
    PERFORM pg_temp.check(v_bad = 0, '4f each order''s seller credit plus its lines'' fee is what the buyer paid for them');
    SELECT count(*) INTO v_bad
      FROM (SELECT DISTINCT t.ref_id AS order_id FROM finance.transactions t
             WHERE t.ref_table = 'orders' AND t.reason = 'product_sale'
               AND extract(year FROM t.created_at AT TIME ZONE 'UTC') = v_year) o
     WHERE (SELECT sum(ol.platform_fee_minor) FROM finance.order_lines ol
             WHERE ol.order_id = o.order_id AND ol.item_type = 'digital_product')
        <> (SELECT sum((r ->> 'fees_minor')::bigint) FILTER (WHERE true)
              FROM (SELECT DISTINCT w.owner_type, w.owner_id FROM finance.transactions t JOIN finance.wallets w ON w.id = t.wallet_id
                     WHERE t.ref_id = o.order_id AND t.reason = 'product_sale') s
              JOIN LATERAL (
                  SELECT jsonb_build_object('fees_minor', sum(ol.platform_fee_minor)) AS r
                    FROM finance.order_lines ol JOIN catalogue.products p ON p.id = ol.item_id
                   WHERE ol.order_id = o.order_id AND ol.item_type = 'digital_product'
                     AND COALESCE(p.owner_team_id, p.owner_user_id) = s.owner_id) x ON true);
    PERFORM pg_temp.check(v_bad = 0, '4g no order''s line fee is left unattributed or counted twice');
END $$;
-- #endregion

-- #region 5. It moves nothing
DO $$
DECLARE
    v_op uuid := current_setting('probe.op')::uuid;
    v_before text; v_after text;
BEGIN
    SELECT format('%s|%s|%s', (SELECT count(*) FROM finance.transactions),
                  (SELECT COALESCE(sum(balance_cents), 0) FROM finance.wallets),
                  (SELECT count(*) FROM finance.pending_releases))
      INTO v_before;
    PERFORM finance.fn_seller_tax_report(2009);
    PERFORM pg_temp.read_as(v_op, 2009);
    SELECT format('%s|%s|%s', (SELECT count(*) FROM finance.transactions),
                  (SELECT COALESCE(sum(balance_cents), 0) FROM finance.wallets),
                  (SELECT count(*) FROM finance.pending_releases))
      INTO v_after;
    PERFORM pg_temp.check(v_before = v_after, '5a the reads leave the ledger, the wallets and the releases unchanged');
END $$;
-- #endregion

ROLLBACK;
