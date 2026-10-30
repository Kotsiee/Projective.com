-- =============================================================================================
-- Probe: function EXECUTE grants on the PostgREST-exposed `projects` and `public` schemas
-- (00002510 "projects — deny by default" / "public — deny by default"), the self-claim rule of
-- projects.claim_ticket (00001120) and the pinned search_path of every SECURITY DEFINER there.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/function_grants.sql
--
-- Section 1 collects every grant violation before failing, so one run lists them all. Every other
-- expected refusal raises `FAIL …` and aborts the run. A clean run prints only PASS notices.
-- Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================

BEGIN;

-- #region 1. Catalog assertions (as postgres)
DO $$
DECLARE
    v_fail text[] := '{}';
    r      record;
BEGIN
    -- No client role reaches the provisioning routine or the claim core; the claim door itself is
    -- signed-in only.
    FOR r IN
        SELECT * FROM (VALUES
            ('anon',          'public.provision_user_profile(uuid,text,timestamptz,jsonb)', false),
            ('authenticated', 'public.provision_user_profile(uuid,text,timestamptz,jsonb)', false),
            ('anon',          'public.complete_onboarding(jsonb)', false),
            ('authenticated', 'public.complete_onboarding(jsonb)', true),
            ('anon',          'public.handle_new_user()', false),
            ('authenticated', 'public.handle_new_user()', false),
            ('anon',          'public.handle_email_confirmed()', false),
            ('authenticated', 'public.handle_email_confirmed()', false),
            ('anon',          'projects.claim_ticket(uuid,uuid)', false),
            ('authenticated', 'projects.claim_ticket(uuid,uuid)', true),
            ('anon',          'projects.fn_assign_ticket_core(uuid,uuid,boolean)', false),
            ('authenticated', 'projects.fn_assign_ticket_core(uuid,uuid,boolean)', false),
            ('anon',          'projects.assign_ticket_manual(uuid,uuid)', false),
            ('authenticated', 'projects.assign_ticket_manual(uuid,uuid)', true),
            ('authenticated', 'projects.check_ticket_capacity(uuid,uuid)', false),
            ('anon',          'projects.move_ticket(uuid,ticket_status,uuid,integer,timestamp with time zone)', false),
            ('authenticated', 'projects.move_ticket(uuid,ticket_status,uuid,integer,timestamp with time zone)', true),
            ('anon',          'projects.fund_stage(uuid,uuid)', false),
            ('authenticated', 'projects.fund_stage(uuid,uuid)', true),
            ('service_role',  'projects.claim_ticket(uuid,uuid)', true),
            -- RLS predicates: a policy expression runs as the invoking role.
            ('anon',          'projects.has_project_access(uuid)', true),
            ('authenticated', 'projects.has_project_access(uuid)', true),
            ('anon',          'projects.can_review_project(uuid)', true),
            ('authenticated', 'projects.can_manage_project_members(uuid)', true),
            ('authenticated', 'projects.has_stage_access(uuid)', true),
            ('authenticated', 'projects.is_cohort_member(uuid)', true),
            -- The guest offer read stays public.
            ('anon',          'projects.get_cohort_offer(uuid)', true),
            -- Extension members in `public` keep their grants (pgvector ops back the search doors).
            ('anon',          'public.cosine_distance(public.vector,public.vector)', true),
            ('authenticated', 'public.similarity(text,text)', true)
        ) AS t(role_name, fn, expected)
    LOOP
        IF has_function_privilege(r.role_name, r.fn::regprocedure, 'EXECUTE') <> r.expected THEN
            v_fail := v_fail || format('%s %s EXECUTE on %s', r.role_name,
                CASE WHEN r.expected THEN 'lacks' ELSE 'holds' END, r.fn);
        END IF;
    END LOOP;

    -- Deny by default: PUBLIC holds EXECUTE on no app-owned function in either schema.
    FOR r IN
        SELECT p.oid::regprocedure AS fn
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('projects', 'public')
            AND NOT EXISTS (SELECT 1 FROM pg_depend d
                            WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
            AND (p.proacl IS NULL
                 OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
    LOOP
        v_fail := v_fail || format('PUBLIC holds EXECUTE on %s', r.fn);
    END LOOP;

    -- Every SECURITY DEFINER in either schema pins its search_path.
    FOR r IN
        SELECT p.oid::regprocedure AS fn
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('projects', 'public')
            AND p.prosecdef
            AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
    LOOP
        v_fail := v_fail || format('SECURITY DEFINER without SET search_path: %s', r.fn);
    END LOOP;

    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL % grant violation(s):%', cardinality(v_fail),
            E'\n  ' || array_to_string(v_fail, E'\n  ');
    END IF;
    RAISE NOTICE 'PASS catalog: grants, deny-by-default and pinned search_path';
END $$;
-- #endregion

-- #region 2. Fixtures (as postgres)
-- An unclaimed, described ticket on a self-claim (open_pull) stage, a freelancer participant of its
-- project with no review authority, another person to claim on behalf of, and an outsider.
DO $$
DECLARE
    c  record;
    v_other    uuid;
    v_outsider uuid;
BEGIN
    FOR c IN
        SELECT t.id AS ticket, t.project_id AS project, pp.profile_id AS freelancer
        FROM projects.tickets t
        LEFT JOIN projects.project_stages s ON s.id = t.current_stage_id
        JOIN projects.project_participants pp
            ON pp.project_id = t.project_id AND pp.profile_type = 'freelancer'
        WHERE t.current_assignee_id IS NULL
            AND t.description IS DISTINCT FROM '{}'::jsonb
            AND COALESCE(s.assignment_mode::text, 'open_pull') = 'open_pull'
        ORDER BY t.id, pp.profile_id
    LOOP
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', c.freelancer, 'role', 'authenticated')::text, true);
        CONTINUE WHEN NOT projects.has_project_access(c.project) OR projects.can_review_project(c.project);

        SELECT u.user_id INTO v_other FROM org.users_public u
        WHERE u.user_id <> c.freelancer ORDER BY u.user_id LIMIT 1;

        v_outsider := NULL;
        FOR v_outsider IN
            SELECT fp.user_id FROM org.freelancer_profiles fp
            WHERE fp.user_id NOT IN (c.freelancer, v_other) ORDER BY fp.user_id
        LOOP
            PERFORM set_config('request.jwt.claims',
                json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
            EXIT WHEN NOT projects.has_project_access(c.project);
            v_outsider := NULL;
        END LOOP;
        CONTINUE WHEN v_other IS NULL OR v_outsider IS NULL;

        PERFORM set_config('probe.ticket', c.ticket::text, true);
        PERFORM set_config('probe.project', c.project::text, true);
        PERFORM set_config('probe.freelancer', c.freelancer::text, true);
        PERFORM set_config('probe.other', v_other::text, true);
        PERFORM set_config('probe.outsider', v_outsider::text, true);
        PERFORM set_config('request.jwt.claims', '', true);
        RAISE NOTICE 'fixture ticket=% project=% freelancer=% other=% outsider=%',
            c.ticket, c.project, c.freelancer, v_other, v_outsider;
        RETURN;
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: need an unclaimed open_pull ticket with a freelancer participant (deno task db:reset)';
END $$;
-- #endregion

-- #region 3. anon — refused by the grant before any body runs
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        format('SELECT public.provision_user_profile(%L, ''probe@example.invalid'', NULL, ''{"username":"probe","dob":"1900-01-01"}''::jsonb)',
            gen_random_uuid()),
        format('SELECT projects.claim_ticket(%L, %L)', current_setting('probe.ticket'), current_setting('probe.freelancer')),
        format('SELECT projects.fn_assign_ticket_core(%L, %L, false)', current_setting('probe.ticket'), current_setting('probe.freelancer'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL anon executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS anon refused [%]: %', SQLERRM, left(v_sql, 60);
        END;
    END LOOP;
END $$;
RESET ROLE;
-- #endregion

-- #region 4. authenticated — the claim core and provisioning are unreachable; claim_ticket is self-only
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.freelancer'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        format('SELECT public.provision_user_profile(%L, ''probe@example.invalid'', NULL, ''{"username":"probe","dob":"1900-01-01"}''::jsonb)',
            gen_random_uuid()),
        format('SELECT projects.fn_assign_ticket_core(%L, %L, false)', current_setting('probe.ticket'), current_setting('probe.other')),
        -- A participant attaching somebody else: the escrow hold must never fire.
        format('SELECT projects.claim_ticket(%L, %L)', current_setting('probe.ticket'), current_setting('probe.other'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL participant executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS participant refused [%]: %', SQLERRM, left(v_sql, 60);
        END;
    END LOOP;
END $$;

SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
DO $$
BEGIN
    PERFORM projects.claim_ticket(current_setting('probe.ticket')::uuid, current_setting('probe.freelancer')::uuid);
    RAISE EXCEPTION 'FAIL subject-less caller claimed';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS no-subject refused [%]', SQLERRM;
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.outsider'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    PERFORM projects.claim_ticket(current_setting('probe.ticket')::uuid, current_setting('probe.outsider')::uuid);
    RAISE EXCEPTION 'FAIL outsider self-claimed a ticket on a project they cannot access';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS outsider refused [%]', SQLERRM;
END $$;

-- The participant's own claim clears the authority gate. Capacity or funding may still refuse it
-- further in; only a 42501 would mean the self-claim rule is too tight.
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.freelancer'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_escrow uuid;
BEGIN
    v_escrow := projects.claim_ticket(current_setting('probe.ticket')::uuid, current_setting('probe.freelancer')::uuid);
    RAISE NOTICE 'PASS self-claim accepted (escrow=%)', COALESCE(v_escrow::text, 'none: needs funding');
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'FAIL self-claim refused by the authority gate: %', SQLERRM;
    WHEN OTHERS THEN
        RAISE NOTICE 'PASS self-claim cleared the authority gate, refused further in [%]: %', SQLSTATE, SQLERRM;
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
