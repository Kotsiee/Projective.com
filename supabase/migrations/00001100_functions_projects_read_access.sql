-- ============================================================================
-- 00001100 functions projects read access
-- Consolidated verbatim from: 0101_create_project.sql, 0103_get_dashboard_projects.sql, 0104_get_dashboard_stage_details.sql, 0105_has_project_access.sql, 0114_update_entity_project_counts.sql, 0116_project_details_deadline_bonuses.sql, 0118_project_roster.sql, 0119_project_lifecycle.sql, 0122_project_card_summary.sql, 0308_stage_workspace_access.sql, 0311_e7_private_channels_pii_handover.sql
-- ============================================================================

-- ---------------------------------------------------------------------------------------------
-- projects.create_project(payload jsonb) -> jsonb {id, slug}
--
-- The one atomic write behind POST /api/projects/create. Everything a new engagement needs -- the
-- row, its owning workspace, its stages, their staffing roles, the participant record and the
-- readable address -- lands in ONE transaction, because a project with stages and no participant, or
-- an address nothing can resolve, is a half-created engagement the client has already navigated to.
--
-- WHY AN RPC AND NOT FOUR TABLE WRITES. PostgREST gives the application one statement per call, so a
-- TypeScript create would be four round trips with no transaction around them and no way to undo the
-- first three when the fourth is refused. It also runs `projects.update_entity_project_counts`, an
-- AFTER INSERT trigger that is SECURITY INVOKER and writes `org.users_public` -- a table the caller
-- has no business updating directly. Running the insert inside a DEFINER function puts that trigger
-- in the definer's context, where it belongs.
--
-- WHAT DEFINER OBLIGES. Bypassing RLS means every ownership claim in the payload has to be checked
-- HERE or not at all. `owner_user_id` is never read from the payload -- it is always `auth.uid()` --
-- and each of the three workspace columns is verified against active membership below. A caller may
-- file a project under a workspace they belong to and under no other.
--
-- RETURNS jsonb rather than the uuid it used to, because the caller needs the SLUG in the same
-- breath: every /projects route addresses an engagement by slug, so returning only the id would force
-- a second read to find out where the client should navigate. The return type change requires
-- DROP + CREATE (Postgres will not replace a function's return type), which is safe here -- the old
-- signature had no caller in the application.
-- ---------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS projects.create_project (jsonb);

CREATE FUNCTION projects.create_project (payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, comms, auth
AS $$
DECLARE
    v_project_id uuid;
    v_owner_id uuid;
    v_business_id uuid;
    v_team_id uuid;
    v_org_id uuid;
    v_scope_count integer;
    v_title text;
    v_slug text;
    v_slug_base text;
    v_attempt integer := 0;
    v_constraint text;
    v_stage jsonb;
    v_role jsonb;
    v_stage_id uuid;
    v_stage_name text;
    v_first_stage_id uuid;
    v_sort integer := 0;
    v_attachment_id text;
BEGIN
    -- 1. Identity. Never taken from the payload: the whole point of a DEFINER function is that the
    -- caller cannot name themselves.
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    -- An explicit id is honoured so a caller can be idempotent against its own retry; otherwise one
    -- is generated. Previously this was a bare cast, so a payload without an id inserted NULL into a
    -- NOT NULL column -- the DEFAULT never applied, because an explicit NULL is not an absent value.
    v_project_id := COALESCE(NULLIF(payload->>'id', '')::uuid, gen_random_uuid());

    v_title := NULLIF(btrim(COALESCE(payload->>'title', '')), '');
    IF v_title IS NULL THEN
        RAISE EXCEPTION 'Name your project.' USING ERRCODE = '23514';
    END IF;

    -- 2. The owning workspace. Personal scope is the ABSENCE of all three columns, so nothing is
    -- written for it. Each of the other three is checked against ACTIVE membership: this function
    -- bypasses RLS, so an unchecked id here would let any signed-in caller file a project under
    -- somebody else's team.
    v_business_id := NULLIF(payload->>'client_business_id', '')::uuid;
    v_team_id     := NULLIF(payload->>'owner_team_id', '')::uuid;
    v_org_id      := NULLIF(payload->>'owner_organisation_id', '')::uuid;

    v_scope_count := (v_business_id IS NOT NULL)::int
                   + (v_team_id IS NOT NULL)::int
                   + (v_org_id IS NOT NULL)::int;
    IF v_scope_count > 1 THEN
        RAISE EXCEPTION 'A project belongs to one workspace.' USING ERRCODE = '23514';
    END IF;

    IF v_business_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM org.business_members bm
            WHERE bm.business_id = v_business_id
              AND bm.user_id = v_owner_id
              AND bm.status = 'active'
        ) THEN
            RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_team_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM org.team_members tm
            WHERE tm.team_id = v_team_id
              AND tm.user_id = v_owner_id
              AND tm.status = 'active'
        ) THEN
            RAISE EXCEPTION 'You are not an active member of this team' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_org_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM org.organisation_members om
            WHERE om.organisation_id = v_org_id
              AND om.user_id = v_owner_id
              AND om.status = 'active'
        ) THEN
            RAISE EXCEPTION 'You are not an active member of this organisation' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 3. The address. The application sends a title-derived slug; this normalises it to the column's
    -- CHECK shape and falls back to the generated form when a title has nothing usable in it (all
    -- punctuation, or a non-Latin script) rather than inventing prose the author did not write.
    v_slug_base := COALESCE(NULLIF(payload->>'slug', ''), lower(v_title));
    v_slug_base := regexp_replace(lower(v_slug_base), '[^a-z0-9]+', '-', 'g');
    v_slug_base := btrim(v_slug_base, '-');
    v_slug_base := left(v_slug_base, 80);
    v_slug_base := btrim(v_slug_base, '-');
    IF v_slug_base = '' THEN
        v_slug_base := 'p-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    END IF;
    v_slug := v_slug_base;

    -- 4. Insert, retrying on a slug collision.
    --
    -- The retry is on the CONSTRAINT, not on a prior SELECT: two callers naming a project the same
    -- thing in the same instant both see the slug free, and only the unique index resolves that.
    -- Bounded so a genuinely unrecoverable conflict surfaces as an error instead of spinning.
    --
    -- The AFTER-INSERT triggers on projects.projects (search sync + entity project counts) are
    -- correct and must run here; they are intentionally NOT suppressed.
    LOOP
        BEGIN
            INSERT INTO projects.projects (
                id, owner_user_id, client_business_id, owner_team_id, owner_organisation_id,
                title, slug, description, description_text,
                format, structure_variation, session_kind, status,
                budget_type, budget_amount_cents,
                industry_category_id, visibility, currency,
                timeline_preset, target_project_start_date,
                ip_ownership_mode, nda_required, portfolio_display_rights,
                location_restriction, language_requirement, screening_questions
            ) VALUES (
                v_project_id, v_owner_id, v_business_id, v_team_id, v_org_id,
                v_title, v_slug,
                COALESCE(payload->'description', '{}'::jsonb),
                COALESCE(payload->>'description_text', ''),
                COALESCE((payload->>'format')::project_format, 'pipeline'::project_format),
                COALESCE(
                    (payload->>'structure_variation')::projects.structure_variation,
                    'standard'::projects.structure_variation
                ),
                COALESCE(NULLIF(payload->>'session_kind', ''), 'none'),
                -- A new engagement is always a draft. Not from the payload: `status` gates the public
                -- footprint trigger and the escrow lifecycle, and neither should be reachable by a
                -- create call that has collected nothing yet.
                'draft'::project_status,
                COALESCE((payload->>'budget_type')::budget_type, 'fixed_price'::budget_type),
                NULLIF(payload->>'budget_amount_cents', '')::bigint,
                NULLIF(payload->>'industry_category_id', '')::uuid,
                -- Unlisted, and NOT from the payload -- for the same reason `status` is not. Visibility
                -- is a publication decision, the create modal collects none, and this function is
                -- EXECUTE-granted to `authenticated`, so anything it reads out of the payload is
                -- reachable directly over PostgREST. A caller was able to publish a project in the act
                -- of naming it; now publishing is a later, deliberate write that goes through the
                -- setup path and its footprint cap.
                'unlisted'::visibility,
                COALESCE(NULLIF(payload->>'currency', ''), 'USD'),
                COALESCE((payload->>'timeline_preset')::timeline_preset, 'sequential'::timeline_preset),
                NULLIF(payload->>'target_project_start_date', '')::timestamptz,
                COALESCE((payload->>'ip_ownership_mode')::ip_option_mode, 'exclusive_transfer'::ip_option_mode),
                COALESCE((payload->>'nda_required')::boolean, false),
                COALESCE((payload->>'portfolio_display_rights')::portfolio_rights, 'allowed'::portfolio_rights),
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(payload->'location_restriction')), '{}'::text[]),
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(payload->'language_requirement')), '{}'::text[]),
                COALESCE(payload->'screening_questions', '[]'::jsonb)
            );
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            -- ONLY the slug's constraint. `projects.projects` has two unique indexes, and a caller who
            -- supplies an `id` that is already taken trips the PRIMARY KEY -- which a bare handler
            -- caught, retried five times with fresh slugs against the same doomed id, and then reported
            -- as "Could not find a free address". The address was never the problem, and the caller was
            -- told to fix the one thing that was fine.
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            IF v_constraint IS DISTINCT FROM 'projects_slug_key' THEN
                RAISE;
            END IF;

            v_attempt := v_attempt + 1;
            IF v_attempt > 5 THEN
                RAISE EXCEPTION 'Could not find a free address for this project.' USING ERRCODE = '23505';
            END IF;
            -- Re-truncate the base so base + suffix always fits the column's 96-character CHECK.
            v_slug := left(v_slug_base, 80) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
        END;
    END LOOP;

    -- 5. Stages, in payload order. `sort_order` is assigned here rather than trusted from the payload:
    -- it is the execution sequence, and a client that omitted it or repeated a value would produce a
    -- pipeline whose order depends on how the rows happen to come back.
    IF payload ? 'stages' AND jsonb_typeof(payload->'stages') = 'array' THEN
        FOR v_stage IN SELECT * FROM jsonb_array_elements(payload->'stages')
        LOOP
            v_stage_id := COALESCE(NULLIF(v_stage->>'id', '')::uuid, gen_random_uuid());
            -- Resolved ONCE so the stage row and its channel are given the same name. Computing it
            -- twice is how one thing comes to be called two things in the two places a reader looks.
            v_stage_name := COALESCE(
                NULLIF(btrim(COALESCE(v_stage->>'name', v_stage->>'title', '')), ''),
                'Untitled stage'
            );
            INSERT INTO projects.project_stages (
                id, project_id, name, description, description_text, sort_order,
                unit_price_cents, milestone,
                file_upload_required, default_tasks, skills,
                start_trigger_type, fixed_start_date, start_dependency_lag_days, hire_trigger_active,
                file_revisions_allowed, file_duration_mode, file_duration_days, file_due_date,
                session_duration_minutes, session_count, session_preferred_days, session_end_date,
                ip_ownership_override, ip_mode
            ) VALUES (
                v_stage_id,
                v_project_id,
                v_stage_name,
                COALESCE(v_stage->'description', '{}'::jsonb),
                COALESCE(v_stage->>'description_text', ''),
                v_sort,
                NULLIF(v_stage->>'unit_price_cents', '')::bigint,
                COALESCE(v_stage->>'milestone', ''),
                COALESCE((v_stage->>'file_upload_required')::boolean, false),
                COALESCE(v_stage->'default_tasks', '[]'::jsonb),
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_stage->'skills')), '{}'::text[]),
                COALESCE((v_stage->>'start_trigger_type')::start_trigger_type, 'on_project_start'::start_trigger_type),
                NULLIF(v_stage->>'fixed_start_date', '')::timestamptz,
                COALESCE(NULLIF(v_stage->>'start_dependency_lag_days', '')::integer, 0),
                COALESCE((v_stage->>'hire_trigger_active')::boolean, true),
                COALESCE(NULLIF(v_stage->>'file_revisions_allowed', '')::integer, 0),
                v_stage->>'file_duration_mode',
                NULLIF(v_stage->>'file_duration_days', '')::integer,
                NULLIF(v_stage->>'file_due_date', '')::timestamptz,
                NULLIF(v_stage->>'session_duration_minutes', '')::integer,
                COALESCE(NULLIF(v_stage->>'session_count', '')::integer, 1),
                CASE
                    WHEN v_stage ? 'session_preferred_days'
                    THEN ARRAY(SELECT jsonb_array_elements_text(v_stage->'session_preferred_days'))
                    ELSE NULL
                END,
                NULLIF(v_stage->>'session_end_date', '')::timestamptz,
                NULLIF(v_stage->>'ip_ownership_override', '')::ip_option_mode,
                COALESCE(
                    NULLIF(v_stage->>'ip_mode', '')::ip_option_mode,
                    NULLIF(v_stage->>'ip_ownership_override', '')::ip_option_mode,
                    'exclusive_transfer'::ip_option_mode
                )
            );
            -- Open the stage's General room in the same transaction.
            --
            -- Not a nicety: `comms.get_stage_channels` provisions rooms LAZILY on first open and the
            -- channel tree is built from the channels that already exist, so a stage created without
            -- one is (in `projects.create_stage`'s own words) "a stage nobody can see or navigate to".
            -- The setup form's own stage-adder provisions one; a stage that arrived with the project
            -- must not be second-class for having been named earlier.
            PERFORM comms.get_or_create_project_channel(v_project_id, v_stage_id, v_stage_name);

            IF v_first_stage_id IS NULL THEN
                v_first_stage_id := v_stage_id;
            END IF;
            v_sort := v_sort + 1;
        END LOOP;

        -- Second pass: resolve sequential dependencies now that every stage row exists.
        FOR v_stage IN SELECT * FROM jsonb_array_elements(payload->'stages')
        LOOP
            IF NULLIF(v_stage->>'id', '') IS NOT NULL
               AND NULLIF(v_stage->>'start_dependency_stage_id', '') IS NOT NULL THEN
                UPDATE projects.project_stages
                SET start_dependency_stage_id = (v_stage->>'start_dependency_stage_id')::uuid
                WHERE id = (v_stage->>'id')::uuid
                  AND project_id = v_project_id;
            END IF;
        END LOOP;
    END IF;

    -- 6. Staffing roles.
    --
    -- `stage_staffing_roles` hangs off a STAGE, not a project, so a Direct Deliverable -- which the
    -- client composes as roles and no stages -- needs somewhere for them to live. One is opened here
    -- rather than refusing, because the alternative is a create that succeeds and silently discards
    -- what the client typed. `reconcileRoles` does exactly this on the setup path, so the two agree.
    IF payload ? 'roles' AND jsonb_typeof(payload->'roles') = 'array'
       AND jsonb_array_length(payload->'roles') > 0 THEN
        IF v_first_stage_id IS NULL THEN
            v_stage_id := gen_random_uuid();
            INSERT INTO projects.project_stages (id, project_id, name, sort_order)
            VALUES (v_stage_id, v_project_id, 'Delivery', 0);
            PERFORM comms.get_or_create_project_channel(v_project_id, v_stage_id, 'Delivery');
            v_first_stage_id := v_stage_id;
        END IF;

        FOR v_role IN SELECT * FROM jsonb_array_elements(payload->'roles')
        LOOP
            INSERT INTO projects.stage_staffing_roles (
                project_stage_id, role_title, quantity, budget_type, budget_amount_cents, skills
            ) VALUES (
                v_first_stage_id,
                COALESCE(NULLIF(btrim(COALESCE(v_role->>'name', v_role->>'role_title', '')), ''), 'Untitled role'),
                COALESCE((v_role->>'quantity')::integer, 1),
                COALESCE((v_role->>'budget_type')::budget_type, 'fixed_price'::budget_type),
                -- NULL, not zero: the create modal collects no budget, and zero would state that the
                -- seat is free.
                NULLIF(v_role->>'budget_amount_cents', '')::bigint,
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_role->'skills')), '{}'::text[])
            );
        END LOOP;
    END IF;

    -- 7. The participant record.
    --
    -- Written ONLY for a business-owned project, and that restraint is the point. `profile_type` is
    -- ('freelancer','business') -- it has no member for an individual buyer -- and
    -- `projects.has_project_access` resolves a personal owner through `owner_user_id` in its first
    -- branch, so a personal project needs no participant row to be reachable. Writing one as
    -- 'freelancer' would be a false claim about who the creator is, and it would match nothing:
    -- that branch joins `org.freelancer_profiles`, which a client has no row in.
    IF v_business_id IS NOT NULL THEN
        INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
        VALUES (v_project_id, 'business', v_business_id, 'owner');
    END IF;

    -- 8. Global attachments.
    IF payload ? 'global_attachments' AND jsonb_typeof(payload->'global_attachments') = 'array' THEN
        FOR v_attachment_id IN SELECT * FROM jsonb_array_elements_text(payload->'global_attachments')
        LOOP
            INSERT INTO projects.project_attachments (project_id, attachment_id)
            VALUES (v_project_id, v_attachment_id::uuid);
        END LOOP;
    END IF;

    RETURN jsonb_build_object('id', v_project_id, 'slug', v_slug);
