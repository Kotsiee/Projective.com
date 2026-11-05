-- =============================================================================================
-- Probe: attendance is every join and leave, and no-show evidence needs more than silence
-- (Decision #383 (a), (b), rulings R5; Decision #343, rulings C4 (b), C5).
--
--   1  the gamed span: in at minute 1, out at 2, back from 59 to 60 reads 3 %, with one reconnect
--   2  several devices count once; a join with no `left` adds nothing; time is clipped to the meeting
--   3  order cannot change the answer: a `left` redelivered after a rejoin leaves them in the room
--   4  who it was: host by account, registrant, email as weaker evidence, never email over a personal
--      link, the sole attendee by elimination; a replay is one row
--   5  the dispute audit reads time in the room, and exactly 80 % does not dismiss
--   6  R5: an attendee in the room and no host refunds; a click alone holds; a click with the
--      provider's record read refunds; silence holds
--   7  room_join: who gets a link and when; a click is recorded; the RSVP gate on get_event_rooms
--   8  retention: records go on time, but never from under a dispute or a payment still held
--   9  once a provider's record is read it is the whole story, so a lost webhook `left` costs nothing
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/presence_ledger.sql
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

-- #region 0. Helpers
CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_user IS NULL THEN
        PERFORM set_config('role', 'postgres', true);
        PERFORM set_config('request.jwt.claims', '', true);
    ELSE
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
    END IF;
END $$;

DO $$
DECLARE v_project uuid; v_stage uuid; v_host uuid; v_a uuid; v_b uuid;
BEGIN
    SELECT p.id, s.id, p.owner_user_id INTO v_project, v_stage, v_host
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id IS NOT NULL AND p.owner_team_id IS NULL
     ORDER BY p.id, s.id LIMIT 1;
    SELECT u.user_id INTO v_a FROM org.users_public u WHERE u.user_id <> v_host ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_b FROM org.users_public u WHERE u.user_id NOT IN (v_host, v_a) ORDER BY u.user_id LIMIT 1;
    PERFORM set_config('probe.project', v_project::text, true);
    PERFORM set_config('probe.stage', v_stage::text, true);
    PERFORM set_config('probe.host', v_host::text, true);
    PERFORM set_config('probe.a', v_a::text, true);
    PERFORM set_config('probe.b', v_b::text, true);
END $$;

-- A sitting with a minted room and the given attendees, starting p_ago before now, one hour long.
CREATE FUNCTION pg_temp.sitting(p_tag text, p_ago interval, p_seats uuid[]) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_cohort uuid; v_event uuid; u uuid;
    v_start timestamptz := now() - p_ago;
BEGIN
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid, 'Probe ' || p_tag)
    RETURNING id INTO v_cohort;
    FOREACH u IN ARRAY p_seats LOOP
        INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, u);
    END LOOP;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, meeting_provider, provider_meeting_id)
    VALUES (v_cohort, 'Probe ' || p_tag, v_start, v_start + interval '1 hour', 'zoom', 'room-' || p_tag)
    RETURNING id INTO v_event;
    UPDATE scheduling.rooms SET provider_host_id = 'host-account' WHERE session_event_id = v_event;
    RETURN v_event;
END $$;

