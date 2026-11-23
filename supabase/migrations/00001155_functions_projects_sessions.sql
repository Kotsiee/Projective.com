-- =============================================================================================
-- 00001155_functions_projects_sessions.sql — session & group-session engagements (Category 1).
--
-- Decision #171. A session engagement is a `projects.projects` row with `format = 'session'` whose
-- stage carries one or more COHORTS (a 1-1 session is a cohort of one seat). Everything money- or
-- evidence-shaped about a sitting goes through a definer here:
--
--   1. Occupancy           fn_cohort_seats_taken — paid seats + unexpired holds; fn_cohort_seats_owed —
--                          the free seats the listing's waitlist has first call on (Decision #455)
--   2. The listing's offer get_cohort_offer      — the public read the entity view and Book flow use
--   3. Reserve             reserve_seat          — a TTL hold, under a row lock on the cohort
--   4. Confirm             fn_confirm_seat       — hold → membership + escrow, when the order settles
--  4b. Book a 1-1          fn_book_session_slot  — a one-seat cohort, one escrow PER SITTING, the calendar
--                          mirror and a block's n-1 scheduling handshakes (Decision #211)
--  4c. Group sittings      schedule_sitting · retitle_sitting — the provider's doors; the calendar
--                          mirror a vote cannot move (trg_sitting_round_guard)
--   5. Cancel              cancel_cohort_membership — PRODUCT_SPEC's late-cancel rule (full forfeit <24h),
--                          per sitting on a 1-1
--   6. Presence            scheduling.record_presence (00001510 §7e), the ledger behind every verdict
--   7. The 15-minute rule  fn_session_presence
--   8. Host attestation    record_host_attendance
--   9. No-show claim       claim_session_no_show — a finance.disputes row that stops auto-release,
--                          audited and resolved by the dispute lifecycle in 00001260 (Decision #212)
--  10. Join link           session_join_link     — the caller's URL, only when funded and in the window
--  11. Curriculum          complete_lesson
--  12. Auto-release        finance.auto_release_session_escrow (scheduled in 00005060) — every session
--                          escrow, per sitting on a 1-1 (Decision #211)
--  13. Workspace read      get_session_workspace — one definer read behind the session sidebars
--  15. Waitlist            join_waitlist · fn_waitlist_dispatch (scheduled in 00005060) · the buyer's
--                          and the seller's reads — invited in order, a held seat, converted or expired
--                          (Decision #455)
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

-- The buyer's answers to a session listing's own intake as its order line keeps them (Decision #453):
-- an object of bounded size, reduced to the ids the listing's intake declares — the rule
-- marketplace.instantiate_service_blueprint holds a pipeline request's answers to. Required-field
-- enforcement is the Zod SSOT's (`intakeRefusal`), run by the fat service before the basket line is
-- written. A line that carries none reads `{}`. Refusals: 22023 not an object · 22023 over 32 KB.
CREATE OR REPLACE FUNCTION projects.fn_session_intake_answers(p_blueprint_id uuid, p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_answers IS NULL OR pg_catalog.jsonb_typeof(p_answers) = 'null' THEN
        RETURN '{}'::jsonb;
    END IF;
    IF pg_catalog.jsonb_typeof(p_answers) <> 'object' THEN
        RAISE EXCEPTION 'The answers to this listing''s questions are malformed' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.pg_column_size(p_answers) > 32768 THEN
        RAISE EXCEPTION 'The answers to this listing''s questions are too long' USING ERRCODE = '22023';
    END IF;
    RETURN COALESCE((
        SELECT pg_catalog.jsonb_object_agg(a.key, a.value)
          FROM pg_catalog.jsonb_each(p_answers) AS a
         WHERE a.key IN (
             SELECT f ->> 'id'
               FROM marketplace.service_blueprints sb
              CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
                  CASE WHEN pg_catalog.jsonb_typeof(sb.intake_fields) = 'array'
                       THEN sb.intake_fields ELSE '[]'::jsonb END) AS f
              WHERE sb.id = p_blueprint_id)
    ), '{}'::jsonb);
END;
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

-- The queue fence (Decision #455): of the seats nobody holds, those the listing's waitlist has first
-- call on — one for each person waiting ahead of `p_user` (everyone waiting, for a buyer who is not in
-- the queue, or when `p_user` is NULL). An invited place already holds its seat, so it is counted by
-- fn_cohort_seats_taken, never here. A buyer may hold only `max_seats - taken(except them) - owed`, so a
-- seat that frees between two runs of the invite job goes to the queue, not to a walk-in.
CREATE OR REPLACE FUNCTION projects.fn_cohort_seats_owed(p_cohort_id uuid, p_user uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH c AS (
        SELECT c.max_seats, p.source_blueprint_id AS blueprint_id
          FROM projects.cohorts c
          JOIN projects.projects p ON p.id = c.project_id
         WHERE c.id = p_cohort_id
    ),
    me AS (
        SELECT w.queued_at, w.id
          FROM projects.waitlists w, c
         WHERE w.service_blueprint_id = c.blueprint_id
           AND w.user_id = p_user
           AND w.status = 'waiting'
    )
    SELECT COALESCE((
        SELECT LEAST(
            GREATEST(c.max_seats - projects.fn_cohort_seats_taken(p_cohort_id), 0),
            (SELECT count(*)
               FROM projects.waitlists w
              WHERE w.service_blueprint_id = c.blueprint_id
                AND w.status = 'waiting'
                AND w.user_id IS DISTINCT FROM p_user
                AND (NOT EXISTS (SELECT 1 FROM me)
                     OR (w.queued_at, w.id) < (SELECT me.queued_at, me.id FROM me)))
        )::integer
          FROM c
    ), 0);
$$;
-- #endregion

-- #region 2. The listing's cohort offer
-- The cohort a group-session LISTING seats buyers into right now — the enrolling cohort, on a session
-- engagement built from that blueprint, whose first sitting is soonest — with its real occupancy, its
-- sittings and its curriculum (the stage's standing plan, then the cohort's own). Public: the entity
-- view is read by guests, and every figure here is one the listing must disclose before purchase
-- (PRODUCT_SPEC §The Entity View, "remaining capacity"). It returns no person, no URL and no money
-- beyond the seat count. NULL when the listing has no enrolling cohort. `taken` counts the free seats
-- its waitlist has first call on (fn_cohort_seats_owed, Decision #455): to anyone outside the queue they
-- are not for sale. A queued buyer's own figure is projects.get_waitlist_place's. A cohort whose enrolment
-- close has passed is offered to nobody, before the sweep writes it `active`, and the terms a cohort
-- was opened on — its minimum, its close and its cadence — are part of the offer (Decision #498).
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
    SELECT c.id, c.project_id, c.name, c.max_seats, c.project_stage_id, c.min_seats, c.enrolment_closes_at,
           c.cadence, sb.group_schedule_mode = 'rolling_templates' AS rolling,
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
       AND (c.enrolment_closes_at IS NULL OR c.enrolment_closes_at > pg_catalog.now())
       -- A listing nobody may see yet answers only its own seller (their preview).
       AND (sb.is_published OR projects.fn_is_session_host(p.id, auth.uid()))
     -- On rolling weekly templates several chains enrol at once (SC11): a buyer lands on the earliest one
     -- with a seat to sell, so a full chain never hides next week's.
     ORDER BY (sb.group_schedule_mode = 'rolling_templates'
               AND projects.fn_cohort_seats_taken(c.id) + projects.fn_cohort_seats_owed(c.id) >= c.max_seats),
              first_start NULLS LAST, c.created_at
     LIMIT 1;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    v_taken := LEAST(projects.fn_cohort_seats_taken(v.id) + projects.fn_cohort_seats_owed(v.id), v.max_seats);

    RETURN pg_catalog.jsonb_build_object(
        'cohort_id', v.id,
        'name', v.name,
        'max_seats', v.max_seats,
        'taken', v_taken,
        'remaining', v.max_seats - v_taken,
        'first_start', v.first_start,
        'min_seats', v.min_seats,
        'enrolment_closes_at', v.enrolment_closes_at,
        'cadence', v.cadence,
        -- Every chain a rolling listing has enrolling, soonest first, for the buyer to pick a start (SC11);
        -- empty on a listing whose seller opens cohorts by hand.
        'chains', CASE WHEN v.rolling THEN COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'cohort_id', ch.id,
                'first_start', ch.first_start,
                'remaining', GREATEST(ch.max_seats - projects.fn_cohort_seats_taken(ch.id)
                                      - projects.fn_cohort_seats_owed(ch.id), 0),
                'sittings', COALESCE((
                    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'id', se.id, 'title', se.title, 'starts_at', se.start_time, 'ends_at', se.end_time
                    ) ORDER BY se.start_time)
                      FROM projects.session_events se
                     WHERE se.cohort_id = ch.id AND se.status = 'scheduled'
                ), '[]'::jsonb)
            ) ORDER BY ch.first_start NULLS LAST, ch.created_at)
              FROM (
                  SELECT c.id, c.max_seats, c.created_at,
                         (SELECT min(se.start_time) FROM projects.session_events se
                           WHERE se.cohort_id = c.id AND se.status = 'scheduled') AS first_start
                    FROM projects.cohorts c
                   WHERE c.project_id = v.project_id
                     AND c.status = 'enrolling'
                     AND (c.enrolment_closes_at IS NULL OR c.enrolment_closes_at > pg_catalog.now())
              ) ch
        ), '[]'::jsonb) ELSE '[]'::jsonb END,
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
-- again renews it rather than stacking a second, and a renewal never shortens it: a waitlist invite's
-- hold keeps its own end (Decision #455). The seats the listing's waitlist has first call on are not
-- for the caller to take (fn_cohort_seats_owed): they are refused as `full`, with what is left. A
-- cohort past its enrolment close is `closed` whatever its status says, and a hold placed before the
-- close ends at it (Decision #498).
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
    v_owed integer;
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
    IF v_cohort.status <> 'enrolling'
       OR (v_cohort.enrolment_closes_at IS NOT NULL AND v_cohort.enrolment_closes_at <= pg_catalog.now()) THEN
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
    v_owed := projects.fn_cohort_seats_owed(p_cohort_id, v_uid);
    IF v_taken + v_owed + p_seats > v_cohort.max_seats THEN
        RAISE EXCEPTION USING ERRCODE = 'PS409',
            MESSAGE = CASE
                WHEN v_taken >= v_cohort.max_seats THEN 'Every seat in this cohort is taken'
                WHEN v_taken + v_owed >= v_cohort.max_seats
                    THEN 'The open seats in this cohort are held for the people on its waitlist'
                ELSE pg_catalog.format('Only %s seat%s left in this cohort', v_cohort.max_seats - v_taken - v_owed,
                    CASE WHEN v_cohort.max_seats - v_taken - v_owed = 1 THEN '' ELSE 's' END) END,
            DETAIL = pg_catalog.jsonb_build_object(
                'reason', 'full', 'remaining', GREATEST(v_cohort.max_seats - v_taken - v_owed, 0))::text;
    END IF;

    v_expires := LEAST(pg_catalog.now() + pg_catalog.make_interval(
        mins => projects.fn_session_param('seat_hold_minutes', 15)), v_cohort.enrolment_closes_at);

    UPDATE projects.cohort_seat_holds
       SET seats = p_seats, expires_at = GREATEST(expires_at, v_expires), updated_at = pg_catalog.now()
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
        'remaining', v_cohort.max_seats - v_taken - v_owed - p_seats
    );
END;
$$;

COMMENT ON FUNCTION projects.reserve_seat(uuid, integer) IS
'Hold seats on an enrolling cohort for seat_hold_minutes (renewing the caller''s live hold, never
shortening it), under a row lock on the cohort so the last seat cannot be sold twice; the seats the
listing''s waitlist has first call on are refused (Decision #455). Refusals: 42501 · 22023 · P0002 ·
PU422 own session · PS409 closed/full/already seated (DETAIL {reason, remaining}).';
-- #endregion

-- #region 4. Confirm a seat — when the order that paid for it settles
-- Internal: `finance.place_wallet_order` calls it for a `course_group_session` line, inside its own
-- transaction, after writing the order line. Turns the buyer's hold into a membership and holds the
-- seat's price in escrow from the paying wallet — the Sessions row of PRODUCT_SPEC §Escrow Lifetimes
-- ("Booking: escrow locked"). Nothing reaches the seller here: the escrow releases after the session.
--
-- A hold that lapsed while the buyer paid (a slow card, a 3-D Secure prompt) is honoured if the seat
-- is still free — the cohort is locked and occupancy re-counted, the waitlist's first call included —
-- and refused if someone else took it, so a seat is never sold twice and a buyer is never charged for a
-- seat they did not get (the whole order rolls back with the refusal).
--
-- The buyer's place on the listing's waitlist, if any, becomes `converted` (Decision #455).
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
    IF v_cohort.status <> 'enrolling'
       OR (v_cohort.enrolment_closes_at IS NOT NULL AND v_cohort.enrolment_closes_at <= pg_catalog.now()) THEN
        RAISE EXCEPTION 'This cohort stopped taking bookings while you were paying' USING ERRCODE = 'PS409';
    END IF;
    IF v_hold.expires_at <= pg_catalog.now()
       AND projects.fn_cohort_seats_taken(v_cohort.id, p_buyer) + projects.fn_cohort_seats_owed(v_cohort.id, p_buyer)
           + v_hold.seats > v_cohort.max_seats THEN
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
           sponsor_membership_id = NULL, joined_at = pg_catalog.now(), cancelled_at = NULL
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
    UPDATE projects.waitlists
       SET status = 'converted', resolved_at = pg_catalog.now()
     WHERE service_blueprint_id = v_project.source_blueprint_id
       AND user_id = p_buyer
       AND status <> 'converted';
    PERFORM projects.fn_sync_sitting_mirrors(v_cohort.id);

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
BEGIN
    SELECT * INTO r FROM finance.escrows WHERE id = p_escrow_id AND status = 'held' FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    UPDATE finance.escrows SET status = 'refunded' WHERE id = r.id;
    PERFORM finance.fn_refund_escrow_to_payer(r.id, r.amount_cents, 'escrow_refund');
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

-- The seller's session engagement for a session listing: ONE per listing and kind, made on its first
-- booking (`normal`, a 1-1) or its first opened cohort (`group`, projects.open_cohort), with one
-- "Sessions" stage that every cohort hangs off (an escrow is always held against a stage). Concurrent
-- first bookings or opens are serialised on an advisory lock keyed to the listing, so two callers at
-- once cannot each mint an engagement — and a caller that must see the listing's cohorts unchanged
-- (open_cohort's one-enrolling rule) holds that lock for the rest of its transaction. `unlisted` and
-- `active`: it is the provider's delivery workspace, never a public project, so it takes no
-- public-project slot.
CREATE OR REPLACE FUNCTION projects.fn_session_engagement_for(
    p_blueprint_id uuid,
    p_kind text DEFAULT 'normal',
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
    IF p_kind IS NULL OR p_kind NOT IN ('normal', 'group') THEN
        RAISE EXCEPTION 'A session engagement is a 1-1 (normal) or a group' USING ERRCODE = '22023';
    END IF;
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
       AND p.session_kind = p_kind
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
            p_kind, 'active'::public.project_status, 'unlisted'::public.visibility,
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
--   * writes the sittings — the first at the time the buyer picked, then each later time the buyer also
--     chose at booking (`p_later_starts`, ascending, Decision #411), and every sitting left for later
--     PROVISIONALLY a week after the one before (PRODUCT_SPEC §Session-Based A: the buyer commits to a
--     block, not to six specific Tuesdays) — and holds one escrow per sitting from the paying wallet;
--   * titles a sitting from the listing's session plan when the seller described it;
--   * mirrors every sitting onto the provider's calendar (`scheduling.events.source_session_event_id`,
--     with both people on its roster), so it blocks their free/busy and the Proactive Calendar can
--     move it;
--   * for a block, opens a scheduling handshake on each PROVISIONAL sitting: a 1-on-1 reschedule round
--     (round 0, `collecting`, the provider to propose), due `set_session_schedule_hours`
--     (72) after payment and never later than `session_cancel_notice_hours` before the provisional
--     time. A round still open at its deadline lapses and the provisional time stands — exactly what
--     `lapsed` already means (projects.fn_lapse_session_handshakes, which also reminds the provider
--     once, 24 hours before the earliest deadline).
-- The buyer must be an adult (Decision #208), and every sitting the buyer chose must sit inside the
-- provider's working hours — the listing's compiled availability preset when there is one, else the
-- weekly bands (scheduling.fn_band_covers with the blueprint, Decision #217 (d)); the pencilled-in
-- sittings are agreed through their handshakes instead. Chosen times run in order, each starting after
-- the one before it ends, and number at most p_sittings - 1 after the first.
-- Every chosen time is re-tested against the provider's calendar under a lock on it
-- (scheduling.fn_slot_is_free: their events, their requested and confirmed discovery calls, their
-- blackouts, with the schedule's buffers), so two buyers paying for the same slot at once queue here
-- and the second is refused (and charged nothing — the whole order rolls back) rather than both being
-- seated. A discovery call request and a new group sitting take the same lock.
CREATE OR REPLACE FUNCTION projects.fn_book_session_slot(
    p_blueprint_id uuid,
    p_buyer uuid,
    p_payer_type text,
    p_payer_id uuid,
    p_unit_amount bigint,
    p_sittings integer,
    p_currency text,
    p_starts_at timestamptz,
    p_order_line_id uuid,
    p_later_starts timestamptz[]
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bp marketplace.service_blueprints;
    v_chosen integer := COALESCE(pg_catalog.cardinality(p_later_starts), 0);
    v_prev_end timestamptz;
    v_plan_title text;
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

    IF v_chosen > p_sittings - 1 THEN
        RAISE EXCEPTION 'This booking holds % sessions, and % times were chosen', p_sittings, v_chosen + 1
            USING ERRCODE = '22023';
    END IF;
    v_prev_end := p_starts_at + pg_catalog.make_interval(mins => v_minutes);
    FOR k IN 1 .. v_chosen LOOP
        IF p_later_starts[k] IS NULL OR p_later_starts[k] < v_prev_end THEN
            RAISE EXCEPTION 'Each session has to start after the one before it ends — pick new times; nothing was charged'
                USING ERRCODE = 'PC409';
        END IF;
        v_prev_end := p_later_starts[k] + pg_catalog.make_interval(mins => v_minutes);
    END LOOP;

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
        -- The discovery-call gate's own predicate: blackouts, events and requested or confirmed calls,
        -- with the schedule's buffers — the rule the slot grid offered the time under.
        IF NOT scheduling.fn_slot_is_free(v_schedule, p_starts_at, p_starts_at + pg_catalog.make_interval(mins => v_minutes)) THEN
            RAISE EXCEPTION 'That time was just taken — pick another; nothing was charged' USING ERRCODE = 'PS409';
        END IF;
        FOR k IN 1 .. v_chosen LOOP
            IF NOT scheduling.fn_band_covers(v_schedule, 'working_hours'::scheduling.availability_kind,
                   p_later_starts[k], p_later_starts[k] + pg_catalog.make_interval(mins => v_minutes), p_blueprint_id) THEN
                RAISE EXCEPTION 'The time for session % is outside the provider''s hours — pick another; nothing was charged', k + 1
                    USING ERRCODE = 'PS409';
            END IF;
            IF NOT scheduling.fn_slot_is_free(v_schedule, p_later_starts[k],
                   p_later_starts[k] + pg_catalog.make_interval(mins => v_minutes)) THEN
                RAISE EXCEPTION 'The time for session % was just taken — pick another; nothing was charged', k + 1
                    USING ERRCODE = 'PS409';
            END IF;
        END LOOP;
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
        v_start := CASE
            WHEN k = 0 THEN p_starts_at
            WHEN k <= v_chosen THEN p_later_starts[k]
            ELSE COALESCE(p_later_starts[v_chosen], p_starts_at) + pg_catalog.make_interval(days => 7 * (k - v_chosen))
        END;
        v_end := v_start + pg_catalog.make_interval(mins => v_minutes);
        v_plan_title := CASE WHEN pg_catalog.jsonb_typeof(v_bp.session_plan -> k) = 'object'
                             THEN NULLIF(pg_catalog.btrim(COALESCE(v_bp.session_plan -> k ->> 'title', '')), '') END;
        v_title := CASE WHEN p_sittings = 1 THEN COALESCE(v_bp.title || ' — ' || v_plan_title, v_bp.title)
                        WHEN v_plan_title IS NOT NULL
                        THEN pg_catalog.format('%s — session %s of %s: %s', v_bp.title, k + 1, p_sittings, v_plan_title)
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
            CASE WHEN k <= v_chosen THEN 'confirmed'::scheduling.event_status ELSE 'tentative'::scheduling.event_status END,
            v_title, v_start, v_end, 1, 1, v_event, v_project.owner_user_id
        )
        RETURNING id INTO v_mirror;
        INSERT INTO scheduling.event_attendees (event_id, user_id, role, response, responded_at)
        VALUES
            (v_mirror, v_project.owner_user_id, 'host'::scheduling.attendee_role,
                'accepted'::scheduling.rsvp_response, pg_catalog.now()),
            (v_mirror, p_buyer, 'participant'::scheduling.attendee_role,
                CASE WHEN k <= v_chosen THEN 'accepted'::scheduling.rsvp_response ELSE 'pending'::scheduling.rsvp_response END,
                CASE WHEN k <= v_chosen THEN pg_catalog.now() END);

        v_deadline := NULL;
        IF k > v_chosen THEN
            v_deadline := LEAST(pg_catalog.now() + pg_catalog.make_interval(hours => v_window),
                                v_start - pg_catalog.make_interval(hours => v_notice));
            INSERT INTO scheduling.event_reschedules (event_id, round, mode, status, opened_by_user_id, opened_at, resolves_at)
            VALUES (v_mirror, 0, 'counterparty', 'collecting', v_project.owner_user_id, pg_catalog.now(), v_deadline);
            v_first_deadline := LEAST(COALESCE(v_first_deadline, v_deadline), v_deadline);
        END IF;

        v_sittings := v_sittings || pg_catalog.jsonb_build_object(
            'event_id', v_event, 'calendar_event_id', v_mirror, 'starts_at', v_start, 'ends_at', v_end,
            'escrow_id', v_escrow, 'provisional', k > v_chosen, 'agree_by', v_deadline);
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
    IF p_sittings - 1 > v_chosen THEN
        PERFORM comms.fn_notify(
            v_project.owner_user_id, 'session.scheduling_requested', 'Agree the remaining session times',
            pg_catalog.format('%s more sessions of "%s" are pencilled in weekly. Propose the times that suit you both within %s hours, or the pencilled-in times stand.',
                p_sittings - 1 - v_chosen, v_bp.title, v_window),
            'projects.cohorts', v_cohort, pg_catalog.jsonb_build_object('agree_by', v_first_deadline),
            p_buyer, 'project', v_project.id, NULL, '/projects/' || v_project.slug
        );
        PERFORM comms.fn_notify(
            p_buyer, 'session.scheduling_requested', 'Your remaining sessions are pencilled in',
            pg_catalog.format('%s The other %s are pencilled in weekly; your provider will propose times to agree with you within %s hours, or the pencilled-in times stand.',
                CASE WHEN v_chosen = 0
                     THEN pg_catalog.format('Your first session of "%s" is booked.', v_bp.title)
                     ELSE pg_catalog.format('Your first %s sessions of "%s" are booked.', v_chosen + 1, v_bp.title) END,
                p_sittings - 1 - v_chosen, v_window),
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

COMMENT ON FUNCTION projects.fn_book_session_slot(uuid, uuid, text, uuid, bigint, integer, text, timestamptz, uuid, timestamptz[]) IS
'Internal (finance.place_wallet_order): seat a 1-1 buyer on a one-seat cohort of the listing''s session
engagement, write the sittings (the first at the picked time, then the later times the buyer chose in
p_later_starts, the rest provisionally weekly after the last chosen one), title each from the session
plan, hold one escrow per sitting from the paying wallet, mirror each sitting onto the provider''s
calendar, and for a block open a 1-on-1 reschedule round on each provisional sitting due
set_session_schedule_hours after payment (Decisions #211, #411). Refusals roll the whole order back:
22023 more chosen times than the block holds · PU422 own session / payer · PF402 · PC409 time passed,
chosen times out of order or overlapping, or listing gone · PM403 the buyer is under 18 · PS409 a chosen
time is not free on the provider''s calendar (scheduling.fn_slot_is_free: events, discovery calls,
blackouts, buffers) or is outside their working hours (the listing''s compiled preset, else the weekly
bands).';
-- #endregion

-- #region 4c. Group sittings — the provider's two doors (D0, S-05)
-- No client role writes `projects.session_events` (00002520): the payout sweep reads a sitting's time
-- and status, so a writable sitting was a way to be paid for one that never happened. A provider still
-- has to set when a group cohort meets, and what each meeting is called. These two definers are the
-- only way they do, and neither touches a sitting's status, its rooms or its money:
--
--   * schedule_sitting — adds a sitting to a GROUP cohort the caller hosts, and mirrors it onto the
--     provider's calendar (`scheduling.events.source_session_event_id`) as fn_book_session_slot does for
--     a 1-1, so it blocks their free/busy, the discovery-call gate and the 1-1 booking gate;
--   * retitle_sitting  — renames a sitting, and its calendar mirror with it.
--
-- Neither MOVES a sitting, and nothing else may move a group one. Its mirror carries no roster, so the
-- coordination planner refuses to negotiate it ("an event with no roster is not something people
-- negotiate"), and trg_sitting_round_guard refuses any reschedule round on it at the table, whichever
-- role writes. The reason is money: a seat's cancellation is judged against the cohort's first
-- sitting, so a majority vote that moves a sitting inside the cancellation notice leaves every attendee
-- who voted against it forfeiting their seat for a change the provider initiated
-- (SCHEDULING_DECISIONS_AND_GAPS §2.2). Until ruling D2 sets the windows a vote must respect, a group
-- sitting keeps the time it was given. A 1-1 sitting is still agreed 1-on-1 (`counterparty`): the one
-- attendee who must accept the move is the only person it affects.

-- The paid seats on a cohort, as the calendar shows them on every one of its sitting mirrors
-- (`attendee_count` beside `capacity`). Called wherever a group seat starts or ends, so the "3 / 10
-- attending" on the provider's calendar is never a figure from the day the sitting was scheduled.
CREATE OR REPLACE FUNCTION projects.fn_sync_sitting_mirrors(p_cohort_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH x AS (
        SELECT COALESCE(sum(cm.seats), 0)::integer AS seats
          FROM projects.cohort_memberships cm
         WHERE cm.cohort_id = p_cohort_id AND cm.status <> 'cancelled'
    )
    UPDATE scheduling.events ev
       SET attendee_count = x.seats, updated_at = pg_catalog.now()
      FROM x, projects.session_events se
     WHERE se.cohort_id = p_cohort_id
       AND ev.source_session_event_id = se.id
       AND ev.attendee_count IS DISTINCT FROM x.seats;
$$;

-- Internal: write one sitting of a GROUP cohort and its roster-less calendar mirror — the one path both
-- schedule_sitting and open_cohort schedule through. The caller has authorised the provider and holds
-- the cohort's row lock. The time is re-tested against the provider's calendar under a lock on it
-- (scheduling.fn_slot_is_free: events, discovery calls, blackouts, buffers), so a sitting can never be
-- double-booked against a 1-1 booking or a discovery call taking the same lock. The caller syncs the
-- mirrors' seat count. Refusal: PS409 the time is not free.
CREATE OR REPLACE FUNCTION projects.fn_write_group_sitting(
    p_cohort_id uuid,
    p_title text,
    p_starts_at timestamptz,
    p_ends_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cohort projects.cohorts;
    v_project projects.projects;
    v_schedule uuid;
    v_sitting projects.session_events;
    v_mirror uuid;
BEGIN
    SELECT * INTO v_cohort FROM projects.cohorts WHERE id = p_cohort_id;
    SELECT * INTO v_project FROM projects.projects WHERE id = v_cohort.project_id;

    v_schedule := projects.fn_session_host_schedule(v_project.id);
    IF v_schedule IS NOT NULL THEN
        PERFORM 1 FROM scheduling.schedules WHERE id = v_schedule FOR UPDATE;
        IF NOT scheduling.fn_slot_is_free(v_schedule, p_starts_at, p_ends_at) THEN
            RAISE EXCEPTION 'That time clashes with something already on your calendar — pick another'
                USING ERRCODE = 'PS409';
        END IF;
    END IF;

    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_cohort.id, p_title, p_starts_at, p_ends_at)
    RETURNING * INTO v_sitting;

    -- No roster: the sitting is the provider's to keep, not a meeting its seat-holders vote to move
    -- (above). Anchored to the engagement as well as the schedule, so no client policy reaches it.
    INSERT INTO scheduling.events (
        schedule_id, project_id, kind, status, title, starts_at, ends_at, capacity,
        source_session_event_id, created_by
    ) VALUES (
        v_schedule, v_project.id, 'session'::scheduling.event_kind, 'confirmed'::scheduling.event_status,
        p_title, p_starts_at, p_ends_at, v_cohort.max_seats, v_sitting.id, v_project.owner_user_id
    )
    RETURNING id INTO v_mirror;

    RETURN pg_catalog.jsonb_build_object(
        'sitting_id', v_sitting.id, 'slug', v_sitting.slug, 'calendar_event_id', v_mirror,
        'title', v_sitting.title, 'starts_at', v_sitting.start_time, 'ends_at', v_sitting.end_time
    );
END;
$$;

-- The provider adds a sitting to one of their group cohorts. Refusals: 42501 signed out or not the
-- cohort's host · PM403 under 18 · 22023 an empty or over-long title, no span, a span over 24 hours, a
-- start that has passed · P0002 no such cohort · PU422 a 1-1 booking's cohort · PS409 the cohort or its
-- engagement has ended, the time is not free on the provider's calendar, the sitting would start before
-- the cohort's enrolment closes (a cohort's sittings follow its close, Decision #498), or it would move
-- the cohort's start earlier for people who have already paid.
--
-- That last refusal is the same money as the vote's. A seat is refunded or forfeited against the
-- cohort's FIRST sitting, so a new sitting before it would pull every seat-holder towards — or straight
-- into — the forfeit window. Once any seat is taken (paid, or held while its buyer pays), a new sitting
-- goes after the first one; a cohort with seats taken and no sitting yet gets its first one more than
-- `session_cancel_notice_hours` away, so every seat-holder can still cancel for a full refund.
CREATE OR REPLACE FUNCTION projects.schedule_sitting(
    p_cohort_id uuid,
    p_title text,
    p_starts_at timestamptz,
    p_ends_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_title text := pg_catalog.btrim(COALESCE(p_title, ''));
    v_notice integer := projects.fn_session_param('session_cancel_notice_hours', 24);
    v_cohort projects.cohorts;
    v_project projects.projects;
    v_first timestamptz;
    v_out jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to schedule a session' USING ERRCODE = '42501';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);
    IF v_title = '' OR pg_catalog.length(v_title) > 200 THEN
        RAISE EXCEPTION 'Give the session a title of up to 200 characters' USING ERRCODE = '22023';
    END IF;
    IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at
       OR p_ends_at - p_starts_at > INTERVAL '24 hours' THEN
        RAISE EXCEPTION 'A session needs a start and a later end, at most 24 hours apart' USING ERRCODE = '22023';
    END IF;
    IF p_starts_at <= pg_catalog.now() THEN
        RAISE EXCEPTION 'That time has passed — pick one that is still ahead' USING ERRCODE = '22023';
    END IF;

    -- The lock reserve_seat and fn_confirm_seat take, so the seat count below cannot change under it.
    SELECT * INTO v_cohort FROM projects.cohorts WHERE id = p_cohort_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That cohort no longer exists' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_project FROM projects.projects WHERE id = v_cohort.project_id;
    IF NOT projects.fn_is_session_host(v_project.id, v_uid) THEN
        RAISE EXCEPTION 'Only the session''s provider can schedule its sittings' USING ERRCODE = '42501';
    END IF;
    IF v_project.session_kind <> 'group' THEN
        RAISE EXCEPTION 'A 1-1 booking''s sessions are the ones its client booked — agree a new time from the calendar instead'
            USING ERRCODE = 'PU422';
    END IF;
    IF v_cohort.status NOT IN ('enrolling', 'active') OR v_project.status NOT IN ('draft', 'active') THEN
        RAISE EXCEPTION 'This cohort has ended — it takes no new sessions' USING ERRCODE = 'PS409';
    END IF;
    IF v_cohort.enrolment_closes_at IS NOT NULL AND p_starts_at < v_cohort.enrolment_closes_at THEN
        RAISE EXCEPTION 'This cohort takes bookings until its enrolment closes — its sessions start after that'
            USING ERRCODE = 'PS409';
    END IF;

    IF projects.fn_cohort_seats_taken(v_cohort.id) > 0 THEN
        SELECT min(se.start_time) INTO v_first
          FROM projects.session_events se
         WHERE se.cohort_id = v_cohort.id AND se.status IN ('scheduled', 'completed');
        IF v_first IS NOT NULL AND p_starts_at < v_first THEN
            RAISE EXCEPTION 'People have paid for this cohort from its first session — add this one after it'
                USING ERRCODE = 'PS409';
        END IF;
        IF v_first IS NULL AND p_starts_at <= pg_catalog.now() + pg_catalog.make_interval(hours => v_notice) THEN
            RAISE EXCEPTION USING ERRCODE = 'PS409',
                MESSAGE = pg_catalog.format('People have paid for a seat already — their first session must be more than %s hours away, so they can still cancel for a refund', v_notice);
        END IF;
    END IF;

    v_out := projects.fn_write_group_sitting(v_cohort.id, v_title, p_starts_at, p_ends_at);
    PERFORM projects.fn_sync_sitting_mirrors(v_cohort.id);
    RETURN v_out;
END;
$$;

COMMENT ON FUNCTION projects.schedule_sitting(uuid, text, timestamptz, timestamptz) IS
'The provider''s door for adding a sitting to a group cohort they host: writes the sitting and its
roster-less calendar mirror (fn_write_group_sitting, so it blocks free/busy and both booking gates, and
no vote can move it). Refusals: 42501 · PM403 · 22023 title / span / time passed · P0002 · PU422 a 1-1
cohort · PS409 ended, not free on the calendar, before the cohort''s enrolment close, or earlier than
the first sitting (or inside the cancellation notice) once a seat is taken.';

-- The provider renames one of their sittings — a 1-1's or a group's — and its calendar mirror with it.
-- Nothing else about the sitting changes. Refusals: 42501 signed out or not the host · 22023 an empty or
-- over-long title · P0002 no such sitting.
CREATE OR REPLACE FUNCTION projects.retitle_sitting(p_sitting_id uuid, p_title text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_title text := pg_catalog.btrim(COALESCE(p_title, ''));
    v_project uuid;
    v_sitting projects.session_events;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to rename a session' USING ERRCODE = '42501';
    END IF;
    IF v_title = '' OR pg_catalog.length(v_title) > 200 THEN
        RAISE EXCEPTION 'Give the session a title of up to 200 characters' USING ERRCODE = '22023';
    END IF;
    SELECT c.project_id INTO v_project
      FROM projects.session_events se
      JOIN projects.cohorts c ON c.id = se.cohort_id
     WHERE se.id = p_sitting_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That session no longer exists' USING ERRCODE = 'P0002';
    END IF;
    IF NOT projects.fn_is_session_host(v_project, v_uid) THEN
        RAISE EXCEPTION 'Only the session''s provider can rename it' USING ERRCODE = '42501';
    END IF;

    UPDATE projects.session_events SET title = v_title, updated_at = pg_catalog.now()
     WHERE id = p_sitting_id
    RETURNING * INTO v_sitting;
    UPDATE scheduling.events SET title = v_title, updated_at = pg_catalog.now()
     WHERE source_session_event_id = p_sitting_id AND title IS DISTINCT FROM v_title;

    RETURN pg_catalog.jsonb_build_object(
        'sitting_id', v_sitting.id, 'slug', v_sitting.slug,
        'calendar_event_id', (SELECT ev.id FROM scheduling.events ev
                               WHERE ev.source_session_event_id = p_sitting_id ORDER BY ev.created_at LIMIT 1),
        'title', v_sitting.title, 'starts_at', v_sitting.start_time, 'ends_at', v_sitting.end_time
    );
END;
$$;

COMMENT ON FUNCTION projects.retitle_sitting(uuid, text) IS
'The provider''s door for renaming a sitting (1-1 or group) and its calendar mirror; nothing else about
the sitting changes. Refusals: 42501 · 22023 title · P0002.';

-- BEFORE INSERT OR UPDATE OF event_id, mode on scheduling.event_reschedules (00001860). A reschedule
-- round on a sitting's calendar mirror is legal only as a 1-on-1 (`counterparty`) on a 1-1 engagement
-- (`session_kind = 'normal'`, fn_book_session_slot's) — the provider and their one client agreeing.
-- A group sitting is never put to a round (§4c above): the planner already refuses one with no roster,
-- and this makes it true of the TABLE, for the service role too. Every other event passes.
CREATE OR REPLACE FUNCTION projects.trg_sitting_round_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_kind text;
BEGIN
    SELECT p.session_kind INTO v_kind
      FROM scheduling.events ev
      JOIN projects.session_events se ON se.id = ev.source_session_event_id
      JOIN projects.cohorts c ON c.id = se.cohort_id
      JOIN projects.projects p ON p.id = c.project_id
     WHERE ev.id = NEW.event_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF v_kind IS DISTINCT FROM 'normal' THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'event: a group session''s sitting keeps its time — it is not put to a reschedule round';
    END IF;
    IF NEW.mode IS DISTINCT FROM 'counterparty' THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'event: a 1-1 sitting is agreed between its provider and client — it is never put to a vote';
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion

-- #region 4d. Open and cancel a group cohort — the seller's doors (Decision #498)
-- A group-session listing sells seats only on its ENROLLING cohort (get_cohort_offer), so until a
-- seller opens one the listing is waitlist-only. Owner rulings (2026-11-18):
--   * the seller sets the capacity (the listing's cohort size by default), the first sitting, how the
--     listing's `session_count` sittings repeat (weekly · fortnightly · fixed dates), an enrolment close
--     at or before the first sitting, and an optional minimum — every one shown to the buyer before
--     they pay (get_cohort_offer);
--   * the seller may cancel a whole cohort any time before its first sitting starts: every seat is
--     refunded in full through the seat escrow's refund path (`under_filled` when the close passed
--     below the minimum, `provider` otherwise); a seller who does nothing runs it;
--   * a cancelled cohort's waitlist keeps its order: an invite's seat is released and its place goes
--     back to waiting where it stood, and a refunded seat-holder's place reopens at its original
--     queue time (#455 (b) amended for this case); seat-holders and the queue are told;
--   * a cohort's enrolment closes by its first sitting; the listing's "join after start" toggle
--     (`allow_continuous_enrollment`) has no effect yet.
-- One enrolling cohort per listing at a time (#455 (e): the listing sells only one), checked under the
-- listing's engagement lock. No client role writes `projects.cohorts` (00002520).

-- The seller opens a cohort on one of their group-session listings, with its sittings, through the path
-- schedule_sitting takes (fn_write_group_sitting). `p_listing` is the catalogue listing; the caller must
-- manage it (catalogue.fn_manages_listing: its owner, or a `publish_listings` holder on its team).
-- Weekly and fortnightly sittings keep their wall-clock time in the provider's own zone across a clock
-- change. Opening is what the waitlist job waits for (fn_waitlist_dispatch): its next tick invites the
-- queue, one per seat, in order.
--
-- Refusals: 42501 signed out · PM403 under 18 · P0002 not a listing the caller manages · PU422 not a
-- group session, or archived · 22023 seats outside 1–500, a minimum outside 1–the cohort size, a first
-- sitting that has passed, a close that has passed or falls after the first sitting (strictly before it
-- with a minimum, so there is time to decide), a cadence that does not fit the listing's sitting count,
-- fixed dates that do not number its later sittings, sittings out of order or overlapping · PS409 a
-- cohort already taking bookings, or a sitting that is not free on the provider's calendar.
CREATE OR REPLACE FUNCTION projects.open_cohort(
    p_listing uuid,
    p_first_start timestamptz,
    p_cadence text DEFAULT NULL,
    p_later_starts timestamptz[] DEFAULT NULL,
    p_max_seats integer DEFAULT NULL,
    p_min_seats integer DEFAULT NULL,
    p_enrolment_closes_at timestamptz DEFAULT NULL,
    p_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_listing catalogue.listings;
    v_bp marketplace.service_blueprints;
    v_count integer;
    v_minutes integer;
    v_max integer;
    v_close timestamptz;
    v_name text;
    v_later integer := COALESCE(pg_catalog.cardinality(p_later_starts), 0);
    v_step integer;
    v_tz text;
    v_eng record;
    v_cohort projects.cohorts;
    v_starts timestamptz[];
    v_prev_end timestamptz;
    v_plan_title text;
    v_title text;
    v_sittings jsonb := '[]'::jsonb;
    k integer;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to open a cohort' USING ERRCODE = '42501';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);
    IF NOT COALESCE(catalogue.fn_manages_listing(p_listing), false) THEN
        RAISE EXCEPTION 'No such listing' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_listing FROM catalogue.listings WHERE id = p_listing;
    SELECT * INTO v_bp FROM marketplace.service_blueprints WHERE id = v_listing.service_blueprint_id;
    IF v_bp.id IS NULL OR v_bp.delivery_model <> 'group_session'::marketplace.service_delivery_model THEN
        RAISE EXCEPTION 'Only a group session opens cohorts' USING ERRCODE = 'PU422';
    END IF;
    IF v_listing.status = 'archived'::catalogue.listing_status THEN
        RAISE EXCEPTION 'This listing is archived — restore it to open a cohort' USING ERRCODE = 'PU422';
    END IF;
    IF v_bp.group_schedule_mode = 'rolling_templates' THEN
        RAISE EXCEPTION 'This listing opens its cohorts from its weekly session times — switch it to fixed cohorts to open one by hand'
            USING ERRCODE = 'PU422';
    END IF;

    v_count := COALESCE(v_bp.session_count, 1);
    v_minutes := COALESCE(v_bp.session_minutes, 60);
    v_max := COALESCE(p_max_seats, v_bp.max_seats_per_cohort);
    IF v_max IS NULL OR v_max < 1 OR v_max > 500 THEN
        RAISE EXCEPTION 'A cohort seats between 1 and 500 people' USING ERRCODE = '22023';
    END IF;
    IF p_min_seats IS NOT NULL AND (p_min_seats < 1 OR p_min_seats > v_max) THEN
        RAISE EXCEPTION 'The minimum is between 1 seat and the cohort''s size (%)', v_max USING ERRCODE = '22023';
    END IF;
    IF p_first_start IS NULL OR p_first_start <= pg_catalog.now() THEN
        RAISE EXCEPTION 'Pick a first session that is still ahead' USING ERRCODE = '22023';
    END IF;
    v_close := COALESCE(p_enrolment_closes_at, p_first_start);
    IF v_close <= pg_catalog.now() OR v_close > p_first_start THEN
        RAISE EXCEPTION 'Enrolment has to close after now and no later than the first session' USING ERRCODE = '22023';
    END IF;
    IF p_min_seats IS NOT NULL AND v_close >= p_first_start THEN
        RAISE EXCEPTION 'With a minimum, enrolment has to close before the first session, so there is time to decide whether it runs'
            USING ERRCODE = '22023';
    END IF;
    v_name := pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_name, '')), ''), v_bp.title), 200);

    IF v_count = 1 THEN
        IF p_cadence IS NOT NULL OR v_later > 0 THEN
            RAISE EXCEPTION 'This listing is a single session — it has no cadence' USING ERRCODE = '22023';
        END IF;
    ELSIF p_cadence IS NULL OR p_cadence NOT IN ('weekly', 'fortnightly', 'fixed') THEN
        RAISE EXCEPTION 'Choose weekly, fortnightly or fixed dates for the % sessions', v_count USING ERRCODE = '22023';
    ELSIF p_cadence = 'fixed' AND v_later <> v_count - 1 THEN
        RAISE EXCEPTION 'Pick a date for each of the % later sessions', v_count - 1 USING ERRCODE = '22023';
    ELSIF p_cadence <> 'fixed' AND v_later > 0 THEN
        RAISE EXCEPTION 'Dates of your own go with the fixed cadence' USING ERRCODE = '22023';
    END IF;

    -- The listing's engagement, and its lock for the rest of the transaction: two opens queue here.
    SELECT * INTO v_eng FROM projects.fn_session_engagement_for(v_bp.id, 'group');
    IF EXISTS (
        SELECT 1
          FROM projects.cohorts c
          JOIN projects.projects p ON p.id = c.project_id
         WHERE p.source_blueprint_id = v_bp.id
           AND p.format = 'session'::public.project_format
           AND c.status = 'enrolling'::projects.cohort_status
           AND (c.enrolment_closes_at IS NULL OR c.enrolment_closes_at > pg_catalog.now())
    ) THEN
        RAISE EXCEPTION 'This listing already has a cohort taking bookings — cancel it, or wait for its enrolment to close, before opening the next'
            USING ERRCODE = 'PS409';
    END IF;

    v_starts := ARRAY[p_first_start];
    IF p_cadence = 'fixed' THEN
        v_starts := v_starts || p_later_starts;
    ELSIF p_cadence IN ('weekly', 'fortnightly') THEN
        v_step := CASE p_cadence WHEN 'weekly' THEN 7 ELSE 14 END;
        v_tz := COALESCE((SELECT s.timezone FROM scheduling.schedules s
                           WHERE s.id = projects.fn_session_host_schedule(v_eng.o_project_id)), 'UTC');
        FOR k IN 1 .. v_count - 1 LOOP
            v_starts := v_starts || (((p_first_start AT TIME ZONE v_tz)
                + pg_catalog.make_interval(days => v_step * k)) AT TIME ZONE v_tz);
        END LOOP;
    END IF;

    INSERT INTO projects.cohorts (
        project_id, project_stage_id, name, max_seats, status, min_seats, enrolment_closes_at, cadence, opened_by
    ) VALUES (
        v_eng.o_project_id, v_eng.o_stage_id, v_name, v_max, 'enrolling'::projects.cohort_status,
        p_min_seats, v_close, CASE WHEN v_count > 1 THEN p_cadence END, v_uid
    )
    RETURNING * INTO v_cohort;

    FOR k IN 1 .. v_count LOOP
        IF v_starts[k] IS NULL OR (k > 1 AND v_starts[k] < v_prev_end) THEN
            RAISE EXCEPTION 'Each session has to start after the one before it ends' USING ERRCODE = '22023';
        END IF;
        v_plan_title := CASE WHEN pg_catalog.jsonb_typeof(v_bp.session_plan -> (k - 1)) = 'object'
                             THEN NULLIF(pg_catalog.btrim(COALESCE(v_bp.session_plan -> (k - 1) ->> 'title', '')), '') END;
        v_title := pg_catalog.left(CASE
            WHEN v_count = 1 THEN COALESCE(v_name || ' — ' || v_plan_title, v_name)
            WHEN v_plan_title IS NOT NULL THEN pg_catalog.format('%s — session %s of %s: %s', v_name, k, v_count, v_plan_title)
            ELSE pg_catalog.format('%s — session %s of %s', v_name, k, v_count) END, 200);
        v_sittings := v_sittings || projects.fn_write_group_sitting(
            v_cohort.id, v_title, v_starts[k], v_starts[k] + pg_catalog.make_interval(mins => v_minutes));
        v_prev_end := v_starts[k] + pg_catalog.make_interval(mins => v_minutes);
    END LOOP;
    PERFORM projects.fn_sync_sitting_mirrors(v_cohort.id);

    RETURN pg_catalog.jsonb_build_object(
        'cohort_id', v_cohort.id,
        'name', v_cohort.name,
        'status', v_cohort.status,
        'max_seats', v_cohort.max_seats,
        'min_seats', v_cohort.min_seats,
        'enrolment_closes_at', v_cohort.enrolment_closes_at,
        'cadence', v_cohort.cadence,
        'project_slug', (SELECT p.slug FROM projects.projects p WHERE p.id = v_eng.o_project_id),
        'sittings', v_sittings
    );
END;
$$;

COMMENT ON FUNCTION projects.open_cohort(uuid, timestamptz, text, timestamptz[], integer, integer, timestamptz, text) IS
'The seller''s door for opening a cohort on a group-session listing they manage (Decision #498): one
enrolling cohort with the listing''s session_count sittings (first, then weekly / fortnightly in the
provider''s zone, or fixed dates), a capacity, an optional minimum and an enrolment close at or before
the first sitting; each sitting through fn_write_group_sitting. The waitlist job invites on its next
tick. Refusals: 42501 · PM403 · P0002 · PU422 · 22023 · PS409 one already enrolling / calendar clash.';

-- The seller cancels a whole group cohort before its first sitting starts. Under the cohort's row lock
-- (the lock reserve_seat and fn_confirm_seat take, so nobody is seated while it runs) it: closes the
-- cohort (`cancelled`, with its reason); refunds every held seat escrow in full to its payer
-- (finance.fn_refund_seat_escrow — the provider-cancel row of PRODUCT_SPEC §Session-Based C); cancels
-- the seats, their reminders, the sittings and their calendar mirrors; releases every live hold; puts
-- each invited place back to waiting where it stood and reopens each refunded seat-holder's converted
-- place at its original queue time; and tells the seat-holders (`session.cancelled`) and everyone left
-- waiting (`waitlist.cohort_cancelled`). `under_filled` when the close has passed with fewer paid seats
-- than the minimum, `provider` for any other cancel.
--
-- Refusals: 42501 signed out, or not a seller who manages the listing · P0002 no such cohort · PU422 a
-- 1-1 booking's cohort (it is cancelled seat by seat) · PS409 the cohort has already ended, or its
-- first sitting has started (its seats are then cancelled one by one).
CREATE OR REPLACE FUNCTION projects.cancel_cohort(p_cohort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_cohort projects.cohorts;
    v_project projects.projects;
    v_listing uuid;
    v_slug text;
    v_title text;
    v_first timestamptz;
    v_paid integer;
    v_reason text;
    m record;
    e record;
    v_wait record;
    v_member_refund bigint;
    v_refunded bigint := 0;
    v_seats integer := 0;
    v_currency text;
    v_restored integer := 0;
    v_rows integer;
    v_told integer := 0;
    v_place_back boolean;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to cancel a cohort' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_cohort FROM projects.cohorts WHERE id = p_cohort_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That cohort no longer exists' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_project FROM projects.projects WHERE id = v_cohort.project_id;
    SELECT l.id INTO v_listing
      FROM catalogue.listings l
     WHERE l.service_blueprint_id = v_project.source_blueprint_id
     ORDER BY l.created_at
     LIMIT 1;
    IF v_listing IS NULL OR NOT COALESCE(catalogue.fn_manages_listing(v_listing), false) THEN
        RAISE EXCEPTION 'Only the listing''s seller can cancel its cohort' USING ERRCODE = '42501';
    END IF;
    IF v_project.session_kind <> 'group' THEN
        RAISE EXCEPTION 'A 1-1 booking is cancelled seat by seat, not as a cohort' USING ERRCODE = 'PU422';
    END IF;
    IF v_cohort.status NOT IN ('enrolling', 'active') THEN
        RAISE EXCEPTION 'This cohort has already ended' USING ERRCODE = 'PS409';
    END IF;
    SELECT min(se.start_time) INTO v_first
      FROM projects.session_events se
     WHERE se.cohort_id = v_cohort.id AND se.status IN ('scheduled', 'completed');
    IF v_first IS NOT NULL AND v_first <= pg_catalog.now() THEN
        RAISE EXCEPTION 'This cohort''s first session has started — cancel its seats one by one instead'
            USING ERRCODE = 'PS409';
    END IF;

    SELECT COALESCE(sum(cm.seats), 0)::integer INTO v_paid
      FROM projects.cohort_memberships cm
     WHERE cm.cohort_id = v_cohort.id AND cm.status = 'active';
    v_reason := CASE
        WHEN v_cohort.min_seats IS NOT NULL
         AND v_cohort.enrolment_closes_at IS NOT NULL
         AND v_cohort.enrolment_closes_at <= pg_catalog.now()
         AND v_paid < v_cohort.min_seats THEN 'under_filled'
        ELSE 'provider'
    END;
    SELECT sb.slug, sb.title INTO v_slug, v_title
      FROM marketplace.service_blueprints sb WHERE sb.id = v_project.source_blueprint_id;

    UPDATE projects.cohorts
       SET status = 'cancelled'::projects.cohort_status, cancelled_at = pg_catalog.now(), cancel_reason = v_reason
     WHERE id = v_cohort.id;

    FOR m IN
        SELECT cm.id, cm.user_id, cm.seats, cm.joined_at
          FROM projects.cohort_memberships cm
         WHERE cm.cohort_id = v_cohort.id AND cm.status = 'active'
         ORDER BY cm.joined_at, cm.id
           FOR UPDATE
    LOOP
        v_member_refund := 0;
        FOR e IN
            SELECT es.id, es.currency
              FROM finance.escrows es
             WHERE es.cohort_membership_id = m.id AND es.status = 'held'
             ORDER BY es.created_at, es.id
               FOR UPDATE
        LOOP
            v_member_refund := v_member_refund + finance.fn_refund_seat_escrow(e.id);
            v_currency := e.currency;
        END LOOP;
        v_refunded := v_refunded + v_member_refund;
        v_seats := v_seats + m.seats;

        UPDATE projects.cohort_memberships
           SET status = 'cancelled', cancelled_at = pg_catalog.now()
         WHERE id = m.id;
        PERFORM comms.fn_cancel_queued(q.dedupe_key)
           FROM comms.notification_queue q
          WHERE q.status = 'scheduled'
            AND q.user_id = m.user_id
            AND q.entity_table = 'projects.session_events'
            AND q.entity_id IN (SELECT se.id FROM projects.session_events se WHERE se.cohort_id = v_cohort.id);

        -- The place their purchase converted reopens where it stood (fn_confirm_seat resolved it in
        -- the same transaction that seated them, so an older conversion is left alone).
        UPDATE projects.waitlists w
           SET status = 'waiting'::projects.waitlist_status, cohort_id = NULL, hold_id = NULL,
               invited_at = NULL, invite_expires_at = NULL, resolved_at = NULL
         WHERE w.service_blueprint_id = v_project.source_blueprint_id
           AND w.user_id = m.user_id
           AND w.status = 'converted'::projects.waitlist_status
           AND w.resolved_at >= m.joined_at;
        v_place_back := FOUND;
        IF v_place_back THEN
            v_restored := v_restored + 1;
        END IF;

        PERFORM comms.fn_notify(
            m.user_id, 'session.cancelled', 'Your cohort was cancelled',
            CASE WHEN v_reason = 'under_filled'
                 THEN pg_catalog.format('"%s" didn''t reach its minimum of %s seats by the time enrolment closed, so the seller cancelled it. Your seat was refunded in full.', v_cohort.name, v_cohort.min_seats)
                 ELSE pg_catalog.format('The seller cancelled "%s" before it started. Your seat was refunded in full.', v_cohort.name)
            END || CASE WHEN v_place_back THEN ' You''re back on its waitlist, in your place.' ELSE '' END,
            'projects.cohort_memberships', m.id,
            pg_catalog.jsonb_build_object('outcome', 'refunded', 'reason', v_reason, 'refunded_minor', v_member_refund,
                'currency', v_currency, 'waitlist_restored', v_place_back),
            v_uid, 'project', v_project.id, NULL, '/view/' || v_slug
        );
    END LOOP;

    -- Every invite on this cohort goes back to waiting where it stood, its held seat released.
    UPDATE projects.waitlists
       SET status = 'waiting'::projects.waitlist_status, cohort_id = NULL, hold_id = NULL,
           invited_at = NULL, invite_expires_at = NULL
     WHERE cohort_id = v_cohort.id AND status = 'invited'::projects.waitlist_status;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_restored := v_restored + v_rows;
    UPDATE projects.cohort_seat_holds
       SET status = 'released', updated_at = pg_catalog.now()
     WHERE cohort_id = v_cohort.id AND status = 'held';

    PERFORM projects.fn_cancel_cohort_sittings(v_cohort.id);

    -- The queue is told; a refunded seat-holder has had their own notice above.
    FOR v_wait IN
        SELECT wl.id, wl.user_id
          FROM projects.waitlists wl
         WHERE wl.service_blueprint_id = v_project.source_blueprint_id
           AND wl.status = 'waiting'::projects.waitlist_status
           AND NOT EXISTS (SELECT 1 FROM projects.cohort_memberships cm
                            WHERE cm.cohort_id = v_cohort.id AND cm.user_id = wl.user_id)
         ORDER BY wl.queued_at, wl.id
    LOOP
        PERFORM comms.fn_notify(
            v_wait.user_id, 'waitlist.cohort_cancelled', 'A cohort you''re waiting for was cancelled',
            pg_catalog.format('A cohort of "%s" was cancelled before it started. You keep your place on its waitlist, and you''ll be offered a seat when the seller opens the next one.', v_title),
            'projects.waitlists', v_wait.id,
            pg_catalog.jsonb_build_object('listing', v_slug, 'cohort_id', v_cohort.id, 'reason', v_reason),
            v_uid, p_action_url => '/view/' || v_slug
        );
        v_told := v_told + 1;
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'cohort_id', v_cohort.id,
        'status', 'cancelled',
        'reason', v_reason,
        'seats_refunded', v_seats,
        'refunded_minor', v_refunded,
        'currency', v_currency,
        'places_restored', v_restored,
        'waitlist_told', v_told
    );
END;
$$;

COMMENT ON FUNCTION projects.cancel_cohort(uuid) IS
'The seller''s door for cancelling a whole group cohort before its first sitting (Decision #498): every
held seat escrow refunded in full (fn_refund_seat_escrow), seats, sittings, mirrors and reminders
cancelled, holds released, invited and refunded places back to waiting where they stood, seat-holders and
the queue told. Reason under_filled (close passed below the minimum) or provider. Refusals: 42501 ·
P0002 · PU422 a 1-1 cohort · PS409 ended / started.';

-- The seller's view of a group-session listing's cohorts: what the listing's opening form needs (its
-- sitting count and length, its cohort size), and its cohorts — enrolling and running first, then the
-- last 90 days' cancelled and completed — each with its terms, paid and held seats, sittings, and two
-- answers the island must not compute: `phase` (enrolling · closed · running · cancelled · completed;
-- `closed` once the close has passed, before the sweep writes it) and `can_cancel`. `under_filled`:
-- the close has passed with fewer paid seats than the minimum. Answers only to whoever manages the
-- listing (catalogue.fn_manages_listing); anyone else is told it does not exist (P0002); PU422 a
-- listing that is not a group session.
CREATE OR REPLACE FUNCTION projects.get_listing_cohorts(p_listing uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bp marketplace.service_blueprints;
BEGIN
    IF NOT COALESCE(catalogue.fn_manages_listing(p_listing), false) THEN
        RAISE EXCEPTION 'No such listing' USING ERRCODE = 'P0002';
    END IF;
    SELECT sb.* INTO v_bp
      FROM catalogue.listings l
      JOIN marketplace.service_blueprints sb ON sb.id = l.service_blueprint_id
     WHERE l.id = p_listing;
    IF v_bp.id IS NULL OR v_bp.delivery_model <> 'group_session'::marketplace.service_delivery_model THEN
        RAISE EXCEPTION 'Only a group session has cohorts' USING ERRCODE = 'PU422';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'session_count', COALESCE(v_bp.session_count, 1),
        'session_minutes', COALESCE(v_bp.session_minutes, 60),
        'cohort_size', v_bp.max_seats_per_cohort,
        -- How its cohorts are opened, and the weekly templates a rolling listing runs on (SC11).
        'schedule_mode', v_bp.group_schedule_mode,
        'weekly_templates', CASE WHEN pg_catalog.jsonb_typeof(v_bp.session_template_rules -> 'weekly') = 'array'
                                 THEN v_bp.session_template_rules -> 'weekly' ELSE '[]'::jsonb END,
        'timezone', projects.fn_blueprint_timezone(v_bp.id),
        'horizon_weeks', projects.fn_session_param('rolling_horizon_weeks', 4),
        'cohorts', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'cohort_id', x.id,
                       'name', x.name,
                       'status', x.status,
                       'phase', x.phase,
                       'max_seats', x.max_seats,
                       'min_seats', x.min_seats,
                       'seats_paid', x.seats_paid,
                       'seats_held', x.seats_held,
                       'enrolment_closes_at', x.enrolment_closes_at,
                       'cadence', x.cadence,
                       'first_start', x.first_start,
                       'last_end', x.last_end,
                       'under_filled', x.min_seats IS NOT NULL AND x.enrolment_closes_at <= pg_catalog.now()
                                       AND x.seats_paid < x.min_seats AND x.phase IN ('closed', 'enrolling'),
                       'can_cancel', x.status IN ('enrolling', 'active')
                                     AND (x.first_start IS NULL OR x.first_start > pg_catalog.now()),
                       'cancel_reason', x.cancel_reason,
                       'cancelled_at', x.cancelled_at,
                       'project_slug', x.project_slug,
                       'generated', x.chain_start IS NOT NULL,
                       'sittings', x.sittings
                   ) ORDER BY x.band, x.first_start NULLS LAST, x.created_at)
              FROM (
                  SELECT c.id, c.name, c.status, c.max_seats, c.min_seats, c.enrolment_closes_at, c.cadence,
                         c.cancel_reason, c.cancelled_at, c.created_at, c.chain_start, p.slug AS project_slug,
                         f.first_start, f.last_end,
                         CASE
                             WHEN c.status = 'cancelled' THEN 'cancelled'
                             WHEN c.status = 'completed' THEN 'completed'
                             WHEN f.first_start IS NOT NULL AND f.first_start <= pg_catalog.now() THEN 'running'
                             WHEN c.status = 'active' OR c.enrolment_closes_at <= pg_catalog.now() THEN 'closed'
                             ELSE 'enrolling'
                         END AS phase,
                         CASE WHEN c.status IN ('enrolling', 'active') THEN 0 ELSE 1 END AS band,
                         COALESCE((SELECT sum(cm.seats) FROM projects.cohort_memberships cm
                                    WHERE cm.cohort_id = c.id AND cm.status = 'active'), 0)::integer AS seats_paid,
                         COALESCE((SELECT sum(h.seats) FROM projects.cohort_seat_holds h
                                    WHERE h.cohort_id = c.id AND h.status = 'held'
                                      AND h.expires_at > pg_catalog.now()), 0)::integer AS seats_held,
                         COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                       'sitting_id', se.id, 'slug', se.slug, 'title', se.title,
                                       'starts_at', se.start_time, 'ends_at', se.end_time, 'status', se.status
                                   ) ORDER BY se.start_time)
                                     FROM projects.session_events se WHERE se.cohort_id = c.id), '[]'::jsonb) AS sittings
                    FROM projects.cohorts c
                    JOIN projects.projects p ON p.id = c.project_id
                    LEFT JOIN LATERAL (
                        SELECT min(se.start_time) FILTER (WHERE se.status IN ('scheduled', 'completed')) AS first_start,
                               max(se.end_time) FILTER (WHERE se.status IN ('scheduled', 'completed')) AS last_end
                          FROM projects.session_events se WHERE se.cohort_id = c.id
                    ) f ON true
                   WHERE p.source_blueprint_id = v_bp.id
                     AND p.format = 'session'::public.project_format
                     AND p.session_kind = 'group'
                     AND (c.status IN ('enrolling', 'active')
                          OR COALESCE(c.cancelled_at, c.created_at) > pg_catalog.now() - INTERVAL '90 days')
                     -- A generated chain that closed empty was never anyone's: it is not listed (SC11).
                     AND NOT (c.chain_start IS NOT NULL AND c.status = 'cancelled' AND c.cancel_reason = 'under_filled')
                   ORDER BY CASE WHEN c.status IN ('enrolling', 'active') THEN 0 ELSE 1 END, f.first_start NULLS LAST
                   LIMIT 20
              ) x
        ), '[]'::jsonb)
    );
END;
$$;

COMMENT ON FUNCTION projects.get_listing_cohorts(uuid) IS
'A group-session listing''s cohorts for whoever manages it (Decision #498): the opening form''s facts
(session_count, session_minutes, cohort_size) and each cohort''s terms, paid and held seats, sittings,
phase, under_filled and can_cancel. Refusals: P0002 not a listing the caller manages · PU422 not a group
session.';

-- The enrolment sweep, run at the head of the waitlist job (fn_waitlist_dispatch, every minute): each
-- enrolling cohort whose close has passed becomes `active`. Its live holds are released, and an invite
-- it held goes back to waiting where it stood rather than expiring, because the cohort closed under it,
-- not the buyer's hold. A cohort that closed below its minimum tells its seller they may cancel it
-- (`session.cohort_under_filled`). The close already binds by its instant — every door refuses a seat
-- from then on — so a stalled sweep only delays the status. Internal; answers how many closed.
CREATE OR REPLACE FUNCTION projects.fn_close_cohort_enrolment(p_now timestamptz DEFAULT pg_catalog.now())
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r record;
    v_paid integer;
    v_listing_slug text;
    v_closed integer := 0;
BEGIN
    FOR r IN
        SELECT c.id, c.name, c.min_seats, c.project_id, c.chain_start, p.owner_user_id, p.source_blueprint_id
          FROM projects.cohorts c
          JOIN projects.projects p ON p.id = c.project_id
         WHERE c.status = 'enrolling'::projects.cohort_status
           AND c.enrolment_closes_at IS NOT NULL
           AND c.enrolment_closes_at <= p_now
         ORDER BY c.enrolment_closes_at, c.id
           FOR UPDATE OF c SKIP LOCKED
    LOOP
        UPDATE projects.cohorts SET status = 'active'::projects.cohort_status WHERE id = r.id;
        UPDATE projects.waitlists
           SET status = 'waiting'::projects.waitlist_status, cohort_id = NULL, hold_id = NULL,
               invited_at = NULL, invite_expires_at = NULL
         WHERE cohort_id = r.id AND status = 'invited'::projects.waitlist_status;
        UPDATE projects.cohort_seat_holds
           SET status = 'released', updated_at = pg_catalog.now()
         WHERE cohort_id = r.id AND status = 'held';
        v_closed := v_closed + 1;

        -- A generated chain that closed with no paid seat holds no money and no one: it is cancelled
        -- quietly and its sittings leave the seller's calendar (SC11 ruling 3). A chain with a seat runs.
        IF r.chain_start IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM projects.cohort_memberships cm
             WHERE cm.cohort_id = r.id AND cm.status <> 'cancelled'
        ) THEN
            UPDATE projects.cohorts
               SET status = 'cancelled'::projects.cohort_status, cancelled_at = p_now, cancel_reason = 'under_filled'
             WHERE id = r.id;
            PERFORM projects.fn_cancel_cohort_sittings(r.id);
            CONTINUE;
        END IF;

        IF r.min_seats IS NOT NULL THEN
            SELECT COALESCE(sum(cm.seats), 0)::integer INTO v_paid
              FROM projects.cohort_memberships cm
             WHERE cm.cohort_id = r.id AND cm.status = 'active';
            IF v_paid < r.min_seats THEN
                SELECT sb.slug INTO v_listing_slug
                  FROM marketplace.service_blueprints sb
                 WHERE sb.id = r.source_blueprint_id;
                PERFORM comms.fn_notify(
                    r.owner_user_id, 'session.cohort_under_filled', 'Your cohort is under its minimum',
                    pg_catalog.format('Enrolment for "%s" closed with %s of the %s seats it needs. You can cancel it before its first session, and every seat is refunded in full, or run it as it is.',
                        r.name, v_paid, r.min_seats),
                    'projects.cohorts', r.id,
                    pg_catalog.jsonb_build_object('seats_paid', v_paid, 'min_seats', r.min_seats),
                    NULL, 'project', r.project_id, NULL,
                    '/catalogue/' || v_listing_slug || '?tab=edit&section=availability'
                );
            END IF;
        END IF;
    END LOOP;
    RETURN v_closed;
END;
$$;
-- #endregion

-- #region 5. Cancel a seat — the late-cancel rule
-- PRODUCT_SPEC §Session-Based C ("The 24-Hour Rule"), applied to the cohort's FIRST sitting:
--   * the provider cancels (any time)          → full refund to the attendee;
--   * the attendee cancels > notice before it   → full refund;
--   * the attendee cancels inside the notice, or after the cohort has started → full FORFEIT: the
--     escrow is released to the provider (Time Protection). There is no 50% split (Decision #171
--     retires the stale figure in flows/Projects.md §6.2 and finance-model.md §4). A forfeit of an
--     escrow with an open dispute is refused (PD409 `dispute_open`, finance.fn_assert_no_open_dispute):
--     the ruling settles it (FINANCE_AUDIT L9).
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
            PERFORM finance.fn_assert_no_open_dispute(e.id);
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
            PERFORM comms.fn_cancel_queued(NULL, 'projects.session_events', e.session_event_id);
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
    -- Their reminders for the rest of the cohort stop with their seat.
    PERFORM comms.fn_cancel_queued(q.dedupe_key)
       FROM comms.notification_queue q
      WHERE q.status = 'scheduled'
        AND q.user_id = v_m.user_id
        AND q.entity_table = 'projects.session_events'
        AND q.entity_id IN (SELECT se.id FROM projects.session_events se WHERE se.cohort_id = v_cohort.id);
    IF v_per_sitting THEN
        UPDATE projects.cohorts SET status = 'cancelled'::projects.cohort_status
         WHERE id = v_cohort.id AND max_seats = 1 AND status IN ('enrolling', 'active');
    ELSE
        PERFORM projects.fn_sync_sitting_mirrors(v_cohort.id);
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

-- #region 5b. Who a sitting's seat belongs to
-- Whether a person holds a seat on THIS sitting: an uncancelled membership, or a cancelled block's
-- sitting that already started and whose escrow is still held for them. Keying on the membership
-- alone stripped such a sitting of its no-show protection the moment the block was cancelled, and
-- the money then released (audit S-09).
CREATE OR REPLACE FUNCTION projects.fn_seated_on(p_event_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM projects.session_events se
          JOIN projects.cohort_memberships cm ON cm.cohort_id = se.cohort_id AND cm.user_id = p_user
         WHERE se.id = p_event_id
           AND (
               cm.status <> 'cancelled'
               OR EXISTS (
                   SELECT 1 FROM finance.escrows e
                    WHERE e.cohort_membership_id = cm.id AND e.session_event_id = se.id AND e.status = 'held'
               )
           )
    );
$$;
-- #endregion

-- #region 7. The 15-minute rule
-- PRODUCT_SPEC §Session-Based B: a sitting is Successful only if BOTH the provider and the attendee(s)
-- were in the room within its first `session_presence_minutes` (15). The outcome:
--   pending          the window has not closed yet
--   untracked        the room reports no presence (no provider room, or no webhook row at all — a
--                    silent webhook is not evidence that nobody came), or the host was in the room,
--                    and an attendee who pressed join in time is not in it, in a room that does not
--                    let them in by themselves: they may have been left outside, and no record says
--                    which (Decision #392)
--   successful       the host and at least one seated attendee joined in the window, or an attendee
--                    answered that a sitting with no evidence happened (Decision #383, ruling R6)
--   provider_no_show the host was not there, and an attendee was: seen in the room, even late, or
--                    pressing join in Projective with the provider's own record read back and
--                    showing no host (Decision #383, ruling R5). A knock or a lobby changes nothing
--                    here: the press and the read are enough, with no record of them in the room
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
    v_came boolean;
    v_clicked boolean;
    v_reconciled boolean;
    v_registers boolean;
    v_confirmed boolean;
BEGIN
    SELECT * INTO v_event FROM projects.session_events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT c.project_id INTO v_project FROM projects.cohorts c WHERE c.id = v_event.cohort_id;
    v_window_end := v_event.start_time + pg_catalog.make_interval(
        mins => projects.fn_session_param('session_presence_minutes', 15));

    v_tracked := v_event.provider_meeting_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM projects.session_attendance a
         WHERE a.session_event_id = v_event.id AND a.source IN ('webhook', 'webhook_email')
    );
    SELECT EXISTS (
        SELECT 1 FROM projects.session_attendance a
        WHERE a.session_event_id = v_event.id AND a.joined_at <= v_window_end
          AND projects.fn_is_session_host(v_project, a.user_id)
    ) INTO v_host;
    SELECT count(*) INTO v_seated FROM projects.cohort_memberships cm
     WHERE cm.cohort_id = v_event.cohort_id AND projects.fn_seated_on(v_event.id, cm.user_id);
    SELECT count(*) INTO v_present
      FROM projects.cohort_memberships cm
      JOIN projects.session_attendance a ON a.session_event_id = v_event.id AND a.user_id = cm.user_id
     WHERE cm.cohort_id = v_event.cohort_id AND projects.fn_seated_on(v_event.id, cm.user_id)
       AND a.joined_at <= v_window_end;
    -- Evidence an attendee came even if late, for the host-absent outcome (audit S-08).
    SELECT EXISTS (
        SELECT 1 FROM projects.cohort_memberships cm
          JOIN projects.session_attendance a ON a.session_event_id = v_event.id AND a.user_id = cm.user_id
         WHERE cm.cohort_id = v_event.cohort_id AND projects.fn_seated_on(v_event.id, cm.user_id)
    ) INTO v_came;
    -- An attendee who answered that it happened speaks against their own money (ruling R6).
    SELECT EXISTS (
        SELECT 1 FROM projects.session_attendance a
         WHERE a.session_event_id = v_event.id AND a.source = 'confirmed'
    ) INTO v_confirmed;
    -- A first-party join inside the window, and whether the provider's own record has been read. Both
    -- together are what proves a host never came when the room reported nothing (ruling R5). A room
    -- that registers people lets an approved attendee in by themselves; in any other, the host decides
    -- who comes in (Decision #392). This reads what the room is, never whether a provider confirmed a
    -- setting, because an answer we have not seen on a live account must not decide money.
    SELECT EXISTS (
               SELECT 1 FROM scheduling.presence_events p
                 JOIN projects.cohort_memberships cm ON cm.user_id = p.user_id AND cm.cohort_id = v_event.cohort_id
                WHERE p.room_id = r.id AND p.action = 'join_click' AND p.occurred_at <= v_window_end
           ),
           r.reconciled_at IS NOT NULL,
           r.registration
      INTO v_clicked, v_reconciled, v_registers
      FROM scheduling.rooms r
     WHERE r.session_event_id = v_event.id;

    RETURN pg_catalog.jsonb_build_object(
        'event_id', v_event.id,
        'window_ends_at', v_window_end,
        'tracked', v_tracked,
        'host_present', v_host,
        'attendees_present', v_present,
        'attendees_seated', v_seated,
        'outcome', CASE
            WHEN pg_catalog.now() < v_window_end THEN 'pending'
            WHEN v_confirmed THEN 'successful'
            WHEN NOT v_tracked AND NOT (COALESCE(v_clicked, false) AND COALESCE(v_reconciled, false)) THEN 'untracked'
            WHEN v_host AND v_present > 0 THEN 'successful'
            -- Not a no-show either way. A host must not collect on a sitting they kept somebody out of.
            WHEN v_host AND COALESCE(v_clicked, false) AND NOT COALESCE(v_registers, false) THEN 'untracked'
            WHEN v_host THEN 'attendee_no_show'
            WHEN v_came OR COALESCE(v_clicked, false) THEN 'provider_no_show'
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
     WHERE cm.cohort_id = v_event.cohort_id AND cm.user_id = v_uid
       AND (e.session_event_id = v_event.id OR (e.session_event_id IS NULL AND cm.status = 'active'))
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

-- #region 9b. The attendee's answer on a sitting with no evidence (Decision #383, ruling R6)
-- A sitting the room reported nothing about does not pay out on negative consent (ruling C5 (a)), so
-- its attendee is asked. A yes is recorded as evidence and the sweep releases it on its next run: the
-- sweep stays the only thing that moves this money. A no is an ordinary no-show claim. Only the
-- attendee answers: a host's own word is not evidence.
CREATE OR REPLACE FUNCTION projects.answer_session_review(p_event_id uuid, p_happened boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_event projects.session_events;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to answer' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_event FROM projects.session_events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That sitting no longer exists' USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM projects.cohort_memberships cm
          JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status = 'held'
         WHERE cm.cohort_id = v_event.cohort_id AND cm.user_id = v_uid
           AND (e.session_event_id = v_event.id OR (e.session_event_id IS NULL AND cm.status = 'active'))
    ) THEN
        RAISE EXCEPTION 'You have no held payment on this sitting' USING ERRCODE = 'PS409';
    END IF;
    IF v_event.status <> 'completed'
       OR projects.fn_session_presence(v_event.id) ->> 'outcome' <> 'untracked' THEN
        RAISE EXCEPTION 'This sitting is not waiting for your answer' USING ERRCODE = 'PS409';
    END IF;

    IF p_happened IS NOT TRUE THEN
        RETURN projects.claim_session_no_show(p_event_id, 'The attendee says this session did not happen.');
    END IF;
    INSERT INTO projects.session_attendance (session_event_id, user_id, joined_at, source)
    VALUES (v_event.id, v_uid, v_event.start_time, 'confirmed')
    ON CONFLICT (session_event_id, user_id) DO UPDATE SET source = 'confirmed';
    RETURN pg_catalog.jsonb_build_object('event_id', v_event.id, 'status', 'confirmed');
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
    ELSIF projects.fn_seated_on(p_event_id, v_uid) THEN
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
            WHERE cm.cohort_id = v_event.cohort_id AND cm.user_id = v_uid
              AND (cm.status = 'active' OR e.session_event_id = p_event_id)
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
        END,
        'room_slug', CASE WHEN v_state = 'open' THEN (
            SELECT r.slug FROM scheduling.rooms r
             WHERE r.session_event_id = p_event_id AND r.status = 'ready'
        ) END
    );
END;
$$;

-- A link the host adds themselves (Decision #383, rulings R2 and R7): allowed on a paid sitting, for a
-- host with no connected account or a room that failed. Nothing reports attendance from it, so the
-- sitting reads untracked and its payout holds for review, and nothing keeps out anybody holding it
-- (Decision #392). The host is warned of both first.
CREATE OR REPLACE FUNCTION projects.set_sitting_link(p_event_id uuid, p_url text)
RETURNS void
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
    SELECT * INTO v_event FROM projects.session_events WHERE id = p_event_id FOR UPDATE;
    IF NOT FOUND OR v_uid IS NULL THEN
        RAISE EXCEPTION 'That session no longer exists' USING ERRCODE = 'P0002';
    END IF;
    SELECT c.project_id INTO v_project FROM projects.cohorts c WHERE c.id = v_event.cohort_id;
    IF NOT projects.fn_is_session_host(v_project, v_uid) THEN
        RAISE EXCEPTION 'Only the session''s host can add its link' USING ERRCODE = '42501';
    END IF;
    IF v_event.status <> 'scheduled' OR v_event.end_time <= pg_catalog.now() THEN
        RAISE EXCEPTION 'That session has finished' USING ERRCODE = '55000';
    END IF;
    UPDATE projects.session_events
       SET attendee_join_url = p_url, host_join_url = NULL, meeting_provider = 'custom', provider_meeting_id = NULL
     WHERE id = p_event_id;
    INSERT INTO scheduling.rooms (session_event_id, provider, status)
    VALUES (p_event_id, 'custom', 'ready')
    ON CONFLICT (session_event_id) DO UPDATE
       SET provider = 'custom', status = 'ready', connection_id = NULL, provider_meeting_id = NULL,
           provider_host_id = NULL, registration = false, guarded = false, attempts = 0, last_error = NULL,
           moved_at = NULL, reconciled_at = NULL;
    UPDATE scheduling.events
       SET meeting_provider = 'custom', meeting_pending = false
     WHERE source_session_event_id = p_event_id;
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
               AND cm.user_id = v_uid
              JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status = 'held'
               AND (e.session_event_id = se.id OR (e.session_event_id IS NULL AND cm.status = 'active'))
             WHERE c.project_id = v_project.id
               AND se.status IN ('scheduled', 'completed') AND se.start_time <= pg_catalog.now()
               AND NOT finance.fn_escrow_has_open_dispute(e.id)
               AND NOT EXISTS (SELECT 1 FROM finance.disputes d
                                WHERE d.escrow_id = e.id AND d.session_event_id = se.id)
             ORDER BY se.start_time DESC
             LIMIT 1
        ) END,
        -- The sitting with no evidence this attendee has been asked about (Decision #383, ruling R6):
        -- what answer_session_review would accept. NULL for a host or anyone else.
        'reviewable_sitting_id', CASE WHEN v_role = 'attendee' THEN (
            SELECT se.id
              FROM projects.session_events se
              JOIN projects.cohorts c ON c.id = se.cohort_id
              JOIN projects.cohort_memberships cm ON cm.cohort_id = se.cohort_id AND cm.user_id = v_uid
              JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status = 'held'
               AND (e.session_event_id = se.id OR (e.session_event_id IS NULL AND cm.status = 'active'))
             WHERE c.project_id = v_project.id
               AND se.status = 'completed' AND se.review_asked_at IS NOT NULL
               AND NOT finance.fn_escrow_has_open_dispute(e.id)
               AND (projects.fn_session_presence(se.id) ->> 'outcome') = 'untracked'
             ORDER BY se.start_time
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
        -- The room's address, never the provider's link: joining goes through /meet, which records it.
        'join', CASE WHEN v_next IS NOT NULL AND v_role <> 'prospect' THEN projects.session_join_link(v_next) - 'url' END,
        -- The next sitting with no room on the way, which only a host can do something about.
        'room_wanted_sitting_id', CASE WHEN v_role = 'host' AND v_next IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM scheduling.rooms r
             WHERE r.session_event_id = v_next AND r.status IN ('pending', 'minting', 'ready')
        ) THEN v_next END,
        'reschedule', (
            SELECT pg_catalog.jsonb_build_object(
                'sitting_title', se.title, 'mode', r.mode, 'status', r.status,
                'opened_by_host', projects.fn_is_session_host(v_project.id, r.opened_by_user_id),
                'votes', (SELECT count(*) FROM scheduling.proposal_votes pv WHERE pv.reschedule_id = r.id),
                -- Who holds a vote, by the rule settlement runs (`eligibleVoterCount`): every seat with an
                -- account except the host's, optional seats included (Decision #343, ruling C6 D5).
                'voters', (SELECT count(*) FROM scheduling.event_attendees ea
                            WHERE ea.event_id = ev.id AND ea.archived_at IS NULL
                              AND ea.user_id IS NOT NULL AND ea.role <> 'host'::scheduling.attendee_role)
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
    v_hold_days integer := projects.fn_session_param('session_review_hold_days', 7);
    v_completed integer := 0;
    v_refunded integer := 0;
    v_released integer := 0;
    v_asked integer := 0;
    v_opened integer := 0;
    v_dispute uuid;
    v_sittings uuid[] := '{}';
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
           -- No evidence, no automatic release (ruling C5 (a)): step (d) takes these.
           AND (projects.fn_session_presence(se.id) ->> 'outcome') <> 'untracked'
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
           AND NOT EXISTS (SELECT 1 FROM projects.session_events se WHERE se.cohort_id = c.id
                            AND se.status = 'completed'
                            AND (projects.fn_session_presence(se.id) ->> 'outcome') = 'untracked')
    LOOP
        IF finance.fn_release_seat_escrow(r.escrow_id, 'escrow_release') > 0 THEN
            v_released := v_released + 1;
            UPDATE projects.cohort_memberships SET status = 'completed' WHERE id = r.membership_id;
            PERFORM comms.fn_notify(r.owner_user_id, 'escrow.released', 'Session payout released',
                pg_catalog.format('The payment for a seat on "%s" was released to your wallet.', r.name),
                'finance.escrows', r.escrow_id, '{}'::jsonb, NULL, 'project', r.project_id, NULL, '/projects/' || r.slug);
        END IF;
    END LOOP;

    -- (d) A sitting with no evidence (Decision #383, ruling R6). Each person holding money on it is
    -- asked once, when the review window ends. Silence for session_review_hold_days opens a case for
    -- an operator, with that person as its nominal claimant: the case stands in for the answer they
    -- did not give, and finance.disputes keeps one kind of opener.
    FOR r IN
        SELECT DISTINCT e.id AS escrow_id, se.id AS sitting_id, se.title, se.end_time, se.review_asked_at,
               cm.user_id, p.id AS project_id, p.slug
          FROM projects.session_events se
          JOIN projects.cohorts c ON c.id = se.cohort_id
          JOIN projects.projects p ON p.id = c.project_id
          JOIN projects.cohort_memberships cm ON cm.cohort_id = c.id
          JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status = 'held'
               AND (e.session_event_id = se.id OR (e.session_event_id IS NULL AND cm.status = 'active'))
         WHERE se.status = 'completed'
           AND se.end_time <= p_now - pg_catalog.make_interval(hours => v_hours)
           AND NOT finance.fn_escrow_has_open_dispute(e.id)
           AND (projects.fn_session_presence(se.id) ->> 'outcome') = 'untracked'
    LOOP
        IF r.review_asked_at IS NULL THEN
            PERFORM comms.fn_notify(r.user_id, 'session.review_requested', 'Did your session happen?',
                pg_catalog.format('We have no attendance record for "%s". Tell us whether it happened, so the payment can be settled.', r.title),
                'projects.session_events', r.sitting_id, '{}'::jsonb, NULL, 'project', r.project_id, NULL,
                '/projects/' || r.slug);
            v_sittings := v_sittings || r.sitting_id;
            v_asked := v_asked + 1;
        ELSIF r.end_time <= p_now - pg_catalog.make_interval(days => v_hold_days) THEN
            INSERT INTO finance.disputes (escrow_id, session_event_id, opened_by_profile, reason)
            VALUES (r.escrow_id, r.sitting_id, r.user_id,
                    'No attendance record, and the attendee did not say whether this session happened.')
            RETURNING id INTO v_dispute;
            PERFORM finance.fn_advance_dispute(v_dispute);
            v_opened := v_opened + 1;
        END IF;
    END LOOP;
    UPDATE projects.session_events SET review_asked_at = p_now WHERE id = ANY (v_sittings);

    UPDATE projects.cohorts c SET status = 'completed'
     WHERE c.status IN ('enrolling', 'active')
       AND EXISTS (SELECT 1 FROM projects.session_events se WHERE se.cohort_id = c.id AND se.status = 'completed')
       AND NOT EXISTS (SELECT 1 FROM projects.session_events se WHERE se.cohort_id = c.id AND se.status = 'scheduled');

    RETURN pg_catalog.jsonb_build_object(
        'completed_sittings', v_completed, 'refunded', v_refunded, 'released', v_released,
        'review_asked', v_asked, 'review_cases', v_opened
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

-- #region 15. Waitlist — invited in order, a held seat, converted or expired (Decision #455)
-- A group-session listing's queue (`projects.waitlists`, one place per buyer per listing). When its
-- enrolling cohort has a seat nobody holds, the job below invites the people waiting, first in first
-- out, one per free seat: each invite is a `cohort_seat_holds` row of one seat that lasts
-- `waitlist_invite_hold_hours` (48), so it blocks everyone else through the ordinary occupancy count and
-- reserve_seat renews it without shortening it. An invite whose hold lapses unused is `expired` and the
-- next person is invited; buying a seat makes the place `converted` (fn_confirm_seat); an expired
-- buyer may join again, at the back. Until the job reaches a freed seat, fn_cohort_seats_owed keeps it
-- from anyone outside the queue.

-- The cohort a listing's waitlist seats into: the enrolling cohort of a session engagement built from
-- the PUBLISHED blueprint whose first sitting is soonest — the cohort get_cohort_offer sells, without
-- its seller-preview arm (nobody is invited to a listing the public cannot see).
CREATE OR REPLACE FUNCTION projects.fn_waitlist_cohort(p_blueprint_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT c.id
      FROM projects.cohorts c
      JOIN projects.projects p ON p.id = c.project_id
      JOIN marketplace.service_blueprints sb ON sb.id = p.source_blueprint_id
     WHERE p.source_blueprint_id = p_blueprint_id
       AND p.format = 'session'
       AND p.status IN ('draft', 'active')
       AND c.status = 'enrolling'
       AND (c.enrolment_closes_at IS NULL OR c.enrolment_closes_at > pg_catalog.now())
       AND sb.is_published
     -- A rolling listing's queue is invited into the earliest chain with a free seat (SC11).
     ORDER BY (sb.group_schedule_mode = 'rolling_templates' AND projects.fn_cohort_seats_taken(c.id) >= c.max_seats),
              (SELECT min(se.start_time) FROM projects.session_events se
                WHERE se.cohort_id = c.id AND se.status = 'scheduled') NULLS LAST,
              c.created_at
     LIMIT 1;
$$;

-- Join a group-session listing's waitlist, or answer the place already held. A place that expired
-- (its invite lapsed unused) joins again at the back: a fresh `queued_at` and no invite. Idempotent on
-- the (listing, buyer) key. Answers {status, already}.
--
-- Refusals: 42501 signed out · PM403 under 18 · P0002 no such published listing · PU422 not a group
-- session, or the caller's own listing.
CREATE OR REPLACE FUNCTION projects.join_waitlist(p_blueprint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_bp marketplace.service_blueprints;
    v_place projects.waitlists;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to join the waitlist' USING ERRCODE = '42501';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);

    SELECT * INTO v_bp FROM marketplace.service_blueprints WHERE id = p_blueprint_id;
    IF NOT FOUND OR NOT v_bp.is_published THEN
        RAISE EXCEPTION 'That listing isn''t available' USING ERRCODE = 'P0002';
    END IF;
    IF v_bp.delivery_model <> 'group_session'::marketplace.service_delivery_model THEN
        RAISE EXCEPTION 'Only a group session has a waitlist' USING ERRCODE = 'PU422';
    END IF;
    IF v_bp.freelancer_profile_id = v_uid OR (v_bp.owner_team_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM org.team_members tm
         WHERE tm.team_id = v_bp.owner_team_id AND tm.user_id = v_uid AND tm.status = 'active'
    )) THEN
        RAISE EXCEPTION 'You can''t join the waitlist for your own listing' USING ERRCODE = 'PU422';
    END IF;

    INSERT INTO projects.waitlists (service_blueprint_id, user_id)
    VALUES (p_blueprint_id, v_uid)
    ON CONFLICT (service_blueprint_id, user_id) DO NOTHING
    RETURNING * INTO v_place;
    IF FOUND THEN
        RETURN pg_catalog.jsonb_build_object('status', v_place.status, 'already', false);
    END IF;

    UPDATE projects.waitlists
       SET status = 'waiting', queued_at = pg_catalog.now(), cohort_id = NULL, hold_id = NULL,
           invited_at = NULL, invite_expires_at = NULL, resolved_at = NULL
     WHERE service_blueprint_id = p_blueprint_id AND user_id = v_uid AND status = 'expired'
    RETURNING * INTO v_place;
    IF FOUND THEN
        RETURN pg_catalog.jsonb_build_object('status', v_place.status, 'already', false);
    END IF;

    SELECT * INTO v_place FROM projects.waitlists
     WHERE service_blueprint_id = p_blueprint_id AND user_id = v_uid;
    RETURN pg_catalog.jsonb_build_object('status', v_place.status, 'already', true);
END;
$$;

COMMENT ON FUNCTION projects.join_waitlist(uuid) IS
'Join a published group-session listing''s waitlist (Decision #455), or answer the place already held;
an expired place joins again at the back. {status, already}. Refusals: 42501 · PM403 · P0002 · PU422.';

-- The caller's own place on a listing's waitlist, or NULL when they hold none. `status` is the place as
-- it stands now: an invite whose hold has lapsed reads `expired` before the job writes it. `position`
-- is 1-based among the people waiting (NULL unless waiting); `hold_expires_at` the live invite's end;
-- `seats_open` how many seats of the listing's enrolling cohort the caller could hold right now, the
-- queue's first call counted (NULL with no enrolling cohort).
CREATE OR REPLACE FUNCTION projects.get_waitlist_place(p_blueprint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_place projects.waitlists;
    v_status projects.waitlist_status;
    v_position integer;
    v_hold_until timestamptz;
    v_cohort projects.cohorts;
    v_open integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_place FROM projects.waitlists
     WHERE service_blueprint_id = p_blueprint_id AND user_id = v_uid;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    v_status := v_place.status;
    IF v_status = 'waiting' THEN
        SELECT count(*)::integer + 1 INTO v_position
          FROM projects.waitlists w
         WHERE w.service_blueprint_id = p_blueprint_id
           AND w.status = 'waiting'
           AND (w.queued_at, w.id) < (v_place.queued_at, v_place.id);
    ELSIF v_status = 'invited' THEN
        SELECT h.expires_at INTO v_hold_until
          FROM projects.cohort_seat_holds h
         WHERE h.id = v_place.hold_id AND h.status = 'held' AND h.expires_at > pg_catalog.now();
        IF v_hold_until IS NULL THEN
            v_status := 'expired';
        END IF;
    END IF;

    SELECT * INTO v_cohort FROM projects.cohorts WHERE id = projects.fn_waitlist_cohort(p_blueprint_id);
    IF FOUND THEN
        v_open := GREATEST(v_cohort.max_seats - projects.fn_cohort_seats_taken(v_cohort.id, v_uid)
            - projects.fn_cohort_seats_owed(v_cohort.id, v_uid), 0);
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'status', v_status,
        'position', v_position,
        'hold_expires_at', v_hold_until,
        'seats_open', v_open,
        'invite_hold_hours', projects.fn_session_param('waitlist_invite_hold_hours', 48)
    );
END;
$$;

COMMENT ON FUNCTION projects.get_waitlist_place(uuid) IS
'The caller''s own place on a listing''s waitlist (Decision #455): {status, position, hold_expires_at,
seats_open, invite_hold_hours}, or NULL. A lapsed invite reads expired.';

-- The seller's view of a listing's waitlist: how many places are in each state, and the places — the
-- invited first, then the queue in order (`position` 1-based), then the converted and expired, newest
-- first. Answers only to whoever manages the listing (catalogue.fn_manages_listing: its owner, or a
-- `publish_listings` holder on the owning team); anyone else is told it does not exist. Each place
-- names the buyer by handle only, for the profile directory to dress. `p_limit` is clamped to 1–500.
CREATE OR REPLACE FUNCTION projects.get_listing_waitlist(p_listing uuid, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_blueprint uuid;
    v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
BEGIN
    IF NOT COALESCE(catalogue.fn_manages_listing(p_listing), false) THEN
        RAISE EXCEPTION 'No such listing' USING ERRCODE = 'P0002';
    END IF;
    SELECT l.service_blueprint_id INTO v_blueprint FROM catalogue.listings l WHERE l.id = p_listing;

    RETURN pg_catalog.jsonb_build_object(
        'counts', (
            SELECT pg_catalog.jsonb_build_object(
                'waiting', count(*) FILTER (WHERE w.status = 'waiting'),
                'invited', count(*) FILTER (WHERE w.status = 'invited'),
                'expired', count(*) FILTER (WHERE w.status = 'expired'),
                'converted', count(*) FILTER (WHERE w.status = 'converted'))
              FROM projects.waitlists w
             WHERE w.service_blueprint_id = v_blueprint
        ),
        'entries', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'user_id', e.user_id,
                       'handle', e.handle,
                       'status', e.status,
                       'position', e.position,
                       'queued_at', e.queued_at,
                       'invited_at', e.invited_at,
                       'invite_expires_at', e.invite_expires_at,
                       'resolved_at', e.resolved_at
                   ) ORDER BY e.band, e.open_at, e.resolved_at DESC, e.id)
              FROM (
                  SELECT w.id, w.user_id, u.username AS handle, w.status, w.queued_at, w.invited_at,
                         w.invite_expires_at, w.resolved_at,
                         CASE w.status WHEN 'invited' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END AS band,
                         CASE w.status WHEN 'invited' THEN w.invited_at WHEN 'waiting' THEN w.queued_at END AS open_at,
                         CASE WHEN w.status = 'waiting'
                              THEN pg_catalog.row_number() OVER (PARTITION BY w.status ORDER BY w.queued_at, w.id)
                         END AS position
                    FROM projects.waitlists w
                    JOIN org.users_public u ON u.user_id = w.user_id
                   WHERE w.service_blueprint_id = v_blueprint
                   ORDER BY band, open_at, resolved_at DESC, id
                   LIMIT v_limit
              ) e
        ), '[]'::jsonb)
    );
END;
$$;

COMMENT ON FUNCTION projects.get_listing_waitlist(uuid, integer) IS
'A listing''s waitlist for whoever manages it (catalogue.fn_manages_listing; Decision #455): counts per
state and the places (invited, then the queue in order, then converted and expired), by handle.
Refusals: P0002 not a listing the caller manages.';

-- The waitlist job (`cohort-waitlist-invites`, 00005060, every minute). First the enrolment sweep
-- (fn_close_cohort_enrolment, Decision #498): every cohort past its close becomes `active`, and an invite
-- it held goes back to waiting where it stood. Then every invite whose hold
-- is no longer live: a hold that converted makes the place `converted`; any other lapse makes it
-- `expired`, releases the hold and tells the buyer. Then, per listing with people waiting, under the
-- cohort row lock reserve_seat takes, one invite per seat nobody holds, in queue order: a one-seat hold
-- until `p_now + waitlist_invite_hold_hours` (never past the cohort's enrolment close), the place
-- `invited`, and an in-app notice linking to the listing. A cohort just opened (projects.open_cohort) is
-- what wakes a queue that had nothing to wait on. Someone already seated converts; someone holding a
-- live seat already is being served and is passed over; a lapsed hold being paid for right now (locked)
-- stops the listing for this run, so the order is kept. Internal — run by pg_cron, not granted. Answers
-- {closed, expired, invited}.
CREATE OR REPLACE FUNCTION projects.fn_waitlist_dispatch(p_now timestamptz DEFAULT pg_catalog.now())
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_hours integer := projects.fn_session_param('waitlist_invite_hold_hours', 48);
    v_until timestamptz := p_now + pg_catalog.make_interval(hours => v_hours);
    r record;
    v_blueprint uuid;
    v_slug text;
    v_title text;
    v_cohort projects.cohorts;
    v_free integer;
    v_hold uuid;
    v_expired integer := 0;
    v_invited integer := 0;
    v_closed integer;
    v_hold_until timestamptz;
BEGIN
    v_closed := projects.fn_close_cohort_enrolment(p_now);

    FOR r IN
        SELECT w.id, w.user_id, w.hold_id, h.status AS hold_status, sb.slug, sb.title
          FROM projects.waitlists w
          JOIN projects.cohort_seat_holds h ON h.id = w.hold_id
          JOIN marketplace.service_blueprints sb ON sb.id = w.service_blueprint_id
         WHERE w.status = 'invited'
           AND NOT (h.status = 'held' AND h.expires_at > p_now)
         ORDER BY w.invite_expires_at, w.id
           FOR UPDATE OF w, h SKIP LOCKED
    LOOP
        IF r.hold_status = 'converted' THEN
            UPDATE projects.waitlists SET status = 'converted', resolved_at = p_now WHERE id = r.id;
            CONTINUE;
        END IF;
        UPDATE projects.cohort_seat_holds
           SET status = 'released', updated_at = pg_catalog.now()
         WHERE id = r.hold_id AND status = 'held';
        UPDATE projects.waitlists SET status = 'expired', resolved_at = p_now WHERE id = r.id;
        v_expired := v_expired + 1;
        PERFORM comms.fn_notify(
            r.user_id, 'waitlist.invite_expired', 'Your held seat was released',
            pg_catalog.format('The seat held for you on "%s" has passed to the next person on the waitlist. Join the waitlist again to be offered a later one.', r.title),
            'projects.waitlists', r.id,
            pg_catalog.jsonb_build_object('listing', r.slug),
            p_action_url => '/view/' || r.slug
        );
    END LOOP;

    FOR v_blueprint IN
        SELECT DISTINCT w.service_blueprint_id FROM projects.waitlists w WHERE w.status = 'waiting'
    LOOP
        SELECT c.* INTO v_cohort
          FROM projects.cohorts c
         WHERE c.id = projects.fn_waitlist_cohort(v_blueprint)
           FOR UPDATE;
        CONTINUE WHEN NOT FOUND OR v_cohort.status <> 'enrolling'
            OR (v_cohort.enrolment_closes_at IS NOT NULL AND v_cohort.enrolment_closes_at <= p_now);
        v_hold_until := LEAST(v_until, v_cohort.enrolment_closes_at);
        v_free := v_cohort.max_seats - projects.fn_cohort_seats_taken(v_cohort.id);
        CONTINUE WHEN v_free <= 0;
        SELECT sb.slug, sb.title INTO v_slug, v_title
          FROM marketplace.service_blueprints sb WHERE sb.id = v_blueprint;

        FOR r IN
            SELECT w.id, w.user_id
              FROM projects.waitlists w
             WHERE w.service_blueprint_id = v_blueprint AND w.status = 'waiting'
             ORDER BY w.queued_at, w.id
               FOR UPDATE
        LOOP
            EXIT WHEN v_free <= 0;
            IF EXISTS (
                SELECT 1 FROM projects.cohort_memberships cm
                 WHERE cm.cohort_id = v_cohort.id AND cm.user_id = r.user_id AND cm.status = 'active'
            ) THEN
                UPDATE projects.waitlists SET status = 'converted', resolved_at = p_now WHERE id = r.id;
                CONTINUE;
            END IF;
            IF EXISTS (
                SELECT 1 FROM projects.cohort_seat_holds h
                 WHERE h.cohort_id = v_cohort.id AND h.user_id = r.user_id
                   AND h.status = 'held' AND h.expires_at > pg_catalog.now()
            ) THEN
                CONTINUE;
            END IF;

            BEGIN
                SELECT h.id INTO v_hold
                  FROM projects.cohort_seat_holds h
                 WHERE h.cohort_id = v_cohort.id AND h.user_id = r.user_id AND h.status = 'held'
                   FOR UPDATE NOWAIT;
            EXCEPTION WHEN lock_not_available THEN
                EXIT;
            END;
            IF v_hold IS NOT NULL THEN
                UPDATE projects.cohort_seat_holds
                   SET seats = 1, expires_at = v_hold_until, updated_at = pg_catalog.now()
                 WHERE id = v_hold;
            ELSE
                INSERT INTO projects.cohort_seat_holds (cohort_id, user_id, seats, expires_at)
                VALUES (v_cohort.id, r.user_id, 1, v_hold_until)
                RETURNING id INTO v_hold;
            END IF;

            UPDATE projects.waitlists
               SET status = 'invited', cohort_id = v_cohort.id, hold_id = v_hold,
                   invited_at = p_now, invite_expires_at = v_hold_until
             WHERE id = r.id;
            v_free := v_free - 1;
            v_invited := v_invited + 1;
            PERFORM comms.fn_notify(
                r.user_id, 'waitlist.invited', 'A seat is held for you',
                CASE WHEN v_hold_until = v_until
                     THEN pg_catalog.format('A seat on "%s" is held for you for %s hours. Reserve it before then, or it passes to the next person on the waitlist.', v_title, v_hours)
                     ELSE pg_catalog.format('A seat on "%s" is held for you until its enrolment closes. Reserve it before then, or it passes to the next person on the waitlist.', v_title)
                END,
                'projects.waitlists', r.id,
                pg_catalog.jsonb_build_object('listing', v_slug, 'cohort_id', v_cohort.id, 'hold_id', v_hold,
                    'expires_at', v_hold_until),
                p_action_url => '/view/' || v_slug,
                p_expires_at => v_hold_until
            );
        END LOOP;
    END LOOP;

    RETURN pg_catalog.jsonb_build_object('closed', v_closed, 'expired', v_expired, 'invited', v_invited);
END;
$$;

COMMENT ON FUNCTION projects.fn_waitlist_dispatch(timestamptz) IS
'The cohort waitlist job (Decisions #455, #498): closes enrolment on cohorts past their close
(fn_close_cohort_enrolment), expires lapsed invites (releasing their holds), then invites
the people waiting in queue order, one per free seat, each holding its seat for
waitlist_invite_hold_hours. Internal; scheduled in 00005060. {expired, invited}.';
-- #endregion


-- #region 16. Seat links — a multi-seat booking shares its spare seats (Decision #522)
-- A buyer who paid for several seats keeps one and may hand the rest out through one link. A claim moves
-- one seat from the buyer's membership to a new membership for the claimer that names the buyer's as its
-- sponsor, so occupancy never changes and nothing is charged: the buyer's escrow already holds every seat.
-- Claims are first come first served under a row lock on the buyer's membership, and stop when the
-- cohort's first sitting starts, when the link is revoked, or when the buyer is down to their own seat.
-- Refusals are 'Seat refused: <code>' (23514), which SessionBackendService turns into a sentence.

-- A fresh link code: `s-` and 24 base64url characters (18 random bytes).
CREATE OR REPLACE FUNCTION projects.fn_seat_code()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
    SELECT 's-' || pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
$$;

-- When a cohort's first sitting starts, or NULL with none on the calendar.
CREATE OR REPLACE FUNCTION projects.fn_cohort_first_start(p_cohort_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.min(se.start_time)
      FROM projects.session_events se
     WHERE se.cohort_id = p_cohort_id AND se.status IN ('scheduled', 'completed');
$$;

-- Whether a cohort still takes claims: not cancelled or over, and its first sitting not yet begun.
CREATE OR REPLACE FUNCTION projects.fn_cohort_claimable(p_cohort_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT c.status IN ('enrolling', 'active')
           AND COALESCE(projects.fn_cohort_first_start(c.id) > pg_catalog.now(), true)
      FROM projects.cohorts c
     WHERE c.id = p_cohort_id;
$$;

-- The caller's own place on a cohort: their seats, who claimed the ones they shared, and their open link.
-- NULL when they hold no active seat. `can_share` is true only for a paid membership of more than one
-- seat on a cohort that still takes claims.
CREATE OR REPLACE FUNCTION projects.get_my_cohort_seats(p_cohort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_m projects.cohort_memberships;
BEGIN
    IF v_uid IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_m FROM projects.cohort_memberships cm
     WHERE cm.cohort_id = p_cohort_id AND cm.user_id = v_uid AND cm.status = 'active';
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'membership_id', v_m.id,
        'seats', v_m.seats,
        'sponsored', v_m.sponsor_membership_id IS NOT NULL,
        'can_share', v_m.sponsor_membership_id IS NULL AND v_m.seats > 1 AND projects.fn_cohort_claimable(p_cohort_id),
        'claimed', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'name', marketplace.fn_quote_party_name(s.user_id), 'handle', u.username, 'joined_at', s.joined_at
            ) ORDER BY s.joined_at)
              FROM projects.cohort_memberships s
              JOIN org.users_public u ON u.user_id = s.user_id
             WHERE s.sponsor_membership_id = v_m.id AND s.status = 'active'
        ), '[]'::jsonb),
        'code', (SELECT i.code FROM projects.cohort_seat_invites i
                  WHERE i.membership_id = v_m.id AND i.status = 'open' LIMIT 1)
    );
END;
$$;

-- Open (or return) the link for the caller's own paid membership of more than one seat.
CREATE OR REPLACE FUNCTION projects.share_cohort_seats(p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_m projects.cohort_memberships;
    v_code text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Seat refused: not_signed_in' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_m FROM projects.cohort_memberships WHERE id = p_membership_id FOR UPDATE;
    IF NOT FOUND OR v_m.user_id <> v_uid OR v_m.status <> 'active' THEN
        RAISE EXCEPTION 'Seat refused: not_found' USING ERRCODE = 'check_violation';
    END IF;
    IF v_m.sponsor_membership_id IS NOT NULL OR v_m.seats < 2 THEN
        RAISE EXCEPTION 'Seat refused: nothing_to_share' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT projects.fn_cohort_claimable(v_m.cohort_id) THEN
        RAISE EXCEPTION 'Seat refused: started' USING ERRCODE = 'check_violation';
    END IF;
    SELECT i.code INTO v_code FROM projects.cohort_seat_invites i
     WHERE i.membership_id = v_m.id AND i.status = 'open';
    IF v_code IS NULL THEN
        INSERT INTO projects.cohort_seat_invites (membership_id, code)
        VALUES (v_m.id, projects.fn_seat_code())
        RETURNING code INTO v_code;
    END IF;
    RETURN pg_catalog.jsonb_build_object('code', v_code, 'seats_left', v_m.seats - 1);
END;
$$;

-- Close the caller's open link. Seats already claimed stay claimed.
CREATE OR REPLACE FUNCTION projects.revoke_cohort_seat_link(p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_owner uuid;
BEGIN
    SELECT cm.user_id INTO v_owner FROM projects.cohort_memberships cm WHERE cm.id = p_membership_id;
    IF v_uid IS NULL OR v_owner IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'Seat refused: not_found' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE projects.cohort_seat_invites
       SET status = 'revoked', revoked_at = pg_catalog.now()
     WHERE membership_id = p_membership_id AND status = 'open';
    RETURN pg_catalog.jsonb_build_object('revoked', FOUND);
END;
$$;

-- What a link offers the signed-in person holding it, and why it can't be claimed when it can't:
-- `open` · `revoked` · `full` (the buyer is down to their own seat) · `started` · `ended` (the buyer's
-- seat is no longer active) · `host` (the session's own provider) · `own` (the buyer) · `seated` (already
-- in the cohort). NULL for a code that names no link.
CREATE OR REPLACE FUNCTION projects.get_cohort_seat_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_i projects.cohort_seat_invites;
    v_m projects.cohort_memberships;
    v_c projects.cohorts;
    v_state text;
BEGIN
    IF v_uid IS NULL OR p_code IS NULL OR p_code !~ '^s-[A-Za-z0-9_-]{24}$' THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_i FROM projects.cohort_seat_invites WHERE code = p_code;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_m FROM projects.cohort_memberships WHERE id = v_i.membership_id;
    SELECT * INTO v_c FROM projects.cohorts WHERE id = v_m.cohort_id;
    v_state := CASE
        WHEN v_i.status = 'revoked' THEN 'revoked'
        WHEN v_m.status <> 'active' THEN 'ended'
        WHEN NOT projects.fn_cohort_claimable(v_c.id) THEN 'started'
        WHEN projects.fn_is_session_host(v_c.project_id, v_uid) THEN 'host'
        WHEN v_m.user_id = v_uid THEN 'own'
        WHEN EXISTS (SELECT 1 FROM projects.cohort_memberships cm
                      WHERE cm.cohort_id = v_c.id AND cm.user_id = v_uid AND cm.status = 'active') THEN 'seated'
        WHEN v_m.seats < 2 THEN 'full'
        ELSE 'open'
    END;
    RETURN pg_catalog.jsonb_build_object(
        'state', v_state,
        'seats_left', GREATEST(v_m.seats - 1, 0),
        'cohort_name', v_c.name,
        'first_start', projects.fn_cohort_first_start(v_c.id),
        'sponsor_name', marketplace.fn_quote_party_name(v_m.user_id),
        'listing_title', (SELECT b.title FROM projects.projects p
                            JOIN marketplace.service_blueprints b ON b.id = p.source_blueprint_id
                           WHERE p.id = v_c.project_id),
        'listing_slug', (SELECT b.slug FROM projects.projects p
                           JOIN marketplace.service_blueprints b ON b.id = p.source_blueprint_id
                          WHERE p.id = v_c.project_id),
        'project_slug', (SELECT p.slug FROM projects.projects p WHERE p.id = v_c.project_id)
    );
END;
$$;

-- Claim one seat through a link: first come first served under a row lock on the buyer's membership.
-- The claimer joins the cohort as a member sponsored by the buyer; the buyer is told.
CREATE OR REPLACE FUNCTION projects.claim_cohort_seat(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_i projects.cohort_seat_invites;
    v_m projects.cohort_memberships;
    v_c projects.cohorts;
    v_seat uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Seat refused: not_signed_in' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);
    IF p_code IS NULL OR p_code !~ '^s-[A-Za-z0-9_-]{24}$' THEN
        RAISE EXCEPTION 'Seat refused: not_found' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_i FROM projects.cohort_seat_invites WHERE code = p_code FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seat refused: not_found' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_m FROM projects.cohort_memberships WHERE id = v_i.membership_id FOR UPDATE;
    SELECT * INTO v_c FROM projects.cohorts WHERE id = v_m.cohort_id;

    IF v_i.status <> 'open' THEN
        RAISE EXCEPTION 'Seat refused: revoked' USING ERRCODE = 'check_violation';
    END IF;
    IF v_m.status <> 'active' THEN
        RAISE EXCEPTION 'Seat refused: ended' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT projects.fn_cohort_claimable(v_c.id) THEN
        RAISE EXCEPTION 'Seat refused: started' USING ERRCODE = 'check_violation';
    END IF;
    IF v_m.user_id = v_uid OR projects.fn_is_session_host(v_c.project_id, v_uid) THEN
        RAISE EXCEPTION 'Seat refused: own' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM projects.cohort_memberships cm
                WHERE cm.cohort_id = v_c.id AND cm.user_id = v_uid AND cm.status = 'active') THEN
        RAISE EXCEPTION 'Seat refused: seated' USING ERRCODE = 'check_violation';
    END IF;
    IF v_m.seats < 2 THEN
        RAISE EXCEPTION 'Seat refused: full' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE projects.cohort_memberships SET seats = seats - 1 WHERE id = v_m.id;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id, seats, status, order_line_id, sponsor_membership_id)
    VALUES (v_c.id, v_uid, 1, 'active', v_m.order_line_id, v_m.id)
    ON CONFLICT (cohort_id, user_id) DO UPDATE
       SET status = 'active', seats = 1, order_line_id = EXCLUDED.order_line_id,
           sponsor_membership_id = EXCLUDED.sponsor_membership_id,
           joined_at = pg_catalog.now(), cancelled_at = NULL
     WHERE projects.cohort_memberships.status <> 'active'
    RETURNING id INTO v_seat;

    PERFORM comms.fn_notify(
        v_m.user_id, 'session.seat_claimed', 'A seat was claimed',
        marketplace.fn_quote_party_name(v_uid) || ' took one of your seats on ' || v_c.name || '.',
        'projects.cohorts', v_c.id, '{}'::jsonb, v_uid,
        'project', v_c.project_id, NULL,
        '/projects/' || (SELECT p.slug FROM projects.projects p WHERE p.id = v_c.project_id)
    );
    RETURN pg_catalog.jsonb_build_object(
        'membership_id', v_seat,
        'cohort_id', v_c.id,
        'project_slug', (SELECT p.slug FROM projects.projects p WHERE p.id = v_c.project_id),
        'seats_left', v_m.seats - 2
    );
END;
$$;

-- AFTER UPDATE OF status on cohort_memberships: a buyer's seats that were given away end with the buyer's
-- (cancelled or completed alike) and their open link closes; a claimed seat given up on its own goes back
-- to the buyer, who may share it again.
CREATE OR REPLACE FUNCTION projects.tg_cohort_sponsored_seats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF OLD.status <> 'active' OR NEW.status = 'active' THEN
        RETURN NULL;
    END IF;
    IF NEW.sponsor_membership_id IS NULL THEN
        UPDATE projects.cohort_memberships
           SET status = NEW.status,
               cancelled_at = CASE WHEN NEW.status = 'cancelled' THEN pg_catalog.now() END
         WHERE sponsor_membership_id = NEW.id AND status = 'active';
        UPDATE projects.cohort_seat_invites
           SET status = 'revoked', revoked_at = pg_catalog.now()
         WHERE membership_id = NEW.id AND status = 'open';
    ELSIF NEW.status = 'cancelled' THEN
        UPDATE projects.cohort_memberships
           SET seats = seats + 1
         WHERE id = NEW.sponsor_membership_id AND status = 'active';
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION projects.claim_cohort_seat(text) IS
'Claim one seat through a buyer''s seat link (Decision #522): first come first served under a row lock on the buyer''s membership, until the first sitting starts. Moves one seat to a membership sponsored by the buyer''s; charges nothing. Refusals ''Seat refused: <code>''.';
COMMENT ON FUNCTION projects.share_cohort_seats(uuid) IS
'Open (or return) the seat link of the caller''s own paid membership of more than one seat (Decision #522).';
-- #endregion

-- #region 10. Rolling weekly templates — a generator of ordinary cohorts (SC11)
-- A group-session listing on `group_schedule_mode = 'rolling_templates'` runs on one weekly template per
-- session position (`session_template_rules -> 'weekly'`: an ISO weekday and a start minute in the
-- seller's own zone). Owner rulings (SC11, 2026-11-23): (1) every occurrence of session 1's template within
-- `rolling_horizon_weeks` (4) starts a CHAIN whose session k is the next occurrence of template k after
-- session k-1 ends, opened as an ordinary enrolling cohort by the job `cohort-template-chains` and by the
-- seller's save, so seats, holds, escrow, refunds, the waitlist and cancellation are the cohort machinery
-- unchanged; (2) one capacity per chain, the listing's cohort size; (3) a chain whose enrolment closes, as
-- its session 1 starts, with no paid seat is cancelled quietly (fn_close_cohort_enrolment); (4) the mode
-- sits beside Open cohort, per listing, and a rolling listing refuses open_cohort; (5) several chains enrol
-- at once, a buyer lands on the earliest with a seat to sell and may pick a later one (get_cohort_offer
-- `chains`; #455 (e) and #498's one-enrolling rule amended for this mode). Templates may not overlap within
-- the week, or one chain's session k would be another chain's session 1.

-- Internal: a cancelled cohort's sittings, their calendar mirrors and their queued reminders all end. The
-- step cancel_cohort and the quiet cancel of an empty chain share.
CREATE OR REPLACE FUNCTION projects.fn_cancel_cohort_sittings(p_cohort_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE projects.session_events
       SET status = 'cancelled_by_freelancer'::projects.session_event_status, updated_at = pg_catalog.now()
     WHERE cohort_id = p_cohort_id AND status = 'scheduled';
    UPDATE scheduling.events ev
       SET status = 'cancelled'::scheduling.event_status
      FROM projects.session_events se
     WHERE se.cohort_id = p_cohort_id
       AND ev.source_session_event_id = se.id
       AND ev.status <> 'cancelled'::scheduling.event_status;
    PERFORM comms.fn_cancel_queued(NULL, 'projects.session_events', se.id)
       FROM projects.session_events se
      WHERE se.cohort_id = p_cohort_id;
END;
$$;

-- Each of a listing's first `p_n` sittings' length in minutes: its plan entry's `durationMinutes` (SC10),
-- else the listing's `session_minutes`, else an hour.
CREATE OR REPLACE FUNCTION projects.fn_sitting_lengths(p_bp marketplace.service_blueprints, p_n integer)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT COALESCE(pg_catalog.array_agg(COALESCE(
               CASE WHEN pg_catalog.jsonb_typeof((p_bp).session_plan -> (g.n - 1) -> 'durationMinutes') = 'number'
                    THEN ((p_bp).session_plan -> (g.n - 1) ->> 'durationMinutes')::integer END,
               (p_bp).session_minutes, 60) ORDER BY g.n), '{}'::integer[])
      FROM pg_catalog.generate_series(1, GREATEST(p_n, 0)) AS g (n);
$$;

-- Why a week of templates cannot run, or NULL. `p_lengths[k]` is sitting k's length in minutes. Refused:
-- not a list, more than 52, an entry without an ISO weekday (1–7) and a start minute (0–1439), or two
-- templates whose weekly spans overlap (the week wraps, so Sunday night runs into Monday morning).
CREATE OR REPLACE FUNCTION projects.fn_weekly_templates_refusal(p_templates jsonb, p_lengths integer[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_n integer;
    v_at integer[] := '{}';
    v_len integer[] := '{}';
    v_t jsonb;
    v_gap integer;
    i integer;
    j integer;
BEGIN
    IF pg_catalog.jsonb_typeof(p_templates) IS DISTINCT FROM 'array' THEN
        RETURN 'The weekly session times are a list';
    END IF;
    v_n := pg_catalog.jsonb_array_length(p_templates);
    IF v_n > 52 THEN
        RETURN 'A listing has at most 52 weekly session times';
    END IF;
    FOR i IN 0 .. v_n - 1 LOOP
        v_t := p_templates -> i;
        IF pg_catalog.jsonb_typeof(v_t -> 'weekday') IS DISTINCT FROM 'number'
           OR pg_catalog.jsonb_typeof(v_t -> 'startMinute') IS DISTINCT FROM 'number'
           OR (v_t ->> 'weekday') !~ '^[1-7]$'
           OR (v_t ->> 'startMinute') !~ '^[0-9]{1,4}$'
           OR (v_t ->> 'startMinute')::integer > 1439 THEN
            RETURN pg_catalog.format('Session %s needs a weekday and a start time', i + 1);
        END IF;
        v_at := v_at || (((v_t ->> 'weekday')::integer - 1) * 1440 + (v_t ->> 'startMinute')::integer);
        v_len := v_len || GREATEST(COALESCE(p_lengths[i + 1], 60), 1);
    END LOOP;
    FOR i IN 1 .. v_n LOOP
        FOR j IN i + 1 .. v_n LOOP
            -- Minutes from template i's start to template j's, around the week.
            v_gap := ((v_at[j] - v_at[i]) % 10080 + 10080) % 10080;
            IF v_gap < v_len[i] OR 10080 - v_gap < v_len[j] THEN
                RETURN pg_catalog.format('Sessions %s and %s overlap in the week — give each its own time', i, j);
            END IF;
        END LOOP;
    END LOOP;
    RETURN NULL;
END;
$$;

-- The chain that session 1 at `p_first` opens: session k starts at the next occurrence of template k at
-- or after session k-1 ends, in wall-clock time in zone `p_tz`, so a clock change keeps the seller's local
-- time. `p_lengths[k]` is sitting k's length in minutes, and its cardinality the number of sittings.
CREATE OR REPLACE FUNCTION projects.fn_template_chain(
    p_first timestamptz,
    p_templates jsonb,
    p_tz text,
    p_lengths integer[]
)
RETURNS timestamptz[]
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v_starts timestamptz[] := ARRAY[p_first];
    v_after timestamp;
    v_day date;
    v_at timestamp;
    k integer;
    d integer;
BEGIN
    FOR k IN 2 .. COALESCE(pg_catalog.cardinality(p_lengths), 1) LOOP
        v_after := (v_starts[k - 1] + pg_catalog.make_interval(mins => p_lengths[k - 1])) AT TIME ZONE p_tz;
        FOR d IN 0 .. 7 LOOP
            v_day := v_after::date + d;
            CONTINUE WHEN pg_catalog.date_part('isodow', v_day::timestamp)::integer
                          <> (p_templates -> (k - 1) ->> 'weekday')::integer;
            v_at := v_day + pg_catalog.make_interval(mins => (p_templates -> (k - 1) ->> 'startMinute')::integer);
            EXIT WHEN v_at >= v_after;
        END LOOP;
        v_starts := v_starts || (v_at AT TIME ZONE p_tz);
    END LOOP;
    RETURN v_starts;
END;
$$;

-- The zone a listing's weekly templates are read in: its provider's calendar zone (the team's schedule
-- for a team listing, else the seller's own, their freelancer schedule first, as fn_session_host_schedule
-- picks it), or UTC when they publish none.
CREATE OR REPLACE FUNCTION projects.fn_blueprint_timezone(p_blueprint_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT s.timezone
          FROM marketplace.service_blueprints sb
          JOIN scheduling.schedules s
            ON (sb.owner_team_id IS NOT NULL AND s.owner_type = 'team'::scheduling.owner_type
                AND s.owner_id = sb.owner_team_id)
            OR (sb.owner_team_id IS NULL
                AND s.owner_type IN ('freelancer'::scheduling.owner_type, 'user'::scheduling.owner_type)
                AND s.owner_id = sb.freelancer_profile_id)
         WHERE sb.id = p_blueprint_id
         ORDER BY (s.owner_type = 'freelancer'::scheduling.owner_type) DESC
         LIMIT 1
    ), 'UTC');
$$;

-- The generator (job `cohort-template-chains`, every 15 minutes, and a seller's save for their one
-- listing). For each published, unarchived group-session listing on rolling templates, locked FOR UPDATE
-- SKIP LOCKED so two runs share the work: every occurrence of session 1's template after `p_now` and
-- within the horizon that has no chain yet opens one, an enrolling cohort of the listing's cohort size
-- whose enrolment closes as session 1 starts, its sittings written through fn_write_group_sitting.
-- Idempotent per chain start (uq_cohorts_chain_start, a cancelled chain included). A listing whose
-- templates do not number its sittings, or overlap, is left alone. A chain one of whose sittings is not
-- free on the seller's calendar (PS409) is rolled back whole and skipped; the next run tries again while
-- its session 1 is still ahead. Answers how many chains it opened.
CREATE OR REPLACE FUNCTION projects.fn_open_template_cohorts(
    p_now timestamptz DEFAULT pg_catalog.now(),
    p_limit integer DEFAULT 200,
    p_blueprint uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bp marketplace.service_blueprints;
    v_weeks integer := GREATEST(projects.fn_session_param('rolling_horizon_weeks', 4), 1);
    v_count integer;
    v_templates jsonb;
    v_lengths integer[];
    v_tz text;
    v_eng record;
    v_local timestamp;
    v_day date;
    v_first timestamptz;
    v_starts timestamptz[];
    v_cohort uuid;
    v_plan_title text;
    v_opened integer := 0;
    d integer;
    k integer;
BEGIN
    FOR v_bp IN
        SELECT sb.*
          FROM marketplace.service_blueprints sb
         WHERE sb.delivery_model = 'group_session'::marketplace.service_delivery_model
           AND sb.group_schedule_mode = 'rolling_templates'
           AND sb.is_published
           AND (p_blueprint IS NULL OR sb.id = p_blueprint)
           AND EXISTS (SELECT 1 FROM catalogue.listings l
                        WHERE l.service_blueprint_id = sb.id
                          AND l.status <> 'archived'::catalogue.listing_status)
         ORDER BY sb.id
         LIMIT GREATEST(COALESCE(p_limit, 200), 1)
           FOR UPDATE OF sb SKIP LOCKED
    LOOP
        v_count := COALESCE(v_bp.session_count, 1);
        v_templates := v_bp.session_template_rules -> 'weekly';
        CONTINUE WHEN pg_catalog.jsonb_typeof(v_templates) IS DISTINCT FROM 'array'
                   OR pg_catalog.jsonb_array_length(v_templates) < v_count;
        SELECT pg_catalog.jsonb_agg(x.e ORDER BY x.n) INTO v_templates
          FROM pg_catalog.jsonb_array_elements(v_templates) WITH ORDINALITY AS x (e, n)
         WHERE x.n <= v_count;
        v_lengths := projects.fn_sitting_lengths(v_bp, v_count);
        CONTINUE WHEN projects.fn_weekly_templates_refusal(v_templates, v_lengths) IS NOT NULL;

        v_tz := projects.fn_blueprint_timezone(v_bp.id);
        SELECT * INTO v_eng FROM projects.fn_session_engagement_for(v_bp.id, 'group');
        v_local := p_now AT TIME ZONE v_tz;
        FOR d IN 0 .. v_weeks * 7 LOOP
            v_day := v_local::date + d;
            CONTINUE WHEN pg_catalog.date_part('isodow', v_day::timestamp)::integer
                          <> (v_templates -> 0 ->> 'weekday')::integer;
            v_first := (v_day + pg_catalog.make_interval(mins => (v_templates -> 0 ->> 'startMinute')::integer))
                       AT TIME ZONE v_tz;
            CONTINUE WHEN v_first <= p_now OR v_first > p_now + pg_catalog.make_interval(days => v_weeks * 7);
            CONTINUE WHEN EXISTS (SELECT 1 FROM projects.cohorts c
                                   WHERE c.project_stage_id = v_eng.o_stage_id AND c.chain_start = v_first);
            v_starts := projects.fn_template_chain(v_first, v_templates, v_tz, v_lengths);
            BEGIN
                INSERT INTO projects.cohorts (
                    project_id, project_stage_id, name, max_seats, status, enrolment_closes_at, cadence, chain_start
                ) VALUES (
                    v_eng.o_project_id, v_eng.o_stage_id, pg_catalog.left(v_bp.title, 200),
                    LEAST(GREATEST(v_bp.max_seats_per_cohort, 1), 500), 'enrolling'::projects.cohort_status,
                    v_first, CASE WHEN v_count > 1 THEN 'fixed' END, v_first
                )
                RETURNING id INTO v_cohort;
                FOR k IN 1 .. v_count LOOP
                    v_plan_title := CASE WHEN pg_catalog.jsonb_typeof(v_bp.session_plan -> (k - 1)) = 'object'
                                         THEN NULLIF(pg_catalog.btrim(COALESCE(v_bp.session_plan -> (k - 1) ->> 'title', '')), '') END;
                    PERFORM projects.fn_write_group_sitting(
                        v_cohort,
                        pg_catalog.left(CASE
                            WHEN v_count = 1 THEN COALESCE(v_bp.title || ' — ' || v_plan_title, v_bp.title)
                            WHEN v_plan_title IS NOT NULL
                                THEN pg_catalog.format('%s — session %s of %s: %s', v_bp.title, k, v_count, v_plan_title)
                            ELSE pg_catalog.format('%s — session %s of %s', v_bp.title, k, v_count) END, 200),
                        v_starts[k], v_starts[k] + pg_catalog.make_interval(mins => v_lengths[k]));
                END LOOP;
                PERFORM projects.fn_sync_sitting_mirrors(v_cohort);
                v_opened := v_opened + 1;
            EXCEPTION WHEN SQLSTATE 'PS409' THEN
                NULL;
            END;
        END LOOP;
    END LOOP;
    RETURN v_opened;
END;
$$;

COMMENT ON FUNCTION projects.fn_open_template_cohorts(timestamptz, integer, uuid) IS
'The rolling weekly generator (SC11): opens, as ordinary enrolling cohorts, every chain whose session 1
starts after p_now and within rolling_horizon_weeks on each published rolling group-session listing (or
p_blueprint alone), session k at the next occurrence of template k after session k-1 ends, in the seller''s
zone. FOR UPDATE SKIP LOCKED, idempotent per chain start; a chain that clashes with the seller''s calendar
is skipped. Job cohort-template-chains. Answers how many it opened.';

-- The seller's door for a group-session listing's schedule (SC11): how its cohorts open, and its weekly
-- templates, `p_templates` being the `weekly` list (one per sitting by position), stored whole. On rolling
-- templates the listing's chains open at once if it is published; cohorts already open are left as they
-- are in either mode. Answers {mode, weekly_templates, opened}.
--
-- Refusals: 42501 signed out · PM403 under 18 · P0002 not a listing the caller manages · PU422 not a group
-- session, or archived · 22023 an unknown mode, templates fn_weekly_templates_refusal refuses, or a rolling
-- schedule with fewer templates than the listing's sittings (DETAIL mode / templates).
CREATE OR REPLACE FUNCTION projects.save_group_schedule(p_listing uuid, p_mode text, p_templates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_listing catalogue.listings;
    v_bp marketplace.service_blueprints;
    v_templates jsonb := COALESCE(p_templates, '[]'::jsonb);
    v_count integer;
    v_problem text;
    v_opened integer := 0;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to change a listing''s schedule' USING ERRCODE = '42501';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);
    IF NOT COALESCE(catalogue.fn_manages_listing(p_listing), false) THEN
        RAISE EXCEPTION 'No such listing' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_listing FROM catalogue.listings WHERE id = p_listing;
    SELECT * INTO v_bp FROM marketplace.service_blueprints WHERE id = v_listing.service_blueprint_id FOR UPDATE;
    IF v_bp.id IS NULL OR v_bp.delivery_model <> 'group_session'::marketplace.service_delivery_model THEN
        RAISE EXCEPTION 'Only a group session has a cohort schedule' USING ERRCODE = 'PU422';
    END IF;
    IF v_listing.status = 'archived'::catalogue.listing_status THEN
        RAISE EXCEPTION 'This listing is archived — restore it to change its schedule' USING ERRCODE = 'PU422';
    END IF;
    IF p_mode IS NULL OR p_mode NOT IN ('fixed_cohorts', 'rolling_templates') THEN
        RAISE EXCEPTION 'A schedule is fixed cohorts or rolling weekly' USING ERRCODE = '22023', DETAIL = 'mode';
    END IF;
    IF pg_catalog.jsonb_typeof(v_templates) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'The weekly session times are a list' USING ERRCODE = '22023', DETAIL = 'templates';
    END IF;
    v_count := COALESCE(v_bp.session_count, 1);
    v_problem := projects.fn_weekly_templates_refusal(v_templates,
        projects.fn_sitting_lengths(v_bp, GREATEST(pg_catalog.jsonb_array_length(v_templates), v_count)));
    IF v_problem IS NOT NULL THEN
        RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023', DETAIL = 'templates';
    END IF;
    IF p_mode = 'rolling_templates' AND pg_catalog.jsonb_array_length(v_templates) < v_count THEN
        RAISE EXCEPTION 'Give each of the % sessions a weekday and a start time', v_count
            USING ERRCODE = '22023', DETAIL = 'templates';
    END IF;

    UPDATE marketplace.service_blueprints
       SET group_schedule_mode = p_mode,
           session_template_rules = CASE WHEN pg_catalog.jsonb_typeof(session_template_rules) = 'object'
                                         THEN session_template_rules ELSE '{}'::jsonb END
                                    || pg_catalog.jsonb_build_object('weekly', v_templates),
           updated_at = pg_catalog.now()
     WHERE id = v_bp.id;
    IF p_mode = 'rolling_templates' THEN
        v_opened := projects.fn_open_template_cohorts(pg_catalog.now(), 1, v_bp.id);
    END IF;

    RETURN pg_catalog.jsonb_build_object('mode', p_mode, 'weekly_templates', v_templates, 'opened', v_opened);
END;
$$;

COMMENT ON FUNCTION projects.save_group_schedule(uuid, text, jsonb) IS
'The seller''s door for a group-session listing''s cohort schedule (SC11): fixed_cohorts (Open cohort by
hand) or rolling_templates, with its weekly templates (ISO weekday, start minute, one per sitting). A
rolling save opens the published listing''s chains at once. Refusals: 42501 · PM403 · P0002 · PU422 ·
22023 mode / templates.';
-- #endregion
