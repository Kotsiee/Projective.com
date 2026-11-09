-- =============================================================================================
-- Probe: who else may open a file (Decision #402). files.set_item_access saves a file's tier, its
-- library's member switch and its grants in one write; files.fn_can_read counts a grant only while the
-- file is not `private`; an editor changes the grants but never the tier; a new grant names a person
-- who exists or a team / project the granter is in; a team's file turned away from its members stays
-- open to its admins and its creator, and its bytes are withheld from storage reads too.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/item_access.sql
--
-- A clean run prints only PASS notices; any gap raises `FAIL …` and aborts.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_project uuid;
    v_owner uuid;
    v_member uuid;
    v_grantee uuid;
    v_outsider uuid;
    v_team uuid;
    v_admin uuid;
    v_creator uuid;
    v_teammate uuid;
    v_foreign_team uuid;
    v_candidate uuid;
    v_file uuid := gen_random_uuid();
    v_team_file uuid := gen_random_uuid();
    v_project_file uuid := gen_random_uuid();
BEGIN
    -- A project with an owner and one other person on it.
    FOR v_project, v_owner IN SELECT p.id, p.owner_user_id FROM projects.projects p ORDER BY p.id LOOP
        FOR v_candidate IN
            SELECT u.user_id FROM org.users_public u WHERE u.user_id <> v_owner ORDER BY u.user_id LIMIT 400
        LOOP
            PERFORM set_config('request.jwt.claims',
                json_build_object('sub', v_candidate, 'role', 'authenticated')::text, true);
            IF projects.has_project_access (v_project) THEN
                v_member := v_candidate;
                EXIT;
            END IF;
        END LOOP;
        EXIT WHEN v_member IS NOT NULL;
    END LOOP;
    IF v_member IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no project with two people (deno task db:reset)'; END IF;

    -- A team with an admin and two other active members; another team the owner is not in.
    SELECT m.team_id INTO v_team FROM org.team_members m WHERE m.status = 'active'
    GROUP BY m.team_id
    HAVING count(*) FILTER (WHERE m.role IN ('owner', 'admin')) >= 1
       AND count(*) FILTER (WHERE m.role NOT IN ('owner', 'admin')) >= 2
    ORDER BY m.team_id LIMIT 1;
    IF v_team IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no team with an admin and two members'; END IF;
    SELECT m.user_id INTO v_admin FROM org.team_members m
    WHERE m.team_id = v_team AND m.status = 'active' AND m.role IN ('owner', 'admin') ORDER BY m.user_id LIMIT 1;
    SELECT min(m.user_id::text)::uuid, max(m.user_id::text)::uuid INTO v_creator, v_teammate
    FROM org.team_members m
    WHERE m.team_id = v_team AND m.status = 'active' AND m.role NOT IN ('owner', 'admin');

    SELECT t.id INTO v_foreign_team FROM org.teams t
    WHERE NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.team_id = t.id AND m.user_id = v_owner AND m.status = 'active')
    ORDER BY t.id LIMIT 1;
    IF v_foreign_team IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no team the owner is outside'; END IF;

    -- Two people with no road to the file, the project or the team.
    FOR v_candidate IN
        SELECT u.user_id FROM org.users_public u
        WHERE u.user_id NOT IN (v_owner, v_member)
          AND NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.team_id = v_team AND m.user_id = u.user_id)
        ORDER BY u.user_id
    LOOP
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', v_candidate, 'role', 'authenticated')::text, true);
        CONTINUE WHEN projects.has_project_access (v_project);
        IF v_grantee IS NULL THEN
            v_grantee := v_candidate;
        ELSE
            v_outsider := v_candidate;
            EXIT;
        END IF;
    END LOOP;
    IF v_outsider IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no two people outside the project and team'; END IF;

    INSERT INTO files.items (id, owner_user_id, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes, status, visibility, source, owner_type)
    VALUES
        (v_file, v_owner, 'personal', v_owner || '/probe-access.pdf', 'probe-access.pdf',
         'probe-access.pdf', 'application/pdf', 1024, 'uploaded', 'private', 'supabase', 'user'),
        (v_project_file, v_owner, 'project', v_project || '/probe-access.pdf', 'probe-access.pdf',
         'probe-access.pdf', 'application/pdf', 1024, 'uploaded', 'private', 'supabase', 'user');
    INSERT INTO files.items (id, owner_user_id, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes, status, visibility, source, owner_type, owner_entity_id)
    VALUES (v_team_file, v_creator, 'workspace', v_team || '/probe-access.pdf', 'probe-access.pdf',
            'probe-access.pdf', 'application/pdf', 1024, 'uploaded', 'private', 'supabase', 'team', v_team);

    PERFORM set_config('probe.owner', v_owner::text, true);
    PERFORM set_config('probe.member', v_member::text, true);
    PERFORM set_config('probe.grantee', v_grantee::text, true);
    PERFORM set_config('probe.outsider', v_outsider::text, true);
    PERFORM set_config('probe.project', v_project::text, true);
    PERFORM set_config('probe.team', v_team::text, true);
    PERFORM set_config('probe.admin', v_admin::text, true);
    PERFORM set_config('probe.creator', v_creator::text, true);
    PERFORM set_config('probe.teammate', v_teammate::text, true);
    PERFORM set_config('probe.foreign_team', v_foreign_team::text, true);
    PERFORM set_config('probe.file', v_file::text, true);
    PERFORM set_config('probe.team_file', v_team_file::text, true);
    PERFORM set_config('probe.project_file', v_project_file::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as (p_setting text) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims',
        json_build_object('sub', current_setting(p_setting), 'role', 'authenticated')::text, true);
