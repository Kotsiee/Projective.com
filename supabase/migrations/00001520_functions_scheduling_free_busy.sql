-- =============================================================================================
-- 00001520_functions_scheduling_free_busy.sql — the booking reads and the one call-request write
-- (Category 1).
--
-- The listing's Book modal and the discovery-call handshake draw a grid of offerable times from a
-- provider's PUBLISHED schedule. The shape of that schedule — bands, blackout spans, call settings —
-- is already world-readable (00002015). What is not is WHEN the provider is busy: `scheduling.events`
-- carries titles, attendees and meeting links, and is readable only by people who may view the
-- schedule. A grid needs the busy SPANS and nothing else, so this file answers exactly that, as a
-- definer, and discloses no more than "this time is taken".
--
-- It also holds the ONLY path by which a discovery call is requested. A direct PostgREST insert let
-- the requester write every column of the row — the host it notifies, the fee, the meeting link the
-- host would click — none of which are the requester's to choose. The request function derives them
-- from the schedule and its settings instead, and the client INSERT policy is gone (00002015).
-- =============================================================================================

-- #region The host behind a schedule
-- The accountable PERSON a schedule belongs to: the individual for a personal schedule, and the
-- owner of the team / business / enterprise otherwise. A discovery call names a host user (it is
-- a meeting between two people), so a team's calls are hosted by the person who answers for the team.
CREATE OR REPLACE FUNCTION scheduling.fn_schedule_host(p_schedule uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE s.owner_type
        WHEN 'user'::scheduling.owner_type THEN s.owner_id
        WHEN 'freelancer'::scheduling.owner_type THEN s.owner_id
        WHEN 'team'::scheduling.owner_type THEN (
            SELECT t.owner_user_id FROM org.teams t WHERE t.id = s.owner_id
        )
        WHEN 'business'::scheduling.owner_type THEN (
            SELECT b.owner_user_id FROM org.business_profiles b WHERE b.id = s.owner_id
        )
        WHEN 'enterprise'::scheduling.owner_type THEN (
            SELECT o.owner_user_id FROM org.enterprises o WHERE o.id = s.owner_id
        )
    END
    FROM scheduling.schedules s
    WHERE s.id = p_schedule;
$$;
-- #endregion

-- #region Free / busy
-- The occupied spans on a schedule inside a window: every non-cancelled event that is not itself an
-- availability block or `passive`, and every discovery call that is still requested or confirmed.
-- This reads the same rows fn_has_conflicting_event does and has to agree with it: a grid drawn from
-- a span the gate ignores refuses a slot the write would take. Spans only —
-- no title, no id, no kind — so a visitor learns that a time is taken and nothing about by whom or
-- for what (the masking rule of `PRODUCT_SPEC.md` §The Proactive Calendar, Part 1.4).
--
-- Readable for a PUBLISHED schedule by anyone, and for any schedule by those who may already view
-- it. The window is clamped to 120 days so the function cannot be used to page through a provider's
-- entire history in one call; a grid asks for a few weeks.
CREATE OR REPLACE FUNCTION scheduling.get_free_busy(
    p_schedule uuid,
    p_from timestamptz,
    p_to timestamptz
)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_to timestamptz := LEAST(p_to, p_from + interval '120 days');
BEGIN
    IF p_schedule IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
        RETURN;
    END IF;
    IF NOT (
        scheduling.fn_schedule_is_public (p_schedule)
        OR scheduling.fn_can_view_schedule (p_schedule)
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT e.starts_at, e.ends_at
    FROM scheduling.events e
    WHERE e.schedule_id = p_schedule
      AND COALESCE(e.status, 'confirmed'::scheduling.event_status) <> 'cancelled'::scheduling.event_status
      AND e.kind <> 'availability'::scheduling.event_kind
      AND e.availability_behavior <> 'passive'
      AND e.starts_at < v_to
      AND e.ends_at > p_from
    UNION ALL
    SELECT COALESCE(c.confirmed_start, c.proposed_start), COALESCE(c.confirmed_end, c.proposed_end)
    FROM scheduling.discovery_calls c
    WHERE c.host_schedule_id = p_schedule
      AND c.status IN ('proposed'::scheduling.call_status, 'confirmed'::scheduling.call_status)
      AND COALESCE(c.confirmed_start, c.proposed_start) < v_to
      AND COALESCE(c.confirmed_end, c.proposed_end) > p_from
    ORDER BY 1;
END;
$$;

COMMENT ON FUNCTION scheduling.get_free_busy(uuid, timestamptz, timestamptz) IS
'Occupied spans (start, end) on a published or viewable schedule inside a window of at most 120 days. Spans only — never a title, an id or a kind.';
-- #endregion

-- #region Clashes
-- What already holds a person's own time across a span: their schedule's entries, the meetings they
-- said they are coming to, their discovery calls and their time off. The same test as
-- fn_has_conflicting_event, from the person's side rather than a schedule's, so `detectTimeClash`
-- (@projective/types/scheduling) has to agree with it: a pending or declined seat holds nothing, and a
-- moment (a deadline) has no span to clash with. A call mirrored into an event answers as the call.
--
-- Unlike get_free_busy this names what it finds, which is why it answers only for the caller: a door
-- that took anybody's id would read out their calendar.
CREATE OR REPLACE FUNCTION scheduling.fn_detect_event_clashes(
    p_user_id uuid,
    p_starts_at timestamptz,
    p_ends_at timestamptz,
    p_exclude_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_clashes jsonb;
BEGIN
    IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid () THEN
        RAISE EXCEPTION 'clashes: a person reads only their own calendar' USING ERRCODE = '42501';
    END IF;
    IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
        RETURN '[]'::jsonb;
    END IF;

    WITH own AS (
        SELECT s.id FROM scheduling.schedules s
         WHERE s.owner_type = 'user' AND s.owner_id = p_user_id
    ), seats AS (
        SELECT a.event_id FROM scheduling.event_attendees a
         WHERE a.user_id = p_user_id AND a.archived_at IS NULL
           AND a.response IN ('accepted'::scheduling.rsvp_response, 'tentative'::scheduling.rsvp_response)
    ), taken AS (
        SELECT 'event' AS kind, e.id, e.title, e.starts_at, e.ends_at
          FROM scheduling.events e
         WHERE e.starts_at < p_ends_at
           AND e.ends_at > p_starts_at
           AND e.ends_at > e.starts_at
           AND e.archived_at IS NULL
           AND e.id IS DISTINCT FROM p_exclude_event_id
           AND COALESCE(e.status, 'confirmed'::scheduling.event_status) <> 'cancelled'::scheduling.event_status
           AND e.kind NOT IN ('availability'::scheduling.event_kind, 'deadline'::scheduling.event_kind)
           AND e.availability_behavior <> 'passive'
           AND (
               e.schedule_id IN (SELECT o.id FROM own o)
               OR e.id IN (SELECT s.event_id FROM seats s)
               OR (e.project_id IS NOT NULL AND e.created_by = p_user_id)
           )
           AND NOT EXISTS (SELECT 1 FROM scheduling.discovery_calls c WHERE c.event_id = e.id)
        UNION ALL
        SELECT 'call', c.id, 'Discovery call',
               COALESCE(c.confirmed_start, c.proposed_start), COALESCE(c.confirmed_end, c.proposed_end)
          FROM scheduling.discovery_calls c
         WHERE (c.host_user_id = p_user_id OR c.requester_user_id = p_user_id)
           AND c.status IN ('proposed'::scheduling.call_status, 'confirmed'::scheduling.call_status)
           AND c.event_id IS DISTINCT FROM p_exclude_event_id
           AND COALESCE(c.confirmed_start, c.proposed_start) < p_ends_at
           AND COALESCE(c.confirmed_end, c.proposed_end) > p_starts_at
        UNION ALL
        SELECT 'blackout', b.id, COALESCE(NULLIF(b.label, ''), 'Time off'), b.starts_at, b.ends_at
          FROM scheduling.blackout_dates b
         WHERE b.schedule_id IN (SELECT o.id FROM own o)
           AND b.starts_at < p_ends_at
           AND b.ends_at > p_starts_at
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'kind', t.kind, 'id', t.id, 'title', t.title,
                'startsAt', t.starts_at, 'endsAt', t.ends_at
            )
            ORDER BY t.starts_at, t.id
        ),
        '[]'::jsonb
    )
      INTO v_clashes
      FROM taken t;
    RETURN v_clashes;
END;
$$;

COMMENT ON FUNCTION scheduling.fn_detect_event_clashes(uuid, timestamptz, timestamptz, uuid) IS
'What already holds the caller''s own time across a span: events, discovery calls and blackouts, by id, title and span. Answers for the caller alone.';
-- #endregion

-- #region Requesting a discovery call
-- The one door a discovery call comes through. The caller chooses the SCHEDULE, the flavour, the
-- time, an agenda, their own timezone, a platform from the host's list and (optionally) the listing
-- the call is about. Everything else is derived:
--
--   * the host is the schedule's accountable person (`fn_schedule_host`), never a caller's claim;
--   * the platform must be one the host offers, or absent when they offer none;
--   * the listing must be a published blueprint the host sells;
--   * an agenda is demanded when the host demands one;
--   * the status is `proposed`, or `confirmed` when the host auto-confirms;
--   * the host is told, through the notification engine (`availability.booking_request`), so a
--     request does not sit unseen until somebody happens to open their calendar.
--
-- Only a courtesy call comes through here. A paid one is refused `paid_unavailable` (Decision #343,
-- ruling C1): nothing writes a paid call's payment or escrow, so this door used to book one with no
-- money behind it, born `confirmed` under auto_confirm. Its money path, once built, is checkout,
-- never this door, so the signature stays as it is.
--
-- The slot itself — call window, notice, horizon, free time, weekly cap, cooldown — is judged by the
-- existing BEFORE INSERT gate (`fn_enforce_call_request` → `fn_call_request_refusal`), which fires
-- here because the insert runs with the caller's `auth.uid()`, under a row lock on the schedule. A
-- refusal raises `check_violation` with a short machine-readable reason the app maps to a sentence.
CREATE OR REPLACE FUNCTION scheduling.request_discovery_call(
    p_schedule uuid,
    p_call_type scheduling.call_type,
    p_starts_at timestamptz,
    p_ends_at timestamptz,
    p_agenda text DEFAULT NULL,
    p_requester_timezone text DEFAULT NULL,
    p_provider_slug text DEFAULT NULL,
    p_service_blueprint_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_requester uuid := auth.uid();
    v_host uuid;
    s scheduling.call_settings%ROWTYPE;
    v_has_platforms boolean;
    v_status scheduling.call_status;
    v_id uuid;
BEGIN
    IF v_requester IS NULL THEN
        RAISE EXCEPTION 'Discovery call refused: not_signed_in' USING ERRCODE = 'check_violation';
    END IF;
    -- Booking a call with a seller is the start of buying (Decision #208).
    PERFORM org.fn_assert_adult(v_requester);

    -- Before the schedule lock and the insert: a paid request never queues behind a real one.
    IF p_call_type = 'paid'::scheduling.call_type THEN
        RAISE EXCEPTION 'Discovery call refused: paid_unavailable' USING ERRCODE = 'check_violation';
    END IF;

    IF NOT scheduling.fn_schedule_is_public (p_schedule) THEN
        RAISE EXCEPTION 'Discovery call refused: calls_not_offered' USING ERRCODE = 'check_violation';
    END IF;

    -- One request at a time per schedule. The gate below reads the calls already on it, and two
    -- requests for one slot under READ COMMITTED each read the other as absent — both passed, and the
    -- host was double-booked. The second now waits here, and its insert's gate then sees the first.
    -- The lock projects.fn_book_session_slot and projects.schedule_sitting take, so a call, a 1-1
    -- booking and a new group sitting queue behind one another instead of landing on one slot.
    PERFORM 1 FROM scheduling.schedules WHERE id = p_schedule FOR UPDATE;

    v_host := scheduling.fn_schedule_host (p_schedule);
    IF v_host IS NULL THEN
        RAISE EXCEPTION 'Discovery call refused: calls_not_offered' USING ERRCODE = 'check_violation';
    END IF;
    IF v_host = v_requester THEN
        RAISE EXCEPTION 'Discovery call refused: self_booking' USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO s FROM scheduling.call_settings WHERE schedule_id = p_schedule;
    IF NOT FOUND OR NOT s.accepts_calls THEN
        RAISE EXCEPTION 'Discovery call refused: calls_not_offered' USING ERRCODE = 'check_violation';
    END IF;

    IF s.agenda_required AND NULLIF(btrim(COALESCE(p_agenda, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Discovery call refused: agenda_required' USING ERRCODE = 'check_violation';
    END IF;

    SELECT EXISTS (SELECT 1 FROM scheduling.call_platforms cp WHERE cp.schedule_id = p_schedule)
      INTO v_has_platforms;
    IF p_provider_slug IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM scheduling.call_platforms cp
        WHERE cp.schedule_id = p_schedule AND cp.provider_slug = p_provider_slug
    ) THEN
        RAISE EXCEPTION 'Discovery call refused: platform_not_offered' USING ERRCODE = 'check_violation';
    END IF;
    IF p_provider_slug IS NULL AND v_has_platforms THEN
        RAISE EXCEPTION 'Discovery call refused: platform_required' USING ERRCODE = 'check_violation';
    END IF;

    IF p_service_blueprint_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM marketplace.service_blueprints b
        WHERE b.id = p_service_blueprint_id
          AND b.is_published
          AND (
              b.freelancer_profile_id = v_host
              OR b.owner_team_id IN (
                  SELECT sc.owner_id FROM scheduling.schedules sc
                  WHERE sc.id = p_schedule AND sc.owner_type = 'team'::scheduling.owner_type
              )
          )
    ) THEN
        RAISE EXCEPTION 'Discovery call refused: listing_mismatch' USING ERRCODE = 'check_violation';
    END IF;

    v_status := CASE WHEN s.auto_confirm
        THEN 'confirmed'::scheduling.call_status
        ELSE 'proposed'::scheduling.call_status
    END;

    -- A courtesy call carries no fee (ck_call_fee_matches_type).
    INSERT INTO scheduling.discovery_calls (
        host_schedule_id, host_user_id, requester_user_id, call_type, status,
        proposed_start, proposed_end, confirmed_start, confirmed_end, confirmed_at,
        requester_timezone, agenda, service_blueprint_id, provider_slug
    )
    VALUES (
        p_schedule, v_host, v_requester, p_call_type, v_status,
        p_starts_at, p_ends_at,
        CASE WHEN v_status = 'confirmed'::scheduling.call_status THEN p_starts_at END,
        CASE WHEN v_status = 'confirmed'::scheduling.call_status THEN p_ends_at END,
        CASE WHEN v_status = 'confirmed'::scheduling.call_status THEN now() END,
        NULLIF(btrim(COALESCE(p_requester_timezone, '')), ''),
        NULLIF(btrim(COALESCE(p_agenda, '')), ''),
        p_service_blueprint_id,
        p_provider_slug
    )
    RETURNING id INTO v_id;

    -- Tell the host. The engine never raises (a notification cannot fail the request that caused it),
    -- routes by the host's own channel and quiet-hours preferences, and records the requester as the
    -- actor rather than naming them in a free-text body.
    PERFORM comms.fn_notify(
        v_host,
        'availability.booking_request',
        CASE WHEN v_status = 'confirmed'::scheduling.call_status
            THEN 'A call was booked with you'
            ELSE 'Someone requested a call with you'
        END,
        'A free introductory call',
        'scheduling.discovery_calls',
        v_id,
        jsonb_build_object('starts_at', p_starts_at, 'call_type', p_call_type, 'status', v_status),
        v_requester
    );

    RETURN jsonb_build_object('id', v_id, 'status', v_status);
END;
$$;

-- A published schedule's blackout SPANS for a visitor, with each label only where its owner made it
-- public (`label_is_public`), else "Unavailable". The table itself is readable by the schedule's own
-- members only (00002015): as a row policy it could not mask one column, so a visitor used to read
-- "Travelling" on a span its owner had marked private.
CREATE OR REPLACE FUNCTION scheduling.get_public_blackouts (
    p_schedule uuid, p_from timestamptz, p_to timestamptz
)
RETURNS TABLE (id uuid, starts_at timestamptz, ends_at timestamptz, label text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT b.id, b.starts_at, b.ends_at,
           CASE WHEN b.label_is_public OR scheduling.fn_can_view_schedule (b.schedule_id) THEN b.label ELSE 'Unavailable' END
      FROM scheduling.blackout_dates b
     WHERE b.schedule_id = p_schedule
       AND (scheduling.fn_schedule_is_public (p_schedule) OR scheduling.fn_can_view_schedule (p_schedule))
       AND b.ends_at > p_from
       AND b.starts_at < LEAST(p_to, p_from + interval '400 days')
     ORDER BY b.starts_at, b.id;
$$;

COMMENT ON FUNCTION scheduling.request_discovery_call(uuid, scheduling.call_type, timestamptz, timestamptz, text, text, text, uuid) IS
'The only way a client requests a discovery call, and a courtesy one only: a paid request is refused paid_unavailable (Decision #343, ruling C1). Derives the host and the status from the schedule; the BEFORE INSERT gate judges the slot. Raises check_violation "Discovery call refused: <reason>".';
-- #endregion
