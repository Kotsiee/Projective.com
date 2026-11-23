-- =============================================================================================
-- 00001665_functions_ops_moderation.sql — the moderation doors (Category 1).
-- `ops.reports` (00000013) is the one review sink (T&S R1; Decisions #148, #340 T4, #496, #533).
-- People's reports arrive through `ops.file_report`, detector findings through
-- `ops.file_automated_finding`; SC8 adds the notice door, R3 the reviewer's resolve door. The record
-- guard `ops.fn_guard_report` (trigger, 00001897) keeps a report immutable for every role.
-- Grants in 00002510 (service_role only); Zod SSOT @projective/types/ops (reports.ts:
-- REPORT_REASONS, REPORT_SUBJECT_TYPES, REPORT_DETECTORS, REPORT_DAILY_CAP mirror the literals).
-- =============================================================================================

-- #region [reports] 1. The record guard (trigger function)
-- BEFORE INSERT OR UPDATE on ops.reports, for every role, the owner included.
-- INSERT: a `user` row names its reporter; an `automated` or `notice` row names none (#496 (A)). This
--   is checked here, on filing only, so the reporter FK's ON DELETE SET NULL can always run (#496 (d)).
-- UPDATE: nothing about what was reported changes — source, reporter, detector, subject, reported
--   person, reason, snapshot, notice, created_at. The two FKs that erasure nulls may go to NULL.
--   Status moves only pending → dismissed | actioned; a resolved report is final, its notes and time
--   fixed (resolved_by may still go to NULL on the reviewer's erasure).
CREATE OR REPLACE FUNCTION ops.fn_guard_report ()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF (NEW.source = 'user') <> (NEW.reporter_user_id IS NOT NULL) THEN
            RAISE EXCEPTION USING ERRCODE = '23514',
                MESSAGE = 'reports: a user report names its reporter; an automated finding or a notice names none';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.detector IS DISTINCT FROM OLD.detector
       OR NEW.reported_subject_type IS DISTINCT FROM OLD.reported_subject_type
       OR NEW.reported_subject_id IS DISTINCT FROM OLD.reported_subject_id
       OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.evidence_snapshot IS DISTINCT FROM OLD.evidence_snapshot
       OR NEW.notice IS DISTINCT FROM OLD.notice
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (NEW.reporter_user_id IS DISTINCT FROM OLD.reporter_user_id AND NEW.reporter_user_id IS NOT NULL)
       OR (NEW.reported_user_id IS DISTINCT FROM OLD.reported_user_id AND NEW.reported_user_id IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'reports: a report is a record — only its resolution changes';
    END IF;

    IF OLD.status <> 'pending' AND (
           NEW.status IS DISTINCT FROM OLD.status
        OR NEW.resolution_notes IS DISTINCT FROM OLD.resolution_notes
        OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
        OR (NEW.resolved_by IS DISTINCT FROM OLD.resolved_by AND NEW.resolved_by IS NOT NULL)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = pg_catalog.format('reports: a %s report is final', OLD.status);
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ops.fn_guard_report () IS
'Keeps an ops.reports row a record: the reporter is checked on INSERT (#496 (d)); afterwards only pending → dismissed | actioned moves, and the erasure FKs may go to NULL (T&S R1).';
-- #endregion

-- #region [reports] 2. A person's report
-- Called by ReportsBackendService.fileReport as the service role, AFTER it has read the subject under
-- the reporter's own JWT (the read is the permission check) and built the snapshot from the stored
-- row. Re-checks what it can:
--   * a reporter, a known subject type and a reason a person may choose — `evasion_fragmentation` is
--     the fragmentation detector's alone (Decision #533 (B)); the snapshot is an object;
--   * one PENDING report per reporter and subject (23505; the partial unique index, 00004002, holds it
--     against a race);
--   * at most 20 reports per reporter per rolling 24 hours (PR429; REPORT_DAILY_CAP). Filings by one
--     reporter are serialised on an advisory lock, so two at once cannot both pass the count.
-- Returns {id, status, created_at}. Refusals: 22023 (a malformed argument), 23505 (already reported),
-- PR429 (the cap), 23503 (an unknown reporter or reported person).
CREATE OR REPLACE FUNCTION ops.file_report (
    p_reporter uuid,
    p_subject_type text,
    p_subject_id uuid,
    p_reason text,
    p_reported_user uuid,
    p_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cap constant integer := 20;
    v_row ops.reports%ROWTYPE;
BEGIN
    IF p_reporter IS NULL OR p_subject_id IS NULL OR p_subject_type IS NULL OR p_reason IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reports: reporter, subject and reason are required';
    END IF;
    IF p_reason = 'evasion_fragmentation' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reason: evasion_fragmentation is raised by the detector, not by a person';
    END IF;
    IF p_snapshot IS NULL OR pg_catalog.jsonb_typeof(p_snapshot) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reports: the snapshot must be an object';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops.reports:' || p_reporter::text, 0));

    IF EXISTS (
        SELECT 1 FROM ops.reports r
        WHERE r.reporter_user_id = p_reporter
          AND r.reported_subject_type = p_subject_type
          AND r.reported_subject_id = p_subject_id
          AND r.status = 'pending'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'reports: you have already reported this';
    END IF;
    IF (
        SELECT pg_catalog.count(*) FROM ops.reports r
        WHERE r.reporter_user_id = p_reporter
          AND r.created_at > pg_catalog.now() - interval '24 hours'
    ) >= v_cap THEN
        RAISE EXCEPTION USING ERRCODE = 'PR429', MESSAGE = 'reports: too many reports today';
    END IF;

    INSERT INTO ops.reports (source, reporter_user_id, reported_subject_type, reported_subject_id,
                             reported_user_id, reason, evidence_snapshot)
    VALUES ('user', p_reporter, p_subject_type, p_subject_id, p_reported_user, p_reason, p_snapshot)
    RETURNING * INTO v_row;

    RETURN pg_catalog.jsonb_build_object('id', v_row.id, 'status', v_row.status, 'created_at', v_row.created_at);
END;
$$;

COMMENT ON FUNCTION ops.file_report (uuid, text, uuid, text, uuid, jsonb) IS
'Service role only: file one person''s report into ops.reports (T&S R1). One pending report per reporter and subject; 20 per reporter per 24 hours (PR429).';
-- #endregion

-- #region [reports] 3. A detector's finding
-- Called by the detectors (SN3, SN4, SN6) through ReportsBackendService.fileAutomatedFinding as the
-- service role. No reporter; the detector is named. The evidence is ids, categories and scores only —
-- the service's Zod refuses anything else, and nothing here stores text or bytes. A finding never
-- penalises anyone until a reviewer actions it (Decision #340 T4).
-- Returns {id, status, created_at}. Refusals: 22023 (a malformed argument), 23514 (an unknown
-- detector, subject type or reason).
CREATE OR REPLACE FUNCTION ops.file_automated_finding (
    p_detector text,
    p_subject_type text,
    p_subject_id uuid,
    p_reported_user uuid,
    p_reason text,
    p_evidence jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row ops.reports%ROWTYPE;
BEGIN
    IF p_detector IS NULL OR p_subject_id IS NULL OR p_subject_type IS NULL OR p_reason IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reports: detector, subject and reason are required';
    END IF;
    IF p_evidence IS NULL OR pg_catalog.jsonb_typeof(p_evidence) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reports: the evidence must be an object';
    END IF;

    INSERT INTO ops.reports (source, detector, reported_subject_type, reported_subject_id,
                             reported_user_id, reason, evidence_snapshot)
    VALUES ('automated', p_detector, p_subject_type, p_subject_id, p_reported_user, p_reason, p_evidence)
    RETURNING * INTO v_row;

    RETURN pg_catalog.jsonb_build_object('id', v_row.id, 'status', v_row.status, 'created_at', v_row.created_at);
END;
$$;

COMMENT ON FUNCTION ops.file_automated_finding (text, text, uuid, uuid, text, jsonb) IS
'Service role only: file one detector finding into ops.reports (T&S R1). Evidence is ids, categories and scores; a reviewer confirms before any penalty.';
-- #endregion
