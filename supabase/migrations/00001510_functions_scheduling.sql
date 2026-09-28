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
-- `/[handle]/availability` — a visitor may read a PUBLISHED schedule's shape (bands, blackout spans,
-- call terms) so the booking grid can render, but never an unpublished one, and never the schedule of
-- a profile the reader may not see (a `private` individual, a suspended team): publishing a schedule
-- does not publish a profile its owner has hidden.
CREATE OR REPLACE FUNCTION scheduling.fn_schedule_is_public(p_schedule uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
    SELECT COALESCE((
        SELECT s.is_published
           AND org.fn_profile_visible (
               CASE WHEN s.owner_type IN ('user', 'freelancer') THEN 'user' ELSE s.owner_type::text END,
               s.owner_id
           )
          FROM scheduling.schedules s WHERE s.id = p_schedule
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

-- #region 6b. Event coordination party predicate
-- Who may read an event's coordination: its roster, its reschedule rounds with their proposals and
-- votes, its history and its attachments. It is the database half of the per-viewer projection in
-- @projective/types/scheduling privacy.ts (`isEventParty`), so it names the same people:
--
--   · someone seated on the roster;
--   · the event's creator (the host of an entry with no host seat);
--   · whoever manages the schedule the event is anchored to (fn_can_manage_schedule).
--
-- NOT every participant of the engagement (2026-09-28). This used to admit anybody with project
-- access, which made the projection a presentation layer only: a member who was not on a meeting's
-- roster — or a freelancer who had DECLINED a stage — could read its roster with other people's
-- private notes, the proposals and who voted for what, and the log, straight through PostgREST. A
-- project member still sees a meeting's time and title (the events policy); its coordination is its
-- parties' business.
--
-- SECURITY DEFINER so the roster lookup does not recurse into event_attendees' own policy, which calls
-- this function.
CREATE OR REPLACE FUNCTION scheduling.fn_can_see_event_coordination (p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT EXISTS (
                SELECT 1 FROM scheduling.event_attendees a
                WHERE a.event_id = e.id AND a.user_id = auth.uid ()
            )
            OR e.created_by = auth.uid ()
            OR (e.schedule_id IS NOT NULL AND scheduling.fn_can_manage_schedule (e.schedule_id))
        FROM scheduling.events e
        WHERE e.id = p_event_id
    ), false);
$$;

-- Is the caller seated on this event? The events policy's roster arm: an attendee of a meeting on
-- somebody else's schedule could read its coordination but not the event row itself, so the meeting
-- vanished from their agenda and every RSVP or vote on it answered 404. DEFINER, like the predicate
-- above, so the lookup does not recurse into event_attendees' policy.
CREATE OR REPLACE FUNCTION scheduling.fn_is_event_attendee (p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT auth.uid () IS NOT NULL AND EXISTS (
        SELECT 1 FROM scheduling.event_attendees a
        WHERE a.event_id = p_event_id AND a.user_id = auth.uid ()
    );
$$;

-- The meeting room — join URL, passcode, dial-in details — for the events the caller is a PARTY to
-- (seated, or the creator), and nothing for any other. These three columns are withheld from every
-- client role at the column level (00002520), because RLS is row-level: a member of a project may
-- see that a meeting exists and when, and a meeting link IS the access control for most providers.
-- The scheduling service reads the rest of the row under the caller's RLS and merges the room from
-- here, so the projection and the database can no longer disagree about who holds a link.
CREATE OR REPLACE FUNCTION scheduling.get_event_rooms (p_event_ids uuid[])
RETURNS TABLE (event_id uuid, meeting_url text, meeting_passcode text, meeting_details text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT e.id, e.meeting_url, e.meeting_passcode, e.meeting_details
      FROM scheduling.events e
     WHERE e.id = ANY (p_event_ids)
       AND auth.uid () IS NOT NULL
       AND cardinality(p_event_ids) <= 500
       AND (
           e.created_by = auth.uid ()
           OR EXISTS (
               SELECT 1 FROM scheduling.event_attendees a
               WHERE a.event_id = e.id AND a.user_id = auth.uid ()
           )
       );
$$;

-- #endregion

-- #region 6c. Closing a reschedule round
-- The one transition in the negotiation that moves TWO rows — the round comes to rest, and when it
-- carried, the event itself moves to the winning slot — so it is one function rather than two
-- PostgREST writes. Done as two, a failure between them leaves a round that says "moved to Thursday"
-- beside an event that is still on Tuesday, and nothing afterwards can tell which of the two to
-- believe.
--
-- The RULES are not here. Whether a vote has carried, whether a counterparty may confirm, whether the
-- deadline has arrived — those are the pure predicates in `@projective/types/scheduling`
-- (`settleVote`, `majorityProposal`, `canReschedule`), applied by the scheduling service before it
-- calls this. What this function owns is the part a rule cannot: that the round is still open when it
-- is closed (so a second reader settling the same vote a moment later is a no-op, not a second move),
-- that the winner belongs to THIS round, and that the round, the event and the log line land
-- together or not at all.
--
-- Returns the new history line's id, or NULL when the round was already closed — the caller treats
-- NULL as "somebody else got there first" and re-reads.
--
-- The round is LOCKED before anything else is looked at, so the open-status test and the writes that
-- follow it see one state: the proposal/vote guard (6e) takes the same lock, and a vote arriving
-- while a reader closes the round now waits and is then refused, rather than landing on a question
-- that had already been answered.
--
-- A 1-on-1 may be closed on an ATTENDEE's slot: the host accepts it directly
-- (`counterpartyAcceptRefusal`), and that acceptance is the approval such a slot otherwise waits for —
-- so the winner is marked approved in the same transaction, and a resolved round never names a slot
-- the table still describes as off the ballot.
--
-- INVOKER and service-role only (00002510): there is no client write path into coordination at all.
CREATE OR REPLACE FUNCTION scheduling.close_reschedule_round (
    p_reschedule_id uuid,
    p_status text,
    p_resolved_proposal_id uuid,
    p_actor uuid,
    p_summary text,
    p_detail text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_event uuid;
    v_status text;
    v_start timestamptz;
    v_end timestamptz;
    v_line uuid;
BEGIN
    IF p_status NOT IN ('resolved', 'lapsed') THEN
        RAISE EXCEPTION 'close_reschedule_round: % is not an ending', p_status USING ERRCODE = '22023';
    END IF;
    IF p_status = 'resolved' AND p_resolved_proposal_id IS NULL THEN
        RAISE EXCEPTION 'close_reschedule_round: a resolved round names its winner' USING ERRCODE = '22023';
    END IF;

    SELECT r.event_id, r.status INTO v_event, v_status
    FROM scheduling.event_reschedules r
    WHERE r.id = p_reschedule_id
    FOR UPDATE;

    IF NOT FOUND OR v_status NOT IN ('collecting', 'awaiting_counterparty', 'voting') THEN
        RETURN NULL;
    END IF;

    IF p_status = 'resolved' THEN
        SELECT p.starts_at, p.ends_at INTO v_start, v_end
        FROM scheduling.reschedule_proposals p
        WHERE p.id = p_resolved_proposal_id AND p.reschedule_id = p_reschedule_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'close_reschedule_round: proposal % is not on round %',
                p_resolved_proposal_id, p_reschedule_id USING ERRCODE = '22023';
        END IF;

        UPDATE scheduling.reschedule_proposals
        SET approved = true
        WHERE id = p_resolved_proposal_id AND NOT approved;
    END IF;

    UPDATE scheduling.event_reschedules
    SET status = p_status,
        resolved_proposal_id = CASE WHEN p_status = 'resolved' THEN p_resolved_proposal_id END,
        updated_at = now()
    WHERE id = p_reschedule_id;

    IF p_status = 'resolved' THEN
        UPDATE scheduling.events SET starts_at = v_start, ends_at = v_end WHERE id = v_event;
    END IF;

    INSERT INTO scheduling.event_history (event_id, kind, actor_user_id, summary, detail, target_id)
    VALUES (
        v_event,
        CASE WHEN p_status = 'resolved' THEN 'rescheduled' ELSE 'vote' END,
        p_actor,
        p_summary,
        p_detail,
        p_resolved_proposal_id::text
    )
    RETURNING id INTO v_line;

    RETURN v_line;
END;
$$;

COMMENT ON FUNCTION scheduling.close_reschedule_round(uuid, text, uuid, uuid, text, text) IS
    'Close an open reschedule round (resolved | lapsed) atomically: the round, the event move and the '
    'history line together. NULL when the round was already closed. Service role only.';

-- #endregion

-- #region 6d. Capping a round's ballot
-- A round holds at most twelve slots, approved or not: RESCHEDULE_PROPOSALS_MAX in
-- `@projective/types/scheduling`, which `coordination.contract.test.ts` pins to the literal below.
-- The planner already refuses a thirteenth (`ballot_full`); this makes the cap true of the TABLE
-- rather than of one code path. Without it a thirteenth slot was stored, dropped by the read's
-- `proposals.slice(0, 12)`, and then answered "already proposed" when offered again — a time
-- nobody could see and nobody could offer.
--
-- The count runs under a lock on the round's own row, so two offers made at once against an
-- eleven-slot round cannot both count eleven and both take the last place: the second waits for the
-- first to commit, and its count (a fresh snapshot under READ COMMITTED) then includes it.
--
-- DEFINER so the invariant does not depend on which role is writing — `FOR UPDATE` needs UPDATE on
-- the parent, which a future writer might hold under a policy the lock would then have to satisfy.
-- It only reads and locks; a trigger function cannot be called directly.
CREATE OR REPLACE FUNCTION scheduling.fn_cap_reschedule_proposals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count integer;
BEGIN
    PERFORM 1 FROM scheduling.event_reschedules WHERE id = NEW.reschedule_id FOR UPDATE;

    SELECT count(*) INTO v_count
    FROM scheduling.reschedule_proposals
    WHERE reschedule_id = NEW.reschedule_id;

    IF v_count >= 12 THEN
        RAISE EXCEPTION 'reschedule round % already holds % proposals', NEW.reschedule_id, v_count
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION scheduling.fn_cap_reschedule_proposals() IS
    'BEFORE INSERT on reschedule_proposals: refuse a thirteenth slot on one round (23514), counted '
    'under a lock on the round so concurrent offers cannot both take the last place.';

-- #endregion

-- #region 6e. Guarding a round's writes, and keeping its deadline
-- The vote deadline, as a function of a round's ballot and the event it would move: the EARLIER of
-- the earliest ballot slot less VOTE_RESOLUTION_LEAD_HOURS, and the event's own start less
-- RESCHEDULE_LOCKOUT_HOURS. The same rule as `voteResolvesAt` in `@projective/types/scheduling`;
-- `coordination.contract.test.ts` pins both literals below to those constants.
--
-- The lockout term is what stops a vote outliving the meeting it is about. Every slot on a ballot may
-- lie after the event (moving Tuesday's crit to next week is the ordinary case), and without it the
-- round stayed `voting` for days after the event could no longer be moved, until the first read past
-- that deadline settled it and moved a session that had already taken place.
--
-- `p_also` counts one more slot as on the ballot — the row a BEFORE trigger is about to write, which
-- is not in the table yet (an insert) or not yet approved in it (an approval). NULL when the ballot is
-- empty, matching the TypeScript. INVOKER: called only from the definer triggers below.
CREATE OR REPLACE FUNCTION scheduling.fn_vote_deadline(
    p_reschedule_id uuid,
    p_also timestamptz DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN b.earliest IS NULL THEN NULL
        ELSE LEAST(b.earliest - interval '12 hours', e.starts_at - interval '12 hours')
    END
    FROM scheduling.event_reschedules r
    JOIN scheduling.events e ON e.id = r.event_id
    CROSS JOIN LATERAL (
        SELECT LEAST(min(p.starts_at), p_also) AS earliest
        FROM scheduling.reschedule_proposals p
        WHERE p.reschedule_id = r.id
          AND (p.proposed_by_role = 'host' OR p.approved)
    ) b
    WHERE r.id = p_reschedule_id;
$$;

COMMENT ON FUNCTION scheduling.fn_vote_deadline(uuid, timestamptz) IS
    'The vote deadline for a round: LEAST(earliest ballot slot - lead, event start - lockout); NULL '
    'on an empty ballot. Mirrors voteResolvesAt. Internal to the reschedule triggers.';

-- BEFORE INSERT / UPDATE OF approved on reschedule_proposals, and BEFORE INSERT on proposal_votes.
--
-- The planner refuses a move on a closed round, but it plans against a READ, and the round can close
-- between that read and this write: a host withdraws while an attendee is voting, or a reader settles
-- a decided vote a moment before somebody else's ballot lands. Without this the vote was stored on a
-- round that had already been answered — or a proposal on a withdrawn one — and the writer's own
-- follow-up then failed and reported the whole move as refused while its row stayed committed. So the
-- round is locked (the same lock the cap and `close_reschedule_round` take) and its status tested
-- here, in the statement that writes the row: a proposal or approval needs an open round, a vote a
-- round that is `voting`. Refused as 55000 (object_not_in_prerequisite_state), which the writer
-- answers with a 409.
--
-- On a live vote the deadline is re-stamped in the same statement from the ballot as it will stand,
-- so a proposal or an approval that brings the earliest option forward cannot commit without its
-- deadline, and two of them racing cannot leave the stamp computed from the ballot the loser read.
CREATE OR REPLACE FUNCTION scheduling.fn_guard_reschedule_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT r.status INTO v_status
    FROM scheduling.event_reschedules r
    WHERE r.id = NEW.reschedule_id
    FOR UPDATE;

    IF TG_TABLE_NAME = 'proposal_votes' THEN
        IF v_status IS DISTINCT FROM 'voting' THEN
            RAISE EXCEPTION 'reschedule round % is not taking votes (%)', NEW.reschedule_id, v_status
                USING ERRCODE = 'object_not_in_prerequisite_state';
        END IF;
        RETURN NEW;
    END IF;

    IF v_status IS NULL OR v_status NOT IN ('collecting', 'awaiting_counterparty', 'voting') THEN
        RAISE EXCEPTION 'reschedule round % is not open (%)', NEW.reschedule_id, v_status
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    IF v_status = 'voting' AND (NEW.proposed_by_role = 'host' OR NEW.approved) THEN
        UPDATE scheduling.event_reschedules
        SET resolves_at = scheduling.fn_vote_deadline(NEW.reschedule_id, NEW.starts_at)
        WHERE id = NEW.reschedule_id;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION scheduling.fn_guard_reschedule_write() IS
    'BEFORE write on reschedule_proposals / proposal_votes: refuse a row on a round that is not open '
    '(55000) under a lock on the round, and re-stamp a live vote''s deadline in the same statement.';

-- BEFORE UPDATE OF status on event_reschedules, as a round turns `voting`: stamp the deadline from the
-- ballot it holds at that instant rather than from whatever ballot the opening request read.
CREATE OR REPLACE FUNCTION scheduling.fn_stamp_vote_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.resolves_at := scheduling.fn_vote_deadline(NEW.id);
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION scheduling.fn_stamp_vote_deadline() IS
    'BEFORE UPDATE OF status on event_reschedules, entering voting: stamp resolves_at from the ballot.';

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
          AND r.start_minute <= scheduling.fn_local_minute_of_day (p_starts_at, s.timezone)
          AND (
              (r.weekday = scheduling.fn_local_weekday (p_ends_at, s.timezone)
               AND r.end_minute >= scheduling.fn_local_minute_of_day (p_ends_at, s.timezone))
              -- A band that runs to 24:00 covers a slot ending at the NEXT local midnight — minute
              -- 0 of the following day — which the slot grid offers (slot-grid.ts) and the editor
              -- allows (end_minute <= 1440).
              OR (r.end_minute = 1440
                  AND scheduling.fn_local_minute_of_day (p_ends_at, s.timezone) = 0
                  AND (p_ends_at AT TIME ZONE s.timezone)::date = (p_starts_at AT TIME ZONE s.timezone)::date + 1)
          )
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
    v_tz       text;
    v_week     timestamptz;
BEGIN
    SELECT * INTO s FROM scheduling.call_settings WHERE schedule_id = p_schedule;
    SELECT sc.timezone INTO v_tz FROM scheduling.schedules sc WHERE sc.id = p_schedule;

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
            -- The provider's own week (Monday 00:00 in their time zone), not the database session's
            -- UTC one: a London call at 00:30 on a Monday belongs to that Monday's week.
            v_week := date_trunc('week', p_starts_at AT TIME ZONE COALESCE(v_tz, 'UTC')) AT TIME ZONE COALESCE(v_tz, 'UTC');
            SELECT count(*) INTO v_hosted
              FROM scheduling.discovery_calls c
             WHERE c.host_schedule_id = p_schedule
               AND c.call_type = 'courtesy'::scheduling.call_type
               AND c.status IN (
                   'proposed'::scheduling.call_status,
                   'confirmed'::scheduling.call_status,
                   'completed'::scheduling.call_status
               )
               AND COALESCE(c.confirmed_start, c.proposed_start) >= v_week
               AND COALESCE(c.confirmed_start, c.proposed_start) <  v_week + interval '7 days';

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
        -- The agreed slot is released with the agreement: free/busy, both agendas and the booking
        -- gate read COALESCE(confirmed_*, proposed_*), so a stale confirmed pair kept the OLD time
        -- occupied and left the new one bookable by somebody else.
        NEW.confirmed_at := NULL;
        NEW.confirmed_start := NULL;
        NEW.confirmed_end := NULL;
    END IF;

    RETURN NEW;
END;
$$;

-- A rostered event moves only through its negotiation. A schedule owner may manage the entries on
-- their own calendar directly (the events policy), but once people are SEATED on one the 12-hour
-- lockout, the host-approval gate and the majority rule are what move it: a direct change of its
-- time or status is refused, and it is never deleted (root CLAUDE.md §5) — the delete would cascade
-- the roster, the rounds, the votes and the log away. Client roles only; the scheduling service
-- (service role, after the SSOT's rules) closes rounds through close_reschedule_round.
--
-- INVOKER on purpose: inside a SECURITY DEFINER function `current_user` is the function's owner, so
-- the client-role test below would never match and the guard would wave everything through. The
-- roster lookup it needs is the definer helper, so the answer does not depend on the caller's RLS.
CREATE OR REPLACE FUNCTION scheduling.fn_event_has_roster(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (SELECT 1 FROM scheduling.event_attendees a WHERE a.event_id = p_event_id);
$$;

CREATE OR REPLACE FUNCTION scheduling.fn_guard_rostered_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_user NOT IN ('anon', 'authenticated') THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF scheduling.fn_event_has_roster(OLD.id) THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'event: people are booked on this event — cancel or reschedule it instead';
        END IF;
        IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
           OR NEW.status IS DISTINCT FROM OLD.status OR NEW.schedule_id IS DISTINCT FROM OLD.schedule_id THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'event: people are booked on this event — propose a new time instead';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- A schedule's time zone must be one Postgres knows. save_owner_availability checked it, but a direct
-- update did not, and an unknown zone made every booking against the schedule raise instead of refusing
-- with a reason (while the slot grid silently fell back to UTC and kept offering slots).
CREATE OR REPLACE FUNCTION scheduling.fn_check_schedule_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = NEW.timezone) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'timezone: not a recognised time zone';
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

-- #region 9. scheduling.save_owner_availability — the owner's Availability editor, in one call
-- The profile owner's Availability surface (`/[handle]/edit/availability`) writes three tables — the
-- schedule (timezone + published), its weekly bands, and the discovery-call settings — and they
-- must land together: a timezone saved without the bands it is expressed in re-times every band.
-- So this is ONE function call, which is one transaction.
--
-- SECURITY INVOKER on purpose. The existing policies ("Manage own schedule", "Manage availability
-- rules", "Manage call settings") already decide who may write, via scheduling.fn_owner_manages;
-- this adds atomicity, not authority. The explicit fn_owner_manages check up front only turns a
-- silent zero-row write into a named refusal.
--
-- An individual's schedule is `owner_type = 'user'` — ONE schedule per human, whatever their
-- freelancer flag — so turning freelancer on or off can never strand a second calendar.
--
-- `rules` REPLACES the weekly bands. Overlapping bands of the same kind on the same weekday are
-- refused rather than merged: the editor offers no way to draw one, so receiving one means the
-- request did not come from it. `call` is optional; absent leaves the call settings as they are.
-- Errors are SQLSTATE 22023 with `<field>: <reason>` messages, like org.save_profile.
CREATE OR REPLACE FUNCTION scheduling.save_owner_availability (
    p_owner_type scheduling.owner_type,
    p_owner_id uuid,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
    v_tz text := NULLIF(btrim(COALESCE(p_payload ->> 'timezone', '')), '');
    v_schedule uuid;
    v_rule jsonb;
    v_call jsonb := p_payload -> 'call';
    v_i integer := 0;
BEGIN
    IF auth.uid () IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in to edit availability';
    END IF;
    IF NOT scheduling.fn_owner_manages (p_owner_type, p_owner_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'owner: you cannot edit this schedule';
    END IF;
    IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_tz) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'timezone: choose a time zone';
    END IF;

    INSERT INTO scheduling.schedules AS s (owner_type, owner_id, timezone, is_published)
    VALUES (p_owner_type, p_owner_id, v_tz, COALESCE((v_payload ->> 'published')::boolean, false))
    ON CONFLICT (owner_type, owner_id) DO UPDATE SET
        timezone = EXCLUDED.timezone,
        is_published = EXCLUDED.is_published,
        updated_at = now()
    RETURNING s.id INTO v_schedule;

    IF v_payload ? 'rules' THEN
        IF jsonb_typeof(v_payload -> 'rules') <> 'array' OR jsonb_array_length(v_payload -> 'rules') > 42 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'rules: up to six bands per day';
        END IF;
        DELETE FROM scheduling.availability_rules r WHERE r.schedule_id = v_schedule;
        FOR v_rule IN SELECT * FROM jsonb_array_elements(v_payload -> 'rules') LOOP
            IF COALESCE(v_rule ->> 'weekday', '') !~ '^[0-6]$'
               OR COALESCE(v_rule ->> 'start_minute', '') !~ '^[0-9]{1,4}$'
               OR COALESCE(v_rule ->> 'end_minute', '') !~ '^[0-9]{1,4}$'
               OR (v_rule ->> 'start_minute')::integer > 1439
               OR (v_rule ->> 'end_minute')::integer > 1440
               OR (v_rule ->> 'end_minute')::integer <= (v_rule ->> 'start_minute')::integer
               OR COALESCE(v_rule ->> 'kind', 'working_hours') NOT IN ('working_hours', 'call_window') THEN
                RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = format('rules.%s: a band needs a day and an end after its start', v_i);
            END IF;
            INSERT INTO scheduling.availability_rules (schedule_id, kind, weekday, start_minute, end_minute)
            VALUES (
                v_schedule,
                COALESCE(v_rule ->> 'kind', 'working_hours')::scheduling.availability_kind,
                (v_rule ->> 'weekday')::smallint,
                (v_rule ->> 'start_minute')::integer,
                (v_rule ->> 'end_minute')::integer
            );
            v_i := v_i + 1;
        END LOOP;

        IF EXISTS (
            SELECT 1
            FROM scheduling.availability_rules a
            JOIN scheduling.availability_rules b
              ON b.schedule_id = a.schedule_id AND b.kind = a.kind AND b.weekday = a.weekday
             AND b.id <> a.id
             AND a.start_minute < b.end_minute AND b.start_minute < a.end_minute
            WHERE a.schedule_id = v_schedule
        ) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'rules: two bands on the same day overlap';
        END IF;
    END IF;

    IF v_call IS NOT NULL AND jsonb_typeof(v_call) = 'object' THEN
        INSERT INTO scheduling.call_settings AS c (
            schedule_id, accepts_calls, courtesy_enabled, courtesy_duration_minutes, courtesy_max_per_week,
            courtesy_cooldown_days, paid_enabled, paid_duration_minutes, fee_amount_minor, fee_currency,
            buffer_before_minutes, buffer_after_minutes, min_notice_minutes, max_advance_days,
            auto_confirm, agenda_required
        ) VALUES (
            v_schedule,
            COALESCE((v_call ->> 'accepts_calls')::boolean, false),
            COALESCE((v_call ->> 'courtesy_enabled')::boolean, false),
            COALESCE((v_call ->> 'courtesy_duration_minutes')::integer, 15),
            COALESCE((v_call ->> 'courtesy_max_per_week')::integer, 0),
            COALESCE((v_call ->> 'courtesy_cooldown_days')::integer, 0),
            COALESCE((v_call ->> 'paid_enabled')::boolean, false),
            COALESCE((v_call ->> 'paid_duration_minutes')::integer, 30),
            NULLIF(v_call ->> 'fee_amount_minor', '')::bigint,
            upper(NULLIF(v_call ->> 'fee_currency', '')),
            COALESCE((v_call ->> 'buffer_before_minutes')::integer, 0),
            COALESCE((v_call ->> 'buffer_after_minutes')::integer, 10),
            COALESCE((v_call ->> 'min_notice_minutes')::integer, 720),
            COALESCE((v_call ->> 'max_advance_days')::integer, 60),
            COALESCE((v_call ->> 'auto_confirm')::boolean, false),
            COALESCE((v_call ->> 'agenda_required')::boolean, true)
        )
        ON CONFLICT (schedule_id) DO UPDATE SET
            accepts_calls = EXCLUDED.accepts_calls,
            courtesy_enabled = EXCLUDED.courtesy_enabled,
            courtesy_duration_minutes = EXCLUDED.courtesy_duration_minutes,
            courtesy_max_per_week = EXCLUDED.courtesy_max_per_week,
            courtesy_cooldown_days = EXCLUDED.courtesy_cooldown_days,
            paid_enabled = EXCLUDED.paid_enabled,
            paid_duration_minutes = EXCLUDED.paid_duration_minutes,
            fee_amount_minor = EXCLUDED.fee_amount_minor,
            fee_currency = EXCLUDED.fee_currency,
            buffer_before_minutes = EXCLUDED.buffer_before_minutes,
            buffer_after_minutes = EXCLUDED.buffer_after_minutes,
            min_notice_minutes = EXCLUDED.min_notice_minutes,
            max_advance_days = EXCLUDED.max_advance_days,
            auto_confirm = EXCLUDED.auto_confirm,
            agenda_required = EXCLUDED.agenda_required,
            updated_at = now();
    END IF;

    RETURN jsonb_build_object('ok', true, 'schedule_id', v_schedule);
END;
$$;
-- #endregion
