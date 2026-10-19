-- =============================================================================================
-- Probe: the Roles screen's archive refusal, said before the press (Teams C3 review) —
-- org.get_workspace_detail answers each role's `pending_invites` to every `manage_roles` holder,
-- counted exactly as org.archive_workspace_role's "a pending invitation offers this role" refusal
-- counts them, even for a role manager who does not hold `invite_members` (and so reads no
-- outgoing `invites`); anybody without `manage_roles` reads NULL — neither the count nor the queue.
--
-- Rollback-safe: one transaction, ends in ROLLBACK. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/workspace_role_pending_invites.sql
--
-- Fixture (seeded, then extended inside the transaction): the team `northloop` — owner O and a plain
-- member M — given a custom role R that nobody holds and one pending invitation offering it. Every
-- case runs and reports; a clean run prints only PASS notices, and any FAIL aborts the run at the end.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE(p_ok, false) THEN
        RAISE NOTICE 'PASS %', p_label;
    ELSE
        INSERT INTO probe_fails VALUES (p_label);
        RAISE NOTICE 'FAIL % — %', p_label, p_why;
    END IF;
END $$;

-- The detail as p_user sees it.
CREATE FUNCTION pg_temp.detail(p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_user);
    RETURN org.get_workspace_detail('team', 'northloop');
END $$;

-- One role's projection on that detail.
CREATE FUNCTION pg_temp.role_of(p_detail jsonb, p_role uuid) RETURNS jsonb LANGUAGE sql AS $$
    SELECT r FROM jsonb_array_elements(p_detail -> 'roles') r WHERE (r ->> 'id')::uuid = p_role;
$$;

-- The archive door's answer for p_role, as p_user: 'archived' or the refusal's message.
CREATE FUNCTION pg_temp.try_archive(p_user uuid, p_role uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_user);
    PERFORM org.archive_workspace_role('team', pg_temp.id('team'), p_role);
    RETURN 'archived';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_owner uuid;
    v_member uuid;
    v_role uuid;
BEGIN
    SELECT t.id, t.owner_user_id INTO v_team, v_owner FROM org.teams t WHERE t.slug = 'northloop';
    SELECT m.user_id INTO v_member FROM org.team_members m
     WHERE m.team_id = v_team AND m.status = 'active' AND m.role = 'member'
       AND NOT ('manage_roles' = ANY (org.fn_member_capabilities('team', v_team, m.user_id)))
     ORDER BY m.user_id LIMIT 1;
    IF v_team IS NULL OR v_member IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, member %) — deno task db:reset', v_team, v_member;
    END IF;
    INSERT INTO org.team_roles (team_id, name, summary, base_preset, capabilities)
    VALUES (v_team, 'Probe scout', 'Probe-only role.', 'member', '{}')
    RETURNING id INTO v_role;
    INSERT INTO org.org_invitations (inviter_user_id, target_email, team_id, team_role_id, token, status)
    VALUES (v_owner, 'probe-scout@example.test', v_team, v_role, 'probe-' || gen_random_uuid(), 'pending');
    INSERT INTO probe_ids VALUES ('team', v_team), ('owner', v_owner), ('member', v_member), ('role', v_role);
END $$;
-- #endregion

-- #region Cases
DO $$
DECLARE
    v_owner_view jsonb := pg_temp.detail(pg_temp.id('owner'));
    v_member_view jsonb := pg_temp.detail(pg_temp.id('member'));
    v_role jsonb;
BEGIN
    -- The owner (manage_roles) reads the count on every role, and 1 on the probe role.
    v_role := pg_temp.role_of(v_owner_view, pg_temp.id('role'));
    PERFORM pg_temp.check('owner reads the probe role''s pending invitation',
        (v_role ->> 'pending_invites')::int = 1, coalesce(v_role::text, 'role missing'));
    PERFORM pg_temp.check('owner reads a count on every role',
        NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_owner_view -> 'roles') r
                     WHERE jsonb_typeof(r -> 'pending_invites') IS DISTINCT FROM 'number'),
        (v_owner_view -> 'roles')::text);

    -- A plain member (no manage_roles) reads neither the count nor the queue.
    v_role := pg_temp.role_of(v_member_view, pg_temp.id('role'));
    PERFORM pg_temp.check('a member without manage_roles reads no count',
        jsonb_typeof(v_role -> 'pending_invites') = 'null', coalesce(v_role::text, 'role missing'));
    PERFORM pg_temp.check('a member without invite_members reads no queue',
        v_member_view -> 'invites' = '[]'::jsonb, (v_member_view -> 'invites')::text);
END $$;

-- The same member granted manage_roles alone: a role manager who still cannot read the queue.
UPDATE org.team_members SET granted_capabilities = array_append(granted_capabilities, 'manage_roles')
 WHERE team_id = pg_temp.id('team') AND user_id = pg_temp.id('member');

DO $$
DECLARE
    v_view jsonb := pg_temp.detail(pg_temp.id('member'));
    v_role jsonb := pg_temp.role_of(v_view, pg_temp.id('role'));
BEGIN
    PERFORM pg_temp.check('the fixture: manage_roles without invite_members',
        v_view -> 'viewer' -> 'capabilities' ? 'manage_roles'
            AND NOT (v_view -> 'viewer' -> 'capabilities' ? 'invite_members'),
        (v_view -> 'viewer')::text);
    PERFORM pg_temp.check('a role manager without invite_members still reads no queue',
        v_view -> 'invites' = '[]'::jsonb, (v_view -> 'invites')::text);
    PERFORM pg_temp.check('… but reads the count the archive door refuses on',
        (v_role ->> 'pending_invites')::int = 1, coalesce(v_role::text, 'role missing'));
    PERFORM pg_temp.check('… and the door refuses it, as the count said',
        pg_temp.try_archive(pg_temp.id('member'), pg_temp.id('role')) LIKE 'role: a pending invitation offers this role%',
        pg_temp.try_archive(pg_temp.id('member'), pg_temp.id('role')));
END $$;

-- The invitation is revoked: the count drops to 0 and the door lets the archive through.
UPDATE org.org_invitations SET status = 'revoked', revoked_at = now()
 WHERE team_role_id = pg_temp.id('role') AND status = 'pending';

DO $$
DECLARE
    v_role jsonb := pg_temp.role_of(pg_temp.detail(pg_temp.id('member')), pg_temp.id('role'));
BEGIN
    PERFORM pg_temp.check('a revoked invitation no longer counts',
        (v_role ->> 'pending_invites')::int = 0, coalesce(v_role::text, 'role missing'));
    PERFORM pg_temp.check('… and the archive goes through',
        pg_temp.try_archive(pg_temp.id('member'), pg_temp.id('role')) = 'archived',
        'the door still refused');
END $$;
-- #endregion

-- #region Verdict
DO $$
DECLARE
    v_fails text;
BEGIN
    SELECT string_agg(label, '; ') INTO v_fails FROM probe_fails;
    IF v_fails IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL %', v_fails;
    END IF;
    RAISE NOTICE 'workspace_role_pending_invites: all cases pass';
END $$;
-- #endregion

ROLLBACK;
