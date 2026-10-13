-- =============================================================================================
-- Probe: seat filling and double-booking under concurrency (projects.assign_from_application,
-- projects.respond_to_project_invitation → fn_apply_invitation_decision, projects.withdraw_application).
--
-- Two real sessions (dblink 'a' and 'b') answer at once. A runs first and holds its locks; B is sent
-- and the probe waits until B is blocked on one of A's locks; A commits; B finishes and commits.
--   1. Two candidates accepted for ONE open seat: exactly one is seated, the other is refused
--      `23505` DETAIL `reason=seat_filled`, and the loser is told (`application.declined`,
--      payload reason `seat_filled`).
--   2. One freelancer accepts two invitations to stages whose windows overlap: the second is
--      refused `23P01` (and must have queued on the first's advisory lock).
--   3. An invitation accept and an application accept for one freelancer on overlapping stages:
--      the application path is refused `23P01`.
--   4. Controls: a non-overlapping invitation still seats; a withdrawal tells the owner
--      (`application.withdrawn`).
--
-- Fixture rows (seat, applications, invitations, stage dates) are written with triggers off
-- (`session_replication_role = replica`) so allowance metering and stage guards stay out of the way.
--
-- COMMITS. A race needs both sessions to commit, so this probe cannot run inside a rolled-back
-- transaction. It refuses the shared dev database `postgres`; run it against a disposable copy, as
-- `supabase_admin` (dblink needs a superuser) and with ACLs kept (the sessions act as `authenticated`):
--   docker exec supabase_db_Projective sh -c "psql -U postgres -c 'DROP DATABASE IF EXISTS seat_probe' \
--     -c 'CREATE DATABASE seat_probe' && pg_dump -U supabase_admin -d postgres --no-owner \
--     | psql -U supabase_admin -d seat_probe -q >/dev/null 2>&1"
--   docker exec -i supabase_db_Projective psql -U supabase_admin -d seat_probe -v ON_ERROR_STOP=1 \
--     < supabase/probes/seat_fill_concurrency.sql
--   docker exec supabase_db_Projective psql -U postgres -c 'DROP DATABASE seat_probe'
-- (cron / vault restore errors in the copy are expected and harmless.) A clean run prints only PASS
-- notices and exits 0; any FAIL exits non-zero.
-- =============================================================================================

-- #region 0. Guard, extension, fixture
DO $$
BEGIN
    IF current_database() = 'postgres' AND current_setting('probe.allow_commit', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'seat_fill_concurrency COMMITS — run it against a disposable copy (see header), not the shared dev DB';
    END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET search_path = public, extensions;

-- Four freelancers with no live assignment anywhere and no project of their own.
CREATE TEMP TABLE probe_people AS
SELECT fp.user_id AS uid, row_number() OVER (ORDER BY fp.user_id) AS n
FROM org.freelancer_profiles fp
WHERE NOT EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
        WHERE sa.freelancer_profile_id = fp.user_id
            AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed'))
    AND NOT EXISTS (SELECT 1 FROM projects.projects p WHERE p.owner_user_id = fp.user_id)
    -- A seat is paid work: an unready candidate is refused by the earning gate first (Decision #196).
    AND finance.fn_freelancer_payout_ready(fp.user_id)
ORDER BY fp.user_id
LIMIT 4;

-- Four live stages of active projects that none of them owns.
CREATE TEMP TABLE probe_stages AS
SELECT s.id AS stage, s.project_id AS project, p.owner_user_id AS owner,
       row_number() OVER (ORDER BY s.id) - 1 AS n
FROM projects.project_stages s
JOIN projects.projects p ON p.id = s.project_id
WHERE p.status = 'active'
    AND s.archived_at IS NULL
    AND s.status NOT IN ('approved', 'paid', 'cancelled')
ORDER BY s.id
LIMIT 4;

DO $$
BEGIN
    IF (SELECT count(*) FROM probe_people) < 4 OR (SELECT count(*) FROM probe_stages) < 4 THEN
        RAISE EXCEPTION 'FAIL no fixture: need 4 unbooked freelancers and 4 live stages (deno task db:reset)';
    END IF;
END $$;

CREATE FUNCTION pg_temp.who(p_n int) RETURNS uuid LANGUAGE sql AS $$
    SELECT uid FROM probe_people WHERE n = p_n;
$$;
CREATE FUNCTION pg_temp.stg(p_n int) RETURNS uuid LANGUAGE sql AS $$
    SELECT stage FROM probe_stages WHERE n = p_n;
$$;
CREATE FUNCTION pg_temp.owner_of(p_n int) RETURNS uuid LANGUAGE sql AS $$
    SELECT owner FROM probe_stages WHERE n = p_n;
$$;

SET session_replication_role = replica;

-- Stage 0 carries the open seat. Stages 1 and 2 overlap; stage 3 is disjoint from both.
UPDATE projects.project_stages s
SET fixed_start_date = now() + make_interval(days => w.lo),
    file_due_date    = now() + make_interval(days => w.hi)
FROM (VALUES (1, 10, 20), (2, 15, 25), (3, 30, 40)) AS w(n, lo, hi)
WHERE s.id = pg_temp.stg(w.n);

-- Nobody in the fixture already holds or is invited to a fixture stage.
UPDATE projects.stage_assignments SET status = 'released'
WHERE project_stage_id IN (SELECT stage FROM probe_stages)
    AND freelancer_profile_id IN (SELECT uid FROM probe_people)
    AND status NOT IN ('released', 'cancelled', 'declined', 'completed');
UPDATE projects.project_invitations SET status = 'revoked'
WHERE project_stage_id IN (SELECT stage FROM probe_stages)
    AND target_user_id IN (SELECT uid FROM probe_people)
    AND status = 'pending';

CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

INSERT INTO projects.stage_open_seats (project_stage_id, description_of_need)
VALUES (pg_temp.stg(0), 'Probe seat');
INSERT INTO probe_ids
SELECT 'seat', id FROM projects.stage_open_seats WHERE project_stage_id = pg_temp.stg(0)
    AND description_of_need = 'Probe seat' ORDER BY created_at DESC LIMIT 1;

-- Applications: people 1 and 2 to the seat; person 4 to stage 2; person 3 to stage 0 (withdrawn later).
CREATE FUNCTION pg_temp.probe_apply(p_key text, p_person int, p_stage int, p_type text, p_target uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_app uuid;
BEGIN
    INSERT INTO projects.project_applications
        (project_id, applicant_user_id, applicant_type, applicant_profile_id, status)
    SELECT project, pg_temp.who(p_person), 'freelancer', pg_temp.who(p_person), 'pending'
    FROM probe_stages WHERE n = p_stage
    RETURNING id INTO v_app;
    INSERT INTO projects.project_application_targets (application_id, target_type, target_id)
    VALUES (v_app, p_type::projects.application_target_type, p_target);
    INSERT INTO probe_ids VALUES (p_key, v_app);
END $$;

SELECT pg_temp.probe_apply('app1', 1, 0, 'seat', (SELECT id FROM probe_ids WHERE k = 'seat'));
SELECT pg_temp.probe_apply('app2', 2, 0, 'seat', (SELECT id FROM probe_ids WHERE k = 'seat'));
SELECT pg_temp.probe_apply('app4', 4, 2, 'stage', pg_temp.stg(2));
SELECT pg_temp.probe_apply('app3', 3, 0, 'stage', pg_temp.stg(0));

-- Invitations (role freelancer, live terms): person 3 to stages 1, 2 and 3; person 4 to stage 1.
CREATE FUNCTION pg_temp.probe_invite(p_key text, p_person int, p_stage int)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_inv uuid;
BEGIN
    INSERT INTO projects.project_invitations
        (project_id, project_stage_id, target_user_id, role, inviter_user_id, token, status, expires_at)
    SELECT project, stage, pg_temp.who(p_person), 'freelancer', owner,
           md5(random()::text || clock_timestamp()::text), 'pending', now() + interval '14 days'
    FROM probe_stages WHERE n = p_stage
    RETURNING id INTO v_inv;
    INSERT INTO probe_ids VALUES (p_key, v_inv);
END $$;

SELECT pg_temp.probe_invite('inv3_1', 3, 1);
SELECT pg_temp.probe_invite('inv3_2', 3, 2);
SELECT pg_temp.probe_invite('inv3_3', 3, 3);
SELECT pg_temp.probe_invite('inv4_1', 4, 1);

SET session_replication_role = origin;

CREATE FUNCTION pg_temp.pid(p_k text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_k;
$$;

CREATE TEMP TABLE probe_results (n serial, scenario text, verdict text, detail text);

SELECT format('fixture people=%s stages=%s seat=%s',
              (SELECT string_agg(uid::text, ',' ORDER BY n) FROM probe_people),
              (SELECT string_agg(stage::text, ',' ORDER BY n) FROM probe_stages),
              pg_temp.pid('seat')) AS fixture;
-- #endregion

-- #region 1. Helpers (coordinator session only)
CREATE FUNCTION pg_temp.live_on(p_person int, p_stage int) RETURNS bigint LANGUAGE sql AS $$
    SELECT count(*) FROM projects.stage_assignments
    WHERE project_stage_id = pg_temp.stg(p_stage) AND freelancer_profile_id = pg_temp.who(p_person)
        AND status NOT IN ('released', 'cancelled', 'declined', 'completed');
$$;

-- Open a session acting as p_sub inside an open transaction. `try_sql` catches a refusal so it is
-- a result ('refused <SQLSTATE> <DETAIL> <message>'), not an aborted transaction.
CREATE FUNCTION pg_temp.probe_open(p_conn text, p_sub uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM dblink_connect(p_conn, 'dbname=' || current_database());
    PERFORM dblink_exec(p_conn, $q$
        CREATE FUNCTION pg_temp.try_sql(q text) RETURNS text LANGUAGE plpgsql AS $f$
        DECLARE r text; d text;
        BEGIN
            EXECUTE q INTO r;
            RETURN 'ok';
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL;
            RETURN 'refused ' || SQLSTATE || ' ' || COALESCE(NULLIF(d, ''), '-') || ' ' || SQLERRM;
        END $f$ $q$);
    PERFORM dblink_exec(p_conn, format('SET request.jwt.claims TO %L',
        json_build_object('sub', p_sub, 'role', 'authenticated')::text));
    PERFORM dblink_exec(p_conn, 'SET ROLE authenticated');
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

-- A (as p_sub_a) runs p_a and keeps its transaction open; B (as p_sub_b) is sent p_b and should
-- block on A; A commits; B completes and commits. Returns {A's answer, B's answer, blocked}.
CREATE FUNCTION pg_temp.probe_race(p_a text, p_sub_a uuid, p_b text, p_sub_b uuid) RETURNS text[]
LANGUAGE plpgsql AS $$
DECLARE
    ra text;
    rb text;
    v_pid int;
    v_tries int := 0;
    v_blocked boolean := false;
BEGIN
    PERFORM pg_temp.probe_open('a', p_sub_a);
    PERFORM pg_temp.probe_open('b', p_sub_b);

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
    SELECT r INTO rb FROM dblink_get_result('b') AS t(r text);
    PERFORM * FROM dblink_get_result('b') AS t(r text);
    PERFORM dblink_exec('b', 'COMMIT');
    PERFORM pg_temp.probe_close();
    RETURN ARRAY[ra, rb, CASE WHEN v_blocked THEN 'blocked on A' ELSE 'never blocked' END];
EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.probe_close();
    RAISE;
END $$;

-- One session, one call, committed. Returns the answer.
CREATE FUNCTION pg_temp.probe_solo(p_sql text, p_sub uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE ra text;
BEGIN
    PERFORM pg_temp.probe_open('a', p_sub);
    SELECT r INTO ra FROM dblink('a', format('SELECT pg_temp.try_sql(%L)', p_sql)) AS t(r text);
    PERFORM dblink_exec('a', 'COMMIT');
    PERFORM pg_temp.probe_close();
    RETURN ra;
EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.probe_close();
    RAISE;
END $$;
-- #endregion

-- #region 2. Two candidates accepted for one seat
DO $$
DECLARE
    r text[] := pg_temp.probe_race(
        format('SELECT projects.assign_from_application(%L)', pg_temp.pid('app1')), pg_temp.owner_of(0),
        format('SELECT projects.assign_from_application(%L)', pg_temp.pid('app2')), pg_temp.owner_of(0));
    v_seated bigint := pg_temp.live_on(1, 0) + pg_temp.live_on(2, 0);
    v_seat text;
    v_app2 text;
    v_told bigint;
BEGIN
    SELECT status INTO v_seat FROM projects.stage_open_seats WHERE id = pg_temp.pid('seat');
    SELECT status::text INTO v_app2 FROM projects.project_applications WHERE id = pg_temp.pid('app2');
    SELECT count(*) INTO v_told FROM comms.notifications
    WHERE user_id = pg_temp.who(2) AND type = 'application.declined'
        AND entity_id = pg_temp.pid('app2') AND payload->>'reason' = 'seat_filled';

    PERFORM pg_temp.probe_record('seat race: one seated',
        r[1] = 'ok' AND v_seated = 1 AND v_seat = 'filled',
        format('A=%s; B (%s) answered %s; seated=%s seat=%s', r[1], r[3], r[2], v_seated, v_seat));
    PERFORM pg_temp.probe_record('seat race: loser refused seat_filled',
        r[2] LIKE 'refused 23505 reason=seat_filled%',
        format('B answered %s', r[2]));
    PERFORM pg_temp.probe_record('seat race: loser rejected and told',
        v_app2 = 'rejected' AND v_told = 1,
        format('app2=%s; application.declined/seat_filled notices=%s', v_app2, v_told));
END $$;
-- #endregion

-- #region 3. One freelancer accepts two overlapping invitations at once
DO $$
DECLARE
    r text[] := pg_temp.probe_race(
        format('SELECT projects.respond_to_project_invitation(%L, true)', pg_temp.pid('inv3_1')), pg_temp.who(3),
        format('SELECT projects.respond_to_project_invitation(%L, true)', pg_temp.pid('inv3_2')), pg_temp.who(3));
    v_s1 bigint := pg_temp.live_on(3, 1);
    v_s2 bigint := pg_temp.live_on(3, 2);
BEGIN
    PERFORM pg_temp.probe_record('overlapping invites: second refused',
        r[1] = 'ok' AND r[2] LIKE 'refused 23P01%' AND v_s1 = 1 AND v_s2 = 0 AND r[3] = 'blocked on A',
        format('A=%s; B (%s) answered %s; on stage1=%s stage2=%s', r[1], r[3], r[2], v_s1, v_s2));
END $$;
-- #endregion

-- #region 4. Invitation accept vs application accept for one freelancer, overlapping stages
DO $$
DECLARE
    r text[] := pg_temp.probe_race(
        format('SELECT projects.respond_to_project_invitation(%L, true)', pg_temp.pid('inv4_1')), pg_temp.who(4),
        format('SELECT projects.assign_from_application(%L)', pg_temp.pid('app4')), pg_temp.owner_of(2));
    v_s1 bigint := pg_temp.live_on(4, 1);
    v_s2 bigint := pg_temp.live_on(4, 2);
BEGIN
    PERFORM pg_temp.probe_record('invite vs application: application refused',
        r[1] = 'ok' AND r[2] LIKE 'refused 23P01%' AND v_s1 = 1 AND v_s2 = 0,
        format('A=%s; B (%s) answered %s; on stage1=%s stage2=%s', r[1], r[3], r[2], v_s1, v_s2));
END $$;
-- #endregion

-- #region 5. Controls
DO $$
DECLARE
    ra text := pg_temp.probe_solo(
        format('SELECT projects.respond_to_project_invitation(%L, true)', pg_temp.pid('inv3_3')), pg_temp.who(3));
BEGIN
    PERFORM pg_temp.probe_record('non-overlapping invite still seats',
        ra = 'ok' AND pg_temp.live_on(3, 3) = 1,
        format('answered %s; on stage3=%s', ra, pg_temp.live_on(3, 3)));
END $$;

DO $$
DECLARE
    ra text := pg_temp.probe_solo(
        format('SELECT projects.withdraw_application(%L)', pg_temp.pid('app3')), pg_temp.who(3));
    v_told bigint;
BEGIN
    SELECT count(*) INTO v_told FROM comms.notifications
    WHERE user_id = pg_temp.owner_of(0) AND type = 'application.withdrawn'
        AND entity_id = pg_temp.pid('app3');
    PERFORM pg_temp.probe_record('withdrawal tells the owner',
        ra = 'ok' AND v_told = 1,
        format('answered %s; application.withdrawn notices=%s', ra, v_told));
END $$;
-- #endregion

-- #region 6. Verdict
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
