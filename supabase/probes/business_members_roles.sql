-- =============================================================================================
-- Probe: a business's Members and Roles (work order BU7, Decision #249) — the manager headroom and
-- the envelope-visibility flag the console read answers, and the Project Manager / Observer role
-- TEMPLATES (Decision #230 (b)) written through the real role door.
--
--   * `org.get_workspace_detail` answers a business's `managers {used, limit}` to every member:
--     `used` is finance.fn_footprint_usage('business_managers') — admins and members whose role or
--     grants manage projects, plus the pending, unexpired invitations that offer such a seat — and
--     `limit` the ceiling finance.fn_assert_business_entitlement refuses past (NULL while the gates
--     are off or the plan is unlimited; the development `free` header makes it Business Free's). A
--     team answers none.
--   * its spend block answers `reads_all_envelopes` — exactly finance.fn_business_envelopes' own
--     v_reads_all — so the Members table's Spending column shows only to a viewer whose `limits` hold
--     everyone's envelope.
--   * the templates' capability lists (apps/web/features/workspaces/core/role-templates.ts — keep the
--     two ARRAYs marked `template:` below in step with it) pass org.upsert_workspace_role's
--     grant-what-you-hold and rank rules for the owner and an admin; an author who holds less is
--     refused the full list (and any rank above theirs), and the editor's filtered seed (`seedFrom`)
--     passes. The Project Manager ranks as a member (#249 (a)), so an admin governs its holders:
--     they sit in the admin's `editable_member_ids` and still take a manager seat.
--   * a role EDIT that makes its holders managers past the ceiling is refused, and one on a role
--     nobody holds or is offered is not — the rule the Roles matrix locks a cell by.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_members_roles.sql
--
-- Fixture (seeded data, Seed.md): Helia Finance (`heliafinance`, Business Free, KYB verified — owner
-- priyaraman, admin hannahcole, one manager) and Atlas Labs (`atlaslabs`, Business Free — owner
-- danielokafor, member miguelsantos holding `hire` + `manage_projects`, one manager); any team with
-- an active owner; four adult users who belong to Helia in no way (two become plain members M1, M2).
-- A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- The development simulation header, or none.
CREATE FUNCTION pg_temp.dev(p_value text) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.headers',
        CASE WHEN p_value IS NULL THEN '{}' ELSE json_build_object('x-pj-dev-plan-gates', p_value)::text END, true);
$$;

CREATE FUNCTION pg_temp.gates(p_on boolean) RETURNS void LANGUAGE sql AS $$
    UPDATE security.platform_params SET value = to_jsonb(p_on) WHERE key = 'business_plan_gates_enforced';
$$;

-- Put Helia on Business Pro (true) or back on its default Business Free (false).
CREATE FUNCTION pg_temp.pro(p_on boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM finance.subscriptions WHERE subject_type = 'business' AND subject_id = pg_temp.id('H');
    IF p_on THEN
        INSERT INTO finance.subscriptions (profile_id, subject_type, subject_id, plan_id, state)
        SELECT pg_temp.id('PRIYA'), 'business', pg_temp.id('H'), p.id, 'active'
          FROM finance.plans p WHERE p.code = 'business_pro';
    END IF;
END $$;

-- The console read as p_actor sees it.
CREATE FUNCTION pg_temp.detail(p_kind text, p_handle text, p_actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_actor);
    RETURN org.get_workspace_detail(p_kind, p_handle);
END $$;

-- A detail's `managers` block as "used/limit" ("1/2", "2/null"), or 'absent' / 'null'.
CREATE FUNCTION pg_temp.managers_of(p_detail jsonb) RETURNS text LANGUAGE sql AS $$
    SELECT CASE
        WHEN NOT (p_detail ? 'managers') THEN 'absent'
        WHEN jsonb_typeof(p_detail->'managers') = 'null' THEN 'null'
        ELSE COALESCE(p_detail->'managers'->>'used', '?') || '/' || COALESCE(p_detail->'managers'->>'limit', 'null')
    END;
$$;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_got text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FAIL % — got %', p_label, p_got;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- Run p_sql as p_actor inside a savepoint. p_state NULL: it must succeed. Otherwise it must be refused
-- with that SQLSTATE and a MESSAGE starting p_prefix. Nothing it did survives a refusal.
CREATE FUNCTION pg_temp.expect(p_label text, p_actor uuid, p_sql text, p_state text, p_prefix text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF p_state IS NULL THEN
        IF v_state IS NOT NULL THEN
            RAISE EXCEPTION 'FAIL % — refused % "%" (expected it to go through)', p_label, v_state, v_msg;
        END IF;
        RAISE NOTICE 'PASS % (allowed)', p_label;
        RETURN;
    END IF;
    IF v_state IS NULL THEN
        RAISE EXCEPTION 'FAIL % — went through (expected % %)', p_label, p_state, p_prefix;
    END IF;
    IF v_state <> p_state OR v_msg NOT LIKE p_prefix || '%' THEN
        RAISE EXCEPTION 'FAIL % — refused % "%" (expected % %)', p_label, v_state, v_msg, p_state, p_prefix;
    END IF;
    RAISE NOTICE 'PASS % (% %)', p_label, v_state, p_prefix;
END $$;

-- A capability list in enum order, so two lists compare as sets.
CREATE FUNCTION pg_temp.caps(p_caps org.workspace_capability[]) RETURNS org.workspace_capability[] LANGUAGE sql AS $$
    SELECT COALESCE(array_agg(DISTINCT c ORDER BY c), '{}') FROM unnest(p_caps) c;
$$;

-- Create a custom role as p_actor and remember its id under p_key.
CREATE FUNCTION pg_temp.role(p_key text, p_actor uuid, p_business uuid, p_name text,
                             p_caps org.workspace_capability[], p_base text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_actor);
    INSERT INTO probe_ids (k, id)
    SELECT p_key, (org.upsert_workspace_role('business', p_business, NULL, p_name, '', p_caps, p_base)->>'id')::uuid;
END $$;

-- The resolved capabilities of a role, as the console read lists them.
CREATE FUNCTION pg_temp.role_caps(p_role uuid) RETURNS org.workspace_capability[] LANGUAGE sql AS $$
    SELECT pg_temp.caps(org.fn_role_capabilities('business', r.preset, r.capabilities))
      FROM org.business_roles r WHERE r.id = p_role;
$$;

CREATE FUNCTION pg_temp.handle(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT u.username FROM org.users_public u WHERE u.user_id = pg_temp.id(p_key);
$$;

CREATE FUNCTION pg_temp.invite_sql(p_key text, p_role text) RETURNS text LANGUAGE sql AS $$
    SELECT format($q$SELECT org.invite_workspace_member('business', %L, %L, NULL, %L)$q$,
                  pg_temp.id('H'), pg_temp.handle(p_key), pg_temp.id(p_role));
$$;

-- template:project_manager — role-templates.ts `project_manager` (base member).
CREATE FUNCTION pg_temp.pm_caps() RETURNS org.workspace_capability[] LANGUAGE sql AS $$
    SELECT ARRAY['manage_projects', 'purchase', 'hire', 'contribute_funds', 'spend_funds', 'view_analytics']::org.workspace_capability[];
$$;

-- template:observer — role-templates.ts `observer` (base member).
CREATE FUNCTION pg_temp.observer_caps() RETURNS org.workspace_capability[] LANGUAGE sql AS $$
    SELECT ARRAY['view_analytics']::org.workspace_capability[];
$$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_helia uuid;
    v_atlas uuid;
    v_priya uuid;
    v_hannah uuid;
    v_daniel uuid;
    v_miguel uuid;
    v_member_role uuid;
    v_team text;
    v_team_owner uuid;
    v_x uuid[];
BEGIN
    SELECT b.id, b.owner_user_id INTO v_helia, v_priya FROM org.business_profiles b WHERE b.slug = 'heliafinance';
    SELECT b.id, b.owner_user_id INTO v_atlas, v_daniel FROM org.business_profiles b WHERE b.slug = 'atlaslabs';
    SELECT m.user_id INTO v_hannah FROM org.business_members m JOIN org.users_public u ON u.user_id = m.user_id
     WHERE m.business_id = v_helia AND m.status = 'active' AND u.username = 'hannahcole';
    SELECT m.user_id INTO v_miguel FROM org.business_members m JOIN org.users_public u ON u.user_id = m.user_id
     WHERE m.business_id = v_atlas AND m.status = 'active' AND u.username = 'miguelsantos';
    SELECT r.id INTO v_member_role FROM org.business_roles r WHERE r.business_id = v_helia AND r.preset = 'member';
    SELECT t.slug, t.owner_user_id INTO v_team, v_team_owner FROM org.teams t
     WHERE t.status <> 'archived'
       AND EXISTS (SELECT 1 FROM org.team_members m WHERE m.team_id = t.id AND m.user_id = t.owner_user_id AND m.status = 'active')
     ORDER BY t.slug LIMIT 1;
    SELECT array_agg(u.user_id ORDER BY u.user_id) INTO v_x FROM (
        SELECT u.user_id FROM org.users_public u
         WHERE u.username IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM org.business_members m WHERE m.business_id = v_helia AND m.user_id = u.user_id)
           AND NOT EXISTS (SELECT 1 FROM org.org_invitations i WHERE i.business_id = v_helia AND i.target_user_id = u.user_id)
           AND NOT EXISTS (SELECT 1 FROM org.deletion_requests d WHERE d.user_id = u.user_id)
           AND NOT org.fn_is_minor(u.user_id)
         ORDER BY u.user_id
         LIMIT 4
    ) u;

    IF v_helia IS NULL OR v_atlas IS NULL OR v_hannah IS NULL OR v_miguel IS NULL OR v_member_role IS NULL
       OR v_team IS NULL OR COALESCE(array_length(v_x, 1), 0) < 4 THEN
        RAISE EXCEPTION 'FAIL no fixture (helia %, atlas %, hannah %, miguel %, team %, outsiders %) — deno task db:reset',
            v_helia, v_atlas, v_hannah, v_miguel, v_team, COALESCE(array_length(v_x, 1), 0);
    END IF;

    INSERT INTO probe_ids (k, id) VALUES
        ('H', v_helia), ('A', v_atlas), ('PRIYA', v_priya), ('HANNAH', v_hannah), ('DANIEL', v_daniel),
        ('MIGUEL', v_miguel), ('RM', v_member_role), ('TEAM_OWNER', v_team_owner),
        ('X1', v_x[1]), ('X2', v_x[2]), ('M1', v_x[3]), ('M2', v_x[4]);
    CREATE TEMP TABLE probe_team (slug text);
    INSERT INTO probe_team VALUES (v_team);

    -- Two plain members to change: written as the seed writes members, then given their vault rows.
    INSERT INTO org.business_members (business_id, user_id, role_id, status, joined_at)
    VALUES (v_helia, v_x[3], v_member_role, 'active', now()), (v_helia, v_x[4], v_member_role, 'active', now());
    PERFORM org.fn_sync_vault_permissions('business', v_helia, NULL);
    INSERT INTO probe_ids (k, id)
    SELECT 'MM' || right(p.k, 1), m.id
      FROM probe_ids p JOIN org.business_members m ON m.user_id = p.id AND m.business_id = v_helia
     WHERE p.k IN ('M1', 'M2');

    RAISE NOTICE 'fixture: helia % (priya %, hannah %), atlas % (daniel %, miguel %), team %',
        v_helia, v_priya, v_hannah, v_atlas, v_daniel, v_miguel, v_team;
END $$;
-- #endregion

-- #region 0. Seeded headroom — every member reads it; a team reads none
DO $$
DECLARE
    v_got text;
BEGIN
    -- The two plain members the fixture added are not managers, so the seed's one manager stands.
    v_got := pg_temp.managers_of(pg_temp.detail('business', 'heliafinance', pg_temp.id('PRIYA')));
    PERFORM pg_temp.check('0a Helia''s owner reads managers 1 of 2 (Hannah, an admin)', v_got = '1/2', v_got);
    v_got := pg_temp.managers_of(pg_temp.detail('business', 'heliafinance', pg_temp.id('M2')));
    PERFORM pg_temp.check('0b a plain Helia member reads the same headroom', v_got = '1/2', v_got);
    v_got := pg_temp.managers_of(pg_temp.detail('business', 'atlaslabs', pg_temp.id('DANIEL')));
    PERFORM pg_temp.check('0c Atlas'' owner reads managers 1 of 2 (Miguel manages projects)', v_got = '1/2', v_got);
    v_got := pg_temp.managers_of(pg_temp.detail('business', 'atlaslabs', pg_temp.id('MIGUEL')));
    PERFORM pg_temp.check('0d Atlas'' member reads the same headroom', v_got = '1/2', v_got);
    v_got := pg_temp.managers_of(pg_temp.detail('team', (SELECT slug FROM probe_team), pg_temp.id('TEAM_OWNER')));
    PERFORM pg_temp.check('0e a team answers no managers block', v_got = 'null', v_got);
    v_got := (pg_temp.detail('business', 'heliafinance', pg_temp.id('PRIYA'))->'managers'->>'used');
    PERFORM pg_temp.check('0f used is finance.fn_footprint_usage''s own count',
        v_got::integer = finance.fn_footprint_usage('business', pg_temp.id('H'), 'business_managers'), v_got);
END $$;
-- #endregion

-- #region 1. The templates through the real door (grant-what-you-hold, rank)
DO $$
BEGIN
    PERFORM pg_temp.role('PM', pg_temp.id('PRIYA'), pg_temp.id('H'), 'Project Manager', pg_temp.pm_caps(), 'member');
    PERFORM pg_temp.role('OB', pg_temp.id('PRIYA'), pg_temp.id('H'), 'Observer', pg_temp.observer_caps(), 'member');
    PERFORM pg_temp.check('1a the owner writes the Project Manager template as a member-ranked custom role',
        pg_temp.role_caps(pg_temp.id('PM')) = pg_temp.caps(pg_temp.pm_caps())
            AND (SELECT r.base_preset FROM org.business_roles r WHERE r.id = pg_temp.id('PM')) = 'member'
            AND (SELECT r.preset FROM org.business_roles r WHERE r.id = pg_temp.id('PM')) IS NULL,
        pg_temp.role_caps(pg_temp.id('PM'))::text);
    PERFORM pg_temp.check('1b the owner writes the Observer template as a member-ranked custom role',
        pg_temp.role_caps(pg_temp.id('OB')) = pg_temp.caps(pg_temp.observer_caps())
            AND (SELECT r.base_preset FROM org.business_roles r WHERE r.id = pg_temp.id('OB')) = 'member',
        pg_temp.role_caps(pg_temp.id('OB'))::text);

    PERFORM pg_temp.role('PM_A', pg_temp.id('HANNAH'), pg_temp.id('H'), 'Project Manager (admin)', pg_temp.pm_caps(), 'member');
    PERFORM pg_temp.role('OB_A', pg_temp.id('HANNAH'), pg_temp.id('H'), 'Observer (admin)', pg_temp.observer_caps(), 'member');
    PERFORM pg_temp.check('1c an admin writes both templates (each capability is one they hold; member is below their rank)',
        pg_temp.role_caps(pg_temp.id('PM_A')) = pg_temp.caps(pg_temp.pm_caps())
            AND pg_temp.role_caps(pg_temp.id('OB_A')) = pg_temp.caps(pg_temp.observer_caps()),
        pg_temp.role_caps(pg_temp.id('PM_A'))::text);

    PERFORM pg_temp.check('1d the Project Manager role is a manager''s seat (it manages projects); the Observer is not',
        org.fn_business_role_is_manager(pg_temp.id('H'), pg_temp.id('PM'))
            AND NOT org.fn_business_role_is_manager(pg_temp.id('H'), pg_temp.id('OB')), 'predicate');
    PERFORM pg_temp.check('1e the template carries no owner-reserved right and nothing outside a business''s list',
        NOT (pg_temp.pm_caps() && org.fn_reserved_capabilities('business'))
            AND pg_temp.caps(pg_temp.pm_caps()) = pg_temp.caps(org.fn_role_capabilities('business', NULL, pg_temp.pm_caps())),
        'reserved');
    PERFORM pg_temp.check('1f creating a manager role with no holders takes no manager seat',
        finance.fn_footprint_usage('business', pg_temp.id('H'), 'business_managers') = 1, 'usage');
END $$;

-- An author holding less: M1 is a plain member whom the owner grants `manage_roles` alone.
SELECT pg_temp.expect('1g the owner grants M1 Change roles', pg_temp.id('PRIYA'),
    format($q$SELECT org.update_workspace_member('business', %L, '{"granted": ["manage_roles"]}'::jsonb)$q$,
           pg_temp.id('MM1')), NULL, NULL);
SELECT pg_temp.expect('1h M1 is refused the full Project Manager list (grant-what-you-hold)', pg_temp.id('M1'),
    format($q$SELECT org.upsert_workspace_role('business', %L, NULL, 'PM by M1', '', %L::org.workspace_capability[], 'member')$q$,
           pg_temp.id('H'), pg_temp.pm_caps()), '42501', 'capabilities:');
SELECT pg_temp.expect('1i M1 is refused an admin rank — a role never ranks above its author', pg_temp.id('M1'),
    format($q$SELECT org.upsert_workspace_role('business', %L, NULL, 'PM by M1', '', %L::org.workspace_capability[], 'admin')$q$,
           pg_temp.id('H'), pg_temp.observer_caps()), '42501', 'basePreset:');
-- The editor's seed for M1 (`seedFrom`): the template filtered to what M1 holds, its rank clamped to M1's.
SELECT pg_temp.expect('1j M1''s filtered Project Manager seed (Add funds, View analytics; base member) passes', pg_temp.id('M1'),
    format($q$SELECT org.upsert_workspace_role('business', %L, NULL, 'PM by M1', '', %L::org.workspace_capability[], 'member')$q$,
           pg_temp.id('H'), ARRAY['contribute_funds', 'view_analytics']::org.workspace_capability[]), NULL, NULL);
SELECT pg_temp.expect('1k M1''s Observer seed passes unchanged', pg_temp.id('M1'),
    format($q$SELECT org.upsert_workspace_role('business', %L, NULL, 'Observer by M1', '', %L::org.workspace_capability[], 'member')$q$,
           pg_temp.id('H'), pg_temp.observer_caps()), NULL, NULL);
-- #endregion

-- #region 2. Headroom moves with what the cap counts
SELECT pg_temp.expect('2a inviting X1 to the Project Manager role takes the second manager seat', pg_temp.id('PRIYA'),
    pg_temp.invite_sql('X1', 'PM'), NULL, NULL);
DO $$
DECLARE
    v_got text := pg_temp.managers_of(pg_temp.detail('business', 'heliafinance', pg_temp.id('HANNAH')));
BEGIN
    PERFORM pg_temp.check('2b the read counts the open invitation: 2 of 2', v_got = '2/2', v_got);
END $$;
SELECT pg_temp.expect('2c a second Project Manager invitation is refused at the ceiling', pg_temp.id('PRIYA'),
    pg_temp.invite_sql('X2', 'PM'), 'PK402', 'entitlement: business_managers:');
SELECT pg_temp.expect('2d an Observer invitation is no manager''s seat', pg_temp.id('PRIYA'),
    pg_temp.invite_sql('X2', 'OB'), NULL, NULL);
SELECT pg_temp.expect('2e moving M2 onto the Project Manager role is refused at the ceiling', pg_temp.id('PRIYA'),
    format($q$SELECT org.update_workspace_member('business', %L, jsonb_build_object('role_id', %L))$q$,
           pg_temp.id('MM2'), pg_temp.id('PM')), 'PK402', 'entitlement: business_managers:');
SELECT pg_temp.expect('2f granting M2 Manage projects is refused at the ceiling', pg_temp.id('PRIYA'),
    format($q$SELECT org.update_workspace_member('business', %L, '{"granted": ["manage_projects"]}'::jsonb)$q$,
           pg_temp.id('MM2')), 'PK402', 'entitlement: business_managers:');
DO $$
DECLARE
    v_got text;
BEGIN
    v_got := pg_temp.managers_of(pg_temp.detail('business', 'heliafinance', pg_temp.id('PRIYA')));
    PERFORM pg_temp.check('2g the Observer invitation and the refusals leave 2 of 2', v_got = '2/2', v_got);
    PERFORM pg_temp.act(pg_temp.id('PRIYA'));
    PERFORM org.revoke_workspace_invitation(
        (SELECT i.id FROM org.org_invitations i WHERE i.business_id = pg_temp.id('H')
            AND i.target_user_id = pg_temp.id('X1') AND i.status = 'pending'));
    v_got := pg_temp.managers_of(pg_temp.detail('business', 'heliafinance', pg_temp.id('PRIYA')));
    PERFORM pg_temp.check('2h withdrawing the Project Manager invitation frees the seat: 1 of 2', v_got = '1/2', v_got);
END $$;
-- A Project Manager ranks as a member, so an admin governs the seat (#249 (a)): their spend editor
-- lists the holder, and the holder still counts against the manager cap.
SELECT pg_temp.expect('2i at 1 of 2, M2 moves onto the Project Manager role', pg_temp.id('PRIYA'),
    format($q$SELECT org.update_workspace_member('business', %L, jsonb_build_object('role_id', %L))$q$,
           pg_temp.id('MM2'), pg_temp.id('PM')), NULL, NULL);
DO $$
DECLARE
    v_d jsonb := pg_temp.detail('business', 'heliafinance', pg_temp.id('HANNAH'));
BEGIN
    PERFORM pg_temp.check('2j the holder takes the second manager seat: 2 of 2', pg_temp.managers_of(v_d) = '2/2',
        pg_temp.managers_of(v_d));
    PERFORM pg_temp.check('2k the admin may set the Project Manager''s limit (editable_member_ids)',
        (v_d->'spend'->'editable_member_ids') @> to_jsonb(ARRAY[pg_temp.id('MM2')]),
        COALESCE(v_d->'spend'->>'editable_member_ids', 'no spend block'));
END $$;
SELECT pg_temp.expect('2l M2 moves back onto the Member role', pg_temp.id('PRIYA'),
    format($q$SELECT org.update_workspace_member('business', %L, jsonb_build_object('role_id', %L))$q$,
           pg_temp.id('MM2'), pg_temp.id('RM')), NULL, NULL);
DO $$
DECLARE
    v_got text := pg_temp.managers_of(pg_temp.detail('business', 'heliafinance', pg_temp.id('PRIYA')));
BEGIN
    PERFORM pg_temp.check('2m and the seat is free again: 1 of 2', v_got = '1/2', v_got);
END $$;

-- A role EDIT that makes its holders managers is judged the same way (the Roles matrix's cell lock,
-- roles-model.ts managerCapLock / managerDelta): refused only when it adds managers past the ceiling.
DO $$
BEGIN
    PERFORM pg_temp.role('BUY', pg_temp.id('PRIYA'), pg_temp.id('H'), 'Probe buyers',
        ARRAY['purchase']::org.workspace_capability[], 'member');
END $$;
SELECT pg_temp.expect('2n M2 moves onto a member-ranked buyers role (no manager)', pg_temp.id('PRIYA'),
    format($q$SELECT org.update_workspace_member('business', %L, jsonb_build_object('role_id', %L))$q$,
           pg_temp.id('MM2'), pg_temp.id('BUY')), NULL, NULL);
SELECT pg_temp.expect('2o X1 is invited to the Project Manager role again: 2 of 2', pg_temp.id('PRIYA'),
    pg_temp.invite_sql('X1', 'PM'), NULL, NULL);
SELECT pg_temp.expect('2p ticking Manage projects on the held buyers role is refused at the ceiling', pg_temp.id('PRIYA'),
    format($q$SELECT org.upsert_workspace_role('business', %L, %L, 'Probe buyers', '', %L::org.workspace_capability[], 'member')$q$,
           pg_temp.id('H'), pg_temp.id('BUY'), ARRAY['manage_projects', 'purchase']::org.workspace_capability[]),
    'PK402', 'entitlement: business_managers:');
SELECT pg_temp.expect('2q the same tick on a role nobody holds or is offered takes no seat', pg_temp.id('PRIYA'),
    format($q$SELECT org.upsert_workspace_role('business', %L, %L, 'Observer (admin)', '', %L::org.workspace_capability[], 'member')$q$,
           pg_temp.id('H'), pg_temp.id('OB_A'), ARRAY['manage_projects', 'view_analytics']::org.workspace_capability[]),
    NULL, NULL);
DO $$
DECLARE
    v_got text;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('PRIYA'));
    PERFORM org.revoke_workspace_invitation(
        (SELECT i.id FROM org.org_invitations i WHERE i.business_id = pg_temp.id('H')
            AND i.target_user_id = pg_temp.id('X1') AND i.status = 'pending'));
    PERFORM org.update_workspace_member('business', pg_temp.id('MM2'), jsonb_build_object('role_id', pg_temp.id('RM')));
    v_got := pg_temp.managers_of(pg_temp.detail('business', 'heliafinance', pg_temp.id('PRIYA')));
    PERFORM pg_temp.check('2r the refused edit changed nothing; withdrawn and moved back: 1 of 2',
        v_got = '1/2' AND NOT ('manage_projects' = ANY (pg_temp.role_caps(pg_temp.id('BUY')))), v_got);
END $$;
-- #endregion

-- #region 3. The limit is the gate's: Business Pro, the switch, the development header
DO $$
DECLARE
    v_got text;
BEGIN
    PERFORM pg_temp.pro(true);
    v_got := pg_temp.managers_of(pg_temp.detail('business', 'heliafinance', pg_temp.id('PRIYA')));
    PERFORM pg_temp.check('3a on Business Pro the ceiling is 15', v_got = '1/15', v_got);
    PERFORM pg_temp.dev('free');
    v_got := pg_temp.managers_of(pg_temp.detail('business', 'heliafinance', pg_temp.id('PRIYA')));
    PERFORM pg_temp.check('3b Business Pro under the `free` header reads Business Free''s 2', v_got = '1/2', v_got);
    PERFORM pg_temp.dev(NULL);
    PERFORM pg_temp.pro(false);
    PERFORM pg_temp.gates(false);
    v_got := pg_temp.managers_of(pg_temp.detail('business', 'heliafinance', pg_temp.id('PRIYA')));
    PERFORM pg_temp.check('3c with the switch off nothing refuses: no ceiling, the count still answered', v_got = '1/null', v_got);
    PERFORM pg_temp.dev('enforced');
    v_got := pg_temp.managers_of(pg_temp.detail('business', 'heliafinance', pg_temp.id('PRIYA')));
    PERFORM pg_temp.check('3d switch off under `enforced`: the ceiling is back', v_got = '1/2', v_got);
    PERFORM pg_temp.dev(NULL);
    PERFORM pg_temp.gates(true);
END $$;
-- #endregion

-- #region 4. reads_all_envelopes is fn_business_envelopes' own rule
-- An approve-only custom role for M1 (M1's Change roles grant stays; only the role changes).
DO $$
BEGIN
    PERFORM pg_temp.role('AP', pg_temp.id('PRIYA'), pg_temp.id('H'), 'Probe approver',
        ARRAY['approve_spend']::org.workspace_capability[], 'member');
END $$;
SELECT pg_temp.expect('4a M1 moves onto the approve-only role', pg_temp.id('PRIYA'),
    format($q$SELECT org.update_workspace_member('business', %L, jsonb_build_object('role_id', %L))$q$,
           pg_temp.id('MM1'), pg_temp.id('AP')), NULL, NULL);
SELECT pg_temp.expect('4b M2 is granted Spend funds alone', pg_temp.id('PRIYA'),
    format($q$SELECT org.update_workspace_member('business', %L, '{"granted": ["spend_funds"]}'::jsonb)$q$,
           pg_temp.id('MM2')), NULL, NULL);
DO $$
DECLARE
    v_members integer := (SELECT count(*) FROM org.business_members m WHERE m.business_id = pg_temp.id('H') AND m.status = 'active');
    v_d jsonb;
BEGIN
    v_d := pg_temp.detail('business', 'heliafinance', pg_temp.id('PRIYA'));
    PERFORM pg_temp.check('4c the owner reads every envelope', (v_d->'spend'->>'reads_all_envelopes')::boolean
        AND jsonb_array_length(v_d->'spend'->'limits') = v_members, v_d->'spend'->>'reads_all_envelopes');
    v_d := pg_temp.detail('business', 'heliafinance', pg_temp.id('HANNAH'));
    PERFORM pg_temp.check('4d the admin reads every envelope', (v_d->'spend'->>'reads_all_envelopes')::boolean
        AND jsonb_array_length(v_d->'spend'->'limits') = v_members, v_d->'spend'->>'reads_all_envelopes');
    v_d := pg_temp.detail('business', 'heliafinance', pg_temp.id('M1'));
    PERFORM pg_temp.check('4e an approve-only custom role reads every envelope', (v_d->'spend'->>'reads_all_envelopes')::boolean
        AND jsonb_array_length(v_d->'spend'->'limits') = v_members, COALESCE(v_d->'spend'->>'reads_all_envelopes', 'no spend block'));
    v_d := pg_temp.detail('business', 'heliafinance', pg_temp.id('M2'));
    PERFORM pg_temp.check('4f a spend-only member reads only their own envelope, and is told so',
        NOT (v_d->'spend'->>'reads_all_envelopes')::boolean
            AND jsonb_array_length(v_d->'spend'->'limits') = 1
            AND (v_d->'spend'->'limits'->0->>'member_id')::uuid = pg_temp.id('MM2'),
        COALESCE(v_d->'spend'->>'reads_all_envelopes', 'no spend block'));
    PERFORM pg_temp.act(pg_temp.id('M2'));
    PERFORM pg_temp.check('4g the flag equals finance.fn_reads_wallet_envelopes on the policy wallet',
        (v_d->'spend'->>'reads_all_envelopes')::boolean = finance.fn_reads_wallet_envelopes(
            (SELECT w.id FROM finance.wallets w JOIN org.business_profiles b ON b.id = w.owner_id
              WHERE w.owner_type = 'business' AND b.id = pg_temp.id('H')
                AND upper(w.currency) = upper(COALESCE(b.default_currency, 'USD')))), 'mismatch');
    v_d := pg_temp.detail('business', 'atlaslabs', pg_temp.id('MIGUEL'));
    PERFORM pg_temp.check('4h a member who may not open Spend gets no spend block (so no flag at all)',
        jsonb_typeof(v_d->'spend') = 'null', COALESCE(jsonb_typeof(v_d->'spend'), 'absent'));
END $$;
-- #endregion

-- #region 5. A business's preset remits are a business's (#249 (m))
-- org.fn_seed_preset_roles' business branch, as the console shows it in the invite dialog's Role hint
-- and the Roles remits: the Admin lacks the owner-reserved rights unless granted; the Member is
-- buyer-side. The seeded businesses carry the same words (supabase/seeds/gen/emit-entities.ts). A
-- team's presets are unchanged. Red on a DB older than this edit of 00001020 — deno task db:reset.
DO $$
DECLARE
    v_admin text := 'Runs the roster, the money and the settings — everything but withdrawing, billing and archiving, unless the owner grants them.';
    v_member text := 'Adds funds to the wallet and sees the analytics; anything more comes from a custom role.';
    v_user uuid;
    v_new uuid;
    v_got text;
BEGIN
    SELECT u.user_id INTO v_user FROM org.users_public u
     WHERE u.username IS NOT NULL AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.business_profiles b WHERE b.owner_user_id = u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.deletion_requests d WHERE d.user_id = u.user_id)
     ORDER BY u.username LIMIT 1;
    PERFORM pg_temp.act(v_user);
    v_new := (org.create_workspace('business', 'Probe Presets', 'probepresetsbu7')->>'id')::uuid;
    v_got := (SELECT string_agg(r.preset || '=' || r.summary, ' | ' ORDER BY r.preset)
                FROM org.business_roles r WHERE r.business_id = v_new AND r.preset IS NOT NULL);
    PERFORM pg_temp.check('5a a new business''s Admin and Member read as a business''s, with no Lead',
        (SELECT r.summary FROM org.business_roles r WHERE r.business_id = v_new AND r.preset = 'admin') = v_admin
            AND (SELECT r.summary FROM org.business_roles r WHERE r.business_id = v_new AND r.preset = 'member') = v_member
            AND NOT EXISTS (SELECT 1 FROM org.business_roles r WHERE r.business_id = v_new AND r.preset = 'lead'),
        v_got);
    v_got := (SELECT string_agg(r.preset || '=' || r.summary, ' | ' ORDER BY r.preset)
                FROM org.business_roles r WHERE r.business_id = pg_temp.id('H') AND r.preset IN ('admin', 'member'));
    PERFORM pg_temp.check('5b the seeded Helia presets carry the same words',
        (SELECT r.summary FROM org.business_roles r WHERE r.business_id = pg_temp.id('H') AND r.preset = 'admin') = v_admin
            AND (SELECT r.summary FROM org.business_roles r WHERE r.business_id = pg_temp.id('H') AND r.preset = 'member') = v_member,
        v_got);
    PERFORM pg_temp.check('5c a team''s Admin keeps its own remit',
        NOT EXISTS (SELECT 1 FROM org.team_roles r WHERE r.preset = 'admin' AND r.summary = v_admin), 'team');
END $$;
-- #endregion

ROLLBACK;