END;
$$;

COMMENT ON FUNCTION projects.create_project (jsonb) IS
'Creates one engagement and everything it arrives with -- stages, staffing roles, the participant record and a readable unique slug -- in a single transaction, owned by auth.uid() and always at status draft. Returns jsonb {id, slug}.';

REVOKE ALL ON FUNCTION projects.create_project (jsonb) FROM PUBLIC;

GRANT
EXECUTE ON FUNCTION projects.create_project (jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION projects.get_dashboard_projects(
  p_category text,
  p_category_id uuid,
  p_search_query text,
  p_sort_by text,
  p_sort_dir text,
  p_limit int,
  p_offset int
)
RETURNS TABLE (
  project_id uuid,
  title text,
  status text,
  owner_name text,
  owner_avatar jsonb,
  is_starred boolean,
  is_archived boolean,
  has_unread boolean,
  last_updated_at timestamptz,
  total_count bigint
) 
LANGUAGE plpgsql
SECURITY INVOKER 
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH user_projects AS (
    SELECT DISTINCT
      p.id, p.title, p.status, p.client_business_id, p.owner_user_id,
      COALESCE(up.is_starred, false) as is_starred, COALESCE(up.is_archived, false) as is_archived,
      up.last_viewed_at, p.created_at as project_created_at
    FROM projects.projects p
    LEFT JOIN projects.user_preferences up ON up.project_id = p.id AND up.user_id = v_user_id
    LEFT JOIN projects.project_participants pp ON pp.project_id = p.id
    LEFT JOIN projects.stage_assignments sa ON sa.assigned_by = v_user_id
      OR (sa.assignee_type = 'freelancer' AND sa.freelancer_profile_id = v_user_id)
      OR (sa.assignee_type = 'team' AND sa.team_id IN (
          SELECT tm.team_id FROM org.team_members tm WHERE tm.user_id = v_user_id AND tm.status = 'active'
      ))
    WHERE 
      (p.owner_user_id = v_user_id OR pp.profile_id IN (SELECT bp.id FROM org.business_profiles bp WHERE bp.owner_user_id = v_user_id) OR (pp.profile_type = 'freelancer' AND pp.profile_id = v_user_id))
      AND (p_category <> 'team' OR (EXISTS (SELECT 1 FROM projects.stage_assignments sa_team WHERE sa_team.project_stage_id IN (SELECT ps.id FROM projects.project_stages ps WHERE ps.project_id = p.id) AND sa_team.assignee_type = 'team' AND sa_team.team_id = p_category_id)))
      AND (p_category <> 'service' OR (EXISTS (SELECT 1 FROM projects.project_required_skills prs JOIN org.skills s ON s.id = prs.skill_id WHERE prs.project_id = p.id AND s.id = p_category_id)))
  ),
  calc_updates AS (
    SELECT
      up.id,
      (SELECT MAX(pa.created_at) FROM projects.project_activity pa WHERE pa.project_id = up.id) as activity_ts,
      EXISTS (
        SELECT 1 FROM comms.notifications n 
        WHERE n.user_id = v_user_id AND n.read_at IS NULL AND ((n.entity_table = 'projects.projects' AND n.entity_id = up.id) OR (n.entity_table = 'projects.project_stages' AND n.entity_id IN (SELECT ps.id FROM projects.project_stages ps WHERE ps.project_id = up.id)))
      ) as has_unread
    FROM user_projects up
  )
  SELECT
    p.id as project_id, p.title, p.status::text,
    CASE WHEN bp.id IS NOT NULL THEN bp.name ELSE COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up_public.first_name, up_public.last_name)), ''), up_public.username) END as owner_name,
    CASE WHEN bp.id IS NOT NULL 
         THEN (SELECT metadata->'variants' FROM files.items WHERE id = bp.logo_file_id) 
         ELSE (SELECT metadata->'variants' FROM files.items WHERE id = up_public.avatar_file_id) 
    END as owner_avatar,
    up.is_starred, up.is_archived, cu.has_unread,
    COALESCE(cu.activity_ts, p.created_at) as last_updated_at,
    COUNT(*) OVER() as total_count
  FROM user_projects up
  JOIN projects.projects p ON p.id = up.id
  LEFT JOIN calc_updates cu ON cu.id = up.id
  LEFT JOIN org.business_profiles bp ON bp.id = p.client_business_id
  LEFT JOIN org.users_public up_public ON up_public.user_id = p.owner_user_id
  WHERE (p_search_query = '' OR p.title ILIKE '%' || p_search_query || '%')
    AND CASE 
      WHEN p_category = 'starred' THEN up.is_starred = true
      WHEN p_category = 'unread' THEN cu.has_unread = true
      WHEN p_category = 'in-progress' THEN p.status = 'active'
      WHEN p_category = 'completed' THEN p.status = 'completed'
      WHEN p_category = 'archived' THEN up.is_archived = true
      ELSE up.is_archived IS FALSE
    END
  ORDER BY
    CASE WHEN p_sort_by = 'last_updated' AND p_sort_dir = 'asc' THEN COALESCE(cu.activity_ts, p.created_at) END ASC,
    CASE WHEN p_sort_by = 'last_updated' AND p_sort_dir = 'desc' THEN COALESCE(cu.activity_ts, p.created_at) END DESC,
    p.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION projects.get_stage_details(p_project_id uuid, p_stage_id uuid)
