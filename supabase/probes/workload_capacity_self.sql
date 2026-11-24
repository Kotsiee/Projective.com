-- =============================================================================================
-- Probe: a freelancer's workload gauge reads only the caller's own load (PROJECTS ST4, PJ-11).
--
-- THE DEFECT, found by reading on 2026-11-19: projects.get_workload_capacity(p_user_id, p_project_id)
-- (00001140) is a SECURITY DEFINER that answers for whatever user it is handed. It was ungranted, so
-- no gauge could call it; granting it as it stands would let any signed-in caller read anyone's Σ W_i
-- and cap.
--
-- What is asserted:
--   1. projects.get_my_workload_capacity() exists, takes no argument, is a definer with a pinned empty
--      search_path; authenticated may execute it and anon may not. The two-argument reader stays
--      ungranted to both client roles.
--   2. Signed in as B, naming A is impossible: get_workload_capacity(A) is refused 42501 and
--      get_my_workload_capacity(A) does not resolve (42883).
--   3. Signed in as A, the self-reader answers A's own Σ W_i over held tickets (claimed · in_progress ·
--      in_review · reported_hidden), ticket count, cap and per-stage split, each computed here from
--      the tables; as B it answers B's, never A's.
--   4. Signed in with no subject it answers NULL; as anon it is refused 42501.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/workload_capacity_self.sql
--
-- Fixtures are discovered from the seed (deno task db:reset): A is the freelancer holding the most
-- W_i, B the first other freelancer whose load differs from A's. A clean run prints only `ok` lines.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;
-- The pg_temp helpers below run as anon and authenticated, and 00002500 gives a new function no PUBLIC
-- EXECUTE; this hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region 0. Helpers + fixtures (as postgres)
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true),
           pg_catalog.set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN ''
               ELSE pg_catalog.json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$$;

-- What the gauge must show for a user, computed from the tables rather than from the function body.
CREATE FUNCTION pg_temp.expected(p_user uuid) RETURNS jsonb LANGUAGE sql AS $$
    SELECT pg_catalog.jsonb_build_object(
        'current', (SELECT COALESCE(pg_catalog.sum(t.workload_intensity), 0)
                    FROM projects.tickets t
                    WHERE t.current_assignee_id = p_user
                      AND t.status IN ('claimed', 'in_progress', 'in_review', 'reported_hidden')),
        'ticket_count', (SELECT pg_catalog.count(*)
                         FROM projects.tickets t
                         WHERE t.current_assignee_id = p_user
                           AND t.status IN ('claimed', 'in_progress', 'in_review', 'reported_hidden')),
        'cap', COALESCE(
            (SELECT fp.max_workload_intensity FROM org.freelancer_profiles fp WHERE fp.user_id = p_user),
            (SELECT (pp.value #>> '{}')::numeric FROM security.platform_params pp
             WHERE pp.key = 'global_workload_cap_default'),
            10.00),
        'stages', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('stage_id', x.stage_id, 'current', x.cur)
                                        ORDER BY x.stage_id)
            FROM (SELECT t.current_stage_id AS stage_id, pg_catalog.sum(t.workload_intensity) AS cur
                  FROM projects.tickets t
                  WHERE t.current_assignee_id = p_user AND t.current_stage_id IS NOT NULL
                    AND t.status IN ('claimed', 'in_progress', 'in_review', 'reported_hidden')
                  GROUP BY t.current_stage_id) x), '[]'::jsonb));
$$;

-- Compares against the figures region 0 stored as postgres: the helpers run as the caller, who
-- cannot read other people's tickets.
CREATE FUNCTION pg_temp.matches(p_got jsonb, p_who text) RETURNS boolean LANGUAGE sql AS $$
    SELECT p_got IS NOT NULL
       AND (p_got ->> 'user_id')::uuid = pg_temp.s(p_who)::uuid
       AND (p_got ->> 'current')::numeric = (pg_temp.s(p_who || '_expected')::jsonb ->> 'current')::numeric
       AND (p_got ->> 'cap')::numeric = (pg_temp.s(p_who || '_expected')::jsonb ->> 'cap')::numeric
       AND (p_got ->> 'ticket_count')::integer
           = (pg_temp.s(p_who || '_expected')::jsonb ->> 'ticket_count')::integer
       AND (p_got -> 'stages') = (pg_temp.s(p_who || '_expected')::jsonb -> 'stages');
$$;

DO $$
DECLARE
    v_a uuid;
    v_b uuid;
