-- ============================================================================
-- 00001110 functions projects ticket guards
-- Consolidated verbatim from: 0007_projects_tables.sql
-- ============================================================================

-- #endregion

-- #region 4. Conditional Due Date Rule Enforcement
CREATE OR REPLACE FUNCTION projects.fn_enforce_ticket_due_date()
RETURNS TRIGGER AS $$
DECLARE
    v_allow_deadlines boolean;
BEGIN
    -- Query the finance configuration on the parent project
    SELECT allow_deadline_bonuses INTO v_allow_deadlines 
    FROM projects.projects 
    WHERE id = NEW.project_id;

    -- If a due date is specified but the project finance settings forbid it, raise an error
    IF NEW.due_date IS NOT NULL AND (v_allow_deadlines IS NULL OR NOT v_allow_deadlines) THEN
        RAISE EXCEPTION 'Due dates can only be set if the client has agreed to deadline bonus terms under project finance settings.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- #endregion

-- #region 4b. Ticket Lifecycle State Machine

-- Keep updated_at fresh so "order by updated_at DESC" (non-backlog stages) stays accurate.
CREATE OR REPLACE FUNCTION projects.fn_ticket_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Creation with only a title is allowed; a purchase/checkout transition requires a description.
CREATE OR REPLACE FUNCTION projects.fn_enforce_ticket_checkout_desc()
RETURNS TRIGGER AS $$
DECLARE
    v_entering_checkout boolean;
BEGIN
    v_entering_checkout :=
        (NEW.payment_status = 'escrow_funded'::payment_status
            AND OLD.payment_status IN ('unpaid'::payment_status, 'needs_funding'::payment_status))
        OR (NEW.status IN ('claimed'::ticket_status, 'in_progress'::ticket_status)
            AND OLD.status NOT IN ('claimed'::ticket_status, 'in_progress'::ticket_status));

    IF v_entering_checkout THEN
        IF (NEW.text_description IS NULL OR btrim(NEW.text_description) = '')
            AND (NEW.description IS NULL OR NEW.description = '{}'::jsonb) THEN
            RAISE EXCEPTION 'A ticket must have a description before it can be purchased or claimed.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Manual sort_order is only valid in the backlog ("New") stage; other stages auto-order by updated_at.