RETURNS TABLE (
  stage_id uuid, project_id uuid, title text, description jsonb, description_text text, sort_order int, status text, ip_mode text, file_upload_required boolean, default_tasks jsonb, skills text[], due_date timestamptz, scheduling jsonb, channel_id uuid, budget jsonb, assignee jsonb, latest_submission jsonb, viewer_context jsonb, assignment_mode text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, org, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_stage_status text;
BEGIN
  SELECT ps.status::text INTO v_stage_status FROM projects.project_stages ps WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stage not found or access denied'; END IF;

  SELECT CASE WHEN p.owner_user_id = v_user_id OR EXISTS(SELECT 1 FROM org.business_profiles bp WHERE bp.id = p.client_business_id AND bp.owner_user_id = v_user_id) THEN 'owner' WHEN sa.assignee_type = 'freelancer' AND sa.freelancer_profile_id = v_user_id THEN 'assignee' WHEN sa.assignee_type = 'team' AND sa.team_id IN (SELECT tm.team_id FROM org.team_members tm WHERE tm.user_id = v_user_id AND tm.status = 'active') THEN 'assignee' ELSE 'viewer' END INTO v_user_role FROM projects.projects p LEFT JOIN projects.stage_assignments sa ON sa.project_stage_id = p_stage_id AND sa.status = 'accepted' WHERE p.id = p_project_id;

  RETURN QUERY
  SELECT
    ps.id, ps.project_id, ps.name, ps.description, ps.description_text, ps.sort_order, ps.status::text, ps.ip_mode::text, ps.file_upload_required, ps.default_tasks, ps.skills, ps.file_due_date AS due_date,
    jsonb_build_object('start_trigger_type', ps.start_trigger_type, 'fixed_start_date', ps.fixed_start_date, 'start_dependency_stage_id', ps.start_dependency_stage_id, 'start_dependency_lag_days', ps.start_dependency_lag_days, 'file_duration_mode', ps.file_duration_mode, 'file_duration_days', ps.file_duration_days, 'file_due_date', ps.file_due_date, 'session_count', ps.session_count, 'session_preferred_days', ps.session_preferred_days, 'session_end_date', ps.session_end_date, 'hire_trigger_active', ps.hire_trigger_active) as scheduling,
    (SELECT pc.id FROM comms.project_channels pc WHERE pc.project_id = ps.project_id AND pc.stage_id = ps.id AND pc.visibility IN ('stage_all', 'project_all') ORDER BY pc.visibility DESC LIMIT 1) as channel_id,
    (SELECT jsonb_build_object('type', sbr.rule_type, 'amount_cents', sbr.amount_cents, 'currency', sbr.amount_currency) FROM projects.stage_budget_rules sbr WHERE sbr.project_stage_id = ps.id) as budget,
    (SELECT jsonb_build_object('type', sa.assignee_type, 'status', sa.status, 'profile_id', COALESCE(sa.freelancer_profile_id, sa.team_id), 'name', CASE WHEN sa.assignee_type = 'team' THEN t.name ELSE COALESCE(NULLIF(TRIM(CONCAT_WS(' ', upa.first_name, upa.last_name)), ''), upa.username) END, 'avatar', CASE WHEN sa.assignee_type = 'team' THEN NULL ELSE (SELECT metadata->'variants' FROM files.items WHERE id = upa.avatar_file_id) END) FROM projects.stage_assignments sa LEFT JOIN org.teams t ON t.id = sa.team_id LEFT JOIN org.freelancer_profiles fp ON fp.user_id = sa.freelancer_profile_id LEFT JOIN org.users_public upa ON upa.user_id = fp.user_id WHERE sa.project_stage_id = ps.id LIMIT 1) as assignee,
    (SELECT jsonb_build_object('id', ss.id, 'submitted_at', ss.created_at, 'notes', ss.notes, 'files', '[]'::jsonb) FROM projects.stage_submissions ss WHERE ss.project_stage_id = ps.id ORDER BY ss.created_at DESC LIMIT 1) as latest_submission,
    jsonb_build_object('role', v_user_role, 'permissions', jsonb_build_object('can_edit_details', (v_user_role = 'owner' AND ps.status::text IN ('open', 'assigned', 'in_progress')), 'can_assign', (v_user_role = 'owner' AND ps.status::text IN ('open', 'assigned')), 'can_submit_work', (v_user_role = 'assignee' AND ps.status::text IN ('in_progress', 'revisions')), 'can_approve', (v_user_role = 'owner' AND ps.status::text = 'submitted'), 'can_request_revision', (v_user_role = 'owner' AND ps.status::text = 'submitted'))) as viewer_context,
    ps.assignment_mode::text AS assignment_mode
  FROM projects.project_stages ps
  WHERE ps.id = p_stage_id;
END;
$$;

CREATE OR REPLACE FUNCTION projects.has_project_access(_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
BEGIN
  
  IF EXISTS (
    SELECT 1 FROM projects.projects
    WHERE id = _project_id AND owner_user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  
  IF EXISTS (
    SELECT 1 
    FROM projects.project_participants pp
    JOIN org.freelancer_profiles fp ON pp.profile_id = fp.user_id
    WHERE pp.project_id = _project_id
      AND pp.profile_type = 'freelancer'
      AND fp.user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  
  IF EXISTS (
    SELECT 1 
    FROM projects.project_participants pp
    JOIN org.business_profiles bp ON pp.profile_id = bp.id
    WHERE pp.project_id = _project_id
      AND pp.profile_type = 'business'
      AND bp.owner_user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  
  
  IF EXISTS (
    SELECT 1 
    FROM projects.stage_assignments sa
    JOIN projects.project_stages ps ON sa.project_stage_id = ps.id
    JOIN org.freelancer_profiles fp ON sa.freelancer_profile_id = fp.user_id
    WHERE ps.project_id = _project_id
      AND sa.assignee_type = 'freelancer'
      AND fp.user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  
  IF EXISTS (
    SELECT 1 
    FROM projects.stage_assignments sa
    JOIN projects.project_stages ps ON sa.project_stage_id = ps.id
    JOIN org.team_members tm ON sa.team_id = tm.team_id
    WHERE ps.project_id = _project_id
      AND sa.assignee_type = 'team'
      AND tm.user_id = auth.uid()
      AND tm.status = 'active'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION projects.update_entity_project_counts()
RETURNS TRIGGER AS $$
DECLARE
    v_row projects.projects;
    v_owner_id uuid;
    v_owner_type text;
BEGIN
    -- On DELETE, NEW is unassigned; recompute for the removed row's owner using OLD.
    IF TG_OP = 'DELETE' THEN
        v_row := OLD;
    ELSE
        v_row := NEW;
    END IF;

    -- projects.projects is owned by a business (client_business_id) or an individual
    -- (owner_user_id). There is no team ownership at the project level, so there is no
    -- NEW.team_id column to branch on.
    IF v_row.client_business_id IS NOT NULL THEN
        v_owner_id := v_row.client_business_id;
        v_owner_type := 'business';
    ELSE
        v_owner_id := v_row.owner_user_id;
        v_owner_type := 'user';
    END IF;

    -- Update counts based on the entity type
    IF v_owner_type = 'user' THEN
        UPDATE org.users_public
        SET total_project_count = (SELECT count(*) FROM projects.projects WHERE owner_user_id = v_owner_id),
            active_project_count = (SELECT count(*) FROM projects.projects WHERE owner_user_id = v_owner_id AND status = 'active')
        WHERE user_id = v_owner_id;
    ELSE
        UPDATE org.business_profiles
        SET total_project_count = (SELECT count(*) FROM projects.projects WHERE client_business_id = v_owner_id),
            active_project_count = (SELECT count(*) FROM projects.projects WHERE client_business_id = v_owner_id AND status = 'active')
        WHERE id = v_owner_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION projects.get_project_details(
  p_project_id uuid
)
RETURNS TABLE (
  project_id uuid,
  title text,
  format text,
  status text,
  is_starred boolean,
  allow_deadline_bonuses boolean,
  target_project_start_date timestamptz,
  timeline_preset text,
  owner jsonb,
  viewer_context jsonb,
  stages jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_is_owner boolean;
BEGIN
  SELECT
    CASE
      WHEN p.owner_user_id = v_user_id OR EXISTS (SELECT 1 FROM org.business_profiles bp WHERE bp.id = p.client_business_id AND bp.owner_user_id = v_user_id) THEN 'owner'
      WHEN EXISTS (SELECT 1 FROM projects.project_participants pp WHERE pp.project_id = p.id AND ((pp.profile_type = 'freelancer' AND pp.profile_id = v_user_id) OR (pp.profile_type = 'business' AND pp.profile_id IN (SELECT bp.id FROM org.business_profiles bp WHERE bp.owner_user_id = v_user_id)))) THEN 'collaborator'
      WHEN EXISTS (SELECT 1 FROM projects.stage_assignments sa JOIN projects.project_stages ps ON ps.id = sa.project_stage_id WHERE ps.project_id = p.id AND ((sa.assignee_type = 'freelancer' AND sa.freelancer_profile_id = v_user_id) OR (sa.assignee_type = 'team' AND sa.team_id IN (SELECT tm.team_id FROM org.team_members tm WHERE tm.user_id = v_user_id AND tm.status = 'active')))) THEN 'collaborator'
      ELSE NULL
    END
  INTO v_user_role
  FROM projects.projects p
  WHERE p.id = p_project_id;

  IF v_user_role IS NULL THEN RAISE EXCEPTION 'Access Denied'; END IF;
  v_is_owner := (v_user_role = 'owner');

  RETURN QUERY
  SELECT
    p.id, p.title, p.format::text, p.status::text,
    COALESCE(pref.is_starred, false), p.allow_deadline_bonuses,
    p.target_project_start_date, p.timeline_preset::text,
    jsonb_build_object(
      'id', COALESCE(bp.id, p.owner_user_id),
      'name', CASE WHEN bp.id IS NOT NULL THEN bp.name ELSE COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''), up.username) END,
      'avatar', CASE WHEN bp.id IS NOT NULL THEN (SELECT metadata->'variants' FROM files.items WHERE id = bp.logo_file_id) ELSE (SELECT metadata->'variants' FROM files.items WHERE id = up.avatar_file_id) END,
      'banner', CASE WHEN bp.id IS NOT NULL THEN (SELECT metadata->'variants' FROM files.items WHERE id = bp.banner_file_id) ELSE (SELECT metadata->'variants' FROM files.items WHERE id = up.banner_file_id) END,
      'type', CASE WHEN bp.id IS NOT NULL THEN 'business' ELSE 'freelancer' END
    ) as owner,
    jsonb_build_object('role', v_user_role, 'permissions', (SELECT jsonb_agg(perm) FROM (SELECT 'manage_settings' WHERE v_is_owner UNION ALL SELECT 'manage_members' WHERE v_is_owner UNION ALL SELECT 'view_financials' WHERE v_is_owner) as pr(perm))) as viewer_context,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ps.id, 'name', ps.name, 'status', ps.status, 'sort_order', ps.sort_order, 'unit_price_cents', ps.unit_price_cents, 'file_upload_required', ps.file_upload_required, 'default_tasks', ps.default_tasks, 'skills', ps.skills, 'start_trigger_type', ps.start_trigger_type, 'fixed_start_date', ps.fixed_start_date, 'start_dependency_stage_id', ps.start_dependency_stage_id, 'start_dependency_lag_days', ps.start_dependency_lag_days, 'file_duration_mode', ps.file_duration_mode, 'file_duration_days', ps.file_duration_days, 'file_due_date', ps.file_due_date, 'session_count', ps.session_count, 'session_preferred_days', ps.session_preferred_days, 'session_end_date', ps.session_end_date, 'hire_trigger_active', ps.hire_trigger_active) ORDER BY ps.sort_order ASC) FROM projects.project_stages ps WHERE ps.project_id = p.id), '[]'::jsonb) as stages
  FROM projects.projects p
  LEFT JOIN projects.user_preferences pref ON pref.project_id = p.id AND pref.user_id = v_user_id
  LEFT JOIN org.business_profiles bp ON bp.id = p.client_business_id
  LEFT JOIN org.users_public up ON up.user_id = p.owner_user_id
  WHERE p.id = p_project_id;
END;
$$;

-- =============================================================================================
-- 0118_project_roster.sql
-- Roster read-model for the ticket "Reassign" picker (spec §3b). Returns the freelancers eligible
-- to take a ticket on a project: everyone enrolled as a project participant plus anyone currently
-- holding a stage assignment, de-duplicated and joined to their public display name/avatar.
--
-- Consistent with the other modal read-models (get_ticket_finance / get_ticket_timeline): a
-- SECURITY DEFINER wrapper guarded by projects.has_project_access, relying on the default
-- EXECUTE-to-PUBLIC grant rather than an explicit function grant.
-- =============================================================================================

CREATE OR REPLACE FUNCTION projects.get_project_roster(p_project_id uuid)
RETURNS TABLE (
    profile_id uuid,
    name       text,
    avatar     jsonb,
    role       text
) AS $$
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'You do not have access to this project.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH candidates AS (
        -- Freelancers formally enrolled on the project.
        SELECT pp.profile_id AS pid, pp.role AS role
        FROM projects.project_participants pp
        WHERE pp.project_id = p_project_id
          AND pp.profile_type = 'freelancer'
        UNION
        -- Freelancers holding a live stage assignment (covers assignees added via staffing without
        -- a participant row yet).
        SELECT sa.freelancer_profile_id AS pid, 'assignee'::text AS role
        FROM projects.stage_assignments sa
        JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
        WHERE ps.project_id = p_project_id
          AND sa.assignee_type = 'freelancer'
          AND sa.freelancer_profile_id IS NOT NULL
    ),
    deduped AS (
        SELECT DISTINCT ON (c.pid) c.pid, c.role
        FROM candidates c
        ORDER BY c.pid
    )
    SELECT
        d.pid AS profile_id,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''), up.username) AS name,
        (SELECT fi.metadata -> 'variants' FROM files.items fi WHERE fi.id = up.avatar_file_id) AS avatar,
        d.role
    FROM deduped d
    JOIN org.users_public up ON up.user_id = d.pid
    ORDER BY name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, org, files, auth;