$$;

CREATE OR REPLACE FUNCTION pg_temp.can_read (p_setting text) RETURNS boolean LANGUAGE sql AS $$
    SELECT files.fn_can_read(current_setting(p_setting)::uuid);
$$;

CREATE OR REPLACE FUNCTION pg_temp.grants (VARIADIC p_pairs text[]) RETURNS jsonb LANGUAGE sql AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'kind', split_part(pair, '=', 1),
        'id', current_setting(split_part(split_part(pair, '=', 2), '/', 1)),
        'role', split_part(split_part(pair, '=', 2), '/', 2))), '[]'::jsonb)
    FROM unnest(p_pairs) pair;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;
SET LOCAL ROLE authenticated;
-- #endregion

-- #region 1. The owner grants one person; they open it, nobody else does
DO $$
BEGIN
    PERFORM pg_temp.act_as('probe.owner');
    PERFORM files.set_item_access(current_setting('probe.file')::uuid, 'restricted', NULL,
        pg_temp.grants('user=probe.grantee/viewer'));

    PERFORM pg_temp.act_as('probe.grantee');
    IF NOT pg_temp.can_read('probe.file') THEN RAISE EXCEPTION 'FAIL a granted person cannot open the file'; END IF;
    PERFORM pg_temp.act_as('probe.outsider');
    IF pg_temp.can_read('probe.file') THEN RAISE EXCEPTION 'FAIL an outsider opened a restricted file'; END IF;
    RAISE NOTICE 'PASS a granted person opens a restricted file, an outsider does not';

    PERFORM pg_temp.act_as('probe.grantee');
    IF (files.get_item_access(current_setting('probe.file')::uuid) ->> 'standing') <> 'viewer'
       OR jsonb_array_length(files.get_item_access(current_setting('probe.file')::uuid) -> 'grants') <> 0 THEN
        RAISE EXCEPTION 'FAIL a viewer was shown more than their own standing';
    END IF;
    BEGIN
        PERFORM files.set_item_access(current_setting('probe.file')::uuid, NULL, NULL, '[]'::jsonb);
        RAISE EXCEPTION 'FAIL a viewer changed the grants';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a viewer sees only their standing and cannot change who has access';
    END;