-- One event from the room, the way the webhook hands it over. p_at is minutes after the start.
CREATE FUNCTION pg_temp.ev(
    p_tag text, p_action text, p_minutes numeric, p_key text,
    p_email text DEFAULT NULL, p_registrant text DEFAULT NULL, p_account text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql AS $$
    SELECT scheduling.record_presence('zoom', 'room-' || p_tag, p_action,
        (SELECT e.start_time + make_interval(secs => p_minutes * 60)
           FROM projects.session_events e WHERE e.provider_meeting_id = 'room-' || p_tag),
        p_tag || ':' || p_key, COALESCE(p_account, p_registrant, p_email, p_key),
        p_email, p_registrant, p_account);
$$;

CREATE FUNCTION pg_temp.room(p_event uuid) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM scheduling.rooms WHERE session_event_id = p_event;
$$;

CREATE FUNCTION pg_temp.outcome(p_event uuid) RETURNS text LANGUAGE sql AS $$
    SELECT projects.fn_session_presence(p_event) ->> 'outcome';
$$;
-- #endregion

-- #region 1. The gamed span
DO $$
DECLARE
    v_event uuid := pg_temp.sitting('gamed', interval '2 hours', ARRAY[current_setting('probe.a')::uuid]);
    p record;
BEGIN
    PERFORM pg_temp.ev('gamed', 'joined', 1, 'h1', p_account => 'host-account');
    PERFORM pg_temp.ev('gamed', 'left', 2, 'h2', p_account => 'host-account');
    PERFORM pg_temp.ev('gamed', 'joined', 59, 'h3', p_account => 'host-account');
    PERFORM pg_temp.ev('gamed', 'left', 60, 'h4', p_account => 'host-account');
    SELECT * INTO p FROM scheduling.fn_room_presence(pg_temp.room(v_event)) x WHERE x.is_host;
    PERFORM pg_temp.check(p.total_seconds = 120, 'two minutes in the room counts as two minutes');
    PERFORM pg_temp.check(p.reconnect_count = 1, 'and shows one reconnect');
    PERFORM pg_temp.check(p.matched_by = 'host_account' AND p.in_presence_window AND NOT p.open_span,
        'the host is known by their account');
    PERFORM pg_temp.check((SELECT left_at IS NOT NULL FROM projects.session_attendance
        WHERE session_event_id = v_event), 'the summary row still reads first join to last leave');
END $$;
-- #endregion

-- #region 2. Devices, open spans, clipping
DO $$
DECLARE
    v_event uuid := pg_temp.sitting('devices', interval '2 hours', ARRAY[current_setting('probe.a')::uuid]);
    p record;
BEGIN
    PERFORM pg_temp.ev('devices', 'joined', -5, 'a', p_account => 'host-account');
    PERFORM pg_temp.ev('devices', 'joined', 10, 'b', p_account => 'host-account');
    PERFORM pg_temp.ev('devices', 'left', 20, 'c', p_account => 'host-account');
    PERFORM pg_temp.ev('devices', 'left', 70, 'd', p_account => 'host-account');
    SELECT * INTO p FROM scheduling.fn_room_presence(pg_temp.room(v_event)) x WHERE x.is_host;
    PERFORM pg_temp.check(p.total_seconds = 3600, 'two devices count once, clipped to the sitting');
    PERFORM pg_temp.check(p.reconnect_count = 0, 'and a second device is not a reconnect');

    PERFORM pg_temp.ev('devices', 'joined', 5, 'e', p_registrant => 'nobody');
    SELECT * INTO p FROM scheduling.fn_room_presence(pg_temp.room(v_event)) x WHERE NOT x.is_host;
    PERFORM pg_temp.check(p.total_seconds = 0 AND p.open_span, 'a join with no left adds nothing and says so');
END $$;
-- #endregion

-- #region 3. Order cannot change the answer
DO $$
DECLARE
    v_event uuid := pg_temp.sitting('order', interval '2 hours', ARRAY[current_setting('probe.a')::uuid]);
BEGIN
    PERFORM pg_temp.ev('order', 'joined', 0, 'j1', p_account => 'host-account');
    PERFORM pg_temp.ev('order', 'joined', 30, 'j2', p_account => 'host-account');
    PERFORM pg_temp.ev('order', 'left', 10, 'l1', p_account => 'host-account');
    PERFORM pg_temp.check((SELECT left_at IS NULL FROM projects.session_attendance
        WHERE session_event_id = v_event), 'a left that arrives after a later rejoin leaves them in the room');
    PERFORM pg_temp.check((pg_temp.ev('order', 'left', 10, 'l1', p_account => 'host-account') ->> 'outcome') = 'replayed',
        'a redelivery is a replay');
END $$;
-- #endregion

-- #region 4. Who it was
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_b uuid := current_setting('probe.b')::uuid;
    v_event uuid;
    v_email text;
    r jsonb;
BEGIN
    SELECT email INTO v_email FROM auth.users WHERE id = v_a;

    v_event := pg_temp.sitting('who', interval '2 hours', ARRAY[v_a, v_b]);
    r := pg_temp.ev('who', 'joined', 1, 'k1', p_email => v_email);
    PERFORM pg_temp.check(r ->> 'matched_by' = 'email' AND r ->> 'outcome' = 'recorded', 'an email alone is a match');
    PERFORM pg_temp.check((SELECT source = 'webhook_email' FROM projects.session_attendance
        WHERE session_event_id = v_event AND user_id = v_a), 'and is marked as weaker evidence');

    INSERT INTO scheduling.room_registrants (room_id, user_id, registrant_id, join_url)
    VALUES (pg_temp.room(v_event), v_b, 'reg-b', 'https://zoom.us/w/probe?tk=b');
    r := pg_temp.ev('who', 'joined', 2, 'k2', p_registrant => 'reg-b');
    PERFORM pg_temp.check(r ->> 'matched_by' = 'registrant', 'a registrant id names its person');
    r := pg_temp.ev('who', 'joined', 3, 'k3', p_email => (SELECT email FROM auth.users WHERE id = v_b));
    PERFORM pg_temp.check(r ->> 'outcome' = 'unmatched',
        'an email never stands in for somebody with their own link');
    r := pg_temp.ev('who', 'joined', 4, 'k4', p_registrant => 'stranger');
    PERFORM pg_temp.check(r ->> 'outcome' = 'unmatched', 'an unknown person in a two-seat room stays unmatched');

    PERFORM pg_temp.sitting('solo', interval '2 hours', ARRAY[v_a]);
    r := pg_temp.ev('solo', 'joined', 1, 'k5', p_registrant => 'nobody');
    PERFORM pg_temp.check(r ->> 'matched_by' = 'sole_attendee', 'one seat: the participant who is not the host is the attendee');
END $$;
-- #endregion

-- #region 5. The audit
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_project uuid := current_setting('probe.project')::uuid;
    v_event uuid;
    v_escrow uuid;
    v_member uuid;
    v_dispute uuid;
    v_audit jsonb;
BEGIN
    v_event := pg_temp.sitting('audit', interval '2 hours', ARRAY[v_a]);
    SELECT cm.id INTO v_member FROM projects.cohort_memberships cm
      JOIN projects.session_events e ON e.cohort_id = cm.cohort_id WHERE e.id = v_event;
    INSERT INTO finance.escrows (project_stage_id, cohort_membership_id, session_event_id, payer_user_id,
                                 payee_type, payee_id, amount_cents, currency, status)
    VALUES (current_setting('probe.stage')::uuid, v_member, v_event, v_a, 'freelancer',
            current_setting('probe.host')::uuid, 10000, 'GBP', 'held')
    RETURNING id INTO v_escrow;
    INSERT INTO finance.disputes (escrow_id, session_event_id, opened_by_profile, reason)
    VALUES (v_escrow, v_event, v_a, 'Probe') RETURNING id INTO v_dispute;

    PERFORM pg_temp.ev('audit', 'joined', 0, 'a1', p_account => 'host-account');
    PERFORM pg_temp.ev('audit', 'left', 2, 'a2', p_account => 'host-account');
    PERFORM pg_temp.ev('audit', 'joined', 59, 'a3', p_account => 'host-account');
    PERFORM pg_temp.ev('audit', 'left', 60, 'a4', p_account => 'host-account');
    PERFORM pg_temp.ev('audit', 'joined', 0, 'c1', p_registrant => 'nobody');
    PERFORM pg_temp.ev('audit', 'left', 60, 'c2', p_registrant => 'nobody');
    v_audit := finance.fn_dispute_attendance_audit(v_dispute);
    PERFORM pg_temp.check((v_audit ->> 'host_presence_pct')::integer = 5, 'the gamed host audits at 5 %');
    PERFORM pg_temp.check(v_audit ->> 'verdict' = 'ambiguous', 'and cannot get a claim dismissed');
    PERFORM pg_temp.check((v_audit ->> 'reconnects')::integer = 1, 'the snapshot carries the reconnect');

    DELETE FROM scheduling.presence_events WHERE room_id = pg_temp.room(v_event) AND idempotency_key LIKE 'audit:a%';
    PERFORM pg_temp.ev('audit', 'joined', 0, 'b1', p_account => 'host-account');
    PERFORM pg_temp.ev('audit', 'left', 48, 'b2', p_account => 'host-account');
    v_audit := finance.fn_dispute_attendance_audit(v_dispute);
    PERFORM pg_temp.check((v_audit ->> 'host_presence_pct')::integer = 80 AND v_audit ->> 'verdict' = 'ambiguous',
        'exactly 80 % does not dismiss');
    PERFORM pg_temp.ev('audit', 'joined', 49, 'b3', p_account => 'host-account');
    PERFORM pg_temp.ev('audit', 'left', 60, 'b4', p_account => 'host-account');
    v_audit := finance.fn_dispute_attendance_audit(v_dispute);
    PERFORM pg_temp.check(v_audit ->> 'verdict' = 'dismiss', 'more than 80 % does');
    PERFORM pg_temp.check(
        jsonb_array_length(v_audit -> 'timeline') = (SELECT count(*) FROM scheduling.presence_events p
            WHERE p.room_id = pg_temp.room(v_event)),
        'the snapshot freezes the whole log');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_audit -> 'timeline') t WHERE t ->> 'party' NOT IN ('host', 'claimant')),
        'by party');
    PERFORM pg_temp.check(position(v_a::text IN (v_audit -> 'timeline')::text) = 0, 'and it names nobody');
