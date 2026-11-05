-- =============================================================================================
-- Probe: rooms follow what they belong to, and their queue is the minting service's alone
-- (audit S-03; Decision #343, ruling C4; Decision #383).
--
--   1  a sitting takes its listing's provider, else nothing, and queues a room; one that arrives
--      already named has nothing to mint
--   2  a confirmed call queues a room; a proposed one does not
--   3  claim takes each due room once, attach writes the room and its owner's column, and a second
--      attach is a no-op
--   4  a failed mint retries up to the limit, then stops and tells the host once
--   5  a moved or cancelled sitting or call marks its room, and the sync door settles it
--   6  a client can read no room and run no door, and cannot read a join link through the rooms
--   7  a host sets their own entry's room: a pick needs an account behind it, a link needs none, the
--      same pick is a no-op, a change keeps the address, and a move or cancel follows the entry
--   8  an ended meeting is due a read once, a failed read stamps nothing and waits, and a good one stops
--   9  a licensed room offers an attendee a personal link once, and never to the host
--  10  a host adds their own link to a sitting that has no room; nobody else can, and the attendee's
--      way in is the room's address, never the provider's link
--  11  connecting an account queues the rooms that were waiting for one, and only that host's
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/rooms.sql
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- A cohort on a seeded project with an owner; the blueprint is the caller's to set.
CREATE FUNCTION pg_temp.cohort(p_blueprint uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_project uuid := current_setting('probe.project')::uuid;
    v_stage uuid := current_setting('probe.stage')::uuid;
    v_cohort uuid;
BEGIN
    UPDATE projects.projects SET source_blueprint_id = p_blueprint WHERE id = v_project;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (v_project, v_stage, 'Probe rooms') RETURNING id INTO v_cohort;
    RETURN v_cohort;
END $$;

DO $$
DECLARE
    v_project uuid; v_stage uuid; v_host uuid; v_blueprint uuid; v_requester uuid; v_schedule uuid;
BEGIN
    SELECT p.id, s.id, p.owner_user_id INTO v_project, v_stage, v_host
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id IS NOT NULL ORDER BY p.id, s.id LIMIT 1;
    SELECT b.id INTO v_blueprint FROM marketplace.service_blueprints b ORDER BY b.id LIMIT 1;
    UPDATE marketplace.service_blueprints SET meeting_provider = 'zoom' WHERE id = v_blueprint;
    SELECT sc.id INTO v_schedule FROM scheduling.schedules sc
     WHERE scheduling.fn_schedule_host(sc.id) IS NOT NULL ORDER BY sc.id LIMIT 1;
    SELECT u.user_id INTO v_requester FROM org.users_public u
     WHERE u.user_id <> scheduling.fn_schedule_host(v_schedule) ORDER BY u.user_id LIMIT 1;
    PERFORM set_config('probe.project', v_project::text, true);
    PERFORM set_config('probe.stage', v_stage::text, true);
    PERFORM set_config('probe.host', v_host::text, true);
    PERFORM set_config('probe.blueprint', v_blueprint::text, true);
    PERFORM set_config('probe.schedule', v_schedule::text, true);
    PERFORM set_config('probe.requester', v_requester::text, true);
END $$;

-- #region 1. A sitting's room
DO $$
DECLARE
    v_cohort uuid := pg_temp.cohort(current_setting('probe.blueprint')::uuid);
    v_event uuid;
    r scheduling.rooms;
BEGIN
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_cohort, 'Probe sitting', now() + interval '3 days', now() + interval '3 days 1 hour')
    RETURNING id INTO v_event;
    SELECT * INTO r FROM scheduling.rooms WHERE session_event_id = v_event;
    PERFORM pg_temp.check((SELECT meeting_provider = 'zoom' FROM projects.session_events WHERE id = v_event),
        'a sitting takes its listing''s provider');
    PERFORM pg_temp.check(r.status = 'pending' AND r.provider = 'zoom' AND r.slug ~ '^rom-',
        'and queues a room with an opaque address');
    PERFORM set_config('probe.sitting', v_event::text, true);

    UPDATE marketplace.service_blueprints SET meeting_provider = NULL
     WHERE id = current_setting('probe.blueprint')::uuid;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_cohort, 'No provider', now() + interval '4 days', now() + interval '4 days 1 hour')
    RETURNING id INTO v_event;
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM scheduling.rooms WHERE session_event_id = v_event),
        'a sitting with no provider and no connection queues nothing');

    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, meeting_provider, provider_meeting_id)
    VALUES (v_cohort, 'Named', now() + interval '5 days', now() + interval '5 days 1 hour', 'zoom', 'probe-named')
    RETURNING id INTO v_event;
    PERFORM pg_temp.check((SELECT status = 'ready' AND provider_meeting_id = 'probe-named'
        FROM scheduling.rooms WHERE session_event_id = v_event), 'a room that arrives named has nothing to mint');
