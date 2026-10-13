-- =============================================================================================
-- Probe: escrow release under concurrency (finance.fn_release_ticket_escrow / fn_fair_exit_release /
-- fn_refund_ticket_escrow, projects.approve_stage / cancel_stage_fair_exit).
--
-- Two real sessions (dblink 'a' and 'b') settle the same escrow at once. A runs first and holds its
-- locks; B is sent and the probe waits until B is blocked on one of A's locks; A commits; B finishes
-- and commits. Every credit and refund is a `finance.transactions` row referencing the escrow, or an
-- earned credit pending in `finance.pending_releases` (Decision #191), so the movements B adds after
-- A committed must be zero. A double payout shows as `FAIL … B added n`.
-- The two stage doors also refuse a stage that is already `paid` / `cancelled`.
--
-- COMMITS. A race needs both sessions to commit, so this probe cannot run inside a rolled-back
-- transaction. It refuses the shared dev database `postgres`; run it against a disposable copy:
--   docker exec supabase_db_Projective sh -c "psql -U postgres -c 'DROP DATABASE IF EXISTS escrow_probe' \
--     -c 'CREATE DATABASE escrow_probe' && pg_dump -U postgres -d postgres --no-owner --no-acl \
--     | psql -U postgres -d escrow_probe -q >/dev/null 2>&1"
--   docker exec -i supabase_db_Projective psql -U supabase_admin -d escrow_probe -v ON_ERROR_STOP=1 \
--     < supabase/probes/escrow_release_concurrency.sql
--   docker exec supabase_db_Projective psql -U postgres -c 'DROP DATABASE escrow_probe'
-- (cron / vault restore errors in the copy are expected and harmless.) `supabase_admin`, not
-- `postgres`: only a superuser may open a passwordless dblink session. A freshly reset local DB with
-- nobody else on it may also be used, with `-e PGOPTIONS='-c probe.allow_commit=on'` on the exec.
--
-- Each race restores the fixture (escrows held, stage status) first, so the scenarios are
-- independent. A clean run prints only PASS notices and exits 0; any FAIL exits non-zero.
-- =============================================================================================

-- #region 0. Guard, extension, fixture
DO $$
BEGIN
    IF current_database() = 'postgres' AND current_setting('probe.allow_commit', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'escrow_release_concurrency COMMITS — run it against a disposable copy (see header), not the shared dev DB';
    END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET search_path = public, extensions;

-- The stage with the most held escrow (an in-progress one first), its owner, and one held ticket.
CREATE TEMP TABLE probe_fx AS
SELECT ps.id AS stage, ps.project_id AS project, p.owner_user_id AS owner,
       ps.status AS stage_status, ps.completed_at,
       (SELECT e.ticket_id FROM finance.escrows e
        WHERE e.project_stage_id = ps.id AND e.status = 'held' AND e.ticket_id IS NOT NULL
        ORDER BY e.ticket_id LIMIT 1) AS ticket
FROM projects.project_stages ps
JOIN projects.projects p ON p.id = ps.project_id
WHERE ps.status NOT IN ('approved', 'paid', 'cancelled')
    AND EXISTS (SELECT 1 FROM finance.escrows e
                WHERE e.project_stage_id = ps.id AND e.status = 'held' AND e.ticket_id IS NOT NULL)
ORDER BY (ps.status = 'in_progress') DESC,
         (SELECT count(*) FROM finance.escrows e WHERE e.project_stage_id = ps.id AND e.status = 'held') DESC,
         ps.id
LIMIT 1;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM probe_fx) THEN
        RAISE EXCEPTION 'FAIL no fixture: need a stage with held ticket escrow (deno task db:reset)';
    END IF;
END $$;

CREATE TEMP TABLE probe_escrows AS
SELECT e.id, e.ticket_id FROM finance.escrows e
WHERE e.project_stage_id = (SELECT stage FROM probe_fx) AND e.status = 'held';

CREATE TEMP TABLE probe_tickets AS
SELECT t.id, t.total_amount_paid, t.payment_status FROM projects.tickets t
WHERE t.id IN (SELECT ticket_id FROM probe_escrows);

CREATE TEMP TABLE probe_results (n serial, scenario text, verdict text, detail text);

SELECT format('fixture stage=%s (%s) project=%s owner=%s ticket=%s held=%s',
              f.stage, f.stage_status, f.project, f.owner, f.ticket,
              (SELECT count(*) FROM probe_escrows)) AS fixture
FROM probe_fx f;
-- #endregion

-- #region 1. Helpers (coordinator session only)
CREATE FUNCTION pg_temp.probe_restore(p_stage_status stage_status DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE finance.escrows
    SET status = 'held', platform_fee_cents = 0, released_at = NULL
    WHERE id IN (SELECT id FROM probe_escrows);
    UPDATE projects.tickets t
    SET total_amount_paid = pt.total_amount_paid, payment_status = pt.payment_status
    FROM probe_tickets pt WHERE pt.id = t.id;
    UPDATE projects.project_stages ps
    SET status = COALESCE(p_stage_status, f.stage_status), completed_at = f.completed_at
    FROM probe_fx f WHERE ps.id = f.stage;
END $$;

-- Every money movement the escrows caused: ledger rows referencing them, plus earned credits still
-- waiting out the pending window in finance.pending_releases (Decision #191), which reach the ledger
-- only at maturity — a matured row is counted once, by its ledger row.
CREATE FUNCTION pg_temp.probe_moves() RETURNS bigint
LANGUAGE sql AS $$
    SELECT (SELECT count(*) FROM finance.transactions t
             WHERE t.ref_table = 'escrows' AND t.ref_id IN (SELECT id FROM probe_escrows)
               AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.transaction_id = t.id))
         + (SELECT count(*) FROM finance.pending_releases pr
             WHERE pr.escrow_id IN (SELECT id FROM probe_escrows));
$$;

-- Open a session that runs `q` through a catching wrapper (so a refusal is a result, not an
-- aborted transaction), as the stage owner when p_as_owner, inside an open transaction.
CREATE FUNCTION pg_temp.probe_open(p_conn text, p_as_owner boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM dblink_connect(p_conn, 'dbname=' || current_database());
    PERFORM dblink_exec(p_conn, $q$
        CREATE FUNCTION pg_temp.try_sql(q text) RETURNS text LANGUAGE plpgsql AS $f$
        DECLARE r text;
        BEGIN
            EXECUTE q INTO r;
            RETURN 'ok';
        EXCEPTION WHEN OTHERS THEN
            RETURN 'refused ' || SQLSTATE || ' ' || SQLERRM;
        END $f$
    $q$);
    IF p_as_owner THEN
        PERFORM dblink_exec(p_conn, format('SET request.jwt.claims = %L',
            json_build_object('sub', (SELECT owner FROM probe_fx), 'role', 'authenticated')::text));
        PERFORM dblink_exec(p_conn, 'SET ROLE authenticated');
    END IF;
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

CREATE FUNCTION pg_temp.probe_record(p_scenario text, p_ok boolean, p_detail text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO probe_results (scenario, verdict, detail)
    VALUES (p_scenario, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_detail);
    IF p_ok THEN
        RAISE NOTICE 'PASS %: %', p_scenario, p_detail;
    ELSE
        RAISE NOTICE 'FAIL %: %', p_scenario, p_detail;
    END IF;
END $$;

-- A runs p_a and keeps its transaction open; B is sent p_b and must block on A; A commits; B
-- completes and commits. PASS when A moved money, B added no ledger row, and B's answer starts
-- with p_expect_b ('ok' or 'refused <SQLSTATE>').
CREATE FUNCTION pg_temp.probe_race(
    p_scenario text, p_a text, p_b text, p_as_owner boolean, p_expect_b text
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    n0 bigint;
    n1 bigint;
    n2 bigint;
    ra text;
    rb text;
    v_pid int;
    v_tries int := 0;
    v_blocked boolean := false;
BEGIN
    n0 := pg_temp.probe_moves();
    PERFORM pg_temp.probe_open('a', p_as_owner);
    PERFORM pg_temp.probe_open('b', p_as_owner);

    SELECT r INTO ra FROM dblink('a', format('SELECT pg_temp.try_sql(%L)', p_a)) AS t(r text);
    SELECT p INTO v_pid FROM dblink('b', 'SELECT pg_backend_pid()') AS t(p int);
    PERFORM dblink_send_query('b', format('SELECT pg_temp.try_sql(%L)', p_b));

    LOOP
        v_blocked := cardinality(pg_blocking_pids(v_pid)) > 0;
        EXIT WHEN v_blocked OR dblink_is_busy('b') = 0 OR v_tries >= 200;
        v_tries := v_tries + 1;
        PERFORM pg_sleep(0.05);
    END LOOP;

    PERFORM dblink_exec('a', 'COMMIT');
    n1 := pg_temp.probe_moves();

    SELECT r INTO rb FROM dblink_get_result('b') AS t(r text);
    PERFORM * FROM dblink_get_result('b') AS t(r text);
    PERFORM dblink_exec('b', 'COMMIT');
    n2 := pg_temp.probe_moves();
    PERFORM pg_temp.probe_close();

    PERFORM pg_temp.probe_record(
        p_scenario,
        ra = 'ok' AND n1 > n0 AND n2 = n1 AND rb LIKE p_expect_b || '%',
        format('A=%s moved %s ledger rows; B (%s) added %s and answered %s',
               ra, n1 - n0, CASE WHEN v_blocked THEN 'blocked on A' ELSE 'never blocked' END,
               n2 - n1, rb)
    );
EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.probe_close();
    RAISE;
END $$;

-- One session, one call, committed. PASS when it answers p_expect and moves no money.
CREATE FUNCTION pg_temp.probe_solo(p_scenario text, p_sql text, p_expect text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    n0 bigint;
    n1 bigint;
    ra text;
BEGIN
    n0 := pg_temp.probe_moves();
    PERFORM pg_temp.probe_open('a', true);
    SELECT r INTO ra FROM dblink('a', format('SELECT pg_temp.try_sql(%L)', p_sql)) AS t(r text);
    PERFORM dblink_exec('a', 'COMMIT');
    n1 := pg_temp.probe_moves();
    PERFORM pg_temp.probe_close();
    PERFORM pg_temp.probe_record(p_scenario, ra LIKE p_expect || '%' AND n1 = n0,
        format('answered %s; moved %s ledger rows', ra, n1 - n0));
EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.probe_close();
    RAISE;
END $$;
-- #endregion

-- #region 2. Internal finance functions, raced on one ticket
SELECT pg_temp.probe_restore();
SELECT pg_temp.probe_race('fn_release_ticket_escrow x2',
    format('SELECT finance.fn_release_ticket_escrow(%L)', (SELECT ticket FROM probe_fx)),
    format('SELECT finance.fn_release_ticket_escrow(%L)', (SELECT ticket FROM probe_fx)),
    false, 'ok');

SELECT pg_temp.probe_restore();
SELECT pg_temp.probe_race('fn_fair_exit_release x2',
    format('SELECT finance.fn_fair_exit_release(%L, 5000)', (SELECT ticket FROM probe_fx)),
    format('SELECT finance.fn_fair_exit_release(%L, 5000)', (SELECT ticket FROM probe_fx)),
    false, 'ok');

SELECT pg_temp.probe_restore();
SELECT pg_temp.probe_race('fn_refund_ticket_escrow x2',
    format('SELECT finance.fn_refund_ticket_escrow(%L)', (SELECT ticket FROM probe_fx)),
    format('SELECT finance.fn_refund_ticket_escrow(%L)', (SELECT ticket FROM probe_fx)),
    false, 'ok');

SELECT pg_temp.probe_restore();
SELECT pg_temp.probe_race('fn_release_ticket_escrow vs fn_fair_exit_release',
    format('SELECT finance.fn_release_ticket_escrow(%L)', (SELECT ticket FROM probe_fx)),
    format('SELECT finance.fn_fair_exit_release(%L, 5000)', (SELECT ticket FROM probe_fx)),
    false, 'ok');
-- #endregion

-- #region 3. Stage doors, raced as the owner
SELECT pg_temp.probe_restore();
SELECT pg_temp.probe_race('approve_stage x2',
    format('SELECT projects.approve_stage(%L, %L)', (SELECT project FROM probe_fx), (SELECT stage FROM probe_fx)),
    format('SELECT projects.approve_stage(%L, %L)', (SELECT project FROM probe_fx), (SELECT stage FROM probe_fx)),
    true, 'refused 55000');

SELECT pg_temp.probe_restore();
SELECT pg_temp.probe_race('cancel_stage_fair_exit x2',
    format('SELECT projects.cancel_stage_fair_exit(%L, %L, 50)', (SELECT project FROM probe_fx), (SELECT stage FROM probe_fx)),
    format('SELECT projects.cancel_stage_fair_exit(%L, %L, 50)', (SELECT project FROM probe_fx), (SELECT stage FROM probe_fx)),
    true, 'refused 55000');

SELECT pg_temp.probe_restore();
SELECT pg_temp.probe_race('cancel_stage_fair_exit vs approve_stage',
    format('SELECT projects.cancel_stage_fair_exit(%L, %L, 50)', (SELECT project FROM probe_fx), (SELECT stage FROM probe_fx)),
    format('SELECT projects.approve_stage(%L, %L)', (SELECT project FROM probe_fx), (SELECT stage FROM probe_fx)),
    true, 'refused 55000');

SELECT pg_temp.probe_restore();
SELECT pg_temp.probe_race('approve_stage vs cancel_stage_fair_exit',
    format('SELECT projects.approve_stage(%L, %L)', (SELECT project FROM probe_fx), (SELECT stage FROM probe_fx)),
    format('SELECT projects.cancel_stage_fair_exit(%L, %L, 50)', (SELECT project FROM probe_fx), (SELECT stage FROM probe_fx)),
    true, 'refused 55000');
-- #endregion

-- #region 4. Stage doors refuse a settled stage that still shows held escrow
SELECT pg_temp.probe_restore('paid');
SELECT pg_temp.probe_solo('approve_stage on a paid stage',
    format('SELECT projects.approve_stage(%L, %L)', (SELECT project FROM probe_fx), (SELECT stage FROM probe_fx)),
    'refused 55000');

SELECT pg_temp.probe_restore('cancelled');
SELECT pg_temp.probe_solo('approve_stage on a cancelled stage',
    format('SELECT projects.approve_stage(%L, %L)', (SELECT project FROM probe_fx), (SELECT stage FROM probe_fx)),
    'refused 55000');

SELECT pg_temp.probe_restore('paid');
SELECT pg_temp.probe_solo('cancel_stage_fair_exit on a paid stage',
    format('SELECT projects.cancel_stage_fair_exit(%L, %L, 50)', (SELECT project FROM probe_fx), (SELECT stage FROM probe_fx)),
    'refused 55000');
-- #endregion

-- #region 5. Verdict
SELECT pg_temp.probe_restore();
SELECT n, verdict, scenario, detail FROM probe_results ORDER BY n;

DO $$
DECLARE v_fail int;
BEGIN
    SELECT count(*) INTO v_fail FROM probe_results WHERE verdict = 'FAIL';
    IF v_fail > 0 THEN
        RAISE EXCEPTION 'FAIL % of % scenarios', v_fail, (SELECT count(*) FROM probe_results);
    END IF;
    RAISE NOTICE 'PASS all % scenarios', (SELECT count(*) FROM probe_results);
END $$;
-- #endregion
