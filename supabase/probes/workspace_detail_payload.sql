-- =============================================================================================
-- Probe: one console read (TEAMS_BUILD_PROMPTS B7; TEAMS_AUDIT B5, W3; Decision #233) —
-- org.get_workspace_detail carries the team's payout block (manage_finances only), its live
-- engagements with W_i, its proposal allowance and every member's live W_i, so the service needs no
-- second read; and org.profiles_index's team `workload` is the members' live W_i, never the dead
-- org.teams.current_workload_intensity counter.
--
-- Rollback-safe: one transaction, ends in ROLLBACK (the allowance read opens the week — that write is
-- rolled back with everything else). Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/workspace_detail_payload.sql
--
-- Fixture (seeded): the team `northloop` — owner O (manage_finances), a plain member M (no
-- manage_finances) — holding at least one live stage assignment on an active project; and any active
-- business with its owner B. Every case runs and reports; a clean run prints only PASS notices, and any
-- FAIL aborts the run at the end.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid, txt text);
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
CREATE FUNCTION pg_temp.detail(p_user uuid, p_kind text, p_handle text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_user);
    RETURN org.get_workspace_detail(p_kind, p_handle);
END $$;

-- A member's live W_i, summed the way projects.check_ticket_capacity sums it.
CREATE FUNCTION pg_temp.live_wi(p_user uuid) RETURNS numeric LANGUAGE sql AS $$
    SELECT COALESCE(sum(t.workload_intensity), 0) FROM projects.tickets t
     WHERE t.current_assignee_id = p_user AND t.status::text IN ('claimed', 'in_progress', 'in_review', 'reported_hidden');
$$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_owner uuid;
    v_member uuid;
    v_business uuid;
    v_business_owner uuid;
    v_business_slug text;
BEGIN
    SELECT t.id, t.owner_user_id INTO v_team, v_owner FROM org.teams t WHERE t.slug = 'northloop';
    SELECT m.user_id INTO v_member FROM org.team_members m
     WHERE m.team_id = v_team AND m.status = 'active' AND m.role = 'member'
     ORDER BY m.user_id LIMIT 1;
    SELECT b.id, b.owner_user_id, b.slug INTO v_business, v_business_owner, v_business_slug
      FROM org.business_profiles b WHERE b.status = 'active' ORDER BY b.slug LIMIT 1;
    IF v_team IS NULL OR v_member IS NULL OR v_business IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, member %, business %) — deno task db:reset',
            v_team, v_member, v_business;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
          JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
          JOIN projects.projects pr ON pr.id = ps.project_id
         WHERE sa.team_id = v_team AND sa.status NOT IN ('declined', 'cancelled', 'released', 'completed')
           AND pr.status::text IN ('active', 'on_hold')
    ) THEN
        RAISE EXCEPTION 'FAIL fixture: northloop holds no live stage assignment';
    END IF;
    INSERT INTO probe_ids VALUES
        ('team', v_team, 'northloop'), ('owner', v_owner, NULL), ('member', v_member, NULL),
        ('business', v_business, v_business_slug), ('business_owner', v_business_owner, NULL);

    PERFORM pg_temp.act(v_owner);
    IF NOT org.fn_member_can('team', v_team, 'manage_finances') THEN
        RAISE EXCEPTION 'FAIL fixture: the northloop owner lacks manage_finances';
    END IF;
    PERFORM pg_temp.act(v_member);
    IF org.fn_member_can('team', v_team, 'manage_finances') THEN
        RAISE EXCEPTION 'FAIL fixture: the northloop member holds manage_finances';
    END IF;
END $$;
-- #endregion

-- #region Cases
DO $$
DECLARE
    v_owner_view jsonb := pg_temp.detail(pg_temp.id('owner'), 'team', 'northloop');
    v_member_view jsonb := pg_temp.detail(pg_temp.id('member'), 'team', 'northloop');
    v_business_view jsonb := pg_temp.detail(pg_temp.id('business_owner'), 'business',
        (SELECT txt FROM probe_ids WHERE k = 'business'));
    v_payout jsonb := v_owner_view -> 'payout';
    v_engagement jsonb := v_owner_view -> 'engagements' -> 0;
    v_member jsonb;
    v_wi_ok boolean := true;
    v_index record;
