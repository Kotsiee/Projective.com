-- #region Ticket board wiring, Frozen rule & finance read RPCs
-- Forward migration layered on top of 0007 (tickets + triggers), 0009 (finance engine) and 0115
-- (lifecycle RPCs). Three things:
--   1. Frozen rule (spec §4): filing a workload report now drops the ticket back to "New" and clears
--      the assignee (unifying it with the eviction primitive), instead of freezing it in place.
--   2. Read RPCs the ticket modal needs — a per-ticket escrow breakdown (Installment Monitor) and the
--      ticket history timeline. `finance.*` stays unexposed; these SECURITY DEFINER wrappers in the
--      exposed `projects` schema read it on the caller's behalf (guarded by projects.has_project_access).
--   3. projects.force_complete_stage — releases the current stage's installment and advances the ticket
--      to (and funds) the next required stage, or completes the ticket on the final stage. Distinct from
--      projects.complete_ticket (0115), which releases everything and terminates the ticket.

-- ---------------------------------------------------------------------------------------------
-- 1a. Frozen rule — filing a workload report drops the ticket to "New" and clears the assignee.
-- Nulling current_assignee_id cascades through the existing BEFORE/AFTER ticket triggers:
--   • projects.fn_ticket_claim_before  -> status := 'backlog', claimed_at := NULL
--   • projects.fn_ticket_escrow_sync   -> releases the held escrow back out to the freelancer
-- We additionally stamp hidden_until (the 48h client-response window the card counts down against)
-- and the originating report id. The card renders the striped "Frozen" overlay in the New column
-- while hidden_until is in the future.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.fn_open_workload_report()
RETURNS TRIGGER AS $$
DECLARE
    v_hours integer;
BEGIN
    SELECT (value #>> '{}')::integer INTO v_hours
    FROM security.platform_params
    WHERE key = 'workload_report_window_hours';
    v_hours := COALESCE(v_hours, 48);

    -- Clearing the assignee triggers the backlog reset + escrow release; we set the countdown window.
    UPDATE projects.tickets
    SET current_assignee_id = NULL,
        hidden_until = now() + make_interval(hours => v_hours),
        workload_report_id = NEW.id
    WHERE id = NEW.ticket_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, security, org, auth;

-- 1b. Expiry sweep — the ticket is already back in the backlog (assignee cleared on freeze), so on
-- expiry we simply lift the countdown, resolve the report and apply the client penalty. (Previously
-- this resumed the ticket to in_progress, which no longer applies now that freezing evicts.)
CREATE OR REPLACE FUNCTION projects.fn_resolve_expired_workload_reports()
RETURNS integer AS $$
DECLARE
    r record;
    v_sev numeric;
    v_count integer := 0;
    v_subject_type text;
    v_subject_id uuid;
BEGIN
    SELECT (value #>> '{}')::numeric INTO v_sev
    FROM security.platform_params WHERE key = 'client_no_adjust_penalty';
    v_sev := COALESCE(v_sev, 0);

    FOR r IN
        SELECT wr.id AS report_id, wr.ticket_id, p.owner_user_id, p.client_business_id
        FROM projects.ticket_workload_reports wr
        JOIN projects.tickets t ON t.id = wr.ticket_id
        JOIN projects.projects p ON p.id = t.project_id
        WHERE wr.status = 'open'::projects.workload_report_status
            AND wr.hidden_until IS NOT NULL
            AND wr.hidden_until <= now()
    LOOP
        UPDATE projects.ticket_workload_reports
        SET status = 'expired_penalized'::projects.workload_report_status, resolved_at = now()
        WHERE id = r.report_id;

        -- Ticket already sits in the backlog with no assignee; just lift the countdown.
        UPDATE projects.tickets
        SET hidden_until = NULL
        WHERE id = r.ticket_id;

        IF r.client_business_id IS NOT NULL THEN
            v_subject_type := 'business'; v_subject_id := r.client_business_id;
        ELSE
            v_subject_type := 'user'; v_subject_id := r.owner_user_id;
        END IF;

        INSERT INTO security.penalties (
            subject_type, subject_id, penalty_type, source_type, source_id, severity, reason
        )
        VALUES (
            v_subject_type, v_subject_id, 'trust_score', 'workload_report', r.report_id, v_sev,
            'Client failed to adjust workload intensity within the required window.'
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, security;

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

-- ---------------------------------------------------------------------------------------------
-- 3. projects.force_complete_stage(p_ticket_id)
-- Client override that approves the current phase: release the held installment for the current
-- stage, then advance to the next required stage and fund its installment — or, on the final stage,
-- complete the whole ticket. Returns the new current_stage_id (NULL once the ticket is completed).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.force_complete_stage(p_ticket_id uuid)
RETURNS uuid AS $$
DECLARE
    v_current uuid;
    v_stages jsonb;
    v_project_id uuid;
    v_next uuid;
    v_current_ord int;
BEGIN
    SELECT current_stage_id, required_stages, project_id
    INTO v_current, v_stages, v_project_id
    FROM projects.tickets WHERE id = p_ticket_id;

    IF v_project_id IS NULL THEN
        RAISE EXCEPTION 'Ticket % not found.', p_ticket_id;
    END IF;
    IF NOT projects.has_project_access(v_project_id) THEN
        RAISE EXCEPTION 'You do not have permission to complete this stage.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Resolve the next required stage after the current one (by declared order).
    SELECT COALESCE((e->>'order')::int, 0) INTO v_current_ord
    FROM jsonb_array_elements(COALESCE(v_stages, '[]'::jsonb)) e
    WHERE (e->>'stage_id')::uuid = v_current
    LIMIT 1;

    SELECT (e->>'stage_id')::uuid INTO v_next
    FROM jsonb_array_elements(COALESCE(v_stages, '[]'::jsonb)) e
    WHERE COALESCE((e->>'order')::int, 0) > COALESCE(v_current_ord, -1)
    ORDER BY COALESCE((e->>'order')::int, 0) ASC
    LIMIT 1;

    IF v_next IS NULL THEN
        -- Final stage: completing the ticket releases the last held installment via the escrow-sync
        -- trigger (status -> completed), which also stamps payment_status = 'released'.
        UPDATE projects.tickets
        SET status = 'completed'::ticket_status, updated_at = now()
        WHERE id = p_ticket_id;
        RETURN NULL;
    END IF;

    -- Intermediate stage: release the current installment, move to the next stage and fund it.
    PERFORM finance.fn_release_ticket_escrow(p_ticket_id);

    UPDATE projects.tickets
    SET current_stage_id = v_next,
        status = 'in_progress'::ticket_status,
        updated_at = now()
    WHERE id = p_ticket_id;

    PERFORM finance.fn_hold_ticket_escrow(p_ticket_id);
    RETURN v_next;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, auth;

-- Execute privilege: like the sibling lifecycle RPCs in 0115, these rely on Postgres' default
-- EXECUTE-to-PUBLIC grant (no schema-wide function grant is issued in 0200_permissions.sql); the
-- SECURITY DEFINER + projects.has_project_access guards above are what enforce per-caller authority.
-- #endregion
