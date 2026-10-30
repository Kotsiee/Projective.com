-- =============================================================================================
-- Probe: every table a client role can reach through PostgREST has RLS on and a policy
-- (IDENTITY_AND_WORKSPACES_AUDIT IW-H7, IW-M6; SYSTEM_ARCHITECTURE §Row-Level Security, "mandatory").
--
--   1. Every exposed schema (supabase/config.toml [api] schemas): a table on which `anon` or
--      `authenticated` holds ANY privilege, table- or column-level, has RLS enabled and at least one
--      policy. RLS with no policy is default-deny, so a grant on such a table means nothing but a
--      refusal; a grant on a table with RLS off is the whole table, to every caller.
--   2. The identity schemas (`org`, `security`), stricter: each client role holding a privilege on a
--      table is admitted by at least one of its policies (`TO <role>` or `TO public`) — a grant the
--      policies never answer for is a grant nobody decided on — and every table has RLS on, granted
--      or not (the four `security` tables that relied on holding no grant, IW-M6).
--   3. `org` is deny-by-default (00002500 / 00002520): no client role holds a privilege on an org
--      table beyond SELECT · INSERT · UPDATE · DELETE (never TRUNCATE, REFERENCES or TRIGGER, which
--      RLS does not bound), and no default privilege hands a future org table, view or sequence to a
--      client role.
--
-- Read-only: catalog queries in one transaction that ends in ROLLBACK. Run against a migrated DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/rls_exposed_tables.sql
--
-- Each section collects every violation before failing, so one run lists them all. A clean run
-- prints only PASS notices.
-- =============================================================================================

BEGIN;

-- The PostgREST-exposed schemas, as supabase/config.toml [api] `schemas` lists them. Keep in step.
CREATE TEMP TABLE probe_exposed (nspname name PRIMARY KEY);
INSERT INTO probe_exposed (nspname) VALUES
    ('public'), ('graphql_public'), ('org'), ('security'), ('projects'), ('comms'), ('files'),
    ('search'), ('marketplace'), ('catalogue'), ('reviews'), ('finance'), ('scheduling'),
    ('integrations'), ('ops'), ('editorial'), ('community');