-- Writes only happen inside the SECURITY DEFINER RPC below (which bypasses RLS); no INSERT policy
-- is granted, so direct client inserts are denied.
-- #endregion

-- #region 2. Review-authority RBAC helper
-- TRUE when the caller is the project owner or belongs to the paying client business. This is the
-- "client viewer" authority the spec requires for approving deliverables and confirming milestones.
CREATE OR REPLACE FUNCTION projects.can_review_project(_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
    SELECT EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = _project_id
            AND (
                p.owner_user_id = auth.uid()
                OR (p.client_business_id IS NOT NULL AND org.is_active_business_member (p.client_business_id))
            )
    );
$$;

-- #endregion

-- #region 3. Guarded lifecycle state machine
-- projects.set_project_status(p_project_id, p_to_status, p_reason)
-- Rigid assertions (spec §3 "changing states to Active or Completed requires valid validation
-- conditions"):
--   • draft|on_hold -> active     : project must have a title and >= 1 stage defined.
--   • active|on_hold -> completed : every ticket must be terminal (completed/cancelled) AND no
--                                   escrow may still be held (funds must be settled first).
--   • active -> on_hold           : always allowed by the owner.
--   • draft|active|on_hold -> cancelled : always allowed by the owner.
--   • terminal states (completed/cancelled) are immutable.
-- Returns the new status. RAISE LOG lines carry the telemetry mandate's structured tags.
CREATE OR REPLACE FUNCTION projects.set_project_status(
    p_project_id uuid,
    p_to_status  project_status,
    p_reason     text DEFAULT NULL
)
RETURNS project_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, finance, org, auth
AS $$
DECLARE
    v_actor       uuid := auth.uid();
    v_from        project_status;
    v_owner       uuid;
    v_title       text;
    v_stage_count integer;
    v_open_ticket integer;
    v_held_escrow integer;
    v_started_at  timestamptz := clock_timestamp();
BEGIN
    RAISE LOG '[PROJECT_LIFECYCLE_RPC] set_project_status begin ts=% actor=% project=% target=%',
        v_started_at, v_actor, p_project_id, p_to_status;

    SELECT status, owner_user_id, title
        INTO v_from, v_owner, v_title
    FROM projects.projects
    WHERE id = p_project_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % not found.', p_project_id USING ERRCODE = 'no_data_found';
    END IF;

    -- Only the project owner may drive lifecycle transitions.
    IF v_owner IS DISTINCT FROM v_actor THEN
        RAISE WARNING '[PROJECT_LIFECYCLE_RPC] denied actor=% is not owner=% project=%',
            v_actor, v_owner, p_project_id;
        RAISE EXCEPTION 'Only the project owner may change the project status.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- No-op guard.
    IF v_from = p_to_status THEN
        RAISE LOG '[PROJECT_LIFECYCLE_RPC] no-op project=% already=%', p_project_id, p_to_status;
        RETURN v_from;
    END IF;

    -- Terminal states are immutable. `archived` is one of them: it is the soft delete, so re-opening
    -- an archived engagement behind its own status history would let a project that was put away
    -- reappear with no record of the decision being reversed. Restoring one is a deliberate act that
    -- belongs to its own path, not a side effect of setting a status.
    IF v_from IN (
        'completed'::project_status, 'cancelled'::project_status, 'archived'::project_status
    ) THEN
        RAISE EXCEPTION 'Project is % and can no longer change state.', v_from
            USING ERRCODE = 'check_violation';
    END IF;

    -- ----- Transition-specific validation -----
    IF p_to_status = 'active'::project_status THEN
        IF v_from NOT IN ('draft'::project_status, 'on_hold'::project_status) THEN
            RAISE EXCEPTION 'A project can only be activated from draft or on_hold (was %).', v_from
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_title IS NULL OR btrim(v_title) = '' THEN
            RAISE EXCEPTION 'A project must have a title before it can be activated.'
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*) INTO v_stage_count FROM projects.project_stages WHERE project_id = p_project_id;
        IF v_stage_count < 1 THEN
            RAISE EXCEPTION 'A project needs at least one stage before it can be activated.'
                USING ERRCODE = 'check_violation';
        END IF;

    ELSIF p_to_status = 'completed'::project_status THEN
        IF v_from NOT IN ('active'::project_status, 'on_hold'::project_status) THEN
            RAISE EXCEPTION 'A project can only be completed from active or on_hold (was %).', v_from
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*) INTO v_open_ticket
        FROM projects.tickets
        WHERE project_id = p_project_id
            AND status NOT IN ('completed'::ticket_status, 'cancelled'::ticket_status);
        IF v_open_ticket > 0 THEN
            RAISE EXCEPTION 'Cannot complete: % ticket(s) are still open. Resolve them first.', v_open_ticket
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*) INTO v_held_escrow
        FROM finance.escrows e
        JOIN projects.project_stages ps ON ps.id = e.project_stage_id
        WHERE ps.project_id = p_project_id AND e.status = 'held';
        IF v_held_escrow > 0 THEN
            RAISE EXCEPTION 'Cannot complete: % escrow hold(s) are unsettled. Release or refund them first.', v_held_escrow
                USING ERRCODE = 'check_violation';
        END IF;

    ELSIF p_to_status = 'on_hold'::project_status THEN
        IF v_from <> 'active'::project_status THEN
            RAISE EXCEPTION 'Only an active project can be put on hold (was %).', v_from
                USING ERRCODE = 'check_violation';
        END IF;

    ELSIF p_to_status = 'cancelled'::project_status THEN
        -- Allowed from any non-terminal state (already guarded above).
        NULL;

    ELSIF p_to_status = 'archived'::project_status THEN
        -- Archiving is the soft DELETE, so it is reachable from any non-terminal state and asks for
        -- nothing: an owner putting an engagement away must not be blocked by the same conditions
        -- that gate finishing it. It is deliberately one-way — `archived` joins the terminal set
        -- guarded above, so an archived project cannot be quietly re-activated behind its history.
        NULL;

    ELSE
        RAISE EXCEPTION 'Unsupported target status %.', p_to_status USING ERRCODE = 'check_violation';
    END IF;

    -- ----- Apply -----
    -- `archived_at` is written in the SAME statement as the status, never a second one.
    -- `ck_projects_archived_at` is bidirectional — it asserts `(status = 'archived') = (archived_at
    -- IS NOT NULL)` — so a two-statement archive fails on the first half before the second can run,
    -- and the row can never be caught disagreeing with itself.
    UPDATE projects.projects
    SET status = p_to_status,
        archived_at = CASE
            WHEN p_to_status = 'archived'::project_status THEN COALESCE(archived_at, now())
            ELSE NULL
        END,
        updated_at = now()
    WHERE id = p_project_id;

    INSERT INTO projects.project_status_history (project_id, actor_user_id, from_status, to_status, reason)
    VALUES (p_project_id, v_actor, v_from, p_to_status, p_reason);

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        p_project_id, v_actor, 'project_status_changed',
        jsonb_build_object('from', v_from, 'to', p_to_status, 'reason', p_reason),
        'projects.projects', p_project_id
    );

    RAISE LOG '[PROJECT_LIFECYCLE_RPC] set_project_status ok project=% % -> % duration_ms=%',
        p_project_id, v_from, p_to_status,
        round(extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000, 2);

    RETURN p_to_status;
