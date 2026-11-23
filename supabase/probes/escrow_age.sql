-- =============================================================================================
-- Probe: the escrow-age reader (00001200 "Escrow age", MR7) — how long held money has sat in the
-- platform balance, per kind and currency, for the counsel brief on ruling M2 (Decision #337,
-- PRD-F15; FOUNDER_QUESTIONNAIRE.md Part D).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/escrow_age.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. The fixture is built
-- in the first settlement currency that holds no escrow and no pending release, so the seed's own
-- rows never move the figures this probe asserts; every age is a whole number of 24-hour days before
-- the transaction's now().
--
--   1  grants and shape: the operator door is a STABLE definer with a pinned search_path that
--      authenticated may call and anon may not; the internal reader is STABLE and no client role
--      may call it
--   2  the gate: a member, and a caller with no JWT, get 42501; an operator gets the same figures
--      the internal reader computes at now()
--   3  the ages on a fixture: each kind's count, total, oldest, p50 / p90 / max and the over-30 /
--      60 / 90 counts and sums; rows a reader must not count (released, refunded, a matured or
--      fully recovered release) are left out; a row created after the clock ages 0
--   4  it moves nothing: the ledger, every wallet balance and every escrow status are unchanged by
--      the reads (MR7 adds no money flow, so there is no conservation term to add)
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

