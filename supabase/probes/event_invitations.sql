-- Probe: inviting people to an entry, withdrawing them, and what clashes with a person's own time.
--
--   1  door        only the entry's host may seat anybody, and the host takes a seat with the first guest
--   2  notice      the guest hears once, with the address that answers it; nobody else hears anything
--   3  repeat      asking again changes no answer and sends no second notice
--   4  sight       a seat shows a guest the entry, and their answer takes the door every seat answers by
--   5  withdraw    the seat is archived, not deleted; its person loses sight of the entry and is told
--   6  private     the last guest gone, the entry has no roster and its host moves it freely again
--   7  again       inviting a withdrawn person restores the row and asks afresh
--   8  refusals    a series, a moment, a connected entry, a past entry and an open round take no guest
--   9  cancel      withdrawing with no attendee named clears the list, so the entry can be removed
--  10  clashes     a seat holds time only once accepted; passive, cancelled and moments hold none
--  11  named       a call and a blackout are named; a span's edge is no clash; the exclusion holds
--  12  own only    nobody reads another person's calendar through the clash door
--  13  moved       a round closed as the service role carries, and tells everyone but who carried it
--  14  address     a guest's address is withheld from every client role
--
-- Run: docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/event_invitations.sql
\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.ok(p boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
END;
$$;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', p_user, 'role', 'authenticated')::text,
        true
    );
$$;