-- Every (table, client role) pair where the role holds some privilege on the table.
CREATE TEMP VIEW probe_granted AS
SELECT c.oid, n.nspname, c.relname, r.rolname, c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN probe_exposed e ON e.nspname = n.nspname
 CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name)) r (rolname)
 WHERE c.relkind IN ('r', 'p')
   AND (has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        OR has_any_column_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'));

-- #region 1. Exposed + granted ⇒ RLS on and a policy
DO $$
DECLARE
    v_fail text[] := '{}';
    v_row record;
    v_count integer;
BEGIN
    FOR v_row IN
        SELECT g.oid, g.nspname, g.relname, g.relrowsecurity,
               (SELECT count(*) FROM pg_policy p WHERE p.polrelid = g.oid) AS policies,
               string_agg(g.rolname, ', ' ORDER BY g.rolname) AS roles
          FROM probe_granted g
         GROUP BY g.oid, g.nspname, g.relname, g.relrowsecurity
         ORDER BY g.nspname, g.relname
    LOOP
        IF NOT v_row.relrowsecurity THEN
            v_fail := v_fail || format('%I.%I: RLS is off, and %s holds a privilege on it',
                v_row.nspname, v_row.relname, v_row.roles);
        ELSIF v_row.policies = 0 THEN
            v_fail := v_fail || format('%I.%I: RLS on but no policy, and %s holds a privilege on it',
                v_row.nspname, v_row.relname, v_row.roles);
        END IF;
    END LOOP;
    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL exposed tables — %', E'\n  ' || array_to_string(v_fail, E'\n  ');
    END IF;
    SELECT count(DISTINCT oid) INTO v_count FROM probe_granted;
    RAISE NOTICE 'PASS every one of the % client-granted exposed tables has RLS on and a policy', v_count;
END $$;
-- #endregion

-- #region 2. org + security: every grant answered by a policy for that role; RLS on everywhere
DO $$
DECLARE
    v_fail text[] := '{}';
    v_row record;
BEGIN
    FOR v_row IN
        SELECT g.nspname, g.relname, g.rolname
          FROM probe_granted g
         WHERE g.nspname IN ('org', 'security')
           AND NOT EXISTS (
               SELECT 1 FROM pg_policy p
                WHERE p.polrelid = g.oid
                  AND (0::oid = ANY (p.polroles)
                       OR (SELECT oid FROM pg_roles WHERE rolname = g.rolname) = ANY (p.polroles)))
         ORDER BY 1, 2, 3
    LOOP
        v_fail := v_fail || format('%I.%I: %s holds a privilege no policy admits it to',
            v_row.nspname, v_row.relname, v_row.rolname);
    END LOOP;
    FOR v_row IN
        SELECT n.nspname, c.relname
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('org', 'security') AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
         ORDER BY 1, 2
    LOOP
        v_fail := v_fail || format('%I.%I: RLS is off', v_row.nspname, v_row.relname);
    END LOOP;
    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL identity schemas — %', E'\n  ' || array_to_string(v_fail, E'\n  ');
    END IF;
    RAISE NOTICE 'PASS org + security: RLS on every table, and every client grant answered by a policy for its role';
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'security'
           AND c.relname IN ('audit_logs', 'feature_flags', 'refresh_tokens', 'turnstile_verifications')
           AND (NOT c.relrowsecurity
                OR has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
                OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
    ) OR (
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'security'
           AND c.relname IN ('audit_logs', 'feature_flags', 'refresh_tokens', 'turnstile_verifications')
    ) <> 4 THEN
        RAISE EXCEPTION 'FAIL IW-M6 — the four security tables must exist, have RLS on and no client grant';
    END IF;
    RAISE NOTICE 'PASS IW-M6: audit_logs, feature_flags, refresh_tokens, turnstile_verifications — RLS on, no client grant';
END $$;
-- #endregion

-- #region 3. org is deny-by-default
DO $$
DECLARE
    v_fail text[] := '{}';
    v_row record;
BEGIN
    -- Table-level privileges beyond the four row verbs.
    FOR v_row IN
        SELECT c.relname, r.rolname, p.priv
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name)) r (rolname)
         CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (priv)
         WHERE n.nspname = 'org' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
           AND has_table_privilege(r.rolname, c.oid, p.priv)
         ORDER BY 1, 2, 3
    LOOP
        v_fail := v_fail || format('org.%I: %s holds %s', v_row.relname, v_row.rolname, v_row.priv);
    END LOOP;
    -- Column-level REFERENCES.
    FOR v_row IN
        SELECT c.relname, r.rolname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name)) r (rolname)
         WHERE n.nspname = 'org' AND c.relkind IN ('r', 'p')
           AND has_any_column_privilege(r.rolname, c.oid, 'REFERENCES')
         ORDER BY 1, 2
    LOOP
        v_fail := v_fail || format('org.%I: %s holds REFERENCES on a column', v_row.relname, v_row.rolname);
    END LOOP;
    -- Sequences.
    FOR v_row IN
        SELECT c.relname, r.rolname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name)) r (rolname)
         WHERE n.nspname = 'org' AND c.relkind = 'S'
           AND has_sequence_privilege(r.rolname, c.oid, 'USAGE, SELECT, UPDATE')
         ORDER BY 1, 2
    LOOP
        v_fail := v_fail || format('org.%I (sequence): %s holds a privilege', v_row.relname, v_row.rolname);
    END LOOP;
    -- Default privileges: nothing future reaches a client role on its own.
    FOR v_row IN
        SELECT d.defaclobjtype, a.grantee::regrole::text AS grantee
          FROM pg_default_acl d
          JOIN pg_namespace n ON n.oid = d.defaclnamespace
         CROSS JOIN LATERAL aclexplode(d.defaclacl) a
         WHERE n.nspname = 'org'
           AND a.grantee IN ('anon'::regrole::oid, 'authenticated'::regrole::oid)
         ORDER BY 1, 2
    LOOP
        v_fail := v_fail || format('org default privileges (objtype %s) grant to %s',
            v_row.defaclobjtype, v_row.grantee);
    END LOOP;
    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL org deny-by-default — %', E'\n  ' || array_to_string(v_fail, E'\n  ');
    END IF;
    RAISE NOTICE 'PASS org: client roles hold only row verbs, and no default privilege reaches them';