END $$;
-- #endregion

-- #region 2. A call's room
DO $$
DECLARE
    v_call uuid;
BEGIN
    INSERT INTO scheduling.discovery_calls (host_schedule_id, host_user_id, requester_user_id, call_type,
        status, proposed_start, proposed_end, provider_slug)
    VALUES (current_setting('probe.schedule')::uuid, scheduling.fn_schedule_host(current_setting('probe.schedule')::uuid),
        current_setting('probe.requester')::uuid, 'courtesy', 'proposed',
        now() + interval '3 days', now() + interval '3 days 30 minutes', 'zoom')
    RETURNING id INTO v_call;
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM scheduling.rooms WHERE call_id = v_call),
        'a call nobody has confirmed has no room');
    UPDATE scheduling.discovery_calls
       SET status = 'confirmed', confirmed_start = proposed_start, confirmed_end = proposed_end
     WHERE id = v_call;
    PERFORM pg_temp.check((SELECT status = 'pending' FROM scheduling.rooms WHERE call_id = v_call),
        'a confirmed call queues one');
    PERFORM set_config('probe.call', v_call::text, true);
END $$;
-- #endregion

-- #region 3. Claim and attach
DO $$
DECLARE
    v_sitting uuid := current_setting('probe.sitting')::uuid;
    v_room uuid;
    n integer;
BEGIN
    SELECT id INTO v_room FROM scheduling.rooms WHERE session_event_id = v_sitting;
    SELECT count(*) INTO n FROM scheduling.claim_rooms_to_mint(100) c WHERE c.room_id = v_room;
    PERFORM pg_temp.check(n = 1, 'a due room is claimed');
    SELECT count(*) INTO n FROM scheduling.claim_rooms_to_mint(100) c WHERE c.room_id = v_room;
    PERFORM pg_temp.check(n = 0, 'and only once');
    PERFORM pg_temp.check((SELECT status = 'minting' AND attempts = 1 FROM scheduling.rooms WHERE id = v_room),
        'a claim counts an attempt');

    PERFORM pg_temp.check(scheduling.attach_room(v_room, NULL, 'probe-meeting', 'probe-host',
        'https://zoom.us/j/probe', NULL), 'the answer attaches');
    PERFORM pg_temp.check((SELECT status = 'ready' AND provider_host_id = 'probe-host'
        FROM scheduling.rooms WHERE id = v_room), 'on the room, with the host''s provider account');
    PERFORM pg_temp.check((SELECT attendee_join_url = 'https://zoom.us/j/probe' AND provider_meeting_id = 'probe-meeting'
        FROM projects.session_events WHERE id = v_sitting), 'and on the column its sitting withholds');
    PERFORM pg_temp.check(NOT scheduling.attach_room(v_room, NULL, 'other', 'other', 'https://zoom.us/j/other', NULL),
        'a second attach is a no-op');
END $$;
-- #endregion

-- #region 4. A failed mint
DO $$
DECLARE
    v_call uuid := current_setting('probe.call')::uuid;
    v_room uuid;
    k integer;
