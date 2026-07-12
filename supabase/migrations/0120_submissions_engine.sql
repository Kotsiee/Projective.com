-- =============================================================================================
-- 0120_submissions_engine.sql
-- Submissions & Deliverables backend (spec §3 "Submissions State Machine"). Turns the previously
-- frontend-only `projects.stage_submissions` mock into a real, reviewable ledger.
--
-- Adds:
--   1. Structural columns on stage_submissions (rich description, checklist snapshot, sequential
--      number, review decision + feedback, revision lineage) + a status CHECK + lookup indexes.
--   2. projects.submit_deliverable(...) — freelancer files a deliverable against a ticket/stage,
--      attaches files, and moves the ticket into the "Review" column.
--   3. projects.review_submission(...) — client/owner accepts or requests a revision. Guarded by
--      projects.can_review_project (0119) so only the paying side can adjudicate a deliverable.
--   4. projects.get_stage_submissions(...) — read-model powering the Submissions surface.
--
-- Money is untouched here — escrow only settles when the ticket reaches "Done" (0121 / existing
-- fn_ticket_escrow_sync in 0007). This file governs the review loop that precedes payout.
-- =============================================================================================

-- #region 1. Schema — enrich stage_submissions into a real ledger
ALTER TABLE projects.stage_submissions
    ADD COLUMN IF NOT EXISTS description      jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS checked_item_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS number           integer,
    ADD COLUMN IF NOT EXISTS reviewed_by      uuid REFERENCES org.users_public(user_id),
    ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz,
    ADD COLUMN IF NOT EXISTS feedback         jsonb,
    ADD COLUMN IF NOT EXISTS revision_of      uuid REFERENCES projects.stage_submissions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now();

-- Constrain the status vocabulary to the four frontend states (contracts/Submissions.ts).
ALTER TABLE projects.stage_submissions DROP CONSTRAINT IF EXISTS stage_submissions_status_check;
ALTER TABLE projects.stage_submissions
    ADD CONSTRAINT stage_submissions_status_check
    CHECK (status IN ('draft', 'pending_review', 'accepted', 'revisions_requested'));

CREATE INDEX IF NOT EXISTS idx_stage_submissions_stage   ON projects.stage_submissions (project_stage_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stage_submissions_ticket  ON projects.stage_submissions (ticket_id, created_at DESC);
-- #endregion

-- #region 2. Serializer — one submission row (+ its files) as jsonb
-- Shared shape returned by every submission RPC so the frontend contract stays stable. File URLs are
-- resolved client-side via the files API from `file_id`; we return durable metadata here.
CREATE OR REPLACE FUNCTION projects.fn_serialize_submission(p_submission_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org, files, auth
AS $$
    SELECT jsonb_build_object(
        'id', ss.id,
        'number', COALESCE(ss.number, 0),
        'title', ss.title,
        'ticketId', ss.ticket_id,
        'stageId', ss.project_stage_id,
        'description', ss.description,
        'checkedItemIds', ss.checked_item_ids,
        'status', ss.status,
        'submittedAt', ss.created_at,
        'reviewedAt', ss.reviewed_at,
        'authorId', ss.submitted_by,
        'authorName', COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''), up.username),
        'feedback', ss.feedback,
        'revisionOf', ss.revision_of,
        'files', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', fi.id,
                'name', fi.display_name,
                'mimeType', fi.mime_type,
                'size', fi.size_bytes,
                'url', ''
            ) ORDER BY fi.display_name)
            FROM projects.submission_files sf
            JOIN files.items fi ON fi.id = sf.file_id
            WHERE sf.submission_id = ss.id
        ), '[]'::jsonb)
    )
    FROM projects.stage_submissions ss
    LEFT JOIN org.users_public up ON up.user_id = ss.submitted_by
    WHERE ss.id = p_submission_id;
$$;
-- #endregion

