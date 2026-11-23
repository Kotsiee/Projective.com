-- =============================================================================================
-- Probe: the claim TTL under concurrency (projects.fn_release_expired_claims; PM-WP1, Decision #516,
-- audit X7 / DL S2).
--
-- Two real sessions (dblink 'a' and 'b'). A runs first and keeps its transaction open; B is sent and the
-- probe waits until B is blocked on one of A's locks or has finished; A commits; B finishes and commits.
--   1 S2: a lapsed claim whose work starts in A while the sweep runs in B. The sweep skips the locked
--     ticket (FOR UPDATE SKIP LOCKED) instead of waiting, so the started ticket keeps its assignee and its
--     held escrow. Before PM-WP1 the sweep waited on the lock, then refunded the escrow and threw the
--     started ticket back to the backlog while the freelancer worked.
--   2 D5: A re-arms a lapsed claim on a prepaid escrow (owner ruling D3 A) while B, the next freelancer,
--     claims the same ticket. B waits on A's lock, then claims the ticket A put back in Ready, and the
--     escrow binds to B. Clearing the first claimant left the unbound escrow held: nothing was refunded
--     and nothing paid.
--   3 Two sweeps at once: B skips the ticket A holds rather than waiting on it, and the claim is
--     refunded once, with one history row.
--
-- COMMITS. A race needs both sessions to commit, so this probe cannot run inside a rolled-back
-- transaction. It refuses the shared dev database `postgres`; run it against a disposable copy:
--   docker exec supabase_db_Projective sh -c "psql -U postgres -c 'DROP DATABASE IF EXISTS claim_probe' \
--     -c 'CREATE DATABASE claim_probe' && pg_dump -U postgres -d postgres --no-owner \
--     | psql -U postgres -d claim_probe -q >/dev/null 2>&1"
--   docker exec -i supabase_db_Projective psql -U supabase_admin -d claim_probe -v ON_ERROR_STOP=1 \
--     < supabase/probes/claim_ttl_sweep_race.sql
--   docker exec supabase_db_Projective psql -U postgres -c 'DROP DATABASE claim_probe'
-- Dump WITH grants (no --no-acl): without them every door refuses with 42501 on its schema. (cron /
-- vault restore errors in the copy are expected and harmless.) `supabase_admin`, not `postgres`: only
-- a superuser may open a passwordless dblink session. A freshly reset local DB with nobody else on it
-- may also be used, with `-e PGOPTIONS='-c probe.allow_commit=on'` on the exec, which is what
-- `deno task test:probes:fresh` does. The fixture's tickets ("Probe WP1 race …") stay behind there.
--
-- A clean run prints only PASS notices and exits 0; any FAIL exits non-zero.
-- =============================================================================================