-- The door's SQLSTATE, or NULL when it answered.
CREATE FUNCTION pg_temp.refused(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END;
$$;

DO $probe$
DECLARE
    v_host uuid;
    v_guest uuid;
    v_third uuid;
    v_schedule uuid;
    v_event uuid;
    v_other uuid;
    v_seat uuid;
    v_round uuid;
    v_proposal uuid;
    v_call uuid;
    v_now timestamptz := pg_catalog.now();
    v_from timestamptz := v_now + interval '30 days';
    v_to timestamptz := v_now + interval '30 days 1 hour';
    v_n integer;
    v_clashes jsonb;
    v_url text;
BEGIN
    SELECT (array_agg(p.user_id))[1], (array_agg(p.user_id))[2], (array_agg(p.user_id))[3]
      INTO v_host, v_guest, v_third
      FROM (SELECT user_id FROM org.users_public ORDER BY user_id LIMIT 3) p;
    PERFORM pg_temp.ok(v_third IS NOT NULL, 'the seed has three people');

    SELECT id INTO v_schedule FROM scheduling.schedules
     WHERE owner_type = 'user' AND owner_id = v_host;
    IF v_schedule IS NULL THEN
        INSERT INTO scheduling.schedules (owner_type, owner_id) VALUES ('user', v_host)
        RETURNING id INTO v_schedule;
    END IF;

    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by, availability_behavior)
    VALUES (v_schedule, 'sync', 'Probe review', v_from, v_to, v_host, 'passive')
    RETURNING id INTO v_event;

    -- 1 door
    PERFORM pg_temp.as_user(v_guest);
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ARRAY[%L]::uuid[])', v_event, v_third)) = '42501',
        'somebody else''s entry is not theirs to invite to'
    );
    PERFORM pg_temp.as_user(v_host);
    PERFORM pg_temp.ok(
        scheduling.invite_to_event(v_event, ARRAY[v_guest, v_host]) = 1,
        'one person was asked: the host does not invite themselves'
    );
    PERFORM pg_temp.ok(
        (SELECT role::text || '/' || response::text FROM scheduling.event_attendees
          WHERE event_id = v_event AND user_id = v_host) = 'host/accepted',
        'the host took a seat, already going'
    );
    PERFORM pg_temp.ok(
        (SELECT response::text FROM scheduling.event_attendees
          WHERE event_id = v_event AND user_id = v_guest) = 'pending',
        'the guest is waiting to be answered'
    );
    PERFORM pg_temp.ok(
        (SELECT availability_behavior FROM scheduling.events WHERE id = v_event) = 'disruptive',
        'a passive entry with people on it holds its time'
    );

    -- 2 notice
    SELECT action_url INTO v_url FROM comms.notifications
     WHERE type = 'schedule.event_invite' AND entity_id = v_event AND user_id = v_guest;
    PERFORM pg_temp.ok(
        v_url = '/calendar?filter=invitations&event=' || v_event::text,
        format('the notice carries the address that answers it, not %s', v_url)
    );
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM comms.notifications
          WHERE type = 'schedule.event_invite' AND entity_id = v_event) = 1,
        'only the guest hears'
    );

    -- 3 repeat
    UPDATE scheduling.event_attendees SET response = 'accepted', responded_at = v_now
     WHERE event_id = v_event AND user_id = v_guest;
    PERFORM pg_temp.ok(
        scheduling.invite_to_event(v_event, ARRAY[v_guest]) = 0,
        'somebody already seated is not asked again'
    );
    PERFORM pg_temp.ok(
        (SELECT response::text FROM scheduling.event_attendees
          WHERE event_id = v_event AND user_id = v_guest) = 'accepted',
        'and keeps their answer'
    );
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM comms.notifications
          WHERE type = 'schedule.event_invite' AND entity_id = v_event) = 1,
        'and hears nothing more'
    );

    -- 4 sight, as the guest under RLS
    PERFORM pg_temp.as_user(v_guest);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM scheduling.events WHERE id = v_event;
    IF v_n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL: a seat shows its guest the entry'; END IF;
    BEGIN
        UPDATE scheduling.event_attendees SET response = 'rejected'
         WHERE event_id = v_event AND user_id = v_guest;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RAISE EXCEPTION 'PROBE FAIL: a client wrote a seat directly (% rows)', v_n;
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    RESET ROLE;

    -- 5 withdraw
    PERFORM pg_temp.as_user(v_guest);
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.withdraw_invitation(%L)', v_event)) = '42501',
        'a guest cannot withdraw anybody'
    );
    PERFORM pg_temp.as_user(v_host);
    SELECT id INTO v_seat FROM scheduling.event_attendees WHERE event_id = v_event AND user_id = v_guest;
    PERFORM pg_temp.ok(scheduling.withdraw_invitation(v_event, v_seat) = 1, 'one invitation withdrawn');
    PERFORM pg_temp.ok(
        (SELECT archived_at IS NOT NULL FROM scheduling.event_attendees WHERE id = v_seat),
        'the seat is archived, never deleted'
    );
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM comms.notifications
          WHERE type = 'schedule.event_invite_withdrawn' AND entity_id = v_event AND user_id = v_guest) = 1,
        'its person is told'
    );
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.withdraw_invitation(%L, %L)', v_event, v_seat)) = '55000',
        'an invitation cannot be withdrawn twice'
    );
    PERFORM pg_temp.as_user(v_guest);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM scheduling.events WHERE id = v_event;
    IF v_n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL: a withdrawn guest can still read the entry'; END IF;
    SELECT count(*) INTO v_n FROM scheduling.event_attendees WHERE event_id = v_event;
    IF v_n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL: a withdrawn guest can still read the roster'; END IF;
    RESET ROLE;

    -- 6 private
    PERFORM pg_temp.ok(
        NOT scheduling.fn_event_has_roster(v_event),
        'the last guest gone, the entry has no roster'
    );
    PERFORM pg_temp.as_user(v_host);
    SET LOCAL ROLE authenticated;
    UPDATE scheduling.events SET starts_at = v_from + interval '1 hour', ends_at = v_to + interval '1 hour'
     WHERE id = v_event;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL: its host could not move it'; END IF;
    RESET ROLE;
    UPDATE scheduling.events SET starts_at = v_from, ends_at = v_to WHERE id = v_event;

    -- 7 again
    PERFORM pg_temp.ok(scheduling.invite_to_event(v_event, ARRAY[v_guest]) = 1, 'asked afresh');
    PERFORM pg_temp.ok(
        (SELECT response::text || '/' || (archived_at IS NULL)::text
           FROM scheduling.event_attendees WHERE id = v_seat) = 'pending/true',
        'the same row, restored and unanswered'
    );
    PERFORM pg_temp.as_user(v_host);
    SET LOCAL ROLE authenticated;
    BEGIN
        UPDATE scheduling.events SET starts_at = v_from + interval '2 hours' WHERE id = v_event;
        RAISE EXCEPTION 'PROBE FAIL: a rostered entry moved outside a round';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        NULL;
    END;
    RESET ROLE;

    -- 8 refusals
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by, recurrence_rule)
    VALUES (v_schedule, 'sync', 'Probe series', v_from, v_to, v_host, 'FREQ=DAILY;COUNT=2')
    RETURNING id INTO v_other;
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ARRAY[%L]::uuid[])', v_other, v_guest)) = '55000',
        'a series takes no guest'
    );
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'deadline', 'Probe due', v_from, v_from, v_host)
    RETURNING id INTO v_other;
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ARRAY[%L]::uuid[])', v_other, v_guest)) = '55000',
        'a moment takes no guest'
    );
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe past', v_now - interval '2 hours', v_now - interval '1 hour', v_host)
    RETURNING id INTO v_other;
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ARRAY[%L]::uuid[])', v_other, v_guest)) = '55000',
        'a past entry takes no guest'
    );
    INSERT INTO scheduling.event_reschedules (event_id, round, mode, status, opened_by_user_id, opened_at)
    VALUES (v_event, 0, 'counterparty', 'collecting', v_host, v_now)
    RETURNING id INTO v_round;
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ARRAY[%L]::uuid[])', v_event, v_third)) = '55000',
        'nobody joins while a round is open'
    );
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.withdraw_invitation(%L, %L)', v_event, v_seat)) = '55000',
        'nobody leaves while a round is open'
    );

    -- 13 moved: a round that carries tells everyone but whoever carried it. As the service role, which
    -- is who closes one: it holds no USAGE on `comms`, and as the owner this would prove nothing.
    INSERT INTO scheduling.reschedule_proposals
        (reschedule_id, starts_at, ends_at, proposed_by_user_id, proposed_by_role, approved)
    VALUES (v_round, v_from + interval '1 day', v_to + interval '1 day', v_host, 'host', true)
    RETURNING id INTO v_proposal;
    SET LOCAL ROLE service_role;
    PERFORM scheduling.fn_notify_event_seats(v_event, 'host', 'New time proposed', 'Answer.', v_guest);
    PERFORM scheduling.close_reschedule_round(v_round, 'resolved', v_proposal, v_host, 'Moved', NULL);
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM comms.notifications
          WHERE type = 'schedule.event_reschedule' AND entity_id = v_event AND user_id = v_guest) = 1,
        'the guest hears the time moved'
    );
    PERFORM pg_temp.ok(
        (SELECT title FROM comms.notifications
          WHERE type = 'schedule.event_reschedule' AND entity_id = v_event AND user_id = v_guest) = 'New time: Probe review',
        'and which entry it was'
    );
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM comms.notifications
          WHERE type = 'schedule.event_reschedule' AND entity_id = v_event AND user_id = v_host
            AND title LIKE 'New time:%') = 0,
        'whoever carried it does not'
    );
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM comms.notifications
          WHERE type = 'schedule.event_reschedule' AND entity_id = v_event AND user_id = v_host
            AND title LIKE 'New time proposed:%') = 1,
        'and the host alone heard of the proposed time'
    );
    PERFORM pg_temp.ok(
        (SELECT starts_at FROM scheduling.events WHERE id = v_event) = v_from + interval '1 day',
        'and the entry moved'
    );
    UPDATE scheduling.events SET starts_at = v_from, ends_at = v_to WHERE id = v_event;

    -- 10 clashes: the guest's seat holds nothing until it is accepted
    PERFORM pg_temp.as_user(v_guest);
    PERFORM pg_temp.ok(
        NOT scheduling.fn_detect_event_clashes(v_guest, v_from, v_to) @> jsonb_build_array(jsonb_build_object('id', v_event)),
        'an unanswered invitation holds nothing'
    );
    UPDATE scheduling.event_attendees SET response = 'accepted', responded_at = v_now WHERE id = v_seat;
    v_clashes := scheduling.fn_detect_event_clashes(v_guest, v_from, v_to);
    PERFORM pg_temp.ok(
        v_clashes @> jsonb_build_array(jsonb_build_object('id', v_event, 'kind', 'event', 'title', 'Probe review')),
        format('an accepted seat holds its time: %s', v_clashes)
    );
    UPDATE scheduling.event_attendees SET response = 'tentative' WHERE id = v_seat;
    PERFORM pg_temp.ok(
        scheduling.fn_detect_event_clashes(v_guest, v_from, v_to) @> jsonb_build_array(jsonb_build_object('id', v_event)),
        'so does a tentative one'
    );
    UPDATE scheduling.event_attendees SET response = 'rejected' WHERE id = v_seat;
    PERFORM pg_temp.ok(
        NOT scheduling.fn_detect_event_clashes(v_guest, v_from, v_to) @> jsonb_build_array(jsonb_build_object('id', v_event)),
        'a declined one does not'
    );

    PERFORM pg_temp.as_user(v_host);
    PERFORM pg_temp.ok(
        scheduling.fn_detect_event_clashes(v_host, v_from, v_to) @> jsonb_build_array(jsonb_build_object('id', v_event)),
        'the host holds their own entry'
    );
    PERFORM pg_temp.ok(
        NOT scheduling.fn_detect_event_clashes(v_host, v_from, v_to, v_event) @> jsonb_build_array(jsonb_build_object('id', v_event)),
        'an entry being moved does not clash with itself'
    );
    PERFORM pg_temp.ok(
        NOT scheduling.fn_detect_event_clashes(v_host, v_to, v_to + interval '1 hour') @> jsonb_build_array(jsonb_build_object('id', v_event)),
        'back to back is no clash'
    );

    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by, availability_behavior)
    VALUES (v_schedule, 'sync', 'Probe open', v_from, v_to, v_host, 'passive')
    RETURNING id INTO v_other;
    PERFORM pg_temp.ok(
        NOT scheduling.fn_detect_event_clashes(v_host, v_from, v_to) @> jsonb_build_array(jsonb_build_object('id', v_other)),
        'a passive entry holds nothing'
    );
    INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'cancelled', 'Probe off', v_from, v_to, v_host)
    RETURNING id INTO v_other;
    PERFORM pg_temp.ok(
        NOT scheduling.fn_detect_event_clashes(v_host, v_from, v_to) @> jsonb_build_array(jsonb_build_object('id', v_other)),
        'a cancelled entry holds nothing'
    );
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'deadline', 'Probe moment', v_from + interval '10 minutes', v_from + interval '10 minutes', v_host)
    RETURNING id INTO v_other;
    PERFORM pg_temp.ok(
        NOT scheduling.fn_detect_event_clashes(v_host, v_from, v_to) @> jsonb_build_array(jsonb_build_object('id', v_other)),
        'a moment has no span to clash with'
    );

    -- 11 named
    INSERT INTO scheduling.blackout_dates (schedule_id, starts_at, ends_at, label)
    VALUES (v_schedule, v_from, v_to, 'Probe leave');
    PERFORM pg_temp.ok(
        scheduling.fn_detect_event_clashes(v_host, v_from, v_to) @> jsonb_build_array(jsonb_build_object('kind', 'blackout', 'title', 'Probe leave')),
        'time off is named'
    );

    -- 12 own only
    PERFORM pg_temp.as_user(v_guest);
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.fn_detect_event_clashes(%L, %L, %L)', v_host, v_from, v_to)) = '42501',
        'nobody reads another person''s calendar through this'
    );

    -- 9 cancel
    PERFORM pg_temp.as_user(v_host);
    PERFORM pg_temp.ok(scheduling.invite_to_event(v_event, ARRAY[v_third]) = 1, 'a second guest');
    PERFORM pg_temp.ok(
        scheduling.withdraw_invitation(v_event) = 2,
        'no attendee named clears the list'
    );
    PERFORM pg_temp.ok(NOT scheduling.fn_event_has_roster(v_event), 'and takes the host''s seat with it');
    SET LOCAL ROLE authenticated;
    UPDATE scheduling.events SET status = 'cancelled', archived_at = v_now WHERE id = v_event;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL: the cleared entry could not be removed'; END IF;
    RESET ROLE;

    -- 14 address
    PERFORM pg_temp.ok(
        NOT has_column_privilege('authenticated', 'scheduling.event_attendees', 'email', 'SELECT'),
        'a guest''s address is withheld from client roles'
    );
    PERFORM pg_temp.ok(
        has_column_privilege('authenticated', 'scheduling.event_attendees', 'response', 'SELECT'),
        'and only the address'
    );
    PERFORM pg_temp.ok(
        NOT has_function_privilege('authenticated', 'scheduling.fn_invitable_event(uuid)', 'EXECUTE'),
        'the guard is reachable only through its doors'
    );
    PERFORM pg_temp.ok(
        NOT has_function_privilege('authenticated', 'scheduling.fn_notify_event_seats(uuid,text,text,text,uuid)', 'EXECUTE'),
        'and no client can ping a roster'
    );

    RAISE NOTICE 'PASS event_invitations';
END;
$probe$;

ROLLBACK;
