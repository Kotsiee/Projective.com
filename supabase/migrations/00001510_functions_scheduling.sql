-- ============================================================================
-- 00001510 functions scheduling
-- Consolidated verbatim from: 20260724100000_scheduling_schema_availability.sql, 20260724102000_scheduling_events.sql, 20260724103000_scheduling_discovery_calls.sql, 20260724104000_scheduling_booking_engine.sql
-- ============================================================================

-- #endregion

-- #region 3. Visibility & management helpers
-- Mirrors `finance.fn_owner_visible` / `fn_can_view_wallet`: SECURITY DEFINER so a policy can read
-- the membership tables without RLS recursion.

-- May the caller SEE this owner's schedule internals (unmasked)?
CREATE OR REPLACE FUNCTION scheduling.fn_owner_visible(
    p_owner_type scheduling.owner_type, p_owner_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR (p_owner_type IN ('user', 'freelancer') AND p_owner_id = auth.uid ())
        OR (p_owner_type = 'team' AND org.is_active_team_member (p_owner_id))
        OR (p_owner_type = 'business' AND org.is_active_business_member (p_owner_id))
        OR (p_owner_type = 'organisation' AND org.is_organisation_member (p_owner_id));
$$;

-- May the caller MUTATE this owner's schedule? Deliberately narrower than visibility: an individual
-- owns their own schedule outright, while a shared entity's schedule is edited by a team lead /
-- business member / organisation member. Tightening the shared-entity write gate to a specific
-- permission (`org.team_permission` / `org.business_permission`) is FLAGGED for human sign-off
-- rather than guessed at here (root CLAUDE.md §8).
CREATE OR REPLACE FUNCTION scheduling.fn_owner_manages(
    p_owner_type scheduling.owner_type, p_owner_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR (p_owner_type IN ('user', 'freelancer') AND p_owner_id = auth.uid ())
        OR (p_owner_type = 'team' AND org.is_team_lead (p_owner_id))
        OR (p_owner_type = 'business' AND org.is_active_business_member (p_owner_id))
        OR (p_owner_type = 'organisation' AND org.is_organisation_member (p_owner_id));
$$;

-- Resolve a schedule id to its owner then defer to the two predicates above.
CREATE OR REPLACE FUNCTION scheduling.fn_can_view_schedule(p_schedule uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT COALESCE((
        SELECT scheduling.fn_owner_visible (s.owner_type, s.owner_id)
        FROM scheduling.schedules s WHERE s.id = p_schedule
    ), false);
$$;

CREATE OR REPLACE FUNCTION scheduling.fn_can_manage_schedule(p_schedule uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT COALESCE((
        SELECT scheduling.fn_owner_manages (s.owner_type, s.owner_id)
        FROM scheduling.schedules s WHERE s.id = p_schedule
    ), false);
$$;

-- Is this schedule publicly readable at all? Drives the anonymous/visitor path on
-- `/[handle]/availability` — a visitor may read a PUBLISHED schedule's shape (bands, blackouts) so
-- the booking grid can render, but never an unpublished one.
CREATE OR REPLACE FUNCTION scheduling.fn_schedule_is_public(p_schedule uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT COALESCE((
        SELECT s.is_published FROM scheduling.schedules s WHERE s.id = p_schedule
    ), false);
$$;

-- #endregion

-- #region 6. updated_at maintenance
CREATE OR REPLACE FUNCTION scheduling.fn_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- #endregion

-- #region 4. Free/busy predicate
-- Does the owner already have something occupying this window? The booking gate in migration 5/5
-- composes this with the working-hours / call-window / blackout / buffer checks. `cancelled` rows
-- never occupy time.
CREATE OR REPLACE FUNCTION scheduling.fn_has_conflicting_event(
    p_schedule uuid, p_starts_at timestamptz, p_ends_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM scheduling.events e
        WHERE e.schedule_id = p_schedule
          AND COALESCE(e.status, 'confirmed'::scheduling.event_status) <> 'cancelled'::scheduling.event_status
          AND e.kind <> 'availability'::scheduling.event_kind
          AND e.starts_at < p_ends_at
          AND e.ends_at > p_starts_at
    );
$$;

-- Is the window inside a blackout span?
CREATE OR REPLACE FUNCTION scheduling.fn_is_blacked_out(
    p_schedule uuid, p_starts_at timestamptz, p_ends_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM scheduling.blackout_dates b
        WHERE b.schedule_id = p_schedule
          AND b.starts_at < p_ends_at
          AND b.ends_at > p_starts_at
    );
$$;

-- #endregion

-- #region 6. Party predicate
-- Is the caller one of the two people on this call? Used by every policy below. SECURITY DEFINER so
-- it reads `discovery_calls` without recursing into that table's own policy.
CREATE OR REPLACE FUNCTION scheduling.fn_is_call_party(p_call uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, security, public
AS $$
    SELECT COALESCE((
        SELECT security.is_admin ()
            OR c.host_user_id = auth.uid ()
            OR c.requester_user_id = auth.uid ()
        FROM scheduling.discovery_calls c
        WHERE c.id = p_call
    ), false);
$$;

-- #endregion

-- #region 2. Timezone-aware primitives
-- Minutes from LOCAL midnight in the given IANA zone. `AT TIME ZONE` converts the timestamptz to
-- wall-clock time in that zone, so DST is handled by Postgres rather than by hand.
CREATE OR REPLACE FUNCTION scheduling.fn_local_minute_of_day(p_at timestamptz, p_tz text)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
    SELECT (EXTRACT(HOUR FROM (p_at AT TIME ZONE p_tz)) * 60
          + EXTRACT(MINUTE FROM (p_at AT TIME ZONE p_tz)))::integer;
$$;

-- 0 = Sunday … 6 = Saturday, matching the `weekday` column and JS `Date#getDay`.
CREATE OR REPLACE FUNCTION scheduling.fn_local_weekday(p_at timestamptz, p_tz text)
RETURNS smallint
LANGUAGE sql
STABLE
AS $$
    SELECT EXTRACT(DOW FROM (p_at AT TIME ZONE p_tz))::smallint;
$$;

-- Is the whole span inside ONE active weekly band of the given kind?
--
-- ⚠️ Known bound: because `end_minute > start_minute` is a table constraint, a band cannot cross
-- local midnight, and therefore neither can a call booked against one. A provider who takes calls
-- from 23:00 to 01:00 must express it as two bands and the call must fit inside one of them. This
-- is a deliberate simplification, not an oversight — modelling midnight-spanning bands would make
-- every downstream free/busy query materially harder for a case no fixture needs yet.
CREATE OR REPLACE FUNCTION scheduling.fn_band_covers(
    p_schedule uuid,
    p_kind scheduling.availability_kind,
    p_starts_at timestamptz,
    p_ends_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM scheduling.availability_rules r
        JOIN scheduling.schedules s ON s.id = r.schedule_id
        WHERE r.schedule_id = p_schedule
          AND r.kind = p_kind
          AND r.is_active
          AND r.weekday = scheduling.fn_local_weekday (p_starts_at, s.timezone)
          AND r.weekday = scheduling.fn_local_weekday (p_ends_at, s.timezone)
          AND r.start_minute <= scheduling.fn_local_minute_of_day (p_starts_at, s.timezone)
          AND r.end_minute   >= scheduling.fn_local_minute_of_day (p_ends_at, s.timezone)
    );
$$;

-- Convenience wrapper: is this span inside a declared CALL WINDOW?
CREATE OR REPLACE FUNCTION scheduling.fn_call_window_covers(
    p_schedule uuid, p_starts_at timestamptz, p_ends_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT scheduling.fn_band_covers (p_schedule, 'call_window'::scheduling.availability_kind, p_starts_at, p_ends_at);
$$;

-- #endregion

-- #region 3. Slot availability (buffers + blackouts + existing events + confirmed calls)
-- The span is widened by the provider's configured buffers BEFORE any conflict test, so two calls
-- can never be stacked back-to-back and a call can never butt against an existing commitment.
CREATE OR REPLACE FUNCTION scheduling.fn_slot_is_free(
    p_schedule uuid, p_starts_at timestamptz, p_ends_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = scheduling, security, public
AS $$
DECLARE
    v_before  integer;
    v_after   integer;
    v_pad     integer;
    v_start   timestamptz;
    v_end     timestamptz;
BEGIN
    SELECT cs.buffer_before_minutes, cs.buffer_after_minutes
      INTO v_before, v_after
      FROM scheduling.call_settings cs
     WHERE cs.schedule_id = p_schedule;

    -- No settings row yet → fall back to the platform default buffer on the trailing edge.
    IF v_before IS NULL THEN
        v_before := 0;
        v_after  := COALESCE((
            SELECT (pp.value #>> '{}')::integer
              FROM security.platform_params pp
             WHERE pp.key = 'discovery_call_default_buffer_minutes'
        ), 10);
    END IF;

    -- Buffers belong to EVERY commitment, not just the one being requested: an existing call at
    -- 14:00–14:15 with a 10-minute trailing buffer must block a 14:15 request. Comparing two spans
    -- each widened by (before, after) is algebraically identical to widening only the requested
    -- span by (before + after) on BOTH edges and comparing against the raw stored span — which is
    -- what this does, so the stored rows need no per-row buffer lookup.
    v_pad   := v_before + v_after;
    v_start := p_starts_at - make_interval(mins => v_pad);
    v_end   := p_ends_at   + make_interval(mins => v_pad);

    -- The blackout test uses the RAW span: a blackout is an absolute boundary, and a call that ends
    -- exactly when time-off begins is legitimate. Buffers protect against back-to-back CALLS.
    IF scheduling.fn_is_blacked_out (p_schedule, p_starts_at, p_ends_at) THEN
        RETURN false;
    END IF;

    IF scheduling.fn_has_conflicting_event (p_schedule, v_start, v_end) THEN
        RETURN false;
    END IF;

    -- A call that is proposed or confirmed already holds the slot; declined/cancelled/expired ones
    -- release it.
    RETURN NOT EXISTS (
        SELECT 1
          FROM scheduling.discovery_calls c
         WHERE c.host_schedule_id = p_schedule
           AND c.status IN ('proposed'::scheduling.call_status, 'confirmed'::scheduling.call_status)
           AND COALESCE(c.confirmed_start, c.proposed_start) < v_end
           AND COALESCE(c.confirmed_end,   c.proposed_end)   > v_start
    );
END;
$$;

-- #endregion

-- #region 4. The booking gate
-- Returns NULL when the request is allowed, or a short machine-readable reason code when it is not.
-- Returning a REASON rather than a bare boolean lets the UI explain the refusal ("outside call
-- hours", "too soon") without re-deriving the rules client-side.
CREATE OR REPLACE FUNCTION scheduling.fn_call_request_refusal(
    p_schedule uuid,
    p_requester uuid,
    p_type scheduling.call_type,
    p_starts_at timestamptz,
    p_ends_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = scheduling, security, public
AS $$
DECLARE
    s   scheduling.call_settings%ROWTYPE;
    v_minutes  integer;
    v_expected integer;
    v_max      integer;
    v_hosted   integer;
    v_recent   timestamptz;
BEGIN
    SELECT * INTO s FROM scheduling.call_settings WHERE schedule_id = p_schedule;

    IF NOT FOUND OR NOT s.accepts_calls THEN
        RETURN 'calls_not_offered';
    END IF;

    IF p_type = 'courtesy'::scheduling.call_type AND NOT s.courtesy_enabled THEN
        RETURN 'courtesy_not_offered';
    END IF;

    IF p_type = 'paid'::scheduling.call_type AND NOT s.paid_enabled THEN
        RETURN 'paid_not_offered';
    END IF;

    v_minutes := (EXTRACT(EPOCH FROM (p_ends_at - p_starts_at)) / 60)::integer;

    -- The duration is the provider's, not the requester's: a booking must match the configured
    -- length exactly so the grid and the calendar agree.
    -- (The CASE is assigned to a variable rather than inlined into the IF: plpgsql scans an IF
    -- condition for the terminating THEN without tracking CASE/END, so an inline CASE swallows it.)
    v_expected := CASE p_type
        WHEN 'courtesy'::scheduling.call_type THEN s.courtesy_duration_minutes
        ELSE s.paid_duration_minutes
    END;

    IF v_minutes <> v_expected THEN
        RETURN 'duration_mismatch';
    END IF;

    v_max := COALESCE((
        SELECT (pp.value #>> '{}')::integer
          FROM security.platform_params pp
         WHERE pp.key = 'discovery_call_max_duration_minutes'
    ), 240);

    IF v_minutes > v_max THEN
        RETURN 'duration_exceeds_platform_max';
    END IF;

    IF p_starts_at < now() + make_interval(mins => s.min_notice_minutes) THEN
        RETURN 'inside_minimum_notice';
    END IF;

    IF p_starts_at > now() + make_interval(days => s.max_advance_days) THEN
        RETURN 'beyond_booking_horizon';
    END IF;

    IF NOT scheduling.fn_call_window_covers (p_schedule, p_starts_at, p_ends_at) THEN
        RETURN 'outside_call_window';
    END IF;

    IF NOT scheduling.fn_slot_is_free (p_schedule, p_starts_at, p_ends_at) THEN
        RETURN 'slot_unavailable';
    END IF;

    -- Anti-abuse, courtesy calls only. A paid call is self-limiting.
    IF p_type = 'courtesy'::scheduling.call_type THEN
        IF s.courtesy_max_per_week > 0 THEN
            SELECT count(*) INTO v_hosted
              FROM scheduling.discovery_calls c
             WHERE c.host_schedule_id = p_schedule
               AND c.call_type = 'courtesy'::scheduling.call_type
               AND c.status IN (
                   'proposed'::scheduling.call_status,
                   'confirmed'::scheduling.call_status,
                   'completed'::scheduling.call_status
               )
               -- The ISO week the requested slot falls in, so "max per week" means a real week.
               AND COALESCE(c.confirmed_start, c.proposed_start) >= date_trunc('week', p_starts_at)
               AND COALESCE(c.confirmed_start, c.proposed_start) <  date_trunc('week', p_starts_at) + interval '7 days';

            IF v_hosted >= s.courtesy_max_per_week THEN
                RETURN 'weekly_courtesy_cap_reached';
            END IF;
        END IF;

        IF s.courtesy_cooldown_days > 0 THEN
            SELECT max(COALESCE(c.confirmed_start, c.proposed_start)) INTO v_recent
              FROM scheduling.discovery_calls c
             WHERE c.host_schedule_id = p_schedule
               AND c.requester_user_id = p_requester
               AND c.call_type = 'courtesy'::scheduling.call_type
               AND c.status IN (
                   'proposed'::scheduling.call_status,
                   'confirmed'::scheduling.call_status,
                   'completed'::scheduling.call_status
               );

            IF v_recent IS NOT NULL
               AND v_recent > now() - make_interval(days => s.courtesy_cooldown_days) THEN
                RETURN 'requester_in_cooldown';
            END IF;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

-- The boolean face of the same gate, for a pre-flight UI check.
CREATE OR REPLACE FUNCTION scheduling.fn_can_request_call(
    p_schedule uuid,
    p_requester uuid,
    p_type scheduling.call_type,
    p_starts_at timestamptz,
    p_ends_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT scheduling.fn_call_request_refusal (p_schedule, p_requester, p_type, p_starts_at, p_ends_at) IS NULL;
$$;

-- #endregion

-- #region 5. Enforcement triggers
-- A trusted backend path (service-role, webhooks, sweeps) has no `auth.uid()`; those callers own
-- the rules in their own layer and are not re-gated here — the trigger guards the CLIENT path.

CREATE OR REPLACE FUNCTION scheduling.fn_enforce_call_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
DECLARE
    v_reason text;
BEGIN
    IF auth.uid () IS NULL THEN
        RETURN NEW;
    END IF;

    v_reason := scheduling.fn_call_request_refusal (
        NEW.host_schedule_id, NEW.requester_user_id, NEW.call_type, NEW.proposed_start, NEW.proposed_end
    );

    IF v_reason IS NOT NULL THEN
        RAISE EXCEPTION 'Discovery call refused: %', v_reason
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- The legal-transition matrix + the derived lifecycle stamps. Documented in
-- PRODUCT_MANAGEMENT.md §3.5 as a DOMAIN lifecycle (never a delivery-board column).
CREATE OR REPLACE FUNCTION scheduling.fn_enforce_call_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = scheduling, security, public
AS $$
DECLARE
    v_legal   boolean;
    v_window  integer;
    v_slot    timestamptz;
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    v_legal := CASE OLD.status
        WHEN 'proposed'::scheduling.call_status THEN
            NEW.status IN (
                'proposed'::scheduling.call_status,   -- reschedule: back to proposed with a new slot
                'confirmed'::scheduling.call_status,
                'declined'::scheduling.call_status,
                'cancelled'::scheduling.call_status,
                'expired'::scheduling.call_status
            )
        WHEN 'confirmed'::scheduling.call_status THEN
            NEW.status IN (
                'proposed'::scheduling.call_status,   -- reschedule of an agreed call
                'cancelled'::scheduling.call_status,
                'completed'::scheduling.call_status,
                'no_show'::scheduling.call_status
            )
        ELSE false   -- declined / cancelled / completed / no_show / expired are terminal
    END;

    IF NOT v_legal AND auth.uid () IS NOT NULL THEN
        RAISE EXCEPTION 'Illegal discovery-call transition % → %', OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;

    -- Derived stamps, so a client cannot forge them.
    IF NEW.status = 'confirmed'::scheduling.call_status THEN
        NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
        NEW.responded_at := COALESCE(NEW.responded_at, now());
    END IF;

    IF NEW.status = 'declined'::scheduling.call_status THEN
        NEW.responded_at := COALESCE(NEW.responded_at, now());
    END IF;

    IF NEW.status = 'completed'::scheduling.call_status THEN
        NEW.completed_at := COALESCE(NEW.completed_at, now());
    END IF;

    IF NEW.status = 'cancelled'::scheduling.call_status THEN
        NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());

        v_window := COALESCE((
            SELECT (pp.value #>> '{}')::integer
              FROM security.platform_params pp
             WHERE pp.key = 'discovery_call_cancellation_window_hours'
        ), 24);

        v_slot := COALESCE(NEW.confirmed_start, NEW.proposed_start);
        NEW.is_late_cancel := v_slot IS NOT NULL
            AND NEW.cancelled_at > v_slot - make_interval(hours => v_window);
    END IF;

    -- A reschedule is a return to `proposed`, not a status of its own.
    IF NEW.status = 'proposed'::scheduling.call_status
       AND OLD.status <> 'proposed'::scheduling.call_status THEN
        NEW.reschedule_count := OLD.reschedule_count + 1;
        NEW.confirmed_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;

-- #endregion

-- #region 6. Audit trail
-- Every request and every transition appends a line, so `scheduling.call_audit` reconstructs the
-- whole negotiation including reschedules (which have no status of their own).
CREATE OR REPLACE FUNCTION scheduling.fn_log_call_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
DECLARE
    v_action scheduling.call_action;
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO scheduling.call_audit (
            call_id, action, actor_user_id, from_status, to_status, slot_start, slot_end
        ) VALUES (
            NEW.id, 'requested'::scheduling.call_action, auth.uid (), NULL, NEW.status,
            NEW.proposed_start, NEW.proposed_end
        );
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        v_action := CASE
            WHEN NEW.status = 'confirmed'::scheduling.call_status THEN 'confirmed'::scheduling.call_action
            WHEN NEW.status = 'declined'::scheduling.call_status  THEN 'declined'::scheduling.call_action
            WHEN NEW.status = 'cancelled'::scheduling.call_status THEN 'cancelled'::scheduling.call_action
            WHEN NEW.status = 'completed'::scheduling.call_status THEN 'completed'::scheduling.call_action
            WHEN NEW.status = 'no_show'::scheduling.call_status   THEN 'marked_no_show'::scheduling.call_action
            WHEN NEW.status = 'expired'::scheduling.call_status   THEN 'expired'::scheduling.call_action
            ELSE 'rescheduled'::scheduling.call_action
        END;

        INSERT INTO scheduling.call_audit (
            call_id, action, actor_user_id, from_status, to_status, slot_start, slot_end, detail
        ) VALUES (
            NEW.id, v_action, auth.uid (), OLD.status, NEW.status,
            COALESCE(NEW.confirmed_start, NEW.proposed_start),
            COALESCE(NEW.confirmed_end, NEW.proposed_end),
            NEW.cancellation_reason
        );
    ELSIF NEW.meeting_url IS DISTINCT FROM OLD.meeting_url AND NEW.meeting_url IS NOT NULL THEN
        INSERT INTO scheduling.call_audit (
            call_id, action, actor_user_id, from_status, to_status, detail
        ) VALUES (
            NEW.id, 'link_generated'::scheduling.call_action, auth.uid (), OLD.status, NEW.status,
            NEW.provider_slug
        );
    END IF;

    RETURN NEW;
END;
$$;
