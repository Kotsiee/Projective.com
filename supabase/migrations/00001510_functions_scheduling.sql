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
-- (their creator, or seated and not having declined or left it unanswered: a link reaches only
-- somebody who is coming), and nothing for any other. These three columns are withheld from every
-- client role at the column level (00002520), because RLS is row-level: a member of a project may
-- see that a meeting exists and when, and a meeting link IS the access control for most providers.
-- The scheduling service reads the rest of the row under the caller's RLS and merges the room from
-- here, so the projection and the database can no longer disagree about who holds a link.
CREATE OR REPLACE FUNCTION scheduling.get_event_rooms (p_event_ids uuid[])
RETURNS TABLE (
    event_id uuid, meeting_url text, meeting_passcode text, meeting_details text, room_slug text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT e.id, e.meeting_url, e.meeting_passcode, e.meeting_details,
           (SELECT r.slug FROM scheduling.rooms r
             WHERE r.status = 'ready'
               AND (r.session_event_id = e.source_session_event_id
                    OR (r.event_id = e.id AND r.provider <> 'custom'))
             LIMIT 1)
      FROM scheduling.events e
     WHERE e.id = ANY (p_event_ids)
       AND auth.uid () IS NOT NULL
       AND cardinality(p_event_ids) <= 500
       AND (
           e.created_by = auth.uid ()
           OR EXISTS (
               SELECT 1 FROM scheduling.event_attendees a
               WHERE a.event_id = e.id AND a.user_id = auth.uid ()
                 AND a.response IN (
                     'accepted'::scheduling.rsvp_response, 'tentative'::scheduling.rsvp_response
                 )
           )
       );
$$;

-- What the caller's connected calendars say about their own entries (Decision #387).
-- connected_event_details has no client grant, so this door is its only way out, and it answers the
-- schedule's owner alone: not a platform admin, who may read the row itself.
CREATE OR REPLACE FUNCTION scheduling.get_own_event_details (p_event_ids uuid[])
RETURNS TABLE (
    event_id uuid, title text, location text, description text, series_id text, recurrence_rule text,
    join_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT d.event_id, d.title, d.location, d.description, d.series_id, d.recurrence_rule, d.join_url
      FROM scheduling.connected_event_details d
      JOIN scheduling.events e ON e.id = d.event_id
      JOIN scheduling.schedules s ON s.id = e.schedule_id
     WHERE d.event_id = ANY (p_event_ids)
       AND cardinality(p_event_ids) <= 500
       AND s.owner_type = 'user'
       AND s.owner_id = auth.uid ()
       AND e.archived_at IS NULL;
$$;

-- The rooms of the caller's own confirmed calls, by their address. A call's URL is withheld from
-- clients at the column level (00002520), like an event's, and a party joins through /meet.
CREATE OR REPLACE FUNCTION scheduling.get_call_rooms (p_call_ids uuid[])
RETURNS TABLE (call_id uuid, room_slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT c.id, r.slug
      FROM scheduling.discovery_calls c
      JOIN scheduling.rooms r ON r.call_id = c.id AND r.status = 'ready'
     WHERE c.id = ANY (p_call_ids)
       AND auth.uid () IN (c.host_user_id, c.requester_user_id)
       AND c.status = 'confirmed'::scheduling.call_status
       AND cardinality(p_call_ids) <= 500;
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
    p_schedule uuid, p_starts_at timestamptz, p_ends_at timestamptz,
    -- A call moving its own time must not be refused for overlapping itself.
    p_exclude_call uuid DEFAULT NULL
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
           AND c.id IS DISTINCT FROM p_exclude_call
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
    p_ends_at timestamptz,
    -- The call being moved (scheduling.propose_call_time): it is judged without counting itself.
    p_exclude_call uuid DEFAULT NULL
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

    IF NOT scheduling.fn_slot_is_free (p_schedule, p_starts_at, p_ends_at, p_exclude_call) THEN
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
               AND COALESCE(c.confirmed_start, c.proposed_start) <  v_week + interval '7 days'
               AND c.id IS DISTINCT FROM p_exclude_call;

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
               )
               AND c.id IS DISTINCT FROM p_exclude_call;

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

-- A recurring series (scheduling.events recurrence_rule / recurrence_parent_id) is one level deep and
-- lives on one anchor: an occurrence names a MASTER (a row with a rule) on the same schedule and
-- project, and a master that still has occurrences keeps its rule and its anchor. The table's CHECKs
-- state the rest (an occurrence carries no rule, and never names itself). FOR SHARE holds the master
-- while an occurrence attaches, so a concurrent edit dropping its rule waits and then sees the child.
--
-- SECURITY DEFINER so neither lookup depends on the caller's RLS: a manager editing a master must not
-- pass the occurrence check because an occurrence is hidden from them. The body is two key lookups on
-- scheduling.events; nothing a caller supplies reaches dynamic SQL.
CREATE OR REPLACE FUNCTION scheduling.fn_guard_event_recurrence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.recurrence_parent_id IS NOT NULL THEN
        PERFORM 1 FROM scheduling.events m
         WHERE m.id = NEW.recurrence_parent_id
           AND m.recurrence_rule IS NOT NULL
           AND m.schedule_id IS NOT DISTINCT FROM NEW.schedule_id
           AND m.project_id IS NOT DISTINCT FROM NEW.project_id
           FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'recurrence_parent_id: not a recurring event on this calendar';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.recurrence_rule IS NOT NULL
       AND (NEW.recurrence_rule IS NULL OR NEW.schedule_id IS DISTINCT FROM OLD.schedule_id
            OR NEW.project_id IS DISTINCT FROM OLD.project_id)
       AND EXISTS (SELECT 1 FROM scheduling.events o WHERE o.recurrence_parent_id = OLD.id) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'recurrence_rule: this series still has occurrences';
    END IF;
    RETURN NEW;
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
    ELSIF NEW.proposed_start IS DISTINCT FROM OLD.proposed_start THEN
        -- A new time on a call still `proposed` is a move with no change of status.
        INSERT INTO scheduling.call_audit (
            call_id, action, actor_user_id, from_status, to_status, slot_start, slot_end
        ) VALUES (
            NEW.id, 'rescheduled'::scheduling.call_action, auth.uid (), OLD.status, NEW.status,
            NEW.proposed_start, NEW.proposed_end
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
-- #endregion

-- #region 7. Expiring unanswered requests (audit S-11; Decision #343, ruling C3)
-- A `proposed` call holds its slot: free/busy, the booking gate and both agendas count it until it is
-- answered. Nothing used to answer for the host who never did, so a request held the time for good,
-- and one account could hold every slot of a calendar out to its booking horizon. This sweep moves a
-- request to `expired` once it has waited `discovery_call_proposal_ttl_hours` since `proposed_at`, or
-- once its proposed start has come, whichever is first, and tells both people.
--
-- The transition trigger checks nothing for a writer without `auth.uid()`, and the job has none, so
-- the WHERE clause is the only guard: still `proposed`, and past one of the two times. The candidate
-- rows are taken FOR UPDATE SKIP LOCKED, so two overlapping runs never take one call and a call being
-- answered right now waits for the next run; a row that changed before its lock is re-read and dropped
-- if it no longer qualifies. A run takes at most `p_limit` calls and returns how many expired. A
-- second run finds nothing left to expire and tells nobody again.
--
-- Registered by name as the `scheduling-expire-discovery-calls` job (00005060), every 15 minutes.
CREATE OR REPLACE FUNCTION scheduling.fn_expire_discovery_calls(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ttl integer;
    v_now timestamptz := pg_catalog.now();
    r record;
    v_count integer := 0;
BEGIN
    v_ttl := COALESCE((
        SELECT (pp.value #>> '{}')::integer
          FROM security.platform_params pp
         WHERE pp.key = 'discovery_call_proposal_ttl_hours'
    ), 72);

    FOR r IN
        SELECT c.id, c.host_user_id, c.requester_user_id, c.proposed_start, c.proposed_end
          FROM scheduling.discovery_calls c
         WHERE c.status = 'proposed'::scheduling.call_status
           AND (c.proposed_at + pg_catalog.make_interval(hours => v_ttl) <= v_now
                OR c.proposed_start <= v_now)
         ORDER BY c.proposed_start, c.id
         LIMIT GREATEST(COALESCE(p_limit, 500), 1)
           FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE scheduling.discovery_calls
           SET status = 'expired'::scheduling.call_status
         WHERE id = r.id
           AND status = 'proposed'::scheduling.call_status;
        CONTINUE WHEN NOT FOUND;

        PERFORM comms.fn_notify(
            r.requester_user_id, 'call.expired', 'Your call request expired',
            'It wasn''t confirmed in time. You can request another time.',
            'scheduling.discovery_calls', r.id,
            pg_catalog.jsonb_build_object('starts_at', r.proposed_start, 'ends_at', r.proposed_end, 'party', 'requester')
        );
        PERFORM comms.fn_notify(
            r.host_user_id, 'call.expired', 'A call request expired',
            'It wasn''t answered in time, so that time is open on your calendar again.',
            'scheduling.discovery_calls', r.id,
            pg_catalog.jsonb_build_object('starts_at', r.proposed_start, 'ends_at', r.proposed_end, 'party', 'host')
        );
        PERFORM comms.fn_cancel_queued(NULL, 'scheduling.discovery_calls', r.id);
        v_count := v_count + 1;
    END LOOP;

    -- A courtesy call past its end is over (Decision #343, ruling C3). A paid call never completes
    -- here: it completes through its sitting.
    FOR r IN
        SELECT c.id
          FROM scheduling.discovery_calls c
         WHERE c.status = 'confirmed'::scheduling.call_status
           AND c.call_type = 'courtesy'::scheduling.call_type
           AND c.confirmed_end <= v_now
         ORDER BY c.confirmed_end, c.id
         LIMIT GREATEST(COALESCE(p_limit, 500), 1)
           FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE scheduling.discovery_calls
           SET status = 'completed'::scheduling.call_status
         WHERE id = r.id
           AND status = 'confirmed'::scheduling.call_status;
        CONTINUE WHEN NOT FOUND;
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION scheduling.fn_expire_discovery_calls(integer) IS
'The discovery-call sweep (audit S-11, ruling C3): completes each courtesy call past its end, and moves each proposed call past discovery_call_proposal_ttl_hours or its proposed start to expired, and tells both parties (call.expired). SKIP LOCKED batches of at most p_limit; idempotent. Service role / pg_cron only.';
-- #endregion

-- #region 7b. The discovery-call doors (audit S-10; Decision #343, ruling C3)
-- There is no client write on this table (00002015), so each door below is the only way to make its
-- move. A door locks the call and names who may act and from which state; the change of state stays
-- with fn_enforce_call_transition, the legality authority, which stamps everything derived. A refusal
-- is the 'Discovery call refused: <code>' shape BookingBackendService turns into a sentence.

-- The call a door acts on, locked. A stranger and a missing call are refused alike, so an id cannot
-- be probed.
CREATE OR REPLACE FUNCTION scheduling.fn_lock_call(p_call uuid)
RETURNS scheduling.discovery_calls
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    c scheduling.discovery_calls;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Discovery call refused: not_signed_in' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO c FROM scheduling.discovery_calls WHERE id = p_call FOR UPDATE;
    IF NOT FOUND OR v_uid NOT IN (c.host_user_id, c.requester_user_id) THEN
        RAISE EXCEPTION 'Discovery call refused: call_not_found' USING ERRCODE = 'check_violation';
    END IF;
    RETURN c;
END;
$$;

-- Tell one party, with the slot the notice is about. The caller is recorded as the actor rather than
-- named in the text.
CREATE OR REPLACE FUNCTION scheduling.fn_notify_call(
    p_call scheduling.discovery_calls,
    p_to uuid,
    p_type text,
    p_title text,
    p_body text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM comms.fn_notify(
        p_to, p_type, p_title, p_body, 'scheduling.discovery_calls', p_call.id,
        pg_catalog.jsonb_build_object(
            'starts_at', COALESCE(p_call.confirmed_start, p_call.proposed_start),
            'ends_at', COALESCE(p_call.confirmed_end, p_call.proposed_end),
            'party', CASE WHEN p_to = p_call.host_user_id THEN 'host' ELSE 'requester' END
        ),
        auth.uid()
    );
END;
$$;

-- The counterparty of the last proposal accepts it (Decision #383, SCH-WP3): the host a request or
-- the requester's new time, the requester the host's new time.
CREATE OR REPLACE FUNCTION scheduling.confirm_discovery_call(p_call uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    c scheduling.discovery_calls;
    v_accepter uuid;
    v_other uuid;
BEGIN
    c := scheduling.fn_lock_call(p_call);
    IF c.status <> 'proposed'::scheduling.call_status THEN
        RAISE EXCEPTION 'Discovery call refused: not_open' USING ERRCODE = 'check_violation';
    END IF;
    v_accepter := CASE WHEN c.proposed_by = 'requester'::scheduling.call_party
        THEN c.host_user_id ELSE c.requester_user_id END;
    IF v_uid <> v_accepter THEN
        RAISE EXCEPTION 'Discovery call refused: not_your_move' USING ERRCODE = 'check_violation';
    END IF;
    IF c.proposed_start <= pg_catalog.now() THEN
        RAISE EXCEPTION 'Discovery call refused: slot_passed' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE scheduling.discovery_calls
       SET status = 'confirmed'::scheduling.call_status,
           confirmed_start = c.proposed_start,
           confirmed_end = c.proposed_end
     WHERE id = p_call
    RETURNING * INTO c;

    v_other := CASE WHEN v_uid = c.host_user_id THEN c.requester_user_id ELSE c.host_user_id END;
    PERFORM scheduling.fn_notify_call(c, v_other, 'call.confirmed', 'Your call is confirmed',
        'The time is agreed, and it is on your calendar.');
    RETURN pg_catalog.jsonb_build_object('id', c.id, 'status', c.status);
END;
$$;

-- The host says no, at any time while the call is proposed. A paid call's refund is SCH-WP6's.
CREATE OR REPLACE FUNCTION scheduling.decline_discovery_call(p_call uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    c scheduling.discovery_calls;
BEGIN
    c := scheduling.fn_lock_call(p_call);
    IF c.status <> 'proposed'::scheduling.call_status THEN
        RAISE EXCEPTION 'Discovery call refused: not_open' USING ERRCODE = 'check_violation';
    END IF;
    IF v_uid <> c.host_user_id THEN
        RAISE EXCEPTION 'Discovery call refused: not_your_move' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE scheduling.discovery_calls
       SET status = 'declined'::scheduling.call_status,
           cancellation_reason = NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_reason, '')), 280), '')
     WHERE id = p_call
    RETURNING * INTO c;

    PERFORM comms.fn_cancel_queued(NULL, 'scheduling.discovery_calls', p_call);
    PERFORM scheduling.fn_notify_call(c, c.requester_user_id, 'call.declined',
        'Your call request was declined', 'You can request another time.');
    RETURN pg_catalog.jsonb_build_object('id', c.id, 'status', c.status);
END;
$$;

-- Either side moves a proposed or confirmed call, outside the lockout at both ends. The 12 hours is
-- the courtesy lockout, pinned to RESCHEDULE_LOCKOUT_HOURS by coordination.contract.test.ts until
-- SCH-WP7 makes it a parameter. The new slot keeps the call's length and passes the request gate
-- again, judged without the call itself. A moved call waits for its counterparty, so it leaves
-- `confirmed` and the old slot is free the moment this commits.
CREATE OR REPLACE FUNCTION scheduling.propose_call_time(
    p_call uuid,
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
    v_lockout interval := interval '12 hours';
    v_limit timestamptz := pg_catalog.now() + v_lockout;
    c scheduling.discovery_calls;
    v_party scheduling.call_party;
    v_other uuid;
    v_start timestamptz;
    v_end timestamptz;
    v_reason text;
BEGIN
    c := scheduling.fn_lock_call(p_call);
    IF c.status NOT IN ('proposed'::scheduling.call_status, 'confirmed'::scheduling.call_status) THEN
        RAISE EXCEPTION 'Discovery call refused: not_open' USING ERRCODE = 'check_violation';
    END IF;
    v_start := COALESCE(c.confirmed_start, c.proposed_start);
    v_end := COALESCE(c.confirmed_end, c.proposed_end);
    IF v_start <= v_limit OR p_starts_at <= v_limit THEN
        RAISE EXCEPTION 'Discovery call refused: inside_lockout' USING ERRCODE = 'check_violation';
    END IF;
    IF p_ends_at - p_starts_at <> v_end - v_start THEN
        RAISE EXCEPTION 'Discovery call refused: duration_mismatch' USING ERRCODE = 'check_violation';
    END IF;

    -- The lock every booking of this schedule takes, so a move and a request cannot land on one slot.
    PERFORM 1 FROM scheduling.schedules WHERE id = c.host_schedule_id FOR UPDATE;
    v_reason := scheduling.fn_call_request_refusal(
        c.host_schedule_id, c.requester_user_id, c.call_type, p_starts_at, p_ends_at, c.id
    );
    IF v_reason IS NOT NULL THEN
        RAISE EXCEPTION 'Discovery call refused: %', v_reason USING ERRCODE = 'check_violation';
    END IF;

    v_party := CASE WHEN v_uid = c.host_user_id
        THEN 'host'::scheduling.call_party ELSE 'requester'::scheduling.call_party END;
    v_other := CASE WHEN v_uid = c.host_user_id THEN c.requester_user_id ELSE c.host_user_id END;

    -- A confirmed call's count moves in fn_enforce_call_transition; a proposed one changes no status.
    UPDATE scheduling.discovery_calls
       SET status = 'proposed'::scheduling.call_status,
           proposed_start = p_starts_at,
           proposed_end = p_ends_at,
           proposed_by = v_party,
           proposed_at = pg_catalog.now(),
           reschedule_count = c.reschedule_count
               + CASE WHEN c.status = 'proposed'::scheduling.call_status THEN 1 ELSE 0 END
     WHERE id = p_call
    RETURNING * INTO c;

    PERFORM comms.fn_cancel_queued(NULL, 'scheduling.discovery_calls', p_call);
    PERFORM scheduling.fn_notify_call(c, v_other, 'call.time_proposed',
        'A new time was proposed for your call', 'Confirm it or propose another from your calendar.');
    RETURN pg_catalog.jsonb_build_object('id', c.id, 'status', c.status);
END;
$$;

-- Either side cancels a confirmed call, and a requester may withdraw a proposed one. Whether it was
-- late is derived by fn_enforce_call_transition, never claimed here.
CREATE OR REPLACE FUNCTION scheduling.cancel_discovery_call(p_call uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    c scheduling.discovery_calls;
    v_party scheduling.call_party;
    v_other uuid;
BEGIN
    c := scheduling.fn_lock_call(p_call);
    v_party := CASE WHEN v_uid = c.host_user_id
        THEN 'host'::scheduling.call_party ELSE 'requester'::scheduling.call_party END;
    v_other := CASE WHEN v_uid = c.host_user_id THEN c.requester_user_id ELSE c.host_user_id END;
    IF NOT (
        c.status = 'confirmed'::scheduling.call_status
        OR (c.status = 'proposed'::scheduling.call_status AND v_party = 'requester'::scheduling.call_party)
    ) THEN
        RAISE EXCEPTION 'Discovery call refused: not_open' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(c.confirmed_end, c.proposed_end) <= pg_catalog.now() THEN
        RAISE EXCEPTION 'Discovery call refused: slot_passed' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE scheduling.discovery_calls
       SET status = 'cancelled'::scheduling.call_status,
           cancelled_by = v_party,
           cancellation_reason = NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_reason, '')), 280), '')
     WHERE id = p_call
    RETURNING * INTO c;

    PERFORM comms.fn_cancel_queued(NULL, 'scheduling.discovery_calls', p_call);
    PERFORM scheduling.fn_notify_call(c, v_other, 'call.cancelled', 'Your call was cancelled',
        'That time is open on your calendar again.');
    RETURN pg_catalog.jsonb_build_object('id', c.id, 'status', c.status);
END;
$$;

-- A party reports the other as a no-show, from session_presence_minutes after the start. Where the
-- room reported attendance, a mark that evidence contradicts is refused: "where the call is tracked"
-- (ruling C3). A party never marks themselves.
CREATE OR REPLACE FUNCTION scheduling.mark_call_no_show(p_call uuid, p_party scheduling.call_party)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    c scheduling.discovery_calls;
    v_named uuid;
    v_opens timestamptz;
BEGIN
    c := scheduling.fn_lock_call(p_call);
    IF c.status <> 'confirmed'::scheduling.call_status THEN
        RAISE EXCEPTION 'Discovery call refused: not_open' USING ERRCODE = 'check_violation';
    END IF;
    v_named := CASE p_party
        WHEN 'host'::scheduling.call_party THEN c.host_user_id
        WHEN 'requester'::scheduling.call_party THEN c.requester_user_id
    END;
    IF v_named IS NULL OR v_named = v_uid THEN
        RAISE EXCEPTION 'Discovery call refused: not_your_move' USING ERRCODE = 'check_violation';
    END IF;
    v_opens := c.confirmed_start + pg_catalog.make_interval(
        mins => projects.fn_session_param('session_presence_minutes', 15));
    IF pg_catalog.now() < v_opens THEN
        RAISE EXCEPTION 'Discovery call refused: too_early' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
        SELECT 1 FROM scheduling.call_attendance a
         WHERE a.call_id = c.id AND a.user_id = v_named AND a.joined_at <= v_opens
    ) THEN
        RAISE EXCEPTION 'Discovery call refused: attendance_contradicts' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE scheduling.discovery_calls
       SET status = 'no_show'::scheduling.call_status,
           no_show_party = p_party
     WHERE id = p_call
    RETURNING * INTO c;

    PERFORM comms.fn_cancel_queued(NULL, 'scheduling.discovery_calls', p_call);
    PERFORM scheduling.fn_notify_call(c, v_named, 'call.no_show', 'You were reported as a no-show',
        'The other person says you did not join the call.');
    RETURN pg_catalog.jsonb_build_object('id', c.id, 'status', c.status);
END;
$$;

-- The owner's Availability editor reads its whole row here (audit S-16): the client grant covers only
-- what a call offer shows, so a signed-in stranger cannot read the caps, the cooldown or auto_confirm.
CREATE OR REPLACE FUNCTION scheduling.get_own_call_settings(p_schedule uuid)
RETURNS SETOF scheduling.call_settings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT s.*
      FROM scheduling.call_settings s
     WHERE s.schedule_id = p_schedule
       AND scheduling.fn_can_manage_schedule(p_schedule);
$$;
-- #endregion

-- #region 7c. Reminders (audit S-18)
-- The producer behind the session.reminder_* and call.reminder notices: everything starting soon is
-- queued through comms.fn_enqueue, and comms-process-queue delivers it. The dedupe key names the
-- person as well as the entity, because each recipient holds a row of their own and the queue's
-- unique index is on the key alone, so a second pass adds nothing. A promise the entity no longer
-- keeps (moved, cancelled) is withdrawn first and queued again at the new time if it is still due;
-- the door that cancels does this at once, so this is the backstop for any other writer.

-- Whether an entry takes a person's alerts at all (Decision #388); `takesReminders` in
-- @projective/types/scheduling is this rule in TypeScript. A connected calendar's row already alerts
-- through its provider, a sitting has its own T-60, T-15 and T-5 below, and an open slot, a busy block
-- or leave has nobody to remind.
CREATE OR REPLACE FUNCTION scheduling.fn_event_takes_reminders(e scheduling.events)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT e.source_connection_id IS NULL
       AND e.source_session_event_id IS NULL
       AND e.archived_at IS NULL
       AND COALESCE(e.status, 'confirmed'::scheduling.event_status) <> 'cancelled'::scheduling.event_status
       AND e.kind NOT IN (
           'availability'::scheduling.event_kind,
           'busy'::scheduling.event_kind,
           'holiday'::scheduling.event_kind
       );
$$;

-- A stored list of alerts as rows. Clients write both stores through PostgREST, so a malformed element
-- is skipped here rather than failing the sweep for everyone; Zod refuses one on the normal path. The
-- inner query tests the text before anything casts it, and DISTINCT keeps the planner from moving the
-- cast above that test.
CREATE OR REPLACE FUNCTION scheduling.fn_reminder_rows(p_reminders jsonb)
RETURNS TABLE (minutes integer, channel text)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT s.m, s.c
      FROM (
          SELECT DISTINCT (r ->> 'minutes')::integer AS m, r ->> 'channel' AS c
            FROM pg_catalog.jsonb_array_elements(
                     CASE WHEN pg_catalog.jsonb_typeof(p_reminders) = 'array'
                          THEN p_reminders ELSE '[]'::jsonb END
                 ) AS r
           WHERE r ->> 'minutes' ~ '^[0-9]{1,5}$'
             AND r ->> 'channel' IN ('in_app', 'email')
      ) s
     WHERE s.m <= 10080
     ORDER BY s.m, s.c
     LIMIT 5;
$$;

-- One person's alerts for one entry: their own list for it, else their default, else the platform's.
-- That last list is DEFAULT_ENTRY_REMINDERS, held equal by reminders.test.ts. DEFINER, because the sweep
-- reads every person's preferences and answers for nobody.
CREATE OR REPLACE FUNCTION scheduling.fn_event_alerts(p_event uuid, p_user uuid)
RETURNS TABLE (minutes integer, channel text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT a.minutes, a.channel
      FROM scheduling.fn_reminder_rows(COALESCE(
               (SELECT er.reminders FROM scheduling.event_reminders er
                 WHERE er.event_id = p_event AND er.user_id = p_user),
               (SELECT up.ui_settings -> 'calendar_reminders' FROM org.user_preferences up
                 WHERE up.user_id = p_user),
               '[{"minutes":10,"channel":"in_app"}]'::jsonb
           )) AS a;
$$;

-- "In 10 minutes", in the largest whole unit, for a notification that goes out in no particular zone.
CREATE OR REPLACE FUNCTION scheduling.fn_reminder_words(p_minutes integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_minutes <= 0 THEN 'Now'
        WHEN p_minutes % 1440 = 0 THEN pg_catalog.format(
            'In %s %s', p_minutes / 1440, CASE WHEN p_minutes = 1440 THEN 'day' ELSE 'days' END)
        WHEN p_minutes % 60 = 0 THEN pg_catalog.format(
            'In %s %s', p_minutes / 60, CASE WHEN p_minutes = 60 THEN 'hour' ELSE 'hours' END)
        ELSE pg_catalog.format(
            'In %s %s', p_minutes, CASE WHEN p_minutes = 1 THEN 'minute' ELSE 'minutes' END)
    END;
$$;

CREATE OR REPLACE FUNCTION scheduling.fn_enqueue_due_reminders()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now timestamptz := pg_catalog.now();
    v_call_lead interval;
    v_horizon timestamptz;
    v_at timestamptz;
    v_count integer := 0;
    -- An entry's alert is queued this far ahead, so a move has little to withdraw.
    v_ahead interval := interval '15 minutes';
    -- How late an alert may still go: one sweep, the worst a tick can fall behind a new entry.
    v_late interval := interval '5 minutes';
    v_key text;
    r record;
    t record;
    u uuid;
BEGIN
    v_call_lead := pg_catalog.make_interval(mins => COALESCE((
        SELECT (pp.value #>> '{}')::integer
          FROM security.platform_params pp
         WHERE pp.key = 'discovery_call_reminder_lead_minutes'
    ), 60));
    v_horizon := v_now + GREATEST(interval '2 hours', v_call_lead + interval '10 minutes');

    PERFORM comms.fn_cancel_queued(q.dedupe_key)
       FROM comms.notification_queue q
      WHERE q.status = 'scheduled'
        AND q.dedupe_key LIKE 'sitting:%'
        AND NOT EXISTS (
            SELECT 1 FROM projects.session_events e
             WHERE e.id = q.entity_id
               AND e.status = 'scheduled'::projects.session_event_status
               AND e.start_time = (q.payload ->> 'starts_at')::timestamptz
        );
    PERFORM comms.fn_cancel_queued(q.dedupe_key)
       FROM comms.notification_queue q
      WHERE q.status = 'scheduled'
        AND q.dedupe_key LIKE 'call:%'
        AND NOT EXISTS (
            SELECT 1 FROM scheduling.discovery_calls c
             WHERE c.id = q.entity_id
               AND c.status = 'confirmed'::scheduling.call_status
               AND c.confirmed_start = (q.payload ->> 'starts_at')::timestamptz
        );

    FOR r IN
        SELECT e.id, e.title, e.start_time, e.cohort_id, c.project_id, p.owner_user_id
          FROM projects.session_events e
          JOIN projects.cohorts c ON c.id = e.cohort_id
          JOIN projects.projects p ON p.id = c.project_id
         WHERE e.status = 'scheduled'::projects.session_event_status
           AND e.start_time > v_now
           AND e.start_time <= v_horizon
         ORDER BY e.start_time, e.id
    LOOP
        FOR t IN
            SELECT nt.key, nt.default_lead_time
              FROM comms.notification_types nt
             WHERE nt.key IN ('session.reminder_60m', 'session.reminder_15m', 'session.reminder_5m')
               AND nt.default_lead_time IS NOT NULL
        LOOP
            v_at := r.start_time - t.default_lead_time;
            CONTINUE WHEN v_at <= v_now;
            FOR u IN
                SELECT r.owner_user_id WHERE r.owner_user_id IS NOT NULL
                UNION
                SELECT cm.user_id
                  FROM projects.cohort_memberships cm
                 WHERE cm.cohort_id = r.cohort_id AND cm.status = 'active'
            LOOP
                PERFORM comms.fn_enqueue(
                    u, t.key, 'Your session starts soon',
                    pg_catalog.format('"%s" starts at the time on your calendar.', r.title),
                    v_at, pg_catalog.format('sitting:%s:%s:%s', r.id, t.key, u),
                    'projects.session_events', r.id,
                    pg_catalog.jsonb_build_object('starts_at', r.start_time),
                    'project', r.project_id, NULL, NULL, 'reminder'
                );
                v_count := v_count + 1;
            END LOOP;
        END LOOP;
    END LOOP;

    FOR r IN
        SELECT c.id, c.host_user_id, c.requester_user_id, c.confirmed_start
          FROM scheduling.discovery_calls c
         WHERE c.status = 'confirmed'::scheduling.call_status
           AND c.confirmed_start > v_now
           AND c.confirmed_start <= v_horizon
         ORDER BY c.confirmed_start, c.id
    LOOP
        v_at := r.confirmed_start - v_call_lead;
        CONTINUE WHEN v_at <= v_now;
        FOREACH u IN ARRAY ARRAY[r.host_user_id, r.requester_user_id] LOOP
            PERFORM comms.fn_enqueue(
                u, 'call.reminder', 'Your call starts soon',
                'It is at the time on your calendar.',
                v_at, pg_catalog.format('call:%s:%s', r.id, u),
                'scheduling.discovery_calls', r.id,
                pg_catalog.jsonb_build_object('starts_at', r.confirmed_start),
                NULL, NULL, NULL, NULL, 'reminder'
            );
            v_count := v_count + 1;
        END LOOP;
    END LOOP;

    -- An entry's alerts (Decision #388), one row per person per alert, and one catalog type per
    -- channel so `email` and `in_app` each stay narrowed by the person's own preferences. The start is
    -- in the key, so an entry moved after its alert went out alerts again. An alert the sweep reaches
    -- late (an entry made inside its own lead) still goes, once: the sent row is the proof it did.
    -- shortcut: each sweep expands every entry of the coming week per person; store a next-alert time
    -- on a row if this job's runtime ever shows in ops.scheduled_jobs.
    PERFORM comms.fn_cancel_queued(q.dedupe_key)
       FROM comms.notification_queue q
      WHERE q.status = 'scheduled'
        AND q.dedupe_key LIKE 'entry:%'
        AND NOT EXISTS (
            SELECT 1
              FROM scheduling.events e
             CROSS JOIN LATERAL scheduling.fn_event_alerts(e.id, q.user_id) AS a
             WHERE e.id = q.entity_id
               AND scheduling.fn_event_takes_reminders(e)
               AND e.starts_at = (q.payload ->> 'starts_at')::timestamptz
               AND a.minutes = (q.payload ->> 'minutes')::integer
               AND a.channel = q.payload ->> 'channel'
               AND q.user_id IN (SELECT scheduling.fn_event_holders(e.id))
        );

    FOR r IN
        SELECT e.id, e.title, e.starts_at, e.project_id, h.user_id, a.minutes, a.channel,
               e.starts_at - pg_catalog.make_interval(mins => a.minutes) AS fire_at
          FROM scheduling.events e
         CROSS JOIN LATERAL scheduling.fn_event_holders(e.id) AS h(user_id)
         CROSS JOIN LATERAL scheduling.fn_event_alerts(e.id, h.user_id) AS a
         WHERE e.archived_at IS NULL
           AND e.starts_at > v_now - v_late
           AND e.starts_at <= v_now + v_ahead + interval '7 days'
           AND scheduling.fn_event_takes_reminders(e)
           AND e.starts_at - pg_catalog.make_interval(mins => a.minutes) <= v_now + v_ahead
           -- A call drawn from this row alerts as the call, above.
           AND NOT EXISTS (SELECT 1 FROM scheduling.discovery_calls c WHERE c.event_id = e.id)
         ORDER BY e.starts_at, e.id
    LOOP
        v_key := pg_catalog.format(
            'entry:%s:%s:%s:%s:%s', r.id, r.user_id, r.minutes, r.channel,
            EXTRACT(EPOCH FROM r.starts_at)::bigint
        );
        CONTINUE WHEN r.fire_at <= v_now AND EXISTS (
            SELECT 1 FROM comms.notification_queue q
             WHERE q.entity_table = 'scheduling.events' AND q.entity_id = r.id
               AND q.dedupe_key = v_key
               AND q.status IN ('sent'::comms.queue_status, 'failed'::comms.queue_status)
        );
        v_at := GREATEST(r.fire_at, v_now);
        PERFORM comms.fn_enqueue(
            r.user_id,
            CASE r.channel WHEN 'email' THEN 'event.reminder_email' ELSE 'event.reminder' END,
            COALESCE(NULLIF(r.title, ''), 'Your calendar entry'),
            scheduling.fn_reminder_words(
                CEIL(EXTRACT(EPOCH FROM r.starts_at - v_at) / 60)::integer
            ),
            v_at, v_key, 'scheduling.events', r.id,
            pg_catalog.jsonb_build_object(
                'starts_at', r.starts_at, 'minutes', r.minutes, 'channel', r.channel
            ),
            CASE WHEN r.project_id IS NULL THEN NULL ELSE 'project' END, r.project_id,
            NULL, NULL, 'reminder'
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION scheduling.fn_enqueue_due_reminders() IS
'The reminder producer (audit S-18, Decision #388): queues the reminders of every scheduled sitting, confirmed call and calendar entry coming up, one row per person per alert, and withdraws any the entity no longer keeps. Safe to repeat: a row is keyed on the entity, the reminder and the person.';
-- #endregion

-- #region 7d. Rooms (Decision #343, ruling C4; Decision #383)
-- Whatever creates a sitting or confirms a call queues its room here, so no booking door has to know
-- about rooms. The app mints (it holds the tokens): it claims what is due, calls the provider and
-- attaches the answer, all through the service-role doors below. Nothing here is client-readable.

-- A new sitting carries its listing's provider, else the host's connected default.
CREATE OR REPLACE FUNCTION scheduling.fn_sitting_provider()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.meeting_provider IS NULL THEN
        SELECT COALESCE(b.meeting_provider, integrations.fn_conferencing_provider(
                   COALESCE(p.owner_user_id, scheduling.fn_schedule_host(projects.fn_session_host_schedule(p.id)))
               ))
          INTO NEW.meeting_provider
          FROM projects.cohorts c
          JOIN projects.projects p ON p.id = c.project_id
          LEFT JOIN marketplace.service_blueprints b ON b.id = p.source_blueprint_id
         WHERE c.id = NEW.cohort_id;
        -- A Microsoft connection makes Teams rooms.
        IF NEW.meeting_provider = 'outlook' THEN
            NEW.meeting_provider := 'microsoft_teams';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- A sitting's room follows the sitting: queued with it, closed with it, updated when it moves. A room
-- that arrives already named (a manual link, a probe's fixture) has nothing to mint.
CREATE OR REPLACE FUNCTION scheduling.fn_sync_sitting_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.meeting_provider IS NOT NULL THEN
            INSERT INTO scheduling.rooms (session_event_id, provider, provider_meeting_id, status)
            VALUES (
                NEW.id, NEW.meeting_provider, NEW.provider_meeting_id,
                CASE WHEN NEW.provider_meeting_id IS NOT NULL OR NEW.meeting_provider = 'custom'
                     THEN 'ready' ELSE 'pending' END
            );
        END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status
          AND NEW.status::text IN ('cancelled_by_freelancer', 'cancelled_by_client') THEN
        UPDATE scheduling.rooms
           SET status = CASE WHEN status = 'ready' AND provider <> 'custom' THEN 'closing' ELSE 'closed' END
         WHERE session_event_id = NEW.id AND status NOT IN ('closing', 'closed');
    ELSIF NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time THEN
        UPDATE scheduling.rooms SET moved_at = pg_catalog.now()
         WHERE session_event_id = NEW.id AND status = 'ready' AND provider <> 'custom';
    END IF;
    RETURN NULL;
END;
$$;

-- A call gets its room when it is confirmed, and a confirmed call that moved updates the room it has.
CREATE OR REPLACE FUNCTION scheduling.fn_sync_call_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'confirmed'::scheduling.call_status
       AND NEW.provider_slug IN ('google', 'outlook', 'zoom', 'microsoft_teams', 'discord') THEN
        INSERT INTO scheduling.rooms (call_id, provider)
        VALUES (NEW.id, NEW.provider_slug)
        ON CONFLICT (call_id) DO UPDATE
           SET moved_at = pg_catalog.now()
         WHERE scheduling.rooms.status = 'ready';
    ELSIF NEW.status IN (
        'declined'::scheduling.call_status, 'cancelled'::scheduling.call_status,
        'expired'::scheduling.call_status
    ) THEN
        UPDATE scheduling.rooms
           SET status = CASE WHEN status = 'ready' THEN 'closing' ELSE 'closed' END
         WHERE call_id = NEW.id AND status NOT IN ('closing', 'closed');
    END IF;
    RETURN NULL;
END;
$$;

-- The active connection a room is minted on. A Teams room mints through the `outlook` connection:
-- one Entra app, one consent (Decision #383).
-- An entry's room follows the entry once it exists: moved, it is updated; cancelled, it is closed.
-- What room an entry has at all is its host's call, through set_entry_room.
CREATE OR REPLACE FUNCTION scheduling.fn_sync_entry_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'cancelled' THEN
        UPDATE scheduling.rooms
           SET status = CASE WHEN status = 'ready' AND provider <> 'custom' THEN 'closing' ELSE 'closed' END
         WHERE event_id = NEW.id AND status NOT IN ('closing', 'closed');
    ELSIF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
        UPDATE scheduling.rooms SET moved_at = pg_catalog.now()
         WHERE event_id = NEW.id AND status = 'ready' AND provider <> 'custom';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION scheduling.fn_room_connection(p_host uuid, p_provider text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT c.id
      FROM integrations.user_connections c
     WHERE c.user_id = p_host
       AND c.status = 'active'::integrations.connection_status
       AND 'conferencing'::integrations.provider_kind = ANY (c.granted_kinds)
       AND c.provider_slug = CASE p_provider WHEN 'microsoft_teams' THEN 'outlook' ELSE p_provider END
     ORDER BY c.updated_at DESC
     LIMIT 1;
$$;

-- What a provider needs to know about a room, whichever anchor it has.
CREATE OR REPLACE FUNCTION scheduling.fn_room_facts(
    r scheduling.rooms,
    OUT o_host uuid,
    OUT o_title text,
    OUT o_starts_at timestamptz,
    OUT o_ends_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF r.session_event_id IS NOT NULL THEN
        -- A team's sitting is hosted through the accountable person behind its schedule.
        SELECT COALESCE(p.owner_user_id, scheduling.fn_schedule_host(projects.fn_session_host_schedule(p.id))),
               e.title, e.start_time, e.end_time
          INTO o_host, o_title, o_starts_at, o_ends_at
          FROM projects.session_events e
          JOIN projects.cohorts c ON c.id = e.cohort_id
          JOIN projects.projects p ON p.id = c.project_id
         WHERE e.id = r.session_event_id;
    ELSIF r.call_id IS NOT NULL THEN
        SELECT c.host_user_id, 'A call on Projective',
               COALESCE(c.confirmed_start, c.proposed_start), COALESCE(c.confirmed_end, c.proposed_end)
          INTO o_host, o_title, o_starts_at, o_ends_at
          FROM scheduling.discovery_calls c
         WHERE c.id = r.call_id;
    ELSE
        SELECT e.created_by, e.title, e.starts_at, e.ends_at
          INTO o_host, o_title, o_starts_at, o_ends_at
          FROM scheduling.events e
         WHERE e.id = r.event_id;
    END IF;
END;
$$;

-- Take the rooms due to be minted. A mint a crashed run left behind is taken again after ten minutes;
-- a stray duplicate at the provider is harmless, because only the attached id is ever used.
CREATE OR REPLACE FUNCTION scheduling.claim_rooms_to_mint(p_limit integer DEFAULT 50)
RETURNS TABLE (
    room_id uuid, provider text, connection_id uuid, host_user_id uuid, host_account text, title text,
    starts_at timestamptz, ends_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r scheduling.rooms;
    f record;
BEGIN
    FOR r IN
        UPDATE scheduling.rooms u
           SET status = 'minting', attempts = u.attempts + 1
         WHERE u.id IN (
             SELECT x.id FROM scheduling.rooms x
              WHERE x.status = 'pending'
                 OR (x.status = 'minting' AND x.updated_at < pg_catalog.now() - interval '10 minutes')
              ORDER BY x.created_at, x.id
              LIMIT GREATEST(COALESCE(p_limit, 50), 1)
                FOR UPDATE SKIP LOCKED
         )
        RETURNING u.*
    LOOP
        f := scheduling.fn_room_facts(r);
        room_id := r.id;
        provider := r.provider;
        connection_id := scheduling.fn_room_connection(f.o_host, r.provider);
        host_user_id := f.o_host;
        SELECT c.external_account_id INTO host_account
          FROM integrations.user_connections c WHERE c.id = connection_id;
        title := f.o_title;
        starts_at := f.o_starts_at;
        ends_at := f.o_ends_at;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- Record what the provider answered, on the room and on the column its owner already withholds. A
-- room no longer `minting` (another run got there) is left alone, so a second attach is a no-op.
CREATE OR REPLACE FUNCTION scheduling.attach_room(
    p_room uuid,
    p_connection uuid,
    p_meeting_id text,
    p_host_id text,
    p_join_url text,
    p_passcode text DEFAULT NULL,
    p_registration boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r scheduling.rooms;
BEGIN
    UPDATE scheduling.rooms
       SET status = 'ready',
           connection_id = p_connection,
           provider_meeting_id = p_meeting_id,
           provider_host_id = p_host_id,
           registration = COALESCE(p_registration, false),
           last_error = NULL
     WHERE id = p_room AND status = 'minting'
    RETURNING * INTO r;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    IF r.session_event_id IS NOT NULL THEN
        UPDATE projects.session_events
           SET attendee_join_url = p_join_url, provider_meeting_id = p_meeting_id
         WHERE id = r.session_event_id;
        -- The calendar shows a room only on an entry that says it has one. The link stays behind /meet.
        UPDATE scheduling.events
           SET meeting_provider = r.provider, meeting_pending = false
         WHERE source_session_event_id = r.session_event_id;
    ELSIF r.call_id IS NOT NULL THEN
        UPDATE scheduling.discovery_calls
           SET meeting_url = p_join_url, meeting_external_id = p_meeting_id, connection_id = p_connection
         WHERE id = r.call_id;
    ELSE
        UPDATE scheduling.events
           SET meeting_url = p_join_url, meeting_passcode = p_passcode, meeting_pending = false
         WHERE id = r.event_id;
    END IF;
    RETURN true;
END;
$$;

-- A host who connects an account gets the rooms that were waiting for one (Decision #386): a sitting
-- booked before they had one has no room at all, and a mint that failed for want of it stopped trying.
CREATE OR REPLACE FUNCTION scheduling.fn_queue_waiting_rooms(p_host uuid, p_provider_slug text)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_provider text := CASE p_provider_slug WHEN 'outlook' THEN 'microsoft_teams' ELSE p_provider_slug END;
    v_failed integer;
    v_waiting integer;
BEGIN
    UPDATE scheduling.rooms r
       SET status = 'pending', attempts = 0, last_error = NULL
     WHERE r.status = 'failed'
       AND r.provider IN (p_provider_slug, v_provider)
       AND EXISTS (
           SELECT 1 FROM scheduling.fn_room_facts(r) f
            WHERE f.o_host = p_host AND f.o_ends_at > pg_catalog.now()
       );
    GET DIAGNOSTICS v_failed = ROW_COUNT;

    WITH waiting AS (
        UPDATE projects.session_events e
           SET meeting_provider = v_provider
          FROM projects.cohorts c
          JOIN projects.projects p ON p.id = c.project_id
         WHERE c.id = e.cohort_id
           AND e.status = 'scheduled' AND e.end_time > pg_catalog.now()
           AND COALESCE(p.owner_user_id, scheduling.fn_schedule_host(projects.fn_session_host_schedule(p.id))) = p_host
           AND NOT EXISTS (SELECT 1 FROM scheduling.rooms r WHERE r.session_event_id = e.id)
        RETURNING e.id
    )
    INSERT INTO scheduling.rooms (session_event_id, provider, status)
    SELECT w.id, v_provider, 'pending' FROM waiting w;
    GET DIAGNOSTICS v_waiting = ROW_COUNT;

    RETURN v_failed + v_waiting;
END;
$$;

-- A host setting the room on their own /calendar entries (Decision #383 (f)): a provider to mint on,
-- a link of their own, or none. A room is queued only on an account that can mint it, so a pick with
-- nothing behind it leaves no room rather than a failure, and the same provider again is a no-op. A
-- room that changes keeps its row, and with it the /meet address already sent to its attendees.
-- shortcut: a replaced minted room stays unused at the provider; close it there if hosts notice.
CREATE OR REPLACE FUNCTION scheduling.set_entry_room(
    p_events uuid[],
    p_provider text,
    p_link text DEFAULT NULL,
    p_passcode text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_mint boolean;
    e scheduling.events;
    r scheduling.rooms;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
    END IF;
    v_mint := p_link IS NULL AND p_provider IS NOT NULL
        AND scheduling.fn_room_connection(v_uid, p_provider) IS NOT NULL;

    FOR e IN
        SELECT x.* FROM scheduling.events x
         WHERE x.id = ANY (p_events) AND x.created_by = v_uid AND x.project_id IS NULL
           AND x.source_session_event_id IS NULL AND x.archived_at IS NULL
         ORDER BY x.id
           FOR UPDATE
    LOOP
        SELECT * INTO r FROM scheduling.rooms x WHERE x.event_id = e.id FOR UPDATE;
        CONTINUE WHEN v_mint AND r.provider = p_provider AND r.status IN ('pending', 'minting', 'ready');
        -- Nobody can meet in the past, so an edit to an old entry mints nothing.
        CONTINUE WHEN v_mint AND e.ends_at <= pg_catalog.now();

        UPDATE scheduling.events
           SET meeting_provider = CASE WHEN v_mint OR p_link IS NOT NULL THEN p_provider END,
               meeting_provider_label = NULL,
               meeting_url = p_link,
               meeting_passcode = CASE WHEN p_link IS NOT NULL THEN p_passcode END,
               meeting_pending = v_mint
         WHERE id = e.id;

        IF v_mint OR p_link IS NOT NULL THEN
            INSERT INTO scheduling.rooms (event_id, provider, status)
            VALUES (e.id, CASE WHEN v_mint THEN p_provider ELSE 'custom' END,
                    CASE WHEN v_mint THEN 'pending' ELSE 'ready' END)
            ON CONFLICT (event_id) DO UPDATE
               SET provider = EXCLUDED.provider, status = EXCLUDED.status, connection_id = NULL,
                   provider_meeting_id = NULL, provider_host_id = NULL, attempts = 0, last_error = NULL,
                   moved_at = NULL, reconciled_at = NULL;
        ELSE
            UPDATE scheduling.rooms
               SET status = CASE WHEN status = 'ready' AND provider <> 'custom' THEN 'closing' ELSE 'closed' END
             WHERE id = r.id AND status NOT IN ('closing', 'closed');
        END IF;
    END LOOP;
END;
$$;

-- A mint that failed goes back in the queue, up to room_mint_max_attempts, then stops and tells the
-- host. p_final stops at once, for a failure no retry can cure (no connection, a refused account).
CREATE OR REPLACE FUNCTION scheduling.fail_room(p_room uuid, p_error text, p_final boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_max integer := projects.fn_session_param('room_mint_max_attempts', 5);
    r scheduling.rooms;
    f record;
BEGIN
    UPDATE scheduling.rooms
       SET status = CASE WHEN p_final OR attempts >= v_max THEN 'failed' ELSE 'pending' END,
           last_error = pg_catalog.left(p_error, 200)
     WHERE id = p_room AND status = 'minting'
    RETURNING * INTO r;
    IF NOT FOUND OR r.status <> 'failed' THEN
        RETURN;
    END IF;
    f := scheduling.fn_room_facts(r);
    IF f.o_host IS NULL THEN
        RETURN;
    END IF;
    PERFORM comms.fn_notify(
        f.o_host, 'room.failed', 'We could not create your meeting room',
        pg_catalog.format('"%s" has no room yet. Connect your account again, or add a link yourself.', f.o_title),
        'scheduling.rooms', r.id,
        pg_catalog.jsonb_build_object('starts_at', f.o_starts_at, 'provider', r.provider)
    );
END;
$$;

-- Take the rooms whose provider copy is out of date: moved, or waiting to be closed.
CREATE OR REPLACE FUNCTION scheduling.claim_rooms_to_sync(p_limit integer DEFAULT 50)
RETURNS TABLE (
    room_id uuid, provider text, connection_id uuid, provider_meeting_id text, closing boolean,
    title text, starts_at timestamptz, ends_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r scheduling.rooms;
    f record;
BEGIN
    FOR r IN
        SELECT x.* FROM scheduling.rooms x
         WHERE x.status = 'closing' OR (x.status = 'ready' AND x.moved_at IS NOT NULL)
         ORDER BY x.updated_at, x.id
         LIMIT GREATEST(COALESCE(p_limit, 50), 1)
           FOR UPDATE SKIP LOCKED
    LOOP
        f := scheduling.fn_room_facts(r);
        room_id := r.id;
        provider := r.provider;
        connection_id := r.connection_id;
        provider_meeting_id := r.provider_meeting_id;
        closing := r.status = 'closing';
        title := f.o_title;
        starts_at := f.o_starts_at;
        ends_at := f.o_ends_at;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- The provider's copy is settled, or as settled as best effort gets: this never blocks a booking.
CREATE OR REPLACE FUNCTION scheduling.room_synced(p_room uuid, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE scheduling.rooms
       SET status = CASE WHEN status = 'closing' THEN 'closed' ELSE status END,
           moved_at = NULL,
           last_error = pg_catalog.left(p_error, 200)
     WHERE id = p_room;
$$;
-- #endregion

-- #region 7e. Attendance (Decision #383 (b), rulings C4 (b), C5, R5)
-- Who a room's attendees are: the people who may be reported as in it, the host apart.
CREATE OR REPLACE FUNCTION scheduling.fn_room_attendees(r scheduling.rooms)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(array_agg(a.user_id), '{}')
      FROM (
          SELECT cm.user_id
            FROM projects.session_events e
            JOIN projects.cohort_memberships cm ON cm.cohort_id = e.cohort_id
           WHERE e.id = r.session_event_id AND projects.fn_seated_on(e.id, cm.user_id)
          UNION
          SELECT c.requester_user_id
            FROM scheduling.discovery_calls c
           WHERE c.id = r.call_id
          UNION
          SELECT ea.user_id
            FROM scheduling.event_attendees ea
           WHERE ea.event_id = r.event_id AND ea.user_id IS NOT NULL AND ea.role <> 'host'
      ) a;
$$;

-- Bring the one-row-per-person summary into line with the ledger. It is derived from everything that
-- has arrived, so the order the provider delivered events in cannot change the answer: a redelivered
-- `left` after a rejoin no longer marks somebody out of the room.
CREATE OR REPLACE FUNCTION scheduling.fn_sync_attendance_row(r scheduling.rooms, p_user uuid, p_source text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_first timestamptz;
    v_last timestamptz;
    v_last_action text;
BEGIN
    SELECT min(p.occurred_at) INTO v_first
      FROM scheduling.presence_events p
     WHERE p.room_id = r.id AND p.user_id = p_user AND p.action IN ('joined', 'left');
    IF v_first IS NULL THEN
        RETURN;
    END IF;
    SELECT p.occurred_at, p.action INTO v_last, v_last_action
      FROM scheduling.presence_events p
     WHERE p.room_id = r.id AND p.user_id = p_user AND p.action IN ('joined', 'left')
     ORDER BY p.occurred_at DESC, (p.action = 'left') DESC
     LIMIT 1;

    IF r.session_event_id IS NOT NULL THEN
        INSERT INTO projects.session_attendance (session_event_id, user_id, joined_at, left_at, source)
        VALUES (r.session_event_id, p_user, v_first, CASE WHEN v_last_action = 'left' THEN v_last END, p_source)
        ON CONFLICT (session_event_id, user_id) DO UPDATE
           SET joined_at = EXCLUDED.joined_at, left_at = EXCLUDED.left_at, source = EXCLUDED.source;
    ELSIF r.call_id IS NOT NULL THEN
        INSERT INTO scheduling.call_attendance (call_id, user_id, joined_at, left_at, source_provider_slug)
        VALUES (r.call_id, p_user, v_first, CASE WHEN v_last_action = 'left' THEN v_last END, r.provider)
        ON CONFLICT (call_id, user_id) DO UPDATE
           SET joined_at = EXCLUDED.joined_at, left_at = EXCLUDED.left_at;
    END IF;
END;
$$;

-- One participant joining, leaving or waiting, as a provider reported it, from a verified webhook or a
-- post-meeting read. Service-role only, and it never refuses with an error, because a webhook that
-- fails is redelivered forever: it answers recorded · replayed · unmatched · outside_window.
--
-- Who it was, strongest first: the host by their account at the provider, a person by their own
-- registrant id, then the email a provider reported, which is weaker evidence and never matches
-- somebody who holds a personal link on this room (ruling C4 (b)). In a room with one attendee, a
-- participant nobody can name who is not the host is that attendee, by elimination. Anybody else is
-- recorded unmatched, because an unknown participant in a room is still a fact.
CREATE OR REPLACE FUNCTION scheduling.record_presence(
    p_provider text,
    p_meeting_id text,
    p_action text,
    p_at timestamptz,
    p_event_key text,
    p_participant_key text,
    p_email text DEFAULT NULL,
    p_registrant_id text DEFAULT NULL,
    p_account_id text DEFAULT NULL,
    p_source text DEFAULT 'webhook'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r scheduling.rooms;
    f record;
    v_attendees uuid[];
    v_user uuid;
    v_by text;
    v_id uuid;
    v_key text;
BEGIN
    IF p_action NOT IN ('joined', 'left', 'waiting') OR p_at IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'unmatched', 'detail', 'unknown presence action');
    END IF;
    SELECT * INTO r FROM scheduling.rooms
     WHERE provider = p_provider AND provider_meeting_id = p_meeting_id;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'unmatched', 'detail', 'no room has this meeting');
    END IF;
    f := scheduling.fn_room_facts(r);
    -- A room is often opened early and closed late; anything an hour either side is not this meeting.
    IF p_at < f.o_starts_at - interval '60 minutes' OR p_at > f.o_ends_at + interval '60 minutes' THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'outside_window', 'room_id', r.id);
    END IF;
    v_attendees := scheduling.fn_room_attendees(r);
    -- Enough to tell two strangers apart in this room, and nothing that identifies them outside it.
    v_key := pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        r.id::text || ':' || p_participant_key, 'UTF8')), 'hex'), 40);

    IF p_account_id IS NOT NULL AND p_account_id = r.provider_host_id THEN
        v_user := f.o_host;
        v_by := 'host_account';
    END IF;
    IF v_user IS NULL AND p_registrant_id IS NOT NULL THEN
        SELECT g.user_id INTO v_user FROM scheduling.room_registrants g
         WHERE g.room_id = r.id AND g.registrant_id = p_registrant_id;
        IF FOUND THEN
            v_by := 'registrant';
        END IF;
    END IF;
    IF v_user IS NULL AND NULLIF(pg_catalog.btrim(COALESCE(p_email, '')), '') IS NOT NULL THEN
        SELECT u.id INTO v_user FROM auth.users u
         WHERE pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(p_email))
         LIMIT 1;
        IF v_user IS NOT NULL AND (v_user = f.o_host OR v_user = ANY (v_attendees))
           AND NOT EXISTS (
               SELECT 1 FROM scheduling.room_registrants g WHERE g.room_id = r.id AND g.user_id = v_user
           ) THEN
            v_by := 'email';
        ELSE
            v_user := NULL;
        END IF;
    END IF;
    IF v_user IS NULL AND pg_catalog.cardinality(v_attendees) = 1 THEN
        v_user := v_attendees[1];
        v_by := 'sole_attendee';
    END IF;

    INSERT INTO scheduling.presence_events (
        room_id, idempotency_key, action, occurred_at, source, matched_by, user_id, participant_key
    ) VALUES (
        r.id, p_event_key, p_action, p_at, p_source, COALESCE(v_by, 'unmatched'), v_user, v_key
    )
    ON CONFLICT (room_id, idempotency_key) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('outcome', 'replayed', 'room_id', r.id);
    END IF;

    IF v_user IS NOT NULL THEN
        PERFORM scheduling.fn_sync_attendance_row(
            r, v_user, CASE WHEN v_by = 'email' THEN 'webhook_email' ELSE 'webhook' END
        );
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'outcome', CASE WHEN v_user IS NULL THEN 'unmatched' ELSE 'recorded' END,
        'room_id', r.id, 'user_id', v_user, 'matched_by', COALESCE(v_by, 'unmatched')
    );
END;
$$;

-- Time actually in the room, one row per person, from the ledger. Several devices at once count once.
-- Time is clipped to the meeting. A join with no `left` adds nothing after it (ruling C5 (c)), so
-- `open_span` says the figure may be short, and the reconcile job is what closes it.
CREATE OR REPLACE FUNCTION scheduling.fn_room_presence(p_room uuid)
RETURNS TABLE (
    user_id uuid,
    participant_key text,
    matched_by text,
    is_host boolean,
    first_join_at timestamptz,
    last_leave_at timestamptz,
    total_seconds integer,
    reconnect_count integer,
    in_presence_window boolean,
    open_span boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r scheduling.rooms;
    f record;
    v_window timestamptz;
    v_read boolean;
    w record;
    e record;
    v_depth integer;
    v_since timestamptz;
    v_seconds numeric;
    v_sessions integer;
BEGIN
    SELECT * INTO r FROM scheduling.rooms x WHERE x.id = p_room;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    f := scheduling.fn_room_facts(r);
    v_window := f.o_starts_at + pg_catalog.make_interval(
        mins => projects.fn_session_param('session_presence_minutes', 15));
    -- Once a provider's own record has been read it is the whole story. Added to the webhooks, a join
    -- both report and a leave only one reports would read as somebody still in the room.
    v_read := EXISTS (
        SELECT 1 FROM scheduling.presence_events p
         WHERE p.room_id = p_room AND p.source = 'reconcile' AND p.action IN ('joined', 'left')
    );

    FOR w IN
        SELECT DISTINCT COALESCE(p.user_id::text, p.participant_key) AS who
          FROM scheduling.presence_events p
         WHERE p.room_id = p_room AND p.action IN ('joined', 'left')
           AND (NOT v_read OR p.source = 'reconcile')
    LOOP
        v_depth := 0;
        v_since := NULL;
        v_seconds := 0;
        v_sessions := 0;
        user_id := NULL;
        first_join_at := NULL;
        last_leave_at := NULL;
        FOR e IN
            SELECT p.user_id AS uid, p.participant_key AS pkey, p.matched_by AS how, p.action, p.occurred_at
              FROM scheduling.presence_events p
             WHERE p.room_id = p_room AND p.action IN ('joined', 'left')
               AND (NOT v_read OR p.source = 'reconcile')
               AND COALESCE(p.user_id::text, p.participant_key) = w.who
             ORDER BY p.occurred_at, (p.action = 'left')
        LOOP
            user_id := COALESCE(user_id, e.uid);
            participant_key := e.pkey;
            matched_by := e.how;
            IF e.action = 'joined' THEN
                IF v_depth = 0 THEN
                    v_since := e.occurred_at;
                    v_sessions := v_sessions + 1;
                    first_join_at := COALESCE(first_join_at, e.occurred_at);
                END IF;
                v_depth := v_depth + 1;
            ELSE
                last_leave_at := GREATEST(last_leave_at, e.occurred_at);
                IF v_depth = 1 THEN
                    v_seconds := v_seconds + GREATEST(EXTRACT(epoch FROM
                        LEAST(e.occurred_at, f.o_ends_at) - GREATEST(v_since, f.o_starts_at)), 0);
                END IF;
                v_depth := GREATEST(v_depth - 1, 0);
            END IF;
        END LOOP;
        is_host := user_id IS NOT DISTINCT FROM f.o_host;
        total_seconds := pg_catalog.floor(v_seconds)::integer;
        reconnect_count := GREATEST(v_sessions - 1, 0);
        in_presence_window := first_join_at IS NOT NULL AND first_join_at <= v_window;
        open_span := v_depth > 0;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- Into a room, as a signed-in person. The same answers session_join_link gives (`state` says why there
-- is no URL), for every kind of room: a sitting asks that door, a call needs to be confirmed, and an
-- event's attendee must have said they are coming. Pressing join while the room is open is recorded:
-- it is the one piece of evidence that an attendee came which does not depend on a provider.
CREATE OR REPLACE FUNCTION scheduling.room_join(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_now timestamptz := pg_catalog.now();
    r scheduling.rooms;
    f record;
    v_link jsonb;
    v_opens timestamptz;
    v_role text;
    v_state text;
    v_url text;
    v_status scheduling.call_status;
    v_response scheduling.rsvp_response;
    v_archived timestamptz;
    v_personal text;
    v_register jsonb;
BEGIN
    SELECT * INTO r FROM scheduling.rooms WHERE slug = p_slug;
    IF NOT FOUND OR v_uid IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('state', 'not_party');
    END IF;
    f := scheduling.fn_room_facts(r);
    v_opens := f.o_starts_at - pg_catalog.make_interval(
        mins => projects.fn_session_param('session_join_lead_minutes', 10));

    IF r.session_event_id IS NOT NULL THEN
        v_link := projects.session_join_link(r.session_event_id);
        v_state := v_link ->> 'state';
        v_role := v_link ->> 'role';
        v_url := v_link ->> 'url';
    ELSE
        IF r.call_id IS NOT NULL THEN
            SELECT CASE v_uid WHEN c.host_user_id THEN 'host' WHEN c.requester_user_id THEN 'attendee' END,
                   c.meeting_url, c.status
              INTO v_role, v_url, v_status
              FROM scheduling.discovery_calls c WHERE c.id = r.call_id;
            v_state := CASE
                WHEN v_status = 'cancelled'::scheduling.call_status THEN 'cancelled'
                WHEN v_status <> 'confirmed'::scheduling.call_status THEN 'unconfirmed'
            END;
        ELSE
            SELECT CASE WHEN e.created_by = v_uid THEN 'host'
                        WHEN a.response IN ('accepted'::scheduling.rsvp_response, 'tentative'::scheduling.rsvp_response) THEN 'attendee'
                   END,
                   e.meeting_url, a.response, e.archived_at
              INTO v_role, v_url, v_response, v_archived
              FROM scheduling.events e
              LEFT JOIN scheduling.event_attendees a ON a.event_id = e.id AND a.user_id = v_uid
             WHERE e.id = r.event_id;
            v_state := CASE
                WHEN v_archived IS NOT NULL THEN 'cancelled'
                WHEN v_role IS NULL AND v_response = 'pending'::scheduling.rsvp_response THEN 'needs_rsvp'
            END;
        END IF;
        IF v_role IS NULL AND v_state IS DISTINCT FROM 'needs_rsvp' THEN
            RETURN pg_catalog.jsonb_build_object('state', 'not_party');
        END IF;
        v_state := COALESCE(v_state, CASE
            WHEN v_now < v_opens THEN 'upcoming'
            WHEN v_now >= f.o_ends_at THEN 'ended'
            ELSE 'open'
        END);
        v_url := CASE WHEN v_state = 'open' THEN v_url END;
    END IF;

    -- A person's own link, where the provider gives one.
    IF v_state = 'open' THEN
        SELECT g.join_url INTO v_personal
          FROM scheduling.room_registrants g WHERE g.room_id = r.id AND g.user_id = v_uid;
        v_url := COALESCE(v_personal, v_url);
        -- The first time an attendee joins a room that can give them one, the service makes it.
        IF v_personal IS NULL AND r.registration AND v_role = 'attendee' THEN
            SELECT pg_catalog.jsonb_build_object(
                       'room_id', r.id, 'user_id', v_uid, 'email', a.email,
                       'first_name', COALESCE(NULLIF(pg_catalog.btrim(u.first_name), ''), 'Guest')
                   )
              INTO v_register
              FROM auth.users a
              LEFT JOIN org.users_public u ON u.user_id = a.id
             WHERE a.id = v_uid AND a.email IS NOT NULL;
        END IF;
        IF v_url IS NULL THEN
            v_state := 'no_room';
        ELSE
            INSERT INTO scheduling.presence_events (
                room_id, idempotency_key, action, occurred_at, source, matched_by, user_id, participant_key
            ) VALUES (
                r.id, pg_catalog.format('click:%s:%s', v_uid, pg_catalog.date_trunc('minute', v_now)),
                'join_click', v_now, 'platform', 'session', v_uid, v_uid::text
            )
            ON CONFLICT (room_id, idempotency_key) DO NOTHING;
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'state', v_state,
        'role', v_role,
        'opens_at', v_opens,
        'closes_at', f.o_ends_at,
        'provider', r.provider,
        'url', CASE WHEN v_state = 'open' THEN v_url END,
        -- The service reads a fresh host link or makes a personal one with these; they never leave it.
        'register', v_register,
        'connection_id', CASE WHEN v_role = 'host' OR v_register IS NOT NULL THEN r.connection_id END,
        'provider_meeting_id', CASE WHEN v_role = 'host' OR v_register IS NOT NULL THEN r.provider_meeting_id END
    );
END;
$$;

-- A person's own way into a room, once the provider has given them one (service role only).
CREATE OR REPLACE FUNCTION scheduling.save_room_registrant(
    p_room uuid,
    p_user uuid,
    p_registrant_id text,
    p_join_url text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    INSERT INTO scheduling.room_registrants (room_id, user_id, registrant_id, join_url)
    VALUES (p_room, p_user, p_registrant_id, p_join_url)
    ON CONFLICT (room_id, user_id) DO UPDATE
       SET registrant_id = EXCLUDED.registrant_id, join_url = EXCLUDED.join_url;
$$;

-- The rooms whose provider's own record is due a read: ended a quarter of an hour ago, so the provider
-- has written it, and for three days, tried hourly, because a record can arrive late. Past that a
-- sitting that needed it stays held (ruling R5), which is the point of not stamping a failed read.
CREATE OR REPLACE FUNCTION scheduling.claim_rooms_to_reconcile(p_limit integer DEFAULT 50)
RETURNS TABLE (
    room_id uuid, provider text, connection_id uuid, provider_meeting_id text, title text,
    starts_at timestamptz, ends_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now timestamptz := pg_catalog.now();
    c record;
BEGIN
    FOR c IN
        SELECT x.id, x.provider, x.connection_id, x.provider_meeting_id, f.o_title, f.o_starts_at, f.o_ends_at
          FROM scheduling.rooms x
         CROSS JOIN LATERAL scheduling.fn_room_facts(x) f
         WHERE x.status = 'ready' AND x.provider <> 'custom' AND x.reconciled_at IS NULL
           AND x.connection_id IS NOT NULL AND x.provider_meeting_id IS NOT NULL
           AND x.updated_at < v_now - interval '1 hour'
           AND f.o_ends_at < v_now - interval '15 minutes'
           AND f.o_ends_at > v_now - interval '3 days'
         ORDER BY f.o_ends_at, x.id
         LIMIT GREATEST(COALESCE(p_limit, 50), 1)
           FOR UPDATE OF x SKIP LOCKED
    LOOP
        room_id := c.id;
        provider := c.provider;
        connection_id := c.connection_id;
        provider_meeting_id := c.provider_meeting_id;
        title := c.o_title;
        starts_at := c.o_starts_at;
        ends_at := c.o_ends_at;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- How that read went. Only a read that worked is stamped: the verdict treats a stamped room as a
-- record that was read, and a room that is not as evidence still missing.
CREATE OR REPLACE FUNCTION scheduling.room_reconciled(p_room uuid, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE scheduling.rooms
       SET reconciled_at = CASE WHEN p_error IS NULL THEN pg_catalog.now() END,
           last_error = pg_catalog.left(p_error, 200)
     WHERE id = p_room;
$$;
-- #endregion

-- #region 7f. Attendance retention (finance-model.md §17; Decision #383, ruling R8)
-- What a sitting's records must outlive. A dispute keeps them as its evidence, and §17's six years is
-- the dispute record's to enforce. A seat's money still held keeps them too, because the sweep reads
-- attendance and a deleted record must never read as no record.
CREATE OR REPLACE FUNCTION scheduling.fn_sitting_evidence_held(p_event uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_event IS NOT NULL AND (
        EXISTS (SELECT 1 FROM finance.disputes d WHERE d.session_event_id = p_event)
        OR EXISTS (
            SELECT 1
              FROM projects.session_events se
              JOIN projects.cohort_memberships cm ON cm.cohort_id = se.cohort_id
              JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status = 'held'
             WHERE se.id = p_event
        )
    );
$$;

-- Records go when their period ends, in both the ledger and its one-row summaries: a person's after
-- presence_retention_days, a participant with no account behind them after
-- presence_unmatched_retention_days.
CREATE OR REPLACE FUNCTION scheduling.fn_prune_presence()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_keep timestamptz := pg_catalog.now() - pg_catalog.make_interval(
        days => projects.fn_session_param('presence_retention_days', 395));
    v_unmatched timestamptz := pg_catalog.now() - pg_catalog.make_interval(
        days => projects.fn_session_param('presence_unmatched_retention_days', 30));
    v_ledger integer;
    v_sittings integer;
    v_calls integer;
BEGIN
    DELETE FROM scheduling.presence_events p
     USING scheduling.rooms r
     WHERE r.id = p.room_id
       AND p.occurred_at < CASE WHEN p.matched_by = 'unmatched' THEN v_unmatched ELSE v_keep END
       AND NOT scheduling.fn_sitting_evidence_held(r.session_event_id);
    GET DIAGNOSTICS v_ledger = ROW_COUNT;

    DELETE FROM projects.session_attendance a
     WHERE a.joined_at < v_keep
       AND NOT scheduling.fn_sitting_evidence_held(a.session_event_id);
    GET DIAGNOSTICS v_sittings = ROW_COUNT;

    DELETE FROM scheduling.call_attendance a WHERE a.joined_at < v_keep;
    GET DIAGNOSTICS v_calls = ROW_COUNT;

    RETURN pg_catalog.jsonb_build_object(
        'ledger', v_ledger, 'session_attendance', v_sittings, 'call_attendance', v_calls);
END;
$$;
-- #endregion

-- #region 7g. Outbound mirrors (Decision #383, ruling R3)
-- A person's Projective events and agreed discovery calls go out to a separate calendar at their
-- provider, one row of scheduling.event_mirrors per copy. Triggers mark a row dirty and the app does
-- the rest: it claims what is dirty, writes or removes the copy and reports back through the doors
-- below. What a copy should say is read at claim time, so a burst of edits is one write. Only
-- service-role doors.

-- Whether an event goes out at all. A busy row read from a provider never does, which is why nothing
-- can loop, and neither does a point in time: a deadline has no span to hold.
CREATE OR REPLACE FUNCTION scheduling.fn_event_goes_out(e scheduling.events)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT e.source_connection_id IS NULL
       AND e.external_sync
       AND e.archived_at IS NULL
       AND COALESCE(e.status, 'confirmed'::scheduling.event_status) <> 'cancelled'::scheduling.event_status
       AND e.kind NOT IN ('availability'::scheduling.event_kind, 'busy'::scheduling.event_kind)
       AND e.ends_at > e.starts_at;
$$;

-- Who holds an event on their calendar: everyone seated who said they are coming, or for an event with
-- no roster its creator and, on a group sitting, its seat-holders.
CREATE OR REPLACE FUNCTION scheduling.fn_event_holders(p_event uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT a.user_id
      FROM scheduling.event_attendees a
     WHERE a.event_id = p_event AND a.user_id IS NOT NULL
       AND a.response IN ('accepted'::scheduling.rsvp_response, 'tentative'::scheduling.rsvp_response)
    UNION
    SELECT e.created_by
      FROM scheduling.events e
     WHERE e.id = p_event AND e.created_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM scheduling.event_attendees a WHERE a.event_id = e.id)
    UNION
    SELECT cm.user_id
      FROM scheduling.events e
      JOIN projects.session_events se ON se.id = e.source_session_event_id
      JOIN projects.cohort_memberships cm ON cm.cohort_id = se.cohort_id
     WHERE e.id = p_event
       AND NOT EXISTS (SELECT 1 FROM scheduling.event_attendees a WHERE a.event_id = e.id)
       AND projects.fn_seated_on(se.id, cm.user_id);
$$;

-- Whether a call goes out at all. Only an agreed time does: a request, or a move waiting on its
-- counterparty, holds no copy. A call that took place keeps its copy, as a past event does. One drawn
-- from an events row goes out as that row, so its external_sync is never gone round.
CREATE OR REPLACE FUNCTION scheduling.fn_call_goes_out(dc scheduling.discovery_calls)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT dc.event_id IS NULL
       AND dc.status IN (
           'confirmed'::scheduling.call_status, 'completed'::scheduling.call_status,
           'no_show'::scheduling.call_status
       );
$$;

-- An event changed: mark what copies it has, and open one on every connection that should now hold it.
-- A copy that should no longer exist stays marked, and the job removes it.
CREATE OR REPLACE FUNCTION scheduling.fn_queue_event_mirrors(p_event uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE scheduling.event_mirrors m
       SET dirty_at = pg_catalog.now(), attempts = 0
     WHERE m.event_id = p_event;
    INSERT INTO scheduling.event_mirrors (event_id, connection_id, dirty_at)
    SELECT e.id, c.id, pg_catalog.now()
      FROM scheduling.events e
      JOIN integrations.user_connections c
        ON c.user_id IN (SELECT scheduling.fn_event_holders(e.id))
     WHERE e.id = p_event
       AND scheduling.fn_event_goes_out(e)
       AND c.status IN ('active', 'degraded')
       AND 'calendar'::integrations.provider_kind = ANY (c.granted_kinds)
       AND c.sync_direction IN ('outbound', 'bidirectional')
    ON CONFLICT ON CONSTRAINT uq_event_mirror DO NOTHING;
$$;

-- The same for a call, whose holders are its two parties.
CREATE OR REPLACE FUNCTION scheduling.fn_queue_call_mirrors(p_call uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE scheduling.event_mirrors m
       SET dirty_at = pg_catalog.now(), attempts = 0
     WHERE m.call_id = p_call;
    INSERT INTO scheduling.event_mirrors (call_id, connection_id, dirty_at)
    SELECT dc.id, c.id, pg_catalog.now()
      FROM scheduling.discovery_calls dc
      JOIN integrations.user_connections c ON c.user_id IN (dc.host_user_id, dc.requester_user_id)
     WHERE dc.id = p_call
       AND scheduling.fn_call_goes_out(dc)
       AND c.status IN ('active', 'degraded')
       AND 'calendar'::integrations.provider_kind = ANY (c.granted_kinds)
       AND c.sync_direction IN ('outbound', 'bidirectional')
    ON CONFLICT ON CONSTRAINT uq_call_mirror DO NOTHING;
$$;

-- Queue a connection's owner's upcoming events and calls: a Projective calendar just turned on, or one
-- that has to be made again. Past ones stay out. The candidates are a superset, fn_event_holders decides.
CREATE OR REPLACE FUNCTION scheduling.fn_open_event_mirrors(p_connection uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c integrations.user_connections;
    v_count integer;
    v_calls integer;
BEGIN
    SELECT * INTO c FROM integrations.user_connections u
     WHERE u.id = p_connection AND u.status IN ('active', 'degraded')
       AND 'calendar'::integrations.provider_kind = ANY (u.granted_kinds)
       AND u.sync_direction IN ('outbound', 'bidirectional');
    IF NOT FOUND THEN
        RETURN 0;
    END IF;
    INSERT INTO scheduling.event_mirrors AS m (event_id, connection_id, dirty_at)
    SELECT e.id, c.id, pg_catalog.now()
      FROM scheduling.events e
     WHERE e.ends_at > pg_catalog.now()
       AND scheduling.fn_event_goes_out(e)
       AND e.id IN (
           SELECT a.event_id FROM scheduling.event_attendees a WHERE a.user_id = c.user_id
           UNION
           SELECT x.id FROM scheduling.events x WHERE x.created_by = c.user_id
           UNION
           SELECT x.id
             FROM projects.cohort_memberships cm
             JOIN projects.session_events se ON se.cohort_id = cm.cohort_id
             JOIN scheduling.events x ON x.source_session_event_id = se.id
            WHERE cm.user_id = c.user_id
       )
       AND c.user_id IN (SELECT scheduling.fn_event_holders(e.id))
    ON CONFLICT ON CONSTRAINT uq_event_mirror DO UPDATE
       SET dirty_at = EXCLUDED.dirty_at, attempts = 0;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    INSERT INTO scheduling.event_mirrors AS m (call_id, connection_id, dirty_at)
    SELECT dc.id, c.id, pg_catalog.now()
      FROM scheduling.discovery_calls dc
     WHERE dc.confirmed_end > pg_catalog.now()
       AND c.user_id IN (dc.host_user_id, dc.requester_user_id)
       AND scheduling.fn_call_goes_out(dc)
    ON CONFLICT ON CONSTRAINT uq_call_mirror DO UPDATE
       SET dirty_at = EXCLUDED.dirty_at, attempts = 0;
    GET DIAGNOSTICS v_calls = ROW_COUNT;
    RETURN v_count + v_calls;
END;
$$;

-- A deleted event opens nothing: it only marks the copies it has, which the job then removes.
CREATE OR REPLACE FUNCTION scheduling.trg_event_mirrors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE scheduling.event_mirrors m
           SET dirty_at = pg_catalog.now(), attempts = 0
         WHERE m.event_id = OLD.id;
        RETURN OLD;
    END IF;
    PERFORM scheduling.fn_queue_event_mirrors(NEW.id);
    RETURN NEW;
END;
$$;

-- The same for a call.
CREATE OR REPLACE FUNCTION scheduling.trg_call_mirrors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE scheduling.event_mirrors m
           SET dirty_at = pg_catalog.now(), attempts = 0
         WHERE m.call_id = OLD.id;
        RETURN OLD;
    END IF;
    PERFORM scheduling.fn_queue_call_mirrors(NEW.id);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION scheduling.trg_attendee_mirrors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM scheduling.fn_queue_event_mirrors(COALESCE(NEW.event_id, OLD.event_id));
    RETURN NULL;
END;
$$;

-- A copy carries its room's address, so it follows the room's coming and going.
CREATE OR REPLACE FUNCTION scheduling.trg_room_mirrors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM scheduling.fn_queue_event_mirrors(e.id)
       FROM scheduling.events e
      WHERE e.id = NEW.event_id OR e.source_session_event_id = NEW.session_event_id;
    IF NEW.call_id IS NOT NULL THEN
        PERFORM scheduling.fn_queue_call_mirrors(NEW.call_id);
    END IF;
    RETURN NULL;
END;
$$;

-- Take the copies due. A run that died leaves its rows claimable again after ten minutes, and no copy
-- goes out twice at once, so a late write cannot land over a newer one. `event` is what the copy should
-- say, and NULL means it should not exist: the event went, was opted out, or its person stopped holding
-- it. An external calendar gets a title, the time and the room's own /meet address, and nothing else:
-- no agenda, no location, no attendees and never a provider's join link. A call's title is the one its
-- room carries at the provider (fn_room_facts), because naming the other party would be an attendee.
CREATE OR REPLACE FUNCTION scheduling.claim_event_mirrors(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rows jsonb;
BEGIN
    WITH due AS (
        SELECT m.id
          FROM scheduling.event_mirrors m
          JOIN integrations.user_connections c ON c.id = m.connection_id
         WHERE m.dirty_at <= pg_catalog.now()
           AND (m.claimed_at IS NULL OR m.claimed_at < pg_catalog.now() - interval '10 minutes')
           AND c.status IN ('active', 'degraded')
           AND 'calendar'::integrations.provider_kind = ANY (c.granted_kinds)
         ORDER BY m.dirty_at
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 500), 1)
           FOR UPDATE OF m SKIP LOCKED
    ), claimed AS (
        UPDATE scheduling.event_mirrors m
           SET claimed_at = pg_catalog.now()
          FROM due
         WHERE m.id = due.id
        RETURNING m.*
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'mirror_id', x.id,
               'connection_id', x.connection_id,
               'provider_slug', c.provider_slug,
               'calendar_id', c.config ->> 'outbound_calendar_id',
               'external_event_id', x.external_event_id,
               'version', x.version,
               'dirty_at', x.dirty_at,
               'claimed_at', x.claimed_at,
               'event', CASE WHEN e.id IS NOT NULL THEN pg_catalog.jsonb_build_object(
                   'title', CASE WHEN e.is_masked THEN '' ELSE e.title END,
                   'tentative', e.status IS NOT DISTINCT FROM 'tentative'::scheduling.event_status,
                   'all_day', e.all_day,
                   'starts_at', e.starts_at,
                   'ends_at', e.ends_at,
                   'start_date', (e.starts_at AT TIME ZONE COALESCE(s.timezone, 'UTC'))::date,
                   'end_date', ((e.ends_at - interval '1 millisecond') AT TIME ZONE COALESCE(s.timezone, 'UTC'))::date + 1,
                   'room_slug', (
                       SELECT r.slug FROM scheduling.rooms r
                        WHERE (r.event_id = e.id OR r.session_event_id = e.source_session_event_id)
                          AND r.status NOT IN ('failed', 'closing', 'closed')
                        LIMIT 1
                   )
               ) WHEN dc.id IS NOT NULL THEN pg_catalog.jsonb_build_object(
                   'title', 'A call on Projective',
                   'tentative', false,
                   'all_day', false,
                   'starts_at', dc.confirmed_start,
                   'ends_at', dc.confirmed_end,
                   'start_date', (dc.confirmed_start AT TIME ZONE COALESCE(s.timezone, 'UTC'))::date,
                   'end_date', ((dc.confirmed_end - interval '1 millisecond') AT TIME ZONE COALESCE(s.timezone, 'UTC'))::date + 1,
                   'room_slug', (
                       SELECT r.slug FROM scheduling.rooms r
                        WHERE r.call_id = dc.id AND r.status NOT IN ('failed', 'closing', 'closed')
                   )
               ) END
           )), '[]'::jsonb)
      INTO v_rows
      FROM claimed x
      JOIN integrations.user_connections c ON c.id = x.connection_id
      LEFT JOIN scheduling.events e
        ON e.id = x.event_id
       AND scheduling.fn_event_goes_out(e)
       AND c.sync_direction IN ('outbound', 'bidirectional')
       AND c.user_id IN (SELECT scheduling.fn_event_holders(e.id))
      LEFT JOIN scheduling.discovery_calls dc
        ON dc.id = x.call_id
       AND scheduling.fn_call_goes_out(dc)
       AND c.sync_direction IN ('outbound', 'bidirectional')
       AND c.user_id IN (dc.host_user_id, dc.requester_user_id)
      LEFT JOIN scheduling.schedules s ON s.id = COALESCE(e.schedule_id, dc.host_schedule_id);
    RETURN v_rows;
END;
$$;

-- What the provider answered, for a claim still held. p_external_event_id NULL means the copy is gone,
-- and so is the row, unless the event changed while the call was out: it then stays dirty and the next
-- run starts a new copy. p_dirty_at is the stamp the claim read, so the same goes for a write.
CREATE OR REPLACE FUNCTION scheduling.finish_event_mirror(
    p_mirror uuid,
    p_claimed_at timestamptz,
    p_dirty_at timestamptz,
    p_external_event_id text DEFAULT NULL,
    p_version text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_external_event_id IS NULL THEN
        DELETE FROM scheduling.event_mirrors m
         WHERE m.id = p_mirror AND m.claimed_at = p_claimed_at AND m.dirty_at = p_dirty_at;
        IF FOUND THEN
            RETURN;
        END IF;
    END IF;
    UPDATE scheduling.event_mirrors m
       SET external_event_id = p_external_event_id,
           version = p_version,
           dirty_at = CASE WHEN m.dirty_at = p_dirty_at THEN NULL ELSE m.dirty_at END,
           claimed_at = NULL,
           attempts = 0,
           last_error = NULL
     WHERE m.id = p_mirror AND m.claimed_at = p_claimed_at;
END;
$$;

-- A write the provider refused: back off, doubling from five minutes, and after eight tries stop until
-- the event next changes. p_error carries a provider's status and nothing else.
CREATE OR REPLACE FUNCTION scheduling.fail_event_mirror(
    p_mirror uuid,
    p_claimed_at timestamptz,
    p_error text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE scheduling.event_mirrors m
       SET attempts = m.attempts + 1,
           last_error = pg_catalog.left(p_error, 200),
           claimed_at = NULL,
           dirty_at = CASE WHEN m.attempts + 1 >= 8 THEN NULL
                           ELSE pg_catalog.now() + pg_catalog.make_interval(mins => 5 * (1 << m.attempts)) END
     WHERE m.id = p_mirror AND m.claimed_at = p_claimed_at;
$$;
-- #endregion

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
