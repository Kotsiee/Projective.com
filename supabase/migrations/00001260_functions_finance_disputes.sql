-- =============================================================================================
-- 00001260_functions_finance_disputes.sql — the platform dispute lifecycle (Decision #212).
--
-- A `finance.disputes` row contests ONE held escrow, or one digital product line whose seller's
-- earnings are still clearing (`subject_kind` order_line, FBP DB21, §6b), or a ticket's money on one
-- stage, held or still clearing (`subject_kind` ticket_escrow, PROJECTS EX2, §6c). Until this file nothing ever
-- moved an escrow's: a
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
--   6b. Product dispute     open_order_line_dispute · order_line_disputes · fn_settle_order_line_dispute
--   6c. Ticket dispute      open_ticket_dispute · propose_dispute_offer · accept_dispute_offer ·
--                           fn_settle_ticket_dispute · fn_ticket_has_live_dispute (Decisions #548, #549)
--   6d. Evidence Vault      fn_dispute_vault_manifest · fn_freeze_dispute_vault ·
--                           mark_dispute_vault_ready · get_dispute_vault (PROJECTS EX3)
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

-- Everything a dispute's doors need about what it contests, in one row: for an escrow, its project, the
-- project's owner (the respondent of record), the claimant and the sitting's title; for a digital product
-- line (FBP DB21), the product's owner and owning team and the line's title; for a ticket's money
-- (PROJECTS EX2), the other side from the one that raised it (the client person, or the freelancer, a
-- team payee's owner standing for the team) and the ticket's title. The two links are where each side
-- follows the case: the project (a ticket case opens the ticket, `?tkv=`), or the buyer's orders and
-- the seller's wallet.
CREATE OR REPLACE FUNCTION finance.fn_dispute_context(p_dispute_id uuid)
RETURNS TABLE (
    dispute_id uuid,
    escrow_id uuid,
    project_id uuid,
    project_slug text,
    owner_user_id uuid,
    claimant uuid,
    event_title text,
    subject_kind text,
    order_line_id uuid,
    owner_team_id uuid,
    claimant_href text,
    respondent_href text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT d.id, d.escrow_id, p.id, p.slug,
           CASE WHEN d.subject_kind <> 'ticket_escrow' THEN COALESCE(p.owner_user_id, cp.owner_user_id)
                WHEN d.claimant_side = 'payee' THEN COALESCE(p.client_user_id, p.owner_user_id)
                WHEN e.payee_type = 'team' THEN pt.owner_user_id
                ELSE e.payee_id END,
           d.opened_by_profile,
           COALESCE(se.title, tk.title, p.title, ol.title), d.subject_kind, d.order_line_id,
           COALESCE(p.owner_team_id, cp.owner_team_id),
           CASE WHEN d.order_line_id IS NOT NULL THEN '/checkout/orders'
                WHEN tk.id IS NOT NULL THEN '/projects/' || p.slug || '?tkv=' || tk.slug
                ELSE '/projects/' || p.slug END,
           CASE WHEN d.order_line_id IS NOT NULL THEN '/wallet/transactions'
                WHEN tk.id IS NOT NULL THEN '/projects/' || p.slug || '?tkv=' || tk.slug
                ELSE '/projects/' || p.slug END
      FROM finance.disputes d
      LEFT JOIN finance.escrows e ON e.id = d.escrow_id
      LEFT JOIN projects.project_stages ps ON ps.id = e.project_stage_id
      LEFT JOIN projects.projects p ON p.id = ps.project_id
      LEFT JOIN projects.tickets tk ON tk.id = d.ticket_id
      LEFT JOIN org.teams pt ON pt.id = e.payee_id AND e.payee_type = 'team'
      LEFT JOIN projects.session_events se ON se.id = d.session_event_id
      LEFT JOIN finance.order_lines ol ON ol.id = d.order_line_id
      LEFT JOIN catalogue.products cp ON cp.id = ol.item_id
     WHERE d.id = p_dispute_id;
END;
$$;

-- Which side of a ticket's money a user is on (PROJECTS EX2): `payer` (review authority over the
-- project: the client person, or an active member of the paying client business — what
-- projects.can_review_project asks of the caller, asked here of any user) or `payee` (the escrow's
-- freelancer, or an active member of its team), else NULL. Payer is asked first.
CREATE OR REPLACE FUNCTION finance.fn_ticket_escrow_side(p_escrow_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_user_id IS NULL THEN NULL
        WHEN COALESCE(p.client_user_id, p.owner_user_id) = p_user_id
          OR (p.client_business_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM org.business_members bm
                 WHERE bm.business_id = p.client_business_id AND bm.user_id = p_user_id AND bm.status = 'active'))
          THEN 'payer'
        WHEN (e.payee_type = 'freelancer' AND e.payee_id = p_user_id)
          OR (e.payee_type = 'team' AND EXISTS (
                SELECT 1 FROM org.team_members tm
                 WHERE tm.team_id = e.payee_id AND tm.user_id = p_user_id AND tm.status = 'active'))
          THEN 'payee'
    END
      FROM finance.escrows e
      JOIN projects.project_stages ps ON ps.id = e.project_stage_id
      JOIN projects.projects p ON p.id = ps.project_id
     WHERE e.id = p_escrow_id;
$$;

-- Which side of a dispute a user is on: `claimant` (who opened it), `respondent` (who delivers the
-- engagement, or sold the product: its owner or an active member of the owning team), or NULL. On a
-- ticket's money the sides are the client's and the freelancer's: anyone on the side that raised it
-- (`claimant_side`) is the claimant, anyone on the other the respondent. A platform operator is not
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
    v_side text;
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
    IF v_ctx.subject_kind = 'ticket_escrow' THEN
        v_side := finance.fn_ticket_escrow_side(v_ctx.escrow_id, p_user_id);
        RETURN CASE WHEN v_side IS NULL THEN NULL
                    WHEN v_side = (SELECT d.claimant_side FROM finance.disputes d WHERE d.id = p_dispute_id)
                        THEN 'claimant'
                    ELSE 'respondent' END;
    END IF;
    IF v_ctx.subject_kind = 'order_line' THEN
        IF v_ctx.owner_user_id = p_user_id OR (v_ctx.owner_team_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM org.team_members tm
                WHERE tm.team_id = v_ctx.owner_team_id AND tm.user_id = p_user_id AND tm.status = 'active'
           )) THEN
            RETURN 'respondent';
        END IF;
        RETURN NULL;
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
--   dismiss    a tracked room shows BOTH the host and the claimant in it for more than
--              `dispute_dismiss_presence_pct` (80) % of the sitting
--   ambiguous  anything else, including an untracked room (a silent webhook is not evidence) — the case
--              goes to the counterparty, then to an auditor
-- Time in the room is read from the ledger (scheduling.fn_room_presence), every join and leave, not
-- the span from first join to last leave: somebody who left and came back is not counted for the gap
-- (Decision #383 (b)). Only a person the room itself identified counts towards a dismissal: a
-- host-attested row is the respondent's own word, and an email-only match is weaker evidence.
-- Returns the snapshot stored on the dispute as `audit`; NULL for a dispute with no sitting. Its
-- `timeline` freezes what the room recorded, labelled by party, so a case names no third person and
-- outlives the ledger's own retention.
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
    v_room uuid;
    v_host_seconds integer;
    v_claimant_seconds integer;
    v_reconnects integer;
BEGIN
    SELECT * INTO v_d FROM finance.disputes WHERE id = p_dispute_id;
    IF NOT FOUND OR v_d.session_event_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_event FROM projects.session_events WHERE id = v_d.session_event_id;
    SELECT c.project_id INTO v_project FROM projects.cohorts c WHERE c.id = v_event.cohort_id;
    v_presence := projects.fn_session_presence(v_event.id);
    v_span := EXTRACT(epoch FROM v_event.end_time - v_event.start_time);

    SELECT r.id INTO v_room FROM scheduling.rooms r WHERE r.session_event_id = v_event.id;
    SELECT COALESCE(sum(p.total_seconds) FILTER (WHERE projects.fn_is_session_host(v_project, p.user_id)), 0)::integer,
           COALESCE(sum(p.total_seconds) FILTER (WHERE p.user_id = v_d.opened_by_profile), 0)::integer,
           COALESCE(sum(p.reconnect_count), 0)::integer
      INTO v_host_seconds, v_claimant_seconds, v_reconnects
      FROM scheduling.fn_room_presence(v_room) p
     WHERE p.matched_by IN ('host_account', 'registrant', 'sole_attendee');
    v_host_pct := pg_catalog.floor(100 * v_host_seconds / v_span)::integer;
    v_claimant_pct := pg_catalog.floor(100 * v_claimant_seconds / v_span)::integer;

    RETURN pg_catalog.jsonb_build_object(
        'event_id', v_event.id,
        'presence_outcome', v_presence ->> 'outcome',
        'tracked', COALESCE((v_presence ->> 'tracked')::boolean, false),
        'host_presence_pct', v_host_pct,
        'claimant_presence_pct', v_claimant_pct,
        'host_seconds', v_host_seconds,
        'claimant_seconds', v_claimant_seconds,
        'reconnects', v_reconnects,
        'threshold_pct', v_threshold,
        'audited_at', pg_catalog.now(),
        'timeline', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'party', CASE
                           WHEN l.user_id = v_d.opened_by_profile THEN 'claimant'
                           WHEN projects.fn_is_session_host(v_project, l.user_id) THEN 'host'
                           ELSE 'other'
                       END,
                       'action', l.action,
                       'at', l.occurred_at,
                       'how', l.matched_by
                   ) ORDER BY l.occurred_at, l.id)
              FROM (SELECT p.* FROM scheduling.presence_events p
                     WHERE p.room_id = v_room
                     ORDER BY p.occurred_at, p.id
                     LIMIT 200) l
        ), '[]'::jsonb),
        'verdict', CASE
            WHEN pg_catalog.now() < v_event.end_time THEN 'pending'
            WHEN v_presence ->> 'outcome' = 'provider_no_show' THEN 'refund'
            WHEN COALESCE((v_presence ->> 'tracked')::boolean, false)
                 AND v_host_pct > v_threshold AND v_claimant_pct > v_threshold THEN 'dismiss'
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
        PERFORM finance.fn_refund_escrow_to_payer(r.id, v_refund, 'escrow_refund');
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
-- its card dispute. Only seat escrows can be settled here, and digital product lines through
-- fn_settle_order_line_dispute (§6b, FBP DB21): no door opens a dispute on anything else.
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
    IF v_d.subject_kind = 'order_line' THEN
        RETURN finance.fn_settle_order_line_dispute(v_d.id, p_outcome, p_actor, p_notes);
    END IF;
    IF v_d.subject_kind = 'ticket_escrow' THEN
        RETURN finance.fn_settle_ticket_dispute(v_d.id, p_outcome, p_bp, p_actor, p_notes);
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
            PERFORM finance.fn_notify_dispute_escalated(v_d.id, v_uid,
                CASE WHEN v_d.subject_kind = 'ticket_escrow' THEN 'The other side responded' ELSE 'The provider responded' END);
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
-- `room` is an operator's alone (Decision #392), read live rather than frozen in the audit, because the
-- audit runs as soon as a sitting ends and a Meet or Teams record arrives after it. A dispute keeps
-- those rows from retention (scheduling.fn_sitting_evidence_held), so the count outlives the sitting.
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
    v_l finance.order_lines;
    v_ctx record;
    v_role text;
    v_live boolean;
    v_escrows uuid[];
    v_ticket_minor bigint;
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
    SELECT * INTO v_l FROM finance.order_lines WHERE id = v_d.order_line_id;
    SELECT * INTO v_ctx FROM finance.fn_dispute_context(v_d.id);
    v_live := v_d.status IN ('open', 'awaiting_response', 'under_review');
    IF v_d.subject_kind = 'ticket_escrow' THEN
        v_escrows := finance.fn_ticket_dispute_escrows(v_d.id);
        SELECT pg_catalog.sum(e.amount_cents)::bigint INTO v_ticket_minor FROM finance.escrows e WHERE e.id = ANY (v_escrows);
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'id', v_d.id,
        'kind', CASE WHEN v_d.subject_kind = 'order_line' THEN 'product'
                     WHEN v_d.subject_kind = 'ticket_escrow' THEN 'ticket'
                     WHEN v_d.session_event_id IS NOT NULL THEN 'no_show' ELSE 'general' END,
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
        'room', CASE WHEN v_role = 'operator' THEN (
            SELECT pg_catalog.jsonb_build_object(
                       'guarded', r.guarded, 'unmatched', scheduling.fn_room_unmatched(r.id))
              FROM scheduling.rooms r
             WHERE r.session_event_id = v_d.session_event_id
        ) END,
        -- What is at stake: a ticket case's contested escrows, the escrow, or the product line less its promo.
        'amount_minor', COALESCE(v_ticket_minor, v_e.amount_cents,
            GREATEST(v_l.line_total_minor - v_l.promo_discount_minor, 0)),
        'currency', COALESCE(v_e.currency, v_l.currency),
        'project', CASE WHEN v_ctx.project_id IS NOT NULL THEN
            pg_catalog.jsonb_build_object('id', v_ctx.project_id, 'slug', v_ctx.project_slug) END,
        'purchase', CASE WHEN v_l.id IS NOT NULL THEN
            pg_catalog.jsonb_build_object('line_id', v_l.id, 'title', v_l.title) END,
        -- A ticket case (PROJECTS EX2): the ticket and stage, which side raised it, and whether its
        -- money is still held or was already released into the pending window (frozen there).
        'ticket', CASE WHEN v_d.subject_kind = 'ticket_escrow' THEN (
            SELECT pg_catalog.jsonb_build_object('id', tk.id, 'slug', tk.slug, 'title', tk.title,
                       'stage_id', ps.id, 'stage_name', ps.name, 'claimant_side', v_d.claimant_side,
                       'window', CASE WHEN EXISTS (SELECT 1 FROM finance.pending_releases pr
                                                    WHERE pr.hold_dispute_id = v_d.id) THEN 'pending' ELSE 'held' END,
                       -- What an offer's preview needs to mirror fn_dispute_offer_split: each contested
                       -- escrow's principal and the payer's fee rate.
                       'fee_bp', finance.fn_escrow_fee_bp(v_e.payer_business_id, v_e.payer_user_id),
                       'escrow_amounts', (SELECT COALESCE(pg_catalog.jsonb_agg(x.amount_cents ORDER BY x.id), '[]'::jsonb)
                                            FROM finance.escrows x WHERE x.id = ANY (v_escrows)))
              FROM projects.tickets tk
              JOIN projects.project_stages ps ON ps.id = v_d.stage_id
             WHERE tk.id = v_d.ticket_id
        ) END,
        -- Phase 1's offers, oldest first, each with what it would move; the newest is the standing one,
        -- and only the other side may accept it.
        'offers', CASE WHEN v_d.subject_kind = 'ticket_escrow' THEN COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'id', o.id, 'party', o.party, 'payee_share_bp', o.payee_share_bp, 'note', o.note,
                       'created_at', o.created_at, 'accepted_at', o.accepted_at, 'mine', o.proposed_by = v_uid,
                       'standing', o.rn = 1 AND o.accepted_at IS NULL AND v_live,
                       'can_accept', o.rn = 1 AND o.accepted_at IS NULL AND v_live
                                     AND v_role IN ('claimant', 'respondent') AND v_role <> o.party,
                       'payee_minor', sp.payee_minor, 'fee_minor', sp.fee_minor, 'refund_minor', sp.refund_minor
                   ) ORDER BY o.created_at, o.id)
              FROM (SELECT x.*, pg_catalog.row_number() OVER (ORDER BY x.created_at DESC, x.id DESC) AS rn
                      FROM finance.dispute_offers x WHERE x.dispute_id = v_d.id) o
              CROSS JOIN LATERAL finance.fn_dispute_offer_split(v_escrows, o.payee_share_bp) sp
        ), '[]'::jsonb) END,
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
        -- The custom quote the disputed engagement was bought on (Decision #522): its terms and hash
        -- as both parties agreed them, whether they still hash to that, and when they were accepted and
        -- paid for. NULL when the engagement was not bought on a quote.
        'agreed_terms', (
            SELECT pg_catalog.jsonb_build_object(
                'offer_id', o.id,
                'terms', marketplace.fn_quote_terms(o),
                'terms_hash', o.terms_hash,
                'terms_intact', marketplace.fn_quote_hash(marketplace.fn_quote_terms(o)) = o.terms_hash,
                'accepted_at', (SELECT e.created_at FROM marketplace.quote_events e
                                 WHERE e.quote_offer_id = o.id AND e.kind = 'offer_accepted'
                                 ORDER BY e.created_at LIMIT 1),
                'paid_at', (SELECT e.created_at FROM marketplace.quote_events e
                             WHERE e.quote_offer_id = o.id AND e.kind = 'paid'
                             ORDER BY e.created_at LIMIT 1)
            )
              FROM finance.order_lines ol
              JOIN marketplace.quote_offers o ON o.id = ol.quote_offer_id
             WHERE ol.escrow_id = v_e.id OR (v_ctx.project_id IS NOT NULL AND ol.project_id = v_ctx.project_id)
             ORDER BY ol.created_at
             LIMIT 1
        ),
        'can_respond', v_live AND v_role IN ('claimant', 'respondent'),
        'can_escalate', v_d.status = 'awaiting_response' AND v_role IN ('claimant', 'respondent'),
        -- The Evidence Vault (PROJECTS EX3): its state and hash; the manifest is finance.get_dispute_vault's.
        'vault', (SELECT pg_catalog.jsonb_build_object('status', v.status, 'sha256', v.sha256,
                                                       'created_at', v.created_at)
                    FROM finance.dispute_vaults v WHERE v.dispute_id = v_d.id),
        'can_offer', v_live AND v_d.subject_kind = 'ticket_escrow' AND v_d.status <> 'open'
                     AND v_role IN ('claimant', 'respondent'),
        'can_resolve', v_live AND v_role = 'operator'
    );
