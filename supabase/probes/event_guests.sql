-- Probe: guests, the seats held by an address rather than an account (Decision #391).
--
-- The door runs as `authenticated` and the guest doors as `service_role`, because as the owner neither
-- would prove anything: service_role has no USAGE on `comms`, and the column grant only binds a client.
--
--   1  door         only the host may seat an address; it is stored lower case, and mail is queued with it
--   2  repeat       asking again changes nothing; one seat per address on an entry, whatever the case
--   3  refused      a seat with no account needs a real address
--   4  projective   a paid sitting, a booking, an engagement's meeting and a series take no address
--   5  address      the address reaches a host alone, through one door; no client reads the guest tables
--   6  mail         the raw link is handed to the mailer once and only its hash is kept; hosts can't reach it
--   7  answer       the link alone answers, signed out; the log never names the address; pending is no answer
--   8  safe text    a link in a title never reaches a stranger's inbox or page
--   9  voters       a guest holds no vote: with only guests a host moves the entry, and the guest is asked again
--  10  electorate   with an account seated, a move still takes a round
--  11  cancel       a status change still needs a withdrawal, so a guest is always told
--  12  withdraw     the link dies, whether or not a message had gone out; asked again, a guest gets a new link
--  13  code         no code, no room; a wrong code counts; the room needs an answer and its window
--  14  join         a good code gets the room, and the trail names the seat and the device, never an address
--  15  claim        only a verified holder of the address claims; the address goes; the link dies
--  16  opt out      the address is refused from then on, and nothing queued goes out
--  17  limits       the seat cap counts every guest, and a host has a daily limit
--  18  retention    an address is blanked 30 days after the entry ends
--  19  presence     a guest's own provider link is matched to their seat, and no account is credited for them
--  20  creator      nobody can write who made an entry, so nobody can send in somebody else's name
--  21  no address   a NULL in the list of addresses is refused, not seated with nothing
--  22  allowances   deleting what was sent gives nothing back, and an address has a limit of its own
--  23  held         past that limit a new time waits, adds nothing more, and says the latest time when it goes
--  24  in flight    a move or a withdrawal during a send is not lost
--  25  archived     archiving is ending an entry too, so it also needs a withdrawal
--  26  dead links   any link ever mailed can stop further email, and a withdrawal's link does nothing else
--  27  claim races  a second press finds nothing to claim, and nobody joins an open round
--  28  own link     a claim brings the guest's provider link with it
--
-- Run: docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/event_guests.sql
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

-- The door's SQLSTATE as `authenticated`, or NULL when it answered.
CREATE FUNCTION pg_temp.refused(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    RESET ROLE;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END;
$$;

-- One queued message claimed as the service role, so a probe can act as the guest who received it.
CREATE FUNCTION pg_temp.mailed(p_kind text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_token text;
BEGIN
    UPDATE scheduling.guest_mail SET claimed_at = pg_catalog.now()
     WHERE kind <> p_kind AND sent_at IS NULL AND failed_at IS NULL;
    SET LOCAL ROLE service_role;
    SELECT m.token INTO v_token FROM scheduling.claim_guest_mail(50) m WHERE m.kind = p_kind LIMIT 1;
    RESET ROLE;
    UPDATE scheduling.guest_mail SET sent_at = pg_catalog.now()
     WHERE sent_at IS NULL AND failed_at IS NULL AND claimed_at IS NOT NULL;
    RETURN v_token;
END;
$$;

DO $probe$
DECLARE
    v_host uuid;
    v_other uuid;
    v_third uuid;
    v_minor uuid;
    v_schedule uuid;
    v_event uuid;
    v_entry uuid;
    v_seat uuid;
    v_project uuid;
    v_room uuid;
    v_now timestamptz := pg_catalog.now();
    v_from timestamptz := v_now + interval '30 days';
    v_to timestamptz := v_now + interval '30 days 1 hour';
    v_n integer;
    v_token text;
    v_old_token text;
    v_code text;
    v_answer jsonb;
    v_text text;
    v_addresses text[];
    v_seat2 uuid;
    v_round uuid;
BEGIN
    SELECT (array_agg(p.user_id))[1], (array_agg(p.user_id))[2], (array_agg(p.user_id))[3]
      INTO v_host, v_other, v_third
      FROM (SELECT user_id FROM org.users_public WHERE NOT org.fn_is_minor(user_id) ORDER BY user_id LIMIT 3) p;
    PERFORM pg_temp.ok(v_third IS NOT NULL, 'the seed has three adults');

    SELECT id INTO v_schedule FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_host;
    IF v_schedule IS NULL THEN
        INSERT INTO scheduling.schedules (owner_type, owner_id) VALUES ('user', v_host)
        RETURNING id INTO v_schedule;
    END IF;

    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe guest review', v_from, v_to, v_host)
    RETURNING id INTO v_event;

    -- 1 door
    PERFORM pg_temp.as_user(v_other);
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''a@example.com''])', v_event)) = '42501',
        'somebody else''s entry takes no address from them'
    );
    PERFORM pg_temp.as_user(v_host);
    SET LOCAL ROLE authenticated;
    v_n := scheduling.invite_to_event(v_event, '{}', ARRAY['  Guest@Example.COM ']);
    RESET ROLE;
    PERFORM pg_temp.ok(v_n = 1, format('one guest was asked, not %s', v_n));
    SELECT id INTO v_seat FROM scheduling.event_attendees WHERE event_id = v_event AND email IS NOT NULL;
    PERFORM pg_temp.ok(
        (SELECT email || '/' || response::text || '/' || (user_id IS NULL)::text
           FROM scheduling.event_attendees WHERE id = v_seat) = 'guest@example.com/pending/true',
        'stored lower case, unanswered, with no account'
    );
    PERFORM pg_temp.ok(
        (SELECT role::text FROM scheduling.event_attendees WHERE event_id = v_event AND user_id = v_host) = 'host',
        'the host took a seat'
    );
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.guest_mail WHERE attendee_id = v_seat AND kind = 'invite') = 1,
        'the mail is queued with the seat'
    );

    -- 2 repeat
    SET LOCAL ROLE authenticated;
    v_n := scheduling.invite_to_event(v_event, '{}', ARRAY['GUEST@example.com']);
    RESET ROLE;
    PERFORM pg_temp.ok(v_n = 0, 'somebody already seated is not asked again');
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.guest_mail WHERE attendee_id = v_seat) = 1,
        'and no second message is queued'
    );

    -- 3 refused
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''not an address''])', v_event)) = '55000',
        'a thing that is not an address is refused'
    );
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''''])', v_event)) = '55000',
        'and so is nothing at all, so a seat with no account always has an address'
    );

    -- 4 projective-only
    FOREACH v_text IN ARRAY ARRAY['session', 'booking'] LOOP
        INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
        VALUES (v_schedule, v_text::scheduling.event_kind, 'Probe paid', v_from, v_to, v_host)
        RETURNING id INTO v_entry;
        PERFORM pg_temp.ok(
            pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''a@example.com''])', v_entry)) = '55000',
            format('a %s takes no address', v_text)
        );
    END LOOP;
    SELECT id INTO v_project FROM projects.projects LIMIT 1;
    IF v_project IS NOT NULL THEN
        INSERT INTO scheduling.events (schedule_id, project_id, kind, title, starts_at, ends_at, created_by)
        VALUES (v_schedule, v_project, 'sync', 'Probe engagement', v_from, v_to, v_host)
        RETURNING id INTO v_entry;
        PERFORM pg_temp.ok(
            pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''a@example.com''])', v_entry)) = '55000',
            'an engagement''s meeting takes no address'
        );
    END IF;
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by, recurrence_rule)
    VALUES (v_schedule, 'sync', 'Probe series', v_from, v_to, v_host, 'FREQ=DAILY;COUNT=2')
    RETURNING id INTO v_entry;
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''a@example.com''])', v_entry)) = '55000',
        'a series takes no address'
    );

    -- 5 address
    PERFORM pg_temp.ok(
        NOT has_column_privilege('authenticated', 'scheduling.event_attendees', 'email', 'SELECT'),
        'the column stays withheld from client roles'
    );
    PERFORM pg_temp.as_user(v_host);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM scheduling.get_guest_addresses(ARRAY[v_event]) g WHERE g.email = 'guest@example.com';
    RESET ROLE;
    PERFORM pg_temp.ok(v_n = 1, 'the host reads their guest''s address');
    PERFORM pg_temp.as_user(v_other);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM scheduling.get_guest_addresses(ARRAY[v_event]);
    RESET ROLE;
    PERFORM pg_temp.ok(v_n = 0, 'and nobody else does');
    FOREACH v_text IN ARRAY ARRAY['guest_links', 'guest_mail', 'guest_mail_opt_outs'] LOOP
        PERFORM pg_temp.ok(
            NOT has_table_privilege('authenticated', format('scheduling.%I', v_text), 'SELECT')
            AND NOT has_table_privilege('anon', format('scheduling.%I', v_text), 'SELECT'),
            format('no client reads scheduling.%s', v_text)
        );
    END LOOP;

    -- 6 mail
    FOREACH v_text IN ARRAY ARRAY[
        'claim_guest_mail(integer)', 'finish_guest_mail(uuid,boolean)', 'guest_invitation(text)',
        'guest_answer(text,scheduling.rsvp_response)', 'guest_request_code(text)',
        'guest_room_join(text,text,text)', 'guest_opt_out(text)'
    ] LOOP
        PERFORM pg_temp.ok(
            NOT has_function_privilege('authenticated', 'scheduling.' || v_text, 'EXECUTE')
            AND NOT has_function_privilege('anon', 'scheduling.' || v_text, 'EXECUTE'),
            format('a host cannot act as their guest through %s', v_text)
        );
    END LOOP;
    v_token := pg_temp.mailed('invite');
    PERFORM pg_temp.ok(v_token ~ '^[0-9a-f]{64}$', format('the mailer is handed a raw link, not %s', v_token));
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM scheduling.guest_links l WHERE l.attendee_id = v_seat AND l.token_hash = v_token),
        'and only its hash is kept'
    );
    SET LOCAL ROLE service_role;
    v_answer := scheduling.guest_invitation(v_token);
    RESET ROLE;
    PERFORM pg_temp.ok(v_answer ->> 'state' = 'live', format('the link is live: %s', v_answer));
    PERFORM pg_temp.ok(
        v_answer ->> 'address_hint' = 'g•••@example.com' AND v_answer ->> 'title' = 'Probe guest review',
        format('it shows the entry and a hint of the address: %s', v_answer)
    );
    PERFORM pg_temp.ok(v_answer ? 'location' AND v_answer ->> 'location' IS NULL, 'and no place until they answer');
    SET LOCAL ROLE service_role;
    v_answer := scheduling.guest_invitation(repeat('0', 64));
    RESET ROLE;
    PERFORM pg_temp.ok(v_answer = '{"state": "dead"}'::jsonb, 'a made-up link learns nothing');

    -- 7 answer
    SET LOCAL ROLE service_role;
    PERFORM pg_temp.ok(scheduling.guest_answer(v_token, 'accepted'), 'the link alone answers');
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT response::text FROM scheduling.event_attendees WHERE id = v_seat) = 'accepted',
        'the roster has the answer'
    );
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.event_history
          WHERE event_id = v_event AND kind = 'rsvp' AND summary = 'A guest marked Going') = 1,
        'the log has a line'
    );
    PERFORM pg_temp.ok(
        NOT EXISTS (
            SELECT 1 FROM scheduling.event_history
             WHERE event_id = v_event AND (summary ILIKE '%example.com%' OR detail ILIKE '%example.com%')
        ),
        'and it never names the address'
    );
    SET LOCAL ROLE service_role;
    PERFORM scheduling.guest_answer(v_token, 'accepted');
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.event_history WHERE event_id = v_event AND kind = 'rsvp') = 1,
        'restating an answer writes nothing'
    );
    BEGIN
        SET LOCAL ROLE service_role;
        PERFORM scheduling.guest_answer(v_token, 'pending');
        RAISE EXCEPTION 'PROBE FAIL: pending was taken as an answer';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        NULL;
    END;
    RESET ROLE;

    -- 8 safe text
    PERFORM pg_temp.ok(
        scheduling.fn_guest_safe_text('Sign in at https://evil.example/login now') = 'Sign in at [link hidden] now',
        'an address with a scheme is hidden'
    );
    PERFORM pg_temp.ok(
        scheduling.fn_guest_safe_text('Go to evil-site.com/win today') = 'Go to [link hidden] today',
        format('so is a bare one: %s', scheduling.fn_guest_safe_text('Go to evil-site.com/win today'))
    );
    PERFORM pg_temp.ok(
        scheduling.fn_guest_safe_text('Call me on +44 7700 900123') = 'Call me on [phone hidden]',
        'contact details go the way they go everywhere'
    );
    PERFORM pg_temp.ok(
        scheduling.fn_guest_safe_text('Quarterly review, 2pm') = 'Quarterly review, 2pm',
        'an ordinary title passes untouched'
    );

    -- 9 voters
    PERFORM pg_temp.ok(NOT scheduling.fn_event_has_voters(v_event), 'a guest holds no vote');
    PERFORM pg_temp.as_user(v_host);
    SET LOCAL ROLE authenticated;
    UPDATE scheduling.events SET starts_at = v_from + interval '1 hour', ends_at = v_to + interval '1 hour'
     WHERE id = v_event;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    PERFORM pg_temp.ok(v_n = 1, 'so a host with only guests moves the entry');
    PERFORM pg_temp.ok(
        (SELECT response::text || '/' || (responded_at IS NULL)::text
           FROM scheduling.event_attendees WHERE id = v_seat) = 'pending/true',
        'and the guest is asked again, because they said yes to another time'
    );
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.guest_mail
          WHERE attendee_id = v_seat AND kind = 'moved' AND sent_at IS NULL) = 1,
        'by email'
    );
    v_old_token := v_token;
    v_token := pg_temp.mailed('moved');
    PERFORM pg_temp.ok(v_token <> v_old_token, 'a new message carries its own link');
    SET LOCAL ROLE service_role;
    PERFORM pg_temp.ok(
        scheduling.guest_invitation(v_old_token) ->> 'state' = 'live',
        'and the one they already hold still works'
    );
    RESET ROLE;

    -- 10 electorate
    PERFORM pg_temp.as_user(v_host);
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_event, ARRAY[v_other], '{}');
    RESET ROLE;
    PERFORM pg_temp.ok(scheduling.fn_event_has_voters(v_event), 'an account on the entry holds a vote');
    BEGIN
        SET LOCAL ROLE authenticated;
        UPDATE scheduling.events SET starts_at = v_from WHERE id = v_event;
        RAISE EXCEPTION 'PROBE FAIL: an entry with a voter moved outside a round';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        NULL;
    END;
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.withdraw_invitation(
        v_event, (SELECT id FROM scheduling.event_attendees WHERE event_id = v_event AND user_id = v_other)
    );
    RESET ROLE;

    -- 11 cancel
    BEGIN
        SET LOCAL ROLE authenticated;
        UPDATE scheduling.events SET status = 'cancelled' WHERE id = v_event;
        RAISE EXCEPTION 'PROBE FAIL: an entry went with its guest never told';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        NULL;
    END;
    RESET ROLE;

    -- 12 withdraw
    SET LOCAL ROLE authenticated;
    v_n := scheduling.withdraw_invitation(v_event, v_seat);
    RESET ROLE;
    PERFORM pg_temp.ok(v_n = 1, 'one guest withdrawn');
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.guest_mail
          WHERE attendee_id = v_seat AND kind = 'withdrawn' AND sent_at IS NULL) = 1,
        'they are told, because they had heard'
    );
    SET LOCAL ROLE service_role;
    PERFORM pg_temp.ok(scheduling.guest_invitation(v_token) ->> 'state' = 'dead', 'and the link is dead');
    PERFORM pg_temp.ok(NOT scheduling.guest_answer(v_token, 'accepted'), 'so it answers nothing');
    RESET ROLE;
    UPDATE scheduling.guest_mail SET sent_at = v_now WHERE attendee_id = v_seat;
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_event, '{}', ARRAY['guest@example.com']);
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT id FROM scheduling.event_attendees WHERE event_id = v_event AND email = 'guest@example.com') = v_seat,
        'asked again, the same seat comes back'
    );
    v_token := pg_temp.mailed('invite');
    SET LOCAL ROLE service_role;
    PERFORM pg_temp.ok(scheduling.guest_invitation(v_token) ->> 'state' = 'live', 'on a new link');
    PERFORM pg_temp.ok(scheduling.guest_invitation(v_old_token) ->> 'state' = 'dead', 'and an old one stays dead');
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_event, '{}', ARRAY['never-heard@example.com']);
    PERFORM scheduling.withdraw_invitation(
        v_event, (SELECT g.attendee_id FROM scheduling.get_guest_addresses(ARRAY[v_event]) g
                   WHERE g.email = 'never-heard@example.com')
    );
    RESET ROLE;
    PERFORM pg_temp.ok(
        NOT EXISTS (
            SELECT 1 FROM scheduling.guest_mail m
              JOIN scheduling.event_attendees a ON a.id = m.attendee_id
             WHERE a.email = 'never-heard@example.com'
        ),
        'somebody withdrawn before anything left hears nothing at all'
    );

    -- 13 code
    INSERT INTO scheduling.events (
        schedule_id, kind, title, starts_at, ends_at, created_by, meeting_provider, meeting_url
    )
    VALUES (
        v_schedule, 'sync', 'Probe room', v_now + interval '5 minutes', v_now + interval '1 hour', v_host,
        'custom', 'https://rooms.example/probe'
    )
    RETURNING id INTO v_entry;
    INSERT INTO scheduling.rooms (event_id, provider, status) VALUES (v_entry, 'custom', 'ready')
    RETURNING id INTO v_room;
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_entry, '{}', ARRAY['roomguest@example.com']);
    RESET ROLE;
    v_token := pg_temp.mailed('invite');
    SET LOCAL ROLE service_role;
    PERFORM pg_temp.ok(
        scheduling.guest_invitation(v_token) ->> 'room_state' = 'needs_rsvp',
        'the room waits for an answer'
    );
    PERFORM pg_temp.ok(scheduling.guest_request_code(v_token) ->> 'state' = 'closed', 'so no code goes out yet');
    PERFORM pg_temp.ok(
        scheduling.guest_room_join(v_token, '000000', repeat('a', 40)) ->> 'state' = 'no_code',
        'and nothing joins with no code'
    );
    PERFORM scheduling.guest_answer(v_token, 'accepted');
    v_answer := scheduling.guest_invitation(v_token);
    PERFORM pg_temp.ok(v_answer ->> 'room_state' = 'open', format('an answer opens it: %s', v_answer));
    v_answer := scheduling.guest_request_code(v_token);
    PERFORM pg_temp.ok(v_answer ->> 'state' = 'sent', format('a code is minted: %s', v_answer));
    v_code := v_answer ->> 'code';
    PERFORM pg_temp.ok(v_code ~ '^[0-9]{6}$', 'six digits');
    PERFORM pg_temp.ok(v_answer ->> 'email' = 'roomguest@example.com', 'for the invited address, and only that');
    PERFORM pg_temp.ok(scheduling.guest_request_code(v_token) ->> 'state' = 'wait', 'a second straight away waits');
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT code_hash <> v_code FROM scheduling.guest_links l
           JOIN scheduling.event_attendees a ON a.id = l.attendee_id
          WHERE a.event_id = v_entry),
        'only a hash of the code is kept'
    );
    SET LOCAL ROLE service_role;
    PERFORM pg_temp.ok(
        scheduling.guest_room_join(v_token, '000000', repeat('a', 40)) ->> 'state' =
            CASE WHEN v_code = '000000' THEN 'open' ELSE 'wrong_code' END,
        'a wrong code gets nobody in'
    );
    RESET ROLE;
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM scheduling.presence_events WHERE room_id = v_room)
        OR v_code = '000000',
        'and leaves no trace of a join'
    );

    -- 14 join
    SET LOCAL ROLE service_role;
    v_answer := scheduling.guest_room_join(v_token, v_code, repeat('b', 40));
    PERFORM pg_temp.ok(
        v_answer ->> 'state' = 'open' AND v_answer ->> 'url' = 'https://rooms.example/probe',
        format('the right code gets the room: %s', v_answer)
    );
    PERFORM pg_temp.ok(
        scheduling.guest_room_join(v_token, v_code, repeat('b', 40)) ->> 'state' = 'open',
        'and works again for somebody who dropped out'
    );
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.presence_events p
           JOIN scheduling.event_attendees a ON a.id = p.attendee_id
          WHERE p.room_id = v_room AND p.matched_by = 'guest_link' AND p.action = 'join_click'
            AND p.participant_key = repeat('b', 40) AND a.email = 'roomguest@example.com') = 1,
        'the press is recorded against the seat and the device, once a minute'
    );
    PERFORM pg_temp.ok(
        NOT EXISTS (
            SELECT 1 FROM scheduling.presence_events
             WHERE room_id = v_room AND (idempotency_key ILIKE '%example%' OR participant_key ILIKE '%example%')
        ),
        'with no address in it'
    );
    SET LOCAL ROLE service_role;
    PERFORM scheduling.guest_answer(v_token, 'rejected');
    PERFORM pg_temp.ok(
        scheduling.guest_room_join(v_token, v_code, repeat('b', 40)) ->> 'state' = 'not_party',
        'somebody who declined does not get in, whatever code they hold'
    );
    RESET ROLE;

    -- 15 claim
    PERFORM pg_temp.as_user(v_third);
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.claim_guest_seat(%L)', v_token)) = '55000',
        'somebody who does not hold the address cannot claim the seat'
    );
    INSERT INTO org.user_emails (user_id, email, is_primary, verified_at)
    VALUES (v_third, 'roomguest@example.com', false, NULL);
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.claim_guest_seat(%L)', v_token)) = '55000',
        'nor can somebody who only filed it, unverified'
    );
    UPDATE org.user_emails SET verified_at = v_now WHERE user_id = v_third AND email = 'roomguest@example.com';
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.ok(scheduling.guest_seat_is_mine(v_token), 'a verified holder is told it is theirs');
    PERFORM pg_temp.ok(scheduling.claim_guest_seat(v_token) = v_entry, 'and claims it');
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT email IS NULL FROM scheduling.event_attendees WHERE event_id = v_entry AND user_id = v_third),
        'the seat is theirs and the address is gone'
    );
    SET LOCAL ROLE service_role;
    PERFORM pg_temp.ok(scheduling.guest_invitation(v_token) ->> 'state' = 'dead', 'and the link has done its job');
    RESET ROLE;
    PERFORM pg_temp.as_user(v_third);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM scheduling.events WHERE id = v_entry;
    RESET ROLE;
    PERFORM pg_temp.ok(v_n = 1, 'the entry is on their calendar');

    -- 16 opt out
    PERFORM pg_temp.as_user(v_host);
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_entry, '{}', ARRAY['stopit@example.com']);
    RESET ROLE;
    v_token := pg_temp.mailed('invite');
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_event, '{}', ARRAY['stopit@example.com']);
    RESET ROLE;
    SET LOCAL ROLE service_role;
    PERFORM scheduling.guest_opt_out(v_token);
    RESET ROLE;
    PERFORM pg_temp.ok(
        NOT EXISTS (
            SELECT 1 FROM scheduling.guest_mail m
              JOIN scheduling.event_attendees a ON a.id = m.attendee_id
             WHERE a.email = 'stopit@example.com' AND m.sent_at IS NULL
        ),
        'what had not gone out is dropped'
    );
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM scheduling.guest_mail_opt_outs WHERE email_hash LIKE '%stopit%'),
        'and the opt-out keeps no address'
    );
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''STOPIT@example.com''])', v_event)) = '55000',
        'whoever asks next, in whatever case'
    );

    -- 17 limits
    DELETE FROM scheduling.guest_mail_quota;
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe full', v_from, v_to, v_host)
    RETURNING id INTO v_entry;
    SELECT array_agg(format('full%s@example.com', g)) INTO v_addresses FROM generate_series(1, 50) g;
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', %L::text[])', v_entry, v_addresses)) = '55000',
        'fifty guests and a host is one over the cap, because every guest counts as somebody'
    );
    SELECT array_agg(format('day%s@example.com', g)) INTO v_addresses FROM generate_series(1, 49) g;
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', %L::text[])', v_entry, v_addresses)) IS NULL,
        'forty-nine fit'
    );
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe over', v_from, v_to, v_host)
    RETURNING id INTO v_entry;
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_entry, '{}', ARRAY['fiftieth@example.com']);
    RESET ROLE;
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''fiftyfirst@example.com''])', v_entry)) = '55000',
        'and a host has a daily limit on strangers'' inboxes'
    );

    -- 22 allowances
    DELETE FROM scheduling.guest_mail m USING scheduling.event_attendees a, scheduling.events e
     WHERE a.id = m.attendee_id AND e.id = a.event_id AND e.created_by = v_host;
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''fiftyfirst@example.com''])', v_entry)) = '55000',
        'and deleting what was sent gives none of it back'
    );
    DELETE FROM scheduling.guest_mail_quota;
    FOR v_n IN 1..10 LOOP
        INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
        VALUES (v_schedule, 'sync', 'Probe popular', v_from, v_to, v_host)
        RETURNING id INTO v_entry;
        PERFORM pg_temp.ok(
            pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''popular@example.com''])', v_entry)) IS NULL,
            format('invitation %s to one address goes out', v_n)
        );
    END LOOP;
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe popular', v_from, v_to, v_host)
    RETURNING id INTO v_entry;
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''popular@example.com''])', v_entry)) = '55000',
        'and an address has a limit of its own, whoever is asking'
    );
    DELETE FROM scheduling.guest_mail_quota;
    UPDATE scheduling.guest_mail SET sent_at = v_now WHERE sent_at IS NULL;

    -- 23 held
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe restless', v_from, v_to, v_host)
    RETURNING id INTO v_entry;
    PERFORM pg_temp.as_user(v_host);
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_entry, '{}', ARRAY['restless@example.com']);
    RESET ROLE;
    v_token := pg_temp.mailed('invite');
    SELECT id INTO v_seat2 FROM scheduling.event_attendees WHERE event_id = v_entry AND email IS NOT NULL;
    INSERT INTO scheduling.guest_mail_quota (subject, day, spent)
    VALUES (scheduling.fn_guest_hash('restless@example.com'), (v_now AT TIME ZONE 'UTC')::date, 10)
    ON CONFLICT (subject, day) DO UPDATE SET spent = 10;
    UPDATE scheduling.events SET starts_at = v_from + interval '1 hour', ends_at = v_to + interval '1 hour' WHERE id = v_entry;
    SET LOCAL ROLE service_role;
    SELECT count(*) INTO v_n FROM scheduling.claim_guest_mail(50);
    RESET ROLE;
    PERFORM pg_temp.ok(v_n = 0, 'over its address''s limit a new time does not go');
    PERFORM pg_temp.ok(
        (SELECT due_at > v_now + interval '23 hours' AND claimed_at IS NULL FROM scheduling.guest_mail
          WHERE attendee_id = v_seat2 AND kind = 'moved'),
        'it waits a day'
    );
    UPDATE scheduling.events SET starts_at = v_from + interval '2 hours', ends_at = v_to + interval '2 hours' WHERE id = v_entry;
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.guest_mail WHERE attendee_id = v_seat2 AND kind = 'moved') = 1,
        'and a further move adds nothing, because the one waiting will say the latest time'
    );
    DELETE FROM scheduling.guest_mail_quota;
    UPDATE scheduling.guest_mail SET due_at = v_now WHERE attendee_id = v_seat2;
    SET LOCAL ROLE service_role;
    SELECT m.starts_at::text INTO v_text FROM scheduling.claim_guest_mail(50) m WHERE m.kind = 'moved';
    RESET ROLE;
    PERFORM pg_temp.ok(
        v_text::timestamptz = v_from + interval '2 hours',
        format('when it goes it says the latest time, not %s', v_text)
    );

    -- 24 in flight
    UPDATE scheduling.guest_mail SET sent_at = v_now WHERE sent_at IS NULL;
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe in flight', v_from, v_to, v_host)
    RETURNING id INTO v_entry;
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_entry, '{}', ARRAY['inflight@example.com']);
    RESET ROLE;
    SELECT id INTO v_seat2 FROM scheduling.event_attendees WHERE event_id = v_entry AND email IS NOT NULL;
    SET LOCAL ROLE service_role;
    PERFORM m.mail_id FROM scheduling.claim_guest_mail(50) m;
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    UPDATE scheduling.events SET starts_at = v_from + interval '1 hour', ends_at = v_to + interval '1 hour' WHERE id = v_entry;
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.guest_mail
          WHERE attendee_id = v_seat2 AND kind = 'moved' AND claimed_at IS NULL) = 1,
        'a new time during a send is queued, because the invitation may have said the old one'
    );
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.withdraw_invitation(v_entry, v_seat2);
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.guest_mail WHERE attendee_id = v_seat2 AND kind = 'withdrawn') = 1,
        'a withdrawal during a send tells them, because the invitation is on its way'
    );
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.guest_mail WHERE attendee_id = v_seat2 AND kind = 'invite') = 1,
        'and the message being sent is left to finish'
    );

    -- 25 archived
    UPDATE scheduling.guest_mail SET sent_at = v_now WHERE sent_at IS NULL;
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_entry, '{}', ARRAY['archived@example.com']);
    RESET ROLE;
    BEGIN
        SET LOCAL ROLE authenticated;
        UPDATE scheduling.events SET archived_at = v_now WHERE id = v_entry;
        RAISE EXCEPTION 'PROBE FAIL: an entry was archived with its guests never told';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        NULL;
    END;
    RESET ROLE;

    -- 26 dead links
    UPDATE scheduling.guest_mail SET sent_at = NULL WHERE attendee_id = v_seat2 AND kind = 'withdrawn';
    UPDATE scheduling.guest_mail SET sent_at = v_now WHERE attendee_id <> v_seat2 AND sent_at IS NULL;
    SET LOCAL ROLE service_role;
    SELECT m.token INTO v_token FROM scheduling.claim_guest_mail(50) m WHERE m.kind = 'withdrawn';
    PERFORM pg_temp.ok(v_token IS NOT NULL, 'a withdrawal carries a link');
    PERFORM pg_temp.ok(scheduling.guest_invitation(v_token) ->> 'state' = 'dead', 'which opens nothing');
    PERFORM pg_temp.ok(NOT scheduling.guest_answer(v_token, 'accepted'), 'and answers nothing');
    PERFORM scheduling.guest_opt_out(v_token);
    PERFORM scheduling.guest_opt_out(repeat('0', 64));
    RESET ROLE;
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''inflight@example.com''])', v_event)) = '55000'
        OR EXISTS (
            SELECT 1 FROM scheduling.guest_mail_opt_outs
             WHERE email_hash = scheduling.fn_guest_hash('inflight@example.com')
        ),
        'but it stops further email, so invite-and-withdraw cannot leave somebody without a way out'
    );
    PERFORM pg_temp.ok(
        EXISTS (
            SELECT 1 FROM scheduling.guest_mail_opt_outs
             WHERE email_hash = scheduling.fn_guest_hash('inflight@example.com')
        ),
        'the address is on the list'
    );

    -- 27 claim races
    UPDATE scheduling.guest_mail SET sent_at = v_now WHERE sent_at IS NULL;
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe round', v_from, v_to, v_host)
    RETURNING id INTO v_entry;
    PERFORM pg_temp.as_user(v_host);
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_entry, ARRAY[v_other], ARRAY['roundguest@example.com']);
    RESET ROLE;
    v_token := pg_temp.mailed('invite');
    INSERT INTO org.user_emails (user_id, email, is_primary, verified_at)
    VALUES (v_other, 'roundguest@example.com', false, v_now);
    INSERT INTO scheduling.event_reschedules (event_id, round, mode, status, opened_by_user_id, opened_at)
    VALUES (v_entry, 0, 'counterparty', 'collecting', v_host, v_now)
    RETURNING id INTO v_round;
    PERFORM pg_temp.as_user(v_other);
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.claim_guest_seat(%L)', v_token)) = '55000',
        'nobody joins an electorate while it is being counted'
    );
    UPDATE scheduling.event_reschedules SET status = 'withdrawn' WHERE id = v_round;
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.ok(scheduling.claim_guest_seat(v_token) = v_entry, 'once the round has closed, they can');
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.event_attendees
          WHERE event_id = v_entry AND user_id = v_other AND archived_at IS NULL) = 1,
        'and somebody already seated keeps their one seat'
    );
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.claim_guest_seat(%L)', v_token)) = '55000',
        'a second press finds nothing to claim, and takes nothing away'
    );
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM scheduling.event_attendees
          WHERE event_id = v_entry AND user_id = v_other AND archived_at IS NULL) = 1,
        'they are still seated'
    );

    -- The seed has no minor, so one is made for the length of this transaction.
    v_minor := v_third;
    UPDATE org.users_public SET dob = (v_now - interval '15 years')::date WHERE user_id = v_minor;
    PERFORM pg_temp.ok(org.fn_is_minor(v_minor), 'this person now reads as under 18');
    INSERT INTO scheduling.schedules (owner_type, owner_id) VALUES ('user', v_minor)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_schedule FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_minor;
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe minor', v_from, v_to, v_minor)
    RETURNING id INTO v_entry;
    PERFORM pg_temp.as_user(v_minor);
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[''a@example.com''])', v_entry)) = '55000',
        'somebody under 18 emails nobody outside the platform'
    );
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ARRAY[%L]::uuid[])', v_entry, v_host)) IS NULL,
        'and still invites people on it'
    );

    -- 18 retention
    UPDATE scheduling.events SET starts_at = v_now - interval '40 days', ends_at = v_now - interval '39 days'
     WHERE id = v_event;
    SET LOCAL ROLE service_role;
    v_n := scheduling.fn_forget_guest_addresses();
    RESET ROLE;
    PERFORM pg_temp.ok(v_n >= 1, 'an address is blanked once its entry is long over');
    PERFORM pg_temp.ok(
        (SELECT email IS NULL AND response::text = 'pending' FROM scheduling.event_attendees WHERE id = v_seat),
        'and the seat stays, nameless, with its answer'
    );

    -- 19 presence
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    SELECT schedule_id, 'sync', 'Probe personal link', v_now, v_now + interval '1 hour', created_by
      FROM scheduling.events WHERE id = v_event
    RETURNING id INTO v_entry;
    INSERT INTO scheduling.rooms (event_id, provider, status, provider_meeting_id, provider_host_id, registration)
    VALUES (v_entry, 'zoom', 'ready', 'probe-guest-meeting', 'probe-host', true)
    RETURNING id INTO v_room;
    PERFORM pg_temp.as_user(v_host);
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(v_entry, ARRAY[v_other], '{}');
    RESET ROLE;
    INSERT INTO scheduling.event_attendees (event_id, email) VALUES (v_entry, 'zoomguest@example.com')
    RETURNING id INTO v_seat;
    PERFORM scheduling.save_room_registrant(v_room, NULL, 'probe-registrant', 'https://zoom.example/own', v_seat);
    SET LOCAL ROLE service_role;
    v_answer := scheduling.record_presence(
        'zoom', 'probe-guest-meeting', 'joined', v_now, 'probe-guest-1', 'p1', NULL, 'probe-registrant'
    );
    RESET ROLE;
    PERFORM pg_temp.ok(
        v_answer ->> 'matched_by' = 'guest_link',
        format('a guest''s own provider link is matched to their seat: %s', v_answer)
    );
    PERFORM pg_temp.ok(
        (SELECT attendee_id FROM scheduling.presence_events WHERE room_id = v_room) = v_seat,
        'by seat'
    );
    SET LOCAL ROLE service_role;
    v_answer := scheduling.record_presence(
        'zoom', 'probe-guest-meeting', 'joined', v_now, 'probe-guest-2', 'p2'
    );
    RESET ROLE;
    PERFORM pg_temp.ok(
        v_answer ->> 'matched_by' = 'unmatched',
        format('with a guest seated, a stranger is not put down to the only account: %s', v_answer)
    );

    -- 28 own link
    PERFORM pg_temp.as_user(v_host);
    INSERT INTO org.user_emails (user_id, email, is_primary, verified_at)
    VALUES (v_host, 'zoomguest@example.com', false, v_now);
    UPDATE scheduling.guest_mail SET sent_at = v_now WHERE sent_at IS NULL;
    INSERT INTO scheduling.guest_links (attendee_id, token_hash)
    VALUES (v_seat, scheduling.fn_guest_hash(repeat('7', 64)));
    UPDATE scheduling.events SET created_by = v_other WHERE id = v_entry;
    SELECT event_id INTO v_entry FROM scheduling.event_attendees WHERE id = v_seat;
    UPDATE scheduling.events SET created_by = v_other WHERE id = v_entry;
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.ok(scheduling.claim_guest_seat(repeat('7', 64)) = v_entry, 'a guest with their own provider link claims');
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT user_id = v_host AND attendee_id IS NULL FROM scheduling.room_registrants
          WHERE registrant_id = 'probe-registrant'),
        'and the provider link moves to their account, so their next join is not a clash'
    );

    -- 20 creator
    PERFORM pg_temp.as_user(v_host);
    SELECT id INTO v_schedule FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_host;
    SET LOCAL ROLE authenticated;
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe forged', v_from, v_to, v_other)
    RETURNING id INTO v_entry;
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT created_by FROM scheduling.events WHERE id = v_entry) = v_host,
        'an insert naming somebody else is stamped with the caller'
    );
    SET LOCAL ROLE authenticated;
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at)
    VALUES (v_schedule, 'sync', 'Probe nameless', v_from, v_to)
    RETURNING id INTO v_event;
    UPDATE scheduling.events SET created_by = v_other WHERE id = v_entry;
    UPDATE scheduling.events SET created_by = NULL WHERE id = v_event;
    RESET ROLE;
    PERFORM pg_temp.ok(
        (SELECT created_by FROM scheduling.events WHERE id = v_entry) = v_host,
        'an update cannot change it'
    );
    PERFORM pg_temp.ok(
        (SELECT created_by FROM scheduling.events WHERE id = v_event) = v_host,
        'and neither leaving it out nor nulling it leaves it empty'
    );

    -- 21 no address
    PERFORM pg_temp.ok(
        pg_temp.refused(format('SELECT scheduling.invite_to_event(%L, ''{}'', ARRAY[NULL]::text[])', v_entry)) = '55000',
        'a NULL in the list is refused, so no seat has neither an account nor an address'
    );

    RAISE NOTICE 'PASS event_guests';
END;
$probe$;

ROLLBACK;