END $$;
-- #endregion

-- #region 6. R5: what proves a host never came
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_event uuid;
BEGIN
    v_event := pg_temp.sitting('inroom', interval '2 hours', ARRAY[v_a]);
    PERFORM pg_temp.ev('inroom', 'joined', 3, 'x', p_registrant => 'nobody');
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'provider_no_show', 'an attendee in the room and no host');

    v_event := pg_temp.sitting('late', interval '2 hours', ARRAY[v_a]);
    PERFORM pg_temp.ev('late', 'joined', 20, 'x', p_registrant => 'nobody');
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'provider_no_show', 'a late attendee and no host (audit S-08)');

    v_event := pg_temp.sitting('click', interval '2 hours', ARRAY[v_a]);
    INSERT INTO scheduling.presence_events (room_id, idempotency_key, action, occurred_at, source, matched_by, user_id, participant_key)
    VALUES (pg_temp.room(v_event), 'click', 'join_click', now() - interval '115 minutes', 'platform', 'session', v_a, v_a::text);
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'untracked', 'a click alone is not proof: the sitting holds');
    UPDATE scheduling.rooms SET reconciled_at = now() WHERE id = pg_temp.room(v_event);
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'provider_no_show',
        'a click with the provider''s record read and no host in it is');

    v_event := pg_temp.sitting('silent', interval '2 hours', ARRAY[v_a]);
    UPDATE scheduling.rooms SET reconciled_at = now() WHERE id = pg_temp.room(v_event);
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'untracked', 'silence is never enough, even read back');

    v_event := pg_temp.sitting('hostonly', interval '2 hours', ARRAY[v_a]);
    PERFORM pg_temp.ev('hostonly', 'joined', 1, 'x', p_account => 'host-account');
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'attendee_no_show', 'the host alone is an attendee no-show');

    v_event := pg_temp.sitting('both', interval '2 hours', ARRAY[v_a]);
    PERFORM pg_temp.ev('both', 'joined', 1, 'h', p_account => 'host-account');
    PERFORM pg_temp.ev('both', 'joined', 2, 'a', p_registrant => 'nobody');
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'successful', 'both in the window is a success');
END $$;
-- #endregion

