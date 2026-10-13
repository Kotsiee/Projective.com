-- escrow_uniqueness.sql — probe for one held base escrow per ticket (Decision #189).
--
-- Races two real transactions: this session is A, a dblink connection is B. A makes a hold and keeps
-- its transaction open while B attempts the same hold; A then commits and B finishes. Both races must
-- leave exactly one held base escrow per ticket and debit the payer exactly once:
--   1. finance.fn_hold_ticket_escrow twice on one ticket — B waits on uq_escrows_ticket_base_held, then
--      takes the unique_violation as "already held" (NULL) without debiting.
--   2. projects.fund_stage twice on one stage — B waits on the candidate-ticket lock, re-reads them as
--      funded, and finds nothing left to fund.
-- Then, rolled back: a paid revision round's escrow sits beside the base escrow, a round is held once,
-- and a direct second base hold is refused by the index.
--
-- THIS PROBE COMMITS. Races need two committed transactions, so the fixture and both races persist.
-- Run it only against a disposable database (a throwaway stack, or one about to be `db:reset`), never
-- against a shared one; it refuses to start without `-v disposable=1`:
--   docker exec -i supabase_db_<project_id> psql -U postgres -d postgres -X -q -v disposable=1 \
--     < supabase/probes/escrow_uniqueness.sql
\set ON_ERROR_STOP on
\set QUIET on
\if :{?disposable}
\else
\echo 'escrow_uniqueness.sql commits; rerun with -v disposable=1 against a throwaway database.'
\quit
\endif

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

-- #region Helpers
CREATE OR REPLACE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.claims(p_uid uuid) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text;
$$;

CREATE OR REPLACE FUNCTION pg_temp.b_begin(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM extensions.dblink_exec('probe_b', 'BEGIN');
    PERFORM extensions.dblink_exec('probe_b',
        pg_catalog.format('SET LOCAL request.jwt.claims = %L', pg_temp.claims(p_uid)));
    PERFORM extensions.dblink_exec('probe_b',
        pg_catalog.format('SET LOCAL request.jwt.claim.sub = %L', p_uid::text));
END $$;

CREATE OR REPLACE FUNCTION pg_temp.b_waiting() RETURNS boolean LANGUAGE sql AS $$
    SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
                    WHERE application_name = 'escrow_probe_b' AND wait_event_type = 'Lock');
$$;

-- B's outcome once A has committed: its result text, or `ERROR: …`. Ends B's transaction either way.
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

-- #region Fixture (committed): an individual client's USD stage, three priced tickets, a funded wallet
SELECT p.id AS project, ps.id AS stage, p.owner_user_id AS owner,
       finance.fn_person_wallet_type(p.owner_user_id) AS wtype
  FROM projects.projects p
  JOIN projects.project_stages ps ON ps.project_id = p.id
 WHERE p.client_business_id IS NULL AND upper(p.currency) = 'USD'
   AND p.status NOT IN ('completed', 'cancelled', 'archived')
   AND ps.status NOT IN ('approved', 'paid', 'cancelled')
   AND NOT EXISTS (SELECT 1 FROM projects.stage_assignments sa
                    WHERE sa.project_stage_id = ps.id AND sa.assignee_type = 'team' AND sa.status = 'accepted')
 ORDER BY ps.id LIMIT 1 \gset
SELECT fp.user_id AS freelancer FROM org.freelancer_profiles fp
 WHERE fp.user_id <> :'owner' ORDER BY fp.user_id LIMIT 1 \gset

BEGIN;
UPDATE projects.project_stages SET status = 'assigned' WHERE id = :'stage';
INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents)
VALUES (:'project', :'stage', :'freelancer', 'Escrow probe 1', 'A description.', 10000),
       (:'project', :'stage', :'freelancer', 'Escrow probe 2', 'A description.', 10000),
       (:'project', :'stage', :'freelancer', 'Escrow probe 3', 'A description.', 10000);
SELECT finance.fn_ensure_wallet(:'wtype', :'owner', 'USD') AS wallet \gset
SELECT finance.fn_wallet_credit(:'owner', :'wtype', 'USD', 100000000, 'topup', 'probe', NULL);
COMMIT;
SELECT id AS t1 FROM projects.tickets WHERE current_stage_id = :'stage' AND title = 'Escrow probe 1' ORDER BY created_at DESC LIMIT 1 \gset
SELECT id AS t2 FROM projects.tickets WHERE current_stage_id = :'stage' AND title = 'Escrow probe 2' ORDER BY created_at DESC LIMIT 1 \gset
SELECT id AS t3 FROM projects.tickets WHERE current_stage_id = :'stage' AND title = 'Escrow probe 3' ORDER BY created_at DESC LIMIT 1 \gset
\echo fixture stage=:stage owner=:owner tickets=:t1,:t2,:t3

-- B dials the container's own network address: loopback is `trust`, and dblink refuses a non-superuser
-- connection that did not authenticate with the password.
\getenv b_host HOSTNAME
SELECT extensions.dblink_connect('probe_b', 'host=' || :'b_host'
    || ' dbname=postgres user=postgres password=postgres application_name=escrow_probe_b');
-- #endregion

-- #region 1. Two fn_hold_ticket_escrow calls race on ticket 3
SELECT balance_cents AS before1 FROM finance.wallets WHERE id = :'wallet' \gset
BEGIN;
SELECT pg_catalog.set_config('request.jwt.claims', pg_temp.claims(:'owner'), true),
       pg_catalog.set_config('request.jwt.claim.sub', :'owner', true);
