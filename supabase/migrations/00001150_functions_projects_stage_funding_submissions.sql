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
    v_revision_of uuid;
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

    -- A resubmission resolves the ticket's open revision round (Decision #167) and records which
    -- submission it revises. A CTE, because a ticket can hold more than one open round and a bare
    -- UPDATE … RETURNING INTO refuses a second row.
    WITH resolved AS (
        UPDATE projects.stage_revision_requests rv
           SET status = 'resolved', resolved_at = now()
         WHERE rv.ticket_id = p_ticket_id AND rv.status = 'open'
        RETURNING rv.submission_id, rv.created_at
    )
    SELECT r.submission_id INTO v_revision_of FROM resolved r ORDER BY r.created_at DESC LIMIT 1;

    INSERT INTO projects.stage_submissions
        (project_stage_id, ticket_id, submitted_by, title, notes, description, checked_item_ids, status, number,
         revision_of)
    VALUES
        (p_stage_id, p_ticket_id, v_actor,
         COALESCE(NULLIF(btrim(p_title), ''), 'New Submission #' || v_number),
         NULL, COALESCE(p_description, '{}'::jsonb), COALESCE(p_checked_item_ids, '[]'::jsonb),
         'pending_review', v_number, v_revision_of)
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
    v_sub_status text;
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
    SELECT ps.project_id, ss.project_stage_id, ss.ticket_id, ss.status
        INTO v_project, v_stage, v_ticket, v_sub_status
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
    SELECT rv.status, rv.reason, rv.requested_by, rv.submission_id, rv.ticket_id, rv.project_stage_id,
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