END;
$$;

-- =============================================================================================
-- 0122_project_card_summary.sql
-- High-density project metadata for the Unified Card / Split-Pane Quick Inspector (spec §4).
--
-- projects.get_project_card_summary(uuid) returns a single jsonb blob with everything the inspection
-- canvas renders when a project card is clicked: lifecycle status, live Kanban column counts, the
-- next milestone deadline, and a pending-submission warning count. Guarded by has_project_access.
-- =============================================================================================

CREATE OR REPLACE FUNCTION projects.get_project_card_summary(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects, finance, org, auth
AS $$
DECLARE
    v_result jsonb;
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'You do not have access to this project.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT jsonb_build_object(
        'project_id', p.id,
        'title', p.title,
        'status', p.status,
        'currency', p.currency,
        'updated_at', p.updated_at,
        'stage_count', (SELECT count(*) FROM projects.project_stages ps WHERE ps.project_id = p.id),
        -- Live Kanban column distribution.
        'tickets', jsonb_build_object(
            'total',       (SELECT count(*) FROM projects.tickets t WHERE t.project_id = p.id),
            'backlog',     (SELECT count(*) FROM projects.tickets t WHERE t.project_id = p.id AND t.status = 'backlog'),
            'todo',        (SELECT count(*) FROM projects.tickets t WHERE t.project_id = p.id AND t.status = 'todo'),
            'in_progress', (SELECT count(*) FROM projects.tickets t WHERE t.project_id = p.id AND t.status IN ('claimed','in_progress')),
            'in_review',   (SELECT count(*) FROM projects.tickets t WHERE t.project_id = p.id AND t.status = 'in_review'),
            'completed',   (SELECT count(*) FROM projects.tickets t WHERE t.project_id = p.id AND t.status = 'completed'),
            'active',      (SELECT count(*) FROM projects.tickets t WHERE t.project_id = p.id AND t.status NOT IN ('completed','cancelled'))
        ),
        -- Pending-submission warning: deliverables awaiting client review across the project.
        'pending_submissions', (
            SELECT count(*)
            FROM projects.stage_submissions ss
            JOIN projects.project_stages ps ON ps.id = ss.project_stage_id
            WHERE ps.project_id = p.id AND ss.status = 'pending_review'
        ),
        -- Escrow still locked (unsettled money) on the project.
        'held_escrows', (
            SELECT count(*)
            FROM finance.escrows e
            JOIN projects.project_stages ps ON ps.id = e.project_stage_id
            WHERE ps.project_id = p.id AND e.status = 'held'
        ),
        -- Nearest upcoming milestone deadline (ticket due dates + stage file due dates).
        'next_milestone_at', (
            SELECT MIN(d) FROM (
                SELECT t.due_date AS d FROM projects.tickets t
                    WHERE t.project_id = p.id AND t.due_date IS NOT NULL AND t.due_date >= now()
                        AND t.status NOT IN ('completed','cancelled')
                UNION ALL
                SELECT ps.file_due_date AS d FROM projects.project_stages ps
                    WHERE ps.project_id = p.id AND ps.file_due_date IS NOT NULL AND ps.file_due_date >= now()
            ) deadlines
        )
    )
    INTO v_result
    FROM projects.projects p
    WHERE p.id = p_project_id;

    IF v_result IS NULL THEN
        RAISE EXCEPTION 'Project % not found.', p_project_id USING ERRCODE = 'no_data_found';
    END IF;

    RETURN v_result;