BEGIN
    SELECT id INTO v_room FROM scheduling.rooms WHERE call_id = v_call;
    PERFORM scheduling.claim_rooms_to_mint(100);
    PERFORM scheduling.fail_room(v_room, 'Probe: provider said no');
    PERFORM pg_temp.check((SELECT status = 'pending' AND last_error LIKE 'Probe%' FROM scheduling.rooms WHERE id = v_room),
        'a failed mint goes back in the queue');
    FOR k IN 1 .. 4 LOOP
        PERFORM scheduling.claim_rooms_to_mint(100);
        PERFORM scheduling.fail_room(v_room, 'Probe: provider said no');
    END LOOP;
    PERFORM pg_temp.check((SELECT status = 'failed' AND attempts = 5 FROM scheduling.rooms WHERE id = v_room),
        'and stops at the limit');
    PERFORM pg_temp.check((SELECT count(*) = 1 FROM comms.notifications n
        WHERE n.type = 'room.failed' AND n.entity_id = v_room), 'telling the host once');

    UPDATE scheduling.rooms SET status = 'minting' WHERE id = v_room;
    PERFORM scheduling.fail_room(v_room, 'no_connection', true);
    PERFORM pg_temp.check((SELECT status = 'failed' FROM scheduling.rooms WHERE id = v_room),
        'a failure no retry can cure stops at once');
END $$;
-- #endregion

-- #region 5. Moved and cancelled
DO $$
DECLARE
    v_sitting uuid := current_setting('probe.sitting')::uuid;
    v_room uuid;
    n integer;
BEGIN
    SELECT id INTO v_room FROM scheduling.rooms WHERE session_event_id = v_sitting;
    UPDATE projects.session_events
       SET start_time = start_time + interval '1 hour', end_time = end_time + interval '1 hour'
     WHERE id = v_sitting;
    PERFORM pg_temp.check((SELECT moved_at IS NOT NULL FROM scheduling.rooms WHERE id = v_room),
        'a moved sitting marks its room');
    SELECT count(*) INTO n FROM scheduling.claim_rooms_to_sync(100) c WHERE c.room_id = v_room AND NOT c.closing;
    PERFORM pg_temp.check(n = 1, 'and the sync door offers it');
    PERFORM scheduling.room_synced(v_room);
    PERFORM pg_temp.check((SELECT moved_at IS NULL AND status = 'ready' FROM scheduling.rooms WHERE id = v_room),
        'a settled move clears the mark');

    UPDATE projects.session_events SET status = 'cancelled_by_freelancer' WHERE id = v_sitting;
    SELECT count(*) INTO n FROM scheduling.claim_rooms_to_sync(100) c WHERE c.room_id = v_room AND c.closing;
    PERFORM pg_temp.check(n = 1, 'a cancelled sitting closes its room at the provider');
    PERFORM scheduling.room_synced(v_room, 'Probe: already gone');
    PERFORM pg_temp.check((SELECT status = 'closed' FROM scheduling.rooms WHERE id = v_room),
        'and a closed room is done, even on a best-effort failure');
END $$;
-- #endregion

-- #region 6. Clients
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
        PERFORM 1 FROM scheduling.rooms LIMIT 1;
        RAISE EXCEPTION 'FAIL a client read scheduling.rooms';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a client cannot read a room';
    END;
    BEGIN
        PERFORM scheduling.claim_rooms_to_mint(1);
        RAISE EXCEPTION 'FAIL a client claimed a room';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a client cannot claim a room';
    END;
    BEGIN
        PERFORM attendee_join_url FROM projects.session_events LIMIT 1;
        RAISE EXCEPTION 'FAIL a client read a join link';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a client still cannot read a join link';
    END;
    BEGIN
        PERFORM projects.session_join_link(gen_random_uuid());
        RAISE EXCEPTION 'FAIL a client called the raw join door';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a client cannot go round /meet, which records the join';
    END;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
END $$;
-- #endregion

