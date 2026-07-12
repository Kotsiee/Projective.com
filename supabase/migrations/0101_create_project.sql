CREATE OR REPLACE FUNCTION projects.create_project(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, auth
AS $$
DECLARE
    v_project_id uuid;
    v_owner_id uuid;
    v_business_id uuid;
    v_stage jsonb;
    v_attachment_id text;
BEGIN
    -- 1. Identity Verification
    v_owner_id := auth.uid();
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_project_id := (payload->>'id')::uuid;

    -- Resolve the acting organisation context. A project may be owned personally
    -- (client_business_id NULL) or by a business the caller is an active member of.
    v_business_id := NULLIF(payload->>'client_business_id', '')::uuid;
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

    -- 2. Insert into core projects relation. The AFTER-INSERT triggers on
    -- projects.projects (search sync + entity project counts) are correct and must
    -- run here; they are intentionally NOT suppressed.
    INSERT INTO projects.projects (
        id,
        owner_user_id,
        client_business_id,
        title,
        description,
        description_text,
        format,
        industry_category_id,
        visibility,
        currency,
        timeline_preset,
        target_project_start_date,
        ip_ownership_mode,
        nda_required,
        portfolio_display_rights,
        location_restriction,
        language_requirement,
        screening_questions
    ) VALUES (
        v_project_id,
        v_owner_id,
        v_business_id,
        payload->>'title',
        COALESCE(payload->'description', '{}'::jsonb),
        COALESCE(payload->>'description_text', ''),
        COALESCE((payload->>'format')::project_format, 'pipeline'::project_format),
        NULLIF(payload->>'industry_category_id', '')::uuid,
        COALESCE((payload->>'visibility')::visibility, 'public'::visibility),
        COALESCE(payload->>'currency', 'USD'),
        COALESCE((payload->>'timeline_preset')::timeline_preset, 'sequential'::timeline_preset),
        (payload->>'target_project_start_date')::timestamptz,
        COALESCE((payload->>'ip_ownership_mode')::ip_option_mode, 'exclusive_transfer'::ip_option_mode),
        COALESCE((payload->>'nda_required')::boolean, false),
        COALESCE((payload->>'portfolio_display_rights')::portfolio_rights, 'allowed'::portfolio_rights),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(payload->'location_restriction')), '{}'::text[]),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(payload->'language_requirement')), '{}'::text[]),
        COALESCE(payload->'screening_questions', '[]'::jsonb)
    );

    -- 3. Insert nested stages. Persist the per-stage IP override (AC4) and the
    -- timeline-sequencing fields (AC5) so the CREATE-framework builder round-trips.
    -- Stage rows are inserted first with their (optional) client-supplied ids, then a
    -- second pass wires start_dependency_stage_id so intra-batch references resolve
    -- regardless of stage order.
    IF payload ? 'stages' AND jsonb_typeof(payload->'stages') = 'array' THEN
        FOR v_stage IN SELECT * FROM jsonb_array_elements(payload->'stages')
        LOOP
            INSERT INTO projects.project_stages (
                id,
                project_id,
                name,
                description,
                description_text,
                sort_order,
                file_upload_required,
                default_tasks,
                skills,
                start_trigger_type,
                fixed_start_date,
                start_dependency_lag_days,
                hire_trigger_active,
                file_revisions_allowed,
                file_duration_mode,
                file_duration_days,
                file_due_date,
                session_duration_minutes,
                session_count,
                session_preferred_days,
                session_end_date,
                ip_ownership_override,
                ip_mode
            ) VALUES (
                COALESCE(NULLIF(v_stage->>'id', '')::uuid, gen_random_uuid()),
                v_project_id,
                COALESCE(v_stage->>'name', v_stage->>'title'),
                COALESCE(v_stage->'description', '{}'::jsonb),
                COALESCE(v_stage->>'description_text', ''),
                COALESCE((v_stage->>'sort_order')::integer, 0),
                COALESCE((v_stage->>'file_upload_required')::boolean, false),
                COALESCE(v_stage->'default_tasks', '[]'::jsonb),
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_stage->'skills')), '{}'::text[]),
                COALESCE((v_stage->>'start_trigger_type')::start_trigger_type, 'on_project_start'::start_trigger_type),
                (v_stage->>'fixed_start_date')::timestamptz,
                COALESCE((v_stage->>'start_dependency_lag_days')::integer, 0),
                COALESCE((v_stage->>'hire_trigger_active')::boolean, true),
                COALESCE((v_stage->>'file_revisions_allowed')::integer, 0),
                v_stage->>'file_duration_mode',
                (v_stage->>'file_duration_days')::integer,
                (v_stage->>'file_due_date')::timestamptz,
                (v_stage->>'session_duration_minutes')::integer,
                COALESCE((v_stage->>'session_count')::integer, 1),
                CASE
                    WHEN v_stage ? 'session_preferred_days'
                    THEN ARRAY(SELECT jsonb_array_elements_text(v_stage->'session_preferred_days'))
                    ELSE NULL
                END,
                (v_stage->>'session_end_date')::timestamptz,
                NULLIF(v_stage->>'ip_ownership_override', '')::ip_option_mode,
                COALESCE(
                    NULLIF(v_stage->>'ip_mode', '')::ip_option_mode,
                    NULLIF(v_stage->>'ip_ownership_override', '')::ip_option_mode,
                    'exclusive_transfer'::ip_option_mode
                )
            );
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

    -- 4. Insert Global Attachments
    IF payload ? 'global_attachments' AND jsonb_typeof(payload->'global_attachments') = 'array' THEN
        FOR v_attachment_id IN SELECT * FROM jsonb_array_elements_text(payload->'global_attachments')
        LOOP
            INSERT INTO projects.project_attachments (
                project_id,
                attachment_id
            ) VALUES (
                v_project_id,
                v_attachment_id::uuid
            );
        END LOOP;
    END IF;

    RETURN v_project_id;
END;
$$;