-- The SQLSTATE `finance.read_escrow_age()` raises for p_user ('' when it answers). p_user NULL with
-- p_authenticated: the authenticated role with no JWT subject.
CREATE FUNCTION pg_temp.read_state(p_user uuid, p_authenticated boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text := '';
BEGIN
    IF p_user IS NULL AND p_authenticated THEN
        PERFORM set_config('request.jwt.claims', '', true);
        PERFORM set_config('role', 'authenticated', true);
    ELSE
        PERFORM pg_temp.act(p_user);
    END IF;
    BEGIN
        PERFORM finance.read_escrow_age();
    EXCEPTION WHEN OTHERS THEN
        v := SQLSTATE;
    END;
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

-- The operator door's answer for p_user.
CREATE FUNCTION pg_temp.read_as(p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    PERFORM pg_temp.act(p_user);
    v := finance.read_escrow_age();
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

-- `p_days` whole 24-hour days before the transaction's clock (no calendar arithmetic, so no DST).
CREATE FUNCTION pg_temp.ago(p_days integer) RETURNS timestamptz LANGUAGE sql AS $$
    SELECT now() - make_interval(hours => p_days * 24);
$$;

-- The fixture currency's row of one kind, from a reader's answer.
CREATE FUNCTION pg_temp.row_of(p_read jsonb, p_kind text) RETURNS jsonb LANGUAGE sql AS $$
    SELECT r FROM jsonb_array_elements(p_read -> 'rows') r
     WHERE r ->> 'currency' = current_setting('probe.currency') AND r ->> 'kind' = p_kind;
$$;

-- One kind's figures, asserted in one place: count, total, oldest, p50, p90, max, then the
-- over-30 / 60 / 90 count and total pairs.
CREATE FUNCTION pg_temp.expect(
    p_read jsonb, p_label text, p_kind text, p_count integer, p_total bigint, p_oldest_days integer,
    p_p50 numeric, p_p90 numeric, p_max numeric,
    p_c30 integer, p_t30 bigint, p_c60 integer, p_t60 bigint, p_c90 integer, p_t90 bigint
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    r jsonb := pg_temp.row_of(p_read, p_kind);
BEGIN
    PERFORM pg_temp.check(r IS NOT NULL, p_label || ' has a row');
    PERFORM pg_temp.check((r ->> 'count')::integer = p_count AND (r ->> 'total_minor')::bigint = p_total,
        p_label || ' count ' || p_count || ' and total ' || p_total);
    PERFORM pg_temp.check((r ->> 'oldest_at')::timestamptz = pg_temp.ago(p_oldest_days),
        p_label || ' oldest is ' || p_oldest_days || ' days old');
    PERFORM pg_temp.check((r ->> 'p50_days')::numeric = p_p50 AND (r ->> 'p90_days')::numeric = p_p90
                          AND (r ->> 'max_days')::numeric = p_max,
        p_label || ' p50 ' || p_p50 || ' · p90 ' || p_p90 || ' · max ' || p_max);
    PERFORM pg_temp.check(
        (r #>> '{over,0,days}')::integer = 30 AND (r #>> '{over,0,count}')::integer = p_c30
        AND (r #>> '{over,0,total_minor}')::bigint = p_t30
        AND (r #>> '{over,1,days}')::integer = 60 AND (r #>> '{over,1,count}')::integer = p_c60
        AND (r #>> '{over,1,total_minor}')::bigint = p_t60
        AND (r #>> '{over,2,days}')::integer = 90 AND (r #>> '{over,2,count}')::integer = p_c90
        AND (r #>> '{over,2,total_minor}')::bigint = p_t90,
        p_label || ' over 30/60/90: ' || p_c30 || '/' || p_t30 || ' · ' || p_c60 || '/' || p_t60
            || ' · ' || p_c90 || '/' || p_t90);
END $$;

DO $$
DECLARE
    v_cur text; v_project uuid; v_stage uuid; v_payer uuid; v_payee uuid; v_member uuid; v_op uuid;
    v_t1 uuid; v_t2 uuid; v_cohort uuid; v_seat1 uuid; v_seat2 uuid; v_wallet uuid; v_source uuid;
    v_case uuid;
BEGIN
    SELECT c INTO v_cur
      FROM unnest(ARRAY['ZAR', 'CHF', 'SGD', 'JPY', 'CAD', 'AUD', 'EUR', 'GBP', 'USD']) WITH ORDINALITY AS u (c, n)
     WHERE NOT EXISTS (SELECT 1 FROM finance.escrows e WHERE e.currency = u.c)
       AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.currency = u.c)
     ORDER BY n LIMIT 1;
    -- A project no bought-service trigger acts on: the owner's own, or one still live.
    SELECT p.id INTO v_project FROM projects.projects p
     WHERE p.owner_user_id IS NOT NULL AND p.status::text NOT IN ('cancelled', 'archived')
     ORDER BY p.id LIMIT 1;
    SELECT fp.user_id INTO v_payee FROM org.freelancer_profiles fp ORDER BY fp.user_id LIMIT 1;
    SELECT u.user_id INTO v_payer FROM org.users_public u
     WHERE u.user_id <> v_payee AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_member FROM org.users_public u
     WHERE u.user_id NOT IN (v_payee, v_payer)
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_op FROM org.users_public u
     WHERE u.user_id NOT IN (v_payee, v_payer, v_member)
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    IF v_cur IS NULL OR v_project IS NULL OR v_op IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a free settlement currency, a live project and four users (deno task db:reset)';
    END IF;
    INSERT INTO ops.admin_users (user_id) VALUES (v_op) ON CONFLICT DO NOTHING;
    PERFORM set_config('probe.currency', v_cur, true);
    PERFORM set_config('probe.member', v_member::text, true);
    PERFORM set_config('probe.op', v_op::text, true);

    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Escrow age probe', 995, 'open', 10000) RETURNING id INTO v_stage;
    INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_project, v_stage, 'backlog', 'Escrow age probe T1', '{"t":"x"}', 'A description.',
            jsonb_build_array(jsonb_build_object('stage_id', v_stage, 'order', 0)))
    RETURNING id INTO v_t1;
    INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_project, NULL, 'backlog', 'Escrow age probe T2', '{"t":"x"}', 'A description.',
            jsonb_build_array(jsonb_build_object('stage_id', v_stage, 'order', 0)))
    RETURNING id INTO v_t2;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (v_project, v_stage, 'Escrow age probe cohort') RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_payer) RETURNING id INTO v_seat1;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_member) RETURNING id INTO v_seat2;

    -- held_bound: five escrows for a named payee, 10 · 31 · 45 · 61 · 95 days old.
    INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id, amount_cents, currency, status, created_at)
    SELECT v_stage, v_payer, 'freelancer', v_payee, a, v_cur, 'held', pg_temp.ago(d)
      FROM (VALUES (10, 100), (31, 200), (45, 300), (61, 400), (95, 500)) AS f (d, a);
    -- held_prepaid: one unclaimed ticket escrow, 5 days old, with its refund clock.
    INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_user_id, amount_cents, currency, status, created_at, expires_at)
    VALUES (v_stage, v_t1, v_payer, 700, v_cur, 'held', pg_temp.ago(5), now() + interval '2 days');
    -- held_seat: one seat 20 days old, and one created after the clock (it ages 0, never negative).
    INSERT INTO finance.escrows (project_stage_id, cohort_membership_id, payer_user_id, payee_type, payee_id, amount_cents, currency, status, created_at)
    VALUES (v_stage, v_seat1, v_payer, 'freelancer', v_payee, 800, v_cur, 'held', pg_temp.ago(20)),
           (v_stage, v_seat2, v_member, 'freelancer', v_payee, 50, v_cur, 'held', now() + interval '2 days');
    -- reserved: a later stage paid for ahead, 100 days ago.
    INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_user_id, amount_cents, currency, status, created_at)
    VALUES (v_stage, v_t2, v_payer, 900, v_cur, 'reserved', pg_temp.ago(100));
    -- disputed: 40 days old.
    INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id, amount_cents, currency, status, created_at)
    VALUES (v_stage, v_payer, 'freelancer', v_payee, 1000, v_cur, 'disputed', pg_temp.ago(40));
    -- Not counted: a released escrow (the source of the releases below) and a refunded one, both old.
    INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id, amount_cents, currency, status, created_at, released_at)
    VALUES (v_stage, v_payer, 'freelancer', v_payee, 5000, v_cur, 'released', pg_temp.ago(200), pg_temp.ago(9))
    RETURNING id INTO v_source;
    INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id, amount_cents, currency, status, created_at)
    VALUES (v_stage, v_payer, 'freelancer', v_payee, 6000, v_cur, 'refunded', pg_temp.ago(300));

    -- The releases: one pending 3 days with 100 recovered (1,000 outstanding), one frozen 8 days, and
    -- two that are not money still held — a fully recovered row and a matured one.
    v_wallet := (SELECT finance.fn_ensure_wallet('freelancer', v_payee, v_cur));
    IF v_wallet IS NULL THEN
        SELECT w.id INTO v_wallet FROM finance.wallets w
         WHERE w.owner_type = 'freelancer' AND w.owner_id = v_payee AND w.currency = v_cur;
    END IF;
    -- A frozen row names the card dispute that froze it (ck_pending_releases_hold_case, ruling M3).
    INSERT INTO finance.chargebacks (wallet_id, provider_ref, amount_cents, currency)
    VALUES (v_wallet, 'dp_probe_escrow_age', 1200, v_cur)
    RETURNING id INTO v_case;
    INSERT INTO finance.pending_releases (escrow_id, wallet_id, reason, amount_cents, recovered_cents, currency,
                                          released_at, available_at, state, matured_at, hold_chargeback_id)
    VALUES (v_source, v_wallet, 'escrow_release', 1100, 100, v_cur, pg_temp.ago(3), pg_temp.ago(3) + interval '7 days', 'pending', NULL, NULL),
           (v_source, v_wallet, 'escrow_release', 1200, 0, v_cur, pg_temp.ago(8), pg_temp.ago(8) + interval '7 days', 'on_hold', NULL, v_case),
           (v_source, v_wallet, 'escrow_release', 50, 50, v_cur, pg_temp.ago(4), pg_temp.ago(4) + interval '7 days', 'pending', NULL, NULL),
           (v_source, v_wallet, 'escrow_release', 70, 0, v_cur, pg_temp.ago(30), pg_temp.ago(23), 'available', pg_temp.ago(23), NULL);