-- #region 7. A host's own entries
CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
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
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_entry uuid;
    v_other uuid;
    v_schedule uuid;
    v_slug text;
    v_conn uuid;
    v_other_host uuid;
    r scheduling.rooms;
BEGIN
    INSERT INTO scheduling.schedules (owner_type, owner_id) VALUES ('user', v_host)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_schedule FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_host;
    INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'confirmed', 'Probe entry', now() + interval '1 day', now() + interval '25 hours', v_host)
    RETURNING id INTO v_entry;

    PERFORM pg_temp.as_user(v_host);
    PERFORM scheduling.set_entry_room(ARRAY[v_entry], 'zoom');
    PERFORM pg_temp.as_user(NULL);
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM scheduling.rooms WHERE event_id = v_entry)
        AND (SELECT meeting_provider IS NULL AND NOT meeting_pending FROM scheduling.events WHERE id = v_entry),
        'a pick with no account behind it leaves no room, rather than a failure');

    INSERT INTO integrations.user_connections (user_id, provider_slug, status, granted_kinds)
    VALUES (v_host, 'zoom', 'active', ARRAY['conferencing']::integrations.provider_kind[])
    RETURNING id INTO v_conn;

    PERFORM pg_temp.as_user(v_host);
    PERFORM scheduling.set_entry_room(ARRAY[v_entry], 'zoom');
    PERFORM pg_temp.as_user(NULL);
    SELECT * INTO r FROM scheduling.rooms WHERE event_id = v_entry;
    v_slug := r.slug;
    PERFORM pg_temp.check(r.provider = 'zoom' AND r.status = 'pending'
        AND (SELECT meeting_pending FROM scheduling.events WHERE id = v_entry), 'a connected pick queues a room');

    UPDATE scheduling.rooms SET status = 'minting' WHERE id = r.id;
    PERFORM scheduling.attach_room(r.id, v_conn, 'probe-entry', 'host-account', 'https://zoom.us/j/probe-entry', 'pw');
    PERFORM pg_temp.as_user(v_host);
    PERFORM scheduling.set_entry_room(ARRAY[v_entry], 'zoom');
    PERFORM pg_temp.as_user(NULL);
    PERFORM pg_temp.check((SELECT status = 'ready' AND provider_meeting_id = 'probe-entry' FROM scheduling.rooms WHERE id = r.id)
        AND (SELECT meeting_url = 'https://zoom.us/j/probe-entry' FROM scheduling.events WHERE id = v_entry),
        'the same pick again changes nothing');

    UPDATE scheduling.events SET starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' WHERE id = v_entry;
    PERFORM pg_temp.check((SELECT moved_at IS NOT NULL FROM scheduling.rooms WHERE id = r.id), 'a moved entry marks its room');

    PERFORM pg_temp.as_user(v_host);
    PERFORM scheduling.set_entry_room(ARRAY[v_entry], 'custom', 'https://studio.example.test/room', 'code');
    PERFORM pg_temp.as_user(NULL);
    PERFORM pg_temp.check((SELECT provider = 'custom' AND status = 'ready' AND provider_meeting_id IS NULL AND slug = v_slug
            FROM scheduling.rooms WHERE id = r.id)
        AND (SELECT meeting_url = 'https://studio.example.test/room' AND meeting_passcode = 'code' AND NOT meeting_pending
            FROM scheduling.events WHERE id = v_entry),
        'a host''s own link needs no account, and the address survives the change');

    PERFORM pg_temp.as_user(v_host);
    PERFORM scheduling.set_entry_room(ARRAY[v_entry], NULL);
    PERFORM pg_temp.as_user(NULL);
    PERFORM pg_temp.check((SELECT status = 'closed' FROM scheduling.rooms WHERE id = r.id)
        AND (SELECT meeting_url IS NULL AND meeting_provider IS NULL FROM scheduling.events WHERE id = v_entry),
        'taking the room away closes it');

    PERFORM pg_temp.as_user(v_host);
    PERFORM scheduling.set_entry_room(ARRAY[v_entry], 'zoom');
    PERFORM pg_temp.as_user(NULL);
    UPDATE scheduling.events SET status = 'cancelled' WHERE id = v_entry;
    PERFORM pg_temp.check((SELECT status = 'closed' FROM scheduling.rooms WHERE id = r.id),
        'a cancelled entry closes its queued room');

    SELECT u.user_id INTO v_other_host FROM org.users_public u WHERE u.user_id <> v_host ORDER BY u.user_id LIMIT 1;
    INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'confirmed', 'Probe entry 2', now() + interval '2 days', now() + interval '49 hours', v_host)
    RETURNING id INTO v_other;
    PERFORM pg_temp.as_user(v_other_host);
    PERFORM scheduling.set_entry_room(ARRAY[v_other], 'custom', 'https://evil.example.test/room');
    PERFORM pg_temp.as_user(NULL);
    PERFORM pg_temp.check((SELECT meeting_url IS NULL FROM scheduling.events WHERE id = v_other),
        'nobody sets a room on somebody else''s entry');