-- #region 7. Joining
DO $$
DECLARE
    v_host uuid;
    v_a uuid;
    v_b uuid;
    v_schedule uuid;
    v_event uuid;
    v_room scheduling.rooms;
    v_call uuid;
    j jsonb;
    n integer;
BEGIN
    SELECT sc.id, scheduling.fn_schedule_host(sc.id) INTO v_schedule, v_host
      FROM scheduling.schedules sc WHERE scheduling.fn_schedule_host(sc.id) IS NOT NULL ORDER BY sc.id LIMIT 1;
    SELECT u.user_id INTO v_a FROM org.users_public u WHERE u.user_id <> v_host ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_b FROM org.users_public u WHERE u.user_id NOT IN (v_host, v_a) ORDER BY u.user_id LIMIT 1;
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by, meeting_provider,
                                   meeting_url)
    VALUES (v_schedule, 'general', 'Probe room', now() + interval '5 minutes', now() + interval '35 minutes',
            v_host, 'zoom', 'https://zoom.us/j/probe')
    RETURNING id INTO v_event;
    INSERT INTO scheduling.rooms (event_id, provider, provider_meeting_id, status)
    VALUES (v_event, 'zoom', 'probe-event-room', 'ready') RETURNING * INTO v_room;
    INSERT INTO scheduling.event_attendees (event_id, user_id, role, response, responded_at)
    VALUES (v_event, v_a, 'participant', 'pending', NULL), (v_event, v_b, 'participant', 'rejected', now());

    PERFORM pg_temp.act(v_a);
    j := scheduling.room_join(v_room.slug);
    SELECT count(*) INTO n FROM scheduling.get_event_rooms(ARRAY[v_event]);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(j ->> 'state' = 'needs_rsvp' AND j ->> 'url' IS NULL, 'an invitee who has not answered gets no link');
    PERFORM pg_temp.check(n = 0, 'nor through get_event_rooms');

    PERFORM pg_temp.act(v_b);
    j := scheduling.room_join(v_room.slug);
    SELECT count(*) INTO n FROM scheduling.get_event_rooms(ARRAY[v_event]);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(j ->> 'state' = 'not_party' AND n = 0, 'a person who declined loses the link');

    UPDATE scheduling.event_attendees SET response = 'accepted', responded_at = now()
     WHERE event_id = v_event AND user_id = v_a;
    PERFORM pg_temp.act(v_a);
    j := scheduling.room_join(v_room.slug);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(j ->> 'state' = 'open' AND j ->> 'url' = 'https://zoom.us/j/probe' AND j ->> 'role' = 'attendee',
        'an accepted attendee inside the window gets the link');
    PERFORM pg_temp.check(j ->> 'provider_meeting_id' IS NULL, 'with no provider ids');
    PERFORM pg_temp.check((SELECT count(*) = 1 FROM scheduling.presence_events p
        WHERE p.room_id = v_room.id AND p.action = 'join_click' AND p.user_id = v_a), 'and the press is recorded');

    UPDATE scheduling.events SET starts_at = now() + interval '1 hour', ends_at = now() + interval '2 hours' WHERE id = v_event;
    PERFORM pg_temp.act(v_a);
    j := scheduling.room_join(v_room.slug);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(j ->> 'state' = 'upcoming' AND j ->> 'url' IS NULL, 'outside the window there is no link');

    PERFORM pg_temp.act(v_host);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(NOT has_column_privilege('authenticated', 'scheduling.discovery_calls', 'meeting_url', 'SELECT'),
        'a call''s room is withheld from clients at the column level');