END;
$$;
-- #endregion

-- #region 6b. The product dispute (FBP DB21; Decision #337, ruling M8; Decision #470 (A))
-- A buyer reports a digital product they downloaded as not delivered or faulty while its sale is still
-- clearing: the days the seller's earnings are held (#470 (A): the only window in which they can be).
-- Before any download the buyer cancels instead (finance.cancel_order_line). The report freezes the
-- seller's clearing row for the line (`on_hold`, keyed by pending_releases.hold_dispute_id beside DB6's
-- card-dispute key) and goes straight to an operator (`under_review`, with its review SLA): there is no
-- room audit to run, and the seller is told and may add a statement (finance.respond_to_dispute). The
-- operator rules through the existing desk (finance.resolve_dispute → fn_settle_dispute →
-- fn_settle_order_line_dispute): upheld refunds the buyer from the frozen row as a cancel does;
-- dismissed returns the row to clearing. Never split. One report per line, ever.

-- Report a problem with a digital product (user door): a member of the buying account (the order's own
-- read rule), on a confirmed, downloaded line whose seller's earnings are still clearing, saying whether
-- it `not_delivered` or is `defective`, with a statement and up to ten of their own uploaded files.
-- Refuses what a buyer win could not pay back (a conversion, on account) as the cancel does.
CREATE OR REPLACE FUNCTION finance.open_order_line_dispute(
    p_line_id uuid,
    p_reason text,
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
    l finance.order_lines;
    o finance.orders;
    e catalogue.entitlements;
    r finance.pending_releases;
    v_reason text := pg_catalog.btrim(COALESCE(p_reason, ''));
    v_body text := pg_catalog.btrim(COALESCE(p_statement, ''));
    v_files uuid[] := COALESCE(p_file_ids, '{}'::uuid[]);
    v_id uuid;
    v_message uuid;
    v_ctx record;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to report a problem' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO l FROM finance.order_lines WHERE id = p_line_id FOR UPDATE;
    IF FOUND THEN
        SELECT * INTO o FROM finance.orders WHERE id = l.order_id FOR UPDATE;
    END IF;
    IF o.id IS NULL OR NOT finance.fn_owner_visible(o.owner_type, o.owner_id) THEN
        RAISE EXCEPTION 'That purchase doesn''t exist' USING ERRCODE = 'P0002';
    END IF;
    IF l.item_type <> 'digital_product' THEN
        RAISE EXCEPTION 'Only a digital product can be reported here' USING ERRCODE = '22023';
    END IF;
    IF v_reason NOT IN ('not_delivered', 'defective') THEN
        RAISE EXCEPTION 'Say whether the files didn''t arrive or are faulty' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.length(v_body) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION 'Describe the problem in up to 4,000 characters' USING ERRCODE = '22023';
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
    IF EXISTS (SELECT 1 FROM finance.disputes d WHERE d.order_line_id = l.id) THEN
        RAISE EXCEPTION 'A problem with this purchase was already reported' USING ERRCODE = 'PO409';
    END IF;
    IF l.status <> 'confirmed' THEN
        RAISE EXCEPTION 'This purchase was already refunded or cancelled' USING ERRCODE = 'PO409';
    END IF;
    IF o.fx_conversion_id IS NOT NULL OR o.status = 'invoiced'
       OR finance.fn_order_paying_wallet(o.id, l.currency) IS NULL THEN
        RAISE EXCEPTION 'This order was paid in another currency or on account, so support handles a problem with it. Contact support.'
            USING ERRCODE = 'PO409';
    END IF;
    SELECT * INTO e FROM catalogue.entitlements WHERE order_line_id = l.id;
    IF e.first_delivered_at IS NULL THEN
        RAISE EXCEPTION 'Nothing from this purchase has been downloaded yet, so cancel it instead' USING ERRCODE = 'PO409';
    END IF;
    SELECT * INTO r FROM finance.pending_releases
     WHERE id = finance.fn_line_sale_release(l) AND state = 'pending' AND recovered_cents = 0
       FOR UPDATE;
    IF r.id IS NULL THEN
        RAISE EXCEPTION 'The seller''s earnings from this sale have cleared, so a problem with it can''t be reported here. Contact support.'
            USING ERRCODE = 'PO409';
    END IF;

    INSERT INTO finance.disputes (subject_kind, order_line_id, opened_by_profile, reason, status, escalated_at, review_by)
    VALUES ('order_line', l.id, v_uid, v_reason, 'under_review', pg_catalog.now(),
            finance.fn_dispute_review_by(pg_catalog.now()))
    RETURNING id INTO v_id;
    UPDATE finance.pending_releases SET state = 'on_hold', hold_dispute_id = v_id WHERE id = r.id;
    -- The client's royalty on the line (SC7) is held with it, so an upheld report recovers both.
    UPDATE finance.pending_releases SET state = 'on_hold', hold_dispute_id = v_id
     WHERE id = (SELECT pr.id FROM finance.pending_releases pr
                  WHERE pr.order_id = l.order_id AND pr.reason = 'product_royalty'
                    AND pr.amount_cents = l.royalty_minor AND pr.state = 'pending' AND pr.recovered_cents = 0
                  ORDER BY pr.id
                  LIMIT 1);
    INSERT INTO finance.dispute_messages (dispute_id, sender_user_id, party, body)
    VALUES (v_id, v_uid, 'claimant', v_body)
    RETURNING id INTO v_message;
    INSERT INTO finance.dispute_evidence (dispute_id, message_id, file_id, submitted_by)
    SELECT DISTINCT v_id, v_message, f.id, v_uid FROM pg_catalog.unnest(v_files) f(id);

    SELECT * INTO v_ctx FROM finance.fn_dispute_context(v_id);
    IF v_ctx.owner_user_id IS NOT NULL THEN
        PERFORM comms.fn_notify(
            v_ctx.owner_user_id, 'dispute.opened', 'A buyer reported a problem',
            pg_catalog.format('A buyer reported that "%s" %s. Its earnings are held while Projective reviews the report; you''ll hear the ruling.',
                l.title, CASE v_reason WHEN 'defective' THEN 'is faulty' ELSE 'didn''t arrive' END),
            'finance.disputes', v_id, pg_catalog.jsonb_build_object('reason', v_reason),
            v_uid, NULL, NULL, NULL, v_ctx.respondent_href
        );
    END IF;
    RETURN pg_catalog.jsonb_build_object('dispute_id', v_id, 'status', 'under_review', 'line_id', l.id,
        'held_minor', r.amount_cents, 'currency', l.currency);
END;
$$;

-- The product-dispute state of these lines for the order history (read): whether the caller may report
-- a problem now (what open_order_line_dispute checks, short of the statement), and the status of the
-- line's report if one was made. Only digital product lines of orders the caller can see.
CREATE OR REPLACE FUNCTION finance.order_line_disputes(p_line_ids uuid[])
RETURNS TABLE (line_id uuid, can_report boolean, dispute_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT l.id,
           d.id IS NULL AND l.status = 'confirmed'
             AND o.fx_conversion_id IS NULL AND o.status <> 'invoiced'
             AND en.first_delivered_at IS NOT NULL
             AND finance.fn_order_paying_wallet(o.id, l.currency) IS NOT NULL
             AND finance.fn_line_sale_release(l) IS NOT NULL,
           d.status::text
      FROM finance.order_lines l
      JOIN finance.orders o ON o.id = l.order_id
      LEFT JOIN catalogue.entitlements en ON en.order_line_id = l.id
      LEFT JOIN finance.disputes d ON d.order_line_id = l.id
     WHERE l.id = ANY (COALESCE(p_line_ids, '{}'))
       AND l.item_type = 'digital_product'
       AND finance.fn_owner_visible(o.owner_type, o.owner_id);
$$;

-- Settles a product dispute, from fn_settle_dispute under its lock: `refund` upholds the report (the
-- buyer is paid back from the frozen row, finance.fn_refund_product_line, as a cancel is); `release`
-- dismisses it (the row returns to clearing, `pending`, and matures on its date, or at the next sweep
-- if that has passed). A line refunded or cancelled by another path is recorded as it settled
-- (`settlement.by_fact`). A split is refused. Tells both sides (`dispute.resolved`).
CREATE OR REPLACE FUNCTION finance.fn_settle_order_line_dispute(
    p_dispute_id uuid,
    p_outcome text,
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
    l finance.order_lines;
    r finance.pending_releases;
    v_ctx record;
    v_status public.dispute_status;
    v_settlement jsonb;
    v_moved bigint;
    v_title text;
    v_body text;
    v_payload jsonb;
BEGIN
    SELECT * INTO v_d FROM finance.disputes WHERE id = p_dispute_id AND subject_kind = 'order_line' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That dispute does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_d.status::text LIKE 'resolved\_%' THEN
        RAISE EXCEPTION 'This dispute is already resolved' USING ERRCODE = 'PS409';
    END IF;
    IF p_outcome IS NULL OR p_outcome NOT IN ('release', 'refund') THEN
        RAISE EXCEPTION 'A product dispute is upheld (refund) or dismissed (release), never split' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO l FROM finance.order_lines WHERE id = v_d.order_line_id FOR UPDATE;
    SELECT * INTO r FROM finance.pending_releases
     WHERE hold_dispute_id = v_d.id AND state = 'on_hold' AND reason = 'product_sale'
     ORDER BY id
     LIMIT 1
       FOR UPDATE;

    IF l.status <> 'confirmed' THEN
        v_status := CASE WHEN l.status IN ('refunded', 'cancelled') THEN 'resolved_refund' ELSE 'resolved_release' END;
        v_settlement := pg_catalog.jsonb_build_object('by_fact', true, 'line_status', l.status, 'currency', l.currency);
    ELSIF r.id IS NULL THEN
        RAISE EXCEPTION 'The earnings this report held are no longer on hold; nothing can be ruled on' USING ERRCODE = 'PS409';
    ELSIF p_outcome = 'release' THEN
        v_status := 'resolved_release';
        UPDATE finance.pending_releases SET state = 'pending' WHERE hold_dispute_id = v_d.id AND state = 'on_hold';
        v_settlement := pg_catalog.jsonb_build_object('payee_minor', r.amount_cents, 'fee_minor', l.platform_fee_minor,
            'refund_minor', 0, 'currency', l.currency);
    ELSE
        v_status := 'resolved_refund';
        v_moved := finance.fn_refund_product_line(l.id, r.id);
        v_settlement := pg_catalog.jsonb_build_object('payee_minor', 0, 'fee_minor', 0, 'refund_minor', v_moved,
            'currency', l.currency);
    END IF;

    UPDATE finance.disputes
       SET status = v_status,
           resolved_at = pg_catalog.now(),
           resolved_by = p_actor,
           resolution_notes = NULLIF(pg_catalog.btrim(COALESCE(p_notes, '')), ''),
           settlement = v_settlement,
           updated_at = pg_catalog.now()
     WHERE id = v_d.id;

    SELECT * INTO v_ctx FROM finance.fn_dispute_context(v_d.id);
    v_title := CASE v_status WHEN 'resolved_refund' THEN 'Problem report upheld — refunded' ELSE 'Problem report dismissed' END;
    v_body := pg_catalog.format('The report about "%s" is closed. %s', v_ctx.event_title, CASE v_status
        WHEN 'resolved_refund' THEN 'What the buyer paid went back to them, and the sale''s earnings were taken back.'
        ELSE 'The sale''s earnings clear to the seller as usual.' END);
    v_payload := pg_catalog.jsonb_build_object('status', v_status, 'settlement', v_settlement);
    PERFORM comms.fn_notify(v_ctx.claimant, 'dispute.resolved', v_title, v_body, 'finance.disputes', v_d.id,
        v_payload, p_actor, NULL, NULL, NULL, v_ctx.claimant_href);
    IF v_ctx.owner_user_id IS NOT NULL THEN
        PERFORM comms.fn_notify(v_ctx.owner_user_id, 'dispute.resolved', v_title, v_body, 'finance.disputes', v_d.id,
            v_payload, p_actor, NULL, NULL, NULL, v_ctx.respondent_href);
    END IF;

    RETURN pg_catalog.jsonb_build_object('dispute_id', v_d.id, 'status', v_status, 'settlement', v_settlement);
END;
$$;
-- #endregion

-- #region 6c. The ticket dispute (PROJECTS EX2; Decisions #548, #549)
-- Either side of a ticket raises a dispute about its money on one stage (ruling 1): money still HELD
-- while the work waits for the client's verdict (the ticket in review, or the stage submitted), or money
-- already RELEASED into the 7-day pending window after approval, whose clearing rows the dispute then
-- freezes (`on_hold`, keyed by pending_releases.hold_dispute_id, as a product dispute's are). Either
-- party may raise it (ruling 2): the client side through review authority (a business member holding
-- `hire`), or the freelancer side (the escrow's freelancer, or an active member of its team).
-- The other side has `dispute_response_hours` (48) to respond, the built deadline kept as Phase 1
-- (ruling 4); inside it, and until a ruling, either side may offer the freelancer's share in basis points
-- and the other may accept (ruling 3), which settles the case at once. A statement from the respondent,
-- an escalation or the deadline sends it to an auditor as any case. While it is live the ticket neither
-- moves nor is claimed (ruling 5, Decision #549: projects.fn_assert_ticket_move, projects.claim_ticket).

-- The escrows a ticket case contests. While its money is held: every held escrow of the ticket on the
-- stage, a paid revision's (#167) included, because the ticket primitives settle a ticket whole, plus
-- the escrow the case names. Once released into the pending window: the escrows whose clearing rows the
-- case froze. Internal.
CREATE OR REPLACE FUNCTION finance.fn_ticket_dispute_escrows(p_dispute_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.hold_dispute_id = d.id) THEN
            ARRAY(SELECT DISTINCT pr.escrow_id FROM finance.pending_releases pr
                   WHERE pr.hold_dispute_id = d.id AND pr.escrow_id IS NOT NULL ORDER BY 1)
        ELSE ARRAY(SELECT e.id FROM finance.escrows e
                    WHERE e.ticket_id = d.ticket_id AND e.project_stage_id = d.stage_id
                      AND (e.status = 'held' OR e.id = d.escrow_id)
                    ORDER BY e.id)
    END
      FROM finance.disputes d
     WHERE d.id = p_dispute_id AND d.subject_kind = 'ticket_escrow';
$$;

-- What a share of p_bp basis points of these escrows would move: the freelancer's payout, the platform
-- fee on that share and the rest back to the client, through Fair Exit's arithmetic
-- (finance.fn_fair_exit_split), so an offer's preview and its settlement agree. 10000 is a release and
-- 0 a refund. Internal.
CREATE OR REPLACE FUNCTION finance.fn_dispute_offer_split(p_escrow_ids uuid[], p_bp integer)
RETURNS TABLE (payee_minor bigint, fee_minor bigint, refund_minor bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(pg_catalog.sum(s.payout_cents), 0)::bigint,
           COALESCE(pg_catalog.sum(s.fee_cents), 0)::bigint,
           COALESCE(pg_catalog.sum(s.refund_cents), 0)::bigint
      FROM finance.escrows e
     CROSS JOIN LATERAL finance.fn_fair_exit_split(e.amount_cents, p_bp,
         finance.fn_escrow_fee_bp(e.payer_business_id, e.payer_user_id)) s
     WHERE e.id = ANY (COALESCE(p_escrow_ids, '{}'::uuid[]));
$$;

-- Whether a ticket has a live dispute — what the move and claim guards ask (ruling 5) and the board
-- reads for its Disputed tag. Internal.
CREATE OR REPLACE FUNCTION finance.fn_ticket_has_live_dispute(p_ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM finance.disputes d
         WHERE d.ticket_id = p_ticket_id AND d.status IN ('open', 'awaiting_response', 'under_review')
    );
$$;

-- A ticket's dispute state for its reader (read): the live case on it, if any (its id and status), and
-- whether the caller may raise one now on the ticket's current stage, with what open_ticket_dispute
-- would contest there (`held`, or `pending` once released into the clearing window). What the door
-- checks short of the statement, so the ticket view and the stage menu offer Raise a dispute only where
-- it works; the door re-checks everything under its locks. NULL for anyone who is neither side.
CREATE OR REPLACE FUNCTION finance.ticket_dispute_state(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    tk projects.tickets;
    ps projects.project_stages;
    v_side text;
    v_live finance.disputes;
    v_window text;
    v_may boolean := true;
BEGIN
    SELECT * INTO tk FROM projects.tickets WHERE id = p_ticket_id;
    IF NOT FOUND OR v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO ps FROM projects.project_stages WHERE id = tk.current_stage_id;
    v_side := COALESCE(
        (SELECT finance.fn_ticket_escrow_side(e.id, v_uid) FROM finance.escrows e
          WHERE e.ticket_id = tk.id AND finance.fn_ticket_escrow_side(e.id, v_uid) IS NOT NULL
          ORDER BY e.created_at DESC, e.id LIMIT 1),
        CASE WHEN projects.can_review_project(tk.project_id) THEN 'payer' END);
    IF v_side IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_live FROM finance.disputes d
     WHERE d.ticket_id = tk.id AND d.status IN ('open', 'awaiting_response', 'under_review')
     ORDER BY d.created_at DESC LIMIT 1;
    IF v_live.id IS NULL AND ps.id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM finance.escrows e
                    WHERE e.ticket_id = tk.id AND e.project_stage_id = ps.id AND e.status = 'held'
                      AND e.payee_id IS NOT NULL)
           AND (tk.status = 'in_review' OR ps.status = 'submitted') THEN
            v_window := 'held';
        ELSIF NOT EXISTS (SELECT 1 FROM finance.escrows e
                           WHERE e.ticket_id = tk.id AND e.project_stage_id = ps.id
                             AND e.status IN ('held', 'disputed'))
              AND EXISTS (SELECT 1 FROM finance.escrows e
                           JOIN finance.pending_releases pr ON pr.escrow_id = e.id
                          WHERE e.ticket_id = tk.id AND e.project_stage_id = ps.id AND e.status = 'released')
              AND NOT EXISTS (SELECT 1 FROM finance.escrows e
                               JOIN finance.pending_releases pr ON pr.escrow_id = e.id
                              WHERE e.ticket_id = tk.id AND e.project_stage_id = ps.id AND e.status = 'released'
                                AND (pr.state <> 'pending' OR pr.recovered_cents > 0)) THEN
            v_window := 'pending';
        END IF;
    END IF;
    -- On a business project the client side raises it as a `hire` decision, as the door asks.
    IF v_window IS NOT NULL AND v_side = 'payer' THEN
        BEGIN
            PERFORM projects.fn_assert_business_actor(tk.project_id, 'hire');
        EXCEPTION WHEN OTHERS THEN
            v_may := false;
        END;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'side', v_side,
        'dispute_id', v_live.id,
        'status', v_live.status,
        'stage_id', ps.id,
        'can_raise', v_window IS NOT NULL AND v_may,
        'window', v_window
    );
END;
$$;

-- Raise a dispute on a ticket's money on one stage (user door). p_reason names what is disputed
-- (3–200 characters), p_statement is the claimant's account (up to 4,000), with up to ten of their own
-- uploaded files. Refused: anyone but the two sides (P0002, as if the ticket did not exist); held money
-- before the work is submitted, or anything already settled or cleared (PS409); a payment a card
-- dispute froze (PS409); a second live dispute on the same money (PD409).
CREATE OR REPLACE FUNCTION finance.open_ticket_dispute(
    p_ticket_id uuid,
    p_stage_id uuid,
    p_reason text,
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
    tk projects.tickets;
    ps projects.project_stages;
    p projects.projects;
    v_side text;
    v_reason text := pg_catalog.btrim(COALESCE(p_reason, ''));
    v_body text := pg_catalog.btrim(COALESCE(p_statement, ''));
    v_files uuid[] := COALESCE(p_file_ids, '{}'::uuid[]);
    v_escrows uuid[];
    v_window text;
    v_amount bigint;
    v_currency text;
    v_respond_by timestamptz;
    v_id uuid;
    v_message uuid;
    v_ctx record;
    v_vault jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to raise a dispute' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO tk FROM projects.tickets WHERE id = p_ticket_id FOR UPDATE;
    IF FOUND THEN
        SELECT * INTO p FROM projects.projects WHERE id = tk.project_id;
        SELECT * INTO ps FROM projects.project_stages WHERE id = p_stage_id AND project_id = tk.project_id;
    END IF;
    IF tk.id IS NULL OR ps.id IS NULL OR p.format = 'session' THEN
        RAISE EXCEPTION 'That ticket doesn''t exist' USING ERRCODE = 'P0002';
    END IF;
    IF projects.can_review_project(p.id) THEN
        PERFORM projects.fn_assert_business_actor(p.id, 'hire');
        v_side := 'payer';
    ELSIF EXISTS (SELECT 1 FROM finance.escrows e
                   WHERE e.ticket_id = tk.id AND e.project_stage_id = ps.id
                     AND finance.fn_ticket_escrow_side(e.id, v_uid) = 'payee') THEN
        v_side := 'payee';
    ELSE
        RAISE EXCEPTION 'That ticket doesn''t exist' USING ERRCODE = 'P0002';
    END IF;
    IF pg_catalog.length(v_reason) NOT BETWEEN 3 AND 200 THEN
        RAISE EXCEPTION 'Say what is disputed in 3 to 200 characters' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.length(v_body) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION 'Give your account in up to 4,000 characters' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.cardinality(v_files) > 10 THEN
        RAISE EXCEPTION 'Attach at most ten files' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.unnest(v_files) f(id)
         WHERE NOT EXISTS (
             SELECT 1 FROM files.items i
              WHERE i.id = f.id AND i.owner_user_id = v_uid AND i.deleted_at IS NULL AND i.status = 'uploaded'
         )
    ) THEN
        RAISE EXCEPTION 'Evidence must be your own uploaded files' USING ERRCODE = '22023';
    END IF;

    -- Held money first: the work waits for the client's verdict on this stage.
    SELECT pg_catalog.array_agg(e.id ORDER BY e.created_at, e.id) INTO v_escrows
      FROM finance.escrows e
     WHERE e.ticket_id = tk.id AND e.project_stage_id = ps.id AND e.status IN ('held', 'disputed')
       AND e.payee_id IS NOT NULL;
    IF v_escrows IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM finance.escrows e WHERE e.id = ANY (v_escrows) AND e.status = 'disputed') THEN
            RAISE EXCEPTION 'A card dispute has frozen this payment; it settles first' USING ERRCODE = 'PS409';
        END IF;
        IF tk.current_stage_id IS DISTINCT FROM ps.id
           OR NOT (tk.status = 'in_review' OR ps.status = 'submitted') THEN
            RAISE EXCEPTION 'A dispute can be raised once the work on this stage is submitted for review'
                USING ERRCODE = 'PS409';
        END IF;
        v_window := 'held';
    ELSE
        -- Else money released from this stage into the pending window, every clearing row untouched.
        SELECT pg_catalog.array_agg(e.id ORDER BY e.created_at, e.id) INTO v_escrows
          FROM finance.escrows e
         WHERE e.ticket_id = tk.id AND e.project_stage_id = ps.id AND e.status = 'released'
           AND EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.escrow_id = e.id);
        IF v_escrows IS NULL THEN
            RAISE EXCEPTION 'Nothing on this stage is held or still clearing, so there is nothing to dispute'
                USING ERRCODE = 'PS409';
        END IF;
        IF EXISTS (SELECT 1 FROM finance.pending_releases pr
                    WHERE pr.escrow_id = ANY (v_escrows) AND (pr.state <> 'pending' OR pr.recovered_cents > 0)) THEN
            RAISE EXCEPTION 'This stage''s payment has cleared or is part of a card dispute, so it can''t be disputed here. Contact support.'
                USING ERRCODE = 'PS409';
        END IF;
        v_window := 'pending';
    END IF;
    IF EXISTS (SELECT 1 FROM finance.disputes d
                WHERE d.escrow_id = ANY (v_escrows) AND d.status IN ('open', 'awaiting_response', 'under_review')) THEN
        RAISE EXCEPTION 'A dispute about this payment is already open' USING ERRCODE = 'PD409';
    END IF;
    SELECT pg_catalog.sum(e.amount_cents)::bigint, pg_catalog.max(e.currency) INTO v_amount, v_currency
      FROM finance.escrows e WHERE e.id = ANY (v_escrows);

    v_respond_by := pg_catalog.now() + pg_catalog.make_interval(
        hours => projects.fn_session_param('dispute_response_hours', 48));
    INSERT INTO finance.disputes (subject_kind, escrow_id, ticket_id, stage_id, claimant_side, opened_by_profile,
                                  reason, status, respond_by)
    VALUES ('ticket_escrow', v_escrows[1], tk.id, ps.id, v_side, v_uid, v_reason, 'awaiting_response', v_respond_by)
    RETURNING id INTO v_id;
    IF v_window = 'pending' THEN
        UPDATE finance.pending_releases SET state = 'on_hold', hold_dispute_id = v_id
         WHERE escrow_id = ANY (v_escrows) AND state = 'pending';
    END IF;
    INSERT INTO finance.dispute_messages (dispute_id, sender_user_id, party, body)
    VALUES (v_id, v_uid, 'claimant', v_body)
    RETURNING id INTO v_message;
    INSERT INTO finance.dispute_evidence (dispute_id, message_id, file_id, submitted_by)
    SELECT DISTINCT v_id, v_message, f.id, v_uid FROM pg_catalog.unnest(v_files) f(id);
    -- The Evidence Vault freezes now, in this transaction (PROJECTS EX3): nothing after the raise reaches it.
    v_vault := finance.fn_freeze_dispute_vault(v_id);

    SELECT * INTO v_ctx FROM finance.fn_dispute_context(v_id);
    IF v_ctx.owner_user_id IS NOT NULL THEN
        PERFORM comms.fn_notify(
            v_ctx.owner_user_id, 'dispute.opened',
            CASE v_side WHEN 'payer' THEN 'The client raised a dispute' ELSE 'The freelancer raised a dispute' END,
            pg_catalog.format('A dispute was raised about "%s": %s. %s Respond or make an offer by %s, or it goes to a Projective auditor.',
                tk.title, v_reason,
                CASE v_window WHEN 'held' THEN 'The payment stays held until it is settled.'
                     ELSE 'The payment''s clearing earnings are held until it is settled.' END,
                pg_catalog.to_char(v_respond_by AT TIME ZONE 'UTC', 'DD Mon YYYY HH24:MI "UTC"')),
            'finance.disputes', v_id,
            pg_catalog.jsonb_build_object('respond_by', v_respond_by, 'window', v_window),
            v_uid, 'project', p.id, NULL, v_ctx.respondent_href
        );
    END IF;
    RETURN pg_catalog.jsonb_build_object('dispute_id', v_id, 'status', 'awaiting_response',
        'respond_by', v_respond_by, 'window', v_window, 'amount_minor', v_amount, 'currency', v_currency,
        'vault', v_vault);
END;
$$;

-- Offer a settlement on a live ticket case (user door; ruling 3): the freelancer's share of the contested
-- money in basis points, 0 to 10000, with an optional note. Either side, any number of times; the newest
-- offer is the one standing. The other side is told. Returns what it would move.
CREATE OR REPLACE FUNCTION finance.propose_dispute_offer(
    p_dispute_id uuid,
    p_payee_share_bp integer,
    p_note text DEFAULT NULL
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
    v_note text := NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '');
    v_id uuid;
    v_split record;
    v_ctx record;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to make an offer' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_d FROM finance.disputes WHERE id = p_dispute_id FOR UPDATE;
    v_party := CASE WHEN FOUND THEN finance.fn_dispute_party(v_d.id, v_uid) END;
    IF v_party IS NULL THEN
        RAISE EXCEPTION 'That dispute does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_d.subject_kind <> 'ticket_escrow' THEN
        RAISE EXCEPTION 'Only a dispute about a ticket''s payment is settled by an offer' USING ERRCODE = '22023';
    END IF;
    IF v_d.status NOT IN ('awaiting_response', 'under_review') THEN
        RAISE EXCEPTION 'This dispute is closed' USING ERRCODE = 'PS409';
    END IF;
    IF p_payee_share_bp IS NULL OR p_payee_share_bp NOT BETWEEN 0 AND 10000 THEN
        RAISE EXCEPTION 'An offer gives the freelancer between 0 %% and 100 %% of the payment' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.length(COALESCE(v_note, '')) > 1000 THEN
        RAISE EXCEPTION 'Keep the note to 1,000 characters' USING ERRCODE = '22023';
    END IF;

    INSERT INTO finance.dispute_offers (dispute_id, proposed_by, party, payee_share_bp, note)
    VALUES (v_d.id, v_uid, v_party, p_payee_share_bp, v_note)
    RETURNING id INTO v_id;
    SELECT * INTO v_split FROM finance.fn_dispute_offer_split(finance.fn_ticket_dispute_escrows(v_d.id), p_payee_share_bp);

    SELECT * INTO v_ctx FROM finance.fn_dispute_context(v_d.id);
    PERFORM comms.fn_notify(
        CASE v_party WHEN 'claimant' THEN v_ctx.owner_user_id ELSE v_ctx.claimant END,
        'dispute.offer_made', 'A settlement offer on your dispute',
        pg_catalog.format('An offer on the dispute about "%s" gives the freelancer %s %% of the payment. Accept it to settle the case now, or answer with your own.',
            v_ctx.event_title, pg_catalog.trim_scale(p_payee_share_bp / 100.0)),
        'finance.disputes', v_d.id,
        pg_catalog.jsonb_build_object('offer_id', v_id, 'payee_share_bp', p_payee_share_bp),
        v_uid, 'project', v_ctx.project_id, NULL, v_ctx.claimant_href
    );
    RETURN pg_catalog.jsonb_build_object('offer_id', v_id, 'dispute_id', v_d.id, 'payee_share_bp', p_payee_share_bp,
        'payee_minor', v_split.payee_minor, 'fee_minor', v_split.fee_minor, 'refund_minor', v_split.refund_minor);
END;
$$;

-- Accept the standing offer (user door; ruling 3): the other side from whoever made it, while the case is
-- live and no newer offer stands; on the client side it is a money decision, so a business member needs
-- `hire`. The case settles at once on the offer's terms (finance.fn_settle_ticket_dispute), as agreed,
-- with no operator.
CREATE OR REPLACE FUNCTION finance.accept_dispute_offer(p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    o finance.dispute_offers;
    v_d finance.disputes;
    v_party text;
    v_ctx record;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to accept an offer' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO o FROM finance.dispute_offers WHERE id = p_offer_id;
    IF FOUND THEN
        SELECT * INTO v_d FROM finance.disputes WHERE id = o.dispute_id FOR UPDATE;
        SELECT * INTO o FROM finance.dispute_offers WHERE id = p_offer_id FOR UPDATE;
        v_party := finance.fn_dispute_party(v_d.id, v_uid);
    END IF;
    IF v_party IS NULL THEN
        RAISE EXCEPTION 'That offer doesn''t exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_d.status NOT IN ('awaiting_response', 'under_review') THEN
        RAISE EXCEPTION 'This dispute is closed' USING ERRCODE = 'PS409';
    END IF;
    IF o.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'This offer was already accepted' USING ERRCODE = 'PS409';
    END IF;
    IF EXISTS (SELECT 1 FROM finance.dispute_offers x
                WHERE x.dispute_id = o.dispute_id AND (x.created_at, x.id) > (o.created_at, o.id)) THEN
        RAISE EXCEPTION 'A newer offer replaced this one' USING ERRCODE = 'PS409';
    END IF;
    IF v_party = o.party THEN
        RAISE EXCEPTION 'Your side made this offer; the other side accepts it' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_ctx FROM finance.fn_dispute_context(v_d.id);
    IF finance.fn_ticket_escrow_side(v_d.escrow_id, v_uid) = 'payer' THEN
        PERFORM projects.fn_assert_business_actor(v_ctx.project_id, 'hire');
    END IF;

    UPDATE finance.dispute_offers SET accepted_at = pg_catalog.now(), accepted_by = v_uid WHERE id = o.id;
    RETURN finance.fn_settle_ticket_dispute(
        v_d.id,
        CASE o.payee_share_bp WHEN 10000 THEN 'release' WHEN 0 THEN 'refund' ELSE 'split' END,
        o.payee_share_bp, NULL,
        pg_catalog.format('Settled by agreement: %s %% of the payment to the freelancer.',
            pg_catalog.trim_scale(o.payee_share_bp / 100.0)),
        o.id
    );
END;
$$;

-- A ticket case's settlement, the one writer of its resolved_* status: an operator's ruling (through
-- finance.fn_settle_dispute) or an accepted offer, giving the freelancer p_bp basis points (release
-- 10000, refund 0, split between). The case is closed FIRST, because the ticket's money doors refuse
-- while it is live (DB3), then:
--   held     a release pays the stage's held escrow (finance.fn_release_ticket_escrow) and accepts the
--            submission awaiting review; the ticket stays on its stage for the client to move on,
--            because moving on holds the next stage's money from the client's wallet (the Chain
--            Reaction, projects.force_complete_stage), which only the client decides. A refund
--            (finance.fn_refund_ticket_escrow) or a split (finance.fn_fair_exit_release) ends the ticket
--            `cancelled`, as a Fair Exit does (Decision #198), its later reservations going back by the
--            prepay sync.
--   pending  the frozen clearing rows: a release returns them to clearing at their own dates; a refund
--            or split takes back what the freelancer is no longer due, from each row in proportion,
--            floored, the remainder from the rows taken last (the smallest), and returns it to the
--            client with the platform fee no longer earned (`fee_returned_minor`, a conservation term,
--            finance.v_conservation_identity) as `escrow_refund`.
--   by fact  the money settled on another path first: the case closes as it settled.
-- Then records what moved (`settlement`) and tells both sides. Internal.
CREATE OR REPLACE FUNCTION finance.fn_settle_ticket_dispute(
    p_dispute_id uuid,
    p_outcome text,
    p_bp integer,
    p_actor uuid,
    p_notes text,
    p_offer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
-- Not '' like its sibling doors: it UPDATEs projects.tickets, and the ticket triggers resolve their enum
-- types unqualified through the caller's search_path (the trap 00001240's record_dispute_closed notes).
-- Every name this body writes is still schema-qualified.
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_d finance.disputes;
    tk projects.tickets;
    v_bp integer;
    v_status public.dispute_status;
    v_window text;
    v_escrows uuid[];
    v_amount bigint;
    v_currency text;
    v_payee bigint := 0;
    v_fee bigint := 0;
    v_refund bigint := 0;
    v_fee_back bigint := 0;
    v_rows bigint;
    v_due bigint;
    v_fee_due bigint;
    v_recover bigint;
    v_left_rows bigint;
    v_left_recover bigint;
    v_take bigint;
    v_settlement jsonb;
    v_ctx record;
    v_how text;
    v_title text;
    v_party uuid;
    e record;
    r record;
BEGIN
    SELECT * INTO v_d FROM finance.disputes WHERE id = p_dispute_id AND subject_kind = 'ticket_escrow' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That dispute does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_d.status::text LIKE 'resolved\_%' THEN
        RAISE EXCEPTION 'This dispute is already resolved' USING ERRCODE = 'PS409';
    END IF;
    v_bp := CASE p_outcome WHEN 'release' THEN 10000 WHEN 'refund' THEN 0 WHEN 'split' THEN p_bp END;
    IF p_outcome IS NULL OR p_outcome NOT IN ('release', 'refund', 'split') THEN
        RAISE EXCEPTION 'A ruling is release, refund or split' USING ERRCODE = '22023';
    END IF;
    IF p_outcome = 'split' AND (p_bp IS NULL OR p_bp NOT BETWEEN 1 AND 9999) THEN
        RAISE EXCEPTION 'A split gives the freelancer between 0.01 %% and 99.99 %%' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO tk FROM projects.tickets WHERE id = v_d.ticket_id FOR UPDATE;
    v_window := CASE WHEN EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.hold_dispute_id = v_d.id)
                     THEN 'pending' ELSE 'held' END;
    v_escrows := finance.fn_ticket_dispute_escrows(v_d.id);
    PERFORM 1 FROM finance.escrows x WHERE x.id = ANY (v_escrows) ORDER BY x.id FOR UPDATE;
    SELECT pg_catalog.sum(x.amount_cents)::bigint, pg_catalog.max(x.currency) INTO v_amount, v_currency
      FROM finance.escrows x WHERE x.id = ANY (v_escrows);
    IF (v_window = 'held' AND NOT EXISTS (SELECT 1 FROM finance.escrows x
                                           WHERE x.id = ANY (v_escrows) AND x.status = 'held'))
       OR (v_window = 'pending' AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr
                                                 WHERE pr.hold_dispute_id = v_d.id AND pr.state = 'on_hold')) THEN
        v_window := 'by_fact';
        v_status := CASE WHEN (SELECT x.status FROM finance.escrows x WHERE x.id = v_d.escrow_id) = 'refunded'
                         THEN 'resolved_refund' ELSE 'resolved_release' END;
    ELSE
        v_status := CASE v_bp WHEN 10000 THEN 'resolved_release' WHEN 0 THEN 'resolved_refund' ELSE 'resolved_split' END;
    END IF;

    UPDATE finance.disputes
       SET status = v_status,
           resolved_at = pg_catalog.now(),
           resolved_by = p_actor,
           resolution_notes = NULLIF(pg_catalog.btrim(COALESCE(p_notes, '')), ''),
           payee_share_bp = CASE WHEN v_status = 'resolved_split' THEN v_bp END,
           updated_at = pg_catalog.now()
     WHERE id = v_d.id;

    IF v_window = 'held' THEN
        IF v_bp = 10000 THEN
            PERFORM finance.fn_release_ticket_escrow(tk.id);
            UPDATE projects.stage_submissions
               SET status = 'accepted', reviewed_at = pg_catalog.now(), updated_at = pg_catalog.now()
             WHERE ticket_id = tk.id AND project_stage_id = v_d.stage_id AND status = 'pending_review';
        ELSE
            IF v_bp = 0 THEN
                PERFORM finance.fn_refund_ticket_escrow(tk.id);
            ELSE
                PERFORM finance.fn_fair_exit_release(tk.id, v_bp);
            END IF;
            UPDATE projects.tickets SET status = 'cancelled'::public.ticket_status, hidden_until = NULL
             WHERE id = tk.id AND status NOT IN ('completed'::public.ticket_status, 'cancelled'::public.ticket_status);
            IF FOUND AND auth.uid() IS NOT NULL THEN
                INSERT INTO projects.ticket_history
                    (ticket_id, actor_id, action_type, previous_stage_id, new_stage_id, previous_status, new_status, changes)
                VALUES
                    (tk.id, auth.uid(), 'status_changed', tk.current_stage_id, tk.current_stage_id, tk.status,
                     'cancelled'::public.ticket_status,
                     pg_catalog.jsonb_build_object('from_status', tk.status, 'to_status', 'cancelled',
                         'reason', 'dispute', 'dispute_id', v_d.id, 'payee_share_bp', v_bp));
            END IF;
        END IF;
        SELECT COALESCE(pg_catalog.sum(pr.amount_cents), 0)::bigint INTO v_payee
          FROM finance.pending_releases pr WHERE pr.escrow_id = ANY (v_escrows);
        SELECT COALESCE(pg_catalog.sum(x.platform_fee_cents), 0)::bigint INTO v_fee
          FROM finance.escrows x WHERE x.id = ANY (v_escrows) AND x.status = 'released';
        v_refund := v_amount - v_payee - v_fee;
    ELSIF v_window = 'pending' THEN
        FOR e IN SELECT x.* FROM finance.escrows x WHERE x.id = ANY (v_escrows) ORDER BY x.id LOOP
            SELECT COALESCE(pg_catalog.sum(pr.amount_cents - pr.recovered_cents), 0)::bigint INTO v_rows
              FROM finance.pending_releases pr
             WHERE pr.escrow_id = e.id AND pr.hold_dispute_id = v_d.id AND pr.state = 'on_hold';
            IF v_bp = 10000 THEN
                v_due := v_rows;
                v_fee_due := e.platform_fee_cents;
            ELSE
                SELECT s.payout_cents, s.fee_cents INTO v_due, v_fee_due
                  FROM finance.fn_fair_exit_split(e.amount_cents, v_bp,
                           finance.fn_escrow_fee_bp(e.payer_business_id, e.payer_user_id)) s;
                v_due := LEAST(v_due, v_rows);
                v_fee_due := LEAST(v_fee_due, e.platform_fee_cents);
            END IF;
            v_recover := v_rows - v_due;
            v_left_rows := v_rows;
            v_left_recover := v_recover;
            FOR r IN
                SELECT pr.id, pr.amount_cents - pr.recovered_cents AS left_cents
                  FROM finance.pending_releases pr
                 WHERE pr.escrow_id = e.id AND pr.hold_dispute_id = v_d.id AND pr.state = 'on_hold'
                 ORDER BY pr.amount_cents - pr.recovered_cents DESC, pr.id
                   FOR UPDATE
            LOOP
                v_take := CASE WHEN v_left_rows <= 0 THEN 0 ELSE (r.left_cents * v_left_recover) / v_left_rows END;
                v_left_rows := v_left_rows - r.left_cents;
                v_left_recover := v_left_recover - v_take;
                UPDATE finance.pending_releases
                   SET recovered_cents = recovered_cents + v_take,
                       state = CASE WHEN recovered_cents + v_take = amount_cents
                                    THEN 'available'::finance.fund_state ELSE 'pending'::finance.fund_state END,
                       matured_at = CASE WHEN recovered_cents + v_take = amount_cents THEN pg_catalog.now() END
                 WHERE id = r.id;
            END LOOP;
            PERFORM finance.fn_refund_escrow_to_payer(e.id, v_recover + e.platform_fee_cents - v_fee_due, 'escrow_refund');
            v_payee := v_payee + v_due;
            v_fee := v_fee + v_fee_due;
            v_refund := v_refund + v_recover + e.platform_fee_cents - v_fee_due;
            v_fee_back := v_fee_back + e.platform_fee_cents - v_fee_due;
        END LOOP;
    END IF;

    v_settlement := CASE WHEN v_window = 'by_fact' THEN
            pg_catalog.jsonb_build_object('by_fact', true,
                'escrow_status', (SELECT x.status FROM finance.escrows x WHERE x.id = v_d.escrow_id),
                'currency', v_currency)
        ELSE pg_catalog.jsonb_build_object('payee_minor', v_payee, 'fee_minor', v_fee, 'refund_minor', v_refund,
                'currency', v_currency, 'window', v_window)
             || CASE WHEN v_fee_back > 0 THEN pg_catalog.jsonb_build_object('fee_returned_minor', v_fee_back)
                     ELSE '{}'::jsonb END
        END
        || CASE WHEN p_offer_id IS NOT NULL THEN pg_catalog.jsonb_build_object('offer_id', p_offer_id)
                ELSE '{}'::jsonb END;
    UPDATE finance.disputes SET settlement = v_settlement, updated_at = pg_catalog.now() WHERE id = v_d.id;

    SELECT * INTO v_ctx FROM finance.fn_dispute_context(v_d.id);
    v_how := CASE WHEN p_offer_id IS NOT NULL THEN 'by agreement'
                  WHEN p_actor IS NOT NULL THEN 'by a Projective auditor'
                  ELSE 'as its payment settled' END;
    v_title := CASE v_status WHEN 'resolved_refund' THEN 'Dispute closed — refunded to the client'
                             WHEN 'resolved_split' THEN 'Dispute settled — payment split'
                             ELSE 'Dispute closed — paid to the freelancer' END;
    FOREACH v_party IN ARRAY ARRAY[v_ctx.claimant, v_ctx.owner_user_id] LOOP
        CONTINUE WHEN v_party IS NULL;
        PERFORM comms.fn_notify(
            v_party, 'dispute.resolved', v_title,
            pg_catalog.format('The dispute about "%s" was settled %s. %s', v_ctx.event_title, v_how, CASE v_status
                WHEN 'resolved_refund' THEN 'The payment went back to the client.'
                WHEN 'resolved_split' THEN pg_catalog.format('The freelancer was paid %s %% of it and the rest went back to the client.',
                    pg_catalog.trim_scale(v_bp / 100.0))
                ELSE 'The payment goes to the freelancer.' END),
            'finance.disputes', v_d.id,
            pg_catalog.jsonb_build_object('status', v_status, 'settlement', v_settlement),
            p_actor, 'project', v_ctx.project_id, NULL, v_ctx.claimant_href
        );
    END LOOP;
    RETURN pg_catalog.jsonb_build_object('dispute_id', v_d.id, 'status', v_status, 'settlement', v_settlement);
END;
$$;
-- #endregion


-- #region 6d. The Evidence Vault (PROJECTS EX3; Decision #548 (6))
-- The snapshot a ticket dispute freezes as it is raised (PRODUCT_SPEC §Dispute Resolution 1), so neither
-- side can "clean up" afterwards: the ticket's and stage's terms at raise (their rows as they stood),
-- the contested escrows, the ticket's history, every submission on the stage with its files (each by
-- the hash `files.items` stored and its object's place), and the stage's rooms' messages. The manifest
-- is jsonb, so its text is canonical (sorted keys, one spacing): `sha256` is that text's SHA-256 and
-- re-reading it hashes the same. The messages are each one's current body: the revision history is
-- CH1's, and the vault reads it once CH1 keeps it. The files' bytes are copied by the dispute service
-- into the policy-less `evidence` bucket under `vault/{dispute_id}/` (bytes cannot be copied in SQL),
-- and finance.mark_dispute_vault_ready stamps the vault ready. Nothing purges it (⚖️ counsel's).

-- The manifest for a ticket dispute (internal). NULL for any other kind of dispute.
CREATE OR REPLACE FUNCTION finance.fn_dispute_vault_manifest(p_dispute_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'version', 1,
        'dispute', pg_catalog.jsonb_build_object(
            'id', d.id, 'subject_kind', d.subject_kind, 'reason', d.reason, 'claimant_side', d.claimant_side,
            'opened_by', d.opened_by_profile, 'opened_at', d.created_at),
        'ticket', pg_catalog.to_jsonb(tk),
        'stage', pg_catalog.to_jsonb(ps),
        'escrows', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'id', e.id, 'amount_cents', e.amount_cents, 'currency', e.currency, 'status', e.status,
                       'payee_type', e.payee_type, 'payee_id', e.payee_id, 'created_at', e.created_at)
                   ORDER BY e.id)
              FROM finance.escrows e
             WHERE e.id = ANY (finance.fn_ticket_dispute_escrows(d.id))
        ), '[]'::jsonb),
        'history', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'id', h.id, 'actor_id', h.actor_id, 'action_type', h.action_type,
                       'previous_stage_id', h.previous_stage_id, 'new_stage_id', h.new_stage_id,
                       'previous_status', h.previous_status, 'new_status', h.new_status,
                       'changes', h.changes, 'created_at', h.created_at)
                   ORDER BY h.created_at, h.id)
              FROM projects.ticket_history h
             WHERE h.ticket_id = d.ticket_id
        ), '[]'::jsonb),
        'submissions', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'id', ss.id, 'number', ss.number, 'title', ss.title, 'status', ss.status,
                       'notes', ss.notes, 'description', ss.description, 'revision_of', ss.revision_of,
                       'submitted_by', ss.submitted_by, 'created_at', ss.created_at,
                       'reviewed_at', ss.reviewed_at, 'feedback', ss.feedback,
                       'files', COALESCE((
                           SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                      'file_id', i.id, 'name', i.display_name, 'mime_type', i.mime_type,
                                      'size_bytes', i.size_bytes, 'content_hash', i.content_hash,
                                      'hash_algo', i.hash_algo, 'bucket', i.bucket_id, 'path', i.storage_path)
                                  ORDER BY i.id)
                             FROM projects.submission_files sf
                             JOIN files.items i ON i.id = sf.file_id
                            WHERE sf.submission_id = ss.id
                       ), '[]'::jsonb))
                   ORDER BY ss.created_at, ss.id)
              FROM projects.stage_submissions ss
             WHERE ss.ticket_id = d.ticket_id AND ss.project_stage_id = d.stage_id
        ), '[]'::jsonb),
        'messages', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'id', m.id, 'channel_id', c.id, 'channel', c.name, 'sender_user_id', m.sender_user_id,
                       'body', m.body, 'created_at', m.created_at, 'edited_at', m.edited_at,
                       'deleted_at', m.deleted_at)
                   ORDER BY m.created_at, m.id)
              FROM comms.project_channels c
              JOIN comms.project_messages m ON m.channel_id = c.id
             WHERE c.stage_id = d.stage_id
        ), '[]'::jsonb)
    )
      FROM finance.disputes d
      JOIN projects.tickets tk ON tk.id = d.ticket_id
      JOIN projects.project_stages ps ON ps.id = d.stage_id
     WHERE d.id = p_dispute_id AND d.subject_kind = 'ticket_escrow';
