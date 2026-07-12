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