BEGIN
    SELECT t.current_assignee_id INTO v_a
    FROM projects.tickets t
    JOIN org.freelancer_profiles fp ON fp.user_id = t.current_assignee_id
    WHERE t.status IN ('claimed', 'in_progress', 'in_review', 'reported_hidden')
    GROUP BY t.current_assignee_id
    ORDER BY pg_catalog.sum(t.workload_intensity) DESC, t.current_assignee_id
    LIMIT 1;
    IF v_a IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: need a freelancer holding a ticket (deno task db:reset)';
    END IF;

    SELECT fp.user_id INTO v_b
    FROM org.freelancer_profiles fp
    WHERE fp.user_id <> v_a
      AND (pg_temp.expected(fp.user_id) ->> 'current')::numeric
          <> (pg_temp.expected(v_a) ->> 'current')::numeric
    ORDER BY fp.user_id
    LIMIT 1;
    IF v_b IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: need a second freelancer whose load differs from %', v_a;
    END IF;

    PERFORM pg_catalog.set_config('probe.a', v_a::text, true);
    PERFORM pg_catalog.set_config('probe.b', v_b::text, true);
    PERFORM pg_catalog.set_config('probe.a_expected', pg_temp.expected(v_a)::text, true);
    PERFORM pg_catalog.set_config('probe.b_expected', pg_temp.expected(v_b)::text, true);
    RAISE NOTICE 'fixture a=% (%), b=% (%)', v_a, pg_temp.expected(v_a), v_b, pg_temp.expected(v_b);
END $$;
-- #endregion

-- #region 1. Shape and grants (as postgres)
DO $$
DECLARE
    v_fn regprocedure := pg_catalog.to_regprocedure('projects.get_my_workload_capacity()');
BEGIN
    PERFORM pg_temp.ok(v_fn IS NOT NULL, 'projects.get_my_workload_capacity() exists and takes no argument');
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'projects' AND p.proname = 'get_my_workload_capacity'
                      AND p.pronargs > 0),
        'no overload of get_my_workload_capacity takes an argument');
    PERFORM pg_temp.ok(
        (SELECT p.prosecdef AND 'search_path=""' = ANY (p.proconfig)
         FROM pg_catalog.pg_proc p WHERE p.oid = v_fn),
        'get_my_workload_capacity is a definer with search_path pinned to ''''');
    PERFORM pg_temp.ok(pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE'),
        'authenticated may execute get_my_workload_capacity()');
    PERFORM pg_temp.ok(NOT pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE'),
        'anon may not execute get_my_workload_capacity()');
    PERFORM pg_temp.ok(NOT pg_catalog.has_function_privilege('authenticated',
            'projects.get_workload_capacity(uuid,uuid)'::regprocedure, 'EXECUTE'),
        'authenticated may not execute get_workload_capacity(uuid, uuid)');
    PERFORM pg_temp.ok(NOT pg_catalog.has_function_privilege('anon',
            'projects.get_workload_capacity(uuid,uuid)'::regprocedure, 'EXECUTE'),
        'anon may not execute get_workload_capacity(uuid, uuid)');
END $$;
-- #endregion

-- #region 2. B cannot name A (authenticated)
DO $$ BEGIN PERFORM pg_temp.as_user(pg_temp.s('b')::uuid); END $$;
SET LOCAL ROLE authenticated;

DO $$
BEGIN
    PERFORM projects.get_workload_capacity(pg_temp.s('a')::uuid, NULL);
    RAISE EXCEPTION 'PROBE FAIL: B read A''s capacity through get_workload_capacity';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  B calling get_workload_capacity(A) is refused 42501';
END $$;

DO $$
BEGIN
    EXECUTE pg_catalog.format('SELECT projects.get_my_workload_capacity(%L::uuid)', pg_temp.s('a'));
    RAISE EXCEPTION 'PROBE FAIL: get_my_workload_capacity accepted a user argument';
EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE 'ok  get_my_workload_capacity(A) does not resolve (42883)';
END $$;
-- #endregion

-- #region 3. Each caller reads their own load (authenticated)
DO $$
DECLARE
    v_got jsonb := projects.get_my_workload_capacity();
BEGIN
    PERFORM pg_temp.ok(pg_temp.matches(v_got, 'b'),
        pg_catalog.format('as B the self-reader answers B''s own load (%s)', v_got));
    PERFORM pg_temp.ok(NOT pg_temp.matches(v_got, 'a'),
        'as B the self-reader does not answer A''s load');
END $$;

DO $$ BEGIN PERFORM pg_temp.as_user(pg_temp.s('a')::uuid); END $$;
DO $$
DECLARE
    v_got jsonb := projects.get_my_workload_capacity();
BEGIN
    PERFORM pg_temp.ok(pg_temp.matches(v_got, 'a'),
        pg_catalog.format('as A the self-reader answers A''s own load (%s)', v_got));
    PERFORM pg_temp.ok((v_got ->> 'current')::numeric > 0, 'A''s load is a real, non-zero Σ W_i');
END $$;
-- #endregion

-- #region 4. No subject, and anon
DO $$ BEGIN PERFORM pg_temp.as_user(NULL); END $$;
DO $$
BEGIN
    PERFORM pg_temp.ok(projects.get_my_workload_capacity() IS NULL,
        'signed in with no subject the self-reader answers NULL');
END $$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
    PERFORM projects.get_my_workload_capacity();
    RAISE EXCEPTION 'PROBE FAIL: anon executed get_my_workload_capacity';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  anon calling get_my_workload_capacity is refused 42501';
END $$;
-- #endregion

ROLLBACK;
