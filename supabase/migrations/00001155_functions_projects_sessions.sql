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
--  4b. Book a 1-1          fn_book_session_slot  — a one-seat cohort, one escrow PER SITTING, the calendar
--                          mirror and a block's n-1 scheduling handshakes (Decision #211)
--   5. Cancel              cancel_cohort_membership — PRODUCT_SPEC's late-cancel rule (full forfeit <24h),
--                          per sitting on a 1-1
--   6. Presence            record_presence       — the provider webhook's door (service_role only)
--   7. The 15-minute rule  fn_session_presence
--   8. Host attestation    record_host_attendance
--   9. No-show claim       claim_session_no_show — a finance.disputes row that stops auto-release,
--                          audited and resolved by the dispute lifecycle in 00001260 (Decision #212)
--  10. Join link           session_join_link     — the caller's URL, only when funded and in the window
--  11. Curriculum          complete_lesson
--  12. Auto-release        finance.auto_release_session_escrow (scheduled in 00005060) — every session
--                          escrow, per sitting on a 1-1 (Decision #211)
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
    PERFORM org.fn_assert_adult(v_uid);
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

-- #region 4b. Book a 1-1 session — when the order that paid for it settles (Decision #211)
-- A 1-1 session is a cohort of ONE seat (Decision #171), so a 1-1 booking uses the cohort machinery and
-- adds no parallel structure. The ONE difference is the escrow: a 1-1 sitting holds its OWN escrow
-- (`finance.escrows.session_event_id`). Each sitting then releases `session_payout_hours` after its
-- own end, and the 24-hour cancel rule is judged against its own start. A provider is never made to
-- wait for the end of a six-week block to be paid for week one.

-- The seller's session engagement for a 1-1 listing: ONE per listing, made on its first booking, with
-- one "Sessions" stage that every booking's cohort hangs off (an escrow is always held against a
-- stage). Concurrent first bookings are serialised on an advisory lock keyed to the listing, so two
-- buyers paying at once cannot each mint an engagement. `unlisted` and `active`: it is the provider's
-- delivery workspace, never a public project, so it takes no public-project slot.
CREATE OR REPLACE FUNCTION projects.fn_session_engagement_for(
    p_blueprint_id uuid,
    OUT o_project_id uuid,
    OUT o_stage_id uuid
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bp marketplace.service_blueprints;
BEGIN
    SELECT * INTO v_bp FROM marketplace.service_blueprints WHERE id = p_blueprint_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That session is no longer offered' USING ERRCODE = 'P0002';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('session-engagement:' || p_blueprint_id::text, 0));

    SELECT p.id INTO o_project_id
      FROM projects.projects p
     WHERE p.source_blueprint_id = p_blueprint_id
       AND p.format = 'session'::public.project_format
       AND p.session_kind = 'normal'
       AND p.status IN ('draft', 'active')
       AND p.owner_user_id = v_bp.freelancer_profile_id
       AND p.owner_team_id IS NOT DISTINCT FROM v_bp.owner_team_id
     ORDER BY p.created_at
     LIMIT 1;
    IF o_project_id IS NULL THEN
        INSERT INTO projects.projects (
            owner_user_id, owner_team_id, title, description, description_text, format,
            structure_variation, session_kind, status, visibility, publish_visibility, currency,
            budget_type, source_blueprint_id
        ) VALUES (
            v_bp.freelancer_profile_id, v_bp.owner_team_id, v_bp.title, v_bp.description,
            v_bp.description_text, 'session'::public.project_format, 'standard'::projects.structure_variation,
            'normal', 'active'::public.project_status, 'unlisted'::public.visibility,
            'unlisted'::public.visibility, pg_catalog.upper(v_bp.currency), 'fixed_price'::public.budget_type,
            v_bp.id
        )
        RETURNING id INTO o_project_id;
    END IF;

    SELECT ps.id INTO o_stage_id
      FROM projects.project_stages ps
     WHERE ps.project_id = o_project_id
     ORDER BY ps.sort_order, ps.created_at
     LIMIT 1;
    IF o_stage_id IS NULL THEN
        INSERT INTO projects.project_stages (project_id, name, sort_order, unit_price_cents)
        VALUES (o_project_id, 'Sessions', 0, COALESCE(v_bp.session_price_cents, v_bp.price_cents))
        RETURNING id INTO o_stage_id;
    END IF;
END;
$$;

-- The provider's calendar: the team's schedule for a team-owned engagement, else the owner's own
-- (their freelancer schedule first). NULL when they publish none — a 1-1 is still bookable then (the
-- booking grid fell back to its defaults), the sittings simply sit on the project rather than a schedule.
CREATE OR REPLACE FUNCTION projects.fn_session_host_schedule(p_project_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT s.id
      FROM projects.projects p
      JOIN scheduling.schedules s
        ON (p.owner_team_id IS NOT NULL AND s.owner_type = 'team'::scheduling.owner_type AND s.owner_id = p.owner_team_id)
        OR (p.owner_team_id IS NULL AND s.owner_type IN ('freelancer'::scheduling.owner_type, 'user'::scheduling.owner_type)
            AND s.owner_id = p.owner_user_id)
     WHERE p.id = p_project_id
     ORDER BY (s.owner_type = 'freelancer'::scheduling.owner_type) DESC
     LIMIT 1;
$$;

-- After a move on ONE sitting's escrow: a 1-1 seat with nothing left held is over — `completed` when
-- any of its sittings paid the provider, `cancelled` when none did. A seat with escrow still held, or
-- one already ended, is left as it is.
CREATE OR REPLACE FUNCTION projects.fn_settle_membership_state(p_membership_id uuid, p_now timestamptz DEFAULT now())
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE projects.cohort_memberships cm
       SET status = CASE WHEN x.paid THEN 'completed' ELSE 'cancelled' END,
           cancelled_at = CASE WHEN x.paid THEN NULL ELSE p_now END
      FROM (SELECT EXISTS (SELECT 1 FROM finance.escrows e
                            WHERE e.cohort_membership_id = p_membership_id AND e.status = 'released') AS paid) x
     WHERE cm.id = p_membership_id
       AND cm.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM finance.escrows e
                        WHERE e.cohort_membership_id = p_membership_id AND e.status = 'held');
$$;

-- Internal: `finance.place_wallet_order` calls it for a `service_session` (p_sittings = 1) or a
-- `set_session` line (p_sittings = the listing's session_count), inside its own transaction, after
-- writing the order line. In one step it:
--   * finds or makes the listing's engagement and seats the buyer on a fresh one-seat cohort;
--   * writes the sittings — the first at the time the buyer picked, each later one PROVISIONALLY a week
--     after the one before (PRODUCT_SPEC §Session-Based A: the buyer commits to a block, not to six
--     specific Tuesdays) — and holds one escrow per sitting from the paying wallet;
--   * mirrors every sitting onto the provider's calendar (`scheduling.events.source_session_event_id`,
--     with both people on its roster), so it blocks their free/busy and the Proactive Calendar can
--     move it;
--   * for a block, opens the n-1 scheduling handshakes: a 1-on-1 reschedule round (round 0,
--     `collecting`, the provider to propose) on each provisional sitting, due `set_session_schedule_hours`
--     (72) after payment and never later than `session_cancel_notice_hours` before the provisional
--     time. A round still open at its deadline lapses and the provisional time stands — exactly what
--     `lapsed` already means (projects.fn_lapse_session_handshakes, which also reminds the provider
--     once, 24 hours before the earliest deadline).
-- The buyer must be an adult (Decision #208), and the first sitting must sit inside the provider's
-- working hours — the listing's compiled availability preset when there is one, else the weekly bands
-- (scheduling.fn_band_covers with the blueprint, Decision #217 (d)); the pencilled-in later sittings
-- are agreed through their handshakes instead.
-- The first sitting's time is re-tested against the provider's calendar under a lock on it, so two
-- buyers paying for the same slot at once queue here and the second is refused (and charged nothing —
-- the whole order rolls back) rather than both being seated.
CREATE OR REPLACE FUNCTION projects.fn_book_session_slot(
    p_blueprint_id uuid,
    p_buyer uuid,
    p_payer_type text,
    p_payer_id uuid,
    p_unit_amount bigint,
    p_sittings integer,
    p_currency text,
    p_starts_at timestamptz,
    p_order_line_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bp marketplace.service_blueprints;
    v_eng record;
    v_project projects.projects;
    v_schedule uuid;
    v_minutes integer;
    v_cohort uuid;
    v_membership uuid;
    v_payee_type public.assignment_type;
    v_payee_id uuid;
    v_currency text := pg_catalog.upper(p_currency);
    v_window integer := projects.fn_session_param('set_session_schedule_hours', 72);
    v_notice integer := projects.fn_session_param('session_cancel_notice_hours', 24);
    v_deadline timestamptz;
    v_first_deadline timestamptz;
    v_start timestamptz;
    v_end timestamptz;
    v_event uuid;
    v_mirror uuid;
    v_escrow uuid;
    v_title text;
    v_sittings jsonb := '[]'::jsonb;
    k integer;
BEGIN
    IF p_sittings IS NULL OR p_sittings < 1 OR p_sittings > 52 THEN
        RAISE EXCEPTION 'A booking holds between 1 and 52 sessions' USING ERRCODE = '22023';
    END IF;
    IF p_payer_type NOT IN ('user', 'freelancer', 'business') THEN
        RAISE EXCEPTION 'Book a session from your personal or business account' USING ERRCODE = 'PU422';
    END IF;
    IF p_unit_amount IS NULL OR p_unit_amount <= 0 THEN
        RAISE EXCEPTION 'This session has no price to hold in escrow' USING ERRCODE = 'PF402';
    END IF;
    IF p_starts_at IS NULL OR p_starts_at <= pg_catalog.now() THEN
        RAISE EXCEPTION 'The time you picked has passed — pick a new one; nothing was charged'
            USING ERRCODE = 'PC409';
    END IF;
    PERFORM org.fn_assert_adult(p_buyer);
    SELECT * INTO v_bp FROM marketplace.service_blueprints WHERE id = p_blueprint_id;
    IF NOT FOUND OR NOT v_bp.is_published
       OR v_bp.delivery_model <> 'session'::marketplace.service_delivery_model THEN
        RAISE EXCEPTION 'This session is no longer offered — nothing was charged' USING ERRCODE = 'PC409';
    END IF;
    v_minutes := COALESCE(v_bp.session_minutes, 60);

    SELECT * INTO v_eng FROM projects.fn_session_engagement_for(p_blueprint_id);
    SELECT * INTO v_project FROM projects.projects WHERE id = v_eng.o_project_id;
    IF projects.fn_is_session_host(v_project.id, p_buyer) THEN
        RAISE EXCEPTION 'You can''t book your own session' USING ERRCODE = 'PU422';
    END IF;

    v_schedule := projects.fn_session_host_schedule(v_project.id);
    IF v_schedule IS NOT NULL THEN
        PERFORM 1 FROM scheduling.schedules WHERE id = v_schedule FOR UPDATE;
        IF NOT scheduling.fn_band_covers(v_schedule, 'working_hours'::scheduling.availability_kind,
               p_starts_at, p_starts_at + pg_catalog.make_interval(mins => v_minutes), p_blueprint_id) THEN
            RAISE EXCEPTION 'That time is outside the provider''s hours — pick another; nothing was charged'
                USING ERRCODE = 'PS409';
        END IF;
        IF scheduling.fn_has_conflicting_event(v_schedule, p_starts_at, p_starts_at + pg_catalog.make_interval(mins => v_minutes))
           OR scheduling.fn_is_blacked_out(v_schedule, p_starts_at, p_starts_at + pg_catalog.make_interval(mins => v_minutes)) THEN
            RAISE EXCEPTION 'That time was just taken — pick another; nothing was charged' USING ERRCODE = 'PS409';
        END IF;
    END IF;

    IF v_project.owner_team_id IS NOT NULL THEN
        v_payee_type := 'team'::public.assignment_type;
        v_payee_id := v_project.owner_team_id;
    ELSE
        v_payee_type := 'freelancer'::public.assignment_type;
        v_payee_id := v_project.owner_user_id;
    END IF;

    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_project.id, v_eng.o_stage_id, v_bp.title, 1, 'active'::projects.cohort_status)
    RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id, seats, status, order_line_id)
    VALUES (v_cohort, p_buyer, 1, 'active', p_order_line_id)
    RETURNING id INTO v_membership;

    FOR k IN 0 .. p_sittings - 1 LOOP
        v_start := p_starts_at + pg_catalog.make_interval(days => 7 * k);
        v_end := v_start + pg_catalog.make_interval(mins => v_minutes);
        v_title := CASE WHEN p_sittings = 1 THEN v_bp.title
                        ELSE pg_catalog.format('%s — session %s of %s', v_bp.title, k + 1, p_sittings) END;

        INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
        VALUES (v_cohort, v_title, v_start, v_end)
        RETURNING id INTO v_event;

        INSERT INTO finance.escrows (
            project_stage_id, cohort_membership_id, session_event_id, payer_business_id, payer_user_id,
            payee_type, payee_id, amount_cents, currency, status
        ) VALUES (
            v_eng.o_stage_id, v_membership, v_event,
            CASE WHEN p_payer_type = 'business' THEN p_payer_id END,
            CASE WHEN p_payer_type <> 'business' THEN p_payer_id END,
            v_payee_type, v_payee_id, p_unit_amount, v_currency, 'held'
        )
        RETURNING id INTO v_escrow;
        PERFORM finance.fn_wallet_debit(p_payer_id, p_payer_type, v_currency, p_unit_amount,
            'escrow_hold', 'escrows', v_escrow);

        INSERT INTO scheduling.events (
            schedule_id, project_id, kind, status, title, starts_at, ends_at, attendee_count, capacity,
            source_session_event_id, created_by
        ) VALUES (
            v_schedule, v_project.id, 'session'::scheduling.event_kind,
            CASE WHEN k = 0 THEN 'confirmed'::scheduling.event_status ELSE 'tentative'::scheduling.event_status END,
            v_title, v_start, v_end, 1, 1, v_event, v_project.owner_user_id
        )
        RETURNING id INTO v_mirror;
        INSERT INTO scheduling.event_attendees (event_id, user_id, role, response, responded_at)
        VALUES
            (v_mirror, v_project.owner_user_id, 'host'::scheduling.attendee_role,
                'accepted'::scheduling.rsvp_response, pg_catalog.now()),
            (v_mirror, p_buyer, 'participant'::scheduling.attendee_role,
                CASE WHEN k = 0 THEN 'accepted'::scheduling.rsvp_response ELSE 'pending'::scheduling.rsvp_response END,
                CASE WHEN k = 0 THEN pg_catalog.now() END);

        v_deadline := NULL;
        IF k > 0 THEN
            v_deadline := LEAST(pg_catalog.now() + pg_catalog.make_interval(hours => v_window),
                                v_start - pg_catalog.make_interval(hours => v_notice));
            INSERT INTO scheduling.event_reschedules (event_id, round, mode, status, opened_by_user_id, opened_at, resolves_at)
            VALUES (v_mirror, 0, 'counterparty', 'collecting', v_project.owner_user_id, pg_catalog.now(), v_deadline);
            v_first_deadline := LEAST(COALESCE(v_first_deadline, v_deadline), v_deadline);
        END IF;

        v_sittings := v_sittings || pg_catalog.jsonb_build_object(
            'event_id', v_event, 'calendar_event_id', v_mirror, 'starts_at', v_start, 'ends_at', v_end,
            'escrow_id', v_escrow, 'provisional', k > 0, 'agree_by', v_deadline);
    END LOOP;

    PERFORM comms.fn_notify(
        v_project.owner_user_id, 'session.booked',
        CASE WHEN p_sittings = 1 THEN 'Session booked' ELSE 'Session block booked' END,
        CASE WHEN p_sittings = 1
            THEN pg_catalog.format('"%s" was booked. The payment is held in escrow until after the session.', v_bp.title)
            ELSE pg_catalog.format('A block of %s sessions of "%s" was booked. Each session''s payment is held in escrow until after it.', p_sittings, v_bp.title)
        END,
        'projects.cohort_memberships', v_membership,
        pg_catalog.jsonb_build_object('sittings', p_sittings, 'amount_minor', p_unit_amount * p_sittings,
            'currency', v_currency),
        p_buyer, 'project', v_project.id, NULL, '/projects/' || v_project.slug
    );
    IF p_sittings > 1 THEN
        PERFORM comms.fn_notify(
            v_project.owner_user_id, 'session.scheduling_requested', 'Agree the remaining session times',
            pg_catalog.format('%s more sessions of "%s" are pencilled in weekly. Propose the times that suit you both within %s hours, or the pencilled-in times stand.',
                p_sittings - 1, v_bp.title, v_window),
            'projects.cohorts', v_cohort, pg_catalog.jsonb_build_object('agree_by', v_first_deadline),
            p_buyer, 'project', v_project.id, NULL, '/projects/' || v_project.slug
        );
        PERFORM comms.fn_notify(
            p_buyer, 'session.scheduling_requested', 'Your remaining sessions are pencilled in',
            pg_catalog.format('Your first session of "%s" is booked. The other %s are pencilled in weekly; your provider will propose times to agree with you within %s hours, or the pencilled-in times stand.',
                v_bp.title, p_sittings - 1, v_window),
            'projects.cohorts', v_cohort, pg_catalog.jsonb_build_object('agree_by', v_first_deadline),
            v_project.owner_user_id, 'project', v_project.id, NULL, '/projects/' || v_project.slug
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'membership_id', v_membership, 'cohort_id', v_cohort, 'project_id', v_project.id,
        'stage_id', v_eng.o_stage_id, 'slug', v_project.slug, 'sittings', v_sittings
    );
END;
$$;

COMMENT ON FUNCTION projects.fn_book_session_slot(uuid, uuid, text, uuid, bigint, integer, text, timestamptz, uuid) IS
'Internal (finance.place_wallet_order): seat a 1-1 buyer on a one-seat cohort of the listing''s session
engagement, write the sittings (the first at the picked time, the rest provisionally weekly), hold one
escrow per sitting from the paying wallet, mirror each sitting onto the provider''s calendar, and for a
block open a 1-on-1 reschedule round on each provisional sitting due set_session_schedule_hours after
payment (Decision #211). Refusals roll the whole order back: 22023 · PU422 own session / payer · PF402 ·
PC409 time passed or listing gone · PM403 the buyer is under 18 · PS409 the time was taken or is
outside the provider''s working hours (the listing''s compiled preset, else the weekly bands).';
-- #endregion

-- #region 5. Cancel a seat — the late-cancel rule
-- PRODUCT_SPEC §Session-Based C ("The 24-Hour Rule"), applied to the cohort's FIRST sitting:
--   * the provider cancels (any time)          → full refund to the attendee;
--   * the attendee cancels > notice before it   → full refund;
--   * the attendee cancels inside the notice, or after the cohort has started → full FORFEIT: the
--     escrow is released to the provider (Time Protection). There is no 50% split (Decision #171
--     retires the stale figure in flows/Projects.md §6.2 and finance-model.md §4).
-- The notice is `session_cancel_notice_hours` (24). A seat whose cohort has no sitting yet refunds.
--
-- A 1-1 seat (Decision #211) holds one escrow PER SITTING, and the same rule is applied to each sitting
-- against its OWN start: the provider cancelling refunds every sitting not yet started; the client
-- cancelling refunds each sitting more than the notice away and forfeits each one inside it. A sitting
-- that has already started is not cancellable — it settles on its own payout window, or through its
-- dispute. Every cancelled sitting leaves the provider's calendar, its open scheduling handshake is
-- withdrawn (so it is never reminded or lapsed); the one-seat cohort ends with the seat. A booking whose
-- every sitting has started has nothing left to cancel (PS409).
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
    v_seat_outcome text;
    v_notice interval := pg_catalog.make_interval(hours => projects.fn_session_param('session_cancel_notice_hours', 24));
    v_refund boolean;
    v_moved bigint := 0;
    v_refunded bigint := 0;
    v_forfeited bigint := 0;
    v_refunds integer := 0;
    v_forfeits integer := 0;
    v_per_sitting boolean := false;
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

    -- A cohort seat's one escrow is judged against the cohort's first sitting.
    v_seat_outcome := CASE
        WHEN v_by_host THEN 'refunded'
        WHEN v_first IS NULL THEN 'refunded'
        WHEN v_first - pg_catalog.now() > v_notice THEN 'refunded'
        ELSE 'forfeited'
    END;

    FOR e IN
        SELECT es.id, es.currency, es.session_event_id, se.start_time
          FROM finance.escrows es
          LEFT JOIN projects.session_events se ON se.id = es.session_event_id
         WHERE es.cohort_membership_id = v_m.id AND es.status = 'held'
         ORDER BY se.start_time NULLS FIRST
           FOR UPDATE OF es
    LOOP
        v_currency := e.currency;
        IF e.session_event_id IS NOT NULL THEN
            v_per_sitting := true;
            CONTINUE WHEN e.start_time <= pg_catalog.now();
            v_refund := v_by_host OR e.start_time - pg_catalog.now() > v_notice;
        ELSE
            v_refund := v_seat_outcome = 'refunded';
        END IF;

        IF v_refund THEN
            v_refunded := v_refunded + finance.fn_refund_seat_escrow(e.id);
            v_refunds := v_refunds + 1;
        ELSE
            v_forfeited := v_forfeited + finance.fn_release_seat_escrow(e.id, 'escrow_release');
            v_forfeits := v_forfeits + 1;
        END IF;

        IF e.session_event_id IS NOT NULL THEN
            UPDATE projects.session_events
               SET status = CASE WHEN v_by_host THEN 'cancelled_by_freelancer'::projects.session_event_status
                                 ELSE 'cancelled_by_client'::projects.session_event_status END,
                   updated_at = pg_catalog.now()
             WHERE id = e.session_event_id AND status = 'scheduled';
            UPDATE scheduling.event_reschedules r
               SET status = 'withdrawn', resolves_at = NULL, updated_at = pg_catalog.now()
              FROM scheduling.events ev
             WHERE ev.source_session_event_id = e.session_event_id
               AND r.event_id = ev.id
               AND r.status IN ('collecting', 'awaiting_counterparty', 'voting');
            UPDATE scheduling.events
               SET status = 'cancelled'::scheduling.event_status
             WHERE source_session_event_id = e.session_event_id;
        END IF;
    END LOOP;

    IF v_per_sitting AND v_refunds + v_forfeits = 0 THEN
        RAISE EXCEPTION 'Every session on this booking has already started — there is nothing left to cancel'
            USING ERRCODE = 'PS409';
    END IF;
    v_moved := v_refunded + v_forfeited;
    v_outcome := CASE
        WHEN NOT v_per_sitting THEN v_seat_outcome
        WHEN v_forfeits = 0 THEN 'refunded'
        WHEN v_refunds = 0 THEN 'forfeited'
        ELSE 'partial'
    END;

    UPDATE projects.cohort_memberships
       SET status = 'cancelled', cancelled_at = pg_catalog.now()
     WHERE id = v_m.id;
    IF v_per_sitting THEN
        UPDATE projects.cohorts SET status = 'cancelled'::projects.cohort_status
         WHERE id = v_cohort.id AND max_seats = 1 AND status IN ('enrolling', 'active');
    END IF;

    PERFORM comms.fn_notify(
        CASE WHEN v_by_host THEN v_m.user_id ELSE v_project.owner_user_id END,
        'session.cancelled',
        CASE
            WHEN v_by_host AND v_per_sitting THEN 'Your session was cancelled'
            WHEN v_by_host THEN 'Your seat was cancelled'
            WHEN v_per_sitting THEN 'A session booking was cancelled'
            ELSE 'A seat was cancelled'
        END,
        CASE
            WHEN v_per_sitting AND v_by_host THEN pg_catalog.format('Your provider cancelled "%s". Every session that had not started was refunded to you in full.', v_cohort.name)
            WHEN v_per_sitting AND v_outcome = 'refunded' THEN pg_catalog.format('"%s" was cancelled and every session that had not started was refunded in full.', v_cohort.name)
            WHEN v_per_sitting AND v_outcome = 'forfeited' THEN pg_catalog.format('"%s" was cancelled inside the notice window, so its payment goes to the provider.', v_cohort.name)
            WHEN v_per_sitting THEN pg_catalog.format('"%s" was cancelled. Sessions more than the notice period away were refunded; those inside it go to the provider.', v_cohort.name)
            WHEN v_outcome = 'refunded' THEN pg_catalog.format('The seat on "%s" was cancelled and refunded in full.', v_cohort.name)
            ELSE pg_catalog.format('The seat on "%s" was cancelled inside the notice window, so its payment goes to the provider.', v_cohort.name)
        END,
        'projects.cohort_memberships', v_m.id,
        pg_catalog.jsonb_build_object('outcome', v_outcome, 'amount_minor', v_moved, 'refunded_minor', v_refunded,
            'forfeited_minor', v_forfeited, 'currency', v_currency),
        v_uid, 'project', v_project.id, NULL, '/projects/' || v_project.slug
    );

    RETURN pg_catalog.jsonb_build_object(
        'membership_id', v_m.id, 'outcome', v_outcome, 'amount_minor', v_moved,
        'refunded_minor', v_refunded, 'forfeited_minor', v_forfeited, 'currency', v_currency
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
-- held escrow, naming the sitting — `finance.fn_escrow_has_open_dispute` is what the release sweep checks
-- before paying out — and it is audited against the presence rows above at once if the sitting has ended
-- (finance.fn_advance_dispute, 00001260, Decision #212): a provider no-show refunds, a full room
-- dismisses, anything else asks the provider to respond. Only once the sitting has started, and only
-- while the escrow is still held (afterwards there is nothing left to stop). Idempotent: a live claim on
-- the escrow, or a settled one on the same sitting, is returned rather than duplicated — and
-- uq_disputes_escrow_live makes two racing claims one.
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

    -- The escrow that pays for THIS sitting: its own per-sitting escrow (a 1:1 or set-session block,
    -- Decision #211), else the seat's whole-cohort escrow — never another sitting's.
    SELECT e.id INTO v_escrow
      FROM projects.cohort_memberships cm
      JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status = 'held'
     WHERE cm.cohort_id = v_event.cohort_id AND cm.user_id = v_uid AND cm.status = 'active'
       AND (e.session_event_id = v_event.id OR e.session_event_id IS NULL)
     ORDER BY (e.session_event_id = v_event.id) DESC NULLS LAST
     LIMIT 1;
    IF v_escrow IS NULL THEN
        RAISE EXCEPTION 'You have no held payment on this sitting to claim against' USING ERRCODE = 'PS409';
    END IF;

    SELECT d.id INTO v_dispute FROM finance.disputes d
     WHERE d.escrow_id = v_escrow
       AND (d.status IN ('open', 'awaiting_response', 'under_review') OR d.session_event_id = v_event.id)
     ORDER BY (d.status IN ('open', 'awaiting_response', 'under_review')) DESC, d.created_at DESC
     LIMIT 1;
    IF v_dispute IS NULL THEN
        BEGIN
            INSERT INTO finance.disputes (escrow_id, session_event_id, opened_by_profile, reason)
            VALUES (v_escrow, v_event.id, v_uid, pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(p_reason), ''),
                'The provider did not join the session.'), 480))
            RETURNING id INTO v_dispute;
        EXCEPTION WHEN unique_violation THEN
            SELECT d.id INTO v_dispute FROM finance.disputes d
             WHERE d.escrow_id = v_escrow AND d.status IN ('open', 'awaiting_response', 'under_review');
            RETURN pg_catalog.jsonb_build_object('dispute_id', v_dispute, 'escrow_id', v_escrow,
                'status', (SELECT d.status FROM finance.disputes d WHERE d.id = v_dispute));
        END;
        PERFORM comms.fn_notify(
            v_project.owner_user_id, 'dispute.opened', 'No-show claimed',
            pg_catalog.format('An attendee says you did not join "%s". The payment is held while the room''s attendance is checked.', v_event.title),
            'finance.disputes', v_dispute, pg_catalog.jsonb_build_object('session_event_id', v_event.id), v_uid,
            'project', v_project.id, NULL, '/projects/' || v_project.slug
        );
        PERFORM finance.fn_advance_dispute(v_dispute);
    END IF;
    RETURN pg_catalog.jsonb_build_object('dispute_id', v_dispute, 'escrow_id', v_escrow,
        'status', (SELECT d.status FROM finance.disputes d WHERE d.id = v_dispute));
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
-- seat with its escrow and any open no-show claim, the no-show claims they are party to, their live
-- hold, the curriculum with their
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
                         'claim_open', finance.fn_escrow_has_open_dispute(e.id))
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
        -- The no-show claims the caller is party to (Decision #212): an attendee's own, every claim on the
        -- engagement for the host. The status panel reads the case itself through finance.get_dispute.
        'disputes', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', d.id, 'status', d.status, 'session_event_id', d.session_event_id,
                'respond_by', d.respond_by, 'opened_at', d.created_at, 'resolved_at', d.resolved_at,
                'mine', d.opened_by_profile = v_uid
            ) ORDER BY d.created_at DESC)
              FROM finance.disputes d
              JOIN finance.escrows e ON e.id = d.escrow_id
              JOIN projects.cohort_memberships cm ON cm.id = e.cohort_membership_id
              JOIN projects.cohorts c ON c.id = cm.cohort_id
             WHERE c.project_id = v_project.id AND (v_host OR d.opened_by_profile = v_uid)
        ), '[]'::jsonb),
        -- The sitting an attendee may report a no-show on right now: the latest one that has started,
        -- whose own escrow (or the seat's whole-cohort escrow) is still held and carries no claim on it
        -- — exactly what claim_session_no_show would accept. NULL for a host or anyone else.
        'claimable_sitting_id', CASE WHEN v_role = 'attendee' THEN (
            SELECT se.id
              FROM projects.session_events se
              JOIN projects.cohorts c ON c.id = se.cohort_id
              JOIN projects.cohort_memberships cm ON cm.cohort_id = se.cohort_id
               AND cm.user_id = v_uid AND cm.status = 'active'
              JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status = 'held'
               AND (e.session_event_id = se.id OR e.session_event_id IS NULL)
             WHERE c.project_id = v_project.id
               AND se.status IN ('scheduled', 'completed') AND se.start_time <= pg_catalog.now()
               AND NOT finance.fn_escrow_has_open_dispute(e.id)
               AND NOT EXISTS (SELECT 1 FROM finance.disputes d
                                WHERE d.escrow_id = e.id AND d.session_event_id = se.id)
             ORDER BY se.start_time DESC
             LIMIT 1
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
-- The scheduled sweep (every 15 minutes, below). PRODUCT_SPEC §Session-Based C: "Payout Release,
-- T + 24h, Automatic Release (Negative Consent)" — for EVERY session escrow, not only cohort seats
-- (Decision #211). In one pass:
--   (a) sittings whose end has passed are marked `completed`;
--   (b) a PROVIDER NO-SHOW on a sitting (fn_session_presence) refunds the escrow that sitting stands
--       for — a 1-1 sitting's own escrow, or every held seat escrow on a cohort, whose seats are then
--       cancelled (PRODUCT_SPEC §Session-Based B, "flagged for an immediate refund"). Judged only on a
--       tracked room, so a silent webhook never refunds anyone, and on any ended sitting whatever its
--       age: the escrow still being `held` is the only guard needed, so a sweep that missed a day still
--       refunds the no-show it missed;
--   (c) a session escrow with no open dispute (finance.fn_escrow_has_open_dispute, Decision #212) is
--       released to the provider once its sitting ended `session_payout_hours` (24) ago — a 1-1
--       sitting's escrow after ITS sitting, a cohort seat's after the cohort's LAST sitting. A seat with
--       nothing left held becomes `completed`.
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

    -- (b) Provider no-shows.
    FOR r IN
        SELECT DISTINCT e.id AS escrow_id, e.session_event_id, cm.id AS membership_id, cm.user_id, se.title,
               p.id AS project_id, p.slug, p.owner_user_id
          FROM projects.session_events se
          JOIN projects.cohorts c ON c.id = se.cohort_id
          JOIN projects.projects p ON p.id = c.project_id
          JOIN projects.cohort_memberships cm ON cm.cohort_id = c.id
          JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status = 'held'
               AND (e.session_event_id = se.id OR (e.session_event_id IS NULL AND cm.status = 'active'))
         WHERE se.status = 'completed'
           AND se.provider_meeting_id IS NOT NULL
           AND (projects.fn_session_presence(se.id) ->> 'outcome') = 'provider_no_show'
    LOOP
        IF finance.fn_refund_seat_escrow(r.escrow_id) > 0 THEN
            v_refunded := v_refunded + 1;
            IF r.session_event_id IS NULL THEN
                UPDATE projects.cohort_memberships SET status = 'cancelled', cancelled_at = p_now
                 WHERE id = r.membership_id AND status = 'active';
            ELSE
                PERFORM projects.fn_settle_membership_state(r.membership_id, p_now);
            END IF;
            PERFORM comms.fn_notify(r.user_id, 'escrow.refunded', 'Session refunded',
                pg_catalog.format('The provider did not join "%s", so your payment was refunded in full.', r.title),
                'finance.escrows', r.escrow_id, '{}'::jsonb, NULL, 'project', r.project_id, NULL, '/projects/' || r.slug);
            PERFORM comms.fn_notify(r.owner_user_id, 'escrow.refunded',
                CASE WHEN r.session_event_id IS NULL THEN 'Seat refunded — no-show' ELSE 'Session refunded — no-show' END,
                pg_catalog.format('You were not in the room for "%s" within its first minutes, so its payment was refunded.', r.title),
                'finance.escrows', r.escrow_id, '{}'::jsonb, NULL, 'project', r.project_id, NULL, '/projects/' || r.slug);
        END IF;
    END LOOP;

    -- (c1) A 1-1 sitting's own escrow, session_payout_hours after that sitting ended.
    FOR r IN
        SELECT e.id AS escrow_id, e.cohort_membership_id AS membership_id, se.title, p.id AS project_id,
               p.slug, p.owner_user_id
          FROM finance.escrows e
          JOIN projects.session_events se ON se.id = e.session_event_id
          JOIN projects.cohorts c ON c.id = se.cohort_id
          JOIN projects.projects p ON p.id = c.project_id
         WHERE e.status = 'held'
           AND se.status = 'completed'
           AND se.end_time <= p_now - pg_catalog.make_interval(hours => v_hours)
           AND NOT finance.fn_escrow_has_open_dispute(e.id)
    LOOP
        IF finance.fn_release_seat_escrow(r.escrow_id, 'escrow_release') > 0 THEN
            v_released := v_released + 1;
            PERFORM projects.fn_settle_membership_state(r.membership_id, p_now);
            PERFORM comms.fn_notify(r.owner_user_id, 'escrow.released', 'Session payout released',
                pg_catalog.format('The payment for "%s" was released to your wallet.', r.title),
                'finance.escrows', r.escrow_id, '{}'::jsonb, NULL, 'project', r.project_id, NULL, '/projects/' || r.slug);
        END IF;
    END LOOP;

    -- (c2) A cohort seat's escrow, session_payout_hours after the cohort's last sitting ended.
    FOR r IN
        SELECT e.id AS escrow_id, cm.id AS membership_id, cm.user_id, c.name, p.id AS project_id, p.slug,
               p.owner_user_id
          FROM finance.escrows e
          JOIN projects.cohort_memberships cm ON cm.id = e.cohort_membership_id AND cm.status = 'active'
          JOIN projects.cohorts c ON c.id = cm.cohort_id
          JOIN projects.projects p ON p.id = c.project_id
         WHERE e.status = 'held'
           AND e.session_event_id IS NULL
           AND EXISTS (SELECT 1 FROM projects.session_events se WHERE se.cohort_id = c.id
                        AND se.status IN ('scheduled', 'completed'))
           AND NOT EXISTS (SELECT 1 FROM projects.session_events se WHERE se.cohort_id = c.id
                            AND se.status IN ('scheduled', 'completed')
                            AND se.end_time > p_now - pg_catalog.make_interval(hours => v_hours))
           AND NOT finance.fn_escrow_has_open_dispute(e.id)
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
'The session negative-consent sweep (Decision #211): completes ended sittings, refunds the escrow behind
any tracked sitting with a provider no-show (a 1-1 sitting''s own, or every held seat on a cohort), and
releases each session escrow with no open dispute (finance.fn_escrow_has_open_dispute)
session_payout_hours after its sitting ended — a 1-1 sitting''s own end, a cohort seat''s last sitting.';

-- Scheduled every 15 minutes as `auto-release-session-escrow` by the job registry
-- (`ops.scheduled_jobs`, 00005060).
-- #endregion

-- #region 14. Scheduling handshakes — the n-1 sittings of a set-session block (Decision #211)
-- A block's later sittings are booked PROVISIONALLY (fn_book_session_slot) with a 1-on-1 reschedule
-- round open on each, due at its `resolves_at`. The negotiation itself is the Proactive Calendar's
-- (the provider proposes, the client accepts or counters — `scheduling.event_reschedules`), and a
-- round it carries moves the sitting through the trigger below. This sweep owns the one transition
-- nobody else fires, in two steps:
--   * the REMINDER — once a booking's earliest open deadline is 24 hours away, its provider is told once
--     (`session.scheduling_reminder`). The notification row itself is the "already sent" mark, so the
--     sweep needs no queue (`comms.fn_process_queue` is unscheduled pending Decision #203 flag (a));
--   * the LAPSE — a handshake still open at its deadline lapses through
--     `scheduling.close_reschedule_round`, and the provisional time stands — `lapsed` already means "the
--     question closed and the original time stands". Both people are told.
-- Scheduled every 15 minutes as `session-scheduling-handshakes` (00005060). Idempotent:
-- close_reschedule_round answers NULL for a round that is already closed.
CREATE OR REPLACE FUNCTION projects.fn_lapse_session_handshakes(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_lapsed integer := 0;
    v_reminded integer := 0;
    r record;
BEGIN
    FOR r IN
        SELECT c.id AS cohort_id, c.name, p.id AS project_id, p.slug, p.owner_user_id,
               min(rs.resolves_at) AS agree_by
          FROM scheduling.event_reschedules rs
          JOIN scheduling.events ev ON ev.id = rs.event_id
          JOIN projects.session_events se ON se.id = ev.source_session_event_id AND se.status = 'scheduled'
          JOIN projects.cohorts c ON c.id = se.cohort_id
          JOIN projects.projects p ON p.id = c.project_id
         WHERE rs.mode = 'counterparty'
           AND rs.status IN ('collecting', 'awaiting_counterparty')
           AND rs.resolves_at > p_now
         GROUP BY c.id, p.id
        HAVING min(rs.resolves_at) - INTERVAL '24 hours' <= p_now
           AND NOT EXISTS (SELECT 1 FROM comms.notifications n
                            WHERE n.type = 'session.scheduling_reminder'
                              AND n.entity_table = 'projects.cohorts' AND n.entity_id = c.id)
    LOOP
        IF comms.fn_notify(r.owner_user_id, 'session.scheduling_reminder', 'Session times still to agree',
            pg_catalog.format('The remaining sessions of "%s" are still on their pencilled-in times. Propose times within a day, or they stand.', r.name),
            'projects.cohorts', r.cohort_id, pg_catalog.jsonb_build_object('agree_by', r.agree_by),
            NULL, 'project', r.project_id, NULL, '/projects/' || r.slug) IS NOT NULL THEN
            v_reminded := v_reminded + 1;
        END IF;
    END LOOP;

    FOR r IN
        SELECT rs.id AS reschedule_id, se.id AS sitting_id, se.title, se.start_time, p.id AS project_id, p.slug,
               p.owner_user_id, cm.user_id AS attendee_id
          FROM scheduling.event_reschedules rs
          JOIN scheduling.events ev ON ev.id = rs.event_id
          JOIN projects.session_events se ON se.id = ev.source_session_event_id AND se.status = 'scheduled'
          JOIN projects.cohorts c ON c.id = se.cohort_id
          JOIN projects.projects p ON p.id = c.project_id
          LEFT JOIN projects.cohort_memberships cm ON cm.cohort_id = c.id AND cm.status = 'active'
         WHERE rs.mode = 'counterparty'
           AND rs.status IN ('collecting', 'awaiting_counterparty')
           AND rs.resolves_at IS NOT NULL
           AND rs.resolves_at <= p_now
         ORDER BY rs.resolves_at
    LOOP
        IF scheduling.close_reschedule_round(
            r.reschedule_id, 'lapsed', NULL, NULL, 'Pencilled-in time kept',
            'No time was agreed before the deadline, so the pencilled-in time stands.'
        ) IS NOT NULL THEN
            v_lapsed := v_lapsed + 1;
            PERFORM comms.fn_notify(r.owner_user_id, 'session.scheduling_lapsed', 'Session time confirmed',
                pg_catalog.format('No other time was agreed for "%s", so it stays at its pencilled-in time.', r.title),
                'projects.session_events', r.sitting_id, pg_catalog.jsonb_build_object('starts_at', r.start_time),
                NULL, 'project', r.project_id, NULL, '/projects/' || r.slug);
            PERFORM comms.fn_notify(r.attendee_id, 'session.scheduling_lapsed', 'Session time confirmed',
                pg_catalog.format('No other time was agreed for "%s", so it stays at its pencilled-in time.', r.title),
                'projects.session_events', r.sitting_id, pg_catalog.jsonb_build_object('starts_at', r.start_time),
                NULL, 'project', r.project_id, NULL, '/projects/' || r.slug);
        END IF;
    END LOOP;
    RETURN pg_catalog.jsonb_build_object('reminded', v_reminded, 'lapsed', v_lapsed);
END;
$$;

COMMENT ON FUNCTION projects.fn_lapse_session_handshakes(timestamptz) IS
'The set-session handshake sweep (Decision #211): reminds a provider once, 24h before their booking''s
earliest open deadline, then lapses every 1-on-1 scheduling handshake on a session sitting whose
resolves_at has passed, through scheduling.close_reschedule_round — the provisional time stands, and
both people are told.';

-- AFTER UPDATE OF starts_at, ends_at on scheduling.events (00001860): a sitting's calendar mirror that
-- moved — a reschedule round carried — moves the sitting with it. The sitting is what the join window,
-- the presence rule and the payout clock read, so a moved meeting with an unmoved sitting would open
-- the room and release the money on the wrong day. Only a `scheduled` sitting moves.
CREATE OR REPLACE FUNCTION projects.trg_sitting_follows_calendar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE projects.session_events
       SET start_time = NEW.starts_at, end_time = NEW.ends_at, updated_at = pg_catalog.now()
     WHERE id = NEW.source_session_event_id
       AND status = 'scheduled'
       AND NEW.ends_at > NEW.starts_at
       AND (start_time, end_time) IS DISTINCT FROM (NEW.starts_at, NEW.ends_at);
    RETURN NEW;
END;
$$;

-- AFTER UPDATE OF status on scheduling.event_reschedules (00001860): a handshake on a provisional
-- sitting that comes to rest (`resolved` or `lapsed`) confirms the sitting's calendar entry and the
-- client's place on it. Only a `tentative` mirror — a block's provisional sitting — changes; a round on
-- any other event passes through untouched.
CREATE OR REPLACE FUNCTION projects.trg_session_handshake_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE scheduling.events ev SET status = 'confirmed'::scheduling.event_status
     WHERE ev.id = NEW.event_id
       AND ev.source_session_event_id IS NOT NULL
       AND ev.status = 'tentative'::scheduling.event_status;
    IF FOUND THEN
        UPDATE scheduling.event_attendees
           SET response = 'accepted'::scheduling.rsvp_response, responded_at = pg_catalog.now()
         WHERE event_id = NEW.event_id AND response = 'pending'::scheduling.rsvp_response;
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion
