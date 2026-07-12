-- =============================================================================================
-- 0310_ticket_automation_engine.sql
-- Epic E4 · Resource Allocation & Ticketing — the automated allocation engine layered on top of
-- 0007 (tickets + triggers), 0009 (finance engine) and 0115/0117 (lifecycle RPCs). Implements the
-- remaining spec §"Resource Allocation & Ticketing" mechanics:
--
--   1. Claim-TTL auto-release ("Ticket Parking", spec §1) — a sweep that returns claimed-but-idle
--      tickets to the backlog. Because the freelancer never committed, the escrow held at claim is
--      REFUNDED to the client (contrast with eviction/removal §"Freelancer Removal Mid-Ticket",
--      which pays the freelancer). New finance.fn_refund_ticket_escrow makes this distinction.
--   2. Assignment routing modes (spec §4) — open_pull (default, self-claim), round_robin, manual
--      (owner pins), and parallel_stream (one-off fan-out). A stage-level `assignment_mode` column
--      plus routing RPCs.
--   3. The Weighting Engine & Concurrency Caps (spec §2/§3) — a global per-freelancer W_i cap and a
--      per-stage W_i cap, validated before every claim/assignment via projects.check_ticket_capacity.
--      projects.get_workload_capacity feeds the Workload Capacity Gauge; a maintenance trigger keeps
--      the denormalized org.freelancer_profiles.current_workload_intensity (used by search ranking).
--   4. projects.file_workload_report — a single clean endpoint for the §"Workload Intensity
--      Reporting" 48h hidden loop (the trigger/sweep already live in 0007/0117).
--
-- Numbered >0204 so every grant/RLS/policy from 0200-0204 is already in place: new columns inherit
-- the existing projects.project_stages / projects.tickets / org.freelancer_profiles policies, and
-- the new SECURITY DEFINER RPCs rely on the default EXECUTE-to-PUBLIC grant with in-body authority
-- checks (projects.has_project_access / projects.can_review_project), matching the 0115/0117 pattern.
-- =============================================================================================

-- #region 1. Enums, columns & tunable parameters

DO $$ BEGIN
    CREATE TYPE projects.assignment_routing_mode AS ENUM ('open_pull', 'round_robin', 'manual', 'parallel_stream');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Per-stage routing configuration (spec §4). 'open_pull' preserves today's self-claim behaviour.
ALTER TABLE projects.project_stages
    ADD COLUMN IF NOT EXISTS assignment_mode projects.assignment_routing_mode NOT NULL DEFAULT 'open_pull',
    -- Project Hard Cap (spec §3.1): the max summed Workload Intensity a single freelancer may hold
    -- concurrently within this stage. NULL = unlimited. ("Max N standard tickets" == a cap of N.0.)
    ADD COLUMN IF NOT EXISTS max_concurrent_intensity numeric(6,2);

-- Global Soft Cap (spec §3.2): the max summed active-ticket W_i a freelancer may hold platform-wide.
-- NULL = fall back to the platform default parameter below.
ALTER TABLE org.freelancer_profiles
    ADD COLUMN IF NOT EXISTS max_workload_intensity numeric(6,2);

INSERT INTO security.platform_params (key, value, description) VALUES
    ('global_workload_cap_default', '10.00'::jsonb,
        'Default global cap on a freelancer''s summed active-ticket Workload Intensity (W_i) when the profile has no per-user override.')
ON CONFLICT (key) DO NOTHING;
-- #endregion

-- #region 2. Finance: refund path for parking auto-release
-- Distinct from finance.fn_release_ticket_escrow (which PAYS the payee). A parked claim never earned
-- anything, so held escrow is returned to the paying business wallet and the ticket is reset to
-- 'unpaid' so a future claim re-funds cleanly. Platform fee is only ever applied on release, so a
-- refund is exactly amount_cents back — no leakage.
CREATE OR REPLACE FUNCTION finance.fn_refund_ticket_escrow(p_ticket_id uuid)
RETURNS void AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT * FROM finance.escrows WHERE ticket_id = p_ticket_id AND status = 'held'
    LOOP
        UPDATE finance.escrows SET status = 'refunded' WHERE id = r.id;
        PERFORM finance.fn_wallet_credit(
            r.payer_business_id, 'business', r.currency, r.amount_cents,
            'escrow_refund', 'escrows', r.id
        );
    END LOOP;

    UPDATE projects.tickets
    SET payment_status = 'unpaid'::payment_status
    WHERE id = p_ticket_id
      AND NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = p_ticket_id AND status = 'held');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, org, auth;
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

CREATE OR REPLACE TRIGGER trg_sync_workload_intensity
    AFTER INSERT OR DELETE OR UPDATE OF current_assignee_id, status, workload_intensity ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_sync_workload_intensity();
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