END $$;
-- #endregion

-- #region 8. Reading the provider's record
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_entry uuid;
    v_schedule uuid;
    v_room uuid;
    n integer;
BEGIN
    SELECT id INTO v_schedule FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_host;
    INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'confirmed', 'Probe ended', now() - interval '3 hours', now() - interval '2 hours', v_host)
    RETURNING id INTO v_entry;
    INSERT INTO scheduling.rooms (event_id, provider, connection_id, provider_meeting_id, status, updated_at)
    VALUES (v_entry, 'zoom', (SELECT id FROM integrations.user_connections WHERE user_id = v_host LIMIT 1),
            'probe-ended', 'ready', now())
    RETURNING id INTO v_room;
    UPDATE scheduling.rooms SET updated_at = now() - interval '2 hours' WHERE id = v_room;
    ALTER TABLE scheduling.rooms DISABLE TRIGGER trg_rooms_touch;
    UPDATE scheduling.rooms SET updated_at = now() - interval '2 hours' WHERE id = v_room;

    SELECT count(*) INTO n FROM scheduling.claim_rooms_to_reconcile(500) c WHERE c.room_id = v_room;
    PERFORM pg_temp.check(n = 1, 'an ended room is due a read');

    ALTER TABLE scheduling.rooms ENABLE TRIGGER trg_rooms_touch;
    PERFORM scheduling.room_reconciled(v_room, 'refused');
    PERFORM pg_temp.check((SELECT reconciled_at IS NULL AND last_error = 'refused' FROM scheduling.rooms WHERE id = v_room),
        'a failed read stamps nothing');
    SELECT count(*) INTO n FROM scheduling.claim_rooms_to_reconcile(500) c WHERE c.room_id = v_room;
    PERFORM pg_temp.check(n = 0, 'and waits an hour');

    PERFORM scheduling.room_reconciled(v_room);
    PERFORM pg_temp.check((SELECT reconciled_at IS NOT NULL AND last_error IS NULL FROM scheduling.rooms WHERE id = v_room),
        'a good read is stamped');
    ALTER TABLE scheduling.rooms DISABLE TRIGGER trg_rooms_touch;
    UPDATE scheduling.rooms SET updated_at = now() - interval '2 hours' WHERE id = v_room;
    ALTER TABLE scheduling.rooms ENABLE TRIGGER trg_rooms_touch;
    SELECT count(*) INTO n FROM scheduling.claim_rooms_to_reconcile(500) c WHERE c.room_id = v_room;
    PERFORM pg_temp.check(n = 0, 'and never read again');
END $$;
-- #endregion

-- #region 9. Personal links
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_guest uuid;
    v_entry uuid;
    v_schedule uuid;
    v_room scheduling.rooms;
    j jsonb;
