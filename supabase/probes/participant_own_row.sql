-- =============================================================================================
-- Probe: a participant reads their OWN projects.project_participants row (Decision #296 (D)), and
-- the seed carries a platform operator who hears contact.received (Decision #296 (E)).
--
-- Before the own-row arm, "View participants" let the owner see participant rows, or anyone on an
-- active public project, but never a participant their own seat on an invite-only engagement — so
-- the projects feed and the /contact dispute picker (both keyed on project_participants.profile_id)
-- left a hired freelancer's invite-only engagement out, and the dispute intent refused it by slug.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a seeded local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/participant_own_row.sql
--
-- A clean run prints only PASS notices; any FAIL raises and aborts.
-- =============================================================================================

BEGIN;

-- #region 0. Fixture: a participant on a non-public engagement they do not own (as postgres)
DO $$
DECLARE
    v_user uuid;
    v_project uuid;
BEGIN
    SELECT pp.profile_id, pp.project_id INTO v_user, v_project
      FROM projects.project_participants pp
      JOIN projects.projects p ON p.id = pp.project_id
      JOIN org.users_public u ON u.user_id = pp.profile_id
     WHERE p.visibility <> 'public'::visibility
       AND p.owner_user_id IS DISTINCT FROM pp.profile_id
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = pp.profile_id)
     ORDER BY pp.project_id, pp.profile_id
     LIMIT 1;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a participant on a non-public project (deno task db:reset)';
    END IF;
    PERFORM set_config('probe.user', v_user::text, true);
    PERFORM set_config('probe.project', v_project::text, true);
END $$;
-- #endregion

-- #region 1. The participant reads their own seat, and no one else's on a non-public project
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.user'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_user uuid := current_setting('probe.user')::uuid;
    v_project uuid := current_setting('probe.project')::uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM projects.project_participants
                WHERE project_id = v_project AND profile_id = v_user) THEN
        RAISE NOTICE 'PASS 1a a participant reads their own row on a non-public engagement';
    ELSE
        RAISE EXCEPTION 'FAIL 1a the participant cannot read their own seat';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM projects.project_participants pp
          JOIN projects.projects p ON p.id = pp.project_id
         WHERE pp.profile_id <> v_user
           AND p.visibility <> 'public'::visibility
           AND p.owner_user_id IS DISTINCT FROM v_user) THEN
        RAISE NOTICE 'PASS 1b nobody else''s seat on a non-public project they do not own';
    ELSE
        RAISE EXCEPTION 'FAIL 1b the own-row arm leaked another participant''s row';
    END IF;
END $$;
RESET ROLE;

-- An anonymous caller (auth.uid() IS NULL) gains nothing from the arm: the table is not granted to
-- anon at all, and were it granted, `profile_id = NULL` matches no row.
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM projects.project_participants pp
          JOIN projects.projects p ON p.id = pp.project_id
         WHERE p.visibility <> 'public'::visibility) THEN
        RAISE NOTICE 'PASS 1c anon reads no seat on a non-public project';
    ELSE
        RAISE EXCEPTION 'FAIL 1c anon read a non-public seat';
    END IF;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 1c anon cannot read project_participants at all';
END $$;
RESET ROLE;
-- #endregion

-- #region 2. The seeded operator hears contact.received
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ops.admin_users au JOIN org.users_public u ON u.user_id = au.user_id) THEN
        RAISE NOTICE 'PASS 2a the seed carries a platform operator with a profile';
    ELSE
        RAISE EXCEPTION 'FAIL 2a no seeded operator: contact.received would reach nobody';
    END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT set_config('probe.ref', ops.submit_contact_request(
    p_intent => 'support',
    p_email => 'participant-probe@example.invalid',
    p_anonymous => false,
    p_payload => '{"name":"Probe","topic":"getting-started","message":"A support message long enough to pass."}'::jsonb,
    p_attachment_ids => ARRAY[]::uuid[]) ->> 'id', true);
RESET ROLE;
DO $$
DECLARE
    v_id uuid := current_setting('probe.ref')::uuid;
    v_told int;
BEGIN
    SELECT count(*) INTO v_told FROM comms.notifications n
     WHERE n.type = 'contact.received' AND n.entity_id = v_id;
    IF v_told = (SELECT count(*) FROM ops.admin_users) AND v_told > 0
       AND NOT EXISTS (SELECT 1 FROM comms.notifications n
                        WHERE n.type = 'contact.received' AND n.entity_id = v_id
                          AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = n.user_id)) THEN
        RAISE NOTICE 'PASS 2b every operator is told of a new request (% told), nobody else', v_told;
    ELSE
        RAISE EXCEPTION 'FAIL 2b contact.received reached % rows for % operators', v_told,
            (SELECT count(*) FROM ops.admin_users);
    END IF;
END $$;
-- #endregion

ROLLBACK;
