-- ============================================================================
-- 00001120 functions projects ticket lifecycle
-- Consolidated verbatim from: 0115_ticket_lifecycle_rpcs.sql, 0117_ticket_board_and_finance.sql, 0121_kanban_sync.sql, 0310_ticket_automation_engine.sql
-- ============================================================================

-- ---------------------------------------------------------------------------------------------
-- projects.complete_ticket(p_ticket_id)
-- Marks a ticket complete and releases its held escrow to the assigned payee (fee/bonus/team
-- splits are applied inside finance.fn_release_ticket_escrow).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.complete_ticket(p_ticket_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE projects.tickets
  SET status = 'completed'::ticket_status, updated_at = now()
  WHERE id = p_ticket_id;

  PERFORM finance.fn_release_ticket_escrow(p_ticket_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance;

-- ---------------------------------------------------------------------------------------------
-- projects.delete_ticket(p_ticket_id)
-- Force-majeure deletion:
--   • Before claim  -> purge immediately (no escrow held, nothing to release).
--   • After claim   -> release escrow in full to the freelancer as compensation, then purge.
-- finance.escrows.ticket_id is ON DELETE SET NULL, so released escrow rows survive as an
-- auditable record after the ticket row is removed.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.delete_ticket(p_ticket_id uuid)
RETURNS void AS $$
DECLARE
  v_assignee uuid;
BEGIN
  SELECT current_assignee_id INTO v_assignee FROM projects.tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_assignee IS NOT NULL THEN
    PERFORM finance.fn_release_ticket_escrow(p_ticket_id);
  END IF;

  DELETE FROM projects.tickets WHERE id = p_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance;

-- ---------------------------------------------------------------------------------------------
-- projects.release_ticket_to_backlog(p_ticket_id)
-- A freelancer is removed from a stage/project while actively working: release any locked
-- escrow to them, reset the ticket to "New" (backlog) and return it to the open pool.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.release_ticket_to_backlog(p_ticket_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM finance.fn_release_ticket_escrow(p_ticket_id);

  UPDATE projects.tickets
  SET status = 'backlog'::ticket_status,
      current_assignee_id = NULL,
      claimed_at = NULL,
      updated_at = now()
  WHERE id = p_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance;

-- ---------------------------------------------------------------------------------------------
-- 2a. projects.get_ticket_finance(p_ticket_id)
-- Per-ticket escrow breakdown that powers the modal's Installment Monitor. Each required stage is
-- one installment; its price mirrors the escrow-hold math in finance.fn_hold_ticket_escrow
-- (COALESCE(ticket.unit_price_cents, stage.unit_price_cents)). Returns a single row.
--   total_cost_cents   = Σ installment amounts
--   paid_to_date_cents = tickets.total_amount_paid (net payouts already released)
--   locked_escrow_cents= Σ finance.escrows.amount_cents currently 'held' for the ticket
--   remaining_cents    = max(total − paid − locked, 0)
--   installments       = [{ stage_id, label, amount_cents, state: paid|escrowed|pending }]
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.get_ticket_finance(p_ticket_id uuid)
RETURNS TABLE (
    total_cost_cents    bigint,
    paid_to_date_cents  bigint,
    locked_escrow_cents bigint,
    remaining_cents     bigint,
    currency            text,
    installments        jsonb
) AS $$
DECLARE
    v_project_id uuid;
BEGIN
    SELECT project_id INTO v_project_id FROM projects.tickets WHERE id = p_ticket_id;
    IF v_project_id IS NULL THEN
        RAISE EXCEPTION 'Ticket % not found.', p_ticket_id;
    END IF;
    IF NOT projects.has_project_access(v_project_id) THEN
        RAISE EXCEPTION 'You do not have access to this ticket.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH tk AS (
        SELECT id, required_stages, unit_price_cents, total_amount_paid
        FROM projects.tickets WHERE id = p_ticket_id
    ),
    priced AS (
        SELECT
            (elem->>'stage_id')::uuid AS stage_id,
            COALESCE((elem->>'order')::int, 0) AS ord,
            ps.name AS label,
            COALESCE(tk.unit_price_cents, ps.unit_price_cents, 0)::bigint AS amount_cents,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM finance.escrows e
                    WHERE e.ticket_id = tk.id AND e.project_stage_id = (elem->>'stage_id')::uuid
                      AND e.status = 'released'
                ) THEN 'paid'
                WHEN EXISTS (
                    SELECT 1 FROM finance.escrows e
                    WHERE e.ticket_id = tk.id AND e.project_stage_id = (elem->>'stage_id')::uuid
                      AND e.status = 'held'
                ) THEN 'escrowed'
                ELSE 'pending'
            END AS state
        FROM tk, jsonb_array_elements(tk.required_stages) elem
        LEFT JOIN projects.project_stages ps ON ps.id = (elem->>'stage_id')::uuid
    ),
    totals AS (
        SELECT
            COALESCE((SELECT SUM(amount_cents) FROM priced), 0)::bigint AS total_cost,
            COALESCE((SELECT total_amount_paid FROM tk), 0)::bigint AS paid,
            COALESCE((
                SELECT SUM(e.amount_cents) FROM finance.escrows e
                WHERE e.ticket_id = p_ticket_id AND e.status = 'held'
            ), 0)::bigint AS locked
    )
    SELECT
        totals.total_cost,
        totals.paid,
        totals.locked,
        GREATEST(totals.total_cost - totals.paid - totals.locked, 0)::bigint,
        COALESCE((SELECT p.currency FROM projects.projects p WHERE p.id = v_project_id), 'USD'),
        COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'stage_id', stage_id,
                    'label', COALESCE(label, 'Stage'),
                    'amount_cents', amount_cents,
                    'state', state
                ) ORDER BY ord
            ) FROM priced
        ), '[]'::jsonb)
    FROM totals;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, auth;

