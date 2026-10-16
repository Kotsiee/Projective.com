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
        OR (p_owner_type = 'enterprise' AND org.is_enterprise_member (p_owner_id));
$$;

-- May the caller MUTATE this owner's schedule? Deliberately narrower than visibility: an individual
-- owns their own schedule outright, while a shared entity's schedule is edited by a team lead /
-- business member / enterprise member. Tightening the shared-entity write gate to a specific
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
        OR (p_owner_type = 'enterprise' AND org.is_enterprise_member (p_owner_id));
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
-- #region Scheduling and under-18 accounts (Decision #208)
-- A restricted (13–17) account schedules nothing with other people: it never publishes working hours,
-- never takes discovery calls, and never books one or holds a session seat (request_discovery_call /
-- projects.reserve_seat). Its private calendar is untouched. The schedule tables are written directly
-- under RLS (`save_owner_availability` is an invoker), so publishing is refused by a trigger, and
-- fn_schedule_is_public never answers true for a minor's schedule whatever the row says.
CREATE OR REPLACE FUNCTION scheduling.trg_schedule_age_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_type text;
    v_owner uuid;
    v_offers boolean;
BEGIN
    IF TG_TABLE_NAME = 'schedules' THEN
        v_type := NEW.owner_type::text;
        v_owner := NEW.owner_id;
        v_offers := NEW.is_published;
    ELSE
        SELECT s.owner_type::text, s.owner_id INTO v_type, v_owner
          FROM scheduling.schedules s WHERE s.id = NEW.schedule_id;
        v_offers := NEW.accepts_calls;
    END IF;
    IF v_offers AND v_type IN ('user', 'freelancer') AND org.fn_is_minor(v_owner) THEN
        RAISE EXCEPTION 'scheduling: publishing hours and taking calls unlock at 18' USING ERRCODE = 'PM403';
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion

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
           -- A minor's schedule is never public (Decision #208).
           AND NOT (s.owner_type IN ('user', 'freelancer') AND org.fn_is_minor (s.owner_id))
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