CREATE OR REPLACE FUNCTION projects.fn_ticket_ordering_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sort_order IS DISTINCT FROM OLD.sort_order
        AND NEW.status <> 'backlog'::ticket_status THEN
        RAISE EXCEPTION 'Manual ticket ordering is only permitted in the backlog (New) stage.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Once claimed, a ticket's terms bind both parties and neither rewrites them alone (Decision #291;
-- PRODUCT_SPEC §Editing & Reordering Restrictions, §Post-Onboarding Immutability). The terms are
-- its title, description, price, stage sequence and W_i: the client may not change what the
-- freelancer agreed to deliver, and the assignee — the payee — may not change what the client
-- agreed to pay for. finance.fn_hold_ticket_escrow prices a hold from unit_price_cents (else the
-- current stage's price) and the Chain Reaction holds the next required stage the moment the
-- client approves one, so a payee who could edit either column chose the figure the client's
-- wallet was next held at. For the same reason only review authority moves a claimed ticket's
-- current_stage_id, on any path: the hold reads that stage's price and the Chain Reaction counts
-- the next installment from it, and move_ticket admits anyone with project access — the
-- assignee, or another freelancer on the project. One person on both sides (the owner working
-- their own ticket, as on a personal project) has nobody to be held to; an admin and the platform
-- (no auth.uid()) are not gated.
--
-- A ticket is written by its client: an INSERT naming an assignee needs review authority, or the
-- payee could put a ticket of their own pricing into the client's project. payment_status and
-- total_amount_paid are the escrow functions' bookkeeping, and the auto-fund drain holds any
-- ticket marked needs_funding, so a client role's own statement may not move them. INVOKER on
-- purpose: inside a SECURITY DEFINER door `current_user` is its owner, so the escrow functions
-- that keep those columns pass and only a statement PostgREST runs as anon/authenticated is
-- judged.
--
-- A workload report turns the W_i rule round for its window (Decision #290): the work is
-- suspended until the client answers, so the reporting assignee may neither resume the ticket nor
-- move the W_i it disputes, and raising W_i becomes the one edit the client may make
-- (projects.fn_adjust_workload_report).
CREATE OR REPLACE FUNCTION projects.fn_ticket_immutability_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_payee boolean;
    v_reviewer boolean;
BEGIN
    IF current_user IN ('anon', 'authenticated') THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.payment_status IS DISTINCT FROM 'unpaid'::payment_status
                OR NEW.total_amount_paid IS DISTINCT FROM 0 THEN
                RAISE EXCEPTION USING
                    ERRCODE = '42501',
                    MESSAGE = 'A new ticket starts unpaid; its payment state is kept by its escrow.';
            END IF;
        ELSIF NEW.payment_status IS DISTINCT FROM OLD.payment_status
            OR NEW.total_amount_paid IS DISTINCT FROM OLD.total_amount_paid THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'A ticket''s payment state is kept by its escrow and cannot be written '
                    || 'directly.';
        END IF;
    END IF;

    IF v_uid IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
        AND OLD.status = 'reported_hidden'::ticket_status
        AND v_uid = OLD.current_assignee_id
        AND (NEW.status IS DISTINCT FROM OLD.status
            OR NEW.workload_intensity IS DISTINCT FROM OLD.workload_intensity) THEN
        RAISE EXCEPTION 'Work on this ticket is suspended until the client answers your workload report.'
            USING ERRCODE = '42501';
    END IF;

    IF security.is_admin() THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.current_assignee_id IS NOT NULL
            AND NOT projects.can_review_project(NEW.project_id) THEN
            RAISE EXCEPTION 'A ticket is written by its client; a freelancer claims it.'
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.current_assignee_id IS NULL THEN
        RETURN NEW;
    END IF;
    v_payee := v_uid = OLD.current_assignee_id;
    v_reviewer := projects.can_review_project(OLD.project_id);
    IF v_payee AND v_reviewer THEN
        RETURN NEW;
    END IF;

    IF NEW.current_stage_id IS DISTINCT FROM OLD.current_stage_id AND NOT v_reviewer THEN
        RAISE EXCEPTION 'Only the client moves a claimed ticket to another stage.'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.title IS DISTINCT FROM OLD.title
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.text_description IS DISTINCT FROM OLD.text_description
        OR NEW.unit_price_cents IS DISTINCT FROM OLD.unit_price_cents
        OR NEW.required_stages IS DISTINCT FROM OLD.required_stages
        OR (NEW.workload_intensity IS DISTINCT FROM OLD.workload_intensity
            AND NOT (NOT v_payee
                AND OLD.status = 'reported_hidden'::ticket_status
                AND NEW.workload_intensity > OLD.workload_intensity)) THEN
        IF v_payee THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'You claimed this ticket on its client''s terms: its content, price, '
                    || 'stages and workload stay as the client set them.';
        END IF;
        RAISE EXCEPTION
            'This ticket has been claimed by a freelancer; its content is locked to the client.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, projects, security, auth;

-- Stamp claim time on claim; on freelancer removal, reset to backlog (re-enter the "New" backlog).
CREATE OR REPLACE FUNCTION projects.fn_ticket_claim_before()
RETURNS TRIGGER AS $$
BEGIN
    -- Claim: freelancer attaches themselves (or status flips to 'claimed')
    IF (OLD.current_assignee_id IS NULL AND NEW.current_assignee_id IS NOT NULL)
        OR (OLD.status <> 'claimed'::ticket_status AND NEW.status = 'claimed'::ticket_status) THEN
        NEW.claimed_at := now();
    END IF;

    -- Freelancer removed mid-work: send the ticket back to the backlog.
    IF OLD.current_assignee_id IS NOT NULL AND NEW.current_assignee_id IS NULL THEN
        NEW.status := 'backlog'::ticket_status;
        NEW.claimed_at := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Escrow money movement (funds delegated to finance.* SECURITY DEFINER helpers in 0009), and the
-- work-start gate: no hold, no work (Decision #165). On the trigger rather than in each RPC so every
-- path into work — claim_ticket, the owner's routing RPCs, move_ticket and a direct row write under
-- RLS — meets the same refusal.
CREATE OR REPLACE FUNCTION projects.fn_ticket_escrow_sync()
RETURNS TRIGGER AS $$
BEGIN
    -- A personal project carries no money, so its work moves without a hold (Decision #192).
    IF projects.fn_is_personal_project(NEW.project_id) THEN
        RETURN NULL;
    END IF;

    -- Claim -> move ticket funds into the escrow pool (held). Refuses (PF402) when the hold can't be
    -- made, which aborts the claim. Without an assignee there is no payee; the gate below refuses.
    IF ((OLD.current_assignee_id IS NULL AND NEW.current_assignee_id IS NOT NULL)
        OR (OLD.status <> 'claimed'::ticket_status AND NEW.status = 'claimed'::ticket_status))
        AND NEW.current_assignee_id IS NOT NULL THEN
        -- A prepaid escrow (Decision #197) only needs its payee named; otherwise the hold is made now.
        IF finance.fn_bind_ticket_escrow(NEW.id) IS NULL THEN
            PERFORM finance.fn_hold_ticket_escrow(NEW.id);
        END IF;
    END IF;

    -- Entering work from outside it needs a held escrow. Moves between work states (in_review back to
    -- in_progress on a revision) are not an entry, and keep whatever is held.
    IF NEW.status IN ('claimed'::ticket_status, 'in_progress'::ticket_status, 'in_review'::ticket_status)
        AND OLD.status NOT IN ('claimed'::ticket_status, 'in_progress'::ticket_status, 'in_review'::ticket_status)
        AND NOT EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = NEW.id AND e.status = 'held') THEN
        RAISE EXCEPTION USING
            ERRCODE = 'PF402',
            MESSAGE = 'Needs funding — work can''t start on this ticket until its escrow is held.',
            DETAIL = jsonb_build_object('state', 'needs_funding', 'reason', 'not_held')::text;
    END IF;

    -- Stage-completion approval -> release payout to the payee.
    IF OLD.status <> 'completed'::ticket_status AND NEW.status = 'completed'::ticket_status THEN
        PERFORM finance.fn_release_ticket_escrow(NEW.id);
    END IF;

    -- Freelancer removed mid-work -> release held escrow to the removed freelancer.
    IF OLD.current_assignee_id IS NOT NULL AND NEW.current_assignee_id IS NULL THEN
        PERFORM finance.fn_release_ticket_escrow(NEW.id);
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, auth;

-- Deletion protocol: unclaimed -> delete freely; claimed -> release escrowed funds first, then delete
-- (prevents further client charges). Releasing before the row is removed keeps the ledger intact.
CREATE OR REPLACE FUNCTION projects.fn_ticket_delete_protocol()
RETURNS TRIGGER AS $$
BEGIN
    IF projects.fn_is_personal_project(OLD.project_id) THEN
        RETURN OLD;
    END IF;
    IF OLD.current_assignee_id IS NOT NULL
        OR EXISTS (
            SELECT 1 FROM finance.escrows e
            WHERE e.ticket_id = OLD.id AND e.status = 'held'
        ) THEN
        PERFORM finance.fn_release_ticket_escrow(OLD.id);
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, auth;

-- Settlement authority on the TABLE path. The two triggers above pay escrow out on entering
-- `completed` and on delete, and the "Manage tickets" policy lets the ASSIGNEE update and delete their
-- own ticket — so without this a freelancer could skip every guarded RPC (move_ticket,
-- complete_ticket, delete_ticket) and release their own escrow with one PATCH or DELETE. Only review
-- authority (owner / active client-business member) may complete or delete a ticket. A NULL
-- auth.uid() is the service role, cron or a migration, which act as the platform and are not gated.
CREATE OR REPLACE FUNCTION projects.fn_ticket_settlement_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF NOT projects.can_review_project(OLD.project_id) THEN
            RAISE EXCEPTION 'Only the client/owner may delete a ticket.' USING ERRCODE = '42501';
        END IF;
        -- Deleting a claimed or funded ticket pays its escrow out (fn_ticket_delete_protocol), which on
        -- a business project is a `hire` decision (BB2). An unclaimed, unfunded ticket moves no money.
        IF OLD.current_assignee_id IS NOT NULL
            OR EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = OLD.id AND e.status = 'held') THEN
            PERFORM projects.fn_assert_business_actor(OLD.project_id, 'hire');
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.status = 'completed'::public.ticket_status
        AND OLD.status IS DISTINCT FROM 'completed'::public.ticket_status THEN
        IF NOT projects.can_review_project(NEW.project_id) THEN
            RAISE EXCEPTION 'Only the client/owner may mark a ticket completed (confirm delivery).'
                USING ERRCODE = '42501';
        END IF;
        -- Completion releases the ticket's escrow: every path (complete_ticket, move_ticket, a stage
        -- approval) lands here, so this is the one place the `hire` rule cannot be skipped.
        PERFORM projects.fn_assert_business_actor(NEW.project_id, 'hire');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, org, auth;