-- ---------------------------------------------------------------------------------------------
-- 2b. projects.get_ticket_timeline(p_ticket_id)
-- Ordered ticket history for the modal's Timeline tab, with the actor's display name/avatar joined.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.get_ticket_timeline(p_ticket_id uuid)
RETURNS TABLE (
    id                 uuid,
    action_type        text,
    previous_stage_id  uuid,
    new_stage_id       uuid,
    previous_status    text,
    new_status         text,
    changes            jsonb,
    created_at         timestamptz,
    actor_id           uuid,
    actor_name         text,
    actor_avatar_file_id uuid
) AS $$
DECLARE
    v_project_id uuid;
BEGIN
    -- Qualify the lookup: this function's RETURNS TABLE declares an OUT column `id`, which would
    -- otherwise make a bare `WHERE id = ...` ambiguous against the table column.
    SELECT t.project_id INTO v_project_id FROM projects.tickets t WHERE t.id = p_ticket_id;
    IF v_project_id IS NULL THEN
        RAISE EXCEPTION 'Ticket % not found.', p_ticket_id;
    END IF;
    IF NOT projects.has_project_access(v_project_id) THEN
        RAISE EXCEPTION 'You do not have access to this ticket.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    SELECT
        h.id,
        h.action_type,
        h.previous_stage_id,
        h.new_stage_id,
        h.previous_status::text,
        h.new_status::text,
        h.changes,
        h.created_at,
        h.actor_id,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''), up.username) AS actor_name,
        up.avatar_file_id
    FROM projects.ticket_history h
    LEFT JOIN org.users_public up ON up.user_id = h.actor_id
    WHERE h.ticket_id = p_ticket_id
    ORDER BY h.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, org, auth;

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

-- #endregion

-- #region 2. move_ticket — guarded column transition + milestone hook
-- Moves a ticket to a new column (and optionally a new stage). Guards:
--   • Any transition        -> caller must have project access (has_project_access).
--   • -> Done (completed)    -> caller must additionally hold review authority (can_review_project):
--                              a freelancer cannot self-confirm milestone delivery / release escrow.
-- The status write cascades through the existing ticket triggers (escrow release on completed,
-- submission ledger on in_review). Every move is written to projects.ticket_history for the timeline.
--
-- p_sort_order carries the card's new position within its destination lane, and is DEFAULTED so the
-- three-argument call sites that predate it keep resolving to this same function. It is honoured
-- only for a move into `backlog`: projects.fn_ticket_ordering_guard RAISES on any sort_order change
-- outside that lane, because every other column is ordered by updated_at rather than by hand, so
-- forwarding a position there would turn an ordinary drag into an error the board cannot explain.
CREATE OR REPLACE FUNCTION projects.move_ticket(
    p_ticket_id   uuid,
    p_to_status   ticket_status,
    p_to_stage_id uuid DEFAULT NULL,
    p_sort_order  integer DEFAULT NULL
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
        sort_order = CASE
            WHEN p_sort_order IS NOT NULL AND p_to_status = 'backlog'::ticket_status THEN p_sort_order
            ELSE sort_order
        END,
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

-- Reworked self-claim (supersedes 0115): a freelancer may only self-claim when the stage is in
-- 'open_pull' mode; every other mode routes work through the owner/system RPCs below. Capacity is
-- always enforced. Signature and return value (escrow id) are unchanged.
CREATE OR REPLACE FUNCTION projects.claim_ticket(p_ticket_id uuid, p_assignee_id uuid)
RETURNS uuid AS $$
DECLARE
    v_stage uuid;
    v_mode  projects.assignment_routing_mode;
BEGIN
    SELECT current_stage_id INTO v_stage FROM projects.tickets WHERE id = p_ticket_id;
    IF FOUND AND v_stage IS NOT NULL THEN
        SELECT assignment_mode INTO v_mode FROM projects.project_stages WHERE id = v_stage;
    END IF;
    v_mode := COALESCE(v_mode, 'open_pull'::projects.assignment_routing_mode);

    IF v_mode <> 'open_pull'::projects.assignment_routing_mode THEN
        RAISE EXCEPTION 'This stage uses % assignment; tickets here are routed by the project owner, not self-claimed.',
            replace(v_mode::text, '_', ' ')
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN projects.fn_assign_ticket_core(p_ticket_id, p_assignee_id, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, security, auth;