-- Is the whole span inside the owner's availability of the given kind?
--
-- With a blueprint whose resolved preset (fn_preset_for_blueprint) has been compiled over the span's
-- local dates, the answer is "inside ONE compiled occurrence of that layer" (Decision #217 (d)). In
-- every other case — no blueprint, no preset, a preset not compiled yet, a span outside the compiled
-- window — it is "inside ONE active weekly band of that kind", as it always was.
--
-- ⚠️ Known bound (weekly branch): because `end_minute > start_minute` is a table constraint, a band
-- cannot cross local midnight, and therefore neither can a call booked against one. A provider who
-- takes calls from 23:00 to 01:00 must express it as two bands and the call must fit inside one of
-- them. This is a deliberate simplification, not an oversight — modelling midnight-spanning bands
-- would make every downstream free/busy query materially harder for a case no fixture needs yet.
-- Compiled occurrences have no such bound: the evaluator joins touching spans across midnight.
CREATE OR REPLACE FUNCTION scheduling.fn_band_covers(
    p_schedule uuid,
    p_kind scheduling.availability_kind,
    p_starts_at timestamptz,
    p_ends_at timestamptz,
    p_blueprint uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = scheduling, public
AS $$
DECLARE
    v_preset uuid;
BEGIN
    IF p_blueprint IS NOT NULL THEN
        v_preset := scheduling.fn_preset_for_blueprint (p_blueprint);
        IF v_preset IS NOT NULL AND EXISTS (
            SELECT 1
              FROM scheduling.availability_presets p
              JOIN scheduling.schedules s ON s.id = p.schedule_id
             WHERE p.id = v_preset
               AND p.compiled_from <= (p_starts_at AT TIME ZONE s.timezone)::date
               AND p.compiled_through >= (p_ends_at AT TIME ZONE s.timezone)::date
        ) THEN
            RETURN scheduling.fn_occurrence_covers (v_preset, p_kind, p_starts_at, p_ends_at);
        END IF;
    END IF;

    RETURN EXISTS (
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
END;
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

-- #region 10. Availability presets & recurrence (Decision #217)
-- Named rule sets under the owner's schedule (00000022). The TypeScript evaluator
-- (@projective/types/scheduling evaluate.ts) is the only thing that knows what a rule MEANS; nothing
-- here parses an RRULE. The database stores the rules, stores the spans the service compiled from
-- them, and lets the booking gate read those spans (fn_band_covers, §2).

-- The schedule a preset / a rule belongs to. SECURITY DEFINER so the policies on rules, bands and
-- occurrences can hand fn_can_manage_schedule / fn_can_view_schedule a parent the caller may not
-- be able to read itself (00002015).
CREATE OR REPLACE FUNCTION scheduling.fn_preset_schedule(p_preset uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.schedule_id FROM scheduling.availability_presets p WHERE p.id = p_preset;
$$;

CREATE OR REPLACE FUNCTION scheduling.fn_rule_schedule(p_rule uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.schedule_id
      FROM scheduling.recurrence_rules r
      JOIN scheduling.availability_presets p ON p.id = r.preset_id
     WHERE r.id = p_rule;
$$;

-- Is this the schedule a blueprint with this owner books into — its team's when team-owned, else
-- its seller's own (an individual's `user` or `freelancer` schedule)? Takes the owner columns rather
-- than a blueprint id so a BEFORE trigger can ask about the row being written.
CREATE OR REPLACE FUNCTION scheduling.fn_is_owner_schedule(
    p_schedule uuid, p_owner_team uuid, p_owner_person uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM scheduling.schedules s
         WHERE s.id = p_schedule
           AND (
               (p_owner_team IS NOT NULL
                AND s.owner_type = 'team'::scheduling.owner_type AND s.owner_id = p_owner_team)
               OR (p_owner_team IS NULL
                   AND s.owner_type IN ('user'::scheduling.owner_type, 'freelancer'::scheduling.owner_type)
                   AND s.owner_id = p_owner_person)
           )
    );
$$;

-- The preset a blueprint's bookings are judged against: its bound preset, else its owner schedule's
-- default, else NULL (no preset — the weekly bands decide). An archived preset never answers, so a
-- binding that outlived its preset falls back to the default exactly as a NULL binding does. Between
-- an individual's two possible schedules the `freelancer` one wins, as in
-- projects.fn_session_host_schedule.
CREATE OR REPLACE FUNCTION scheduling.fn_preset_for_blueprint(p_blueprint uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT p.id
           FROM marketplace.service_blueprints b
           JOIN scheduling.availability_presets p ON p.id = b.availability_preset_id
          WHERE b.id = p_blueprint
            AND p.archived_at IS NULL),
        (SELECT p.id
           FROM marketplace.service_blueprints b
           JOIN scheduling.schedules s
             ON scheduling.fn_is_owner_schedule (s.id, b.owner_team_id, b.freelancer_profile_id)
           JOIN scheduling.availability_presets p
             ON p.schedule_id = s.id AND p.is_default AND p.archived_at IS NULL
          WHERE b.id = p_blueprint
          ORDER BY (s.owner_type = 'freelancer'::scheduling.owner_type) DESC
          LIMIT 1)
    );
$$;

-- Is the whole span inside ONE compiled occurrence of that layer? Says nothing about whether the
-- preset was compiled over the span — fn_band_covers asks that first.
CREATE OR REPLACE FUNCTION scheduling.fn_occurrence_covers(
    p_preset uuid,
    p_kind scheduling.availability_kind,
    p_from timestamptz,
    p_to timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM scheduling.availability_occurrences o
         WHERE o.preset_id = p_preset
           AND o.kind = p_kind
           AND o.starts_at <= p_from
           AND o.ends_at >= p_to
    );
$$;

-- BEFORE INSERT OR UPDATE on availability_presets. Two rules the table cannot state:
--   * a restricted (13–17) caller, or a minor's own schedule, holds no preset — the same
--     org.fn_is_minor predicate trg_schedule_age_gate uses (Decision #208). This is how
--     save_availability_preset (an invoker) refuses a minor, and it holds for a direct table write too;
--   * a service fork names a blueprint sold from this schedule.
-- SECURITY DEFINER: org.fn_is_minor reads a stored date of birth and is service-role only.
CREATE OR REPLACE FUNCTION scheduling.trg_preset_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_type scheduling.owner_type;
    v_owner uuid;
BEGIN
    SELECT s.owner_type, s.owner_id INTO v_type, v_owner
      FROM scheduling.schedules s WHERE s.id = NEW.schedule_id;
    IF org.fn_is_minor(auth.uid())
       OR (v_type IN ('user'::scheduling.owner_type, 'freelancer'::scheduling.owner_type) AND org.fn_is_minor(v_owner)) THEN
        RAISE EXCEPTION 'scheduling: availability presets unlock at 18' USING ERRCODE = 'PM403';
    END IF;
    IF NEW.blueprint_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM marketplace.service_blueprints b
         WHERE b.id = NEW.blueprint_id
           AND scheduling.fn_is_owner_schedule (NEW.schedule_id, b.owner_team_id, b.freelancer_profile_id)
    ) THEN
        RAISE EXCEPTION 'blueprint_id: that service is not sold from this schedule' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- BEFORE INSERT OR UPDATE OF availability_preset_id, owner_team_id, freelancer_profile_id on
-- marketplace.service_blueprints (the CHECK half of the FK in 00000031): a bound preset is live, sits
-- on the blueprint owner's schedule, and — when it is a service fork — is THIS blueprint's fork. A
-- dangling id is left to the FK itself.
CREATE OR REPLACE FUNCTION scheduling.trg_blueprint_preset_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_preset scheduling.availability_presets;
BEGIN
    IF NEW.availability_preset_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT * INTO v_preset FROM scheduling.availability_presets p WHERE p.id = NEW.availability_preset_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF v_preset.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'availability_preset_id: that preset is archived' USING ERRCODE = '23514';
    END IF;
    IF NOT scheduling.fn_is_owner_schedule (v_preset.schedule_id, NEW.owner_team_id, NEW.freelancer_profile_id) THEN
        RAISE EXCEPTION 'availability_preset_id: that preset belongs to another schedule' USING ERRCODE = '23514';
    END IF;
    IF v_preset.scope = 'service'::scheduling.preset_scope AND v_preset.blueprint_id IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION 'availability_preset_id: that preset is another service''s' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- AFTER a write to recurrence_rules / recurrence_rule_bands, or AFTER UPDATE OF timezone on
-- schedules: the compiled spans no longer describe the rules (or the zone they were placed in), so
-- the preset is marked not compiled and the gate falls back to the weekly bands until the service
-- recompiles. Definer: compiled_from / compiled_through carry no client UPDATE grant (00002520).
CREATE OR REPLACE FUNCTION scheduling.trg_invalidate_preset_compilation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_preset uuid;
BEGIN
    IF TG_TABLE_NAME = 'schedules' THEN
        UPDATE scheduling.availability_presets p
           SET compiled_from = NULL, compiled_through = NULL
         WHERE p.schedule_id = NEW.id AND p.compiled_through IS NOT NULL;
        RETURN NULL;
    END IF;

    IF TG_TABLE_NAME = 'recurrence_rules' THEN
        v_preset := CASE WHEN TG_OP = 'DELETE' THEN OLD.preset_id ELSE NEW.preset_id END;
    ELSE
        SELECT r.preset_id INTO v_preset
          FROM scheduling.recurrence_rules r
         WHERE r.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.rule_id ELSE NEW.rule_id END;
    END IF;

    UPDATE scheduling.availability_presets p
       SET compiled_from = NULL, compiled_through = NULL
     WHERE p.id = v_preset AND p.compiled_through IS NOT NULL;
    RETURN NULL;
END;
$$;

-- scheduling.save_availability_preset — the preset editor's one write, in one transaction.
--
-- SECURITY INVOKER, like save_owner_availability: the preset, rule and band policies
-- (fn_can_manage_schedule, 00002015) decide who may write; the explicit check up front turns a silent
-- zero-row write into a named refusal. A restricted caller is refused by trg_preset_guard (PM403) on
-- the preset write, before any rule is touched.
--
-- Payload (snake_case, mapped from @projective/types/scheduling SavePresetInputSchema by the service):
--   { id?, name, description?, is_default?, scope?, blueprint_id?, rules: [{ id?, kind, effect,
--     rrule, starts_on, ends_on?, priority?, unless_weekdays?, label?, is_active?,
--     bands: [{ start_minute, end_minute }] }] }
-- `id` absent creates; present updates that live preset, which keeps its scope and service. `rules`
-- REPLACES the preset's rules and bands (a rule's uuid `id` is kept, anything else is minted). Only
-- the RRULE's shape is checked — at most 400 characters, starting `FREQ=`; the TypeScript parser
-- re-validated it before the call and is the authority on its meaning (Decision #217 (d)).
--
-- The single default: saving with `is_default` moves the default here; a library preset saved onto a
-- schedule with no default becomes it. A default is moved, never cleared — saving the default with
-- `is_default: false` leaves it the default.
--
-- Errors are SQLSTATE 42501 for the caller and 22023 with `<field>: <reason>` for the input.
CREATE OR REPLACE FUNCTION scheduling.save_availability_preset(p_schedule uuid, p_preset jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    v_date_re constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
    v_in jsonb := COALESCE(p_preset, '{}'::jsonb);
    v_id uuid;
    v_name text := btrim(COALESCE(p_preset ->> 'name', ''));
    v_description text := COALESCE(p_preset ->> 'description', '');
    v_scope text := COALESCE(NULLIF(p_preset ->> 'scope', ''), 'library');
    v_blueprint_text text := NULLIF(p_preset ->> 'blueprint_id', '');
    v_blueprint uuid;
    v_default boolean;
    v_rules jsonb := COALESCE(p_preset -> 'rules', '[]'::jsonb);
    v_existing scheduling.availability_presets;
    v_rule jsonb;
    v_band jsonb;
    v_rule_id uuid;
    v_starts date;
    v_ends date;
    v_bands jsonb;
    v_unless smallint[];
    v_i integer := 0;
    v_j integer;
BEGIN
    IF auth.uid () IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in to edit availability';
    END IF;
    IF NOT scheduling.fn_can_manage_schedule (p_schedule) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'schedule: you cannot edit this schedule';
    END IF;

    -- #region Validate the preset
    IF jsonb_typeof(v_in) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'preset: expected an object';
    END IF;
    IF char_length(v_name) NOT BETWEEN 1 AND 60 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'name: give the preset a name of up to 60 characters';
    END IF;
    IF char_length(v_description) > 200 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'description: up to 200 characters';
    END IF;
    IF v_scope NOT IN ('library', 'service') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'scope: library or service';
    END IF;
    IF (v_scope = 'service') <> (v_blueprint_text IS NOT NULL)
       OR (v_blueprint_text IS NOT NULL AND v_blueprint_text !~ v_uuid_re) THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'blueprint_id: a service preset belongs to exactly one service; a library preset to none';
    END IF;
    v_blueprint := v_blueprint_text::uuid;
    IF COALESCE(p_preset ->> 'is_default', 'false') NOT IN ('true', 'false') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'is_default: true or false';
    END IF;
    v_default := (COALESCE(p_preset ->> 'is_default', 'false'))::boolean;
    IF v_default AND v_scope <> 'library' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'is_default: only a library preset can be the default';
    END IF;
    IF jsonb_typeof(v_rules) <> 'array' OR jsonb_array_length(v_rules) > 64 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'rules: up to 64 rules';
    END IF;
    IF NULLIF(v_in ->> 'id', '') IS NOT NULL THEN
        IF (v_in ->> 'id') !~ v_uuid_re THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'id: not a preset id';
        END IF;
        v_id := (v_in ->> 'id')::uuid;
    END IF;
    IF v_scope = 'library' AND EXISTS (
        SELECT 1
          FROM scheduling.availability_presets p
         WHERE p.schedule_id = p_schedule
           AND p.scope = 'library'::scheduling.preset_scope
           AND p.archived_at IS NULL
           AND lower(p.name) = lower(v_name)
           AND p.id IS DISTINCT FROM v_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'name: another preset in this library has that name';
    END IF;
    -- #endregion

    -- #region Write the preset
    IF v_id IS NOT NULL THEN
        SELECT * INTO v_existing
          FROM scheduling.availability_presets p
         WHERE p.id = v_id AND p.schedule_id = p_schedule
           FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'id: that preset is not on this schedule';
        END IF;
        IF v_existing.archived_at IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'id: that preset is archived';
        END IF;
        IF v_existing.scope::text <> v_scope OR v_existing.blueprint_id IS DISTINCT FROM v_blueprint THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'scope: a saved preset keeps its scope and service';
        END IF;
        UPDATE scheduling.availability_presets p
           SET name = v_name, description = v_description
         WHERE p.id = v_existing.id
        RETURNING p.id INTO v_id;
    ELSE
        INSERT INTO scheduling.availability_presets (schedule_id, scope, blueprint_id, name, description)
        VALUES (p_schedule, v_scope::scheduling.preset_scope, v_blueprint, v_name, v_description)
        RETURNING id INTO v_id;
    END IF;

    IF v_default THEN
        UPDATE scheduling.availability_presets p
           SET is_default = false
         WHERE p.schedule_id = p_schedule AND p.is_default AND p.id <> v_id;
        UPDATE scheduling.availability_presets p SET is_default = true WHERE p.id = v_id AND NOT p.is_default;
    ELSIF v_scope = 'library' AND NOT EXISTS (
        SELECT 1 FROM scheduling.availability_presets p
         WHERE p.schedule_id = p_schedule AND p.is_default AND p.archived_at IS NULL
    ) THEN
        UPDATE scheduling.availability_presets p SET is_default = true WHERE p.id = v_id;
    END IF;
    -- #endregion

    -- #region Replace the rules
    DELETE FROM scheduling.recurrence_rules r WHERE r.preset_id = v_id;

    FOR v_rule IN SELECT value FROM jsonb_array_elements(v_rules) LOOP
        IF jsonb_typeof(v_rule) <> 'object'
           OR COALESCE(v_rule ->> 'kind', '') NOT IN ('working_hours', 'call_window')
           OR COALESCE(v_rule ->> 'effect', '') NOT IN ('add', 'replace', 'subtract') THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = format('rules.%s: a rule needs a layer and an effect', v_i);
        END IF;
        IF char_length(COALESCE(v_rule ->> 'rrule', '')) > 400 OR COALESCE(v_rule ->> 'rrule', '') !~ '^FREQ=' THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = format('rules.%s.rrule: a recurrence starts with FREQ= and is at most 400 characters', v_i);
        END IF;
        IF COALESCE(v_rule ->> 'starts_on', '') !~ v_date_re
           OR (NULLIF(v_rule ->> 'ends_on', '') IS NOT NULL AND (v_rule ->> 'ends_on') !~ v_date_re) THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = format('rules.%s.starts_on: dates are YYYY-MM-DD', v_i);
        END IF;
        v_starts := (v_rule ->> 'starts_on')::date;
        v_ends := NULLIF(v_rule ->> 'ends_on', '')::date;
        IF v_ends IS NOT NULL AND v_ends < v_starts THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = format('rules.%s.ends_on: a rule ends on or after it starts', v_i);
        END IF;
        IF COALESCE(v_rule ->> 'priority', '50') !~ '^[0-9]{1,2}$' THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = format('rules.%s.priority: 0 to 99', v_i);
        END IF;
        IF char_length(COALESCE(v_rule ->> 'label', '')) > 80 THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = format('rules.%s.label: up to 80 characters', v_i);
        END IF;
        IF COALESCE(v_rule ->> 'is_active', 'true') NOT IN ('true', 'false') THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = format('rules.%s.is_active: true or false', v_i);
        END IF;
        IF jsonb_typeof(COALESCE(v_rule -> 'unless_weekdays', '[]'::jsonb)) <> 'array'
           OR jsonb_array_length(COALESCE(v_rule -> 'unless_weekdays', '[]'::jsonb)) > 6
           OR EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(COALESCE(v_rule -> 'unless_weekdays', '[]'::jsonb)) d
                WHERE d !~ '^[0-6]$'
           ) THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = format('rules.%s.unless_weekdays: up to six weekdays, 0 (Sunday) to 6', v_i);
        END IF;
        SELECT COALESCE(array_agg(d::smallint ORDER BY d::smallint), '{}')
          INTO v_unless
          FROM (SELECT DISTINCT d FROM jsonb_array_elements_text(COALESCE(v_rule -> 'unless_weekdays', '[]'::jsonb)) d) x;

        v_bands := COALESCE(v_rule -> 'bands', '[]'::jsonb);
        IF jsonb_typeof(v_bands) <> 'array' OR jsonb_array_length(v_bands) > 6 THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = format('rules.%s.bands: up to six bands per rule', v_i);
        END IF;

        v_rule_id := CASE WHEN COALESCE(v_rule ->> 'id', '') ~ v_uuid_re THEN (v_rule ->> 'id')::uuid END;
        INSERT INTO scheduling.recurrence_rules (
            id, preset_id, kind, effect, rrule, starts_on, ends_on, priority, unless_weekdays, label,
            is_active, position
        ) VALUES (
            COALESCE(v_rule_id, gen_random_uuid()),
            v_id,
            (v_rule ->> 'kind')::scheduling.availability_kind,
            (v_rule ->> 'effect')::scheduling.rule_effect,
            v_rule ->> 'rrule',
            v_starts,
            v_ends,
            COALESCE(v_rule ->> 'priority', '50')::smallint,
            v_unless,
            COALESCE(v_rule ->> 'label', ''),
            COALESCE(v_rule ->> 'is_active', 'true')::boolean,
            v_i
        )
        RETURNING id INTO v_rule_id;

        v_j := 0;
        FOR v_band IN SELECT value FROM jsonb_array_elements(v_bands) LOOP
            IF COALESCE(v_band ->> 'start_minute', '') !~ '^[0-9]{1,4}$'
               OR COALESCE(v_band ->> 'end_minute', '') !~ '^[0-9]{1,4}$'
               OR (v_band ->> 'start_minute')::integer > 1439
               OR (v_band ->> 'end_minute')::integer > 1440
               OR (v_band ->> 'end_minute')::integer <= (v_band ->> 'start_minute')::integer THEN
                RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = format('rules.%s.bands.%s: a band ends after it starts, within one day', v_i, v_j);
            END IF;
            INSERT INTO scheduling.recurrence_rule_bands (rule_id, position, start_minute, end_minute)
            VALUES (v_rule_id, v_j, (v_band ->> 'start_minute')::integer, (v_band ->> 'end_minute')::integer);
            v_j := v_j + 1;
        END LOOP;

        v_i := v_i + 1;
    END LOOP;
    -- #endregion

    RETURN v_id;
END;
$$;

-- scheduling.archive_availability_preset — presets are archived, never deleted. Every blueprint bound
-- to the preset is unbound (it falls back to the schedule's default) and its id returned, so the
-- caller can name the services that moved. Archiving the default hands the default to the most
-- recently edited live library preset; the default cannot be archived while it is the only one.
--
-- SECURITY DEFINER: unbinding writes marketplace.service_blueprints, whose own write policies are not
-- the schedule's. The authority is fn_can_manage_schedule on the preset's schedule; a call with no
-- auth.uid() can only come from the service role (the grants in 00002510). Idempotent: an archived
-- preset returns an empty array.
CREATE OR REPLACE FUNCTION scheduling.archive_availability_preset(p_preset uuid)
RETURNS uuid[]
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_preset scheduling.availability_presets;
    v_next uuid;
    v_unbound uuid[];
BEGIN
    SELECT * INTO v_preset FROM scheduling.availability_presets p WHERE p.id = p_preset FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'preset: no such preset';
    END IF;
    IF auth.uid () IS NOT NULL AND NOT scheduling.fn_can_manage_schedule (v_preset.schedule_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'schedule: you cannot edit this schedule';
    END IF;
    IF v_preset.archived_at IS NOT NULL THEN
        RETURN '{}'::uuid[];
    END IF;

    IF v_preset.is_default THEN
        SELECT p.id INTO v_next
          FROM scheduling.availability_presets p
         WHERE p.schedule_id = v_preset.schedule_id
           AND p.scope = 'library'::scheduling.preset_scope
           AND p.archived_at IS NULL
           AND p.id <> p_preset
         ORDER BY p.updated_at DESC, p.id
         LIMIT 1;
        IF v_next IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = 'preset: the default preset cannot be archived while it is the only one';
        END IF;
    END IF;

    WITH unbound AS (
        UPDATE marketplace.service_blueprints b
           SET availability_preset_id = NULL
         WHERE b.availability_preset_id = p_preset
        RETURNING b.id
    )
    SELECT COALESCE(array_agg(u.id ORDER BY u.id), '{}'::uuid[]) INTO v_unbound FROM unbound u;

    UPDATE scheduling.availability_presets p
       SET archived_at = now(), is_default = false
     WHERE p.id = p_preset;
    IF v_next IS NOT NULL THEN
        UPDATE scheduling.availability_presets p SET is_default = true WHERE p.id = v_next;
    END IF;

    RETURN v_unbound;
END;
$$;

-- scheduling.replace_preset_occurrences — the service-role door the compiler writes through
-- (ScheduleBackendService.compileOccurrences, plan §5.6). Replaces every occurrence of the preset that
-- overlaps [p_from, p_to) with p_spans — OccurrenceSpanSchema elements: { kind, startsAt, endsAt,
-- ruleIds } — and stamps the compiled window: the preset-local dates wholly inside [p_from, p_to),
-- joined to the previous window when the two touch (a horizon extension), else replacing it.
--
-- Checks only what the database can know: each span is a layer, ends after it starts, lies inside the
-- window, and names only this preset's rules. Whether the spans are RIGHT is the evaluator's word.
-- SECURITY DEFINER and executable by service_role alone (00002510): there is no client write path to
-- availability_occurrences. Returns the number of spans written.
CREATE OR REPLACE FUNCTION scheduling.replace_preset_occurrences(
    p_preset uuid,
    p_from timestamptz,
    p_to timestamptz,
    p_spans jsonb
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tz text;
    v_cf date;
    v_ct date;
    v_from date;
    v_through date;
    v_count integer;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '400 days' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'window: a compile window ends after it starts, within 400 days';
    END IF;
    IF p_spans IS NULL OR jsonb_typeof(p_spans) <> 'array' OR jsonb_array_length(p_spans) > 10000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'spans: expected an array of at most 10000 spans';
    END IF;

    SELECT s.timezone, p.compiled_from, p.compiled_through INTO v_tz, v_cf, v_ct
      FROM scheduling.availability_presets p
      JOIN scheduling.schedules s ON s.id = p.schedule_id
     WHERE p.id = p_preset AND p.archived_at IS NULL
       FOR UPDATE OF p;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'preset: no live preset to compile';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_spans) e
         WHERE jsonb_typeof(e) <> 'object'
            OR COALESCE(e ->> 'kind', '') NOT IN ('working_hours', 'call_window')
            OR jsonb_typeof(e -> 'startsAt') IS DISTINCT FROM 'string'
            OR jsonb_typeof(e -> 'endsAt') IS DISTINCT FROM 'string'
            OR jsonb_typeof(COALESCE(e -> 'ruleIds', '[]'::jsonb)) <> 'array'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'spans: each span needs kind, startsAt, endsAt and ruleIds';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_spans) e
         WHERE (e ->> 'endsAt')::timestamptz <= (e ->> 'startsAt')::timestamptz
            OR (e ->> 'startsAt')::timestamptz < p_from
            OR (e ->> 'endsAt')::timestamptz > p_to
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'spans: each span ends after it starts, inside the window';
    END IF;

    DELETE FROM scheduling.availability_occurrences o
     WHERE o.preset_id = p_preset AND o.starts_at < p_to AND o.ends_at > p_from;

    INSERT INTO scheduling.availability_occurrences (preset_id, kind, starts_at, ends_at, rule_ids)
    SELECT p_preset,
           (e ->> 'kind')::scheduling.availability_kind,
           (e ->> 'startsAt')::timestamptz,
           (e ->> 'endsAt')::timestamptz,
           ARRAY(SELECT r::uuid FROM jsonb_array_elements_text(COALESCE(e -> 'ruleIds', '[]'::jsonb)) r)
      FROM jsonb_array_elements(p_spans) e;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF EXISTS (
        SELECT 1
          FROM scheduling.availability_occurrences o
          CROSS JOIN LATERAL unnest(o.rule_ids) AS rid
         WHERE o.preset_id = p_preset
           AND o.starts_at >= p_from AND o.ends_at <= p_to
           AND NOT EXISTS (
               SELECT 1 FROM scheduling.recurrence_rules r WHERE r.id = rid AND r.preset_id = p_preset
           )
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'spans: a span names a rule of another preset';
    END IF;

    v_from := (p_from AT TIME ZONE v_tz)::date
        + CASE WHEN (p_from AT TIME ZONE v_tz)::time = time '00:00' THEN 0 ELSE 1 END;
    v_through := (p_to AT TIME ZONE v_tz)::date - 1;
    IF v_through >= v_from THEN
        IF v_cf IS NOT NULL AND v_from <= v_ct + 1 AND v_through >= v_cf - 1 THEN
            v_from := LEAST(v_from, v_cf);
            v_through := GREATEST(v_through, v_ct);
        END IF;
        UPDATE scheduling.availability_presets p
           SET compiled_from = v_from, compiled_through = v_through
         WHERE p.id = p_preset;
    END IF;

    RETURN v_count;
END;
$$;
-- #endregion