SELECT pg_temp.ok(finance.fn_hold_ticket_escrow(:'t3') IS NOT NULL, 'race 1: A holds ticket 3');
SELECT pg_temp.b_begin(:'owner');
SELECT extensions.dblink_send_query('probe_b',
    pg_catalog.format('SELECT finance.fn_hold_ticket_escrow(%L)::text', :'t3'));
SELECT pg_catalog.pg_sleep(1);
SELECT pg_temp.ok(pg_temp.b_waiting(), 'race 1: B is blocked behind A''s uncommitted hold');
COMMIT;
SELECT pg_temp.b_finish() AS race1_b \gset
\echo race 1 B returned: :race1_b
SELECT pg_temp.ok(:'race1_b' = 'NULL', 'race 1: B lost the race and returned NULL (already held)');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM finance.escrows
                    WHERE ticket_id = :'t3' AND status = 'held'),
    'race 1: exactly one held base escrow on ticket 3');
SELECT pg_temp.ok((SELECT :before1 - balance_cents = 10000 FROM finance.wallets WHERE id = :'wallet'),
    'race 1: the wallet was debited once (10000)');
-- #endregion

-- #region 2. Two fund_stage calls race on the stage (tickets 1 and 2)
SELECT balance_cents AS before2 FROM finance.wallets WHERE id = :'wallet' \gset
SELECT COALESCE(sum(amount_cents), 0) AS held_before2 FROM finance.escrows
 WHERE project_stage_id = :'stage' AND status = 'held' \gset
BEGIN;
SELECT pg_catalog.set_config('request.jwt.claims', pg_temp.claims(:'owner'), true),
       pg_catalog.set_config('request.jwt.claim.sub', :'owner', true);
SELECT projects.fund_stage(:'project', :'stage') AS race2_a \gset
\echo race 2 A returned: :race2_a
SELECT pg_temp.b_begin(:'owner');
SELECT extensions.dblink_send_query('probe_b',
    pg_catalog.format('SELECT projects.fund_stage(%L, %L)::text', :'project', :'stage'));
SELECT pg_catalog.pg_sleep(1);
SELECT pg_temp.ok(pg_temp.b_waiting(), 'race 2: B is blocked behind A''s uncommitted funding');
COMMIT;
SELECT pg_temp.b_finish() AS race2_b \gset
\echo race 2 B returned: :race2_b
SELECT pg_temp.ok((SELECT bool_and(n = 1) FROM (
                       SELECT count(e.id) AS n FROM unnest(ARRAY[:'t1', :'t2']::uuid[]) t(id)
                         LEFT JOIN finance.escrows e
                           ON e.ticket_id = t.id AND e.status = 'held'
                        GROUP BY t.id) c),
    'race 2: exactly one held base escrow on each of tickets 1 and 2');
SELECT pg_temp.ok(:'race2_b' LIKE 'ERROR:%Nothing in this stage is waiting for funding%',
    'race 2: B found nothing left to fund');
SELECT pg_temp.ok((SELECT :before2 - w.balance_cents = sum(e.amount_cents) - :held_before2
                     FROM finance.wallets w, finance.escrows e
                    WHERE w.id = :'wallet' AND e.project_stage_id = :'stage' AND e.status = 'held'
                    GROUP BY w.balance_cents),
    'race 2: the wallet moved by exactly what is newly held on the stage');
-- #endregion

SELECT extensions.dblink_disconnect('probe_b');

-- #region 3. Revision escrows beside the base escrow (rolled back)
BEGIN;
SELECT pg_catalog.set_config('request.jwt.claims', pg_temp.claims(:'owner'), true),
       pg_catalog.set_config('request.jwt.claim.sub', :'owner', true);
INSERT INTO projects.stage_revision_requests (project_stage_id, ticket_id, requested_by, request_type, reason, status, price_cents)
VALUES (:'stage', :'t1', :'owner', 'paid_revision', 'Probe round', 'awaiting_payment', 5000)
RETURNING id AS rev \gset
SELECT pg_catalog.set_config('probe.rev', :'rev', true), pg_catalog.set_config('probe.t1', :'t1', true);
SELECT finance.fn_hold_revision_escrow(:'rev') AS rev_escrow \gset
SELECT pg_temp.ok((SELECT revision_id = :'rev' AND ticket_id = :'t1' AND status = 'held'
                     FROM finance.escrows WHERE id = :'rev_escrow'),
    'revision: the round''s escrow is held on ticket 1 and names its round');
SELECT pg_temp.ok((SELECT count(*) = 2 FROM finance.escrows WHERE ticket_id = :'t1' AND status = 'held'),
    'revision: it sits beside the base escrow (two held rows on ticket 1)');

SAVEPOINT twice;
DO $$
BEGIN
    PERFORM finance.fn_hold_revision_escrow(pg_catalog.current_setting('probe.rev')::uuid);
    RAISE EXCEPTION 'PROBE FAIL: a revision round was held twice';
EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok  revision: a round is held once (uq_escrows_revision)';
END $$;
ROLLBACK TO SAVEPOINT twice;

DO $$
DECLARE v_constraint text;
BEGIN
    INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_user_id, payee_type, payee_id, amount_cents, currency, status)
    SELECT project_stage_id, ticket_id, payer_user_id, payee_type, payee_id, amount_cents, currency, 'held'
      FROM finance.escrows
     WHERE ticket_id = pg_catalog.current_setting('probe.t1')::uuid AND status = 'held' AND revision_id IS NULL;
    RAISE EXCEPTION 'PROBE FAIL: a second held base escrow was inserted';
EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'uq_escrows_ticket_base_held' THEN RAISE; END IF;
    RAISE NOTICE 'ok  index: a direct second held base escrow is refused (uq_escrows_ticket_base_held)';
END $$;
ROLLBACK;
-- #endregion

\echo PASS escrow_uniqueness