END $$;
-- #endregion

-- #region 8. Retention
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_b uuid := current_setting('probe.b')::uuid;
    v_email text := (SELECT email FROM auth.users WHERE id = v_a);
    v_old uuid;
    v_held uuid;
    v_closed uuid;
    v_member uuid;
    v_escrow uuid;
    v_seats uuid[] := ARRAY[v_a, v_b];
BEGIN
    v_old := pg_temp.sitting('ret-old', interval '2 hours', v_seats);
    PERFORM pg_temp.ev('ret-old', 'joined', 0, 'expired', p_email => v_email);
    PERFORM pg_temp.ev('ret-old', 'left', 1, 'kept', p_email => v_email);
    PERFORM pg_temp.ev('ret-old', 'joined', 2, 'stranger', p_registrant => 'nobody-1');
    PERFORM pg_temp.ev('ret-old', 'joined', 3, 'recent', p_registrant => 'nobody-2');
    UPDATE scheduling.presence_events p SET occurred_at = now() - CASE p.idempotency_key
        WHEN 'ret-old:expired' THEN interval '396 days'
        WHEN 'ret-old:kept' THEN interval '31 days'
        WHEN 'ret-old:stranger' THEN interval '31 days'
        ELSE interval '29 days' END
     WHERE p.room_id = pg_temp.room(v_old);
    UPDATE projects.session_attendance SET joined_at = now() - interval '396 days', left_at = NULL
     WHERE session_event_id = v_old;

    v_held := pg_temp.sitting('ret-held', interval '2 hours', v_seats);
    PERFORM pg_temp.ev('ret-held', 'joined', 0, 'h1', p_email => v_email);
    UPDATE scheduling.presence_events SET occurred_at = now() - interval '396 days' WHERE room_id = pg_temp.room(v_held);
    UPDATE projects.session_attendance SET joined_at = now() - interval '396 days', left_at = NULL
     WHERE session_event_id = v_held;
    SELECT cm.id INTO v_member FROM projects.cohort_memberships cm
      JOIN projects.session_events e ON e.cohort_id = cm.cohort_id
     WHERE e.id = v_held AND cm.user_id = v_a;
    INSERT INTO finance.escrows (project_stage_id, cohort_membership_id, session_event_id, payer_user_id,
                                 payee_type, payee_id, amount_cents, currency, status)
    VALUES (current_setting('probe.stage')::uuid, v_member, v_held, v_a, 'freelancer',
            current_setting('probe.host')::uuid, 10000, 'GBP', 'held');

    v_closed := pg_temp.sitting('ret-closed', interval '2 hours', v_seats);
    PERFORM pg_temp.ev('ret-closed', 'joined', 0, 'c1', p_email => v_email);
    UPDATE scheduling.presence_events SET occurred_at = now() - interval '396 days' WHERE room_id = pg_temp.room(v_closed);
    SELECT cm.id INTO v_member FROM projects.cohort_memberships cm
      JOIN projects.session_events e ON e.cohort_id = cm.cohort_id
     WHERE e.id = v_closed AND cm.user_id = v_a;
    INSERT INTO finance.escrows (project_stage_id, cohort_membership_id, session_event_id, payer_user_id,
                                 payee_type, payee_id, amount_cents, currency, status)
    VALUES (current_setting('probe.stage')::uuid, v_member, v_closed, v_a, 'freelancer',
            current_setting('probe.host')::uuid, 10000, 'GBP', 'released')
    RETURNING id INTO v_escrow;
    INSERT INTO finance.disputes (escrow_id, session_event_id, opened_by_profile, reason, status, resolved_at)
    VALUES (v_escrow, v_closed, v_a, 'Probe', 'resolved_release', now());

    PERFORM pg_temp.check(NOT has_function_privilege('authenticated', 'scheduling.fn_prune_presence()', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'scheduling.fn_prune_presence()', 'EXECUTE'),
        'only the scheduler runs the deletion');

    PERFORM scheduling.fn_prune_presence();

    PERFORM pg_temp.check(
        (SELECT array_agg(p.idempotency_key ORDER BY p.idempotency_key) FROM scheduling.presence_events p
          WHERE p.room_id = pg_temp.room(v_old)) = ARRAY['ret-old:kept', 'ret-old:recent'],
        'a person''s record goes after 13 months, an unmatched one after 30 days');
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM projects.session_attendance a WHERE a.session_event_id = v_old),
        'the summary row goes too');
    PERFORM pg_temp.check((SELECT count(*) = 1 FROM scheduling.presence_events p WHERE p.room_id = pg_temp.room(v_held)),
        'a seat still held keeps its record');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM projects.session_attendance a WHERE a.session_event_id = v_held),
        'and its summary');
    PERFORM pg_temp.check((SELECT count(*) = 1 FROM scheduling.presence_events p WHERE p.room_id = pg_temp.room(v_closed)),
        'a dispute keeps its record, even once it has closed');