END $$;
-- #endregion

-- #region 1. Grants and shape
DO $$
DECLARE
    v_door oid := 'finance.read_escrow_age()'::regprocedure;
    v_core oid := 'finance.fn_escrow_age(timestamptz)'::regprocedure;
BEGIN
    PERFORM pg_temp.check(
        (SELECT p.provolatile = 's' AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
           FROM pg_proc p WHERE p.oid = v_door),
        '1a read_escrow_age is a STABLE definer with an empty search_path');
    PERFORM pg_temp.check(
        (SELECT p.provolatile = 's' AND NOT p.prosecdef FROM pg_proc p WHERE p.oid = v_core),
        '1b fn_escrow_age is STABLE (it cannot write) and runs as its caller');
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
    v_op uuid := current_setting('probe.op')::uuid;
    v jsonb;
BEGIN
    PERFORM pg_temp.check(pg_temp.read_state(v_member) = '42501', '2a a member is refused (42501)');
    PERFORM pg_temp.check(pg_temp.read_state(NULL, true) = '42501', '2b a caller with no JWT is refused (42501)');
    PERFORM pg_temp.check(pg_temp.read_state(v_op) = '', '2c an operator is answered');
    v := pg_temp.read_as(v_op);
    PERFORM pg_temp.check(v = finance.fn_escrow_age(now()),
        '2d the operator door answers exactly what the internal reader computes at now()');
    PERFORM pg_temp.check((v ->> 'as_of')::timestamptz = now() AND jsonb_typeof(v -> 'rows') = 'array',
        '2e the answer carries its clock and a rows array');
END $$;
-- #endregion

-- #region 3. The ages on a fixture
DO $$
DECLARE
    v jsonb := finance.fn_escrow_age(now());
    v_kinds text[];
