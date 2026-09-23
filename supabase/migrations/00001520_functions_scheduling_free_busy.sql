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
-- owner of the team / business / organisation otherwise. A discovery call names a host user (it is
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
        WHEN 'organisation'::scheduling.owner_type THEN (
            SELECT o.owner_user_id FROM org.organisations o WHERE o.id = s.owner_id
        )
    END
    FROM scheduling.schedules s
    WHERE s.id = p_schedule;
$$;
-- #endregion

-- #region Free / busy
-- The occupied spans on a schedule inside a window: every non-cancelled event that is not itself an
-- availability block, and every discovery call that is still requested or confirmed. Spans only —
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

-- #region Requesting a discovery call
-- The one door a discovery call comes through. The caller chooses the SCHEDULE, the flavour, the
-- time, an agenda, their own timezone, a platform from the host's list and (optionally) the listing
-- the call is about. Everything else is derived:
--
--   * the host is the schedule's accountable person (`fn_schedule_host`), never a caller's claim;
--   * a paid call's fee is the host's own configured fee, never a caller's figure;
--   * the platform must be one the host offers, or absent when they offer none;
--   * the listing must be a published blueprint the host sells;
--   * an agenda is demanded when the host demands one;
--   * the status is `proposed`, or `confirmed` when the host auto-confirms;
--   * the host is told, through the notification engine (`availability.booking_request`), so a
--     request does not sit unseen until somebody happens to open their calendar.
--
-- The slot itself — call window, notice, horizon, free time, weekly cap, cooldown — is judged by the
-- existing BEFORE INSERT gate (`fn_enforce_call_request` → `fn_call_request_refusal`), which fires
-- here because the insert runs with the caller's `auth.uid()`. A refusal raises `check_violation`
-- with a short machine-readable reason the app maps to a sentence.
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

    IF NOT scheduling.fn_schedule_is_public (p_schedule) THEN
        RAISE EXCEPTION 'Discovery call refused: calls_not_offered' USING ERRCODE = 'check_violation';
    END IF;

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

    INSERT INTO scheduling.discovery_calls (
        host_schedule_id, host_user_id, requester_user_id, call_type, status,
        proposed_start, proposed_end, confirmed_start, confirmed_end, confirmed_at,
        requester_timezone, agenda, service_blueprint_id, provider_slug,
        fee_amount_minor, fee_currency
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
        p_provider_slug,
        CASE WHEN p_call_type = 'paid'::scheduling.call_type THEN s.fee_amount_minor END,
        CASE WHEN p_call_type = 'paid'::scheduling.call_type THEN s.fee_currency END
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
        CASE WHEN p_call_type = 'paid'::scheduling.call_type
            THEN 'A paid consultation'
            ELSE 'A free introductory call'
        END,
        'scheduling.discovery_calls',
        v_id,
        jsonb_build_object('starts_at', p_starts_at, 'call_type', p_call_type, 'status', v_status),
        v_requester
    );

    RETURN jsonb_build_object('id', v_id, 'status', v_status);
END;
$$;

COMMENT ON FUNCTION scheduling.request_discovery_call(uuid, scheduling.call_type, timestamptz, timestamptz, text, text, text, uuid) IS
'The only way a client requests a discovery call. Derives the host, the fee and the status from the schedule; the BEFORE INSERT gate judges the slot. Raises check_violation "Discovery call refused: <reason>".';
-- #endregion