-- #region US-005 — Fund an assigned stage's escrow.
CREATE OR REPLACE FUNCTION projects.fund_stage(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_status stage_status;
    v_currency text;
    v_stage_name text;
    t record;
    v_escrow uuid;
    v_funded int := 0;
    v_total bigint := 0;
    v_payer uuid;
    v_owner uuid;
    v_needed bigint;
    v_available bigint;
BEGIN
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

    -- AC1: only an assigned stage may be funded.
    IF v_status <> 'assigned'::stage_status THEN
        RAISE EXCEPTION 'Stage must be in the assigned state to fund escrow (current: %).', v_status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- Each hold refuses (PF402) on its own and the transaction makes the stage all or nothing; an
    -- individual's whole stage is checked first so the refusal names the stage, not one ticket.
    IF v_payer IS NULL THEN
        SELECT COALESCE(SUM(COALESCE(t2.unit_price_cents, ps2.unit_price_cents)), 0) INTO v_needed
          FROM projects.tickets t2
          LEFT JOIN projects.project_stages ps2 ON ps2.id = t2.current_stage_id
         WHERE t2.current_stage_id = p_stage_id
           AND t2.current_assignee_id IS NOT NULL
           AND t2.payment_status IN ('unpaid'::payment_status, 'needs_funding'::payment_status);
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

    -- Hold escrow for each assigned, not-yet-funded ticket in the stage. fn_hold_ticket_escrow
    -- reuses fn_check_spending_limit (AC2), isolates the escrow to project_stage_id (AC3) and
    -- writes the wallet-debit ledger entry (AC6). Each hold also tells its assignee they can start
    -- (AC5, `escrow.funded`).
    FOR t IN
        SELECT id FROM projects.tickets
        WHERE current_stage_id = p_stage_id
          AND current_assignee_id IS NOT NULL
          AND payment_status IN ('unpaid'::payment_status, 'needs_funding'::payment_status)
    LOOP
        v_escrow := finance.fn_hold_ticket_escrow(t.id);
        IF v_escrow IS NOT NULL THEN
            v_funded := v_funded + 1;
        END IF;
    END LOOP;

    IF v_funded = 0 THEN
        RAISE EXCEPTION 'No assigned, unfunded tickets available to fund in this stage.';
    END IF;

    SELECT COALESCE(SUM(amount_cents), 0) INTO v_total
    FROM finance.escrows
    WHERE project_stage_id = p_stage_id AND status = 'held';

    -- AC4: assigned -> active (in_progress).
    UPDATE projects.project_stages
    SET status = 'in_progress'::stage_status
    WHERE id = p_stage_id;

    RETURN jsonb_build_object(
        'funded_count', v_funded,
        'total_held_cents', v_total,
        'currency', COALESCE(v_currency, 'USD'),
        'stage_status', 'in_progress'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, comms, org, auth;

-- #region Decision #166 — Fund ONE ticket's escrow (single-ticket Buy now, a basket ticket line).
-- The same payer rule as fund_stage, then the PRODUCT_SPEC §5 purchasing gate (no description, not
-- purchasable), then exactly one hold at that ticket's own price through fn_hold_ticket_escrow. The
-- stage's status is NOT moved: its other tickets are still unfunded, so the stage stays partially
-- funded and fund_stage remains the separate whole-stage action. Called as the payer by
-- finance.place_wallet_order (a basket ticket line) and finance.settle_card_payment (a card lock that
-- names a ticket). A ticket nobody can be paid for yet (unclaimed, no team seat) is refused rather than
-- charged: #166(B)'s prepayment needs a funding-scope store that does not exist yet (flagged).
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
    -- The payee fn_hold_ticket_escrow resolves: an accepted team seat on the stage, else the claimant.
    IF t.assignee IS NULL AND NOT EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
         WHERE sa.project_stage_id = t.stage_id AND sa.assignee_type = 'team'
           AND sa.status = 'accepted' AND sa.team_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Nobody can be paid for "%" yet — it can be bought once it is claimed.', t.title
            USING ERRCODE = 'PU422';
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
        'currency', v_currency
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, comms, org, auth;
-- #endregion

CREATE OR REPLACE FUNCTION projects.cancel_stage_fair_exit(p_project_id uuid, p_stage_id uuid, p_tier integer)
RETURNS jsonb AS $$
DECLARE
    v_stage_name text;
    v_bp integer;
    t record;
    a record;
    v_cnt int := 0;
    v_paid bigint := 0;
    v_refunded bigint := 0;
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

    SELECT name INTO v_stage_name
    FROM projects.project_stages
    WHERE id = p_stage_id AND project_id = p_project_id;

    IF v_stage_name IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.' USING ERRCODE = 'no_data_found';
    END IF;

    FOR t IN
        SELECT DISTINCT ticket_id
        FROM finance.escrows
        WHERE project_stage_id = p_stage_id AND status = 'held' AND ticket_id IS NOT NULL
    LOOP
        PERFORM finance.fn_fair_exit_release(t.ticket_id, v_bp);
        v_cnt := v_cnt + 1;
    END LOOP;

    IF v_cnt = 0 THEN
        RAISE EXCEPTION 'No funded (held) escrow to cancel for this stage.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- Settlement totals, read back from the ledger for this stage's escrows.
    SELECT
        COALESCE(SUM(amount_cents) FILTER (WHERE reason IN ('fair_exit_release', 'team_split')), 0),
        COALESCE(SUM(amount_cents) FILTER (WHERE reason = 'fair_exit_refund'), 0)
    INTO v_paid, v_refunded
    FROM finance.transactions
    WHERE ref_table = 'escrows'
      AND ref_id IN (SELECT id FROM finance.escrows WHERE project_stage_id = p_stage_id);

    UPDATE projects.project_stages
    SET status = 'cancelled'::stage_status
    WHERE id = p_stage_id;

    FOR a IN
        SELECT DISTINCT current_assignee_id AS uid
        FROM projects.tickets
        WHERE current_stage_id = p_stage_id AND current_assignee_id IS NOT NULL
    LOOP
        PERFORM comms.fn_notify(
            a.uid, 'stage_cancelled', 'Stage cancelled (fair exit)',
            format('"%s" was cancelled — you were paid %s%% for work delivered.', v_stage_name, p_tier),
            'project_stages', p_stage_id
        );
    END LOOP;

    RETURN jsonb_build_object(
        'tier', p_tier,
        'cancelled_count', v_cnt,
        'freelancer_paid_cents', v_paid,
        'client_refunded_cents', v_refunded,
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

-- #region 6. Projective Unlock — fire the handover when the final escrow releases
-- Re-creates projects.approve_stage (0305) verbatim, then appends the handover transition: once no
-- stage of the project remains unsettled, the last escrow has just been released, so the protected
-- phase is lifted for the whole project and every participant is notified of the Contact Handover.
CREATE OR REPLACE FUNCTION projects.approve_stage(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_currency text;
    v_stage_name text;
    t record;
    a record;
    v_released int := 0;
    v_paid bigint := 0;
    v_fee bigint := 0;
    v_splits jsonb;
    v_unlocked boolean := false;
BEGIN
    -- 🚨 Releases every held escrow on the stage, so the guard is review authority, not
    -- `has_project_access`: the assignee has project access and must not approve their own stage.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to approve a stage.' USING ERRCODE = '42501';
    END IF;
    IF NOT projects.can_review_project(p_project_id) THEN
        RAISE EXCEPTION 'Only the client/owner may approve this stage.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.name, p.currency INTO v_stage_name, v_currency
    FROM projects.project_stages ps
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;

    IF v_stage_name IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.' USING ERRCODE = 'no_data_found';
    END IF;

    -- Release every held escrow for this stage's tickets. fn_release_ticket_escrow applies the
    -- 5% platform fee (AC2) and routes team payees through fn_split_team_payout (AC3).
    FOR t IN
        SELECT DISTINCT ticket_id
        FROM finance.escrows
        WHERE project_stage_id = p_stage_id AND status = 'held' AND ticket_id IS NOT NULL
    LOOP
        PERFORM finance.fn_release_ticket_escrow(t.ticket_id);
        v_released := v_released + 1;
    END LOOP;

    IF v_released = 0 THEN
        RAISE EXCEPTION 'No funded (held) escrow to release for this stage.'
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    SELECT COALESCE(SUM(amount_cents + deadline_bonus_cents - platform_fee_cents), 0),
           COALESCE(SUM(platform_fee_cents), 0)
    INTO v_paid, v_fee
    FROM finance.escrows
    WHERE project_stage_id = p_stage_id AND status = 'released';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'member_user_id', psp.member_user_id,
        'amount_cents', psp.amount_cents,
        'currency', psp.currency)), '[]'::jsonb)
    INTO v_splits
    FROM finance.payout_splits psp
    JOIN finance.escrows e ON e.id = psp.escrow_id
    WHERE e.project_stage_id = p_stage_id;

    UPDATE projects.project_stages
    SET status = 'paid'::stage_status, completed_at = now()
    WHERE id = p_stage_id;

    FOR a IN
        SELECT DISTINCT current_assignee_id AS uid
        FROM projects.tickets
        WHERE current_stage_id = p_stage_id AND current_assignee_id IS NOT NULL
    LOOP
        PERFORM comms.fn_notify(
            a.uid, 'stage_approved', 'Stage approved & paid',
            format('"%s" was approved — your payout has been released.', v_stage_name),
            'project_stages', p_stage_id
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
