-- Probe: a calendar guest's mail honours the suppression list and the provider's bounces (NO4,
-- Decision #391 (o)).
--
--   1  suppressed   a hard-bounced address is never mailed, and its host is told it never arrived
--   2  marketing    an unsubscribe (Marketing only) does not stop an invitation
--   3  bounce       Resend's id on a guest send is matched by its webhook, which names no recipient:
--                   the address is suppressed and the host told
--   4  never again  a new time reaches nobody the list refuses
--   5  code         a join code is not minted for a suppressed address
--
-- Run: docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/guest_mail_suppression.sql
\set ON_ERROR_STOP on

BEGIN;
-- pg_temp.ok runs as authenticated too, and 00002500 gives a new function no PUBLIC EXECUTE.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

CREATE FUNCTION pg_temp.ok(p boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
END;
$$;

DO $probe$
DECLARE
    v_host uuid;
    v_schedule uuid;
    v_event uuid;
    v_now timestamptz := pg_catalog.now();
    v_emails text[];
    v_mail uuid;
    v_token text;
    v_text text;
BEGIN
    SELECT user_id INTO v_host
      FROM org.users_public WHERE NOT org.fn_is_minor(user_id) ORDER BY user_id LIMIT 1;
    PERFORM pg_temp.ok(v_host IS NOT NULL, 'the seed has an adult');
    SELECT id INTO v_schedule FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_host;
    IF v_schedule IS NULL THEN
        INSERT INTO scheduling.schedules (owner_type, owner_id) VALUES ('user', v_host)
        RETURNING id INTO v_schedule;
    END IF;
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe guest bounce', v_now + interval '30 days', v_now + interval '30 days 1 hour', v_host)
    RETURNING id INTO v_event;

    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_host, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM scheduling.invite_to_event(
        v_event, '{}', ARRAY['probe-bounced@example.com', 'probe-unsub@example.com', 'probe-later@example.com']
    );
    RESET ROLE;
    -- Only this entry's mail is due, whatever else the seed has queued.
    UPDATE scheduling.guest_mail m SET claimed_at = v_now
      FROM scheduling.event_attendees a
     WHERE a.id = m.attendee_id AND a.event_id <> v_event AND m.sent_at IS NULL AND m.failed_at IS NULL;

    INSERT INTO comms.channel_suppressions (channel, destination, reason, marketing_only)
    VALUES ('email', 'probe-bounced@example.com', 'hard_bounce', false),
           ('email', 'probe-unsub@example.com', 'unsubscribe', true);

    -- 1 suppressed
    SET LOCAL ROLE service_role;
    SELECT array_agg(m.email) INTO v_emails FROM scheduling.claim_guest_mail(50) m;
    RESET ROLE;
    PERFORM pg_temp.ok(
        NOT ('probe-bounced@example.com' = ANY (COALESCE(v_emails, '{}'))),
        format('a suppressed guest address is never mailed (claimed %s)', v_emails)
    );
    PERFORM pg_temp.ok(
        (SELECT m.failed_at IS NOT NULL FROM scheduling.guest_mail m
           JOIN scheduling.event_attendees a ON a.id = m.attendee_id
          WHERE a.email = 'probe-bounced@example.com' AND a.event_id = v_event),
        'its message stops for good'
    );
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.ok(
        (SELECT g.undelivered FROM scheduling.get_guest_addresses(ARRAY[v_event]) g
          WHERE g.email = 'probe-bounced@example.com'),
        'and its host is told it never arrived'
    );
    RESET ROLE;

    -- 2 marketing
    PERFORM pg_temp.ok(
        'probe-unsub@example.com' = ANY (v_emails) AND 'probe-later@example.com' = ANY (v_emails),
        format('an unsubscribe does not stop an invitation (claimed %s)', v_emails)
    );

    -- 3 bounce
    SELECT m.id INTO v_mail FROM scheduling.guest_mail m
      JOIN scheduling.event_attendees a ON a.id = m.attendee_id
     WHERE a.email = 'probe-later@example.com' AND a.event_id = v_event;
    SELECT pg_catalog.encode(extensions.gen_random_bytes(32), 'hex') INTO v_token;
    INSERT INTO scheduling.guest_links (attendee_id, token_hash)
    SELECT m.attendee_id, scheduling.fn_guest_hash(v_token) FROM scheduling.guest_mail m WHERE m.id = v_mail;
    SET LOCAL ROLE service_role;
    PERFORM scheduling.finish_guest_mail(v_mail, true, 'probe-resend-later');
    PERFORM scheduling.finish_guest_mail(m.id, true, NULL)
       FROM scheduling.guest_mail m JOIN scheduling.event_attendees a ON a.id = m.attendee_id
      WHERE a.email = 'probe-unsub@example.com' AND a.event_id = v_event;
    v_text := comms.fn_record_delivery_event(
        'resend', 'probe-guest-bounce-1', 'email.bounced', 'probe-resend-later', NULL, 'Permanent'
    );
    RESET ROLE;
    PERFORM pg_temp.ok(v_text = 'hard_bounce', format('the bounce is read, not %s', v_text));
    PERFORM pg_temp.ok(
        comms.fn_is_suppressed('email', 'probe-later@example.com'),
        'a bounce on a guest''s message suppresses the guest''s address'
    );
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.ok(
        (SELECT g.undelivered FROM scheduling.get_guest_addresses(ARRAY[v_event]) g
          WHERE g.email = 'probe-later@example.com'),
        'and its host is told it never arrived'
    );
    RESET ROLE;

    -- 4 never again
    UPDATE scheduling.events SET starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
     WHERE id = v_event;
    SET LOCAL ROLE service_role;
    SELECT array_agg(m.email) INTO v_emails FROM scheduling.claim_guest_mail(50) m;
    RESET ROLE;
    PERFORM pg_temp.ok(
        v_emails = ARRAY['probe-unsub@example.com'],
        format('a new time reaches only the address the list lets through (claimed %s)', v_emails)
    );

    -- 5 code
    SET LOCAL ROLE service_role;
    v_text := scheduling.guest_request_code(v_token) ->> 'state';
    RESET ROLE;
    PERFORM pg_temp.ok(v_text = 'undeliverable', format('no code for a suppressed address, not %s', v_text));
    PERFORM pg_temp.ok(
        (SELECT l.code_sends = 0 FROM scheduling.guest_links l WHERE l.token_hash = scheduling.fn_guest_hash(v_token)),
        'and none is counted against the link'
    );
END;
$probe$;

ROLLBACK;