END $$;
-- #endregion

-- #region 9. The provider's record
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_event uuid := pg_temp.sitting('read', interval '2 hours', ARRAY[v_a]);
    v_start timestamptz := (SELECT start_time FROM projects.session_events WHERE id = v_event);
    t integer;
BEGIN
    PERFORM pg_temp.ev('read', 'joined', 0, 'w1', p_account => 'host-account');
    SELECT p.total_seconds INTO t FROM scheduling.fn_room_presence(pg_temp.room(v_event)) p WHERE p.is_host;
    PERFORM pg_temp.check(t = 0, 'a lost webhook leave counts for nothing');

    PERFORM scheduling.record_presence('zoom', 'room-read', 'joined', v_start, 'reconcile:h:j', 'host-account',
        NULL, NULL, 'host-account', 'reconcile');
    PERFORM scheduling.record_presence('zoom', 'room-read', 'left', v_start + interval '50 minutes', 'reconcile:h:l',
        'host-account', NULL, NULL, 'host-account', 'reconcile');
    SELECT p.total_seconds INTO t FROM scheduling.fn_room_presence(pg_temp.room(v_event)) p WHERE p.is_host;
    PERFORM pg_temp.check(t = 3000, 'the provider''s record gives the time back');
END $$;
-- #endregion

ROLLBACK;
