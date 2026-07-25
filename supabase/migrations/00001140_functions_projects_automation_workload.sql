-- ============================================================================
-- 00001140 functions projects automation workload
-- Consolidated verbatim from: 0007_projects_tables.sql, 0117_ticket_board_and_finance.sql, 0310_ticket_automation_engine.sql, 20260724113000_entitlements_allowances_enforcement.sql
-- ============================================================================

-- Audit outcome: a report found bad-faith / unsubstantiated penalizes the reporter's discovery rank.
CREATE OR REPLACE FUNCTION projects.fn_flag_bad_faith_report(p_report_id uuid)
RETURNS void AS $$
DECLARE
    v_sev numeric;
    v_reporter uuid;
    v_ticket uuid;
BEGIN
    SELECT (value #>> '{}')::numeric INTO v_sev
    FROM security.platform_params WHERE key = 'freelancer_bad_faith_penalty';
    v_sev := COALESCE(v_sev, 0);

    SELECT reporter_user_id, ticket_id INTO v_reporter, v_ticket
    FROM projects.ticket_workload_reports WHERE id = p_report_id;

    UPDATE projects.ticket_workload_reports
    SET status = 'dismissed_bad_faith'::projects.workload_report_status, resolved_at = now()
    WHERE id = p_report_id;

    UPDATE projects.tickets
    SET status = 'in_progress'::ticket_status, hidden_until = NULL
    WHERE id = v_ticket;

    INSERT INTO security.penalties (
        subject_type, subject_id, penalty_type, source_type, source_id, severity, reason
    )
    VALUES (
        'freelancer', v_reporter, 'discovery_rank', 'workload_report', p_report_id, v_sev,
        'Workload-intensity report audited as bad-faith / unsubstantiated.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, security;

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

-- #endregion

-- #region 3. Denormalized workload counter (keeps search ranking + gauge defaults fresh)
-- org.freelancer_profiles.current_workload_intensity is the running counter search.fn_norm reads for
-- workload-aware ranking (0010/0220). Recompute it from the live sum of a freelancer's active-ticket
-- W_i whenever their assignment, status, or a ticket's intensity changes. Rounds to the integer
-- counter column; the authoritative (numeric) figure for caps/gauges comes from the RPCs below.
CREATE OR REPLACE FUNCTION projects.fn_sync_workload_intensity()
RETURNS TRIGGER AS $$
DECLARE
    v_old uuid := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.current_assignee_id END;
    v_new uuid := CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN NEW.current_assignee_id END;
BEGIN
    IF v_old IS NOT NULL THEN
        UPDATE org.freelancer_profiles fp
        SET current_workload_intensity = COALESCE((
            SELECT ROUND(SUM(t.workload_intensity))
            FROM projects.tickets t
            WHERE t.current_assignee_id = v_old
              AND t.status IN ('claimed'::ticket_status, 'in_progress'::ticket_status, 'in_review'::ticket_status)
        ), 0)
        WHERE fp.user_id = v_old;
    END IF;

    IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
        UPDATE org.freelancer_profiles fp
        SET current_workload_intensity = COALESCE((
            SELECT ROUND(SUM(t.workload_intensity))
            FROM projects.tickets t
            WHERE t.current_assignee_id = v_new
              AND t.status IN ('claimed'::ticket_status, 'in_progress'::ticket_status, 'in_review'::ticket_status)
        ), 0)
        WHERE fp.user_id = v_new;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, org;

-- #endregion

-- #region 4. Concurrency-cap validation (spec §3) & gauge read-model
-- projects.check_ticket_capacity(p_ticket_id, p_user_id) -> jsonb verdict.
-- Excludes the ticket itself from the "current" sums so re-checking an already-held ticket is a
-- no-op rather than double-counting. Enforced by fn_assign_ticket_core on every claim/assignment.
CREATE OR REPLACE FUNCTION projects.check_ticket_capacity(p_ticket_id uuid, p_user_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_ticket_wi      numeric(6,2);
    v_stage_id       uuid;
    v_default_global numeric(6,2);
    v_cap_global     numeric(6,2);
    v_cap_stage      numeric(6,2);
    v_cur_global     numeric(6,2);
    v_cur_stage      numeric(6,2) := 0;
    v_proj_global    numeric(6,2);
    v_proj_stage     numeric(6,2) := 0;
    v_allowed        boolean := true;
    v_scope          text := NULL;
    v_reason         text := NULL;
BEGIN
    SELECT workload_intensity, current_stage_id INTO v_ticket_wi, v_stage_id
    FROM projects.tickets WHERE id = p_ticket_id;
    IF v_ticket_wi IS NULL THEN
        RAISE EXCEPTION 'Ticket % not found.', p_ticket_id;
    END IF;

    SELECT (value #>> '{}')::numeric INTO v_default_global
    FROM security.platform_params WHERE key = 'global_workload_cap_default';
    v_default_global := COALESCE(v_default_global, 10.00);

    SELECT COALESCE(max_workload_intensity, v_default_global) INTO v_cap_global
    FROM org.freelancer_profiles WHERE user_id = p_user_id;
    v_cap_global := COALESCE(v_cap_global, v_default_global);

    SELECT COALESCE(SUM(workload_intensity), 0) INTO v_cur_global
    FROM projects.tickets
    WHERE current_assignee_id = p_user_id
      AND id <> p_ticket_id
      AND status IN ('claimed'::ticket_status, 'in_progress'::ticket_status, 'in_review'::ticket_status);
    v_proj_global := v_cur_global + v_ticket_wi;

    IF v_stage_id IS NOT NULL THEN
        SELECT max_concurrent_intensity INTO v_cap_stage
        FROM projects.project_stages WHERE id = v_stage_id;

        SELECT COALESCE(SUM(t.workload_intensity), 0) INTO v_cur_stage
        FROM projects.tickets t
        WHERE t.current_assignee_id = p_user_id
          AND t.current_stage_id = v_stage_id
          AND t.id <> p_ticket_id
          AND t.status IN ('claimed'::ticket_status, 'in_progress'::ticket_status, 'in_review'::ticket_status);
        v_proj_stage := v_cur_stage + v_ticket_wi;
    END IF;

    IF v_proj_global > v_cap_global THEN
        v_allowed := false; v_scope := 'global';
        v_reason := format(
            'Claiming this ticket (intensity %s) would put your global workload at %s, over your cap of %s. Submit current work before taking on more.',
            trim_scale(v_ticket_wi), trim_scale(v_proj_global), trim_scale(v_cap_global));
    ELSIF v_cap_stage IS NOT NULL AND v_proj_stage > v_cap_stage THEN
        v_allowed := false; v_scope := 'project';
        v_reason := format(
            'Claiming this ticket (intensity %s) would put your workload in this stage at %s, over the stage cap of %s.',
            trim_scale(v_ticket_wi), trim_scale(v_proj_stage), trim_scale(v_cap_stage));
    END IF;

    RETURN jsonb_build_object(
        'allowed', v_allowed,
        'scope', v_scope,
        'reason', v_reason,
        'ticket_intensity', v_ticket_wi,
        'global_current', v_cur_global,
        'global_projected', v_proj_global,
        'global_cap', v_cap_global,
        'stage_current', v_cur_stage,
        'stage_projected', v_proj_stage,
        'stage_cap', v_cap_stage
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, projects, org, security, auth;

-- projects.get_workload_capacity(p_user_id, p_project_id) -> jsonb for the Workload Capacity Gauge.
-- Returns the live global figure (and a project-scoped figure when a project is supplied). NULL user
-- (e.g. an unauthenticated gauge) returns NULL rather than erroring.
CREATE OR REPLACE FUNCTION projects.get_workload_capacity(
    p_user_id uuid DEFAULT auth.uid(),
    p_project_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    v_default_global numeric(6,2);
    v_cap            numeric(6,2);
    v_cur            numeric(6,2);
    v_cur_project    numeric(6,2);
    v_ticket_count   integer;
BEGIN
    IF p_user_id IS NULL THEN RETURN NULL; END IF;

    SELECT (value #>> '{}')::numeric INTO v_default_global
    FROM security.platform_params WHERE key = 'global_workload_cap_default';
    v_default_global := COALESCE(v_default_global, 10.00);

    SELECT COALESCE(max_workload_intensity, v_default_global) INTO v_cap
    FROM org.freelancer_profiles WHERE user_id = p_user_id;
    v_cap := COALESCE(v_cap, v_default_global);

    SELECT COALESCE(SUM(workload_intensity), 0), COUNT(*)
    INTO v_cur, v_ticket_count
    FROM projects.tickets
    WHERE current_assignee_id = p_user_id
      AND status IN ('claimed'::ticket_status, 'in_progress'::ticket_status, 'in_review'::ticket_status);

    IF p_project_id IS NOT NULL THEN
        SELECT COALESCE(SUM(workload_intensity), 0) INTO v_cur_project
        FROM projects.tickets
        WHERE current_assignee_id = p_user_id
          AND project_id = p_project_id
          AND status IN ('claimed'::ticket_status, 'in_progress'::ticket_status, 'in_review'::ticket_status);
    END IF;

    RETURN jsonb_build_object(
        'user_id', p_user_id,
        'current', v_cur,
        'cap', v_cap,
        'ratio', CASE WHEN v_cap > 0 THEN round(v_cur / v_cap, 4) ELSE NULL END,
        'ticket_count', v_ticket_count,
        'project_current', v_cur_project
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, projects, org, security, auth;

-- #endregion

-- #region 5. Shared assignment core (capacity-enforcing) + reworked self-claim
-- Every path that attaches a freelancer to a ticket funnels through fn_assign_ticket_core: it locks
-- the row, re-validates the claim preconditions (unclaimed, has a description), enforces the
-- concurrency caps, stamps the claim and holds escrow. Routing RPCs that have already chosen a
-- capacity-cleared assignee pass p_enforce_capacity = false to avoid a redundant second check.
CREATE OR REPLACE FUNCTION projects.fn_assign_ticket_core(
    p_ticket_id uuid,
    p_assignee_id uuid,
    p_enforce_capacity boolean DEFAULT true
)
RETURNS uuid AS $$
DECLARE
    v_desc     jsonb;
    v_assignee uuid;
    v_verdict  jsonb;
BEGIN
    SELECT description, current_assignee_id INTO v_desc, v_assignee
    FROM projects.tickets WHERE id = p_ticket_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Ticket % not found.', p_ticket_id; END IF;
    IF v_assignee IS NOT NULL THEN RAISE EXCEPTION 'Ticket has already been claimed.'; END IF;
    IF v_desc IS NULL OR v_desc = '{}'::jsonb THEN
        RAISE EXCEPTION 'A comprehensive description is required before a ticket can be claimed/funded.';
    END IF;

    IF p_enforce_capacity THEN
        v_verdict := projects.check_ticket_capacity(p_ticket_id, p_assignee_id);
        IF NOT (v_verdict->>'allowed')::boolean THEN
            RAISE EXCEPTION '%', v_verdict->>'reason' USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    UPDATE projects.tickets
    SET current_assignee_id = p_assignee_id,
        claimed_at = now(),
        status = 'claimed'::ticket_status,
        updated_at = now()
    WHERE id = p_ticket_id;

    RETURN finance.fn_hold_ticket_escrow(p_ticket_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, security, auth;

-- #endregion

-- #region 6. Assignment routing RPCs (spec §4)

-- Owner configures how a stage distributes work.
CREATE OR REPLACE FUNCTION projects.set_stage_assignment_mode(p_stage_id uuid, p_mode text)
RETURNS void AS $$
DECLARE
    v_project uuid;
BEGIN
    SELECT project_id INTO v_project FROM projects.project_stages WHERE id = p_stage_id;
    IF v_project IS NULL THEN RAISE EXCEPTION 'Stage % not found.', p_stage_id; END IF;
    IF NOT projects.can_review_project(v_project) THEN
        RAISE EXCEPTION 'Only the project owner may configure assignment routing.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE projects.project_stages
    SET assignment_mode = p_mode::projects.assignment_routing_mode
    WHERE id = p_stage_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, auth;

-- Manual mode: the owner pins a specific individual, overriding routing. Capacity is still enforced
-- so an override cannot silently blow a freelancer past their cap.
CREATE OR REPLACE FUNCTION projects.assign_ticket_manual(p_ticket_id uuid, p_assignee_id uuid)
RETURNS uuid AS $$
DECLARE
    v_project uuid;
BEGIN
    SELECT project_id INTO v_project FROM projects.tickets WHERE id = p_ticket_id;
    IF v_project IS NULL THEN RAISE EXCEPTION 'Ticket % not found.', p_ticket_id; END IF;
    IF NOT projects.can_review_project(v_project) THEN
        RAISE EXCEPTION 'Only the project owner may pin an assignee.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN projects.fn_assign_ticket_core(p_ticket_id, p_assignee_id, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, security, auth;

-- Round-robin: assign the next ready ticket in the stage to the eligible rostered freelancer with
-- the lowest current global W_i who still has capacity (spec §4). One ticket per call keeps the
-- routing deterministic and testable. Returns a jsonb result describing what happened.
CREATE OR REPLACE FUNCTION projects.auto_assign_round_robin(p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_project  uuid;
    v_ticket   uuid;
    v_assignee uuid;
    m          record;
BEGIN
    SELECT project_id INTO v_project FROM projects.project_stages WHERE id = p_stage_id;
    IF v_project IS NULL THEN RAISE EXCEPTION 'Stage % not found.', p_stage_id; END IF;
    IF NOT projects.can_review_project(v_project) THEN
        RAISE EXCEPTION 'Only the project owner may trigger auto-assignment.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT id INTO v_ticket
    FROM projects.tickets
    WHERE current_stage_id = p_stage_id
      AND current_assignee_id IS NULL
      AND status IN ('backlog'::ticket_status, 'todo'::ticket_status)
      AND description IS DISTINCT FROM '{}'::jsonb
    ORDER BY COALESCE(sort_order, 2147483647), created_at
    LIMIT 1;

    IF v_ticket IS NULL THEN
        RETURN jsonb_build_object('assigned', false, 'reason', 'No ready tickets to assign in this stage.');
    END IF;

    FOR m IN
        SELECT r.profile_id AS uid, load.wi
        FROM projects.get_project_roster(v_project) r
        JOIN LATERAL (
            SELECT COALESCE(SUM(t.workload_intensity), 0) AS wi
            FROM projects.tickets t
            WHERE t.current_assignee_id = r.profile_id
              AND t.status IN ('claimed'::ticket_status, 'in_progress'::ticket_status, 'in_review'::ticket_status)
        ) load ON true
        ORDER BY load.wi ASC, r.profile_id
    LOOP
        IF (projects.check_ticket_capacity(v_ticket, m.uid)->>'allowed')::boolean THEN
            v_assignee := m.uid;
            EXIT;
        END IF;
    END LOOP;

    IF v_assignee IS NULL THEN
        RETURN jsonb_build_object('assigned', false, 'reason', 'No eligible roster member has capacity for the next ticket.');
    END IF;

    PERFORM projects.fn_assign_ticket_core(v_ticket, v_assignee, false);
    RETURN jsonb_build_object('assigned', true, 'ticket_id', v_ticket, 'assignee_id', v_assignee);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, security, auth;

-- Parallel-stream (one-offs, spec §4): fan every ready ticket in the stage out across the roster so
-- multiple contributors execute concurrently. Each ticket goes to the currently lowest-loaded member
-- with capacity; tickets nobody can take are left in the pool. Returns the count assigned.
CREATE OR REPLACE FUNCTION projects.assign_parallel_stream(p_stage_id uuid)
RETURNS integer AS $$
DECLARE
    v_project uuid;
    v_count   integer := 0;
    t         record;
    m         record;
BEGIN
    SELECT project_id INTO v_project FROM projects.project_stages WHERE id = p_stage_id;
    IF v_project IS NULL THEN RAISE EXCEPTION 'Stage % not found.', p_stage_id; END IF;
    IF NOT projects.can_review_project(v_project) THEN
        RAISE EXCEPTION 'Only the project owner may open a parallel stream.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    FOR t IN
        SELECT id FROM projects.tickets
        WHERE current_stage_id = p_stage_id
          AND current_assignee_id IS NULL
          AND status IN ('backlog'::ticket_status, 'todo'::ticket_status)
          AND description IS DISTINCT FROM '{}'::jsonb
        ORDER BY COALESCE(sort_order, 2147483647), created_at
    LOOP
        FOR m IN
            SELECT r.profile_id AS uid
            FROM projects.get_project_roster(v_project) r
            JOIN LATERAL (
                SELECT COALESCE(SUM(tk.workload_intensity), 0) AS wi
                FROM projects.tickets tk
                WHERE tk.current_assignee_id = r.profile_id
                  AND tk.status IN ('claimed'::ticket_status, 'in_progress'::ticket_status, 'in_review'::ticket_status)
            ) load ON true
            ORDER BY load.wi ASC, r.profile_id
        LOOP
            IF (projects.check_ticket_capacity(t.id, m.uid)->>'allowed')::boolean THEN
                PERFORM projects.fn_assign_ticket_core(t.id, m.uid, false);
                v_count := v_count + 1;
                EXIT;
            END IF;
        END LOOP;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, security, auth;

-- #endregion

-- #region 7. Claim-TTL auto-release sweep ("Ticket Parking", spec §1)
-- Called by an Edge Function / external cron (mirrors projects.fn_resolve_expired_workload_reports).
-- p_now is injectable for deterministic tests. A parked ticket's escrow is REFUNDED to the client:
-- we flip held -> refunded BEFORE clearing the assignee, so the AFTER-clear escrow-sync trigger's
-- release-to-freelancer path finds nothing 'held' and is a no-op. The freelancer earns nothing.
CREATE OR REPLACE FUNCTION projects.fn_release_expired_claims(p_now timestamptz DEFAULT now())
RETURNS integer AS $$
DECLARE
    v_minutes integer;
    v_count   integer := 0;
    r         record;
BEGIN
    SELECT (value #>> '{}')::integer INTO v_minutes
    FROM security.platform_params WHERE key = 'claim_ttl_minutes';
    v_minutes := COALESCE(v_minutes, 1440);

    FOR r IN
        SELECT id FROM projects.tickets
        WHERE status = 'claimed'::ticket_status
          AND claimed_at IS NOT NULL
          AND claimed_at < p_now - make_interval(mins => v_minutes)
    LOOP
        PERFORM finance.fn_refund_ticket_escrow(r.id);

        UPDATE projects.tickets
        SET current_assignee_id = NULL,
            status = 'backlog'::ticket_status,
            claimed_at = NULL,
            updated_at = now()
        WHERE id = r.id;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, security, org, auth;

-- #endregion

-- #region 8. Workload-intensity report — single clean filing endpoint (spec §"Reporting")
-- Invoker rights: the INSERT is authorised by the "File workload report" RLS policy (0204), which
-- restricts filing to the ticket's current assignee. Capturing claimed_intensity + binding the
-- reporter here keeps the client from having to hand-assemble the row. The AFTER-INSERT trigger
-- (fn_open_workload_report, 0117) then evicts the ticket and opens the 48h hidden window.
CREATE OR REPLACE FUNCTION projects.file_workload_report(
    p_ticket_id uuid,
    p_reason text,
    p_reported_intensity numeric DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
    v_claimed   numeric(4,2);
    v_report_id uuid;
BEGIN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'A reason is required to file a workload-intensity report.';
    END IF;

    SELECT workload_intensity INTO v_claimed FROM projects.tickets WHERE id = p_ticket_id;
    IF v_claimed IS NULL THEN RAISE EXCEPTION 'Ticket % not found.', p_ticket_id; END IF;

    INSERT INTO projects.ticket_workload_reports
        (ticket_id, reporter_user_id, claimed_intensity, reported_intensity, reason)
    VALUES (p_ticket_id, auth.uid(), v_claimed, p_reported_intensity, p_reason)
    RETURNING id INTO v_report_id;

    RETURN v_report_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, projects, auth;

-- #endregion

-- #region 7. Enforcement — metered always, blocking only when switched on

-- Proposals: one outbound application spends one allowance unit from the APPLICANT (the team when a
-- team applies, otherwise the user). Anti-spam, not a paywall — the ceiling exists on every tier.
CREATE OR REPLACE FUNCTION projects.fn_meter_application_allowance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = projects, finance, security, analytics, public
AS $$
DECLARE
    v_subject_type text;
    v_subject_id uuid;
    v_ok boolean;
    v_enforced boolean;
BEGIN
    IF NEW.applicant_type = 'team' THEN
        v_subject_type := 'team';
        v_subject_id := NEW.applicant_profile_id;
    ELSE
        v_subject_type := 'user';
        v_subject_id := NEW.applicant_user_id;
    END IF;

    v_ok := finance.fn_consume_allowance (
        v_subject_type, v_subject_id, 1, 'weekly_proposals', 'proposal',
        'projects.project_applications', NEW.id
    );

    IF NOT v_ok THEN
        PERFORM analytics.fn_emit (
            'entitlement.denied',
            CASE WHEN v_subject_type = 'team' THEN 'team'::analytics.subject_kind ELSE 'user'::analytics.subject_kind END,
            v_subject_id,
            jsonb_build_object('key', 'weekly_proposals', 'attempted', 1), 1, NEW.project_id, 'allowance'
        );

        SELECT COALESCE((value #>> '{}')::boolean, false) INTO v_enforced
        FROM security.platform_params WHERE key = 'proposal_allowance_enforced';

        IF COALESCE(v_enforced, false) THEN
            RAISE EXCEPTION 'Weekly proposal allowance exhausted. It refreshes each week, and a few come back every few hours.'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

-- Withdrawing a proposal returns the unit — selectivity should never be punished twice.
CREATE OR REPLACE FUNCTION projects.fn_refund_withdrawn_application()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = projects, finance, public
AS $$
DECLARE
    v_subject_type text;
    v_subject_id uuid;
BEGIN
    IF NEW.status = 'withdrawn'::projects.application_status
        AND OLD.status IS DISTINCT FROM 'withdrawn'::projects.application_status THEN

        IF NEW.applicant_type = 'team' THEN
            v_subject_type := 'team';
            v_subject_id := NEW.applicant_profile_id;
        ELSE
            v_subject_type := 'user';
            v_subject_id := NEW.applicant_user_id;
        END IF;

        PERFORM finance.fn_refund_allowance (
            v_subject_type, v_subject_id, 1, 'weekly_proposals', 'withdrawn',
            'projects.project_applications', NEW.id
        );
    END IF;

    RETURN NULL;
END;
$$;

-- Footprint: going PUBLIC + ACTIVE is what consumes a slot. Drafting stays unlimited and free.
CREATE OR REPLACE FUNCTION projects.fn_check_public_project_footprint()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = projects, finance, security, analytics, public
AS $$
DECLARE
    v_subject_type text;
    v_subject_id uuid;
    v_key finance.entitlement_key;
    v_limit integer;
    v_usage integer;
    v_enforced boolean;
BEGIN
    IF NEW.status <> 'active'::project_status OR NEW.visibility <> 'public'::visibility THEN
        RETURN NEW;
    END IF;

    -- Nested (not short-circuited) so OLD is never referenced on an INSERT.
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'active'::project_status AND OLD.visibility = 'public'::visibility THEN
            RETURN NEW;   -- already counted; not a new slot
        END IF;
    END IF;

    IF NEW.client_business_id IS NOT NULL THEN
        v_subject_type := 'business';
        v_subject_id := NEW.client_business_id;
        v_key := 'business_public_projects';
    ELSE
        v_subject_type := 'user';
        v_subject_id := NEW.owner_user_id;
        v_key := 'active_public_projects';
    END IF;

    v_limit := finance.fn_effective_limit (v_subject_type, v_subject_id, v_key);

    IF v_limit IS NOT NULL THEN
        v_usage := finance.fn_footprint_usage (v_subject_type, v_subject_id, v_key);

        IF v_usage >= v_limit THEN
            PERFORM analytics.fn_emit (
                'entitlement.denied',
                CASE WHEN v_subject_type = 'business' THEN 'business'::analytics.subject_kind ELSE 'user'::analytics.subject_kind END,
                v_subject_id,
                jsonb_build_object('key', v_key, 'effective_limit', v_limit, 'attempted', v_usage + 1),
                v_usage + 1, NEW.id, 'allowance'
            );

            SELECT COALESCE((value #>> '{}')::boolean, false) INTO v_enforced
            FROM security.platform_params WHERE key = 'footprint_caps_enforced';

            IF COALESCE(v_enforced, false) THEN
                RAISE EXCEPTION 'You have % live public projects, the maximum for your plan. Archive or complete one, or upgrade for more.', v_limit
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