$$;

-- Freeze a ticket dispute's vault (internal; open_ticket_dispute calls it in its own transaction).
-- Returns the hash, the prefix and every file the service is to copy there, each with its source.
CREATE OR REPLACE FUNCTION finance.fn_freeze_dispute_vault(p_dispute_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_manifest jsonb := finance.fn_dispute_vault_manifest(p_dispute_id);
    v_sha text;
    v_prefix text := 'vault/' || p_dispute_id::text || '/';
BEGIN
    IF v_manifest IS NULL THEN
        RETURN NULL;
    END IF;
    v_sha := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_manifest::text, 'UTF8')), 'hex');
    INSERT INTO finance.dispute_vaults (dispute_id, manifest, sha256, object_prefix)
    VALUES (p_dispute_id, v_manifest, v_sha, v_prefix);
    RETURN pg_catalog.jsonb_build_object(
        'sha256', v_sha,
        'object_prefix', v_prefix,
        'files', COALESCE((
            SELECT pg_catalog.jsonb_agg(DISTINCT pg_catalog.jsonb_build_object(
                       'file_id', f ->> 'file_id', 'bucket', f ->> 'bucket', 'path', f ->> 'path'))
              FROM pg_catalog.jsonb_array_elements(v_manifest -> 'submissions') s,
                   pg_catalog.jsonb_array_elements(s -> 'files') f
        ), '[]'::jsonb)
    );
