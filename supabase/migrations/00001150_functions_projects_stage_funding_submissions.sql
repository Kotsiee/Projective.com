-- ============================================================================
-- 00001150 functions projects stage funding submissions
-- Consolidated verbatim from: 0120_submissions_engine.sql, 0305_stage_funding_payout.sql, 0311_e7_private_channels_pii_handover.sql
-- ============================================================================

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

-- #region 4. The review door — submit_deliverable · send_submission_draft
-- A submission reaches the client's review queue through exactly these two RPCs: submit_deliverable
-- files a new one, send_submission_draft sends a draft the caller already holds. Both run the same
-- three internal steps, so a sent draft and a fresh submission are indistinguishable afterwards:
--   fn_assert_can_submit     the ticket is in the stage, the caller is its assignee or an active member
--                            of the stage's accepted team (the payee fn_hold_ticket_escrow resolves).
--   fn_link_submission_files every file exists and is the caller's (or their team's); refused, never skipped.
--   fn_enter_review          resolves the ticket's open revision rounds (Decision #167), records
--                            revision_of, and moves the ticket into "Review" (in_review).
-- The submission is pending_review *before* the ticket flips, so the Kanban ledger trigger
-- (fn_ticket_review_submission) sees it and skips its placeholder.

-- Locks the ticket so two submissions on it resolve its revision rounds one after the other.
CREATE OR REPLACE FUNCTION projects.fn_assert_can_submit(p_ticket_id uuid, p_stage_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_actor    uuid := auth.uid();
    v_project  uuid;
    v_stage    uuid;
    v_assignee uuid;
BEGIN
    SELECT t.project_id, t.current_stage_id, t.current_assignee_id
      INTO v_project, v_stage, v_assignee
      FROM projects.tickets t
     WHERE t.id = p_ticket_id
       FOR UPDATE;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Ticket % not found.', p_ticket_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_actor IS NULL OR NOT projects.has_project_access(v_project) THEN
        RAISE EXCEPTION 'You do not have access to submit on this project.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.project_stages ps WHERE ps.id = p_stage_id AND ps.project_id = v_project) THEN
        RAISE EXCEPTION 'Stage % does not belong to project %.', p_stage_id, v_project USING ERRCODE = 'check_violation';
    END IF;
    IF v_stage IS DISTINCT FROM p_stage_id THEN
        RAISE EXCEPTION 'That ticket is not part of this stage.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_assignee IS DISTINCT FROM v_actor AND NOT EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
         WHERE sa.project_stage_id = p_stage_id
           AND sa.assignee_type = 'team'
           AND sa.status = 'accepted'
           AND sa.team_id IS NOT NULL
           AND org.is_active_team_member(sa.team_id)
    ) THEN
        RAISE EXCEPTION 'Only the ticket''s assignee can submit work on it.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN v_project;
END;
$$;

-- Validates the new ids together with the files the submission already links (a draft can hold
-- attachments from earlier sittings), then links the new ones once each. Returns the linked count.
CREATE OR REPLACE FUNCTION projects.fn_link_submission_files(p_submission_id uuid, p_file_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, files, auth
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_id    uuid;
    v_item  record;
    v_count integer;
BEGIN
    FOR v_id IN
        SELECT f.id FROM unnest(COALESCE(p_file_ids, '{}'::uuid[])) AS f(id)
        UNION
        SELECT sf.file_id FROM projects.submission_files sf WHERE sf.submission_id = p_submission_id
    LOOP
        SELECT fi.display_name, fi.owner_user_id, fi.owner_type, fi.owner_entity_id, fi.deleted_at
          INTO v_item
          FROM files.items fi
         WHERE fi.id = v_id;
        IF NOT FOUND OR v_item.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'One of the attached files no longer exists — remove it and submit again.'
                USING ERRCODE = 'PU422',
                      DETAIL = jsonb_build_object('code', 'file_unknown', 'file_id', v_id)::text;
        END IF;
        IF NOT (
            v_item.owner_user_id = v_actor
            OR (v_item.owner_type = 'team'::files.owner_kind AND org.is_active_team_member(v_item.owner_entity_id))
        ) THEN
            RAISE EXCEPTION '"%" is not your file to submit.', v_item.display_name
                USING ERRCODE = 'PU422',
                      DETAIL = jsonb_build_object('code', 'file_foreign', 'file_id', v_id)::text;
        END IF;
    END LOOP;

    INSERT INTO projects.submission_files (submission_id, file_id)
    SELECT p_submission_id, f.id
      FROM (SELECT DISTINCT unnest(COALESCE(p_file_ids, '{}'::uuid[])) AS id) f
     WHERE NOT EXISTS (
        SELECT 1 FROM projects.submission_files sf
         WHERE sf.submission_id = p_submission_id AND sf.file_id = f.id
     );

    SELECT count(*) INTO v_count FROM projects.submission_files sf WHERE sf.submission_id = p_submission_id;
    RETURN v_count;
END;
$$;

-- A CTE, because a ticket can hold more than one open round and a bare UPDATE … RETURNING INTO
-- refuses a second row; the newest round's submission is the one this submission revises.
CREATE OR REPLACE FUNCTION projects.fn_enter_review(p_submission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_ticket      uuid;
    v_revision_of uuid;
BEGIN
    SELECT ss.ticket_id INTO v_ticket FROM projects.stage_submissions ss WHERE ss.id = p_submission_id;

    WITH resolved AS (
        UPDATE projects.stage_revision_requests rv
           SET status = 'resolved', resolved_at = now()
         WHERE rv.ticket_id = v_ticket AND rv.status = 'open'
        RETURNING rv.submission_id, rv.created_at
    )
    SELECT r.submission_id INTO v_revision_of FROM resolved r ORDER BY r.created_at DESC LIMIT 1;

    IF v_revision_of IS NOT NULL THEN
        UPDATE projects.stage_submissions SET revision_of = v_revision_of WHERE id = p_submission_id;
    END IF;

    UPDATE projects.tickets
    SET status = 'in_review'::ticket_status,
        updated_at = now()
    WHERE id = v_ticket
        AND status NOT IN ('completed'::ticket_status, 'cancelled'::ticket_status);
END;
$$;

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
    v_number     integer;
    v_submission uuid;
    v_files      integer;
    v_started_at timestamptz := clock_timestamp();
BEGIN
    RAISE LOG '[SUBMISSION_MUTATION] submit_deliverable begin ts=% actor=% ticket=% stage=%',
        v_started_at, v_actor, p_ticket_id, p_stage_id;

    PERFORM projects.fn_assert_can_submit(p_ticket_id, p_stage_id);

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

    v_files := projects.fn_link_submission_files(v_submission, p_file_ids);
    PERFORM projects.fn_enter_review(v_submission);

    RAISE LOG '[SUBMISSION_MUTATION] submit_deliverable ok submission=% number=% files=% duration_ms=%',
        v_submission, v_number, v_files,
        round(extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000, 2);

    RETURN projects.fn_serialize_submission(v_submission);
END;
$$;

-- Sends the caller's own draft. A missing row, someone else's row and an already-sent row are one
-- refusal (PC409), so the door reveals nothing about drafts the caller does not hold. p_file_ids are
-- the files staged since the draft was saved; p_checked_item_ids NULL keeps the draft's own list.
CREATE OR REPLACE FUNCTION projects.send_submission_draft(
    p_submission_id    uuid,
    p_checked_item_ids jsonb DEFAULT NULL,
    p_file_ids         uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, files, auth
AS $$
DECLARE
    v_actor      uuid := auth.uid();
    v_ticket     uuid;
    v_stage      uuid;
    v_number     integer;
    v_files      integer;
    v_started_at timestamptz := clock_timestamp();
BEGIN
    RAISE LOG '[SUBMISSION_MUTATION] send_submission_draft begin ts=% actor=% submission=%',
        v_started_at, v_actor, p_submission_id;

    SELECT ss.ticket_id, ss.project_stage_id, ss.number
      INTO v_ticket, v_stage, v_number
      FROM projects.stage_submissions ss
     WHERE ss.id = p_submission_id
       AND ss.submitted_by = v_actor
       AND ss.status = 'draft'
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That draft can no longer be submitted.' USING ERRCODE = 'PC409';
    END IF;

    PERFORM projects.fn_assert_can_submit(v_ticket, v_stage);

    IF v_number IS NULL THEN
        SELECT COALESCE(MAX(number), 0) + 1 INTO v_number
        FROM projects.stage_submissions WHERE project_stage_id = v_stage;
    END IF;

    UPDATE projects.stage_submissions
    SET status = 'pending_review',
        number = v_number,
        checked_item_ids = COALESCE(p_checked_item_ids, checked_item_ids),
        updated_at = now()
    WHERE id = p_submission_id;

    v_files := projects.fn_link_submission_files(p_submission_id, p_file_ids);
    PERFORM projects.fn_enter_review(p_submission_id);

    RAISE LOG '[SUBMISSION_MUTATION] send_submission_draft ok submission=% number=% files=% duration_ms=%',
        p_submission_id, v_number, v_files,
        round(extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000, 2);

    RETURN projects.fn_serialize_submission(p_submission_id);
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
    v_sub_status text;
    v_submitter  uuid;
    v_sub_title  text;
    v_stage_status stage_status;
    v_paid       uuid[];
    v_slug       text;
    v_allowed    integer;
    v_used       integer;
    v_price      bigint;
    v_currency   text;
    v_revision   uuid;
    v_started_at timestamptz := clock_timestamp();
BEGIN
    RAISE LOG '[SUBMISSION_MUTATION] review_submission begin ts=% actor=% submission=% decision=%',
        v_started_at, v_actor, p_submission_id, p_decision;

    -- Locked so two concurrent reviews of one submission cannot both land.
    SELECT ps.project_id, ss.project_stage_id, ss.ticket_id, ss.status, ss.submitted_by, ss.title
        INTO v_project, v_stage, v_ticket, v_sub_status, v_submitter, v_sub_title
    FROM projects.stage_submissions ss
    JOIN projects.project_stages ps ON ps.id = ss.project_stage_id
    WHERE ss.id = p_submission_id
    FOR UPDATE OF ss;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Submission % not found.', p_submission_id USING ERRCODE = 'no_data_found';
    END IF;

    -- RBAC: only the owner / paying client business may approve or reject a deliverable.
    IF NOT projects.can_review_project(v_project) THEN
        RAISE WARNING '[SUBMISSION_MUTATION] denied actor=% cannot review project=%', v_actor, v_project;
        RAISE EXCEPTION 'You are not authorized to review deliverables on this project.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Only a submission awaiting review is adjudicated: a reviewer can read an unsent `draft` under RLS,
    -- and re-reviewing an `accepted` / `revisions_requested` one would rewrite a decision already made.
    -- Checked after the RBAC guard so a non-reviewer learns nothing about the submission's state.
    IF v_sub_status IS DISTINCT FROM 'pending_review' THEN
        RAISE EXCEPTION 'Only a submission awaiting review can be reviewed.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    IF p_decision NOT IN ('accept', 'request_revision') THEN
        RAISE EXCEPTION 'Unsupported review decision %. Use accept | request_revision.', p_decision
            USING ERRCODE = 'check_violation';
    END IF;

    v_new_status := CASE p_decision WHEN 'accept' THEN 'accepted' ELSE 'revisions_requested' END;

    -- The stage row is locked for either verdict and a settled stage refused, so an acceptance racing
    -- approve_stage or cancel_stage_fair_exit settles the ticket once (Decision #194).
    SELECT ps.status INTO v_stage_status FROM projects.project_stages ps WHERE ps.id = v_stage FOR UPDATE;
    IF v_stage_status IN ('paid'::stage_status, 'cancelled'::stage_status) THEN
        RAISE EXCEPTION 'This stage is already % — its submissions can no longer be reviewed.', v_stage_status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- The revision allotment (Decision #167), read and consumed under the STAGE's row lock so two
    -- reviewers cannot both take the last free round. Free while the allotment is unlimited (NULL),
    -- not yet used up, or extra rounds cost nothing. Past it the request is refused BEFORE anything is
    -- written, with the price a round can be bought at (projects.request_paid_revision).
    IF p_decision = 'request_revision' THEN
        SELECT ps.file_revisions_allowed, ps.revisions_used, ps.extra_revision_price_cents,
               upper(COALESCE(p.currency, 'USD'))
          INTO v_allowed, v_used, v_price, v_currency
          FROM projects.project_stages ps
          JOIN projects.projects p ON p.id = ps.project_id
         WHERE ps.id = v_stage
           FOR UPDATE OF ps;
        IF NOT (v_allowed IS NULL OR v_used < v_allowed OR v_price = 0) THEN
            RAISE EXCEPTION USING
                ERRCODE = 'PR402',
                MESSAGE = format('All %s free revisions on this stage are used — %s', v_allowed,
                    CASE WHEN v_price IS NULL THEN 'this stage sells no extra rounds.'
                         ELSE 'buy a revision to send it back.' END),
                DETAIL = jsonb_build_object(
                    'code', 'paid_revision_required', 'price_minor', v_price, 'currency', v_currency,
                    'used', v_used, 'allowed', v_allowed
                )::text;
        END IF;
    END IF;

    UPDATE projects.stage_submissions
    SET status = v_new_status,
        reviewed_by = v_actor,
        reviewed_at = now(),
        feedback = COALESCE(p_feedback, feedback),
        updated_at = now()
    WHERE id = p_submission_id;

    -- Either verdict settles the submission, so a paid round raised on it and never paid is moot.
    UPDATE projects.stage_revision_requests
       SET status = 'cancelled'
     WHERE submission_id = p_submission_id AND status = 'awaiting_payment';

    -- Acceptance is the ticket's payout (Decision #194): its work on this stage settles through the
    -- guarded status path, which releases its held escrow, and everyone that paid is told.
    IF p_decision = 'accept' AND v_ticket IS NOT NULL THEN
        v_paid := projects.fn_settle_ticket_stage(v_ticket, v_stage, 'submission_accepted');
        SELECT p.slug INTO v_slug FROM projects.projects p WHERE p.id = v_project;
        PERFORM projects.fn_notify_payees(
            v_paid, ARRAY[v_submitter], 'submission.accepted', 'Submission accepted',
            CASE WHEN cardinality(v_paid) > 0
                 THEN format('"%s" was accepted — your payout has been released.', v_sub_title)
                 ELSE format('"%s" was accepted.', v_sub_title) END,
            'projects.stage_submissions', p_submission_id, v_project, '/projects/' || v_slug || '/submissions'
        );
    END IF;

    IF p_decision = 'request_revision' THEN
        UPDATE projects.project_stages SET revisions_used = revisions_used + 1 WHERE id = v_stage;

        -- Record a formal revision request and bounce the ticket back into progress.
        INSERT INTO projects.stage_revision_requests
            (project_stage_id, ticket_id, requested_by, request_type, reason, status, submission_id)
        VALUES
            (v_stage, v_ticket, v_actor, 'revision',
             COALESCE(p_feedback->>'global', 'Revision requested'), 'open', p_submission_id)
        RETURNING id INTO v_revision;

        UPDATE projects.tickets
        SET status = 'in_progress'::ticket_status, updated_at = now()
        WHERE id = v_ticket AND status = 'in_review'::ticket_status;

        PERFORM projects.fn_notify_revision(v_revision);
    END IF;

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        v_project, v_actor, 'submission_reviewed',
        jsonb_build_object('submission_id', p_submission_id, 'decision', p_decision, 'status', v_new_status,
            'released_count', COALESCE(cardinality(v_paid), 0)),
        'projects.stage_submissions', p_submission_id
    );

    RAISE LOG '[SUBMISSION_MUTATION] review_submission ok submission=% -> % duration_ms=%',
        p_submission_id, v_new_status,
        round(extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000, 2);

    RETURN projects.fn_serialize_submission(p_submission_id)
        || jsonb_build_object('released_count', COALESCE(cardinality(v_paid), 0));
END;
$$;

-- #endregion

-- #region 5b. Paid revisions (Decision #167)
-- A round past the stage's free allotment is bought, not requested. request_paid_revision raises the
-- round `awaiting_payment` with its price snapshotted, and that row is what a `paid_revision` basket line
-- pays for (basket_items.revision_id). fund_paid_revision, run by finance.place_wallet_order as the
-- payer, holds the round's escrow on the ticket and only THEN opens it — so the freelancer is never asked
-- to revise unpaid. Until it is paid the submission stays `pending_review`.

-- Tell the freelancer a round is open: `submission.revision_requested` to whoever submitted the work and
-- `ticket.revision_requested` to the ticket's assignee when that is somebody else (a teammate), so one
-- person is never told twice about one round. Internal; called by review_submission and fund_paid_revision.
CREATE OR REPLACE FUNCTION projects.fn_notify_revision(p_revision_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, comms, org
AS $$
DECLARE
    v record;
BEGIN
    SELECT rv.request_type, rv.requested_by, rv.ticket_id, ss.submitted_by, ss.title AS submission_title,
           t.current_assignee_id AS assignee, t.slug AS ticket_slug, t.title AS ticket_title,
           p.id AS project_id, p.slug AS project_slug
      INTO v
      FROM projects.stage_revision_requests rv
      JOIN projects.tickets t ON t.id = rv.ticket_id
      JOIN projects.projects p ON p.id = t.project_id
      LEFT JOIN projects.stage_submissions ss ON ss.id = rv.submission_id
     WHERE rv.id = p_revision_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    PERFORM comms.fn_notify(
        v.submitted_by, 'submission.revision_requested',
        CASE WHEN v.request_type = 'paid_revision' THEN 'Paid revision funded' ELSE 'Revision requested' END,
        CASE WHEN v.request_type = 'paid_revision' THEN 'Paid revision, funded, you can start.'
             ELSE format('The client asked for changes to "%s".', COALESCE(v.submission_title, v.ticket_title)) END,
        'projects.stage_revision_requests', p_revision_id,
        jsonb_build_object('ticket_id', v.ticket_id, 'paid', v.request_type = 'paid_revision'),
        v.requested_by, 'project', v.project_id, NULL, '/projects/' || v.project_slug || '/submissions'
    );
    IF v.assignee IS DISTINCT FROM v.submitted_by THEN
        PERFORM comms.fn_notify(
            v.assignee, 'ticket.revision_requested', 'Revision requested',
            format('"%s" is back in progress for a revision.', v.ticket_title),
            'projects.tickets', v.ticket_id,
            jsonb_build_object('revision_id', p_revision_id, 'paid', v.request_type = 'paid_revision'),
            v.requested_by, 'project', v.project_id, NULL,
            '/projects/' || v.project_slug || '/board?tkv=' || v.ticket_slug
        );
    END IF;
END;
$$;

-- Raise a paid round on a submission awaiting review, once its stage's free rounds are used. Reviewer
-- guard first, so a non-reviewer learns nothing of the submission's state. Idempotent per submission: a
-- second press refreshes the open-for-payment round's feedback and price instead of minting another.
-- Returns what the basket line needs: { revision_id, price_minor, currency, title, stage_id, ticket_id }.
CREATE OR REPLACE FUNCTION projects.request_paid_revision(p_submission_id uuid, p_feedback jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v record;
    v_revision uuid;
    v_reason text := COALESCE(NULLIF(btrim(p_feedback->>'global'), ''), 'Revision requested');
BEGIN
    SELECT ss.status, ss.ticket_id, ss.project_stage_id AS stage_id, ps.project_id, ps.name AS stage_name,
           ps.file_revisions_allowed AS allowed, ps.revisions_used AS used,
           ps.extra_revision_price_cents AS price, upper(COALESCE(p.currency, 'USD')) AS currency
      INTO v
      FROM projects.stage_submissions ss
      JOIN projects.project_stages ps ON ps.id = ss.project_stage_id
      JOIN projects.projects p ON p.id = ps.project_id
     WHERE ss.id = p_submission_id
       FOR UPDATE OF ss;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission % not found.', p_submission_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_actor IS NULL OR NOT projects.can_review_project(v.project_id) THEN
        RAISE EXCEPTION 'You are not authorized to review deliverables on this project.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v.status IS DISTINCT FROM 'pending_review' THEN
        RAISE EXCEPTION 'Only a submission awaiting review can be sent back.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    IF v.allowed IS NULL OR v.used < v.allowed OR v.price = 0 THEN
        RAISE EXCEPTION 'This stage still has a free revision — request it instead.' USING ERRCODE = 'PC409';
    END IF;
    IF v.price IS NULL THEN
        RAISE EXCEPTION 'This stage sells no extra revisions.' USING ERRCODE = 'PU422';
    END IF;

    UPDATE projects.stage_revision_requests
       SET reason = v_reason, price_cents = v.price
     WHERE submission_id = p_submission_id AND status = 'awaiting_payment'
    RETURNING id INTO v_revision;
    IF v_revision IS NULL THEN
        INSERT INTO projects.stage_revision_requests
            (project_stage_id, ticket_id, requested_by, request_type, reason, status, submission_id, price_cents)
        VALUES
            (v.stage_id, v.ticket_id, v_actor, 'paid_revision', v_reason, 'awaiting_payment', p_submission_id, v.price)
        RETURNING id INTO v_revision;
    END IF;

    RETURN jsonb_build_object(
        'revision_id', v_revision,
        'price_minor', v.price,
        'currency', v.currency,
        'title', 'Paid revision · ' || v.stage_name,
        'stage_id', v.stage_id,
        'ticket_id', v.ticket_id
    );
END;
$$;

-- Pay for a raised round: the payer rule fund_ticket applies, then the escrow hold, then the round
-- opens exactly as a free one does (submission → revisions_requested, ticket → in progress, the
-- freelancer told "Paid revision, funded, you can start."). Called as the payer by
-- finance.place_wallet_order for a `paid_revision` line. A refused hold (PF402, #165's shape) rolls the
-- whole call back, so the round stays awaiting payment.
CREATE OR REPLACE FUNCTION projects.fund_paid_revision(p_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, finance, org, auth
AS $$
DECLARE
    v record;
    v_escrow uuid;
BEGIN
    PERFORM org.fn_assert_adult(auth.uid());
    SELECT rv.status, rv.reason, rv.requested_by, rv.submission_id, rv.ticket_id, rv.project_stage_id,
           rv.request_type, rv.price_cents, ps.extra_revision_price_cents AS stage_price,
           ps.project_id, p.client_business_id AS payer, p.owner_user_id AS owner, ss.status AS submission_status
      INTO v
      FROM projects.stage_revision_requests rv
      JOIN projects.project_stages ps ON ps.id = rv.project_stage_id
      JOIN projects.projects p ON p.id = ps.project_id
      LEFT JOIN projects.stage_submissions ss ON ss.id = rv.submission_id
     WHERE rv.id = p_revision_id
       FOR UPDATE OF rv;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That revision no longer exists.' USING ERRCODE = 'no_data_found';
    END IF;
    IF v.payer IS NOT NULL THEN
        IF NOT finance.fn_owner_capability('business', v.payer, 'spend'::finance.vault_capability) THEN
            RAISE EXCEPTION 'Only a member who can spend from the client''s wallet can pay for this revision.'
                USING ERRCODE = '42501';
        END IF;
    ELSIF v.owner IS NULL OR v.owner IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Only the project''s owner can pay for this revision.' USING ERRCODE = '42501';
    END IF;
    IF v.status <> 'awaiting_payment' THEN
        RAISE EXCEPTION 'This revision is already paid for or was withdrawn.' USING ERRCODE = 'PC409';
    END IF;
    IF v.submission_status IS DISTINCT FROM 'pending_review' THEN
        RAISE EXCEPTION 'The submission this revision was for has already been decided.' USING ERRCODE = 'PC409';
    END IF;
    -- The escrow holds the round's snapshot, so the snapshot must still be the stage's price: a round
    -- whose price no longer matches is raised again (request_paid_revision re-snapshots), never paid.
    IF v.request_type <> 'paid_revision' OR v.price_cents IS DISTINCT FROM v.stage_price THEN
        RAISE EXCEPTION 'This revision''s price no longer matches the stage''s terms — raise it again.'
            USING ERRCODE = 'PC409';
    END IF;

    v_escrow := finance.fn_hold_revision_escrow(p_revision_id);

    UPDATE projects.stage_revision_requests SET status = 'open' WHERE id = p_revision_id;
    UPDATE projects.stage_submissions
       SET status = 'revisions_requested',
           reviewed_by = v.requested_by,
           reviewed_at = now(),
           feedback = jsonb_build_object('global', v.reason),
           updated_at = now()
     WHERE id = v.submission_id;
    UPDATE projects.tickets
       SET status = 'in_progress'::ticket_status, updated_at = now()
     WHERE id = v.ticket_id AND status = 'in_review'::ticket_status;

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        v.project_id, auth.uid(), 'submission_reviewed',
        jsonb_build_object('submission_id', v.submission_id, 'decision', 'request_revision',
                           'status', 'revisions_requested', 'paid_revision_id', p_revision_id),
        'projects.stage_submissions', v.submission_id
    );

    PERFORM projects.fn_notify_revision(p_revision_id);

    RETURN jsonb_build_object('revision_id', p_revision_id, 'escrow_id', v_escrow, 'status', 'open');
END;
$$;

-- #endregion

-- #region Decision #197 — what funding a stage takes, and the client's quote for it.
-- THE definition projects.fund_stage holds by and finance.begin_card_payment charges by, so a card
-- payment can never settle into a stage that then refuses it: every ticket in the stage that is unpaid
-- or needs funding, is not finished, and has no held escrow — claimed or not — at its own price, else
-- the stage's. `unpriced_count` > 0 means the stage cannot be funded until those tickets are priced.
-- Internal: the callers have already checked who may fund.
CREATE OR REPLACE FUNCTION projects.fn_stage_funding_need(p_stage_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'ticket_count', count(*),
        'unpriced_count', count(*) FILTER (WHERE COALESCE(t.unit_price_cents, ps.unit_price_cents, 0) <= 0),
        'amount_cents', COALESCE(sum(COALESCE(t.unit_price_cents, ps.unit_price_cents))
            FILTER (WHERE COALESCE(t.unit_price_cents, ps.unit_price_cents, 0) > 0), 0)
    )
      FROM projects.tickets t
      JOIN projects.project_stages ps ON ps.id = t.current_stage_id
     WHERE t.current_stage_id = p_stage_id
       AND t.payment_status IN ('unpaid'::public.payment_status, 'needs_funding'::public.payment_status)
       AND t.status NOT IN ('completed'::public.ticket_status, 'cancelled'::public.ticket_status,
                            'reported_hidden'::public.ticket_status)
       AND NOT EXISTS (
           SELECT 1 FROM finance.escrows e
            WHERE e.ticket_id = t.id AND e.status = 'held' AND e.revision_id IS NULL
       );
$$;

-- The stage-funding quote a client reads before paying (the board's Fund stage, the wallet's dialog):
-- the same payer rule as fund_stage, the stage's status and currency, fn_stage_funding_need, and the
-- paying wallet with its balance — so the surface can offer the wallet when it covers the stage and
-- the card when it does not. Read-only; fund_stage and begin_card_payment re-check everything.
CREATE OR REPLACE FUNCTION projects.get_stage_funding_quote(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_payer uuid;
    v_owner uuid;
    v_currency text;
    v_status stage_status;
    v_name text;
    v_wallet_type text;
    v_balance bigint;
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;
    SELECT p.client_business_id, p.owner_user_id, upper(COALESCE(p.currency, 'USD'))
      INTO v_payer, v_owner, v_currency
      FROM projects.projects p WHERE p.id = p_project_id;
    IF v_payer IS NOT NULL THEN
        IF NOT finance.fn_owner_capability('business', v_payer, 'spend'::finance.vault_capability) THEN
            RAISE EXCEPTION 'Only a member who can spend from the client''s wallet can fund this stage.'
                USING ERRCODE = '42501';
        END IF;
    ELSIF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Only the project''s owner can fund this stage.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.status, ps.name INTO v_status, v_name
      FROM projects.project_stages ps
     WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.' USING ERRCODE = 'no_data_found';
    END IF;

    v_wallet_type := finance.fn_escrow_payer_wallet_type(v_payer, CASE WHEN v_payer IS NULL THEN v_owner END);
    SELECT w.balance_cents INTO v_balance
      FROM finance.wallets w
     WHERE w.owner_type = v_wallet_type AND w.owner_id = COALESCE(v_payer, v_owner) AND w.currency = v_currency;

    RETURN projects.fn_stage_funding_need(p_stage_id) || jsonb_build_object(
        'stage_id', p_stage_id,
        'stage_name', v_name,
        'stage_status', v_status::text,
        'fundable', v_status IN ('open'::stage_status, 'assigned'::stage_status, 'in_progress'::stage_status),
        'currency', v_currency,
        'payer_scope', CASE WHEN v_payer IS NOT NULL THEN 'business' ELSE 'personal' END,
        'payer_id', COALESCE(v_payer, v_owner),
        'wallet_balance_cents', COALESCE(v_balance, 0)
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, projects, finance, org, auth;
-- #endregion

-- #region US-005 — Fund a stage's escrow: every unfunded ticket, prepaid until claimed (Decision #197).
CREATE OR REPLACE FUNCTION projects.fund_stage(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_status stage_status;
    v_currency text;
    v_stage_name text;
    v_tickets uuid[];
    v_ticket uuid;
    v_escrow uuid;
    v_funded int := 0;
    v_total bigint := 0;
    v_payer uuid;
    v_owner uuid;
    v_needed bigint;
    v_available bigint;
    v_need jsonb;
    v_unpriced int;
BEGIN
    PERFORM org.fn_assert_adult(auth.uid());
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;

    -- Funding moves the CLIENT's money into escrow, so project access is not enough: a freelancer on
    -- the project has access too. For a business client the caller must be able to spend from the
    -- paying business's wallet — the same capability the business checkout asks for. A project with no
    -- client business is paid for by its owner as an INDIVIDUAL client (PRODUCT_SPEC §Escrow, Wallets &
    -- Finance #5), and only that owner may fund it, from their own wallet.
    SELECT p.client_business_id, p.owner_user_id INTO v_payer, v_owner
      FROM projects.projects p WHERE p.id = p_project_id;
    IF v_payer IS NOT NULL THEN
        IF NOT finance.fn_owner_capability('business', v_payer, 'spend'::finance.vault_capability) THEN
            RAISE EXCEPTION 'Only a member who can spend from the client''s wallet can fund this stage.'
                USING ERRCODE = '42501';
        END IF;
    ELSIF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Only the project''s owner can fund this stage.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.status, ps.name, p.currency
    INTO v_status, v_stage_name, v_currency
    FROM projects.project_stages ps
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.' USING ERRCODE = 'no_data_found';
    END IF;

    -- AC1, widened by Decision #197: a stage is funded before anyone is hired (open), once hired
    -- (assigned), or while work runs (in_progress — for tickets added since). Nothing later.
    IF v_status NOT IN ('open'::stage_status, 'assigned'::stage_status, 'in_progress'::stage_status) THEN
        RAISE EXCEPTION 'Only an open, assigned or in-progress stage can be funded (this one is %).', v_status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- Lock the candidate tickets before any hold, in id order (Decision #189): a concurrent fund_stage or
    -- fund_ticket on the same ticket waits here, then re-reads it as funded and leaves it out. Every
    -- ticket lock is taken before a hold touches the payer's wallet row, so two doors never wait on
    -- each other.
    SELECT COALESCE(array_agg(c.id ORDER BY c.id), '{}') INTO v_tickets
      FROM (
        SELECT tk.id
          FROM projects.tickets tk
         WHERE tk.current_stage_id = p_stage_id
           AND tk.payment_status IN ('unpaid'::payment_status, 'needs_funding'::payment_status)
           AND tk.status NOT IN ('completed'::ticket_status, 'cancelled'::ticket_status,
                                 'reported_hidden'::ticket_status)
         ORDER BY tk.id
           FOR UPDATE
      ) c;

    -- What the locked set needs, by the one definition the card intent charged by (Decision #197). A
    -- ticket with no price refuses the whole stage before anything moves, never funding part of it.
    v_need := projects.fn_stage_funding_need(p_stage_id);
    v_unpriced := (v_need ->> 'unpriced_count')::int;
    IF v_unpriced > 0 THEN
        RAISE EXCEPTION '% — price % before funding the stage.',
            CASE WHEN v_unpriced = 1 THEN 'A ticket in this stage has no price yet'
                 ELSE v_unpriced || ' tickets in this stage have no price yet' END,
            CASE WHEN v_unpriced = 1 THEN 'it' ELSE 'them' END
            USING ERRCODE = 'PC409';
    END IF;

    -- Each hold refuses (PF402) on its own and the transaction makes the stage all or nothing; an
    -- individual's whole stage is checked first so the refusal names the stage, not one ticket.
    IF v_payer IS NULL THEN
        v_needed := (v_need ->> 'amount_cents')::bigint;
        SELECT w.balance_cents INTO v_available
          FROM finance.wallets w
         WHERE w.owner_id = v_owner
           AND w.owner_type = finance.fn_person_wallet_type(v_owner)
           AND w.currency = upper(COALESCE(v_currency, 'USD'));
        IF COALESCE(v_available, 0) < v_needed THEN
            RAISE EXCEPTION 'Your wallet does not hold enough to fund this stage — pay by card instead.'
                USING ERRCODE = 'PF402';
        END IF;
    END IF;

    -- Hold escrow for each not-yet-funded ticket in the stage — prepaid (no payee) where nobody has
    -- claimed it yet, bound at the claim (Decision #197). fn_hold_ticket_escrow
    -- reuses fn_check_spending_limit (AC2), isolates the escrow to project_stage_id (AC3) and
    -- writes the wallet-debit ledger entry (AC6). Each hold also tells its assignee they can start
    -- (AC5, `escrow.funded`).
    FOREACH v_ticket IN ARRAY v_tickets LOOP
        v_escrow := finance.fn_hold_ticket_escrow(v_ticket);
        IF v_escrow IS NOT NULL THEN
            v_funded := v_funded + 1;
        END IF;
    END LOOP;

    IF v_funded = 0 THEN
        RAISE EXCEPTION 'Nothing in this stage is waiting for funding.' USING ERRCODE = 'PC409';
    END IF;

    SELECT COALESCE(SUM(amount_cents), 0) INTO v_total
    FROM finance.escrows
    WHERE project_stage_id = p_stage_id AND status = 'held';

    -- AC4: assigned -> active (in_progress). An open stage stays open until it is hired.
    UPDATE projects.project_stages
    SET status = 'in_progress'::stage_status
    WHERE id = p_stage_id AND status = 'assigned'::stage_status;

    RETURN jsonb_build_object(
        'funded_count', v_funded,
        'total_held_cents', v_total,
        'awaiting_claim_count', (SELECT count(*) FROM finance.escrows e
                                  WHERE e.project_stage_id = p_stage_id AND e.status = 'held' AND e.payee_id IS NULL),
        'currency', COALESCE(v_currency, 'USD'),
        'stage_status', CASE WHEN v_status = 'assigned'::stage_status THEN 'in_progress' ELSE v_status::text END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, comms, org, auth;

-- #region Decision #166 — Fund ONE ticket's escrow (single-ticket Buy now, a basket ticket line).
-- The same payer rule as fund_stage, then the PRODUCT_SPEC §5 purchasing gate (no description, not
-- purchasable), then exactly one hold at that ticket's own price through fn_hold_ticket_escrow. The
-- stage's status is NOT moved: its other tickets are still unfunded, so the stage stays partially
-- funded and fund_stage remains the separate whole-stage action. Called as the payer by
-- finance.place_wallet_order (a basket ticket line) and finance.settle_card_payment (a card lock that
-- names a ticket). A ticket nobody has claimed is held PREPAID, its payee bound at the claim
-- (Decision #197) — #166(B)'s prepayment, held as escrow rather than left in the wallet.
CREATE OR REPLACE FUNCTION projects.fund_ticket(p_project_id uuid, p_ticket_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_payer uuid;
    v_owner uuid;
    v_currency text;
    t record;
    v_balance bigint;
    v_escrow uuid;
BEGIN
    PERFORM org.fn_assert_adult(auth.uid());
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;
    SELECT p.client_business_id, p.owner_user_id, upper(COALESCE(p.currency, 'USD'))
      INTO v_payer, v_owner, v_currency
      FROM projects.projects p WHERE p.id = p_project_id;
    IF v_payer IS NOT NULL THEN
        IF NOT finance.fn_owner_capability('business', v_payer, 'spend'::finance.vault_capability) THEN
            RAISE EXCEPTION 'Only a member who can spend from the client''s wallet can fund this ticket.'
                USING ERRCODE = '42501';
        END IF;
    ELSIF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Only the project''s owner can fund this ticket.' USING ERRCODE = '42501';
    END IF;

    SELECT tk.title, tk.text_description, tk.payment_status::text AS payment_status,
           tk.current_stage_id AS stage_id, tk.current_assignee_id AS assignee,
           COALESCE(tk.unit_price_cents, ps.unit_price_cents) AS amount, ps.status::text AS stage_status
      INTO t
      FROM projects.tickets tk
      LEFT JOIN projects.project_stages ps ON ps.id = tk.current_stage_id
     WHERE tk.id = p_ticket_id AND tk.project_id = p_project_id
       FOR UPDATE OF tk;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found for this project.' USING ERRCODE = 'no_data_found';
    END IF;
    IF btrim(t.text_description) = '' THEN
        RAISE EXCEPTION '"%" needs a description before it can be bought.', t.title USING ERRCODE = 'PU422';
    END IF;
    -- Text, so the gate reads the same before and after #165's `needs_funding` member exists.
    IF t.payment_status NOT IN ('unpaid', 'needs_funding')
       OR EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = p_ticket_id AND e.status = 'held') THEN
        RAISE EXCEPTION '"%" is already paid for.', t.title USING ERRCODE = 'PC409';
    END IF;
    IF t.stage_id IS NULL THEN
        RAISE EXCEPTION 'Move "%" into a stage before buying it.', t.title USING ERRCODE = 'PC409';
    END IF;
    IF t.stage_status IN ('approved', 'paid', 'cancelled') THEN
        RAISE EXCEPTION 'The stage "%" sits in has finished.', t.title USING ERRCODE = 'PC409';
    END IF;
    IF t.amount IS NULL OR t.amount <= 0 THEN
        RAISE EXCEPTION '"%" has no price yet.', t.title USING ERRCODE = 'PC409';
    END IF;
    -- An individual is checked up front, as fund_stage does, so the refusal says what to do next.
    IF v_payer IS NULL THEN
        SELECT w.balance_cents INTO v_balance
          FROM finance.wallets w
         WHERE w.owner_id = v_owner
           AND w.owner_type = finance.fn_person_wallet_type(v_owner)
           AND w.currency = v_currency;
        IF COALESCE(v_balance, 0) < t.amount THEN
            RAISE EXCEPTION 'Your wallet does not hold enough to fund "%" — pay by card instead.', t.title
                USING ERRCODE = 'PF402';
        END IF;
    END IF;

    v_escrow := finance.fn_hold_ticket_escrow(p_ticket_id);
    IF v_escrow IS NULL THEN
        RAISE EXCEPTION 'The escrow for "%" could not be held.', t.title USING ERRCODE = 'PF402';
    END IF;

    RETURN jsonb_build_object(
        'ticket_id', p_ticket_id,
        'escrow_id', v_escrow,
        'stage_id', t.stage_id,
        'amount_cents', t.amount,
        'currency', v_currency,
        'prepaid', EXISTS (SELECT 1 FROM finance.escrows e WHERE e.id = v_escrow AND e.payee_id IS NULL)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, comms, org, auth;
-- #endregion

-- #endregion

-- #region Decision #198 — Fair Exit: the quote, its preview, and the door.
-- What a Fair Exit at p_tier settles on a stage, read without moving anything: every escrow still held on
-- the tickets that hold escrow on the stage — the set cancel_stage_fair_exit hands to
-- finance.fn_fair_exit_release — split by finance.fn_fair_exit_split exactly as the release splits it. A
-- ticket holding a prepaid escrow nobody claimed is refunded whole (Decision #197), so it pays nobody.
-- One answer for the confirmation and the settlement's report. Internal.
CREATE OR REPLACE FUNCTION projects.fn_fair_exit_quote(p_stage_id uuid, p_tier integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects, finance
AS $$
BEGIN
    RETURN (
        WITH settled AS (
            SELECT DISTINCT e.ticket_id
              FROM finance.escrows e
             WHERE e.project_stage_id = p_stage_id AND e.status = 'held' AND e.ticket_id IS NOT NULL
        ), held AS (
            SELECT e.amount_cents::bigint AS amount,
                   bool_or(e.payee_id IS NULL) OVER (PARTITION BY e.ticket_id) AS prepaid,
                   finance.fn_escrow_fee_bp(e.payer_business_id, e.payer_user_id) AS fee_bp
              FROM finance.escrows e
              JOIN settled s ON s.ticket_id = e.ticket_id
             WHERE e.status = 'held'
        ), split AS (
            SELECT h.amount, h.prepaid, x.fee_cents, x.payout_cents, x.refund_cents
              FROM held h
             CROSS JOIN LATERAL finance.fn_fair_exit_split(h.amount, p_tier * 100, h.fee_bp) x
        )
        SELECT jsonb_build_object(
            'tier', p_tier,
            'ticket_count', (SELECT count(*) FROM settled),
            'held_cents', COALESCE(SUM(amount), 0),
            'prepaid_cents', COALESCE(SUM(amount) FILTER (WHERE prepaid), 0),
            'freelancer_paid_cents', COALESCE(SUM(payout_cents) FILTER (WHERE NOT prepaid), 0),
            'fee_cents', COALESCE(SUM(fee_cents) FILTER (WHERE NOT prepaid), 0),
            'client_refunded_cents', COALESCE(SUM(refund_cents) FILTER (WHERE NOT prepaid), 0)
                                   + COALESCE(SUM(amount) FILTER (WHERE prepaid), 0)
        )
        FROM split
    );
END;
$$;

-- The confirmation's figures: what ending the stage under Fair Exit settles at each tier, read through
-- the quote the door reports, so the island formats figures and does no money math. Review authority,
-- like the door it previews; read-only. exitable is false, with blocked saying why, for a settled
-- stage or one with nothing held — both of which cancel_stage_fair_exit refuses.
CREATE OR REPLACE FUNCTION projects.preview_stage_fair_exit(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects, finance, auth
AS $$
DECLARE
    v_name text;
    v_status stage_status;
    v_currency text;
    v_held bigint;
    v_blocked text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to end a stage.' USING ERRCODE = '42501';
    END IF;
    IF NOT projects.can_review_project(p_project_id) THEN
        RAISE EXCEPTION 'Only the client/owner may end this stage.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.name, ps.status, upper(COALESCE(p.currency, 'USD'))
      INTO v_name, v_status, v_currency
      FROM projects.project_stages ps
      JOIN projects.projects p ON p.id = ps.project_id
     WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.' USING ERRCODE = 'no_data_found';
    END IF;

    v_currency := COALESCE(
        (SELECT upper(e.currency) FROM finance.escrows e
          WHERE e.project_stage_id = p_stage_id AND e.status = 'held' ORDER BY e.id LIMIT 1),
        v_currency
    );
    v_held := (projects.fn_fair_exit_quote(p_stage_id, 50)->>'held_cents')::bigint;
    v_blocked := CASE
        WHEN v_status NOT IN ('open'::stage_status, 'assigned'::stage_status, 'in_progress'::stage_status,
                              'submitted'::stage_status, 'revisions'::stage_status) THEN 'settled'
        WHEN v_held = 0 THEN 'nothing_held'
    END;

    RETURN jsonb_build_object(
        'stage_id', p_stage_id,
        'stage_name', v_name,
        'stage_status', v_status,
        'currency', v_currency,
        'exitable', v_blocked IS NULL,
        'blocked', v_blocked,
        'held_cents', v_held,
        'tickets_to_cancel', (SELECT count(*) FROM projects.tickets tk
                               WHERE tk.current_stage_id = p_stage_id
                                 AND tk.status NOT IN ('completed'::ticket_status, 'cancelled'::ticket_status,
                                                       'reported_hidden'::ticket_status)),
        'tiers', (SELECT jsonb_agg(projects.fn_fair_exit_quote(p_stage_id, t.tier) ORDER BY t.tier)
                    FROM unnest(ARRAY[25, 50, 75]) AS t(tier))
    );
END;
$$;

-- The stage row is locked before anything settles and only an unsettled stage (open, assigned,
-- in_progress, submitted, revisions) may be cancelled, so two cancellations, or a cancellation racing
-- approve_stage, settle the stage once: the second waits on the lock, then finds it cancelled or paid
-- (Decision #188). The tickets to settle are locked next, in id order, so the quote it reports is
-- exactly what the split moves. Then the work left on the stage closes (Decision #198): each ticket
-- still standing on it lands cancelled, terminal, keeping its assignee for the record — no escrow
-- moves on that write, the split already settled every one — and a paid revision round still awaiting
-- payment is moot. Both sides are told: every payee and team-split recipient the split paid plus the
-- stage's assignees, and the project owner plus the reviewer who ended it.
CREATE OR REPLACE FUNCTION projects.cancel_stage_fair_exit(p_project_id uuid, p_stage_id uuid, p_tier integer)
RETURNS jsonb AS $$
DECLARE
    v_stage_name text;
    v_stage_status stage_status;
    v_currency text;
    v_slug text;
    v_owner uuid;
    v_bp integer;
    v_quote jsonb;
    v_held uuid[];
    v_paid uuid[];
    v_assignees uuid[];
    t record;
    a record;
    v_cnt int := 0;
    v_closed int := 0;
BEGIN
    -- 🚨 Settles the stage's escrow (part paid out, part refunded), so the guard is review authority,
    -- not `has_project_access`: the assignee has project access and must not pick their own payout.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to cancel a stage.' USING ERRCODE = '42501';
    END IF;
    IF NOT projects.can_review_project(p_project_id) THEN
        RAISE EXCEPTION 'Only the client/owner may cancel this stage.' USING ERRCODE = '42501';
    END IF;

    IF p_tier IS NULL OR p_tier NOT IN (25, 50, 75) THEN
        RAISE EXCEPTION 'Fair-exit tier must be 25, 50, or 75 (got %).', p_tier
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_bp := p_tier * 100;   -- percent -> basis points

    SELECT ps.name, ps.status, upper(COALESCE(p.currency, 'USD')), p.slug, p.owner_user_id
      INTO v_stage_name, v_stage_status, v_currency, v_slug, v_owner
      FROM projects.project_stages ps
      JOIN projects.projects p ON p.id = ps.project_id
     WHERE ps.id = p_stage_id AND ps.project_id = p_project_id
       FOR UPDATE OF ps;

    IF v_stage_name IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_stage_status NOT IN ('open'::stage_status, 'assigned'::stage_status, 'in_progress'::stage_status,
                              'submitted'::stage_status, 'revisions'::stage_status) THEN
        RAISE EXCEPTION 'This stage is already % — only an unsettled stage can be cancelled.', v_stage_status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    PERFORM 1 FROM projects.tickets tk
     WHERE tk.id IN (SELECT e.ticket_id FROM finance.escrows e
                      WHERE e.project_stage_id = p_stage_id AND e.status = 'held')
     ORDER BY tk.id
       FOR UPDATE;

    v_quote := projects.fn_fair_exit_quote(p_stage_id, p_tier);
    SELECT COALESCE(array_agg(e.id ORDER BY e.id), '{}'::uuid[]) INTO v_held
      FROM finance.escrows e
     WHERE e.status = 'held'
       AND e.ticket_id IN (SELECT h.ticket_id FROM finance.escrows h
                            WHERE h.project_stage_id = p_stage_id AND h.status = 'held');
    v_currency := COALESCE(
        (SELECT upper(e.currency) FROM finance.escrows e WHERE e.id = ANY (v_held) ORDER BY e.id LIMIT 1),
        v_currency
    );

    FOR t IN
        SELECT DISTINCT ticket_id
        FROM finance.escrows
        WHERE project_stage_id = p_stage_id AND status = 'held' AND ticket_id IS NOT NULL
        ORDER BY ticket_id
    LOOP
        PERFORM finance.fn_fair_exit_release(t.ticket_id, v_bp);
        v_cnt := v_cnt + 1;
    END LOOP;

    IF v_cnt = 0 THEN
        RAISE EXCEPTION 'No funded (held) escrow to cancel for this stage.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- Released means a payee was paid a share; a prepaid escrow went back whole and paid nobody.
    SELECT COALESCE(array_agg(e.id ORDER BY e.id), '{}'::uuid[]) INTO v_paid
      FROM finance.escrows e WHERE e.id = ANY (v_held) AND e.status = 'released';

    UPDATE projects.project_stages
    SET status = 'cancelled'::stage_status
    WHERE id = p_stage_id;

    v_assignees := ARRAY(SELECT DISTINCT tk.current_assignee_id FROM projects.tickets tk
                          WHERE tk.current_stage_id = p_stage_id AND tk.current_assignee_id IS NOT NULL);

    FOR t IN
        SELECT tk.id, tk.status
          FROM projects.tickets tk
         WHERE tk.current_stage_id = p_stage_id
           AND tk.status NOT IN ('completed'::ticket_status, 'cancelled'::ticket_status,
                                 'reported_hidden'::ticket_status)
         ORDER BY tk.id
           FOR UPDATE
    LOOP
        UPDATE projects.tickets SET status = 'cancelled'::ticket_status WHERE id = t.id;
        INSERT INTO projects.ticket_history
            (ticket_id, actor_id, action_type, previous_stage_id, new_stage_id, previous_status, new_status, changes)
        VALUES
            (t.id, auth.uid(), 'status_changed', p_stage_id, p_stage_id, t.status, 'cancelled'::ticket_status,
             jsonb_build_object('from_status', t.status, 'to_status', 'cancelled', 'reason', 'fair_exit',
                                'tier', p_tier));
        v_closed := v_closed + 1;
    END LOOP;

    UPDATE projects.stage_revision_requests
       SET status = 'cancelled'
     WHERE project_stage_id = p_stage_id AND status = 'awaiting_payment';

    PERFORM projects.fn_notify_payees(
        v_paid, v_assignees, 'stage_cancelled', 'Stage ended (Fair Exit)',
        format('"%s" was ended early under Fair Exit — you were paid %s%% of its held escrow for the work delivered.',
               v_stage_name, p_tier),
        'project_stages', p_stage_id, p_project_id, '/projects/' || v_slug
    );

    FOR a IN
        SELECT DISTINCT u AS uid FROM unnest(ARRAY[v_owner, auth.uid()]) AS u WHERE u IS NOT NULL
    LOOP
        PERFORM comms.fn_notify(
            a.uid, 'stage_cancelled', 'Stage ended (Fair Exit)',
            format('"%s" was ended under Fair Exit at %s%% — the unearned remainder of its escrow was refunded to the paying wallet.',
                   v_stage_name, p_tier),
            'project_stages', p_stage_id,
            v_quote || jsonb_build_object('currency', v_currency, 'tickets_cancelled', v_closed),
            auth.uid(), 'project', p_project_id, NULL, '/projects/' || v_slug
        );
    END LOOP;

    RETURN jsonb_build_object(
        'tier', p_tier,
        'cancelled_count', v_cnt,
        'tickets_cancelled', v_closed,
        'freelancer_paid_cents', (v_quote->>'freelancer_paid_cents')::bigint,
        'fee_cents', (v_quote->>'fee_cents')::bigint,
        'client_refunded_cents', (v_quote->>'client_refunded_cents')::bigint,
        'currency', v_currency,
        'stage_status', 'cancelled'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, comms, org;

-- #endregion

-- #region Stage finance read model (powers the Finance tab).
CREATE OR REPLACE FUNCTION projects.get_stage_finance(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_status stage_status;
    v_currency text;
    v_assignment jsonb;
    v_escrowed bigint;
    v_released bigint;
    v_fee bigint;
    v_tickets jsonb;
    v_splits jsonb;
    v_fundable_tickets int;
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.status, p.currency INTO v_status, v_currency
    FROM projects.project_stages ps
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.' USING ERRCODE = 'no_data_found';
    END IF;

    SELECT jsonb_build_object(
        'type', sa.assignee_type,
        'name', COALESCE(tm.name, NULLIF(TRIM(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''))
    )
    INTO v_assignment
    FROM projects.stage_assignments sa
    LEFT JOIN org.teams tm ON tm.id = sa.team_id
    LEFT JOIN org.users_public up ON up.user_id = sa.freelancer_profile_id
    WHERE sa.project_stage_id = p_stage_id AND sa.status = 'accepted'
    ORDER BY sa.created_at DESC
    LIMIT 1;

    SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'held'), 0),
        COALESCE(SUM(amount_cents + deadline_bonus_cents - platform_fee_cents) FILTER (WHERE status = 'released'), 0),
        COALESCE(SUM(platform_fee_cents) FILTER (WHERE status = 'released'), 0)
    INTO v_escrowed, v_released, v_fee
    FROM finance.escrows
    WHERE project_stage_id = p_stage_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticket_id', tk.id,
        'title', tk.title,
        'amount_cents', COALESCE(tk.unit_price_cents, ps2.unit_price_cents),
        'payment_status', tk.payment_status,
        'assignee_id', tk.current_assignee_id
    ) ORDER BY tk.sort_order NULLS LAST, tk.created_at), '[]'::jsonb)
    INTO v_tickets
    FROM projects.tickets tk
    LEFT JOIN projects.project_stages ps2 ON ps2.id = tk.current_stage_id
    WHERE tk.current_stage_id = p_stage_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'member_user_id', psp.member_user_id,
        'amount_cents', psp.amount_cents,
        'name', NULLIF(TRIM(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), '')
    )), '[]'::jsonb)
    INTO v_splits
    FROM finance.payout_splits psp
    JOIN finance.escrows e ON e.id = psp.escrow_id
    LEFT JOIN org.users_public up ON up.user_id = psp.member_user_id
    WHERE e.project_stage_id = p_stage_id;

    SELECT count(*) INTO v_fundable_tickets
    FROM projects.tickets
    WHERE current_stage_id = p_stage_id
      AND current_assignee_id IS NOT NULL
      AND payment_status IN ('unpaid'::payment_status, 'needs_funding'::payment_status);

    RETURN jsonb_build_object(
        'stage_id', p_stage_id,
        'stage_status', v_status,
        'currency', COALESCE(v_currency, 'USD'),
        'assignment', v_assignment,
        'total_escrowed_cents', v_escrowed,
        'total_released_cents', v_released,
        'platform_fee_cents', v_fee,
        'tickets', v_tickets,
        'splits', v_splits,
        'fundable', (v_status = 'assigned'::stage_status AND v_fundable_tickets > 0)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org;

-- Belt-and-braces: a project force-completed through projects.set_project_status (0119) also lifts
-- the protected phase, keeping is_protected_phase consistent with the project lifecycle.
CREATE OR REPLACE FUNCTION projects.tg_project_handover_on_complete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'completed'::project_status AND NEW.handover_unlocked_at IS NULL THEN
        NEW.handover_unlocked_at := now();
    END IF;
    RETURN NEW;
END;
$$;

-- #endregion

-- #region 5c. Ticket settlement — one path for an acceptance and a stage approval (Decision #194)
-- Settle one ticket's work on a stage. A ticket standing on that stage goes through
-- projects.force_complete_stage: `completed` on its final required stage — so the settlement guard,
-- the escrow-sync release and payment_status `released` all happen on the status write — or on to its
-- next required stage. Whatever is still held afterwards (a ticket already completed, or one that has
-- moved past this stage) is released directly. Returns only the escrows THIS call released, read under
-- the ticket's row lock, which every release path takes first. Internal.
CREATE OR REPLACE FUNCTION projects.fn_settle_ticket_stage(p_ticket_id uuid, p_stage_id uuid, p_reason text)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, finance, org, auth
AS $$
DECLARE
    v_project    uuid;
    v_status     ticket_status;
    v_stage      uuid;
    v_new_status ticket_status;
    v_new_stage  uuid;
    v_held       uuid[];
    v_released   uuid[];
BEGIN
    SELECT project_id, status, current_stage_id INTO v_project, v_status, v_stage
      FROM projects.tickets WHERE id = p_ticket_id
       FOR UPDATE;
    IF v_project IS NULL THEN
        RETURN '{}'::uuid[];
    END IF;

    SELECT COALESCE(array_agg(e.id ORDER BY e.id), '{}'::uuid[]) INTO v_held
      FROM finance.escrows e WHERE e.ticket_id = p_ticket_id AND e.status = 'held';

    IF v_stage = p_stage_id AND v_status NOT IN ('completed'::ticket_status, 'cancelled'::ticket_status) THEN
        PERFORM projects.force_complete_stage(p_ticket_id);

        SELECT status, current_stage_id INTO v_new_status, v_new_stage
          FROM projects.tickets WHERE id = p_ticket_id;
        INSERT INTO projects.ticket_history
            (ticket_id, actor_id, action_type, previous_stage_id, new_stage_id, previous_status, new_status, changes)
        VALUES
            (p_ticket_id, auth.uid(),
             CASE WHEN v_new_stage IS DISTINCT FROM v_stage THEN 'stage_moved' ELSE 'status_changed' END,
             v_stage, v_new_stage, v_status, v_new_status,
             jsonb_build_object('from_status', v_status, 'to_status', v_new_status, 'reason', p_reason));

        IF v_new_status = 'completed'::ticket_status THEN
            INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
            VALUES (
                v_project, auth.uid(), 'milestone_confirmed',
                jsonb_build_object('ticket_id', p_ticket_id, 'stage_id', p_stage_id, 'reason', p_reason),
                'projects.tickets', p_ticket_id
            );
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM finance.escrows e WHERE e.id = ANY (v_held) AND e.status = 'held') THEN
        PERFORM finance.fn_release_ticket_escrow(p_ticket_id);
    END IF;

    SELECT COALESCE(array_agg(e.id ORDER BY e.id), '{}'::uuid[]) INTO v_released
      FROM finance.escrows e WHERE e.id = ANY (v_held) AND e.status = 'released';
    RETURN v_released;
END;
$$;

-- Tell everyone a set of just-released escrows paid (each individual payee, and every member and
-- finder a team split credited in finance.payout_splits) plus p_also, once each. Internal.
CREATE OR REPLACE FUNCTION projects.fn_notify_payees(
    p_escrow_ids   uuid[],
    p_also         uuid[],
    p_type         text,
    p_title        text,
    p_body         text,
    p_entity_table text,
    p_entity_id    uuid,
    p_project_id   uuid,
    p_action_url   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, finance, comms
AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT e.payee_id AS uid
          FROM finance.escrows e
         WHERE e.id = ANY (p_escrow_ids) AND e.payee_type = 'freelancer'::assignment_type
        UNION
        SELECT psp.member_user_id FROM finance.payout_splits psp WHERE psp.escrow_id = ANY (p_escrow_ids)
        UNION
        SELECT u FROM unnest(COALESCE(p_also, '{}'::uuid[])) AS u
    LOOP
        CONTINUE WHEN r.uid IS NULL;
        PERFORM comms.fn_notify(
            r.uid, p_type, p_title, p_body, p_entity_table, p_entity_id,
            jsonb_build_object('released_count', COALESCE(cardinality(p_escrow_ids), 0)),
            auth.uid(), 'project', p_project_id, NULL, p_action_url
        );
    END LOOP;
END;
$$;

-- #endregion

-- #region 6. Projective Unlock — fire the handover when the final escrow releases
-- Settles every ticket still holding escrow on the stage through projects.fn_settle_ticket_stage, so
-- the board and payment_status agree with the stage (Decision #194); reports only the escrows this call
-- released; tells the payees, every team-split recipient and the client. Once no stage of the project
-- remains unsettled, the last escrow has just been released, so the protected phase is lifted for the
-- whole project and every participant is notified of the Contact Handover.
-- The stage row is locked before anything is released and only an unsettled stage (open, assigned,
-- in_progress, submitted, revisions, approved) may be approved, so two approvals, or an approval racing
-- cancel_stage_fair_exit, pay out once: the second waits on the lock, then finds it paid or cancelled
-- (Decision #188).
CREATE OR REPLACE FUNCTION projects.approve_stage(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_currency text;
    v_stage_name text;
    v_stage_status stage_status;
    t record;
    a record;
    v_released int := 0;
    v_ids uuid[] := '{}'::uuid[];
    v_paid bigint := 0;
    v_fee bigint := 0;
    v_splits jsonb;
    v_unlocked boolean := false;
    v_slug text;
    v_owner uuid;
BEGIN
    -- 🚨 Releases every held escrow on the stage, so the guard is review authority, not
    -- `has_project_access`: the assignee has project access and must not approve their own stage.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to approve a stage.' USING ERRCODE = '42501';
    END IF;
    IF NOT projects.can_review_project(p_project_id) THEN
        RAISE EXCEPTION 'Only the client/owner may approve this stage.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.name, ps.status, p.currency INTO v_stage_name, v_stage_status, v_currency
    FROM projects.project_stages ps
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE ps.id = p_stage_id AND ps.project_id = p_project_id
    FOR UPDATE OF ps;

    IF v_stage_name IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_stage_status NOT IN ('open'::stage_status, 'assigned'::stage_status, 'in_progress'::stage_status,
                              'submitted'::stage_status, 'revisions'::stage_status, 'approved'::stage_status) THEN
        RAISE EXCEPTION 'This stage is already % — only an unsettled stage can be approved.', v_stage_status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- Settle every ticket holding escrow on this stage through the guarded status path: each lands
    -- `completed` (or on its next required stage) with payment_status `released`. fn_release_ticket_escrow
    -- still applies the payer's platform fee and routes team payees through fn_split_team_payout.
    FOR t IN
        SELECT DISTINCT ticket_id
        FROM finance.escrows
        WHERE project_stage_id = p_stage_id AND status = 'held' AND ticket_id IS NOT NULL
        ORDER BY ticket_id
    LOOP
        v_ids := v_ids || projects.fn_settle_ticket_stage(t.ticket_id, p_stage_id, 'stage_approved');
        v_released := v_released + 1;
    END LOOP;

    -- Nothing left to hold is fine once acceptances have paid the stage out; a stage nothing was ever
    -- funded on is still refused.
    IF v_released = 0 AND NOT EXISTS (
        SELECT 1 FROM finance.escrows WHERE project_stage_id = p_stage_id AND status = 'released'
    ) THEN
        RAISE EXCEPTION 'No funded (held) escrow to release for this stage.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- This call's releases only: an escrow an earlier acceptance released is not reported again.
    SELECT COALESCE(SUM(GREATEST(amount_cents + COALESCE(deadline_bonus_cents, 0) - platform_fee_cents, 0)), 0),
           COALESCE(SUM(platform_fee_cents), 0)
    INTO v_paid, v_fee
    FROM finance.escrows
    WHERE id = ANY (v_ids) AND status = 'released';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'member_user_id', psp.member_user_id,
        'amount_cents', psp.amount_cents,
        'currency', psp.currency)), '[]'::jsonb)
    INTO v_splits
    FROM finance.payout_splits psp
    WHERE psp.escrow_id = ANY (v_ids);

    UPDATE projects.project_stages
    SET status = 'paid'::stage_status, completed_at = now()
    WHERE id = p_stage_id;

    SELECT p.slug, p.owner_user_id INTO v_slug, v_owner FROM projects.projects p WHERE p.id = p_project_id;

    -- Everyone this approval paid (individual payees and every team-split recipient), plus the stage's
    -- assignees, whom an earlier acceptance may already have paid.
    PERFORM projects.fn_notify_payees(
        v_ids,
        ARRAY(SELECT DISTINCT tk.current_assignee_id FROM projects.tickets tk
               WHERE tk.current_stage_id = p_stage_id AND tk.current_assignee_id IS NOT NULL),
        'stage_approved', 'Stage approved & paid',
        CASE WHEN cardinality(v_ids) > 0
             THEN format('"%s" was approved — your payout has been released.', v_stage_name)
             ELSE format('"%s" was approved and closed — its payouts were released on acceptance.', v_stage_name) END,
        'project_stages', p_stage_id, p_project_id, '/projects/' || v_slug
    );

    -- The client side: the project owner and, when another client member approved, that approver.
    FOR a IN
        SELECT DISTINCT u AS uid FROM unnest(ARRAY[v_owner, auth.uid()]) AS u WHERE u IS NOT NULL
    LOOP
        PERFORM comms.fn_notify(
            a.uid, 'stage_approved', 'Stage settled',
            CASE WHEN v_released > 0
                 THEN format('"%s" is settled — held escrow on %s ticket(s) was released to the freelancers.',
                             v_stage_name, v_released)
                 ELSE format('"%s" is settled — every ticket on it was already paid on acceptance.', v_stage_name) END,
            'project_stages', p_stage_id,
            jsonb_build_object('released_count', v_released, 'total_paid_cents', v_paid, 'fee_cents', v_fee,
                               'currency', upper(COALESCE(v_currency, 'USD'))),
            auth.uid(), 'project', p_project_id, NULL, '/projects/' || v_slug
        );
    END LOOP;

    -- ── Projective Unlock (E7 handover) ──────────────────────────────────────────────────────────
    -- If no stage remains unsettled, the final escrow has just been released: lift the protected phase
    -- for the whole project (disables the PII filter, unlocks the full file library — the "Contact
    -- Handover", brain.md §Messaging) and notify everyone who took part.
    IF NOT EXISTS (
        SELECT 1 FROM projects.project_stages
        WHERE project_id = p_project_id
            AND archived_at IS NULL
            AND status NOT IN ('paid'::stage_status, 'cancelled'::stage_status)
    ) THEN
        UPDATE projects.projects
        SET handover_unlocked_at = now()
        WHERE id = p_project_id AND handover_unlocked_at IS NULL;

        IF FOUND THEN
            v_unlocked := true;
            FOR a IN
                SELECT DISTINCT pm.sender_user_id AS uid
                FROM comms.project_messages pm
                JOIN comms.project_channels pc ON pc.id = pm.channel_id
                WHERE pc.project_id = p_project_id
                UNION
                SELECT p.owner_user_id FROM projects.projects p WHERE p.id = p_project_id
            LOOP
                PERFORM comms.fn_notify(
                    a.uid, 'project_handover', 'Projective Unlock',
                    'This project is complete — contact sharing is unlocked and every file is ready to download.',
                    'projects', p_project_id
                );
            END LOOP;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'released_count', v_released,
        'total_paid_cents', v_paid,
        'fee_cents', v_fee,
        'splits', v_splits,
        'stage_status', 'paid',
        'handover_unlocked', v_unlocked
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, comms, security, org;