BEGIN
    SELECT array_agg(r ->> 'kind' ORDER BY ord) INTO v_kinds
      FROM jsonb_array_elements(v -> 'rows') WITH ORDINALITY AS x (r, ord)
     WHERE r ->> 'currency' = current_setting('probe.currency');
    PERFORM pg_temp.check(
        v_kinds = ARRAY['held_bound', 'held_prepaid', 'held_seat', 'reserved', 'disputed', 'pending', 'on_hold'],
        '3a seven kinds, in clock order, and no row for released or refunded money');
    PERFORM pg_temp.check(
        NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v -> 'rows') WITH ORDINALITY AS a (r, i)
              JOIN jsonb_array_elements(v -> 'rows') WITH ORDINALITY AS b (s, j) ON j = i + 1
             WHERE (a.r ->> 'currency') > (b.s ->> 'currency')),
        '3b rows are grouped by currency');
    -- p90 of 10 · 31 · 45 · 61 · 95 interpolates at position 3.6: 61 + 0.6 × 34 = 81.4.
    PERFORM pg_temp.expect(v, '3c held_bound', 'held_bound', 5, 1500, 95, 45.0, 81.4, 95.0, 4, 1400, 2, 900, 1, 500);
    PERFORM pg_temp.expect(v, '3d held_prepaid', 'held_prepaid', 1, 700, 5, 5.0, 5.0, 5.0, 0, 0, 0, 0, 0, 0);
    -- 20 days and a row after the clock (0): p50 10, p90 0 + 0.9 × 20 = 18.
    PERFORM pg_temp.expect(v, '3e held_seat (a row after the clock ages 0)', 'held_seat', 2, 850, 20, 10.0, 18.0, 20.0, 0, 0, 0, 0, 0, 0);
    PERFORM pg_temp.expect(v, '3f reserved (no clock)', 'reserved', 1, 900, 100, 100.0, 100.0, 100.0, 1, 900, 1, 900, 1, 900);
    PERFORM pg_temp.expect(v, '3g disputed', 'disputed', 1, 1000, 40, 40.0, 40.0, 40.0, 1, 1000, 0, 0, 0, 0);
    -- 1,100 − 100 recovered; the fully recovered row and the matured one are not held money.
    PERFORM pg_temp.expect(v, '3h pending (outstanding only)', 'pending', 1, 1000, 3, 3.0, 3.0, 3.0, 0, 0, 0, 0, 0, 0);
    PERFORM pg_temp.expect(v, '3i on_hold', 'on_hold', 1, 1200, 8, 8.0, 8.0, 8.0, 0, 0, 0, 0, 0, 0);
    -- Ten days on, every row is ten days older: the oldest bound escrow 105, the seat 30, the pending
    -- release 13, while the prepaid hold (15) and the dispute (50) stay under their next thresholds.
    v := finance.fn_escrow_age(now() + make_interval(hours => 240));
    PERFORM pg_temp.check(
        (pg_temp.row_of(v, 'held_bound') ->> 'max_days')::numeric = 105.0
        AND (pg_temp.row_of(v, 'held_prepaid') #>> '{over,0,count}')::integer = 0
        AND (pg_temp.row_of(v, 'held_seat') ->> 'max_days')::numeric = 30.0
        AND (pg_temp.row_of(v, 'disputed') #>> '{over,1,count}')::integer = 0
        AND (pg_temp.row_of(v, 'pending') ->> 'p50_days')::numeric = 13.0,
        '3j an injected clock ages every row with it');
END $$;
-- #endregion

-- #region 4. It moves nothing
DO $$
DECLARE
    v_op uuid := current_setting('probe.op')::uuid;
    v_before text; v_after text;
BEGIN
    SELECT format('%s|%s|%s|%s',
                  (SELECT count(*) FROM finance.transactions),
                  (SELECT COALESCE(sum(balance_cents), 0) FROM finance.wallets),
                  (SELECT string_agg(status || ':' || n, ',' ORDER BY status)
                     FROM (SELECT status, count(*) AS n FROM finance.escrows GROUP BY status) s),
                  (SELECT string_agg(state::text || ':' || n, ',' ORDER BY state)
                     FROM (SELECT state, count(*) AS n FROM finance.pending_releases GROUP BY state) s))
      INTO v_before;
    PERFORM finance.fn_escrow_age(now());
    PERFORM pg_temp.read_as(v_op);
    SELECT format('%s|%s|%s|%s',
                  (SELECT count(*) FROM finance.transactions),
                  (SELECT COALESCE(sum(balance_cents), 0) FROM finance.wallets),
                  (SELECT string_agg(status || ':' || n, ',' ORDER BY status)
                     FROM (SELECT status, count(*) AS n FROM finance.escrows GROUP BY status) s),
                  (SELECT string_agg(state::text || ':' || n, ',' ORDER BY state)
                     FROM (SELECT state, count(*) AS n FROM finance.pending_releases GROUP BY state) s))
      INTO v_after;
    PERFORM pg_temp.check(v_before = v_after,
        '4a the reads leave the ledger, every wallet balance, every escrow status and every release unchanged');
END $$;
-- #endregion

ROLLBACK;
