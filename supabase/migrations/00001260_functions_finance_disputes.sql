-- =============================================================================================
-- 00001260_functions_finance_disputes.sql — the platform dispute lifecycle (Decision #212).
--
-- A `finance.disputes` row contests ONE held escrow. Until this file nothing ever moved one: a
-- no-show claim (`projects.claim_session_no_show`, 00001155) opened a row, the session sweep refused
-- to release a seat with an open claim, and no function, route or person could close it — the seat's
-- money stayed held forever. The lifecycle (PRODUCT_MANAGEMENT §3.8, PRODUCT_SPEC §Dispute Resolution):
--
--   open ──(the sitting ends: attendance audit)──► resolved_refund   provider no-show (15-minute rule)
--                                              ──► resolved_release  both in the room ≥ 80 % — dismissed
--                                              ──► awaiting_response the logs are ambiguous
--   awaiting_response ──(the counterparty responds | either party escalates | respond_by passes)
--                     ──► under_review   (review_by = now + dispute_review_hours — the review SLA)
--   open | awaiting_response | under_review ──(an operator rules)──► resolved_release | resolved_refund
--                                                                  | resolved_split
--
-- The review SLA is a target, never a ruling: the platform does not rule on money without a human
-- (Decision #212(c)). An `under_review` case past `review_by` stays held; the sweep raises an ops
-- alert and tells every operator, at most once a day per case, until somebody rules.
--
-- A resolved row is terminal, and no row is ever deleted (finance.fn_dispute_records_immutable,
-- bound in 00001830). Every money move goes through the per-escrow seat primitives in 00001155
-- (fn_release_seat_escrow / fn_refund_seat_escrow) or fn_split_seat_escrow below, which uses Fair
-- Exit's arithmetic (finance.fn_fair_exit_split) — each moves a row only while it is `held`.
--
--   1. Context & party      fn_escrow_has_open_dispute · fn_dispute_context · fn_dispute_party
--   2. Attendance audit     fn_dispute_attendance_audit — PRODUCT_SPEC §Dispute Resolution 3
--   3. Split primitive      fn_split_seat_escrow
--   4. Settlement           fn_settle_dispute — the one writer of a resolved_* status
--   5. Advance              fn_advance_dispute — open → audit → ruling or awaiting_response
--   6. User doors           respond_to_dispute · escalate_dispute · get_dispute
--   7. Operator doors       list_disputes_for_review · resolve_dispute — security.is_admin() only
--   8. The sweep            sweep_disputes — scheduled every 15 minutes (00005060)
--   9. Immutability         fn_dispute_records_immutable (trigger function)
--
-- Grants: 00002510 (#region Disputes). Params: `dispute_response_hours` (48),
-- `dispute_review_hours` (72), `dispute_dismiss_presence_pct` (80) in 00005001.
-- =============================================================================================

-- #region 1. Context, party and the one "live dispute" predicate
-- Whether a dispute still stands against an escrow — what every release path asks before paying out.
-- The ONE place the live set (open · awaiting_response · under_review) is spelled for a caller.
CREATE OR REPLACE FUNCTION finance.fn_escrow_has_open_dispute(p_escrow_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM finance.disputes d
         WHERE d.escrow_id = p_escrow_id AND d.status IN ('open', 'awaiting_response', 'under_review')
    );
$$;

-- Everything a dispute's doors need about the engagement it sits on, in one row: the seat escrow's
-- project, its owner (the respondent of record), the claimant and the sitting's title.
CREATE OR REPLACE FUNCTION finance.fn_dispute_context(p_dispute_id uuid)
RETURNS TABLE (
    dispute_id uuid,
    escrow_id uuid,
    project_id uuid,
    project_slug text,
    owner_user_id uuid,
    claimant uuid,
    event_title text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT d.id, d.escrow_id, p.id, p.slug, p.owner_user_id, d.opened_by_profile,
           COALESCE(se.title, p.title)
      FROM finance.disputes d
      JOIN finance.escrows e ON e.id = d.escrow_id
      JOIN projects.project_stages ps ON ps.id = e.project_stage_id
      JOIN projects.projects p ON p.id = ps.project_id
      LEFT JOIN projects.session_events se ON se.id = d.session_event_id
     WHERE d.id = p_dispute_id;
END;
$$;

-- Which side of a dispute a user is on: `claimant` (who opened it), `respondent` (who delivers the
-- engagement — its owner or an active member of the owning team), or NULL. A platform operator is not
-- a party; callers check security.is_admin() separately.
CREATE OR REPLACE FUNCTION finance.fn_dispute_party(p_dispute_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ctx record;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_ctx FROM finance.fn_dispute_context(p_dispute_id);
    IF v_ctx.dispute_id IS NULL THEN
        RETURN NULL;
    END IF;
    IF v_ctx.claimant = p_user_id THEN
        RETURN 'claimant';
    END IF;
    IF projects.fn_is_session_host(v_ctx.project_id, p_user_id) THEN
        RETURN 'respondent';
    END IF;
    RETURN NULL;
END;
$$;

-- The review SLA a case gets as it enters `under_review`: p_from + `dispute_review_hours` (72). Every
-- door into review (the respondent's statement, an escalation, the sweep's auto-escalation) stamps it,
-- so `ck_disputes_review_deadline` holds. A target for the operators, never a ruling.
CREATE OR REPLACE FUNCTION finance.fn_dispute_review_by(p_from timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_from + pg_catalog.make_interval(hours => projects.fn_session_param('dispute_review_hours', 72));
$$;
-- #endregion

-- #region 2. The attendance audit
-- PRODUCT_SPEC §Dispute Resolution 3, "Deterministic Ruling", judged on the room's own logs:
--   pending    the sitting has not ended — the logs are not complete yet
--   refund     the 15-minute rule says provider_no_show (fn_session_presence): seated attendees were
--              in the room in time and the host was not — the same verdict the session sweep refunds on
--   dismiss    a tracked room shows BOTH the host and the claimant in it for at least
--              `dispute_dismiss_presence_pct` (80) % of the sitting
--   ambiguous  anything else, including an untracked room (a silent webhook is not evidence) — the case
--              goes to the counterparty, then to an auditor
-- Only webhook rows count towards a dismissal: a host-attested row (record_host_attendance) is the
-- respondent's own word, so it cannot dismiss a claim against them. A row keeps the FIRST join and the
-- LAST leave (a rejoin clears left_at), so time in the room is that span, clipped to the sitting.
-- Returns the snapshot stored on the dispute as `audit`; NULL for a dispute with no sitting.
CREATE OR REPLACE FUNCTION finance.fn_dispute_attendance_audit(p_dispute_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_d finance.disputes;
    v_event projects.session_events;
    v_project uuid;
    v_presence jsonb;
    v_span numeric;
    v_host_pct integer;
    v_claimant_pct integer;
    v_threshold integer := projects.fn_session_param('dispute_dismiss_presence_pct', 80);
BEGIN
    SELECT * INTO v_d FROM finance.disputes WHERE id = p_dispute_id;
    IF NOT FOUND OR v_d.session_event_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_event FROM projects.session_events WHERE id = v_d.session_event_id;
    SELECT c.project_id INTO v_project FROM projects.cohorts c WHERE c.id = v_event.cohort_id;
    v_presence := projects.fn_session_presence(v_event.id);
    v_span := EXTRACT(epoch FROM v_event.end_time - v_event.start_time);

    SELECT COALESCE(max(pg_catalog.floor(100 * GREATEST(EXTRACT(epoch FROM
               LEAST(COALESCE(a.left_at, v_event.end_time), v_event.end_time)
               - GREATEST(a.joined_at, v_event.start_time)), 0) / v_span)), 0)::integer
      INTO v_host_pct
      FROM projects.session_attendance a
     WHERE a.session_event_id = v_event.id AND a.source = 'webhook'
       AND projects.fn_is_session_host(v_project, a.user_id);

    SELECT COALESCE(max(pg_catalog.floor(100 * GREATEST(EXTRACT(epoch FROM
               LEAST(COALESCE(a.left_at, v_event.end_time), v_event.end_time)
               - GREATEST(a.joined_at, v_event.start_time)), 0) / v_span)), 0)::integer
      INTO v_claimant_pct
      FROM projects.session_attendance a
     WHERE a.session_event_id = v_event.id AND a.source = 'webhook' AND a.user_id = v_d.opened_by_profile;

    RETURN pg_catalog.jsonb_build_object(
        'event_id', v_event.id,
        'presence_outcome', v_presence ->> 'outcome',
        'tracked', COALESCE((v_presence ->> 'tracked')::boolean, false),
        'host_presence_pct', v_host_pct,
        'claimant_presence_pct', v_claimant_pct,
        'threshold_pct', v_threshold,
        'audited_at', pg_catalog.now(),
        'verdict', CASE
            WHEN pg_catalog.now() < v_event.end_time THEN 'pending'
            WHEN v_presence ->> 'outcome' = 'provider_no_show' THEN 'refund'
            WHEN COALESCE((v_presence ->> 'tracked')::boolean, false)
                 AND v_host_pct >= v_threshold AND v_claimant_pct >= v_threshold THEN 'dismiss'
            ELSE 'ambiguous'
        END
    );
END;
$$;
-- #endregion

-- #region 3. The split primitive
-- One held seat escrow divided by a ruling: the payee earns p_bp basis points of the principal less the
-- platform fee on that share, the payer gets the rest back fee-free — finance.fn_fair_exit_split's
-- arithmetic (Decision #198), so a split ruling and a Fair Exit can never price the same share
-- differently. The same wallet rules and ledger reasons as the release and refund twins in 00001155
-- (`escrow_release` · `escrow_refund`). Moves the row only while it is `held`; NULL otherwise.
CREATE OR REPLACE FUNCTION finance.fn_split_seat_escrow(p_escrow_id uuid, p_bp integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, finance, projects, security, org, auth
AS $$
DECLARE
    r finance.escrows;
    v_fee bigint;
    v_payout bigint;
    v_refund bigint;
    v_wallet text;
BEGIN
    IF p_bp IS NULL OR p_bp NOT BETWEEN 1 AND 9999 THEN
        RAISE EXCEPTION 'A split gives the provider between 0.01 %% and 99.99 %%' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO r FROM finance.escrows WHERE id = p_escrow_id AND status = 'held' FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT s.fee_cents, s.payout_cents, s.refund_cents INTO v_fee, v_payout, v_refund
      FROM finance.fn_fair_exit_split(r.amount_cents, p_bp,
               finance.fn_escrow_fee_bp(r.payer_business_id, r.payer_user_id)) s;

    UPDATE finance.escrows SET status = 'released', platform_fee_cents = v_fee, released_at = now() WHERE id = r.id;
    IF v_payout > 0 THEN
        IF r.payee_type = 'team'::assignment_type THEN
            PERFORM finance.fn_split_team_payout(r.id, r.payee_id, v_payout, r.currency, 'escrow_release');
        ELSE
            v_wallet := finance.fn_person_wallet_type(r.payee_id);
            PERFORM finance.fn_ensure_wallet(v_wallet, r.payee_id, r.currency);
            PERFORM finance.fn_wallet_credit_pending(r.payee_id, v_wallet, r.currency, v_payout, 'escrow_release', 'escrows', r.id);
        END IF;
    END IF;
    IF v_refund > 0 THEN
        v_wallet := finance.fn_escrow_payer_wallet_type(r.payer_business_id, r.payer_user_id);
        PERFORM finance.fn_ensure_wallet(v_wallet, COALESCE(r.payer_business_id, r.payer_user_id), r.currency);
        PERFORM finance.fn_wallet_credit(COALESCE(r.payer_business_id, r.payer_user_id), v_wallet, r.currency,
            v_refund, 'escrow_refund', 'escrows', r.id);
    END IF;
    RETURN pg_catalog.jsonb_build_object('payee_minor', v_payout, 'fee_minor', v_fee, 'refund_minor', v_refund);
END;
$$;
-- #endregion

-- #region 4. Settlement — the one writer of a resolved status
-- Closes a dispute and moves its escrow to match, under the dispute's row lock then the escrow's:
--   release  the claim is dismissed. A whole-cohort seat escrow (no `session_event_id`) whose cohort
--            still has sittings ahead is NOT paid early — it stays held and the session sweep releases
--            it after the last sitting, as it would have without a claim (`settlement.deferred`).
--            Anything else — a per-sitting escrow (Decision #211), or a cohort that is over — is
--            released now through fn_release_seat_escrow.
--   refund   fn_refund_seat_escrow (as the sweep's provider-no-show refund does).
--   split    fn_split_seat_escrow at p_bp.
-- The seat follows its money through projects.fn_settle_membership_state (00001155, Decision #211 —
-- the session sweep's own rule): once it holds no other escrow it is `completed` if anything was paid
-- to the provider (a release or a split), `cancelled` if nothing was (a refund). While the rest of a
-- set-session block is still held, it stays `active`.
-- An escrow that already left `held` by another path (the sweep's no-show refund, a forfeit, a lost
-- chargeback's refund) is recorded as it settled — `refunded` → resolved_refund, `released` →
-- resolved_release — whatever was asked (`settlement.by_fact`). A frozen (`disputed`) escrow waits for
-- its card dispute. Only seat escrows can be settled here: no door opens a dispute on anything else.
-- p_actor NULL is the platform's own audit. Notifies both parties (`dispute.resolved`).
CREATE OR REPLACE FUNCTION finance.fn_settle_dispute(
    p_dispute_id uuid,
    p_outcome text,
    p_bp integer,
    p_actor uuid,
    p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_d finance.disputes;
    v_e finance.escrows;
    v_ctx record;
    v_status public.dispute_status;
    v_settlement jsonb;
    v_moved bigint;
    v_ahead boolean;
    v_title text;
    v_body text;
    v_party uuid;
BEGIN
    SELECT * INTO v_d FROM finance.disputes WHERE id = p_dispute_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That dispute does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_d.status::text LIKE 'resolved\_%' THEN
        RAISE EXCEPTION 'This dispute is already resolved' USING ERRCODE = 'PS409';
    END IF;
    IF p_outcome IS NULL OR p_outcome NOT IN ('release', 'refund', 'split') THEN
        RAISE EXCEPTION 'A ruling is release, refund or split' USING ERRCODE = '22023';
    END IF;
    IF p_outcome = 'split' AND (p_bp IS NULL OR p_bp NOT BETWEEN 1 AND 9999) THEN
        RAISE EXCEPTION 'A split gives the provider between 0.01 %% and 99.99 %%' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_e FROM finance.escrows WHERE id = v_d.escrow_id FOR UPDATE;
    IF v_e.cohort_membership_id IS NULL THEN
        RAISE EXCEPTION 'Only a seat payment can be settled through a dispute' USING ERRCODE = 'PS409';
    END IF;
    SELECT * INTO v_ctx FROM finance.fn_dispute_context(v_d.id);

    IF v_e.status = 'disputed' THEN
        RAISE EXCEPTION 'A card dispute has frozen this payment; it settles first' USING ERRCODE = 'PS409';
    ELSIF v_e.status <> 'held' THEN
        v_status := CASE WHEN v_e.status = 'refunded' THEN 'resolved_refund' ELSE 'resolved_release' END;
        v_settlement := pg_catalog.jsonb_build_object('by_fact', true, 'escrow_status', v_e.status,
            'currency', v_e.currency);
    ELSIF p_outcome = 'release' THEN
        v_status := 'resolved_release';
        SELECT EXISTS (
            SELECT 1 FROM projects.cohort_memberships cm
              JOIN projects.session_events se ON se.cohort_id = cm.cohort_id
             WHERE cm.id = v_e.cohort_membership_id AND se.status = 'scheduled'
               AND se.end_time > pg_catalog.now()
        ) INTO v_ahead;
        IF v_ahead AND v_e.session_event_id IS NULL THEN
            v_settlement := pg_catalog.jsonb_build_object('deferred', true, 'payee_minor', 0, 'fee_minor', 0,
                'refund_minor', 0, 'currency', v_e.currency);
        ELSE
            v_moved := finance.fn_release_seat_escrow(v_e.id, 'escrow_release');
            PERFORM projects.fn_settle_membership_state(v_e.cohort_membership_id);
            v_settlement := pg_catalog.jsonb_build_object('payee_minor', v_moved,
                'fee_minor', (SELECT e.platform_fee_cents FROM finance.escrows e WHERE e.id = v_e.id),
                'refund_minor', 0, 'currency', v_e.currency);
        END IF;
    ELSE
        IF p_outcome = 'refund' THEN
            v_status := 'resolved_refund';
            v_moved := finance.fn_refund_seat_escrow(v_e.id);
            v_settlement := pg_catalog.jsonb_build_object('payee_minor', 0, 'fee_minor', 0,
                'refund_minor', v_moved, 'currency', v_e.currency);
        ELSE
            v_status := 'resolved_split';
            v_settlement := finance.fn_split_seat_escrow(v_e.id, p_bp)
                || pg_catalog.jsonb_build_object('currency', v_e.currency);
        END IF;
        PERFORM projects.fn_settle_membership_state(v_e.cohort_membership_id);
    END IF;

    UPDATE finance.disputes
       SET status = v_status,
           resolved_at = pg_catalog.now(),
           resolved_by = p_actor,
           resolution_notes = NULLIF(pg_catalog.btrim(COALESCE(p_notes, '')), ''),
           payee_share_bp = CASE WHEN v_status = 'resolved_split' THEN p_bp END,
           settlement = v_settlement,
           updated_at = pg_catalog.now()
     WHERE id = v_d.id;

    v_title := CASE v_status
        WHEN 'resolved_refund' THEN 'No-show claim upheld — refunded'
        WHEN 'resolved_split' THEN 'Dispute settled — payment split'
        ELSE 'No-show claim dismissed' END;
    v_body := pg_catalog.format('The dispute on "%s" is closed. %s', v_ctx.event_title, CASE v_status
        WHEN 'resolved_refund' THEN 'The seat''s payment was returned to the attendee.'
        WHEN 'resolved_split' THEN 'The payment was divided between the provider and the attendee.'
        ELSE 'The payment goes to the provider.' END);
    FOREACH v_party IN ARRAY ARRAY[v_ctx.claimant, v_ctx.owner_user_id] LOOP
        PERFORM comms.fn_notify(
            v_party, 'dispute.resolved', v_title, v_body, 'finance.disputes', v_d.id,
            pg_catalog.jsonb_build_object('status', v_status, 'settlement', v_settlement),
            p_actor, 'project', v_ctx.project_id, NULL, '/projects/' || v_ctx.project_slug
        );
    END LOOP;

    RETURN pg_catalog.jsonb_build_object('dispute_id', v_d.id, 'status', v_status, 'settlement', v_settlement);
END;
$$;
-- #endregion

-- #region 5. Advance — the audit decides, or the counterparty is asked
-- Moves an `open` dispute on: runs the attendance audit and either rules (refund / dismiss, through
-- fn_settle_dispute as the platform) or hands the case to the respondent with a deadline,
-- `dispute_response_hours` (48) — PRODUCT_SPEC §Dispute Resolution 2's cooling-off window. A sitting
-- still running leaves it `open` (the sweep comes back). A dispute with no sitting goes straight to the
-- respondent. Anything not `open` is returned as it stands.
CREATE OR REPLACE FUNCTION finance.fn_advance_dispute(p_dispute_id uuid)
RETURNS public.dispute_status
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_d finance.disputes;
    v_audit jsonb;
    v_ctx record;
    v_verdict text;
    v_respond_by timestamptz;
BEGIN
    SELECT * INTO v_d FROM finance.disputes WHERE id = p_dispute_id FOR UPDATE;
    IF NOT FOUND OR v_d.status <> 'open' THEN
        RETURN v_d.status;
    END IF;
    v_audit := finance.fn_dispute_attendance_audit(v_d.id);
    v_verdict := COALESCE(v_audit ->> 'verdict', 'ambiguous');
    IF v_verdict = 'pending' THEN
        RETURN 'open';
    END IF;

    UPDATE finance.disputes SET audit = v_audit, updated_at = pg_catalog.now() WHERE id = v_d.id;
    IF v_verdict = 'refund' THEN
        PERFORM finance.fn_settle_dispute(v_d.id, 'refund', NULL, NULL,
            'Attendance audit: the provider was not in the room within the presence window.');
        RETURN 'resolved_refund';
    ELSIF v_verdict = 'dismiss' THEN
        PERFORM finance.fn_settle_dispute(v_d.id, 'release', NULL, NULL,
            pg_catalog.format('Attendance audit: the provider and the attendee were both in the room for at least %s %% of the sitting.',
                v_audit ->> 'threshold_pct'));
        RETURN 'resolved_release';
    END IF;

    v_respond_by := pg_catalog.now() + pg_catalog.make_interval(
        hours => projects.fn_session_param('dispute_response_hours', 48));
    UPDATE finance.disputes
       SET status = 'awaiting_response', respond_by = v_respond_by, updated_at = pg_catalog.now()
     WHERE id = v_d.id;
    SELECT * INTO v_ctx FROM finance.fn_dispute_context(v_d.id);
    PERFORM comms.fn_notify(
        v_ctx.owner_user_id, 'dispute.response_requested', 'Respond to a no-show claim',
        pg_catalog.format('The room''s logs for "%s" do not settle the claim. Add your account and any evidence by %s, or it goes to a Projective auditor.',
            v_ctx.event_title, pg_catalog.to_char(v_respond_by AT TIME ZONE 'UTC', 'DD Mon YYYY HH24:MI "UTC"')),
        'finance.disputes', v_d.id, pg_catalog.jsonb_build_object('respond_by', v_respond_by),
        NULL, 'project', v_ctx.project_id, NULL, '/projects/' || v_ctx.project_slug
    );
    RETURN 'awaiting_response';
END;
$$;
-- #endregion

-- #region 6. User doors — respond, escalate, read
-- Either party adds a statement, with up to ten of their own uploaded files as evidence, while the
-- dispute is live. The RESPONDENT's statement on an `awaiting_response` case is the response it was
-- waiting for: the case goes to an auditor (`under_review`) and both sides are told. Messages and
-- evidence are append-only (00001830). A caller who is not a party gets "does not exist".
CREATE OR REPLACE FUNCTION finance.respond_to_dispute(
    p_dispute_id uuid,
    p_statement text,
    p_file_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_d finance.disputes;
    v_party text;
    v_body text := pg_catalog.btrim(COALESCE(p_statement, ''));
    v_files uuid[] := COALESCE(p_file_ids, '{}'::uuid[]);
    v_message uuid;
    v_status public.dispute_status;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to respond' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_d FROM finance.disputes WHERE id = p_dispute_id FOR UPDATE;
    v_party := CASE WHEN FOUND THEN finance.fn_dispute_party(v_d.id, v_uid) END;
    IF v_party IS NULL THEN
        RAISE EXCEPTION 'That dispute does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_d.status::text LIKE 'resolved\_%' THEN
        RAISE EXCEPTION 'This dispute is closed' USING ERRCODE = 'PS409';
    END IF;
    IF pg_catalog.length(v_body) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION 'Write a statement of up to 4,000 characters' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.cardinality(v_files) > 10 THEN
        RAISE EXCEPTION 'Attach at most ten files' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.unnest(v_files) f(id)
         WHERE NOT EXISTS (
             SELECT 1 FROM files.items i
              WHERE i.id = f.id AND i.owner_user_id = v_uid AND i.deleted_at IS NULL
                AND i.status = 'uploaded'
         )
    ) THEN
        RAISE EXCEPTION 'Evidence must be your own uploaded files' USING ERRCODE = '22023';
    END IF;

    INSERT INTO finance.dispute_messages (dispute_id, sender_user_id, party, body)
    VALUES (v_d.id, v_uid, v_party, v_body)
    RETURNING id INTO v_message;
    INSERT INTO finance.dispute_evidence (dispute_id, message_id, file_id, submitted_by)
    SELECT DISTINCT v_d.id, v_message, f.id, v_uid FROM pg_catalog.unnest(v_files) f(id);

    v_status := v_d.status;
    IF v_party = 'respondent' THEN
        UPDATE finance.disputes
           SET responded_at = COALESCE(responded_at, pg_catalog.now()),
               status = CASE WHEN status = 'awaiting_response' THEN 'under_review'::public.dispute_status ELSE status END,
               escalated_at = CASE WHEN status = 'awaiting_response' THEN pg_catalog.now() ELSE escalated_at END,
               review_by = CASE WHEN status = 'awaiting_response'
                                THEN finance.fn_dispute_review_by(pg_catalog.now()) ELSE review_by END,
               updated_at = pg_catalog.now()
         WHERE id = v_d.id
        RETURNING status INTO v_status;
        IF v_d.status = 'awaiting_response' THEN
            PERFORM finance.fn_notify_dispute_escalated(v_d.id, v_uid, 'The provider responded');
        END IF;
    END IF;
    RETURN pg_catalog.jsonb_build_object('dispute_id', v_d.id, 'status', v_status, 'message_id', v_message,
        'files', pg_catalog.cardinality(v_files));
END;
$$;

-- Either party sends an `awaiting_response` case to an auditor before its deadline (PRODUCT_SPEC
-- §Dispute Resolution 2, Phase 2: "either party can escalate"). Idempotent on `under_review`; an
-- `open` case is still waiting for its sitting to end and the audit to run.
CREATE OR REPLACE FUNCTION finance.escalate_dispute(p_dispute_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_d finance.disputes;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to escalate' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_d FROM finance.disputes WHERE id = p_dispute_id FOR UPDATE;
    IF NOT FOUND OR finance.fn_dispute_party(v_d.id, v_uid) IS NULL THEN
        RAISE EXCEPTION 'That dispute does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_d.status = 'under_review' THEN
        RETURN pg_catalog.jsonb_build_object('dispute_id', v_d.id, 'status', v_d.status);
    END IF;
    IF v_d.status = 'open' THEN
        RAISE EXCEPTION 'The attendance audit runs when the sitting ends; escalate after that' USING ERRCODE = 'PS409';
    END IF;
    IF v_d.status <> 'awaiting_response' THEN
        RAISE EXCEPTION 'This dispute is closed' USING ERRCODE = 'PS409';
    END IF;
    UPDATE finance.disputes
       SET status = 'under_review', escalated_at = pg_catalog.now(),
           review_by = finance.fn_dispute_review_by(pg_catalog.now()), updated_at = pg_catalog.now()
     WHERE id = v_d.id;
    PERFORM finance.fn_notify_dispute_escalated(v_d.id, v_uid, 'A party escalated the case');
    RETURN pg_catalog.jsonb_build_object('dispute_id', v_d.id, 'status', 'under_review');
END;
$$;

-- Tells both parties a case went to an auditor (`dispute.escalated`).
CREATE OR REPLACE FUNCTION finance.fn_notify_dispute_escalated(p_dispute_id uuid, p_actor uuid, p_why text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ctx record;
    v_party uuid;
BEGIN
    SELECT * INTO v_ctx FROM finance.fn_dispute_context(p_dispute_id);
    IF v_ctx.dispute_id IS NULL THEN
        RETURN;
    END IF;
    FOREACH v_party IN ARRAY ARRAY[v_ctx.claimant, v_ctx.owner_user_id] LOOP
        PERFORM comms.fn_notify(
            v_party, 'dispute.escalated', 'Dispute sent to an auditor',
            pg_catalog.format('%s on the claim about "%s". A Projective auditor will review the evidence and rule; the payment stays held until then.',
                p_why, v_ctx.event_title),
            'finance.disputes', p_dispute_id, '{}'::jsonb, p_actor, 'project', v_ctx.project_id, NULL,
            '/projects/' || v_ctx.project_slug
        );
    END LOOP;
END;
$$;

-- The dispute as its reader may see it: a party (claimant or respondent) or a platform operator; NULL
-- for anyone else. Carries what the status panel renders — the sitting, the money at stake, the audit
-- snapshot, the deadline, every statement with its evidence files' metadata (the files themselves are
-- served by the app after this read admits the caller), and which actions are open to the caller.
CREATE OR REPLACE FUNCTION finance.get_dispute(p_dispute_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_d finance.disputes;
    v_e finance.escrows;
    v_ctx record;
    v_role text;
    v_live boolean;
BEGIN
    SELECT * INTO v_d FROM finance.disputes WHERE id = p_dispute_id;
    IF NOT FOUND OR v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    v_role := finance.fn_dispute_party(v_d.id, v_uid);
    IF v_role IS NULL AND security.is_admin() THEN
        v_role := 'operator';
    END IF;
    IF v_role IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_e FROM finance.escrows WHERE id = v_d.escrow_id;
    SELECT * INTO v_ctx FROM finance.fn_dispute_context(v_d.id);
    v_live := v_d.status IN ('open', 'awaiting_response', 'under_review');

    RETURN pg_catalog.jsonb_build_object(
        'id', v_d.id,
        'kind', CASE WHEN v_d.session_event_id IS NOT NULL THEN 'no_show' ELSE 'general' END,
        'status', v_d.status,
        'role', v_role,
        'reason', v_d.reason,
        'opened_at', v_d.created_at,
        'respond_by', v_d.respond_by,
        'responded_at', v_d.responded_at,
        'escalated_at', v_d.escalated_at,
        'review_by', v_d.review_by,
        'resolved_at', v_d.resolved_at,
        'resolution_notes', v_d.resolution_notes,
        'resolved_by_operator', v_d.resolved_by IS NOT NULL,
        'payee_share_bp', v_d.payee_share_bp,
        'settlement', v_d.settlement,
        'audit', v_d.audit,
        'amount_minor', v_e.amount_cents,
        'currency', v_e.currency,
        'project', pg_catalog.jsonb_build_object('id', v_ctx.project_id, 'slug', v_ctx.project_slug),
        'sitting', (
            SELECT pg_catalog.jsonb_build_object('id', se.id, 'slug', se.slug, 'title', se.title,
                       'starts_at', se.start_time, 'ends_at', se.end_time)
              FROM projects.session_events se WHERE se.id = v_d.session_event_id
        ),
        'messages', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', m.id, 'party', m.party, 'body', m.body, 'created_at', m.created_at,
                'mine', m.sender_user_id = v_uid,
                'files', COALESCE((
                    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'id', i.id, 'name', i.display_name, 'mime_type', i.mime_type, 'size_bytes', i.size_bytes
                    ) ORDER BY ev.created_at, i.id)
                      FROM finance.dispute_evidence ev
                      JOIN files.items i ON i.id = ev.file_id
                     WHERE ev.message_id = m.id
                ), '[]'::jsonb)
            ) ORDER BY m.created_at, m.id)
              FROM finance.dispute_messages m WHERE m.dispute_id = v_d.id
        ), '[]'::jsonb),
        'can_respond', v_live AND v_role IN ('claimant', 'respondent'),
        'can_escalate', v_d.status = 'awaiting_response' AND v_role IN ('claimant', 'respondent'),
        'can_resolve', v_live AND v_role = 'operator'
    );
END;
$$;
-- #endregion

-- #region 7. The operator doors
-- The operator queue (`/admin/disputes`): every LIVE dispute, or those in one live status, with what a
-- reviewer triages on — the parties, the money at stake, the sitting, the deadline that applies and
-- whether the review SLA has passed — oldest-due first (`under_review` by `review_by`, then
-- `awaiting_response` by `respond_by`, then `open` by when it was raised). `counts` covers the whole
-- live set, so a filtered read still names every tab. security.is_admin() only: anyone else gets
-- 42501, which the page answers with a 404 (the desk's existence is not disclosed). At most 200 rows.
CREATE OR REPLACE FUNCTION finance.list_disputes_for_review(p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now timestamptz := pg_catalog.now();
BEGIN
    IF auth.uid() IS NULL OR NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only a platform operator can read the dispute queue' USING ERRCODE = '42501';
    END IF;
    IF p_status IS NOT NULL AND p_status NOT IN ('open', 'awaiting_response', 'under_review') THEN
        RAISE EXCEPTION 'The queue lists live disputes: open, awaiting_response or under_review' USING ERRCODE = '22023';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'counts', (
            SELECT pg_catalog.jsonb_build_object(
                'open', pg_catalog.count(*) FILTER (WHERE d.status = 'open'),
                'awaiting_response', pg_catalog.count(*) FILTER (WHERE d.status = 'awaiting_response'),
                'under_review', pg_catalog.count(*) FILTER (WHERE d.status = 'under_review'),
                'overdue', pg_catalog.count(*) FILTER (WHERE d.status = 'under_review' AND d.review_by <= v_now)
            )
              FROM finance.disputes d
             WHERE d.status IN ('open', 'awaiting_response', 'under_review')
        ),
        'items', COALESCE((
            SELECT pg_catalog.jsonb_agg(q.item ORDER BY q.rank, q.due, q.id)
              FROM (
                  SELECT d.id,
                         CASE d.status WHEN 'under_review' THEN 0 WHEN 'awaiting_response' THEN 1 ELSE 2 END AS rank,
                         COALESCE(CASE d.status WHEN 'under_review' THEN d.review_by
                                                WHEN 'awaiting_response' THEN d.respond_by END,
                                  d.created_at) AS due,
                         pg_catalog.jsonb_build_object(
                             'id', d.id,
                             'status', d.status,
                             'kind', CASE WHEN d.session_event_id IS NOT NULL THEN 'no_show' ELSE 'general' END,
                             'reason', d.reason,
                             'opened_at', d.created_at,
                             'respond_by', d.respond_by,
                             'escalated_at', d.escalated_at,
                             'review_by', d.review_by,
                             'overdue', d.status = 'under_review' AND d.review_by <= v_now,
                             'amount_minor', e.amount_cents,
                             'currency', e.currency,
                             'project', pg_catalog.jsonb_build_object('slug', p.slug, 'title', p.title),
                             'sitting', CASE WHEN se.id IS NOT NULL THEN pg_catalog.jsonb_build_object(
                                 'title', se.title, 'starts_at', se.start_time, 'ends_at', se.end_time) END,
                             'claimant', pg_catalog.jsonb_build_object(
                                 'name', NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', cu.first_name, cu.last_name)), ''),
                                 'handle', cu.username),
                             'respondent', pg_catalog.jsonb_build_object(
                                 'name', NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', ou.first_name, ou.last_name)), ''),
                                 'handle', ou.username),
                             'statements', (SELECT pg_catalog.count(*) FROM finance.dispute_messages m
                                             WHERE m.dispute_id = d.id),
                             'evidence', (SELECT pg_catalog.count(*) FROM finance.dispute_evidence ev
                                           WHERE ev.dispute_id = d.id)
                         ) AS item
                    FROM finance.disputes d
                    JOIN finance.escrows e ON e.id = d.escrow_id
                    JOIN projects.project_stages ps ON ps.id = e.project_stage_id
                    JOIN projects.projects p ON p.id = ps.project_id
                    LEFT JOIN projects.session_events se ON se.id = d.session_event_id
                    LEFT JOIN org.users_public cu ON cu.user_id = d.opened_by_profile
                    LEFT JOIN org.users_public ou ON ou.user_id = p.owner_user_id
                   WHERE d.status IN ('open', 'awaiting_response', 'under_review')
                     AND (p_status IS NULL OR d.status::text = p_status)
                   ORDER BY 2, 3, d.id
                   LIMIT 200
              ) q
        ), '[]'::jsonb)
    );
END;
$$;

-- A platform operator (ops.admin_users, through security.is_admin()) rules on a live case: release,
-- refund, or a split giving the provider p_payee_share_bp basis points. A ruling needs its reasons
-- (`resolution_notes`, shown to both parties). Final: the row is terminal afterwards.
CREATE OR REPLACE FUNCTION finance.resolve_dispute(
    p_dispute_id uuid,
    p_outcome text,
    p_payee_share_bp integer DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL OR NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only a platform operator can rule on a dispute' USING ERRCODE = '42501';
    END IF;
    IF pg_catalog.length(pg_catalog.btrim(COALESCE(p_notes, ''))) NOT BETWEEN 3 AND 2000 THEN
        RAISE EXCEPTION 'Give the parties the reasons for the ruling (3 to 2,000 characters)' USING ERRCODE = '22023';
    END IF;
    RETURN finance.fn_settle_dispute(p_dispute_id, p_outcome, p_payee_share_bp, v_uid, p_notes);
END;
$$;
-- #endregion

-- #region 8. The sweep
-- Every 15 minutes (`finance-dispute-sweep`, 00005060). In one pass, so no case can stall:
--   (a) a live dispute whose escrow already left `held` by another path is closed as it settled;
--   (b) an `open` dispute whose sitting has ended is audited (fn_advance_dispute);
--   (c) an `awaiting_response` case past its `respond_by` goes to an auditor — the auto-escalation,
--       which stamps its review SLA (`review_by`);
--   (d) an `under_review` case past its `review_by` is NOT ruled — the platform never rules on money
--       without a human (Decision #212(c)). It writes a `warn` row to ops.log_entries
--       (`client_id = 'dispute:review_overdue:<id>'`, scope `finance.sweep_disputes`) and tells every
--       operator (`dispute.review_overdue`), at most once a day per case (`review_alerted_at`), until
--       somebody rules. Nothing else changes and no money moves.
-- Each case is locked and re-checked by the function it is handed to. Returns the counts.
CREATE OR REPLACE FUNCTION finance.sweep_disputes(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_closed integer := 0;
    v_audited integer := 0;
    v_escalated integer := 0;
    v_overdue integer := 0;
    v_ctx record;
    v_op uuid;
    r record;
BEGIN
    FOR r IN
        SELECT d.id, e.status AS escrow_status
          FROM finance.disputes d
          JOIN finance.escrows e ON e.id = d.escrow_id
         WHERE d.status IN ('open', 'awaiting_response', 'under_review')
           AND e.status IN ('released', 'refunded')
    LOOP
        PERFORM finance.fn_settle_dispute(r.id, CASE WHEN r.escrow_status = 'refunded' THEN 'refund' ELSE 'release' END,
            NULL, NULL, 'The payment settled outside the dispute.');
        v_closed := v_closed + 1;
    END LOOP;

    FOR r IN
        SELECT d.id
          FROM finance.disputes d
          LEFT JOIN projects.session_events se ON se.id = d.session_event_id
         WHERE d.status = 'open' AND (se.id IS NULL OR se.end_time <= p_now)
    LOOP
        IF finance.fn_advance_dispute(r.id) <> 'open' THEN
            v_audited := v_audited + 1;
        END IF;
    END LOOP;

    FOR r IN
        UPDATE finance.disputes
           SET status = 'under_review', escalated_at = p_now,
               review_by = finance.fn_dispute_review_by(p_now), updated_at = p_now
         WHERE status = 'awaiting_response' AND respond_by <= p_now
        RETURNING id
    LOOP
        PERFORM finance.fn_notify_dispute_escalated(r.id, NULL, 'No response came before the deadline');
        v_escalated := v_escalated + 1;
    END LOOP;

    FOR r IN
        UPDATE finance.disputes
           SET review_alerted_at = p_now
         WHERE status = 'under_review' AND review_by <= p_now
           AND (review_alerted_at IS NULL OR review_alerted_at <= p_now - interval '1 day')
        RETURNING id, review_by, escalated_at
    LOOP
        SELECT * INTO v_ctx FROM finance.fn_dispute_context(r.id);
        INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
        VALUES (
            'dispute:review_overdue:' || r.id::text,
            'warn',
            pg_catalog.format('Dispute %s passed its review deadline (%s) without a ruling; its payment stays held until an operator rules.',
                r.id, r.review_by),
            p_now,
            'server',
            'finance.sweep_disputes',
            pg_catalog.jsonb_build_object('dispute_id', r.id, 'review_by', r.review_by,
                'escalated_at', r.escalated_at, 'project_slug', v_ctx.project_slug,
                'operators', (SELECT pg_catalog.count(*) FROM ops.admin_users))
        );
        FOR v_op IN SELECT au.user_id FROM ops.admin_users au ORDER BY au.user_id LOOP
            PERFORM comms.fn_notify(
                v_op, 'dispute.review_overdue', 'A dispute is overdue for a ruling',
                pg_catalog.format('The claim about "%s" passed its review deadline (%s) with no ruling. The payment stays held until an operator rules.',
                    v_ctx.event_title, pg_catalog.to_char(r.review_by AT TIME ZONE 'UTC', 'DD Mon YYYY HH24:MI "UTC"')),
                'finance.disputes', r.id, pg_catalog.jsonb_build_object('review_by', r.review_by),
                NULL, NULL, NULL, NULL, '/admin/disputes'
            );
        END LOOP;
        v_overdue := v_overdue + 1;
    END LOOP;
    IF v_overdue > 0 THEN
        RAISE WARNING 'finance.sweep_disputes: % dispute(s) under review past their review deadline', v_overdue;
    END IF;

    RETURN pg_catalog.jsonb_build_object('closed', v_closed, 'audited', v_audited, 'escalated', v_escalated,
        'overdue', v_overdue);
END;
$$;

COMMENT ON FUNCTION finance.sweep_disputes(timestamptz) IS
'The dispute sweep: closes live disputes whose escrow already settled, audits open no-show claims once
their sitting has ended, sends awaiting_response cases past respond_by to an auditor (under_review,
stamping review_by), and alerts ops + the operators about under_review cases past review_by (at most
once a day per case) — never ruling on them.';
-- #endregion

-- #region 9. Immutability — a dispute is never deleted, a ruling never rewritten
-- Bound BEFORE UPDATE OR DELETE on finance.disputes, finance.dispute_messages and
-- finance.dispute_evidence (00001830), so it holds for every role, the owner and the service role
-- included. A dispute row moves forward through its definers until it is resolved, then never again;
-- a statement or a piece of evidence never changes once filed (the Evidence Vault, PRODUCT_SPEC
-- §Dispute Resolution 1).
CREATE OR REPLACE FUNCTION finance.fn_dispute_records_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    IF TG_TABLE_NAME <> 'disputes' THEN
        RAISE EXCEPTION '% rows are never changed once filed', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    IF OLD.status::text LIKE 'resolved\_%' THEN
        RAISE EXCEPTION 'A resolved dispute is final' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- A file filed as evidence in a LIVE dispute cannot be deleted (soft-deleted) by its owner while the
-- case is open — nobody "cleans up" after a dispute has begun. Once the case is resolved the file is
-- the owner's again (an account erasure must not be blocked forever). Bound BEFORE UPDATE OF
-- deleted_at ON files.items (00001880).
CREATE OR REPLACE FUNCTION finance.fn_guard_evidence_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
        SELECT 1 FROM finance.dispute_evidence ev
          JOIN finance.disputes d ON d.id = ev.dispute_id
         WHERE ev.file_id = NEW.id AND d.status IN ('open', 'awaiting_response', 'under_review')
    ) THEN
        RAISE EXCEPTION 'This file is evidence in an open dispute and cannot be deleted until it is resolved'
            USING ERRCODE = 'PS409';
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion
