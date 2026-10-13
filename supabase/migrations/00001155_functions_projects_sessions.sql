-- =============================================================================================
-- 00001155_functions_projects_sessions.sql — session & group-session engagements (Category 1).
--
-- Decision #171. A session engagement is a `projects.projects` row with `format = 'session'` whose
-- stage carries one or more COHORTS (a 1-1 session is a cohort of one seat). Everything money- or
-- evidence-shaped about a sitting goes through a definer here:
--
--   1. Occupancy           fn_cohort_seats_taken — paid seats + unexpired holds
--   2. The listing's offer get_cohort_offer      — the public read the entity view and Book flow use
--   3. Reserve             reserve_seat          — a TTL hold, under a row lock on the cohort
--   4. Confirm             fn_confirm_seat       — hold → membership + escrow, when the order settles
--   5. Cancel              cancel_cohort_membership — PRODUCT_SPEC's late-cancel rule (full forfeit <24h)
--   6. Presence            record_presence       — the provider webhook's door (service_role only)
--   7. The 15-minute rule  fn_session_presence
--   8. Host attestation    record_host_attendance
--   9. No-show claim       claim_session_no_show — a finance.disputes row that stops auto-release
--  10. Join link           session_join_link     — the caller's URL, only when funded and in the window
--  11. Curriculum          complete_lesson
--  12. Auto-release        finance.auto_release_session_escrow (+ pg_cron)
--  13. Workspace read      get_session_workspace — one definer read behind the session sidebars
--
-- The escrow lifetime is PRODUCT_SPEC §Escrow Lifetimes' Sessions row: locked at booking, released
-- `session_payout_hours` after the session ends unless a no-show claim is open.
-- =============================================================================================

-- #region Helpers
-- An integer platform param, with the fallback a missing row reads as.
CREATE OR REPLACE FUNCTION projects.fn_session_param(p_key text, p_default integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT (pp.value #>> '{}')::integer FROM security.platform_params pp WHERE pp.key = p_key),
        p_default
    );
$$;

-- Whether a user delivers this engagement: its owner, or an active member of the team that owns it.
CREATE OR REPLACE FUNCTION projects.fn_is_session_host(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = p_project_id
          AND (
              p.owner_user_id = p_user_id
              OR (p.owner_team_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM org.team_members tm
                  WHERE tm.team_id = p.owner_team_id AND tm.user_id = p_user_id AND tm.status = 'active'
              ))
          )
    );
$$;
-- #endregion

-- #region 1. Occupancy
-- Seats a cohort cannot offer: every seat of a membership that is not cancelled, plus every hold that
-- has not lapsed. `p_except_user` leaves out that buyer's own live hold, so a buyer renewing their
-- reservation is not counted against themselves. A hold lapses by its instant alone — nothing has to
-- sweep it for the seat to come back.
CREATE OR REPLACE FUNCTION projects.fn_cohort_seats_taken(p_cohort_id uuid, p_except_user uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (
        COALESCE((
            SELECT sum(cm.seats) FROM projects.cohort_memberships cm
            WHERE cm.cohort_id = p_cohort_id AND cm.status <> 'cancelled'
        ), 0)
        + COALESCE((
            SELECT sum(h.seats) FROM projects.cohort_seat_holds h
            WHERE h.cohort_id = p_cohort_id
              AND h.status = 'held'
              AND h.expires_at > pg_catalog.now()
              AND (p_except_user IS NULL OR h.user_id <> p_except_user)
        ), 0)
    )::integer;
$$;
-- #endregion

-- #region 2. The listing's cohort offer
-- The cohort a group-session LISTING seats buyers into right now — the enrolling cohort, on a session
-- engagement built from that blueprint, whose first sitting is soonest — with its real occupancy, its
-- sittings and its curriculum (the stage's standing plan, then the cohort's own). Public: the entity
-- view is read by guests, and every figure here is one the listing must disclose before purchase
-- (PRODUCT_SPEC §The Entity View, "remaining capacity"). It returns no person, no URL and no money
-- beyond the seat count. NULL when the listing has no enrolling cohort.
CREATE OR REPLACE FUNCTION projects.get_cohort_offer(p_blueprint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v record;
    v_taken integer;
BEGIN
    SELECT c.id, c.name, c.max_seats, c.project_stage_id,
           (SELECT min(se.start_time) FROM projects.session_events se
             WHERE se.cohort_id = c.id AND se.status = 'scheduled') AS first_start
      INTO v
      FROM projects.cohorts c
      JOIN projects.projects p ON p.id = c.project_id
      JOIN marketplace.service_blueprints sb ON sb.id = p.source_blueprint_id
     WHERE p.source_blueprint_id = p_blueprint_id
       AND p.format = 'session'
       AND p.status IN ('draft', 'active')
       AND c.status = 'enrolling'
       -- A listing nobody may see yet answers only its own seller (their preview).
       AND (sb.is_published OR projects.fn_is_session_host(p.id, auth.uid()))
     ORDER BY first_start NULLS LAST, c.created_at
     LIMIT 1;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    v_taken := LEAST(projects.fn_cohort_seats_taken(v.id), v.max_seats);

    RETURN pg_catalog.jsonb_build_object(
        'cohort_id', v.id,
        'name', v.name,
        'max_seats', v.max_seats,
        'taken', v_taken,
        'remaining', v.max_seats - v_taken,
        'first_start', v.first_start,
        'sittings', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', se.id, 'title', se.title, 'starts_at', se.start_time, 'ends_at', se.end_time
            ) ORDER BY se.start_time)
              FROM projects.session_events se
             WHERE se.cohort_id = v.id AND se.status IN ('scheduled', 'completed')
        ), '[]'::jsonb),
        'curriculum', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', m.id,
                'title', m.title,
                'summary', m.summary,
                'starts_at', se.start_time,
                'lessons', COALESCE((
                    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'id', l.id, 'title', l.title, 'duration_minutes', l.duration_minutes
                    ) ORDER BY l.position, l.created_at)
                      FROM projects.curriculum_lessons l WHERE l.module_id = m.id
                ), '[]'::jsonb)
            ) ORDER BY (m.cohort_id IS NOT NULL), se.start_time NULLS LAST, m.position, m.created_at)
              FROM projects.curriculum_modules m
              LEFT JOIN projects.session_events se ON se.id = m.session_event_id
             WHERE m.project_stage_id = v.project_stage_id OR m.cohort_id = v.id
        ), '[]'::jsonb)
    );
END;
$$;
-- #endregion

-- #region 3. Reserve a seat
-- Place (or renew) the caller's hold on `p_seats` seats of a cohort, for `seat_hold_minutes`.
--
-- The cohort row is locked FOR UPDATE before occupancy is counted, so the count and the insert are
-- one serialised step: two buyers racing for the last seat queue on the lock and the second one sees
-- the first one's hold. One live hold per buyer per cohort (`uq_cohort_seat_holds_live`) — asking
-- again renews it rather than stacking a second.
--
-- Refusals: 42501 signed out · 22023 a seat count outside 1–500 · P0002 no such cohort · PU422 your
-- own session · PS409 closed / full / already seated, with DETAIL {reason, remaining}.
CREATE OR REPLACE FUNCTION projects.reserve_seat(p_cohort_id uuid, p_seats integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_cohort projects.cohorts;
    v_taken integer;
    v_hold projects.cohort_seat_holds;
    v_expires timestamptz;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to reserve a seat' USING ERRCODE = '42501';
    END IF;
    IF p_seats IS NULL OR p_seats < 1 OR p_seats > 500 THEN
        RAISE EXCEPTION 'Reserve between 1 and 500 seats' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_cohort FROM projects.cohorts WHERE id = p_cohort_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That cohort no longer exists' USING ERRCODE = 'P0002';
    END IF;
    IF projects.fn_is_session_host(v_cohort.project_id, v_uid) THEN
        RAISE EXCEPTION 'You can''t reserve a seat on your own session' USING ERRCODE = 'PU422';
    END IF;
    IF v_cohort.status <> 'enrolling' THEN
        RAISE EXCEPTION USING ERRCODE = 'PS409', MESSAGE = 'This cohort isn''t taking bookings',
            DETAIL = pg_catalog.jsonb_build_object('reason', 'closed', 'remaining', 0)::text;
    END IF;
    IF EXISTS (
        SELECT 1 FROM projects.cohort_memberships cm
        WHERE cm.cohort_id = p_cohort_id AND cm.user_id = v_uid AND cm.status = 'active'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PS409', MESSAGE = 'You already have a seat in this cohort',
            DETAIL = pg_catalog.jsonb_build_object('reason', 'already_seated', 'remaining', NULL)::text;
    END IF;

    v_taken := projects.fn_cohort_seats_taken(p_cohort_id, v_uid);
    IF v_taken + p_seats > v_cohort.max_seats THEN
        RAISE EXCEPTION USING ERRCODE = 'PS409',
            MESSAGE = CASE WHEN v_taken >= v_cohort.max_seats THEN 'Every seat in this cohort is taken'
                ELSE pg_catalog.format('Only %s seat%s left in this cohort', v_cohort.max_seats - v_taken,
                    CASE WHEN v_cohort.max_seats - v_taken = 1 THEN '' ELSE 's' END) END,
            DETAIL = pg_catalog.jsonb_build_object(
                'reason', 'full', 'remaining', GREATEST(v_cohort.max_seats - v_taken, 0))::text;
    END IF;

    v_expires := pg_catalog.now() + pg_catalog.make_interval(
        mins => projects.fn_session_param('seat_hold_minutes', 15));

    UPDATE projects.cohort_seat_holds
       SET seats = p_seats, expires_at = v_expires, updated_at = pg_catalog.now()
     WHERE cohort_id = p_cohort_id AND user_id = v_uid AND status = 'held'
    RETURNING * INTO v_hold;
    IF NOT FOUND THEN
        INSERT INTO projects.cohort_seat_holds (cohort_id, user_id, seats, expires_at)
        VALUES (p_cohort_id, v_uid, p_seats, v_expires)
        RETURNING * INTO v_hold;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'hold_id', v_hold.id,
        'cohort_id', v_hold.cohort_id,
        'seats', v_hold.seats,
        'expires_at', v_hold.expires_at,
        'max_seats', v_cohort.max_seats,
        'remaining', v_cohort.max_seats - v_taken - p_seats
    );
END;
$$;

COMMENT ON FUNCTION projects.reserve_seat(uuid, integer) IS
'Hold seats on an enrolling cohort for seat_hold_minutes (renewing the caller''s live hold), under a row
lock on the cohort so the last seat cannot be sold twice. Refusals: 42501 · 22023 · P0002 · PU422 own
session · PS409 closed/full/already seated (DETAIL {reason, remaining}).';
-- #endregion

-- #region 4. Confirm a seat — when the order that paid for it settles
-- Internal: `finance.place_wallet_order` calls it for a `course_group_session` line, inside its own
-- transaction, after writing the order line. Turns the buyer's hold into a membership and holds the
-- seat's price in escrow from the paying wallet — the Sessions row of PRODUCT_SPEC §Escrow Lifetimes
-- ("Booking: escrow locked"). Nothing reaches the seller here: the escrow releases after the session.
--
-- A hold that lapsed while the buyer paid (a slow card, a 3-D Secure prompt) is honoured if the seat
-- is still free — the cohort is locked and occupancy re-counted — and refused if someone else took it,
-- so a seat is never sold twice and a buyer is never charged for a seat they did not get (the whole
-- order rolls back with the refusal).
CREATE OR REPLACE FUNCTION projects.fn_confirm_seat(
    p_hold_id uuid,
    p_buyer uuid,
    p_payer_type text,
    p_payer_id uuid,
    p_amount bigint,
    p_currency text,
    p_order_line_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_hold projects.cohort_seat_holds;
    v_cohort projects.cohorts;
    v_project projects.projects;
    v_membership uuid;
    v_escrow uuid;
    v_payee_type public.assignment_type;
    v_payee_id uuid;
BEGIN
    SELECT * INTO v_hold FROM projects.cohort_seat_holds WHERE id = p_hold_id FOR UPDATE;
    IF NOT FOUND OR v_hold.user_id IS DISTINCT FROM p_buyer OR v_hold.status <> 'held' THEN
        RAISE EXCEPTION 'Your seat reservation is no longer held — reserve the seat again'
            USING ERRCODE = 'PC409';
    END IF;
    SELECT * INTO v_cohort FROM projects.cohorts WHERE id = v_hold.cohort_id FOR UPDATE;
    IF v_cohort.status <> 'enrolling' THEN
        RAISE EXCEPTION 'This cohort stopped taking bookings while you were paying' USING ERRCODE = 'PS409';
    END IF;
    IF v_hold.expires_at <= pg_catalog.now()
       AND projects.fn_cohort_seats_taken(v_cohort.id, p_buyer) + v_hold.seats > v_cohort.max_seats THEN
        RAISE EXCEPTION 'Your reservation lapsed and the seat was taken — nothing was charged'
            USING ERRCODE = 'PS409';
    END IF;
    IF p_payer_type NOT IN ('user', 'freelancer', 'business') THEN
        RAISE EXCEPTION 'Book a seat from your personal or business account' USING ERRCODE = 'PU422';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'This seat has no price to hold in escrow' USING ERRCODE = 'PF402';
    END IF;

    SELECT * INTO v_project FROM projects.projects WHERE id = v_cohort.project_id;
    IF v_project.owner_team_id IS NOT NULL THEN
        v_payee_type := 'team'::public.assignment_type;
        v_payee_id := v_project.owner_team_id;
    ELSE
        v_payee_type := 'freelancer'::public.assignment_type;
        v_payee_id := v_project.owner_user_id;
    END IF;

    -- A seat given up earlier is taken again on the same row (one row per person per cohort).
    INSERT INTO projects.cohort_memberships (cohort_id, user_id, seats, status, order_line_id)
    VALUES (v_cohort.id, p_buyer, v_hold.seats, 'active', p_order_line_id)
    ON CONFLICT (cohort_id, user_id) DO UPDATE
       SET status = 'active', seats = EXCLUDED.seats, order_line_id = EXCLUDED.order_line_id,
           joined_at = pg_catalog.now(), cancelled_at = NULL
     WHERE projects.cohort_memberships.status <> 'active'
    RETURNING id INTO v_membership;
    IF v_membership IS NULL THEN
        RAISE EXCEPTION 'You already have a seat in this cohort' USING ERRCODE = 'PS409';
    END IF;

    INSERT INTO finance.escrows (
        project_stage_id, cohort_membership_id, payer_business_id, payer_user_id,
        payee_type, payee_id, amount_cents, currency, status
    ) VALUES (
        v_cohort.project_stage_id, v_membership,
        CASE WHEN p_payer_type = 'business' THEN p_payer_id END,
        CASE WHEN p_payer_type <> 'business' THEN p_payer_id END,
        v_payee_type, v_payee_id, p_amount, pg_catalog.upper(p_currency), 'held'
    )
    RETURNING id INTO v_escrow;
    PERFORM finance.fn_wallet_debit(p_payer_id, p_payer_type, pg_catalog.upper(p_currency), p_amount,
        'escrow_hold', 'escrows', v_escrow);

    UPDATE projects.cohort_seat_holds
       SET status = 'converted', membership_id = v_membership, updated_at = pg_catalog.now()
     WHERE id = v_hold.id;

    PERFORM comms.fn_notify(
        v_project.owner_user_id, 'session.booked', 'Seat booked',
        pg_catalog.format('A seat on "%s" was booked. The payment is held in escrow until after the session.', v_cohort.name),
        'projects.cohort_memberships', v_membership,
        pg_catalog.jsonb_build_object('escrow_id', v_escrow, 'seats', v_hold.seats,
            'amount_minor', p_amount, 'currency', pg_catalog.upper(p_currency)),
        p_buyer, 'project', v_project.id, NULL, '/projects/' || v_project.slug
    );
    RETURN v_membership;
END;
$$;
-- #endregion

-- #region Finance: one seat escrow released or refunded
-- The per-escrow twins of `fn_release_ticket_escrow` / `fn_refund_ticket_escrow`, for an escrow held
-- against a seat (`cohort_membership_id`): the same fee, the same team split, the same wallet rule
-- (an individual is credited to the person wallet they actually hold, created if missing). Each moves
-- a row only while it is `held`, so a replay is a no-op returning 0.
CREATE OR REPLACE FUNCTION finance.fn_release_seat_escrow(p_escrow_id uuid, p_reason text DEFAULT 'escrow_release')
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, finance, projects, security, org
AS $$
DECLARE
    r finance.escrows;
    v_fee bigint;
    v_payout bigint;
    v_wallet text;
BEGIN
    SELECT * INTO r FROM finance.escrows WHERE id = p_escrow_id AND status = 'held' FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    v_fee := (r.amount_cents * finance.fn_escrow_fee_bp(r.payer_business_id, r.payer_user_id)) / 10000;
    v_payout := GREATEST(r.amount_cents - v_fee, 0);
    UPDATE finance.escrows SET status = 'released', platform_fee_cents = v_fee, released_at = now() WHERE id = r.id;
    IF r.payee_type = 'team'::assignment_type THEN
        PERFORM finance.fn_split_team_payout(r.id, r.payee_id, v_payout, r.currency, p_reason);
    ELSE
        v_wallet := finance.fn_person_wallet_type(r.payee_id);
        PERFORM finance.fn_ensure_wallet(v_wallet, r.payee_id, r.currency);
        PERFORM finance.fn_wallet_credit_pending(r.payee_id, v_wallet, r.currency, v_payout, p_reason, 'escrows', r.id);
    END IF;
    RETURN v_payout;
END;
$$;

CREATE OR REPLACE FUNCTION finance.fn_refund_seat_escrow(p_escrow_id uuid)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, finance, projects, org, auth
AS $$
DECLARE
    r finance.escrows;
    v_wallet text;
BEGIN
    SELECT * INTO r FROM finance.escrows WHERE id = p_escrow_id AND status = 'held' FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    UPDATE finance.escrows SET status = 'refunded' WHERE id = r.id;
    v_wallet := finance.fn_escrow_payer_wallet_type(r.payer_business_id, r.payer_user_id);
    PERFORM finance.fn_ensure_wallet(v_wallet, COALESCE(r.payer_business_id, r.payer_user_id), r.currency);
    PERFORM finance.fn_wallet_credit(COALESCE(r.payer_business_id, r.payer_user_id), v_wallet, r.currency,
        r.amount_cents, 'escrow_refund', 'escrows', r.id);
    RETURN r.amount_cents;
END;
$$;
-- #endregion

-- #region 5. Cancel a seat — the late-cancel rule
-- PRODUCT_SPEC §Session-Based C ("The 24-Hour Rule"), applied to the cohort's FIRST sitting:
--   * the provider cancels (any time)          → full refund to the attendee;
--   * the attendee cancels > notice before it   → full refund;
--   * the attendee cancels inside the notice, or after the cohort has started → full FORFEIT: the
--     escrow is released to the provider (Time Protection). There is no 50% split (Decision #171
--     retires the stale figure in flows/Projects.md §6.2 and finance-model.md §4).
-- The notice is `session_cancel_notice_hours` (24). A seat whose cohort has no sitting yet refunds.
CREATE OR REPLACE FUNCTION projects.cancel_cohort_membership(p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_m projects.cohort_memberships;
    v_cohort projects.cohorts;
    v_project projects.projects;
    v_by_host boolean;
    v_first timestamptz;
    v_outcome text;
    v_moved bigint := 0;
    v_currency text;
    e record;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to cancel a seat' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_m FROM projects.cohort_memberships WHERE id = p_membership_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That seat no longer exists' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_cohort FROM projects.cohorts WHERE id = v_m.cohort_id;
    SELECT * INTO v_project FROM projects.projects WHERE id = v_cohort.project_id;
    v_by_host := projects.fn_is_session_host(v_project.id, v_uid);
    IF NOT v_by_host AND v_m.user_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'Only the attendee or the provider can cancel this seat' USING ERRCODE = '42501';
    END IF;
    IF v_m.status <> 'active' THEN
        RAISE EXCEPTION 'This seat is not active' USING ERRCODE = 'PS409';
    END IF;

    SELECT min(se.start_time) INTO v_first
      FROM projects.session_events se
     WHERE se.cohort_id = v_cohort.id AND se.status IN ('scheduled', 'completed');

    v_outcome := CASE
        WHEN v_by_host THEN 'refunded'
        WHEN v_first IS NULL THEN 'refunded'
        WHEN v_first - pg_catalog.now() > pg_catalog.make_interval(
            hours => projects.fn_session_param('session_cancel_notice_hours', 24)) THEN 'refunded'
        ELSE 'forfeited'
    END;

    FOR e IN SELECT id, currency FROM finance.escrows WHERE cohort_membership_id = v_m.id AND status = 'held' LOOP
        v_currency := e.currency;
        IF v_outcome = 'refunded' THEN
            v_moved := v_moved + finance.fn_refund_seat_escrow(e.id);
        ELSE
            v_moved := v_moved + finance.fn_release_seat_escrow(e.id, 'escrow_release');
        END IF;
    END LOOP;

    UPDATE projects.cohort_memberships
       SET status = 'cancelled', cancelled_at = pg_catalog.now()
     WHERE id = v_m.id;

    PERFORM comms.fn_notify(
        CASE WHEN v_by_host THEN v_m.user_id ELSE v_project.owner_user_id END,
        'session.cancelled',
        CASE WHEN v_by_host THEN 'Your seat was cancelled' ELSE 'A seat was cancelled' END,
        CASE
            WHEN v_outcome = 'refunded' THEN pg_catalog.format('The seat on "%s" was cancelled and refunded in full.', v_cohort.name)
            ELSE pg_catalog.format('The seat on "%s" was cancelled inside the notice window, so its payment goes to the provider.', v_cohort.name)
        END,
        'projects.cohort_memberships', v_m.id,
        pg_catalog.jsonb_build_object('outcome', v_outcome, 'amount_minor', v_moved, 'currency', v_currency),
        v_uid, 'project', v_project.id, NULL, '/projects/' || v_project.slug
    );

    RETURN pg_catalog.jsonb_build_object(
        'membership_id', v_m.id, 'outcome', v_outcome, 'amount_minor', v_moved, 'currency', v_currency
    );
END;
$$;
-- #endregion

-- #region 6. Presence — the webhook's door
-- Record one participant joining or leaving a sitting, as the conferencing provider reported it. Only
-- the presence route calls it, as `service_role`, after verifying the provider's signature
-- (00002510 grants nobody else) — attendance is the evidence a no-show dispute is audited against.
--
-- The provider's own vocabulary stops at the adapter: this takes a normalised event (provider slug,
-- the provider's meeting id, the participant's email, joined | left, the instant, the provider's
-- event id). It never refuses with an error — a webhook that 500s is redelivered forever — and instead
-- answers an outcome: recorded · replayed · unmatched (no such room, no such account, not a party) ·
-- outside_window.
CREATE OR REPLACE FUNCTION projects.record_presence(
    p_provider text,
    p_meeting_id text,
    p_email text,
    p_action text,
    p_at timestamptz,
    p_provider_event_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event projects.session_events;
    v_project_id uuid;
    v_user uuid;
    v_row projects.session_attendance;
BEGIN
    IF p_action NOT IN ('joined', 'left') OR p_at IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'unmatched', 'detail', 'unknown presence action');
    END IF;
    SELECT * INTO v_event FROM projects.session_events
     WHERE meeting_provider = p_provider AND provider_meeting_id = p_meeting_id;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'unmatched', 'detail', 'no sitting uses this room');
    END IF;
    SELECT c.project_id INTO v_project_id FROM projects.cohorts c WHERE c.id = v_event.cohort_id;

    SELECT u.id INTO v_user FROM auth.users u
     WHERE pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')))
     LIMIT 1;
    IF v_user IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'unmatched', 'detail', 'participant is not a Projective account',
            'event_id', v_event.id);
    END IF;
    IF NOT projects.fn_is_session_host(v_project_id, v_user) AND NOT EXISTS (
        SELECT 1 FROM projects.cohort_memberships cm
        WHERE cm.cohort_id = v_event.cohort_id AND cm.user_id = v_user AND cm.status <> 'cancelled'
    ) THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'unmatched', 'detail', 'participant holds no seat on this sitting',
            'event_id', v_event.id);
    END IF;
    -- A room is often opened early and closed late; anything an hour either side is not this sitting.
    IF p_at < v_event.start_time - interval '60 minutes' OR p_at > v_event.end_time + interval '60 minutes' THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'outside_window', 'event_id', v_event.id);
    END IF;

    SELECT * INTO v_row FROM projects.session_attendance
     WHERE session_event_id = v_event.id AND user_id = v_user FOR UPDATE;
    IF FOUND AND v_row.provider_event_id IS NOT DISTINCT FROM p_provider_event_id THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'replayed', 'event_id', v_event.id);
    END IF;

    IF NOT FOUND THEN
        -- A leave that arrives before its join still proves presence at that instant; the join, when
        -- it lands, moves `joined_at` back to the real first instant.
        INSERT INTO projects.session_attendance (session_event_id, user_id, joined_at, left_at, source, provider_event_id)
        VALUES (v_event.id, v_user, p_at, CASE WHEN p_action = 'left' THEN p_at END, 'webhook', p_provider_event_id);
    ELSIF p_action = 'joined' THEN
        UPDATE projects.session_attendance
           SET joined_at = LEAST(joined_at, p_at),
               -- Back in the room after leaving: they are present again.
               left_at = CASE WHEN left_at IS NOT NULL AND p_at > left_at THEN NULL ELSE left_at END,
               source = 'webhook',
               provider_event_id = p_provider_event_id
         WHERE id = v_row.id;
    ELSE
        UPDATE projects.session_attendance
           SET joined_at = LEAST(joined_at, p_at),
               left_at = GREATEST(COALESCE(left_at, p_at), p_at),
               source = 'webhook',
               provider_event_id = p_provider_event_id
         WHERE id = v_row.id;
    END IF;

    RETURN pg_catalog.jsonb_build_object('outcome', 'recorded', 'event_id', v_event.id, 'user_id', v_user);
END;
$$;
-- #endregion

-- #region 7. The 15-minute rule
-- PRODUCT_SPEC §Session-Based B: a sitting is Successful only if BOTH the provider and the attendee(s)
-- were in the room within its first `session_presence_minutes` (15). The outcome:
--   pending          the window has not closed yet
--   untracked        the room reports no presence (no provider room, or no webhook row at all — a
--                    silent webhook is not evidence that nobody came)
--   successful       the host and at least one seated attendee joined in the window
--   provider_no_show seated attendees joined, the host did not
--   attendee_no_show the host joined, no seated attendee did
CREATE OR REPLACE FUNCTION projects.fn_session_presence(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event projects.session_events;
    v_project uuid;
    v_window_end timestamptz;
    v_tracked boolean;
    v_host boolean;
    v_present integer;
    v_seated integer;
BEGIN
    SELECT * INTO v_event FROM projects.session_events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT c.project_id INTO v_project FROM projects.cohorts c WHERE c.id = v_event.cohort_id;
    v_window_end := v_event.start_time + pg_catalog.make_interval(
        mins => projects.fn_session_param('session_presence_minutes', 15));

    v_tracked := v_event.provider_meeting_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM projects.session_attendance a WHERE a.session_event_id = v_event.id AND a.source = 'webhook'
    );
    SELECT EXISTS (
        SELECT 1 FROM projects.session_attendance a
        WHERE a.session_event_id = v_event.id AND a.joined_at <= v_window_end
          AND projects.fn_is_session_host(v_project, a.user_id)
    ) INTO v_host;
    SELECT count(*) INTO v_seated FROM projects.cohort_memberships cm
     WHERE cm.cohort_id = v_event.cohort_id AND cm.status <> 'cancelled';
    SELECT count(*) INTO v_present
      FROM projects.cohort_memberships cm
      JOIN projects.session_attendance a ON a.session_event_id = v_event.id AND a.user_id = cm.user_id
     WHERE cm.cohort_id = v_event.cohort_id AND cm.status <> 'cancelled' AND a.joined_at <= v_window_end;

    RETURN pg_catalog.jsonb_build_object(
        'event_id', v_event.id,
        'window_ends_at', v_window_end,
        'tracked', v_tracked,
        'host_present', v_host,
        'attendees_present', v_present,
        'attendees_seated', v_seated,
        'outcome', CASE
            WHEN pg_catalog.now() < v_window_end THEN 'pending'
            WHEN NOT v_tracked THEN 'untracked'
            WHEN v_host AND v_present > 0 THEN 'successful'
            WHEN NOT v_host AND v_present > 0 THEN 'provider_no_show'
            WHEN v_host THEN 'attendee_no_show'
            ELSE 'untracked'
        END
    );
END;
$$;
-- #endregion

-- #region 8. Host attestation
-- The host vouches that a seated attendee was there — a room that reports nothing (a custom link, an
-- in-person sitting) still deserves a record. It never overwrites webhook evidence, never records the
-- host themselves (the one presence that decides a provider no-show), and only once the sitting began.
CREATE OR REPLACE FUNCTION projects.record_host_attendance(p_event_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_event projects.session_events;
    v_project uuid;
BEGIN
    SELECT * INTO v_event FROM projects.session_events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That sitting no longer exists' USING ERRCODE = 'P0002';
    END IF;
    SELECT c.project_id INTO v_project FROM projects.cohorts c WHERE c.id = v_event.cohort_id;
    IF v_uid IS NULL OR NOT projects.fn_is_session_host(v_project, v_uid) THEN
        RAISE EXCEPTION 'Only the provider can record attendance' USING ERRCODE = '42501';
    END IF;
    IF projects.fn_is_session_host(v_project, p_user_id) THEN
        RAISE EXCEPTION 'The provider''s own presence comes from the room, not from attestation'
            USING ERRCODE = 'PU422';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM projects.cohort_memberships cm
        WHERE cm.cohort_id = v_event.cohort_id AND cm.user_id = p_user_id AND cm.status <> 'cancelled'
    ) THEN
        RAISE EXCEPTION 'That person holds no seat on this sitting' USING ERRCODE = 'PU422';
    END IF;
    IF pg_catalog.now() < v_event.start_time THEN
        RAISE EXCEPTION 'Attendance can be recorded once the sitting has started' USING ERRCODE = 'PS409';
    END IF;

    INSERT INTO projects.session_attendance (session_event_id, user_id, joined_at, source)
    VALUES (v_event.id, p_user_id, v_event.start_time, 'host')
    ON CONFLICT (session_event_id, user_id) DO NOTHING;
    RETURN pg_catalog.jsonb_build_object('event_id', v_event.id, 'user_id', p_user_id);
END;
$$;
-- #endregion

-- #region 9. No-show claim
-- An attendee says the provider did not show. The claim is a `finance.disputes` row against their seat's
-- held escrow — which is exactly what `auto_release_session_escrow` checks before paying out — and
-- the DisputeService audits it against the presence rows above. Only once the sitting has started, and
-- only while the escrow is still held (afterwards there is nothing left to stop). Idempotent: an open
-- claim on the escrow is returned rather than duplicated.
CREATE OR REPLACE FUNCTION projects.claim_session_no_show(p_event_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_event projects.session_events;
    v_project projects.projects;
    v_escrow uuid;
    v_dispute uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to raise a claim' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_event FROM projects.session_events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That sitting no longer exists' USING ERRCODE = 'P0002';
    END IF;
    IF pg_catalog.now() < v_event.start_time THEN
        RAISE EXCEPTION 'A no-show can be claimed once the sitting has started' USING ERRCODE = 'PS409';
    END IF;
    SELECT p.* INTO v_project FROM projects.cohorts c JOIN projects.projects p ON p.id = c.project_id
     WHERE c.id = v_event.cohort_id;

    SELECT e.id INTO v_escrow
      FROM projects.cohort_memberships cm
      JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status = 'held'
     WHERE cm.cohort_id = v_event.cohort_id AND cm.user_id = v_uid AND cm.status = 'active'
     LIMIT 1;
    IF v_escrow IS NULL THEN
        RAISE EXCEPTION 'You have no held payment on this sitting to claim against' USING ERRCODE = 'PS409';
    END IF;

    SELECT d.id INTO v_dispute FROM finance.disputes d
     WHERE d.escrow_id = v_escrow AND d.status IN ('open', 'under_review') LIMIT 1;
    IF v_dispute IS NULL THEN
        INSERT INTO finance.disputes (escrow_id, opened_by_profile, reason)
        VALUES (v_escrow, v_uid, 'no_show: ' || pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(p_reason), ''),
            'The provider did not join the session.'), 480))
        RETURNING id INTO v_dispute;
        PERFORM comms.fn_notify(
            v_project.owner_user_id, 'escrow.disputed', 'No-show claimed',
            pg_catalog.format('An attendee says you did not join "%s". The payment is held while it is reviewed.', v_event.title),
            'finance.disputes', v_dispute, '{}'::jsonb, v_uid, 'project', v_project.id, NULL,
            '/projects/' || v_project.slug
        );
    END IF;
    RETURN pg_catalog.jsonb_build_object('dispute_id', v_dispute, 'escrow_id', v_escrow);
END;
$$;
-- #endregion

-- #region 10. Join link
-- The caller's way into a sitting. The two URL columns are not client-readable (00002520); this is
-- their only reader, and it hands out a URL only when the caller may use it NOW:
--   host      the provider — host_join_url (attendee_join_url when none was minted)
--   attendee  an active seat whose escrow is held (funded) — attendee_join_url
-- and only inside the join window: `session_join_lead_minutes` (10) before the start until the end.
-- `state` says why there is no URL: not_party · unfunded · upcoming · open · ended · cancelled.
CREATE OR REPLACE FUNCTION projects.session_join_link(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_event projects.session_events;
    v_project uuid;
    v_role text;
    v_opens timestamptz;
    v_state text;
BEGIN
    SELECT * INTO v_event FROM projects.session_events WHERE id = p_event_id;
    IF NOT FOUND OR v_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('state', 'not_party');
    END IF;
    SELECT c.project_id INTO v_project FROM projects.cohorts c WHERE c.id = v_event.cohort_id;
    IF projects.fn_is_session_host(v_project, v_uid) THEN
        v_role := 'host';
    ELSIF EXISTS (
        SELECT 1 FROM projects.cohort_memberships cm
        WHERE cm.cohort_id = v_event.cohort_id AND cm.user_id = v_uid AND cm.status = 'active'
    ) THEN
        v_role := 'attendee';
    ELSE
        RETURN pg_catalog.jsonb_build_object('state', 'not_party');
    END IF;

    v_opens := v_event.start_time - pg_catalog.make_interval(
        mins => projects.fn_session_param('session_join_lead_minutes', 10));
    v_state := CASE
        WHEN v_event.status IN ('cancelled_by_freelancer', 'cancelled_by_client') THEN 'cancelled'
        WHEN v_role = 'attendee' AND NOT EXISTS (
            SELECT 1 FROM projects.cohort_memberships cm
            JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status IN ('held', 'released')
            WHERE cm.cohort_id = v_event.cohort_id AND cm.user_id = v_uid AND cm.status = 'active'
        ) THEN 'unfunded'
        WHEN pg_catalog.now() < v_opens THEN 'upcoming'
        WHEN pg_catalog.now() >= v_event.end_time OR v_event.status = 'completed' THEN 'ended'
        ELSE 'open'
    END;

    RETURN pg_catalog.jsonb_build_object(
        'event_id', v_event.id,
        'role', v_role,
        'state', v_state,
        'opens_at', v_opens,
        'closes_at', v_event.end_time,
        'url', CASE WHEN v_state = 'open' THEN
            CASE WHEN v_role = 'host' THEN COALESCE(v_event.host_join_url, v_event.attendee_join_url)
                 ELSE v_event.attendee_join_url END
        END
    );
END;
$$;
-- #endregion

-- #region 11. Curriculum progress
-- Tick (or un-tick) a lesson for the caller. Only a seated attendee of a cohort that follows the
-- lesson — through the cohort's own plan or its stage's standing one — has progress to keep. Un-ticking
-- clears `completed_at` rather than deleting the row (root CLAUDE.md §5: nothing is hard-deleted).
CREATE OR REPLACE FUNCTION projects.complete_lesson(p_lesson_id uuid, p_done boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to track progress' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM projects.curriculum_lessons l
          JOIN projects.curriculum_modules m ON m.id = l.module_id
          JOIN projects.cohorts c ON c.id = m.cohort_id OR c.project_stage_id = m.project_stage_id
          JOIN projects.cohort_memberships cm ON cm.cohort_id = c.id
         WHERE l.id = p_lesson_id AND cm.user_id = v_uid AND cm.status <> 'cancelled'
    ) THEN
        RAISE EXCEPTION 'Only a seated attendee can track this lesson' USING ERRCODE = '42501';
    END IF;

    INSERT INTO projects.lesson_progress (lesson_id, user_id, completed_at)
    VALUES (p_lesson_id, v_uid, CASE WHEN p_done THEN pg_catalog.now() END)
    ON CONFLICT (lesson_id, user_id) DO UPDATE
       SET completed_at = CASE WHEN p_done THEN COALESCE(projects.lesson_progress.completed_at, pg_catalog.now()) END,
           updated_at = pg_catalog.now();
    RETURN pg_catalog.jsonb_build_object('lesson_id', p_lesson_id, 'done', p_done);
END;
$$;
-- #endregion

-- #region 13. The workspace read
-- Everything a session engagement's sidebar renders, for the CALLER, in one definer read: their role,
-- every cohort with its real occupancy (an attendee cannot read other attendees' seats through RLS,
-- but the count is theirs to see), the sittings of their cohort (all cohorts for the host), their own
-- seat with its escrow and any open no-show claim, their live hold, the curriculum with their
-- progress, the join link for the next sitting (through session_join_link, so the URL rules live in
-- one place), any open reschedule round on it, and the platform's session terms. NULL for a caller
-- with no access to the engagement — the same answer has_project_access gives.
CREATE OR REPLACE FUNCTION projects.get_session_workspace(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_project projects.projects;
    v_host boolean;
    v_role text;
    v_member record;
    v_scope uuid[];
    v_next uuid;
    v_price bigint;
    v_currency text;
BEGIN
    SELECT * INTO v_project FROM projects.projects WHERE id = p_project_id;
    IF NOT FOUND OR v_project.format <> 'session' OR v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    v_host := projects.fn_is_session_host(v_project.id, v_uid);
    IF NOT v_host AND NOT projects.has_project_access(v_project.id) THEN
        RETURN NULL;
    END IF;

    SELECT cm.*, (SELECT pg_catalog.jsonb_build_object('status', e.status, 'amount_minor', e.amount_cents,
                         'currency', e.currency,
                         'claim_open', EXISTS (SELECT 1 FROM finance.disputes d WHERE d.escrow_id = e.id
                                               AND d.status IN ('open', 'under_review')))
                    FROM finance.escrows e WHERE e.cohort_membership_id = cm.id
                   ORDER BY e.created_at DESC LIMIT 1) AS escrow
      INTO v_member
      FROM projects.cohort_memberships cm
      JOIN projects.cohorts c ON c.id = cm.cohort_id
     WHERE c.project_id = v_project.id AND cm.user_id = v_uid
     ORDER BY (cm.status = 'active') DESC, cm.joined_at DESC
     LIMIT 1;

    v_role := CASE WHEN v_host THEN 'host' WHEN v_member.id IS NOT NULL THEN 'attendee' ELSE 'prospect' END;
    v_scope := CASE
        WHEN v_role = 'attendee' THEN ARRAY[v_member.cohort_id]
        ELSE ARRAY(SELECT c.id FROM projects.cohorts c WHERE c.project_id = v_project.id)
    END;

    SELECT se.id INTO v_next
      FROM projects.session_events se
     WHERE se.cohort_id = ANY (v_scope)
       AND se.status = 'scheduled'
       AND se.end_time > pg_catalog.now()
     ORDER BY se.start_time
     LIMIT 1;

    SELECT COALESCE(sb.session_price_cents, sb.price_cents), sb.currency INTO v_price, v_currency
      FROM marketplace.service_blueprints sb WHERE sb.id = v_project.source_blueprint_id;

    RETURN pg_catalog.jsonb_build_object(
        'project_id', v_project.id,
        'slug', v_project.slug,
        'session_kind', v_project.session_kind,
        'role', v_role,
        'seat_price_minor', v_price,
        'currency', COALESCE(v_currency, v_project.currency),
        'terms', pg_catalog.jsonb_build_object(
            'seat_hold_minutes', projects.fn_session_param('seat_hold_minutes', 15),
            'join_lead_minutes', projects.fn_session_param('session_join_lead_minutes', 10),
            'presence_minutes', projects.fn_session_param('session_presence_minutes', 15),
            'cancel_notice_hours', projects.fn_session_param('session_cancel_notice_hours', 24),
            'payout_hours', projects.fn_session_param('session_payout_hours', 24)
        ),
        'cohorts', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', c.id, 'name', c.name, 'status', c.status, 'max_seats', c.max_seats,
                'taken', LEAST(projects.fn_cohort_seats_taken(c.id), c.max_seats),
                'joined', EXISTS (SELECT 1 FROM projects.cohort_memberships cm
                                   WHERE cm.cohort_id = c.id AND cm.user_id = v_uid AND cm.status <> 'cancelled'),
                'next_start', (SELECT min(se.start_time) FROM projects.session_events se
                                WHERE se.cohort_id = c.id AND se.status = 'scheduled' AND se.end_time > pg_catalog.now()),
                'next_end', (SELECT se.end_time FROM projects.session_events se
                              WHERE se.cohort_id = c.id AND se.status = 'scheduled' AND se.end_time > pg_catalog.now()
                              ORDER BY se.start_time LIMIT 1)
            ) ORDER BY c.created_at)
              FROM projects.cohorts c WHERE c.project_id = v_project.id
        ), '[]'::jsonb),
        'sittings', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', se.id, 'cohort_id', se.cohort_id, 'title', se.title,
                'starts_at', se.start_time, 'ends_at', se.end_time, 'status', se.status
            ) ORDER BY se.start_time)
              FROM projects.session_events se WHERE se.cohort_id = ANY (v_scope)
        ), '[]'::jsonb),
        'membership', CASE WHEN v_member.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
            'id', v_member.id, 'cohort_id', v_member.cohort_id, 'status', v_member.status,
            'seats', v_member.seats, 'escrow', v_member.escrow,
            'first_start', (SELECT min(se.start_time) FROM projects.session_events se
                             WHERE se.cohort_id = v_member.cohort_id AND se.status IN ('scheduled', 'completed'))
        ) END,
        'hold', (
            SELECT pg_catalog.jsonb_build_object('id', h.id, 'seats', h.seats, 'expires_at', h.expires_at)
              FROM projects.cohort_seat_holds h
              JOIN projects.cohorts c ON c.id = h.cohort_id
             WHERE c.project_id = v_project.id AND h.user_id = v_uid AND h.status = 'held'
               AND h.expires_at > pg_catalog.now()
             LIMIT 1
        ),
        'host_escrows', CASE WHEN v_host THEN (
            SELECT pg_catalog.jsonb_build_object(
                'held_minor', COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = 'held'), 0),
                'held_count', count(*) FILTER (WHERE e.status = 'held'),
                'released_minor', COALESCE(sum(e.amount_cents - e.platform_fee_cents) FILTER (WHERE e.status = 'released'), 0),
                'currency', min(e.currency)
            )
              FROM finance.escrows e
              JOIN projects.cohort_memberships cm ON cm.id = e.cohort_membership_id
              JOIN projects.cohorts c ON c.id = cm.cohort_id
             WHERE c.project_id = v_project.id
        ) END,
        'curriculum', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', m.id, 'title', m.title, 'summary', m.summary, 'starts_at', se.start_time,
                'lessons', COALESCE((
                    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'id', l.id, 'title', l.title, 'duration_minutes', l.duration_minutes,
                        'done', CASE WHEN v_role = 'attendee' THEN EXISTS (
                            SELECT 1 FROM projects.lesson_progress lp
                            WHERE lp.lesson_id = l.id AND lp.user_id = v_uid AND lp.completed_at IS NOT NULL
                        ) END
                    ) ORDER BY l.position, l.created_at)
                      FROM projects.curriculum_lessons l WHERE l.module_id = m.id
                ), '[]'::jsonb)
            ) ORDER BY (m.cohort_id IS NOT NULL), se.start_time NULLS LAST, m.position, m.created_at)
              FROM projects.curriculum_modules m
              LEFT JOIN projects.session_events se ON se.id = m.session_event_id
             WHERE m.cohort_id = ANY (v_scope)
                OR m.project_stage_id IN (SELECT c.project_stage_id FROM projects.cohorts c WHERE c.id = ANY (v_scope))
        ), '[]'::jsonb),
        'join', CASE WHEN v_next IS NOT NULL AND v_role <> 'prospect' THEN projects.session_join_link(v_next) END,
        'reschedule', (
            SELECT pg_catalog.jsonb_build_object(
                'sitting_title', se.title, 'mode', r.mode, 'status', r.status,
                'opened_by_host', projects.fn_is_session_host(v_project.id, r.opened_by_user_id),
                'votes', (SELECT count(*) FROM scheduling.proposal_votes pv WHERE pv.reschedule_id = r.id),
                'voters', (SELECT count(*) FROM scheduling.event_attendees ea
                            WHERE ea.event_id = ev.id AND ea.role <> 'optional')
            )
              FROM scheduling.events ev
              JOIN projects.session_events se ON se.id = ev.source_session_event_id
              JOIN scheduling.event_reschedules r ON r.event_id = ev.id
             WHERE se.id = v_next AND r.status IN ('collecting', 'awaiting_counterparty', 'voting')
             ORDER BY r.round DESC
             LIMIT 1
        )
    );
END;
$$;
-- #endregion

-- #region 12. Auto-release — negative consent
-- The scheduled sweep (every 15 minutes, below). In one pass:
--   (a) sittings whose end has passed are marked `completed`;
--   (b) a PROVIDER NO-SHOW on a sitting (fn_session_presence) refunds every held seat escrow on its
--       cohort at once and cancels those seats (PRODUCT_SPEC §Session-Based B, "flagged for an
--       immediate refund") — judged only on a tracked room, so a silent webhook never refunds anyone;
--   (c) a seat escrow whose cohort's LAST sitting ended `session_payout_hours` (24) ago, with no open
--       no-show claim (finance.disputes open | under_review), is released to the provider and the seat
--       becomes `completed`.
-- A cohort whose sittings have all ended becomes `completed`. Idempotent: every money move is guarded
-- on the escrow still being `held`. Returns the counts it moved.
CREATE OR REPLACE FUNCTION finance.auto_release_session_escrow(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_hours integer := projects.fn_session_param('session_payout_hours', 24);
    v_completed integer := 0;
    v_refunded integer := 0;
    v_released integer := 0;
    r record;
BEGIN
    UPDATE projects.session_events SET status = 'completed', updated_at = p_now
     WHERE status = 'scheduled' AND end_time <= p_now;
    GET DIAGNOSTICS v_completed = ROW_COUNT;

    FOR r IN
        SELECT DISTINCT e.id AS escrow_id, cm.id AS membership_id, cm.user_id, se.title, p.id AS project_id,
               p.slug, p.owner_user_id
          FROM projects.session_events se
          JOIN projects.cohorts c ON c.id = se.cohort_id
          JOIN projects.projects p ON p.id = c.project_id
          JOIN projects.cohort_memberships cm ON cm.cohort_id = c.id AND cm.status = 'active'
          JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status = 'held'
         WHERE se.status = 'completed'
           AND se.provider_meeting_id IS NOT NULL
           AND se.end_time > p_now - pg_catalog.make_interval(hours => v_hours)
           AND (projects.fn_session_presence(se.id) ->> 'outcome') = 'provider_no_show'
    LOOP
        IF finance.fn_refund_seat_escrow(r.escrow_id) > 0 THEN
            v_refunded := v_refunded + 1;
            UPDATE projects.cohort_memberships SET status = 'cancelled', cancelled_at = p_now
             WHERE id = r.membership_id AND status = 'active';
            PERFORM comms.fn_notify(r.user_id, 'escrow.refunded', 'Session refunded',
                pg_catalog.format('The provider did not join "%s", so your payment was refunded in full.', r.title),
                'finance.escrows', r.escrow_id, '{}'::jsonb, NULL, 'project', r.project_id, NULL, '/projects/' || r.slug);
            PERFORM comms.fn_notify(r.owner_user_id, 'escrow.refunded', 'Seat refunded — no-show',
                pg_catalog.format('You were not in the room for "%s" within its first minutes, so the seat was refunded.', r.title),
                'finance.escrows', r.escrow_id, '{}'::jsonb, NULL, 'project', r.project_id, NULL, '/projects/' || r.slug);
        END IF;
    END LOOP;

    FOR r IN
        SELECT e.id AS escrow_id, cm.id AS membership_id, cm.user_id, c.name, p.id AS project_id, p.slug,
               p.owner_user_id
          FROM finance.escrows e
          JOIN projects.cohort_memberships cm ON cm.id = e.cohort_membership_id AND cm.status = 'active'
          JOIN projects.cohorts c ON c.id = cm.cohort_id
          JOIN projects.projects p ON p.id = c.project_id
         WHERE e.status = 'held'
           AND EXISTS (SELECT 1 FROM projects.session_events se WHERE se.cohort_id = c.id
                        AND se.status IN ('scheduled', 'completed'))
           AND NOT EXISTS (SELECT 1 FROM projects.session_events se WHERE se.cohort_id = c.id
                            AND se.status IN ('scheduled', 'completed')
                            AND se.end_time > p_now - pg_catalog.make_interval(hours => v_hours))
           AND NOT EXISTS (SELECT 1 FROM finance.disputes d WHERE d.escrow_id = e.id
                            AND d.status IN ('open', 'under_review'))
    LOOP
        IF finance.fn_release_seat_escrow(r.escrow_id, 'escrow_release') > 0 THEN
            v_released := v_released + 1;
            UPDATE projects.cohort_memberships SET status = 'completed' WHERE id = r.membership_id;
            PERFORM comms.fn_notify(r.owner_user_id, 'escrow.released', 'Session payout released',
                pg_catalog.format('The payment for a seat on "%s" was released to your wallet.', r.name),
                'finance.escrows', r.escrow_id, '{}'::jsonb, NULL, 'project', r.project_id, NULL, '/projects/' || r.slug);
        END IF;
    END LOOP;

    UPDATE projects.cohorts c SET status = 'completed'
     WHERE c.status IN ('enrolling', 'active')
       AND EXISTS (SELECT 1 FROM projects.session_events se WHERE se.cohort_id = c.id AND se.status = 'completed')
       AND NOT EXISTS (SELECT 1 FROM projects.session_events se WHERE se.cohort_id = c.id AND se.status = 'scheduled');

    RETURN pg_catalog.jsonb_build_object(
        'completed_sittings', v_completed, 'refunded', v_refunded, 'released', v_released
    );
END;
$$;

COMMENT ON FUNCTION finance.auto_release_session_escrow(timestamptz) IS
'The session negative-consent sweep: completes ended sittings, refunds every held seat on a cohort whose
tracked sitting had a provider no-show (15-minute rule), and releases a seat escrow session_payout_hours
after its cohort''s last sitting ended unless a no-show claim (finance.disputes open|under_review) is open.';

-- Every 15 minutes. Guarded like every other job here (00000002): pg_cron may be absent locally, and a
-- failure must not stop the migration.
DO $$
BEGIN
    PERFORM cron.schedule (
        'auto-release-session-escrow',
        '*/15 * * * *',
        $cron$SELECT finance.auto_release_session_escrow();$cron$
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable — finance.auto_release_session_escrow must be scheduled manually.';
END $$;
-- #endregion
