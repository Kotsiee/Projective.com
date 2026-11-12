-- payout_schedule_race.sql — two concurrent payout-schedule sweeps never run one schedule
-- (Decision #337, ruling M6; FINANCE_BUILD_PROMPTS DB4).
--
-- Races two real transactions: this session is A, a dblink connection is B. A claims (and so debits)
-- one due schedule and keeps its transaction open while B sweeps everything due; A then commits and B
-- finishes. finance.fn_claim_due_payout_schedules claims under FOR UPDATE SKIP LOCKED and takes the
-- debit in its own transaction, so B never returns the schedule A holds, the wallet is debited once,
-- one payout exists, and a sweep after both finds the schedule no longer due. The rolled-back checks
-- (authority, the door, the claim maths, the strike) are supabase/probes/payout_schedules.sql.
--
-- THIS PROBE COMMITS. Races need two committed transactions, so the fixture and both sweeps persist.
-- Run it only against a disposable database (a throwaway stack, or one about to be `db:reset`), never
-- against a shared one; it refuses to start without `-v disposable=1`:
--   docker exec -i supabase_db_<project_id> psql -U postgres -d postgres -X -q -v disposable=1 \
--     < supabase/probes/payout_schedule_race.sql
\set ON_ERROR_STOP on
\set QUIET on
\if :{?disposable}
\else
\echo 'payout_schedule_race.sql commits; rerun with -v disposable=1 against a throwaway database.'
\quit
\endif

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

-- #region Helpers
CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- The schedule ids a sweep's answer names.
CREATE OR REPLACE FUNCTION pg_temp.ids(p_runs jsonb) RETURNS uuid[] LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(pg_catalog.array_agg((x ->> 'schedule_id')::uuid), '{}'::uuid[])
      FROM pg_catalog.jsonb_array_elements(COALESCE(p_runs, '[]'::jsonb)) x;
$$;

-- B's answer once A has committed: its result text, or `ERROR: …`. Ends B's transaction either way.
CREATE OR REPLACE FUNCTION pg_temp.b_finish() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_out text; v_rows integer := 0;
BEGIN
    FOR v_out IN SELECT r.out FROM extensions.dblink_get_result('probe_b', false) AS r(out text) LOOP
        v_rows := v_rows + 1;
        EXIT;
    END LOOP;
    PERFORM 1 FROM extensions.dblink_get_result('probe_b', false) AS r(out text);
    IF v_rows = 0 THEN
        v_out := 'ERROR: ' || extensions.dblink_error_message('probe_b');
    END IF;
    PERFORM extensions.dblink_exec('probe_b', 'COMMIT', false);
    RETURN COALESCE(v_out, 'NULL');
END $$;
-- #endregion

-- #region Fixture (committed): a payout-ready freelancer's weekly schedule, long overdue, and money to pay
SELECT fp.user_id AS person
  FROM org.freelancer_profiles fp
  JOIN org.users_public u ON u.user_id = fp.user_id
 WHERE u.username NOT IN ('marisdelacroix', 'theo', 'priyaraman')
   AND finance.fn_freelancer_payout_ready(fp.user_id)
   AND NOT org.fn_is_minor(fp.user_id)
   AND EXISTS (SELECT 1 FROM finance.payout_accounts a
                WHERE a.owner_id = fp.user_id AND a.provider = 'stripe' AND a.status = 'verified')
 ORDER BY fp.user_id DESC LIMIT 1 \gset

BEGIN;
SELECT finance.fn_ensure_wallet('freelancer', :'person', 'USD') AS wallet \gset
SELECT finance.fn_wallet_credit(:'person', 'freelancer', 'USD', 40000, 'topup', 'probe', NULL);
SELECT pg_catalog.set_config('request.jwt.claim.sub', :'person', true),
       pg_catalog.set_config('request.jwt.claims',
           pg_catalog.json_build_object('sub', :'person', 'role', 'authenticated')::text, true);
SELECT (finance.save_payout_schedule('freelancer', :'person', 'USD', 'scheduled_weekly'::finance.payout_mode)).id AS schedule \gset
-- A Monday long past: due, and first in the claim's order.
UPDATE finance.payout_schedules SET next_run_at = '2000-01-03 00:00:00+00' WHERE id = :'schedule';
COMMIT;
SELECT balance_cents AS before FROM finance.wallets WHERE id = :'wallet' \gset
\echo fixture person=:person schedule=:schedule wallet=:wallet available=:before

-- B dials the container's own network address: loopback is `trust`, and dblink refuses a non-superuser
-- connection that did not authenticate with the password.
\getenv b_host HOSTNAME
SELECT extensions.dblink_connect('probe_b', 'host=' || :'b_host'
    || ' dbname=postgres user=postgres password=postgres application_name=payout_schedule_probe_b');
-- #endregion

-- #region The race: A claims the schedule and holds it; B sweeps everything due meanwhile
BEGIN;
SELECT finance.fn_claim_due_payout_schedules(1)::text AS a_runs \gset
SELECT pg_temp.ok(:'schedule' = ANY (pg_temp.ids(:'a_runs'::jsonb)), 'race: A claimed the schedule');
SELECT extensions.dblink_exec('probe_b', 'BEGIN');
SELECT extensions.dblink_send_query('probe_b', 'SELECT finance.fn_claim_due_payout_schedules(200)::text');
SELECT pg_catalog.pg_sleep(1);
COMMIT;
SELECT pg_temp.b_finish() AS b_runs \gset
\echo race B returned: :b_runs
SELECT pg_temp.ok(:'b_runs' NOT LIKE 'ERROR:%', 'race: B''s sweep completed');
SELECT pg_temp.ok(NOT (:'schedule' = ANY (pg_temp.ids(:'b_runs'::jsonb))),
    'race: B never returned the schedule A held (SKIP LOCKED)');
SELECT pg_temp.ok(NOT (pg_temp.ids(:'b_runs'::jsonb) && pg_temp.ids(:'a_runs'::jsonb)),
    'race: the two sweeps returned disjoint schedules');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM finance.payouts WHERE schedule_id = :'schedule'),
    'race: exactly one payout was begun for the schedule');
SELECT pg_temp.ok((SELECT balance_cents = 0 FROM finance.wallets WHERE id = :'wallet'),
    'race: the wallet was debited once, by everything Available');
SELECT pg_temp.ok((SELECT amount_cents = :before FROM finance.payouts WHERE schedule_id = :'schedule'),
    'race: that payout is the whole of Available');
-- #endregion

-- #region After both: the schedule has advanced, so a third sweep leaves it alone
SELECT finance.fn_claim_due_payout_schedules(200)::text AS c_runs \gset
SELECT pg_temp.ok(NOT (:'schedule' = ANY (pg_temp.ids(:'c_runs'::jsonb))),
    'after: a later sweep does not claim it again');
SELECT pg_temp.ok((SELECT next_run_at > pg_catalog.now() FROM finance.payout_schedules WHERE id = :'schedule'),
    'after: its next run is the coming Monday');
-- #endregion

SELECT extensions.dblink_disconnect('probe_b');
\echo PASS payout_schedule_race