-- #region 0. Guard, extension, fixture
DO $$
BEGIN
    IF current_database() = 'postgres' AND current_setting('probe.allow_commit', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'claim_ttl_sweep_race COMMITS — run it against a disposable copy (see header), not the shared dev DB';
    END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET search_path = public, extensions;

CREATE TEMP TABLE wp1_fx (k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE wp1_results (n serial, scenario text, verdict text, detail text);

-- A business client project whose owner may spend and whose verified business wallet already holds
-- enough (the fixture credits nothing: on a fresh shared DB a credit with no payment behind it would
-- unbalance the conservation identity), and two payout-ready freelancers.
DO $$
DECLARE
    r record;
    v_fl1 uuid;
    v_fl2 uuid;
    v_sa uuid;
    v_t uuid;
    v_n integer;
BEGIN
    FOR r IN
        SELECT p.id, p.owner_user_id, p.client_business_id, upper(COALESCE(p.currency, 'USD')) AS currency
          FROM projects.projects p
          JOIN org.business_profiles b ON b.id = p.client_business_id AND b.kyb_status = 'verified'
          JOIN finance.wallets w ON w.owner_type = 'business' AND w.owner_id = b.id
                                AND w.currency = upper(COALESCE(p.currency, 'USD')) AND w.balance_cents >= 100000
         WHERE p.format = 'pipeline' AND p.structure_variation = 'standard' AND p.source_blueprint_id IS NULL
         ORDER BY p.id
    LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', r.owner_user_id, 'role', 'authenticated')::text, true);
        IF finance.fn_owner_capability('business', r.client_business_id, 'spend'::finance.vault_capability) THEN
            INSERT INTO wp1_fx VALUES ('project', r.id), ('owner', r.owner_user_id);
            EXIT;
        END IF;
    END LOOP;
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT EXISTS (SELECT 1 FROM wp1_fx WHERE k = 'project') THEN
        RAISE EXCEPTION 'FAIL no fixture: need a verified business client project with 1000.00 in its wallet whose owner can spend (deno task db:reset)';
    END IF;

    -- The seats this probe commits stay behind, so take freelancers who already own a project or hold
    -- a live seat first: seat_fill_concurrency, which runs after it, needs four who do neither. Only
    -- ones who accepted the IP Transfer Deed: a first claim asks for it (LG3), and an acceptance this
    -- probe committed could never be taken back.
    SELECT fp.user_id INTO v_fl1 FROM org.freelancer_profiles fp
     WHERE fp.user_id <> (SELECT v FROM wp1_fx WHERE k = 'owner') AND finance.fn_freelancer_payout_ready(fp.user_id)
       AND EXISTS (SELECT 1 FROM org.legal_acceptances a
                    WHERE a.user_id = fp.user_id AND a.document_slug = 'ip-transfer-deed'
                      AND a.version = org.fn_current_legal_version('ip-transfer-deed'))
     ORDER BY (EXISTS (SELECT 1 FROM projects.projects p WHERE p.owner_user_id = fp.user_id)
               OR EXISTS (SELECT 1 FROM projects.stage_assignments sa
                           WHERE sa.freelancer_profile_id = fp.user_id
                             AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed'))) DESC,
              (SELECT COALESCE(SUM(t.workload_intensity), 0) FROM projects.tickets t
                WHERE t.current_assignee_id = fp.user_id
                  AND t.status IN ('claimed', 'in_progress', 'in_review', 'reported_hidden')),
              fp.user_id
     LIMIT 1;
    SELECT fp.user_id INTO v_fl2 FROM org.freelancer_profiles fp
     WHERE fp.user_id NOT IN ((SELECT v FROM wp1_fx WHERE k = 'owner'), v_fl1) AND finance.fn_freelancer_payout_ready(fp.user_id)
       AND EXISTS (SELECT 1 FROM org.legal_acceptances a
                    WHERE a.user_id = fp.user_id AND a.document_slug = 'ip-transfer-deed'
                      AND a.version = org.fn_current_legal_version('ip-transfer-deed'))
     ORDER BY (EXISTS (SELECT 1 FROM projects.projects p WHERE p.owner_user_id = fp.user_id)
               OR EXISTS (SELECT 1 FROM projects.stage_assignments sa
                           WHERE sa.freelancer_profile_id = fp.user_id
                             AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed'))) DESC,
              (SELECT COALESCE(SUM(t.workload_intensity), 0) FROM projects.tickets t
                WHERE t.current_assignee_id = fp.user_id
                  AND t.status IN ('claimed', 'in_progress', 'in_review', 'reported_hidden')),
              fp.user_id
     LIMIT 1;
    IF v_fl2 IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: need two payout-ready freelancers'; END IF;
    INSERT INTO wp1_fx VALUES ('fl1', v_fl1), ('fl2', v_fl2);

    -- The next free sort order, so a second run on the same database adds its own stage.
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    SELECT (SELECT v FROM wp1_fx WHERE k = 'project'), 'Probe WP1 race A',
           COALESCE(MAX(s.sort_order), 0) + 1, 'open', 10000
      FROM projects.project_stages s WHERE s.project_id = (SELECT v FROM wp1_fx WHERE k = 'project')
    RETURNING id INTO v_sa;
    INSERT INTO wp1_fx VALUES ('stage', v_sa);
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, is_client_managed, status)
    VALUES (v_sa, 'freelancer', v_fl1, (SELECT v FROM wp1_fx WHERE k = 'owner'), false, 'assigned'),
           (v_sa, 'freelancer', v_fl2, (SELECT v FROM wp1_fx WHERE k = 'owner'), false, 'assigned');

    FOR v_n IN 1..3 LOOP
        INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
        VALUES ((SELECT v FROM wp1_fx WHERE k = 'project'), v_sa, 'backlog', 'Probe WP1 race R' || v_n, '{"t":"x"}', 'A description.',
                jsonb_build_array(jsonb_build_object('stage_id', v_sa, 'order', 0)))
        RETURNING id INTO v_t;
        INSERT INTO wp1_fx VALUES ('r' || v_n, v_t);
    END LOOP;
END $$;

-- R1 and R3: claimed from New (held at the claim). R2: funded first (prepaid), its funding before the
-- claim that binds it. Each race backdates its own ticket's claim past the 24-hour TTL just before it
-- runs, so an earlier race's sweep never reaches a later race's ticket.
DO $$
DECLARE
    v_owner uuid := (SELECT v FROM wp1_fx WHERE k = 'owner');
    v_fl1 uuid := (SELECT v FROM wp1_fx WHERE k = 'fl1');
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    PERFORM projects.fund_ticket((SELECT v FROM wp1_fx WHERE k = 'project'), (SELECT v FROM wp1_fx WHERE k = 'r2'));
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fl1, 'role', 'authenticated')::text, true);
    IF projects.claim_ticket((SELECT v FROM wp1_fx WHERE k = 'r1'), v_fl1) IS NULL
       OR projects.claim_ticket((SELECT v FROM wp1_fx WHERE k = 'r2'), v_fl1) IS NULL
       OR projects.claim_ticket((SELECT v FROM wp1_fx WHERE k = 'r3'), v_fl1) IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: a claim was refused';
    END IF;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;
UPDATE finance.escrows SET created_at = created_at - interval '3 days'
 WHERE ticket_id = (SELECT v FROM wp1_fx WHERE k = 'r2');

DO $$
BEGIN
    IF (SELECT count(*) FROM projects.tickets t
          JOIN finance.escrows e ON e.ticket_id = t.id AND e.status = 'held' AND e.payee_id = t.current_assignee_id
         WHERE t.id IN (SELECT v FROM wp1_fx WHERE k IN ('r1', 'r2', 'r3')) AND t.status = 'claimed') <> 3 THEN
        RAISE EXCEPTION 'FAIL no fixture: R1–R3 should be claims with a bound held escrow';
    END IF;
END $$;

SELECT format('fixture project=%s stage=%s fl1=%s fl2=%s r1=%s r2=%s r3=%s',
              (SELECT v FROM wp1_fx WHERE k = 'project'), (SELECT v FROM wp1_fx WHERE k = 'stage'),
              (SELECT v FROM wp1_fx WHERE k = 'fl1'), (SELECT v FROM wp1_fx WHERE k = 'fl2'),
              (SELECT v FROM wp1_fx WHERE k = 'r1'), (SELECT v FROM wp1_fx WHERE k = 'r2'),
              (SELECT v FROM wp1_fx WHERE k = 'r3')) AS fixture;
-- #endregion

-- #region 1. Helpers (coordinator session only)
-- Money the ticket's escrows moved: every ledger row that names one, and earned credits still pending.
CREATE FUNCTION pg_temp.wp1_moves(p_ticket uuid) RETURNS bigint
LANGUAGE sql AS $$
    SELECT (SELECT count(*) FROM finance.transactions t
             WHERE t.ref_table = 'escrows'
               AND t.ref_id IN (SELECT e.id FROM finance.escrows e WHERE e.ticket_id = p_ticket)
               AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.transaction_id = t.id))
         + (SELECT count(*) FROM finance.pending_releases pr
             WHERE pr.escrow_id IN (SELECT e.id FROM finance.escrows e WHERE e.ticket_id = p_ticket));
$$;

-- Open a session that runs `q` through a catching wrapper (so a refusal is a result, not an aborted
-- transaction), as p_sub when given, inside an open transaction.
CREATE FUNCTION pg_temp.wp1_open(p_conn text, p_sub uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM dblink_connect(p_conn, 'dbname=' || current_database());
    PERFORM dblink_exec(p_conn, $q$
        CREATE FUNCTION pg_temp.try_sql(q text) RETURNS text LANGUAGE plpgsql AS $f$
        DECLARE r text;
        BEGIN
            EXECUTE q INTO r;
            RETURN 'ok ' || COALESCE(r, '');
        EXCEPTION WHEN OTHERS THEN
            RETURN 'refused ' || SQLSTATE || ' ' || SQLERRM;
        END $f$
    $q$);
    PERFORM dblink_exec(p_conn, 'GRANT EXECUTE ON FUNCTION pg_temp.try_sql(text) TO PUBLIC');
    IF p_sub IS NOT NULL THEN
        PERFORM dblink_exec(p_conn, format('SET request.jwt.claims = %L',
            json_build_object('sub', p_sub, 'role', 'authenticated')::text));
        PERFORM dblink_exec(p_conn, 'SET ROLE authenticated');
    END IF;
    PERFORM dblink_exec(p_conn, 'BEGIN');
END $$;

CREATE FUNCTION pg_temp.wp1_close() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
    FOREACH c IN ARRAY ARRAY['a', 'b'] LOOP
        IF c = ANY (COALESCE(dblink_get_connections(), '{}')) THEN
            PERFORM dblink_disconnect(c);
        END IF;
    END LOOP;
END $$;

CREATE FUNCTION pg_temp.wp1_record(p_scenario text, p_ok boolean, p_detail text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO wp1_results (scenario, verdict, detail)
    VALUES (p_scenario, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_detail);
    IF p_ok THEN
        RAISE NOTICE 'PASS %: %', p_scenario, p_detail;
    ELSE
        RAISE NOTICE 'FAIL %: %', p_scenario, p_detail;
    END IF;
END $$;

-- A runs p_a and keeps its transaction open; B is sent p_b; the probe waits until B is blocked or done;
-- A commits; B completes and commits. Returns A's answer, B's answer and whether B was blocked.
CREATE FUNCTION pg_temp.wp1_race(p_a text, p_a_sub uuid, p_b text, p_b_sub uuid,
                                 OUT ra text, OUT rb text, OUT b_blocked boolean)
LANGUAGE plpgsql AS $$
DECLARE
    v_pid int;
    v_tries int := 0;
BEGIN
    PERFORM pg_temp.wp1_open('a', p_a_sub);
    PERFORM pg_temp.wp1_open('b', p_b_sub);

    SELECT r INTO ra FROM dblink('a', format('SELECT pg_temp.try_sql(%L)', p_a)) AS t(r text);
    SELECT p INTO v_pid FROM dblink('b', 'SELECT pg_backend_pid()') AS t(p int);
    PERFORM dblink_send_query('b', format('SELECT pg_temp.try_sql(%L)', p_b));

    b_blocked := false;
    LOOP
        b_blocked := b_blocked OR cardinality(pg_blocking_pids(v_pid)) > 0;
        EXIT WHEN b_blocked OR dblink_is_busy('b') = 0 OR v_tries >= 200;
        v_tries := v_tries + 1;
        PERFORM pg_sleep(0.05);
    END LOOP;

    PERFORM dblink_exec('a', 'COMMIT');
    SELECT r INTO rb FROM dblink_get_result('b') AS t(r text);
    PERFORM * FROM dblink_get_result('b') AS t(r text);
    PERFORM dblink_exec('b', 'COMMIT');
    PERFORM pg_temp.wp1_close();
END $$;
-- #endregion

-- #region 2. Race 1 — S2: the work starts while the sweep runs
UPDATE projects.tickets SET claimed_at = claimed_at - interval '2 days' WHERE id = (SELECT v FROM wp1_fx WHERE k = 'r1');
DO $$
DECLARE
    v_t uuid := (SELECT v FROM wp1_fx WHERE k = 'r1');
    v_fl1 uuid := (SELECT v FROM wp1_fx WHERE k = 'fl1');
    m0 bigint := pg_temp.wp1_moves((SELECT v FROM wp1_fx WHERE k = 'r1'));
    x record;
    v_row record;
BEGIN
    x := pg_temp.wp1_race(
        format('UPDATE projects.tickets SET status = %L WHERE id = %L RETURNING status::text', 'in_progress', v_t), NULL,
        'SELECT projects.fn_release_expired_claims()::text', NULL);
    SELECT t.status::text AS status, t.current_assignee_id, e.status AS escrow_status, e.payee_id INTO v_row
      FROM projects.tickets t
      LEFT JOIN finance.escrows e ON e.ticket_id = t.id AND e.revision_id IS NULL AND e.project_stage_id = t.current_stage_id
     WHERE t.id = v_t
     ORDER BY e.created_at DESC LIMIT 1;
    PERFORM pg_temp.wp1_record('race 1 S2 (work starts mid-sweep)',
        x.ra LIKE 'ok%' AND x.rb LIKE 'ok%' AND NOT x.b_blocked
        AND v_row.status = 'in_progress' AND v_row.current_assignee_id = v_fl1
        AND v_row.escrow_status = 'held' AND v_row.payee_id = v_fl1
        AND pg_temp.wp1_moves(v_t) = m0
        AND NOT EXISTS (SELECT 1 FROM projects.ticket_history h WHERE h.ticket_id = v_t AND h.action_type = 'claim_expired'),
        format('A=%s; B=%s (blocked: %s); ticket %s, assignee kept: %s, escrow %s for the assignee: %s, money moves %s',
               x.ra, x.rb, x.b_blocked, v_row.status, v_row.current_assignee_id = v_fl1,
               v_row.escrow_status, v_row.payee_id = v_fl1, pg_temp.wp1_moves(v_t) - m0));
END $$;
-- #endregion

-- #region 3. Race 2 — D5: the next claim waits for the re-arm, then binds the escrow it left held
UPDATE projects.tickets SET claimed_at = claimed_at - interval '2 days' WHERE id = (SELECT v FROM wp1_fx WHERE k = 'r2');
DO $$
DECLARE
    v_t uuid := (SELECT v FROM wp1_fx WHERE k = 'r2');
    v_fl2 uuid := (SELECT v FROM wp1_fx WHERE k = 'fl2');
    m0 bigint := pg_temp.wp1_moves((SELECT v FROM wp1_fx WHERE k = 'r2'));
    x record;
    v_row record;
BEGIN
    x := pg_temp.wp1_race(
        'SELECT projects.fn_release_expired_claims()::text', NULL,
        format('SELECT projects.claim_ticket(%L, %L)::text', v_t, v_fl2), v_fl2);
    SELECT t.status::text AS status, t.current_assignee_id, e.status AS escrow_status, e.payee_id, e.expires_at,
           (SELECT h.new_status::text FROM projects.ticket_history h
             WHERE h.ticket_id = t.id AND h.action_type = 'claim_expired' ORDER BY h.created_at DESC LIMIT 1) AS rearmed_to INTO v_row
      FROM projects.tickets t
      JOIN finance.escrows e ON e.ticket_id = t.id AND e.revision_id IS NULL AND e.project_stage_id = t.current_stage_id
     WHERE t.id = v_t
     ORDER BY e.created_at DESC LIMIT 1;
    PERFORM pg_temp.wp1_record('race 2 D5 (re-arm vs the next claim)',
        x.ra LIKE 'ok%' AND x.rb LIKE 'ok%' AND x.b_blocked
        AND v_row.rearmed_to = 'todo'
        AND v_row.status = 'claimed' AND v_row.current_assignee_id = v_fl2
        AND v_row.escrow_status = 'held' AND v_row.payee_id = v_fl2 AND v_row.expires_at IS NULL
        AND pg_temp.wp1_moves(v_t) = m0
        AND (SELECT count(*) FROM finance.escrows e WHERE e.ticket_id = v_t) = 1,
        format('A=%s; B=%s (blocked: %s); re-armed to %s; ticket %s for fl2: %s; escrow %s bound to fl2: %s, clock %s; money moves %s',
               x.ra, x.rb, x.b_blocked, v_row.rearmed_to, v_row.status, v_row.current_assignee_id = v_fl2,
               v_row.escrow_status, v_row.payee_id = v_fl2, v_row.expires_at, pg_temp.wp1_moves(v_t) - m0));
END $$;
-- #endregion

-- #region 4. Race 3 — two sweeps at once
UPDATE projects.tickets SET claimed_at = claimed_at - interval '2 days' WHERE id = (SELECT v FROM wp1_fx WHERE k = 'r3');
DO $$
DECLARE
    v_t uuid := (SELECT v FROM wp1_fx WHERE k = 'r3');
    x record;
    v_row record;
BEGIN
    x := pg_temp.wp1_race(
        'SELECT projects.fn_release_expired_claims()::text', NULL,
        'SELECT projects.fn_release_expired_claims()::text', NULL);
    SELECT t.status::text AS status, t.current_assignee_id,
           (SELECT count(*) FROM projects.ticket_history h WHERE h.ticket_id = t.id AND h.action_type = 'claim_expired') AS hist,
           (SELECT count(*) FROM finance.transactions tx
             WHERE tx.ref_table = 'escrows' AND tx.direction = 'credit'
               AND tx.ref_id IN (SELECT e.id FROM finance.escrows e WHERE e.ticket_id = t.id)) AS credits,
           (SELECT count(*) FROM finance.escrows e WHERE e.ticket_id = t.id AND e.status = 'refunded') AS refunded INTO v_row
      FROM projects.tickets t WHERE t.id = v_t;
    PERFORM pg_temp.wp1_record('race 3 (two sweeps overlap)',
        x.ra LIKE 'ok%' AND x.rb LIKE 'ok%' AND NOT x.b_blocked
        AND v_row.status = 'backlog' AND v_row.current_assignee_id IS NULL
        AND v_row.hist = 1 AND v_row.credits = 1 AND v_row.refunded = 1,
        format('A=%s; B=%s (blocked: %s); ticket %s; %s history row(s), %s refund credit(s), %s escrow(s) refunded',
               x.ra, x.rb, x.b_blocked, v_row.status, v_row.hist, v_row.credits, v_row.refunded));
END $$;
-- #endregion

-- #region 5. Verdict
DO $$
DECLARE
    v_fail integer;
BEGIN
    SELECT count(*) INTO v_fail FROM wp1_results WHERE verdict = 'FAIL';
    IF v_fail > 0 OR (SELECT count(*) FROM wp1_results) <> 3 THEN
        RAISE EXCEPTION 'FAIL claim_ttl_sweep_race: % of % scenarios failed', v_fail, (SELECT count(*) FROM wp1_results);
    END IF;
    RAISE NOTICE 'PASS claim_ttl_sweep_race: 3 scenarios';
END $$;
-- #endregion