END $$;
-- #endregion

-- #region 2. Private pauses every grant; Restricted brings them back
DO $$
BEGIN
    PERFORM pg_temp.act_as('probe.owner');
    PERFORM files.set_item_access(current_setting('probe.file')::uuid, 'private', NULL, NULL);
    PERFORM pg_temp.act_as('probe.grantee');
    IF pg_temp.can_read('probe.file') THEN RAISE EXCEPTION 'FAIL a grant opened a private file'; END IF;

    PERFORM pg_temp.act_as('probe.owner');
    IF jsonb_array_length(files.get_item_access(current_setting('probe.file')::uuid) -> 'grants') <> 1 THEN
        RAISE EXCEPTION 'FAIL going private dropped the grant instead of pausing it';
    END IF;
    PERFORM files.set_item_access(current_setting('probe.file')::uuid, 'restricted', NULL, NULL);
    PERFORM pg_temp.act_as('probe.grantee');
    IF NOT pg_temp.can_read('probe.file') THEN RAISE EXCEPTION 'FAIL the grant did not come back'; END IF;
    RAISE NOTICE 'PASS private pauses a grant and restricted brings it back';
END $$;
-- #endregion

-- #region 3. An editor changes the grants, never the tier
DO $$
BEGIN
    PERFORM pg_temp.act_as('probe.owner');
    PERFORM files.set_item_access(current_setting('probe.file')::uuid, NULL, NULL,
        pg_temp.grants('user=probe.grantee/editor'));

    PERFORM pg_temp.act_as('probe.grantee');
    IF (files.get_item_access(current_setting('probe.file')::uuid) ->> 'standing') <> 'editor' THEN
        RAISE EXCEPTION 'FAIL an editor grant did not make an editor';
    END IF;
    PERFORM files.set_item_access(current_setting('probe.file')::uuid, NULL, NULL,
        pg_temp.grants('user=probe.grantee/editor', 'user=probe.outsider/viewer'));
    PERFORM pg_temp.act_as('probe.outsider');
    IF NOT pg_temp.can_read('probe.file') THEN RAISE EXCEPTION 'FAIL an editor''s grant did not open the file'; END IF;
    RAISE NOTICE 'PASS an editor adds a person who then opens the file';

    PERFORM pg_temp.act_as('probe.grantee');
    BEGIN
        PERFORM files.set_item_access(current_setting('probe.file')::uuid, 'public', NULL, NULL);
        RAISE EXCEPTION 'FAIL an editor changed the tier';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS an editor cannot change the tier';
    END;
    IF (files.get_item_access(current_setting('probe.file')::uuid) -> 'messageShares') <> 'null'::jsonb THEN
        RAISE EXCEPTION 'FAIL an editor was told the message shares';
    END IF;

    PERFORM files.set_item_access(current_setting('probe.file')::uuid, NULL, NULL,
        pg_temp.grants('user=probe.outsider/viewer'));
    IF pg_temp.can_read('probe.file') THEN RAISE EXCEPTION 'FAIL an editor who removed themselves still reads'; END IF;
    RAISE NOTICE 'PASS an editor who removes themselves loses access';
END $$;
-- #endregion