BEGIN
    SELECT u.user_id INTO v_guest FROM org.users_public u WHERE u.user_id <> v_host ORDER BY u.user_id LIMIT 1;
    SELECT id INTO v_schedule FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_host;
    INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at, created_by, meeting_url)
    VALUES (v_schedule, 'sync', 'confirmed', 'Probe live', now() - interval '5 minutes', now() + interval '1 hour', v_host,
            'https://zoom.us/j/probe-live')
    RETURNING id INTO v_entry;
    INSERT INTO scheduling.event_attendees (event_id, user_id, role, response, responded_at)
    VALUES (v_entry, v_guest, 'participant', 'accepted', now());
    INSERT INTO scheduling.rooms (event_id, provider, provider_meeting_id, provider_host_id, status, registration)
    VALUES (v_entry, 'zoom', 'probe-live', 'host-account', 'ready', true)
    RETURNING * INTO v_room;

    PERFORM pg_temp.as_user(v_host);
    j := scheduling.room_join(v_room.slug);
    PERFORM pg_temp.as_user(NULL);
    PERFORM pg_temp.check(j ->> 'state' = 'open' AND j -> 'register' = 'null'::jsonb OR j ->> 'register' IS NULL,
        'a host is not registered');

    PERFORM pg_temp.as_user(v_guest);
    j := scheduling.room_join(v_room.slug);
    PERFORM pg_temp.as_user(NULL);
    PERFORM pg_temp.check((j -> 'register' ->> 'user_id')::uuid = v_guest AND j -> 'register' ->> 'email' IS NOT NULL
        AND j ->> 'provider_meeting_id' = 'probe-live',
        'an attendee''s first join asks for a personal link, for the signed-in person');

    PERFORM scheduling.save_room_registrant(v_room.id, v_guest, 'reg-probe', 'https://zoom.us/w/personal');
    PERFORM pg_temp.as_user(v_guest);
    j := scheduling.room_join(v_room.slug);
    PERFORM pg_temp.as_user(NULL);
    PERFORM pg_temp.check(j ->> 'url' = 'https://zoom.us/w/personal' AND j ->> 'register' IS NULL
        AND j ->> 'provider_meeting_id' IS NULL,
        'after that they hold it, and the room''s ids stay on the server');
END $$;
-- #endregion

-- #region 10. A host's own link on a sitting
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_project uuid := current_setting('probe.project')::uuid;
    v_guest uuid;
    v_cohort uuid := pg_temp.cohort(NULL);
    v_event uuid;
    v_mirror uuid;
    v_schedule uuid;
    w jsonb;
BEGIN
    SELECT u.user_id INTO v_guest FROM org.users_public u WHERE u.user_id <> v_host ORDER BY u.user_id LIMIT 1;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_cohort, 'Probe paid', now() - interval '5 minutes', now() + interval '1 hour')
    RETURNING id INTO v_event;
    SELECT id INTO v_schedule FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_host;
    INSERT INTO scheduling.events (schedule_id, project_id, kind, status, title, starts_at, ends_at, source_session_event_id, created_by)
    VALUES (v_schedule, v_project, 'session', 'confirmed', 'Probe paid', now() - interval '5 minutes', now() + interval '1 hour', v_event, v_host)
    RETURNING id INTO v_mirror;

    PERFORM pg_temp.as_user(v_guest);
    BEGIN
        PERFORM projects.set_sitting_link(v_event, 'https://evil.example.test/room');
        RAISE EXCEPTION 'FAIL somebody else set a sitting''s link';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS only the host can add a link';
    END;
    PERFORM pg_temp.as_user(v_host);
    PERFORM projects.set_sitting_link(v_event, 'https://studio.example.test/room');
    PERFORM pg_temp.check((SELECT slug FROM scheduling.get_event_rooms(ARRAY[v_mirror]) x(id, u, p, d, slug)) IS NOT NULL,
        'the calendar reaches a sitting''s own link through the room''s address');
    PERFORM pg_temp.as_user(NULL);
    PERFORM pg_temp.check((SELECT provider = 'custom' AND status = 'ready' FROM scheduling.rooms WHERE session_event_id = v_event),
        'the sitting has a room');
    PERFORM pg_temp.check((SELECT meeting_provider = 'custom' FROM scheduling.events WHERE id = v_mirror),
        'its calendar entry says so');
    PERFORM pg_temp.check((projects.fn_session_presence(v_event) ->> 'tracked')::boolean IS NOT TRUE,
        'and nothing reports from it, so its payout will hold');

    -- The other regions' sittings hang off this project too, and the workspace reads the next one.
    UPDATE projects.session_events se SET end_time = now() - interval '1 minute', start_time = now() - interval '2 minutes'
      FROM projects.cohorts c
     WHERE c.id = se.cohort_id AND c.project_id = v_project AND se.id <> v_event;
    UPDATE projects.projects SET format = 'session', session_kind = 'normal' WHERE id = v_project;
    PERFORM pg_temp.as_user(v_host);
    w := projects.get_session_workspace(v_project);
    PERFORM pg_temp.as_user(NULL);
    PERFORM pg_temp.check(w -> 'join' ->> 'room_slug' IS NOT NULL AND w -> 'join' ->> 'url' IS NULL,
        'the workspace gives the room''s address, never the provider''s link');
    PERFORM pg_temp.check(w ->> 'room_wanted_sitting_id' IS NULL, 'and no longer asks for a room');