END $$;

-- The definer-only tables stay definer-only: a direct read is refused, not answered.
DO $$
DECLARE
    v_fail text[] := '{}';
    v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'org.business_profiles', 'org.org_invitations', 'org.org_invite_links', 'org.org_join_requests',
        'org.portfolios', 'org.profile_links', 'org.user_skills', 'org.email_verification_tokens'
    ] LOOP
        IF has_table_privilege('anon', v_table, 'SELECT, INSERT, UPDATE, DELETE')
           OR has_table_privilege('authenticated', v_table, 'SELECT, INSERT, UPDATE, DELETE')
           OR has_any_column_privilege('anon', v_table, 'SELECT, INSERT, UPDATE')
           OR has_any_column_privilege('authenticated', v_table, 'SELECT, INSERT, UPDATE') THEN
            v_fail := v_fail || format('%s: a client role holds a privilege on a definer-only table', v_table);
        END IF;
    END LOOP;
    IF NOT has_table_privilege('anon', 'org.profiles_index', 'SELECT')
       OR has_table_privilege('anon', 'org.profiles_index', 'INSERT, UPDATE, DELETE')
       OR NOT has_table_privilege('authenticated', 'org.view_business_staff', 'SELECT')
       OR has_table_privilege('anon', 'org.view_business_staff', 'SELECT') THEN
        v_fail := v_fail || 'the org views: profiles_index SELECT to both client roles, view_business_staff to authenticated only'::text;
    END IF;
    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL org definer-only — %', E'\n  ' || array_to_string(v_fail, E'\n  ');
    END IF;
    RAISE NOTICE 'PASS org: the eight definer-only tables hold no client grant; the two views read-only';
END $$;

-- Behaviour, not just the catalog: as each client role, a write PostgREST would issue is refused.
SET LOCAL ROLE anon;
DO $$
BEGIN
    BEGIN
        INSERT INTO org.profile_follows (follower_user_id, target_entity_type, target_entity_id)
        VALUES (gen_random_uuid(), 'user', gen_random_uuid());
        RAISE EXCEPTION 'FAIL anon inserted into org.profile_follows';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS anon may not write a follow (42501)';
    END;
    BEGIN
        PERFORM 1 FROM org.teams LIMIT 1;
        RAISE EXCEPTION 'FAIL anon read org.teams';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS anon holds nothing on org.teams (42501)';
    END;
    PERFORM 1 FROM org.skills LIMIT 1;
    RAISE NOTICE 'PASS anon still reads the public reference data (org.skills)';
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM org.business_profiles LIMIT 1;
        RAISE EXCEPTION 'FAIL authenticated read org.business_profiles directly';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS authenticated reads org.business_profiles only through its definers (42501)';
    END;
    BEGIN
        UPDATE org.teams SET name = name WHERE false;
        RAISE EXCEPTION 'FAIL authenticated holds UPDATE on org.teams';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS authenticated may not UPDATE org.teams (42501)';
    END;
    BEGIN
        PERFORM 1 FROM security.audit_logs LIMIT 1;
        RAISE EXCEPTION 'FAIL authenticated read security.audit_logs';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS authenticated holds nothing on security.audit_logs (42501)';
    END;
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
