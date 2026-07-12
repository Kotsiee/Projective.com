-- =============================================================================================
-- 0121_kanban_sync.sql
-- Automated Kanban State Synchronization (spec §3 "Automated Kanban State Synchronization").
--
-- Two coupled pieces:
--   1. projects.fn_ticket_review_submission — an AFTER UPDATE trigger that, the moment a ticket
--      enters the "Review" column (in_review), auto-generates a submission ledger row for the
--      current stage (unless the freelancer already filed one via submit_deliverable). This makes
--      "moving a card to Review" always produce a reviewable deliverable record.
--   2. projects.move_ticket — the guarded column-transition RPC the board calls. Moving a card to
--      "Done" (completed) requires client/owner review authority (projects.can_review_project) and
--      confirms milestone delivery: the existing escrow-sync trigger releases the installment, and
--      we log the confirmation to the ticket history + activity feed.
--
-- Column<->status mapping: Backlog=backlog, To Do=todo, In Progress=in_progress/claimed,
-- Review=in_review, Done=completed. Columns are the ticket_status enum (0007).
-- =============================================================================================

-- #region 1. Review-column -> submission ledger trigger
CREATE OR REPLACE FUNCTION projects.fn_ticket_review_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_number integer;
BEGIN
    -- Only act on the transition *into* Review.
    IF NEW.status <> 'in_review'::ticket_status OR OLD.status = 'in_review'::ticket_status THEN
        RETURN NULL;
    END IF;

    -- Need a stage to file against and an assignee to attribute the deliverable to.
    IF NEW.current_stage_id IS NULL OR NEW.current_assignee_id IS NULL THEN
        RAISE LOG '[KANBAN_TRIGGER] review->ledger skipped ticket=% stage=% assignee=% (missing context)',
            NEW.id, NEW.current_stage_id, NEW.current_assignee_id;
        RETURN NULL;
    END IF;

    -- Idempotent with projects.submit_deliverable: skip when a pending submission already exists.
    IF EXISTS (
        SELECT 1 FROM projects.stage_submissions ss
        WHERE ss.ticket_id = NEW.id
            AND ss.project_stage_id = NEW.current_stage_id
            AND ss.status = 'pending_review'
    ) THEN
        RAISE LOG '[KANBAN_TRIGGER] review->ledger skipped ticket=% (pending submission exists)', NEW.id;
        RETURN NULL;
    END IF;

    SELECT COALESCE(MAX(number), 0) + 1 INTO v_number
    FROM projects.stage_submissions WHERE project_stage_id = NEW.current_stage_id;

    INSERT INTO projects.stage_submissions
        (project_stage_id, ticket_id, submitted_by, title, description, checked_item_ids, status, number)
    VALUES
        (NEW.current_stage_id, NEW.id, NEW.current_assignee_id,
         'Review: ' || NEW.title, '{}'::jsonb, '[]'::jsonb, 'pending_review', v_number);

    RAISE LOG '[KANBAN_TRIGGER] review->ledger created submission for ticket=% stage=% number=%',
        NEW.id, NEW.current_stage_id, v_number;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_review_submission ON projects.tickets;
CREATE TRIGGER trg_ticket_review_submission
    AFTER UPDATE OF status ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_review_submission();
-- #endregion

-- #region 2. move_ticket — guarded column transition + milestone hook
-- Moves a ticket to a new column (and optionally a new stage). Guards:
--   • Any transition        -> caller must have project access (has_project_access).
--   • -> Done (completed)    -> caller must additionally hold review authority (can_review_project):
--                              a freelancer cannot self-confirm milestone delivery / release escrow.
-- The status write cascades through the existing ticket triggers (escrow release on completed,
-- submission ledger on in_review). Every move is written to projects.ticket_history for the timeline.
CREATE OR REPLACE FUNCTION projects.move_ticket(
    p_ticket_id   uuid,
    p_to_status   ticket_status,
    p_to_stage_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, finance, org, auth
AS $$
DECLARE
    v_actor      uuid := auth.uid();
    v_project    uuid;
    v_from_status ticket_status;
    v_from_stage uuid;
    v_to_stage   uuid;
    v_result     jsonb;
    v_started_at timestamptz := clock_timestamp();
BEGIN
    RAISE LOG '[KANBAN_API] move_ticket begin ts=% actor=% ticket=% target=% stage=%',
        v_started_at, v_actor, p_ticket_id, p_to_status, p_to_stage_id;

    SELECT t.project_id, t.status, t.current_stage_id
        INTO v_project, v_from_status, v_from_stage
    FROM projects.tickets t WHERE t.id = p_ticket_id;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Ticket % not found.', p_ticket_id USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT projects.has_project_access(v_project) THEN
        RAISE EXCEPTION 'You do not have access to this ticket.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Milestone-delivery authority: only the client/owner may drop a card into Done (releases escrow).
    IF p_to_status = 'completed'::ticket_status AND NOT projects.can_review_project(v_project) THEN
        RAISE WARNING '[KANBAN_API] denied actor=% cannot confirm delivery on project=%', v_actor, v_project;
        RAISE EXCEPTION 'Only the client/owner may move a ticket to Done (confirm milestone delivery).'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_to_stage := COALESCE(p_to_stage_id, v_from_stage);
    IF p_to_stage_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM projects.project_stages ps WHERE ps.id = p_to_stage_id AND ps.project_id = v_project) THEN
        RAISE EXCEPTION 'Stage % does not belong to project %.', p_to_stage_id, v_project USING ERRCODE = 'check_violation';
    END IF;

    UPDATE projects.tickets
    SET status = p_to_status,
        current_stage_id = v_to_stage,
        updated_at = now()
    WHERE id = p_ticket_id;

    -- Timeline entry for the move.
    INSERT INTO projects.ticket_history
        (ticket_id, actor_id, action_type, previous_stage_id, new_stage_id, previous_status, new_status, changes)
    VALUES
        (p_ticket_id, v_actor,
         CASE WHEN v_from_stage IS DISTINCT FROM v_to_stage THEN 'stage_moved' ELSE 'status_changed' END,
         v_from_stage, v_to_stage, v_from_status, p_to_status,
         jsonb_build_object('from_status', v_from_status, 'to_status', p_to_status));

    -- Milestone-delivery hook on Done.
    IF p_to_status = 'completed'::ticket_status THEN
        INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
        VALUES (
            v_project, v_actor, 'milestone_confirmed',
            jsonb_build_object('ticket_id', p_ticket_id, 'stage_id', v_to_stage),
            'projects.tickets', p_ticket_id
        );
        RAISE LOG '[KANBAN_API] milestone confirmed ticket=% by actor=% (escrow released via sync trigger)',
            p_ticket_id, v_actor;
    END IF;

    SELECT to_jsonb(t.*) INTO v_result FROM projects.tickets t WHERE t.id = p_ticket_id;

    RAISE LOG '[KANBAN_API] move_ticket ok ticket=% % -> % duration_ms=%',
        p_ticket_id, v_from_status, p_to_status,
        round(extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000, 2);

    RETURN v_result;
END;
$$;
-- #endregion