END;
$$;

-- =============================================================================================
-- 0308_stage_workspace_access.sql
-- US-006 AC1 · Workspace access control. The stage room/chat was previously gated only at the
-- *project* level (has_project_access) — any project participant could read a stage's chat. This
-- tightens the stage room to the talent actually assigned to that stage plus the client/owner side.
--
--   1. projects.has_stage_access(uuid) — owner/client-business OR active assignee (freelancer or team
--      member) of THAT stage.
--   2. comms.get_or_create_project_channel — guarded so only stage-accessors may open the stage room.
--   3. comms RLS — stage channels (stage_id NOT NULL) resolve access via has_stage_access; whole-
--      project channels (stage_id NULL) keep has_project_access. Applies to channels + messages.
--
-- Runs after 0202 (comms RLS) so these DROP/CREATE policy statements win.
-- =============================================================================================

-- #region 1. has_stage_access — stage-scoped membership
CREATE OR REPLACE FUNCTION projects.has_stage_access(p_stage_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_project uuid;
BEGIN
    SELECT ps.project_id INTO v_project FROM projects.project_stages ps WHERE ps.id = p_stage_id;
    IF v_project IS NULL THEN
        RETURN false;
    END IF;

    -- The paying side (owner / client-business member) reaches every stage room.
    IF projects.can_review_project(v_project) THEN
        RETURN true;
    END IF;

    -- A freelancer holding a live assignment on this stage.
    IF EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
        WHERE sa.project_stage_id = p_stage_id
            AND sa.assignee_type = 'freelancer'
            AND sa.freelancer_profile_id = auth.uid()
            AND sa.status NOT IN ('released', 'cancelled', 'declined')
    ) THEN
        RETURN true;
    END IF;

    -- An active member of a team holding a live assignment on this stage.
    IF EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
        JOIN org.team_members tm ON tm.team_id = sa.team_id
        WHERE sa.project_stage_id = p_stage_id
            AND sa.assignee_type = 'team'
            AND tm.user_id = auth.uid()
            AND tm.status = 'active'
            AND sa.status NOT IN ('released', 'cancelled', 'declined')
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

-- TRUE while the project is still in its protected phase (before the Projective Unlock). Defaults to
-- TRUE for an unknown project id so the filter fails safe (masks) rather than open.
CREATE OR REPLACE FUNCTION projects.is_protected_phase(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, projects
AS $$
    SELECT COALESCE(
        (SELECT handover_unlocked_at IS NULL FROM projects.projects WHERE id = p_project_id),
        true
    );
$$;