-- #region 4. A project grant opens the file to the project; the rules refuse bad grants
DO $$
BEGIN
    PERFORM pg_temp.act_as('probe.owner');
    PERFORM files.set_item_access(current_setting('probe.file')::uuid, NULL, NULL,
        pg_temp.grants('project=probe.project/viewer'));
    PERFORM pg_temp.act_as('probe.member');
    IF NOT pg_temp.can_read('probe.file') THEN RAISE EXCEPTION 'FAIL a project grant did not reach the project'; END IF;
    PERFORM pg_temp.act_as('probe.outsider');
    IF pg_temp.can_read('probe.file') THEN RAISE EXCEPTION 'FAIL a revoked grant still opened the file'; END IF;
    RAISE NOTICE 'PASS a project grant opens the file to the project, and the replaced grant is revoked';

    PERFORM pg_temp.act_as('probe.owner');
    BEGIN
        PERFORM files.set_item_access(current_setting('probe.file')::uuid, NULL, NULL,
            pg_temp.grants('team=probe.foreign_team/viewer'));
        RAISE EXCEPTION 'FAIL a file was granted to a team its granter is not in';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS a team the granter is not in is refused';
    END;
    BEGIN
        PERFORM files.set_item_access(current_setting('probe.file')::uuid, NULL, NULL,
            pg_temp.grants('user=probe.owner/viewer'));
        RAISE EXCEPTION 'FAIL the owner was granted their own file';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS the owner is never a grantee';
    END;
    BEGIN
        PERFORM files.set_item_access(current_setting('probe.file')::uuid, NULL, NULL,
            pg_temp.grants('user=probe.grantee/viewer', 'user=probe.grantee/editor'));
        RAISE EXCEPTION 'FAIL a grantee was listed twice';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS a grantee is listed once';
    END;
    BEGIN
        PERFORM files.set_item_access(current_setting('probe.file')::uuid, NULL, false, NULL);
        RAISE EXCEPTION 'FAIL a personal file took a member switch';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS a personal file has no member switch';
    END;
    BEGIN
        INSERT INTO files.item_grants (item_id, grantee_kind, grantee_id, role, granted_by)
        VALUES (current_setting('probe.file')::uuid, 'user', current_setting('probe.outsider')::uuid,
                'editor', current_setting('probe.owner')::uuid);
        RAISE EXCEPTION 'FAIL a client wrote a grant directly';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a grant is written only through set_item_access';
    END;
END $$;
-- #endregion