BEGIN
    -- The payout block: present for manage_finances, absent for everyone else.
    PERFORM pg_temp.check('owner receives the payout block',
        jsonb_typeof(v_payout) = 'object' AND v_payout ? 'rule' AND v_payout ? 'wallet' AND v_payout ? 'preview',
        format('payout = %s', v_payout));
    PERFORM pg_temp.check('payout wallet figures are integer minor units',
        v_payout -> 'wallet' IS NULL OR jsonb_typeof(v_payout -> 'wallet') = 'null' OR (
            (v_payout #>> '{wallet,available_minor}') ~ '^[0-9]+$'
            AND (v_payout #>> '{wallet,pending_minor}') ~ '^[0-9]+$'
            AND (v_payout #>> '{wallet,currency}') ~ '^[A-Za-z]{3}$'),
        format('wallet = %s', v_payout -> 'wallet'));
    PERFORM pg_temp.check('member without manage_finances receives no payout block',
        jsonb_typeof(v_member_view -> 'payout') = 'null', format('payout = %s', v_member_view -> 'payout'));

    -- Engagements: slugs only, live W_i per assignee and per stage.
    PERFORM pg_temp.check('a live engagement is listed',
        jsonb_typeof(v_engagement) = 'object', format('engagements = %s', v_owner_view -> 'engagements'));
    PERFORM pg_temp.check('engagement addresses are prj-/stg- slugs',
        (v_engagement ->> 'project_slug') LIKE 'prj-%' AND (v_engagement ->> 'stage_slug') LIKE 'stg-%',
        format('engagement = %s', v_engagement));
    -- The assignees' user ids are the one exception: the service resolves them to faces and drops them.
    PERFORM pg_temp.check('no engagement field but an assignee user id is a uuid',
        COALESCE((SELECT jsonb_agg(e - 'assignees') FROM jsonb_array_elements(v_owner_view -> 'engagements') e)::text, '')
            !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        AND COALESCE((SELECT jsonb_agg(a - 'user_id') FROM jsonb_array_elements(v_owner_view -> 'engagements') e,
                        jsonb_array_elements(e -> 'assignees') a)::text, '')
            !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
        format('engagements = %s', v_owner_view -> 'engagements'));
    PERFORM pg_temp.check('stage W_i is the sum of its assignees',
        (v_engagement ->> 'stage_wi')::numeric = COALESCE((
            SELECT sum((a ->> 'stage_wi')::numeric) FROM jsonb_array_elements(v_engagement -> 'assignees') a), 0),
        format('engagement = %s', v_engagement));
    PERFORM pg_temp.check('the seeded engagement has active-ticket assignees',
        jsonb_array_length(v_engagement -> 'assignees') > 0, format('engagement = %s', v_engagement));

    -- Members' W_i from the source check_ticket_capacity reads.
    FOR v_member IN SELECT * FROM jsonb_array_elements(v_owner_view -> 'members') LOOP
        IF NOT (v_member ? 'wi') OR (v_member ->> 'wi')::numeric <> pg_temp.live_wi((v_member ->> 'user_id')::uuid)
           OR (v_member ->> 'wi_cap')::numeric <= 0 THEN
            v_wi_ok := false;
        END IF;
    END LOOP;
    PERFORM pg_temp.check('members[].wi is the live ticket sum and wi_cap is positive', v_wi_ok,
        format('members = %s', v_owner_view -> 'members'));

    -- The allowance: the get_proposal_allowance shape, per viewer.
    PERFORM pg_temp.check('allowance carries team status, head-count and the owner''s bind_seat',
        (v_owner_view #>> '{allowance,team_status}') = 'active'
            AND (v_owner_view #>> '{allowance,team_member_count}')::int =
                (SELECT count(*) FROM org.team_members m WHERE m.team_id = pg_temp.id('team') AND m.status = 'active')
            AND (v_owner_view #>> '{allowance,can_bind_seat}')::boolean,
        format('allowance = %s', v_owner_view -> 'allowance'));
    PERFORM pg_temp.check('a member without bind_seat reads can_bind_seat = false',
        (v_member_view #>> '{allowance,can_bind_seat}')::boolean = false,
        format('allowance = %s', v_member_view -> 'allowance'));

    -- A business answers the same keys, empty.
    PERFORM pg_temp.check('a business detail carries no payout, engagements or allowance',
        jsonb_typeof(v_business_view -> 'payout') = 'null'
            AND jsonb_typeof(v_business_view -> 'allowance') = 'null'
            AND v_business_view -> 'engagements' = '[]'::jsonb,
        format('business = %s', v_business_view - 'members' - 'roles' - 'activity'));

    -- Counterparties come with the read (the service no longer selects org.profiles_index itself).
    PERFORM pg_temp.check('team project rows carry the client face',
        (SELECT bool_and(p ? 'client') FROM jsonb_array_elements(v_owner_view -> 'projects') p),
        format('projects = %s', v_owner_view -> 'projects'));
    PERFORM pg_temp.check('business project rows carry the provider faces',
        COALESCE((SELECT bool_and(p ? 'provider_user_ids' AND p ? 'provider_teams')
                    FROM jsonb_array_elements(v_business_view -> 'projects') p), true),
        format('projects = %s', v_business_view -> 'projects'));

    -- #226 (h): the directory's team workload is the members' live W_i, not the dead counter.
    SELECT pi.workload, pi.workload_cap INTO v_index FROM org.profiles_index pi WHERE pi.entity_id = pg_temp.id('team');
    PERFORM pg_temp.check('profiles_index team workload = Σ active members'' live W_i',
        v_index.workload = (SELECT round(sum(pg_temp.live_wi(m.user_id)))::int FROM org.team_members m
                             WHERE m.team_id = pg_temp.id('team') AND m.status = 'active')
            AND (SELECT round(sum(pg_temp.live_wi(m.user_id))) FROM org.team_members m
                  WHERE m.team_id = pg_temp.id('team') AND m.status = 'active') > 0,
        format('workload = %s', v_index.workload));
    PERFORM pg_temp.check('profiles_index team workload_cap = Σ active members'' caps',
        v_index.workload_cap = (
            SELECT sum(COALESCE(fp.max_workload_intensity,
                (SELECT (pp.value #>> '{}')::numeric FROM security.platform_params pp
                  WHERE pp.key = 'global_workload_cap_default'), 10.00))
              FROM org.team_members m LEFT JOIN org.freelancer_profiles fp ON fp.user_id = m.user_id
             WHERE m.team_id = pg_temp.id('team') AND m.status = 'active'),
        format('workload_cap = %s', v_index.workload_cap));
END $$;
-- #endregion

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_fails) THEN
        RAISE EXCEPTION 'workspace_detail_payload: % case(s) failed: %',
            (SELECT count(*) FROM probe_fails), (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'workspace_detail_payload: all cases passed';
END $$;

ROLLBACK;