END;
$$;

-- The service's word that every file of the vault now sits under its prefix (service role only: no
-- client can claim bytes were copied). Idempotent; returns the status, NULL for an unknown vault.
CREATE OR REPLACE FUNCTION finance.mark_dispute_vault_ready(p_dispute_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status text;
BEGIN
    UPDATE finance.dispute_vaults SET status = 'ready'
     WHERE dispute_id = p_dispute_id AND status = 'pending';
    SELECT v.status INTO v_status FROM finance.dispute_vaults v WHERE v.dispute_id = p_dispute_id;
    RETURN v_status;
END;
$$;

-- A dispute's vault for its reader (read): the parties read the manifest and its hash; an operator
-- reads the raw snapshot, with where its bytes are (`object_prefix`). NULL for anyone else, and for a
-- dispute with no vault.
CREATE OR REPLACE FUNCTION finance.get_dispute_vault(p_dispute_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_role text;
    v finance.dispute_vaults;
BEGIN
    SELECT * INTO v FROM finance.dispute_vaults WHERE dispute_id = p_dispute_id;
    IF NOT FOUND OR v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    v_role := finance.fn_dispute_party(p_dispute_id, v_uid);
    IF v_role IS NULL AND security.is_admin() THEN
        v_role := 'operator';
    END IF;
    IF v_role IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'dispute_id', v.dispute_id, 'role', v_role, 'status', v.status, 'sha256', v.sha256,
        'created_at', v.created_at, 'manifest', v.manifest,
        'object_prefix', CASE WHEN v_role = 'operator' THEN v.object_prefix END
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
                             'kind', CASE WHEN d.subject_kind = 'order_line' THEN 'product'
                                          WHEN d.subject_kind = 'ticket_escrow' THEN 'ticket'
                                          WHEN d.session_event_id IS NOT NULL THEN 'no_show' ELSE 'general' END,
                             'reason', d.reason,
                             'opened_at', d.created_at,
                             'respond_by', d.respond_by,
                             'escalated_at', d.escalated_at,
                             'review_by', d.review_by,
                             'overdue', d.status = 'under_review' AND d.review_by <= v_now,
                             'amount_minor', COALESCE(
                                 CASE WHEN d.subject_kind = 'ticket_escrow' THEN (
                                     SELECT pg_catalog.sum(x.amount_cents)::bigint FROM finance.escrows x
                                      WHERE x.id = ANY (finance.fn_ticket_dispute_escrows(d.id))) END,
                                 e.amount_cents, GREATEST(ol.line_total_minor - ol.promo_discount_minor, 0)),
                             'currency', COALESCE(e.currency, ol.currency),
                             'project', CASE WHEN p.id IS NOT NULL THEN
                                 pg_catalog.jsonb_build_object('slug', p.slug, 'title', p.title) END,
                             'purchase', CASE WHEN ol.id IS NOT NULL THEN
                                 pg_catalog.jsonb_build_object('title', ol.title) END,
                             'ticket', CASE WHEN tk.id IS NOT NULL THEN
                                 pg_catalog.jsonb_build_object('title', tk.title, 'slug', tk.slug) END,
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
                    LEFT JOIN finance.escrows e ON e.id = d.escrow_id
                    LEFT JOIN projects.project_stages ps ON ps.id = e.project_stage_id
                    LEFT JOIN projects.projects p ON p.id = ps.project_id
                    LEFT JOIN projects.session_events se ON se.id = d.session_event_id
                    LEFT JOIN finance.order_lines ol ON ol.id = d.order_line_id
                    LEFT JOIN catalogue.products cp ON cp.id = ol.item_id
                    LEFT JOIN projects.tickets tk ON tk.id = d.ticket_id
                    LEFT JOIN LATERAL finance.fn_dispute_context(d.id) ctx ON true
                    LEFT JOIN org.users_public cu ON cu.user_id = d.opened_by_profile
                    LEFT JOIN org.users_public ou ON ou.user_id = ctx.owner_user_id
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
           -- A ticket case on money already released holds its clearing rows: the ruling settles it.
           AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.hold_dispute_id = d.id)
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
    -- An offer (PROJECTS EX2) is stamped accepted once; nothing else about it ever changes.
    IF TG_TABLE_NAME = 'dispute_offers' THEN
        IF OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL
           AND (pg_catalog.to_jsonb(NEW) - 'accepted_at' - 'accepted_by')
             = (pg_catalog.to_jsonb(OLD) - 'accepted_at' - 'accepted_by') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'An offer is never changed once made' USING ERRCODE = '42501';
    END IF;
    -- A vault (PROJECTS EX3) moves pending -> ready once; its manifest and hash never change.
    IF TG_TABLE_NAME = 'dispute_vaults' THEN
        IF OLD.status = 'pending' AND NEW.status = 'ready'
           AND (pg_catalog.to_jsonb(NEW) - 'status') = (pg_catalog.to_jsonb(OLD) - 'status') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'An Evidence Vault is never changed once frozen' USING ERRCODE = '42501';
    END IF;
    IF TG_TABLE_NAME <> 'disputes' THEN
        RAISE EXCEPTION '% rows are never changed once filed', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    IF OLD.status::text LIKE 'resolved\_%' THEN
        -- A ticket's money doors refuse while its case is live (DB3), so a ticket ruling closes the case
        -- first and records what moved after them, once, inside the ruling's own transaction.
        IF OLD.settlement IS NULL AND NEW.settlement IS NOT NULL AND OLD.resolved_at = pg_catalog.now()
           AND (pg_catalog.to_jsonb(NEW) - 'settlement' - 'updated_at')
             = (pg_catalog.to_jsonb(OLD) - 'settlement' - 'updated_at') THEN
            RETURN NEW;
        END IF;
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