-- #region 5. A project's file stays open to the project; a grant only widens it
DO $$
BEGIN
    PERFORM pg_temp.act_as('probe.member');
    IF NOT pg_temp.can_read('probe.project_file') THEN RAISE EXCEPTION 'FAIL a project member lost a project file'; END IF;
    PERFORM pg_temp.act_as('probe.outsider');
    IF pg_temp.can_read('probe.project_file') THEN RAISE EXCEPTION 'FAIL an outsider opened a project file'; END IF;

    PERFORM pg_temp.act_as('probe.owner');
    IF (files.get_item_access(current_setting('probe.project_file')::uuid) #>> '{container,kind}') <> 'project' THEN
        RAISE EXCEPTION 'FAIL a project file did not read as the project''s';
    END IF;
    PERFORM files.set_item_access(current_setting('probe.project_file')::uuid, 'restricted', NULL,
        pg_temp.grants('user=probe.outsider/viewer'));
    PERFORM pg_temp.act_as('probe.outsider');
    IF NOT pg_temp.can_read('probe.project_file') THEN RAISE EXCEPTION 'FAIL a grant did not widen a project file'; END IF;
    RAISE NOTICE 'PASS a project file stays open to the project and a grant widens it';
END $$;
-- #endregion

-- #region 6. A team's file turned away from its members
DO $$
BEGIN
    PERFORM pg_temp.act_as('probe.teammate');
    IF NOT pg_temp.can_read('probe.team_file') THEN RAISE EXCEPTION 'FAIL a member cannot open the team''s file'; END IF;

    PERFORM pg_temp.act_as('probe.creator');
    IF (files.get_item_access(current_setting('probe.team_file')::uuid) #>> '{container,memberAccess}') <> 'true' THEN
        RAISE EXCEPTION 'FAIL the team file''s member switch did not read on';
    END IF;
    PERFORM files.set_item_access(current_setting('probe.team_file')::uuid, NULL, false, NULL);

    PERFORM pg_temp.act_as('probe.teammate');
    IF pg_temp.can_read('probe.team_file') THEN RAISE EXCEPTION 'FAIL a member opened a file turned away from them'; END IF;
    IF NOT files.fn_storage_object_withheld('workspace', current_setting('probe.team') || '/probe-access.pdf') THEN
        RAISE EXCEPTION 'FAIL the storage policy would hand a member the withheld bytes';
    END IF;
    PERFORM pg_temp.act_as('probe.admin');
    IF NOT pg_temp.can_read('probe.team_file') THEN RAISE EXCEPTION 'FAIL the team''s admin lost sight of its file'; END IF;
    IF files.fn_storage_object_withheld('workspace', current_setting('probe.team') || '/probe-access.pdf') THEN
        RAISE EXCEPTION 'FAIL the storage policy withheld the bytes from the admin';
    END IF;
    PERFORM pg_temp.act_as('probe.creator');
    IF NOT pg_temp.can_read('probe.team_file') THEN RAISE EXCEPTION 'FAIL the creator lost their own file'; END IF;
    RAISE NOTICE 'PASS members lose a file turned away from them, its bytes too; the admin and creator keep it';

    PERFORM files.set_item_access(current_setting('probe.team_file')::uuid, 'restricted', NULL,
        pg_temp.grants('user=probe.teammate/viewer'));
    PERFORM pg_temp.act_as('probe.teammate');
    IF NOT pg_temp.can_read('probe.team_file') THEN RAISE EXCEPTION 'FAIL a grant did not reach a member'; END IF;
    PERFORM pg_temp.act_as('probe.outsider');
    IF pg_temp.can_read('probe.team_file') THEN RAISE EXCEPTION 'FAIL an outsider opened the team''s file'; END IF;
    RAISE NOTICE 'PASS a grant opens a turned-away team file to one member and nobody else';

    PERFORM pg_temp.act_as('probe.teammate');
    BEGIN
        PERFORM files.set_item_access(current_setting('probe.team_file')::uuid, NULL, true, NULL);
        RAISE EXCEPTION 'FAIL a viewer switched the members back on';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS only the owner changes the member switch';
    END;
END $$;
-- #endregion

-- #region 7. The picker lists the caller's own teams and projects
DO $$
DECLARE v_targets jsonb;
BEGIN
    PERFORM pg_temp.act_as('probe.creator');
    v_targets := files.list_access_targets(NULL, 30);
    IF NOT v_targets @> jsonb_build_array(jsonb_build_object('kind', 'team', 'id', current_setting('probe.team'))) THEN
        RAISE EXCEPTION 'FAIL the picker left out the caller''s team';
    END IF;
    IF jsonb_array_length(files.list_access_targets('zz-no-such-name-zz', 30)) <> 0 THEN
        RAISE EXCEPTION 'FAIL the picker ignored the query';
    END IF;
    PERFORM pg_temp.act_as('probe.owner');
    IF NOT files.list_access_targets(NULL, 50) @> jsonb_build_array(jsonb_build_object('kind', 'project', 'id', current_setting('probe.project'))) THEN
        RAISE EXCEPTION 'FAIL the picker left out the caller''s project';
    END IF;
    RAISE NOTICE 'PASS the picker lists the caller''s teams and projects and honours the query';
END $$;
-- #endregion

-- #region 8. Revoking leaves the audit
RESET ROLE;
DO $$
BEGIN
    IF (SELECT count(*) FROM files.item_grants g
        WHERE g.item_id = current_setting('probe.file')::uuid AND g.revoked_at IS NOT NULL) < 2 THEN
        RAISE EXCEPTION 'FAIL a revoked grant was deleted instead of stamped';
    END IF;
    IF (SELECT count(*) FROM files.item_grants g
        WHERE g.item_id = current_setting('probe.file')::uuid AND g.revoked_at IS NULL) <> 1 THEN
        RAISE EXCEPTION 'FAIL more than the saved list is live';
    END IF;
    RAISE NOTICE 'PASS revoked grants stay as audit rows and only the saved list is live';
END $$;
-- #endregion

ROLLBACK;