-- #region 3. get_stage_submissions — read-model for the Submissions surface
CREATE OR REPLACE FUNCTION projects.get_stage_submissions(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org, files, auth
AS $$
DECLARE
    v_result jsonb;
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'You do not have access to this project.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT COALESCE(jsonb_agg(projects.fn_serialize_submission(ss.id) ORDER BY ss.created_at DESC), '[]'::jsonb)
        INTO v_result
    FROM projects.stage_submissions ss
    WHERE ss.project_stage_id = p_stage_id
        AND EXISTS (SELECT 1 FROM projects.project_stages ps WHERE ps.id = ss.project_stage_id AND ps.project_id = p_project_id);

    RETURN v_result;
END;
$$;
-- #endregion

-- #region 4. submit_deliverable — freelancer files work into the review loop
-- Inserts a submission, links its files, and moves the ticket into "Review" (in_review). Inserting
-- the submission *before* the status flip means the Kanban ledger trigger (0121) sees an existing
-- pending submission and skips its placeholder — the two creation paths stay idempotent.
CREATE OR REPLACE FUNCTION projects.submit_deliverable(
    p_ticket_id        uuid,
    p_stage_id         uuid,
    p_title            text,
    p_description      jsonb DEFAULT '{}'::jsonb,
    p_checked_item_ids jsonb DEFAULT '[]'::jsonb,
    p_file_ids         uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, files, auth
AS $$
DECLARE
    v_actor      uuid := auth.uid();
    v_project    uuid;
    v_number     integer;
    v_submission uuid;
    v_file       uuid;
    v_started_at timestamptz := clock_timestamp();
BEGIN
    RAISE LOG '[SUBMISSION_MUTATION] submit_deliverable begin ts=% actor=% ticket=% stage=%',
        v_started_at, v_actor, p_ticket_id, p_stage_id;

    SELECT t.project_id INTO v_project FROM projects.tickets t WHERE t.id = p_ticket_id;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Ticket % not found.', p_ticket_id USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT projects.has_project_access(v_project) THEN
        RAISE EXCEPTION 'You do not have access to submit on this project.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.project_stages ps WHERE ps.id = p_stage_id AND ps.project_id = v_project) THEN
        RAISE EXCEPTION 'Stage % does not belong to project %.', p_stage_id, v_project USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(MAX(number), 0) + 1 INTO v_number
    FROM projects.stage_submissions WHERE project_stage_id = p_stage_id;

    INSERT INTO projects.stage_submissions
        (project_stage_id, ticket_id, submitted_by, title, notes, description, checked_item_ids, status, number)
    VALUES
        (p_stage_id, p_ticket_id, v_actor,
         COALESCE(NULLIF(btrim(p_title), ''), 'New Submission #' || v_number),
         NULL, COALESCE(p_description, '{}'::jsonb), COALESCE(p_checked_item_ids, '[]'::jsonb),
         'pending_review', v_number)
    RETURNING id INTO v_submission;

    IF p_file_ids IS NOT NULL THEN
        FOREACH v_file IN ARRAY p_file_ids LOOP
            -- Link only files that actually exist (tolerant of not-yet-persisted client ids).
            IF EXISTS (SELECT 1 FROM files.items fi WHERE fi.id = v_file) THEN
                INSERT INTO projects.submission_files (submission_id, file_id) VALUES (v_submission, v_file);
            ELSE
                RAISE LOG '[SUBMISSION_MUTATION] submit_deliverable skipped unknown file=% for submission=%', v_file, v_submission;
            END IF;
        END LOOP;
    END IF;

    -- Move the ticket into the Review column (fires the escrow-safe existing triggers; the ledger
    -- trigger in 0121 no-ops because this submission already exists).
    UPDATE projects.tickets
    SET status = 'in_review'::ticket_status,
        current_stage_id = COALESCE(current_stage_id, p_stage_id),
        updated_at = now()
    WHERE id = p_ticket_id
        AND status NOT IN ('completed'::ticket_status, 'cancelled'::ticket_status);

    RAISE LOG '[SUBMISSION_MUTATION] submit_deliverable ok submission=% number=% files=% duration_ms=%',
        v_submission, v_number, COALESCE(array_length(p_file_ids, 1), 0),
        round(extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000, 2);

    RETURN projects.fn_serialize_submission(v_submission);
END;
$$;
-- #endregion

-- #region 5. review_submission — client/owner adjudication (spec §3 reviewer guard)
CREATE OR REPLACE FUNCTION projects.review_submission(
    p_submission_id uuid,
    p_decision      text,
    p_feedback      jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_actor      uuid := auth.uid();
    v_project    uuid;
    v_stage      uuid;
    v_ticket     uuid;
    v_new_status text;
    v_started_at timestamptz := clock_timestamp();
BEGIN
    RAISE LOG '[SUBMISSION_MUTATION] review_submission begin ts=% actor=% submission=% decision=%',
        v_started_at, v_actor, p_submission_id, p_decision;

    SELECT ps.project_id, ss.project_stage_id, ss.ticket_id
        INTO v_project, v_stage, v_ticket
    FROM projects.stage_submissions ss
    JOIN projects.project_stages ps ON ps.id = ss.project_stage_id
    WHERE ss.id = p_submission_id;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Submission % not found.', p_submission_id USING ERRCODE = 'no_data_found';
    END IF;

    -- RBAC: only the owner / paying client business may approve or reject a deliverable.
    IF NOT projects.can_review_project(v_project) THEN
        RAISE WARNING '[SUBMISSION_MUTATION] denied actor=% cannot review project=%', v_actor, v_project;
        RAISE EXCEPTION 'You are not authorized to review deliverables on this project.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_decision NOT IN ('accept', 'request_revision') THEN
        RAISE EXCEPTION 'Unsupported review decision %. Use accept | request_revision.', p_decision
            USING ERRCODE = 'check_violation';
    END IF;

    v_new_status := CASE p_decision WHEN 'accept' THEN 'accepted' ELSE 'revisions_requested' END;

    UPDATE projects.stage_submissions
    SET status = v_new_status,
        reviewed_by = v_actor,
        reviewed_at = now(),
        feedback = COALESCE(p_feedback, feedback),
        updated_at = now()
    WHERE id = p_submission_id;

    IF p_decision = 'request_revision' THEN
        -- Record a formal revision request and bounce the ticket back into progress.
        INSERT INTO projects.stage_revision_requests
            (project_stage_id, ticket_id, requested_by, request_type, reason, status)
        VALUES
            (v_stage, v_ticket, v_actor, 'revision',
             COALESCE(p_feedback->>'global', 'Revision requested'), 'open');

        UPDATE projects.tickets
        SET status = 'in_progress'::ticket_status, updated_at = now()
        WHERE id = v_ticket AND status = 'in_review'::ticket_status;
    END IF;

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        v_project, v_actor, 'submission_reviewed',
        jsonb_build_object('submission_id', p_submission_id, 'decision', p_decision, 'status', v_new_status),
        'projects.stage_submissions', p_submission_id
    );

    RAISE LOG '[SUBMISSION_MUTATION] review_submission ok submission=% -> % duration_ms=%',
        p_submission_id, v_new_status,
        round(extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000, 2);

    RETURN projects.fn_serialize_submission(p_submission_id);
END;
$$;
-- #endregion