END $$;
-- #endregion

-- #region 11. Connecting queues what was waiting
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_cohort uuid := pg_temp.cohort(NULL);
    v_waiting uuid;
    v_past uuid;
    v_failed uuid;
    v_failed_room uuid;
    v_other_room uuid;
    n integer;
BEGIN
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_cohort, 'Probe waiting', now() + interval '1 day', now() + interval '25 hours')
    RETURNING id INTO v_waiting;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_cohort, 'Probe past', now() - interval '2 days', now() - interval '47 hours')
    RETURNING id INTO v_past;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, meeting_provider)
    VALUES (v_cohort, 'Probe failed', now() + interval '2 days', now() + interval '49 hours', 'zoom')
    RETURNING id INTO v_failed;
    UPDATE scheduling.rooms SET status = 'failed', attempts = 5, last_error = 'no_connection'
     WHERE session_event_id = v_failed RETURNING id INTO v_failed_room;
    DELETE FROM scheduling.rooms WHERE session_event_id IN (v_waiting, v_past);

    n := scheduling.fn_queue_waiting_rooms(gen_random_uuid(), 'zoom');
    PERFORM pg_temp.check((SELECT status = 'failed' FROM scheduling.rooms WHERE id = v_failed_room)
        AND NOT EXISTS (SELECT 1 FROM scheduling.rooms WHERE session_event_id = v_waiting),
        'somebody else connecting queues nothing of this host''s');

    n := scheduling.fn_queue_waiting_rooms(v_host, 'outlook');
    PERFORM pg_temp.check((SELECT provider = 'microsoft_teams' AND status = 'pending' FROM scheduling.rooms WHERE session_event_id = v_waiting),
        'a Microsoft connection gives a waiting sitting a Teams room');
    PERFORM pg_temp.check((SELECT meeting_provider = 'microsoft_teams' FROM projects.session_events WHERE id = v_waiting),
        'and the sitting says so');
    PERFORM pg_temp.check((SELECT status = 'failed' FROM scheduling.rooms WHERE id = v_failed_room),
        'a room that failed on another provider stays as it is');
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM scheduling.rooms WHERE session_event_id = v_past),
        'a sitting that is over gets no room');

    n := scheduling.fn_queue_waiting_rooms(v_host, 'zoom');
    PERFORM pg_temp.check((SELECT status = 'pending' AND attempts = 0 AND last_error IS NULL FROM scheduling.rooms WHERE id = v_failed_room),
        'a mint that gave up is tried again on the provider it wanted');
    PERFORM pg_temp.check(NOT has_function_privilege('authenticated', 'scheduling.fn_queue_waiting_rooms(uuid,text)', 'EXECUTE'),
        'no client can queue rooms');
END $$;
-- #endregion

ROLLBACK;
