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

-- #region US-005 — Fund an assigned stage's escrow.
CREATE OR REPLACE FUNCTION projects.fund_stage(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_status stage_status;
    v_currency text;
    v_stage_name text;
    t record;
    a record;
    v_escrow uuid;
    v_funded int := 0;
    v_total bigint := 0;
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.status, ps.name, p.currency
    INTO v_status, v_stage_name, v_currency
    FROM projects.project_stages ps
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.';
    END IF;

    -- AC1: only an assigned stage may be funded.
    IF v_status <> 'assigned'::stage_status THEN
        RAISE EXCEPTION 'Stage must be in the assigned state to fund escrow (current: %).', v_status;
    END IF;

    -- Hold escrow for each assigned, not-yet-funded ticket in the stage. fn_hold_ticket_escrow
    -- reuses fn_check_spending_limit (AC2), isolates the escrow to project_stage_id (AC3) and
    -- writes the wallet-debit ledger entry (AC6).
    FOR t IN
        SELECT id FROM projects.tickets
        WHERE current_stage_id = p_stage_id
          AND current_assignee_id IS NOT NULL
          AND payment_status = 'unpaid'::payment_status
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

    -- AC5: notify each assignee the stage is funded (streamed via realtime).
    FOR a IN
        SELECT DISTINCT current_assignee_id AS uid
        FROM projects.tickets
        WHERE current_stage_id = p_stage_id AND current_assignee_id IS NOT NULL
    LOOP
        PERFORM comms.fn_notify(
            a.uid, 'stage_funded', 'Stage funded',
            format('Escrow for "%s" is secured — work can begin.', v_stage_name),
            'project_stages', p_stage_id
        );
    END LOOP;

    RETURN jsonb_build_object(
        'funded_count', v_funded,
        'total_held_cents', v_total,
        'currency', COALESCE(v_currency, 'USD'),
        'stage_status', 'in_progress'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, comms, org, auth;

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
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;

    IF p_tier NOT IN (25, 50, 75) THEN
        RAISE EXCEPTION 'Fair-exit tier must be 25, 50, or 75 (got %).', p_tier;
    END IF;
    v_bp := p_tier * 100;   -- percent -> basis points

    SELECT name INTO v_stage_name
    FROM projects.project_stages
    WHERE id = p_stage_id AND project_id = p_project_id;

    IF v_stage_name IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.';
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
        RAISE EXCEPTION 'No funded (held) escrow to cancel for this stage.';
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
        RAISE EXCEPTION 'Stage not found for this project.';
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
      AND payment_status = 'unpaid'::payment_status;

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
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'Not authorized for this project.' USING ERRCODE = '42501';
    END IF;

    SELECT ps.name, p.currency INTO v_stage_name, v_currency
    FROM projects.project_stages ps
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;

    IF v_stage_name IS NULL THEN
        RAISE EXCEPTION 'Stage not found for this project.';
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
        RAISE EXCEPTION 'No funded (held) escrow to release for this stage.';
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
