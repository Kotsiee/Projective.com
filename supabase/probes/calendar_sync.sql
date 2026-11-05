-- =============================================================================================
-- Probe: calendar sync (SCH-WP4b; Decision #383, ruling R3).
--
--   1. The shape: RLS and grants on event_mirrors, external_sync, the ruled scopes, Notion without
--      `calendar`, the two jobs.
--   2. The queue in: a consent that reads busy time is due at once; the claim, its lease; who is left
--      out.
--   3. A read landing: busy rows carry a span and nothing any other reader can read; free/busy and both
--      gates see them; a full read removes what it did not see; a lost claim writes nothing; a push
--      during a read stays due.
--   4. Pushes and channels: a push marks due and nothing else; a lapse brings renewal forward; a channel
--      is registered once per resource, and never on a closed connection.
--   5. Failures: a release with no error counts nothing, three errors degrade, a good read heals.
--   6. Mirrors: triggers mark them on create, move and cancel; a busy row and a deadline never get one;
--      a claim carries a title, a time and a /meet address and nothing else; opt-out, RSVP, the room.
--   7. Finishing: a change during a write stays dirty; backing off, giving up, and starting again.
--   8. Fan-out: seats on a roster, seat-holders on a group sitting, a seat added later.
--   9. On and off: turning publishing on queues only upcoming events, off queues every copy for removal.
--  10. A calendar deleted at the provider, and a deleted event.
--  11. Disconnect: cursor, mirrors, calendar and direction go, in one call.
--  12. RLS as a client, and the doors' grants.
--  13. Discovery calls: an agreed call reaches each party who publishes, as a title, a time and a /meet
--      address; a move, cancel or decline takes it off; no events row, so its slot is held once.
--  14. What the owner reads (Decision #387): what lands, the door, what nobody else can, what clears it.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/calendar_sync.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts (non-zero exit under
-- ON_ERROR_STOP). now() is one instant in a transaction, so a step that needs time to pass moves a
-- stamp itself.
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

CREATE FUNCTION pg_temp.user_at(p_offset integer) RETURNS uuid LANGUAGE sql AS $$
    SELECT p.user_id FROM org.users_public p ORDER BY p.user_id OFFSET p_offset LIMIT 1;
$$;

-- A connection through the real door. An account already linked answers its id and writes nothing, so
-- reopening one is a second call under p_id, as the service makes it.
CREATE FUNCTION pg_temp.connect(
    p_user uuid,
    p_account text,
    p_kinds integrations.provider_kind[] DEFAULT ARRAY['calendar', 'freebusy']::integrations.provider_kind[],
    p_id uuid DEFAULT gen_random_uuid()
) RETURNS uuid LANGUAGE sql AS $$
    SELECT integrations.fn_store_connection(
        p_id, p_user, 'google', p_account, NULL, p_kinds, ARRAY['s'],
        now() + interval '1 hour', NULL,
        jsonb_build_object(
            'key_id', 'env:00000000', 'wrapped_dek', '\xd0', 'wrapped_dek_nonce', '\xd1',
            'access_token_cipher', '\xaa', 'nonce', '\xa1',
            'refresh_token_cipher', '\xbb', 'refresh_token_nonce', '\xb1'
        )
    );
$$;

-- A connection that publishes.
CREATE FUNCTION pg_temp.publishing(p_user uuid, p_account text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_conn uuid := pg_temp.connect(p_user, p_account);
BEGIN
    PERFORM integrations.fn_set_sync_direction(v_conn, 'bidirectional');
    RETURN v_conn;
END $$;

CREATE FUNCTION pg_temp.schedule_of(p_user uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = p_user;
    IF v_id IS NULL THEN
        INSERT INTO scheduling.schedules (owner_type, owner_id) VALUES ('user', p_user) RETURNING id INTO v_id;
    END IF;
    RETURN v_id;
END $$;

-- One calendar's claim. The door claims everything due, so a step reads only its own row.
CREATE FUNCTION pg_temp.sync_claim(p_connection uuid) RETURNS jsonb LANGUAGE sql AS $$
    SELECT c FROM jsonb_array_elements(integrations.fn_claim_calendar_syncs(500)) c
     WHERE c ->> 'connection_id' = p_connection::text;
$$;

-- One copy's claim. Every other copy due is taken too, and gets its lease lifted, so a later step
-- starts clean.
CREATE FUNCTION pg_temp.mirror_claim(p_event uuid, p_connection uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_claims jsonb := scheduling.claim_event_mirrors(500);
    v_id uuid;
    v_claim jsonb;
BEGIN
    SELECT m.id INTO v_id FROM scheduling.event_mirrors m
     WHERE m.event_id = p_event AND m.connection_id = p_connection;
    SELECT c INTO v_claim FROM jsonb_array_elements(v_claims) c WHERE c ->> 'mirror_id' = v_id::text;
    UPDATE scheduling.event_mirrors m SET claimed_at = NULL WHERE m.id <> v_id;
    RETURN v_claim;
END $$;

CREATE FUNCTION pg_temp.mirror_of(p_event uuid, p_connection uuid) RETURNS scheduling.event_mirrors
LANGUAGE sql AS $$
    SELECT m FROM scheduling.event_mirrors m WHERE m.event_id = p_event AND m.connection_id = p_connection;
$$;

-- Settle a copy, as a job that wrote it would.
CREATE FUNCTION pg_temp.settle(p_claim jsonb, p_external text DEFAULT 'copy-1') RETURNS void LANGUAGE sql AS $$
    SELECT scheduling.finish_event_mirror(
        (p_claim ->> 'mirror_id')::uuid, (p_claim ->> 'claimed_at')::timestamptz,
        (p_claim ->> 'dirty_at')::timestamptz, p_external, 'v1'
    );
$$;

CREATE FUNCTION pg_temp.entry(
    p_user uuid,
    p_title text DEFAULT 'Probe entry',
    p_in interval DEFAULT interval '3 days',
    p_length interval DEFAULT interval '1 hour',
    p_kind scheduling.event_kind DEFAULT 'general'
) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at, created_by)
    VALUES (pg_temp.schedule_of(p_user), p_kind, 'confirmed', p_title, now() + p_in, now() + p_in + p_length, p_user)
    RETURNING id;
$$;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- A fresh schedule that takes half-hour calls at any hour, so a door's gate asks nothing of the seed.
CREATE FUNCTION pg_temp.takes_calls(p_user uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_schedule uuid;
BEGIN
    DELETE FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = p_user;
    v_schedule := pg_temp.schedule_of(p_user);
    UPDATE scheduling.schedules SET timezone = 'UTC' WHERE id = v_schedule;
    INSERT INTO scheduling.call_settings (
        schedule_id, accepts_calls, courtesy_enabled, courtesy_duration_minutes, buffer_after_minutes,
        min_notice_minutes
    ) VALUES (v_schedule, true, true, 30, 0, 0);
    INSERT INTO scheduling.availability_rules (schedule_id, kind, weekday, start_minute, end_minute)
    SELECT v_schedule, 'call_window', d, 0, 1440 FROM generate_series(0, 6) d;
    RETURN v_schedule;
END $$;

-- A call written straight to the table, the state a door starts from: with no auth.uid() the insert
-- gate stands aside. It carries what must never leave.
CREATE FUNCTION pg_temp.call(
    p_host uuid,
    p_guest uuid,
    p_start timestamptz,
    p_status scheduling.call_status DEFAULT 'proposed',
    p_provider text DEFAULT 'zoom'
) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO scheduling.discovery_calls (
        host_schedule_id, host_user_id, requester_user_id, status, proposed_start, proposed_end,
        confirmed_start, confirmed_end, agenda, provider_slug, meeting_url
    ) VALUES (
        pg_temp.schedule_of(p_host), p_host, p_guest, p_status, p_start, p_start + interval '30 minutes',
        CASE WHEN p_status = 'confirmed' THEN p_start END,
        CASE WHEN p_status = 'confirmed' THEN p_start + interval '30 minutes' END,
        'Secret agenda', p_provider, 'https://zoom.example/j/secret'
    ) RETURNING id;
$$;

CREATE FUNCTION pg_temp.call_mirror(p_call uuid, p_connection uuid) RETURNS scheduling.event_mirrors
LANGUAGE sql AS $$
    SELECT m FROM scheduling.event_mirrors m WHERE m.call_id = p_call AND m.connection_id = p_connection;
$$;

-- pg_temp.mirror_claim for a call's copy.
CREATE FUNCTION pg_temp.call_claim(p_call uuid, p_connection uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_claims jsonb := scheduling.claim_event_mirrors(500);
    v_id uuid := (pg_temp.call_mirror(p_call, p_connection)).id;
    v_claim jsonb;
BEGIN
    SELECT c INTO v_claim FROM jsonb_array_elements(v_claims) c WHERE c ->> 'mirror_id' = v_id::text;
    UPDATE scheduling.event_mirrors m SET claimed_at = NULL WHERE m.id <> v_id;
    RETURN v_claim;
END $$;

-- Remove a claimed copy, as a job that took it off would.
CREATE FUNCTION pg_temp.removed(p_claim jsonb) RETURNS void LANGUAGE sql AS $$
    SELECT scheduling.finish_event_mirror(
        (p_claim ->> 'mirror_id')::uuid, (p_claim ->> 'claimed_at')::timestamptz,
        (p_claim ->> 'dirty_at')::timestamptz
    );
$$;
-- #endregion

-- #region 1. The shape
DO $$
DECLARE
    v_google integrations.providers;
    v_outlook integrations.providers;
    v_job ops.scheduled_jobs;
BEGIN
    SELECT * INTO v_google FROM integrations.providers WHERE slug = 'google';
    SELECT * INTO v_outlook FROM integrations.providers WHERE slug = 'outlook';

    PERFORM pg_temp.check(
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'scheduling.event_mirrors'::regclass),
        'event_mirrors has RLS on');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'scheduling' AND tablename = 'event_mirrors'),
        'and no policy: it is definer-only');
    PERFORM pg_temp.check(
        NOT has_table_privilege('authenticated', 'scheduling.event_mirrors', 'SELECT')
        AND NOT has_table_privilege('anon', 'scheduling.event_mirrors', 'SELECT'),
        'no client role reads it');
    PERFORM pg_temp.check(
        has_table_privilege('service_role', 'scheduling.event_mirrors', 'SELECT, INSERT, UPDATE, DELETE'),
        'the service role does');
    PERFORM pg_temp.check(
        has_column_privilege('authenticated', 'scheduling.events', 'external_sync', 'SELECT')
        AND NOT has_column_privilege('authenticated', 'scheduling.events', 'meeting_url', 'SELECT'),
        'a host reads external_sync, and a join link stays withheld');

    PERFORM pg_temp.check(
        (SELECT column_default = 'true' AND is_nullable = 'NO' FROM information_schema.columns
          WHERE table_schema = 'scheduling' AND table_name = 'events' AND column_name = 'external_sync'),
        'an event goes out unless its host says otherwise');

    PERFORM pg_temp.check(
        v_google.auth_config -> 'kind_scopes' -> 'freebusy' = '["https://www.googleapis.com/auth/calendar.events.owned.readonly"]'::jsonb
        AND v_google.auth_config -> 'kind_scopes' -> 'calendar' = '["https://www.googleapis.com/auth/calendar.app.created"]'::jsonb,
        'google asks for exactly the ruled calendar scopes');
    PERFORM pg_temp.check(
        v_outlook.auth_config -> 'kind_scopes' -> 'freebusy' = '["Calendars.ReadBasic"]'::jsonb
        AND v_outlook.auth_config -> 'kind_scopes' -> 'calendar' = '["Calendars.ReadWrite"]'::jsonb,
        'outlook asks for exactly the ruled calendar scopes');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM integrations.providers WHERE slug = 'notion' AND 'calendar' = ANY (capabilities)),
        'notion has no calendar capability (R9)');

    SELECT * INTO v_job FROM ops.scheduled_jobs WHERE name = 'integrations-calendar-sync';
    PERFORM pg_temp.check(
        v_job.kind = 'http' AND v_job.secret_name = 'INTEGRATIONS_CRON_SECRET'
        AND v_job.path LIKE '/api/integrations/cron/sync%',
        'the calendar sync is an http job on the integrations secret');
    SELECT * INTO v_job FROM ops.scheduled_jobs WHERE name = 'integrations-outbound-sync';
    PERFORM pg_temp.check(
        v_job.kind = 'http' AND v_job.secret_name = 'INTEGRATIONS_CRON_SECRET'
        AND v_job.path LIKE '/api/integrations/cron/sync%task=outbound%',
        'so is the outbound sync, on the same route');
END $$;
-- #endregion

-- #region 2. The queue in
DO $$
DECLARE
    v_user uuid := pg_temp.user_at(0);
    v_conn uuid := pg_temp.connect(v_user, 'probe-queue');
    v_older uuid;
    v_claim jsonb;
BEGIN
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.connection_sync_state s
                 WHERE s.connection_id = v_conn AND s.resource = 'calendar:primary'
                   AND s.kind = 'freebusy' AND s.due_at IS NOT NULL),
        'a consent that reads busy time is due at once');

    v_claim := pg_temp.sync_claim(v_conn);
    PERFORM pg_temp.check(v_claim IS NOT NULL, 'the claim takes it');
    PERFORM pg_temp.check(v_claim -> 'cursor' = 'null'::jsonb, 'a first read has no cursor: it is a full read');
    PERFORM pg_temp.check(NOT (v_claim ->> 'has_channel')::boolean, 'and it has no channel yet');
    PERFORM pg_temp.check(NOT v_claim ? 'secret', 'no sealed token comes with a claim');

    PERFORM pg_temp.check(pg_temp.sync_claim(v_conn) IS NULL, 'a second run stays off a claimed calendar');
    UPDATE integrations.connection_sync_state SET claimed_at = now() - interval '11 minutes' WHERE connection_id = v_conn;
    PERFORM pg_temp.check(pg_temp.sync_claim(v_conn) IS NOT NULL, 'a run that died lets it go after ten minutes');

    UPDATE integrations.connection_sync_state
       SET claimed_at = NULL, due_at = NULL, last_delta_at = now() - interval '30 minutes'
     WHERE connection_id = v_conn;
    PERFORM pg_temp.check(pg_temp.sync_claim(v_conn) IS NULL, 'read half an hour ago and not due: left alone');
    UPDATE integrations.connection_sync_state
       SET claimed_at = NULL, last_delta_at = now() - interval '61 minutes', sync_token = 'kept',
           full_sync_completed_at = now() - interval '1 day'
     WHERE connection_id = v_conn;
    v_claim := pg_temp.sync_claim(v_conn);
    PERFORM pg_temp.check(v_claim ->> 'cursor' = 'kept', 'an hour unread comes round, on its cursor: a missed push');
    UPDATE integrations.connection_sync_state
       SET claimed_at = NULL, full_sync_completed_at = now() - interval '8 days'
     WHERE connection_id = v_conn;
    v_claim := pg_temp.sync_claim(v_conn);
    PERFORM pg_temp.check(v_claim -> 'cursor' = 'null'::jsonb, 'a week after a full read, the next is full again');

    -- A full batch of routine reads does not hold up a calendar that just changed.
    UPDATE integrations.connection_sync_state
       SET claimed_at = NULL, due_at = NULL, last_delta_at = now() - interval '2 hours';
    UPDATE integrations.connection_sync_state
       SET due_at = now(), last_delta_at = now() - interval '1 minute'
     WHERE connection_id = v_conn;
    v_older := pg_temp.connect(v_user, 'probe-queue-older');
    UPDATE integrations.connection_sync_state
       SET due_at = NULL, last_delta_at = now() - interval '9 hours'
     WHERE connection_id = v_older;
    PERFORM pg_temp.check(
        integrations.fn_claim_calendar_syncs(1) -> 0 ->> 'connection_id' = v_conn::text,
        'a calendar a push marked goes ahead of one merely unread');

    UPDATE integrations.connection_sync_state SET claimed_at = NULL WHERE connection_id = v_conn;
    UPDATE integrations.user_connections SET status = 'expired' WHERE id = v_conn;
    PERFORM pg_temp.check(pg_temp.sync_claim(v_conn) IS NULL, 'an expired connection is left out');
    UPDATE integrations.user_connections SET status = 'active', sync_direction = 'outbound' WHERE id = v_conn;
    PERFORM pg_temp.check(pg_temp.sync_claim(v_conn) IS NULL, 'and so is one that only writes');
    UPDATE integrations.user_connections SET sync_direction = 'inbound', granted_kinds = '{calendar}' WHERE id = v_conn;
    PERFORM pg_temp.check(pg_temp.sync_claim(v_conn) IS NULL, 'and one whose grant no longer reads');

    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM integrations.connection_sync_state s
                     WHERE s.connection_id = pg_temp.connect(v_user, 'probe-no-read', ARRAY['calendar']::integrations.provider_kind[])),
        'a consent with no read scope queues nothing');
END $$;
-- #endregion

-- #region 3. A read landing
DO $$
DECLARE
    v_user uuid := pg_temp.user_at(1);
    v_conn uuid;
    v_schedule uuid;
    v_claim jsonb;
    v_at timestamptz;
    e scheduling.events;
    v_spans integer;
    v_start timestamptz := date_trunc('hour', now()) + interval '40 days';
    v_busy jsonb;
BEGIN
    -- Somebody with no schedule yet, in a zone that is not the column's default.
    DELETE FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_user;
    UPDATE org.users_public SET timezone = 'Asia/Tokyo' WHERE user_id = v_user;
    v_conn := pg_temp.connect(v_user, 'probe-read');
    v_claim := pg_temp.sync_claim(v_conn);
    v_at := (v_claim ->> 'claimed_at')::timestamptz;
    v_busy := jsonb_build_array(
        jsonb_build_object('id', 'timed', 'starts_at', v_start, 'ends_at', v_start + interval '1 hour'),
        jsonb_build_object('id', 'day', 'start_date', '2027-03-01', 'end_date', '2027-03-02')
    );

    PERFORM pg_temp.check(
        integrations.fn_apply_busy_sync(v_conn, 'calendar:primary', v_at, true, v_busy, '{}', 'cursor-1'),
        'a full read lands');

    SELECT id INTO v_schedule FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = v_user;
    PERFORM pg_temp.check(v_schedule IS NOT NULL, 'a schedule was opened for it');
    PERFORM pg_temp.check(
        (SELECT timezone FROM scheduling.schedules WHERE id = v_schedule) = 'Asia/Tokyo',
        'in the person''s own zone');
    PERFORM pg_temp.check(
        NOT (SELECT is_published FROM scheduling.schedules WHERE id = v_schedule),
        'and it publishes nothing');

    SELECT * INTO e FROM scheduling.events WHERE source_connection_id = v_conn AND external_event_id = 'timed';
    PERFORM pg_temp.check(
        e.kind = 'busy' AND e.status = 'busy' AND e.schedule_id = v_schedule AND e.is_masked,
        'a busy row is busy, masked, and on the person''s schedule');
    PERFORM pg_temp.check(
        e.title = '' AND e.description IS NULL AND e.location IS NULL AND e.meta IS NULL AND e.meeting_url IS NULL,
        'and it carries nothing any other reader can read');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.event_attendees a WHERE a.event_id = e.id),
        'and no attendees');

    SELECT * INTO e FROM scheduling.events WHERE source_connection_id = v_conn AND external_event_id = 'day';
    PERFORM pg_temp.check(
        e.all_day AND e.starts_at = timestamptz '2027-02-28 15:00:00+00' AND e.ends_at = timestamptz '2027-03-01 15:00:00+00',
        'a whole day runs midnight to midnight in the schedule''s zone');

    PERFORM pg_temp.check(
        (SELECT sync_token = 'cursor-1' AND due_at IS NULL AND claimed_at IS NULL AND last_delta_at = now()
                AND full_sync_completed_at = now()
           FROM integrations.connection_sync_state WHERE connection_id = v_conn),
        'the cursor is kept, and the calendar is no longer due');
    PERFORM pg_temp.check(
        (SELECT last_synced_at = now() FROM integrations.user_connections WHERE id = v_conn),
        'and the connection shows when it last read, which keeps the refresh job on it');

    PERFORM pg_temp.check(
        scheduling.fn_has_conflicting_event(v_schedule, v_start + interval '15 minutes', v_start + interval '45 minutes'),
        'the booking gate sees the busy time');
    PERFORM pg_temp.check(
        NOT scheduling.fn_slot_is_free(v_schedule, v_start, v_start + interval '30 minutes'),
        'and so does the slot check both gates use');
    PERFORM pg_temp.as_user(v_user);
    SELECT count(*) INTO v_spans FROM scheduling.get_free_busy(v_schedule, v_start - interval '1 day', v_start + interval '1 day');
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM pg_temp.check(v_spans = 1, 'free/busy reports the span');

    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.event_mirrors m
                      JOIN scheduling.events x ON x.id = m.event_id WHERE x.source_connection_id = v_conn),
        'a busy row is never mirrored, so nothing can echo');

    -- A second read, incremental.
    UPDATE integrations.connection_sync_state SET claimed_at = now(), due_at = now() WHERE connection_id = v_conn;
    PERFORM pg_temp.check(
        integrations.fn_apply_busy_sync(
            v_conn, 'calendar:primary', now(), false,
            jsonb_build_array(
                jsonb_build_object('id', 'timed', 'starts_at', v_start + interval '2 hours', 'ends_at', v_start + interval '3 hours'),
                jsonb_build_object('id', 'new', 'starts_at', v_start + interval '1 day', 'ends_at', v_start + interval '25 hours')
            ),
            ARRAY['day', 'never-seen'], 'cursor-2'),
        'an incremental read lands');
    PERFORM pg_temp.check(
        (SELECT starts_at = v_start + interval '2 hours' FROM scheduling.events
          WHERE source_connection_id = v_conn AND external_event_id = 'timed'),
        'a moved event moves, on the same row');
    PERFORM pg_temp.check(
        NOT scheduling.fn_has_conflicting_event(v_schedule, v_start, v_start + interval '1 hour'),
        'and releases the time it left');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM scheduling.events WHERE source_connection_id = v_conn AND external_event_id = 'day'
                   AND status = 'cancelled' AND archived_at IS NOT NULL),
        'one that went is cancelled and archived, like every other removal');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM scheduling.events WHERE source_connection_id = v_conn AND archived_at IS NULL) = 2,
        'and an id never seen is harmless');
    PERFORM pg_temp.check(
        NOT scheduling.fn_has_conflicting_event(v_schedule, timestamptz '2027-02-28 15:00:00+00', timestamptz '2027-03-01 15:00:00+00'),
        'it holds no time any more');

    -- A full read: what it did not see is gone. An empty calendar is an answer, not a mistake.
    UPDATE integrations.connection_sync_state SET claimed_at = now() WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(
        v_conn, 'calendar:primary', now(), true,
        jsonb_build_array(jsonb_build_object('id', 'new', 'starts_at', v_start, 'ends_at', v_start + interval '1 hour')),
        '{}', 'cursor-3');
    PERFORM pg_temp.check(
        (SELECT array_agg(external_event_id) FROM scheduling.events WHERE source_connection_id = v_conn AND archived_at IS NULL) = ARRAY['new'],
        'a full read removes what it did not see');
    UPDATE integrations.connection_sync_state SET claimed_at = now() WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(
        v_conn, 'calendar:primary', now(), true,
        jsonb_build_array(jsonb_build_object('id', 'timed', 'starts_at', v_start, 'ends_at', v_start + interval '1 hour')),
        '{}', 'cursor-4');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM scheduling.events WHERE source_connection_id = v_conn AND external_event_id = 'timed'
                   AND status = 'busy' AND archived_at IS NULL),
        'and an event that comes back is the same row, live again');
    UPDATE integrations.connection_sync_state SET claimed_at = now() WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(v_conn, 'calendar:primary', now(), true, '[]', '{}', 'cursor-5');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.events WHERE source_connection_id = v_conn AND archived_at IS NULL),
        'an empty full read leaves nothing');

    -- A reconnect that unticks the read takes back what the old consent brought in.
    UPDATE integrations.connection_sync_state SET claimed_at = now() WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(
        v_conn, 'calendar:primary', now(), true,
        jsonb_build_array(jsonb_build_object('id', 'kept', 'starts_at', v_start, 'ends_at', v_start + interval '1 hour')),
        '{}', 'cursor-5');
    PERFORM pg_temp.connect(v_user, 'probe-read', ARRAY['calendar']::integrations.provider_kind[], v_conn);
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.events WHERE source_connection_id = v_conn AND archived_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM integrations.connection_sync_state WHERE connection_id = v_conn),
        'a reconnect with no read scope leaves no busy rows and no cursor');
    PERFORM pg_temp.connect(v_user, 'probe-read', p_id => v_conn);
    PERFORM pg_temp.check(
        (SELECT due_at IS NOT NULL AND sync_token IS NULL FROM integrations.connection_sync_state WHERE connection_id = v_conn),
        'and consenting again starts over');
    UPDATE integrations.connection_sync_state SET sync_token = 'cursor-5' WHERE connection_id = v_conn;

    -- A claim no longer held writes nothing.
    UPDATE integrations.connection_sync_state SET claimed_at = now() WHERE connection_id = v_conn;
    PERFORM pg_temp.check(
        NOT integrations.fn_apply_busy_sync(
            v_conn, 'calendar:primary', now() - interval '1 hour', false,
            jsonb_build_array(jsonb_build_object('id', 'stale', 'starts_at', v_start, 'ends_at', v_start + interval '1 hour')),
            '{}', 'stale-cursor'),
        'a run that lost its claim is refused');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.events WHERE source_connection_id = v_conn AND external_event_id = 'stale')
        AND (SELECT sync_token FROM integrations.connection_sync_state WHERE connection_id = v_conn) = 'cursor-5',
        'and it wrote nothing, its cursor included');

    -- A push during the read.
    v_at := now() - interval '1 minute';
    UPDATE integrations.connection_sync_state SET claimed_at = v_at, due_at = now() WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(v_conn, 'calendar:primary', v_at, false, '[]', '{}', 'cursor-6');
    PERFORM pg_temp.check(
        (SELECT due_at IS NOT NULL AND claimed_at IS NULL FROM integrations.connection_sync_state WHERE connection_id = v_conn),
        'a push that arrived during a read keeps the calendar due');
END $$;
-- #endregion

-- #region 4. Pushes and channels
DO $$
DECLARE
    v_user uuid := pg_temp.user_at(2);
    v_conn uuid := pg_temp.connect(v_user, 'probe-push');
    v_sub uuid;
    w integrations.webhook_subscriptions;
BEGIN
    UPDATE integrations.connection_sync_state SET due_at = NULL WHERE connection_id = v_conn;
    PERFORM pg_temp.check(
        integrations.fn_register_channel(v_conn, 'calendar:primary', 'probe-channel', 'res-1', 'tok-1',
            'https://app.example.test/hook', now() + interval '7 days'),
        'a channel is registered');
    SELECT * INTO w FROM integrations.webhook_subscriptions WHERE connection_id = v_conn;
    v_sub := w.id;
    PERFORM pg_temp.check(
        w.status = 'active' AND w.provider_slug = 'google' AND w.verification_token = 'tok-1' AND w.last_renewed_at IS NOT NULL,
        'with its secret and its provider');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.connection_audit WHERE connection_id = v_conn AND action = 'webhook_registered'),
        'and an audit line');

    PERFORM pg_temp.check(
        integrations.fn_mark_calendar_due('google', 'probe-channel'),
        'a verified push marks its calendar');
    PERFORM pg_temp.check(
        (SELECT due_at IS NOT NULL FROM integrations.connection_sync_state WHERE connection_id = v_conn),
        'as due, and does nothing else');
    PERFORM pg_temp.check(
        (SELECT last_delivery_at IS NOT NULL FROM integrations.webhook_subscriptions WHERE id = v_sub),
        'the channel records the delivery');
    PERFORM pg_temp.check(
        NOT integrations.fn_mark_calendar_due('google', 'no-such-channel'),
        'an unknown channel marks nothing');
    PERFORM pg_temp.check(
        NOT integrations.fn_mark_calendar_due('outlook', 'probe-channel'),
        'nor does another provider''s id');

    PERFORM integrations.fn_mark_calendar_due('google', 'probe-channel', true);
    PERFORM pg_temp.check(
        (SELECT expires_at <= now() FROM integrations.webhook_subscriptions WHERE id = v_sub),
        'a provider saying renew now brings the lapse forward');
    PERFORM pg_temp.check(
        integrations.fn_claim_channels_for_renewal(500) @> jsonb_build_array(jsonb_build_object('channel', jsonb_build_object('id', v_sub))),
        'and the renewal job takes it');
    UPDATE integrations.connection_sync_state SET claimed_at = NULL, due_at = now() WHERE connection_id = v_conn;
    PERFORM pg_temp.check(
        (pg_temp.sync_claim(v_conn) ->> 'has_channel')::boolean,
        'so the read does not open a second channel over one being renewed');

    UPDATE integrations.webhook_subscriptions SET status = 'expired' WHERE id = v_sub;
    PERFORM pg_temp.check(
        NOT integrations.fn_mark_calendar_due('google', 'probe-channel'),
        'an expired channel marks nothing');
    PERFORM pg_temp.check(
        integrations.fn_register_channel(v_conn, 'calendar:primary', 'probe-channel-2', 'res-2', 'tok-2',
            'https://app.example.test/hook', now() + interval '7 days'),
        'a new channel takes over the resource');
    PERFORM pg_temp.check(
        (SELECT count(*) = 1 AND min(external_channel_id) = 'probe-channel-2' AND min(verification_token) = 'tok-2'
                AND min(status::text) = 'active' AND min(failure_count) = 0
           FROM integrations.webhook_subscriptions WHERE connection_id = v_conn),
        'on the one row, with its own secret');

    PERFORM integrations.fn_revoke_connection(v_conn);
    PERFORM pg_temp.check(
        NOT integrations.fn_register_channel(v_conn, 'calendar:primary', 'probe-late', NULL, 'tok-3', NULL, now() + interval '1 day'),
        'a channel opening as the connection closes is not recorded');
END $$;
-- #endregion

-- #region 5. Failures
DO $$
DECLARE
    v_user uuid := pg_temp.user_at(3);
    v_conn uuid := pg_temp.connect(v_user, 'probe-failures');
    v_at timestamptz := now();
BEGIN
    UPDATE integrations.connection_sync_state SET claimed_at = v_at WHERE connection_id = v_conn;
    PERFORM integrations.fn_release_calendar_sync(v_conn, 'calendar:primary', v_at);
    PERFORM pg_temp.check(
        (SELECT claimed_at IS NULL AND due_at IS NOT NULL FROM integrations.connection_sync_state WHERE connection_id = v_conn)
        AND (SELECT error_count = 0 FROM integrations.user_connections WHERE id = v_conn),
        'giving a claim back with no error counts nothing, and leaves it due');

    FOR i IN 1 .. 3 LOOP
        UPDATE integrations.connection_sync_state SET claimed_at = v_at WHERE connection_id = v_conn;
        PERFORM integrations.fn_release_calendar_sync(v_conn, 'calendar:primary', v_at, 'google answered 403');
        PERFORM pg_temp.check(
            (SELECT status FROM integrations.user_connections WHERE id = v_conn)
                = (CASE WHEN i < 3 THEN 'active' ELSE 'degraded' END)::integrations.connection_status,
            format('read failure %s of 3', i));
    END LOOP;
    PERFORM pg_temp.check(
        (SELECT last_error = 'google answered 403' FROM integrations.user_connections WHERE id = v_conn),
        'the owner sees the provider''s status');

    PERFORM integrations.fn_release_calendar_sync(v_conn, 'calendar:primary', v_at - interval '1 hour', 'stale');
    PERFORM pg_temp.check(
        (SELECT error_count = 3 FROM integrations.user_connections WHERE id = v_conn),
        'a claim no longer held counts nothing');

    UPDATE integrations.connection_sync_state SET claimed_at = v_at WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(v_conn, 'calendar:primary', v_at, true, '[]', '{}', 'healed');
    PERFORM pg_temp.check(
        (SELECT status = 'active' AND error_count = 0 AND last_error IS NULL FROM integrations.user_connections WHERE id = v_conn),
        'a good read heals the connection');
END $$;
-- #endregion

-- #region 6. Mirrors
DO $$
DECLARE
    v_host uuid := pg_temp.user_at(4);
    v_conn uuid := pg_temp.publishing(v_host, 'probe-mirror');
    v_quiet uuid := pg_temp.connect(v_host, 'probe-quiet');
    v_entry uuid;
    v_other uuid;
    m scheduling.event_mirrors;
    v_claim jsonb;
    v_slug text;
    v_stamp timestamptz;
BEGIN
    v_entry := pg_temp.entry(v_host);
    m := pg_temp.mirror_of(v_entry, v_conn);
    PERFORM pg_temp.check(m.id IS NOT NULL AND m.dirty_at IS NOT NULL, 'a new event queues a copy on a publishing connection');
    PERFORM pg_temp.check((pg_temp.mirror_of(v_entry, v_quiet)).id IS NULL, 'and none on a connection that only reads');

    v_other := pg_temp.entry(v_host, 'Due', interval '4 days', interval '0', 'deadline');
    PERFORM pg_temp.check((pg_temp.mirror_of(v_other, v_conn)).id IS NULL, 'a deadline has no span to hold, so it stays home');
    INSERT INTO scheduling.events (schedule_id, kind, status, starts_at, ends_at)
    VALUES (pg_temp.schedule_of(v_host), 'availability', 'available', now(), now() + interval '1 hour')
    RETURNING id INTO v_other;
    PERFORM pg_temp.check((pg_temp.mirror_of(v_other, v_conn)).id IS NULL, 'and an availability block is not a commitment');

    UPDATE scheduling.events SET description = '<p>Secret agenda</p>', location = 'Secret room',
           meeting_url = 'https://zoom.example/j/secret', meeting_passcode = 'hunter2', meeting_details = 'dial 123'
     WHERE id = v_entry;
    v_claim := pg_temp.mirror_claim(v_entry, v_conn);
    PERFORM pg_temp.check(v_claim -> 'event' ->> 'title' = 'Probe entry', 'a claim carries the title');
    PERFORM pg_temp.check(v_claim -> 'event' ? 'starts_at' AND v_claim -> 'event' ? 'ends_at', 'and the time');
    PERFORM pg_temp.check(
        NOT (v_claim -> 'event' ?| ARRAY['description', 'location', 'meeting_url', 'meeting_passcode', 'meeting_details', 'attendees'])
        AND v_claim::text NOT LIKE '%Secret%' AND v_claim::text NOT LIKE '%zoom.example%' AND v_claim::text NOT LIKE '%hunter2%',
        'and no agenda, location, attendee or provider link');
    PERFORM pg_temp.check(v_claim -> 'event' -> 'room_slug' = 'null'::jsonb, 'no room yet, so no address');
    PERFORM pg_temp.check(
        pg_temp.mirror_claim(v_entry, v_conn) IS NULL,
        'a copy being written is not taken twice, so a late write cannot land over a newer one');
    PERFORM pg_temp.settle(v_claim);
    m := pg_temp.mirror_of(v_entry, v_conn);
    PERFORM pg_temp.check(
        m.external_event_id = 'copy-1' AND m.version = 'v1' AND m.dirty_at IS NULL AND m.claimed_at IS NULL,
        'a write settles the copy');

    UPDATE scheduling.events SET description = 'changed' WHERE id = v_entry;
    PERFORM pg_temp.check((pg_temp.mirror_of(v_entry, v_conn)).dirty_at IS NULL, 'an agenda change goes nowhere, so it queues nothing');

    UPDATE scheduling.events SET starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' WHERE id = v_entry;
    PERFORM pg_temp.check((pg_temp.mirror_of(v_entry, v_conn)).dirty_at IS NOT NULL, 'a move marks the copy');
    PERFORM pg_temp.settle(pg_temp.mirror_claim(v_entry, v_conn));

    UPDATE scheduling.events SET title = 'Renamed' WHERE id = v_entry;
    v_claim := pg_temp.mirror_claim(v_entry, v_conn);
    PERFORM pg_temp.check(v_claim -> 'event' ->> 'title' = 'Renamed', 'a rename marks it too, and reads the new title');
    PERFORM pg_temp.settle(v_claim);

    UPDATE scheduling.events SET is_masked = true WHERE id = v_entry;
    UPDATE scheduling.events SET title = 'Renamed again' WHERE id = v_entry;
    v_claim := pg_temp.mirror_claim(v_entry, v_conn);
    PERFORM pg_temp.check(v_claim -> 'event' ->> 'title' = '', 'a masked entry sends no title');
    PERFORM pg_temp.settle(v_claim);
    UPDATE scheduling.events SET is_masked = false WHERE id = v_entry;

    -- The room's address, never its link, and only while the room stands.
    INSERT INTO scheduling.rooms (event_id, provider) VALUES (v_entry, 'zoom') RETURNING slug INTO v_slug;
    v_claim := pg_temp.mirror_claim(v_entry, v_conn);
    PERFORM pg_temp.check(v_claim -> 'event' ->> 'room_slug' = v_slug, 'a new room marks the copy, with its /meet address');
    PERFORM pg_temp.settle(v_claim);
    UPDATE scheduling.rooms SET status = 'minting' WHERE event_id = v_entry;
    UPDATE scheduling.rooms SET status = 'ready', provider_meeting_id = 'probe-meeting' WHERE event_id = v_entry;
    PERFORM pg_temp.check((pg_temp.mirror_of(v_entry, v_conn)).dirty_at IS NULL, 'minting changes nothing a copy says');
    UPDATE scheduling.rooms SET status = 'closing' WHERE event_id = v_entry;
    v_claim := pg_temp.mirror_claim(v_entry, v_conn);
    PERFORM pg_temp.check(v_claim -> 'event' -> 'room_slug' = 'null'::jsonb, 'a closed room leaves the copy');
    PERFORM pg_temp.settle(v_claim);

    -- The host's opt-out.
    UPDATE scheduling.events SET external_sync = false WHERE id = v_entry;
    v_claim := pg_temp.mirror_claim(v_entry, v_conn);
    PERFORM pg_temp.check(
        v_claim -> 'event' = 'null'::jsonb AND v_claim ->> 'external_event_id' = 'copy-1',
        'Projective-only takes the copy off, and names it');
    PERFORM scheduling.finish_event_mirror(
        (v_claim ->> 'mirror_id')::uuid, (v_claim ->> 'claimed_at')::timestamptz, (v_claim ->> 'dirty_at')::timestamptz);
    PERFORM pg_temp.check((pg_temp.mirror_of(v_entry, v_conn)).id IS NULL, 'and the row goes with the copy');
    UPDATE scheduling.events SET title = 'Still private' WHERE id = v_entry;
    PERFORM pg_temp.check((pg_temp.mirror_of(v_entry, v_conn)).id IS NULL, 'an opted-out event opens no new copy');
    UPDATE scheduling.events SET external_sync = true WHERE id = v_entry;
    PERFORM pg_temp.check((pg_temp.mirror_of(v_entry, v_conn)).dirty_at IS NOT NULL, 'and turning it back on opens one');
    PERFORM pg_temp.settle(pg_temp.mirror_claim(v_entry, v_conn));

    -- Cancelled, then archived, as a removal writes it.
    UPDATE scheduling.events SET status = 'cancelled', archived_at = now() WHERE id = v_entry;
    v_claim := pg_temp.mirror_claim(v_entry, v_conn);
    PERFORM pg_temp.check(v_claim -> 'event' = 'null'::jsonb, 'a cancelled event is removed at the provider');
END $$;
-- #endregion

-- #region 7. Finishing
DO $$
DECLARE
    v_host uuid := pg_temp.user_at(5);
    v_conn uuid := pg_temp.publishing(v_host, 'probe-finish');
    v_entry uuid := pg_temp.entry(v_host);
    m scheduling.event_mirrors;
    v_claim jsonb;
BEGIN
    v_claim := pg_temp.mirror_claim(v_entry, v_conn);
    -- The event changes while the provider call is out.
    UPDATE scheduling.event_mirrors SET dirty_at = dirty_at + interval '1 second' WHERE id = (v_claim ->> 'mirror_id')::uuid;
    PERFORM pg_temp.settle(v_claim);
    m := pg_temp.mirror_of(v_entry, v_conn);
    PERFORM pg_temp.check(
        m.dirty_at IS NOT NULL AND m.claimed_at IS NULL AND m.external_event_id = 'copy-1',
        'a change during a write stays dirty, and the id it got is kept');

    UPDATE scheduling.event_mirrors SET dirty_at = now() WHERE id = m.id;
    v_claim := pg_temp.mirror_claim(v_entry, v_conn);
    UPDATE scheduling.event_mirrors SET dirty_at = dirty_at + interval '1 second' WHERE id = m.id;
    PERFORM scheduling.finish_event_mirror(
        m.id, (v_claim ->> 'claimed_at')::timestamptz, (v_claim ->> 'dirty_at')::timestamptz);
    m := pg_temp.mirror_of(v_entry, v_conn);
    PERFORM pg_temp.check(
        m.id IS NOT NULL AND m.external_event_id IS NULL AND m.dirty_at IS NOT NULL,
        'so does a change during a removal, which then starts a new copy');

    UPDATE scheduling.event_mirrors SET dirty_at = now() WHERE id = m.id;
    v_claim := pg_temp.mirror_claim(v_entry, v_conn);
    PERFORM scheduling.finish_event_mirror(
        m.id, now() - interval '1 hour', (v_claim ->> 'dirty_at')::timestamptz, 'stale-copy', 'stale');
    PERFORM pg_temp.check(
        (pg_temp.mirror_of(v_entry, v_conn)).external_event_id IS NULL,
        'an answer for a claim no longer held is dropped');

    PERFORM scheduling.fail_event_mirror(m.id, (v_claim ->> 'claimed_at')::timestamptz, 'google answered 429');
    m := pg_temp.mirror_of(v_entry, v_conn);
    PERFORM pg_temp.check(
        m.attempts = 1 AND m.last_error = 'google answered 429' AND m.claimed_at IS NULL
        AND m.dirty_at = now() + interval '5 minutes',
        'a refusal backs off five minutes');
    PERFORM pg_temp.check(pg_temp.mirror_claim(v_entry, v_conn) IS NULL, 'and is not taken before then');
    UPDATE scheduling.event_mirrors SET dirty_at = now(), claimed_at = now(), attempts = 7 WHERE id = m.id;
    PERFORM scheduling.fail_event_mirror(m.id, now(), 'google answered 400');
    m := pg_temp.mirror_of(v_entry, v_conn);
    PERFORM pg_temp.check(m.dirty_at IS NULL AND m.attempts = 8 AND m.last_error = 'google answered 400', 'the eighth gives up, and says why');
    UPDATE scheduling.events SET title = 'Try again' WHERE id = v_entry;
    m := pg_temp.mirror_of(v_entry, v_conn);
    PERFORM pg_temp.check(m.dirty_at IS NOT NULL AND m.attempts = 0, 'the next change starts it again');
END $$;
-- #endregion

-- #region 8. Fan-out
DO $$
DECLARE
    v_host uuid := pg_temp.user_at(6);
    v_guest uuid := pg_temp.user_at(7);
    v_late uuid := pg_temp.user_at(8);
    v_host_conn uuid := pg_temp.publishing(v_host, 'probe-fan-host');
    v_guest_conn uuid := pg_temp.publishing(v_guest, 'probe-fan-guest');
    v_late_conn uuid := pg_temp.publishing(v_late, 'probe-fan-late');
    v_entry uuid := pg_temp.entry(v_host);
    v_project uuid;
    v_stage uuid;
    v_cohort uuid;
    v_sitting uuid;
    v_mirror uuid;
    v_claim jsonb;
BEGIN
    INSERT INTO scheduling.event_attendees (event_id, user_id, role, response, responded_at)
    VALUES (v_entry, v_host, 'host', 'accepted', now());
    INSERT INTO scheduling.event_attendees (event_id, user_id, role)
    VALUES (v_entry, v_guest, 'participant');
    PERFORM pg_temp.check((pg_temp.mirror_of(v_entry, v_host_conn)).id IS NOT NULL, 'the host holds their event');
    PERFORM pg_temp.check(
        (pg_temp.mirror_of(v_entry, v_guest_conn)).id IS NULL,
        'somebody who has not answered does not hold it yet');
    UPDATE scheduling.event_attendees SET response = 'accepted', responded_at = now()
     WHERE event_id = v_entry AND user_id = v_guest;
    PERFORM pg_temp.check((pg_temp.mirror_of(v_entry, v_guest_conn)).id IS NOT NULL, 'accepting puts it on their calendar');
    PERFORM pg_temp.settle(pg_temp.mirror_claim(v_entry, v_guest_conn));
    UPDATE scheduling.event_attendees SET response = 'rejected', responded_at = now()
     WHERE event_id = v_entry AND user_id = v_guest;
    v_claim := pg_temp.mirror_claim(v_entry, v_guest_conn);
    PERFORM pg_temp.check(v_claim -> 'event' = 'null'::jsonb, 'declining takes it off, whoever else stays');
    PERFORM pg_temp.check(
        (pg_temp.mirror_claim(v_entry, v_host_conn)) -> 'event' <> 'null'::jsonb,
        'and the host keeps theirs');

    -- A group sitting has no roster: its seat-holders hold it.
    INSERT INTO projects.projects (owner_user_id, title, format, session_kind, status, visibility, publish_visibility)
    VALUES (v_host, 'Probe group', 'session', 'group', 'active', 'unlisted', 'unlisted') RETURNING id INTO v_project;
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_project, 'Sessions', 0) RETURNING id INTO v_stage;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_project, v_stage, 'Probe cohort', 10, 'enrolling') RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_guest);
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_cohort, 'Probe sitting', now() + interval '5 days', now() + interval '5 days 1 hour') RETURNING id INTO v_sitting;
    INSERT INTO scheduling.events (schedule_id, project_id, kind, status, title, starts_at, ends_at, source_session_event_id, created_by)
    VALUES (pg_temp.schedule_of(v_host), v_project, 'session', 'confirmed', 'Probe sitting',
            now() + interval '5 days', now() + interval '5 days 1 hour', v_sitting, v_host)
    RETURNING id INTO v_mirror;
    PERFORM pg_temp.check((pg_temp.mirror_of(v_mirror, v_host_conn)).id IS NOT NULL, 'the host holds a group sitting');
    PERFORM pg_temp.check((pg_temp.mirror_of(v_mirror, v_guest_conn)).id IS NOT NULL, 'and so does a seat-holder');
    PERFORM pg_temp.check((pg_temp.mirror_of(v_mirror, v_late_conn)).id IS NULL, 'somebody with no seat does not');

    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_late);
    PERFORM projects.fn_sync_sitting_mirrors(v_cohort);
    PERFORM pg_temp.check(
        (pg_temp.mirror_of(v_mirror, v_late_conn)).id IS NOT NULL,
        'a seat taken later reaches the sitting already on the calendar');
END $$;
-- #endregion

-- #region 9. On and off
DO $$
DECLARE
    v_host uuid := pg_temp.user_at(9);
    v_stranger uuid := pg_temp.user_at(10);
    v_conn uuid := pg_temp.connect(v_host, 'probe-toggle');
    v_upcoming uuid := pg_temp.entry(v_host, 'Upcoming');
    v_past uuid := pg_temp.entry(v_host, 'Past', interval '-3 days');
    v_private uuid := pg_temp.entry(v_host, 'Private');
    v_theirs uuid := pg_temp.entry(v_stranger, 'Theirs');
    v_claim jsonb;
BEGIN
    UPDATE scheduling.events SET external_sync = false WHERE id = v_private;
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.event_mirrors WHERE connection_id = v_conn),
        'a connection that only reads holds no copies');

    PERFORM pg_temp.check(integrations.fn_set_sync_direction(v_conn, 'bidirectional'), 'publishing turns on');
    PERFORM pg_temp.check((pg_temp.mirror_of(v_upcoming, v_conn)).id IS NOT NULL, 'an upcoming event is queued');
    PERFORM pg_temp.check((pg_temp.mirror_of(v_past, v_conn)).id IS NULL, 'a past one is left alone');
    PERFORM pg_temp.check((pg_temp.mirror_of(v_private, v_conn)).id IS NULL, 'a Projective-only one stays home');
    PERFORM pg_temp.check((pg_temp.mirror_of(v_theirs, v_conn)).id IS NULL, 'and nobody else''s comes along');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM integrations.connection_audit WHERE connection_id = v_conn AND action = 'scope_changed'),
        'the trail records the change');
    PERFORM pg_temp.check(NOT integrations.fn_set_sync_direction(v_conn, 'bidirectional'), 'setting the same again changes nothing');

    PERFORM pg_temp.settle(pg_temp.mirror_claim(v_upcoming, v_conn));
    PERFORM pg_temp.check(integrations.fn_set_sync_direction(v_conn, 'inbound'), 'publishing turns off');
    PERFORM pg_temp.check((pg_temp.mirror_of(v_upcoming, v_conn)).dirty_at IS NOT NULL, 'every copy is queued');
    v_claim := pg_temp.mirror_claim(v_upcoming, v_conn);
    PERFORM pg_temp.check(v_claim -> 'event' = 'null'::jsonb, 'for removal');

    -- A connection whose grant cannot write is queued nothing, whatever its direction says.
    UPDATE integrations.user_connections SET granted_kinds = '{freebusy}', sync_direction = 'bidirectional' WHERE id = v_conn;
    PERFORM pg_temp.check(scheduling.fn_open_event_mirrors(v_conn) = 0, 'no write scope, no queue');
    PERFORM pg_temp.check(pg_temp.mirror_claim(v_upcoming, v_conn) IS NULL, 'and no claim');
END $$;
-- #endregion

-- #region 10. A calendar deleted at the provider, and a deleted event
DO $$
DECLARE
    v_host uuid := pg_temp.user_at(11);
    v_conn uuid := pg_temp.publishing(v_host, 'probe-reset');
    v_entry uuid := pg_temp.entry(v_host);
    v_doomed uuid := pg_temp.entry(v_host, 'Doomed');
    v_first uuid;
    v_claim jsonb;
    v_rows integer;
BEGIN
    PERFORM pg_temp.check(integrations.fn_set_outbound_calendar(v_conn, 'cal-1') = 'cal-1', 'the first calendar id is stored');
    PERFORM pg_temp.check(integrations.fn_set_outbound_calendar(v_conn, 'cal-2') = 'cal-1', 'and a second run gets the same answer');
    PERFORM pg_temp.check(
        (SELECT config ->> 'outbound_calendar_id' FROM integrations.user_connections WHERE id = v_conn) = 'cal-1',
        'only one is kept');
    v_claim := pg_temp.mirror_claim(v_entry, v_conn);
    PERFORM pg_temp.check(v_claim ->> 'calendar_id' = 'cal-1', 'a claim names it');
    PERFORM pg_temp.settle(v_claim);
    v_first := (pg_temp.mirror_of(v_entry, v_conn)).id;

    PERFORM integrations.fn_reset_outbound_calendar(v_conn);
    PERFORM pg_temp.check(
        NOT (SELECT config ? 'outbound_calendar_id' FROM integrations.user_connections WHERE id = v_conn),
        'a calendar deleted at the provider is forgotten');
    PERFORM pg_temp.check(
        (pg_temp.mirror_of(v_entry, v_conn)).id <> v_first AND (pg_temp.mirror_of(v_entry, v_conn)).external_event_id IS NULL
        AND (pg_temp.mirror_of(v_entry, v_conn)).dirty_at IS NOT NULL,
        'and every upcoming event starts a new copy');

    v_claim := pg_temp.mirror_claim(v_doomed, v_conn);
    PERFORM pg_temp.settle(v_claim, 'doomed-copy');
    v_first := (v_claim ->> 'mirror_id')::uuid;
    DELETE FROM scheduling.events WHERE id = v_doomed;
    PERFORM pg_temp.check(
        (SELECT event_id IS NULL AND external_event_id = 'doomed-copy' AND dirty_at IS NOT NULL
           FROM scheduling.event_mirrors WHERE id = v_first),
        'a deleted event leaves its copy queued, so it can still be removed');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM jsonb_array_elements(scheduling.claim_event_mirrors(500)) c
                 WHERE c ->> 'mirror_id' = v_first::text AND c -> 'event' = 'null'::jsonb
                   AND c ->> 'external_event_id' = 'doomed-copy'),
        'and the claim names it for removal');

    -- Deleted with no copy behind it, an event opens none on its way out.
    v_doomed := pg_temp.entry(v_host, 'Never copied');
    DELETE FROM scheduling.event_mirrors WHERE event_id = v_doomed;
    SELECT count(*) INTO v_rows FROM scheduling.event_mirrors WHERE connection_id = v_conn;
    DELETE FROM scheduling.events WHERE id = v_doomed;
    PERFORM pg_temp.check(
        (SELECT count(*) FROM scheduling.event_mirrors WHERE connection_id = v_conn) = v_rows,
        'an event with no copy leaves nothing behind when it is deleted');
END $$;
-- #endregion

-- #region 11. Disconnect
DO $$
DECLARE
    v_host uuid := pg_temp.user_at(12);
    v_conn uuid := pg_temp.publishing(v_host, 'probe-disconnect');
    v_entry uuid := pg_temp.entry(v_host);
    v_again uuid;
    v_at timestamptz := now();
BEGIN
    PERFORM integrations.fn_set_outbound_calendar(v_conn, 'cal-1');
    UPDATE integrations.connection_sync_state SET claimed_at = v_at WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(
        v_conn, 'calendar:primary', v_at, true,
        jsonb_build_array(jsonb_build_object('id', 'x', 'starts_at', now() + interval '1 day', 'ends_at', now() + interval '25 hours')),
        '{}', 'cursor-1');
    INSERT INTO integrations.webhook_subscriptions (connection_id, provider_slug, resource, expires_at)
    VALUES (v_conn, 'google', 'calendar:primary', now() + interval '2 days');

    PERFORM pg_temp.check(integrations.fn_revoke_connection(v_conn), 'the connection closes');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM integrations.connection_sync_state WHERE connection_id = v_conn),
        'its read cursor goes');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.event_mirrors WHERE connection_id = v_conn),
        'its mirrors go');
    PERFORM pg_temp.check(
        (SELECT sync_direction = 'inbound' AND NOT config ? 'outbound_calendar_id'
           FROM integrations.user_connections WHERE id = v_conn),
        'it stops publishing and forgets its calendar');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM scheduling.events WHERE source_connection_id = v_conn AND external_event_id = 'x'
                   AND status = 'cancelled' AND archived_at IS NOT NULL),
        'its busy rows are archived');
    PERFORM pg_temp.check(
        (SELECT status = 'expired' FROM integrations.webhook_subscriptions WHERE connection_id = v_conn),
        'its channel stops counting');

    PERFORM pg_temp.check(
        NOT integrations.fn_apply_busy_sync(v_conn, 'calendar:primary', v_at, true, '[]', '{}', 'late'),
        'a read still in flight writes nothing back');
    PERFORM pg_temp.check(
        NOT integrations.fn_set_sync_direction(v_conn, 'bidirectional'),
        'a closed connection cannot start publishing');
    UPDATE scheduling.events SET title = 'After' WHERE id = v_entry;
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.event_mirrors WHERE connection_id = v_conn),
        'and an event changing queues nothing on it');

    v_again := pg_temp.connect(v_host, 'probe-disconnect');
    PERFORM pg_temp.check(v_again = v_conn, 'a fresh consent finds the account''s row');
    PERFORM pg_temp.connect(v_host, 'probe-disconnect', p_id => v_conn);
    PERFORM pg_temp.check(
        (SELECT status = 'active' FROM integrations.user_connections WHERE id = v_conn),
        'and its second pass reopens it');
    PERFORM pg_temp.check(
        (SELECT sync_token IS NULL AND due_at IS NOT NULL FROM integrations.connection_sync_state WHERE connection_id = v_conn),
        'and starts from a full read');
    PERFORM pg_temp.check(
        (SELECT sync_direction = 'inbound' FROM integrations.user_connections WHERE id = v_conn),
        'publishing is a new choice');
END $$;
-- #endregion

-- #region 12. RLS and grants
DO $$
DECLARE
    v_host uuid := pg_temp.user_at(13);
    v_stranger uuid := pg_temp.user_at(14);
    v_conn uuid := pg_temp.publishing(v_host, 'probe-rls');
    v_entry uuid := pg_temp.entry(v_host);
    v_at timestamptz := now();
    v_schedule uuid := pg_temp.schedule_of(v_host);
    v_mirrors_refused boolean := false;
    v_state_refused boolean := false;
    v_title text;
    v_rows integer;
    v_strangers integer;
BEGIN
    UPDATE integrations.connection_sync_state SET claimed_at = v_at WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(
        v_conn, 'calendar:primary', v_at, true,
        jsonb_build_array(jsonb_build_object('id', 'x', 'starts_at', now() + interval '1 day', 'ends_at', now() + interval '25 hours')),
        '{}', 'cursor-1');
    PERFORM pg_temp.settle(pg_temp.mirror_claim(v_entry, v_conn));

    PERFORM pg_temp.as_user(v_host);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
        PERFORM 1 FROM scheduling.event_mirrors LIMIT 1;
    EXCEPTION WHEN insufficient_privilege THEN
        v_mirrors_refused := true;
    END;
    BEGIN
        PERFORM 1 FROM integrations.connection_sync_state LIMIT 1;
    EXCEPTION WHEN insufficient_privilege THEN
        v_state_refused := true;
    END;
    SELECT title, count(*) OVER () INTO v_title, v_rows FROM scheduling.events
     WHERE source_connection_id = v_conn;
    -- The opt-out is the host's own write, through their own policy, and the trigger still fires.
    UPDATE scheduling.events SET external_sync = false WHERE id = v_entry;
    EXECUTE 'RESET ROLE';

    PERFORM pg_temp.check(v_mirrors_refused, 'a client cannot read the mirror queue');
    PERFORM pg_temp.check(v_state_refused, 'nor a read cursor');
    PERFORM pg_temp.check(v_rows = 1 AND v_title = '', 'the owner sees their busy row, with nothing to read on it');
    PERFORM pg_temp.check(
        (pg_temp.mirror_of(v_entry, v_conn)).dirty_at IS NOT NULL,
        'a host''s own opt-out reaches the queue through a client write');

    PERFORM pg_temp.as_user(v_stranger);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_strangers FROM scheduling.events WHERE source_connection_id = v_conn;
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.check(v_strangers = 0, 'nobody else reads the row');
    PERFORM set_config('request.jwt.claims', '', true);
END $$;

DO $$
DECLARE
    v_door text;
BEGIN
    FOREACH v_door IN ARRAY ARRAY[
        'integrations.fn_claim_calendar_syncs(integer)',
        'integrations.fn_apply_busy_sync(uuid,text,timestamptz,boolean,jsonb,text[],text)',
        'integrations.fn_release_calendar_sync(uuid,text,timestamptz,text)',
        'integrations.fn_register_channel(uuid,text,text,text,text,text,timestamptz)',
        'integrations.fn_mark_calendar_due(text,text,boolean)',
        'integrations.fn_set_sync_direction(uuid,integrations.sync_direction)',
        'integrations.fn_set_outbound_calendar(uuid,text)',
        'integrations.fn_reset_outbound_calendar(uuid)',
        'scheduling.claim_event_mirrors(integer)',
        'scheduling.finish_event_mirror(uuid,timestamptz,timestamptz,text,text)',
        'scheduling.fail_event_mirror(uuid,timestamptz,text)'
    ] LOOP
        PERFORM pg_temp.check(
            has_function_privilege('service_role', v_door, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', v_door, 'EXECUTE')
            AND NOT has_function_privilege('anon', v_door, 'EXECUTE'),
            format('%s is the service role''s alone', split_part(v_door, '(', 1)));
    END LOOP;

    FOREACH v_door IN ARRAY ARRAY[
        'scheduling.fn_event_goes_out(scheduling.events)',
        'scheduling.fn_call_goes_out(scheduling.discovery_calls)',
        'scheduling.fn_event_holders(uuid)',
        'scheduling.fn_queue_event_mirrors(uuid)',
        'scheduling.fn_queue_call_mirrors(uuid)',
        'scheduling.fn_open_event_mirrors(uuid)',
        'scheduling.trg_event_mirrors()',
        'scheduling.trg_call_mirrors()',
        'scheduling.trg_attendee_mirrors()',
        'scheduling.trg_room_mirrors()'
    ] LOOP
        PERFORM pg_temp.check(
            NOT has_function_privilege('service_role', v_door, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', v_door, 'EXECUTE')
            AND NOT has_function_privilege('anon', v_door, 'EXECUTE'),
            format('%s is internal', split_part(v_door, '(', 1)));
    END LOOP;
END $$;
-- #endregion

-- #region 13. Discovery calls
DO $$
DECLARE
    v_host uuid := pg_temp.user_at(15);
    v_guest uuid := pg_temp.user_at(16);
    v_stranger uuid := pg_temp.user_at(17);
    v_schedule uuid := pg_temp.takes_calls(v_host);
    v_host_conn uuid := pg_temp.publishing(v_host, 'probe-call-host');
    v_guest_conn uuid := pg_temp.publishing(v_guest, 'probe-call-guest');
    v_quiet uuid := pg_temp.connect(v_guest, 'probe-call-quiet');
    v_stranger_conn uuid := pg_temp.publishing(v_stranger, 'probe-call-stranger');
    v_start timestamptz := date_trunc('hour', now()) + interval '9 days';
    v_end timestamptz := v_start + interval '30 minutes';
    v_call uuid := pg_temp.call(v_host, v_guest, v_start);
    v_other uuid;
    v_entry uuid;
    v_past uuid;
    v_first uuid;
    v_slug text;
    v_spans integer;
    v_claim jsonb;
BEGIN
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.event_mirrors m WHERE m.call_id = v_call),
        'a request is on nobody''s calendar yet');

    -- As the roles it really runs under: a client at the door, the service role at the claim.
    PERFORM pg_temp.as_user(v_host);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM scheduling.confirm_discovery_call(v_call);
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM pg_temp.check(
        (pg_temp.call_mirror(v_call, v_host_conn)).dirty_at IS NOT NULL
        AND (pg_temp.call_mirror(v_call, v_guest_conn)).dirty_at IS NOT NULL,
        'confirming queues a copy for each party who publishes');
    PERFORM pg_temp.check(
        (pg_temp.call_mirror(v_call, v_quiet)).id IS NULL,
        'and none on a connection that only reads');
    PERFORM pg_temp.check(
        (pg_temp.call_mirror(v_call, v_stranger_conn)).id IS NULL,
        'and none for anybody else');

    SELECT slug INTO v_slug FROM scheduling.rooms WHERE call_id = v_call;
    EXECUTE 'SET LOCAL ROLE service_role';
    v_claim := pg_temp.call_claim(v_call, v_host_conn);
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.check(
        v_claim -> 'event' ->> 'title' = 'A call on Projective'
        AND (v_claim -> 'event' ->> 'starts_at')::timestamptz = v_start
        AND (v_claim -> 'event' ->> 'ends_at')::timestamptz = v_end
        AND v_claim -> 'event' ->> 'room_slug' = v_slug,
        'a claim carries the title, the time and the /meet address');
    PERFORM pg_temp.check(
        NOT (v_claim -> 'event' ->> 'tentative')::boolean AND NOT (v_claim -> 'event' ->> 'all_day')::boolean,
        'as a held, timed copy');
    PERFORM pg_temp.check(
        (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_claim -> 'event') k)
            = ARRAY['all_day', 'end_date', 'ends_at', 'room_slug', 'start_date', 'starts_at', 'tentative', 'title', 'transparent'],
        'and nothing else');
    PERFORM pg_temp.check(
        v_claim::text NOT LIKE '%Secret%' AND v_claim::text NOT LIKE '%zoom.example%',
        'so no agenda or provider link leaves');
    PERFORM pg_temp.settle(v_claim);
    v_claim := pg_temp.call_claim(v_call, v_guest_conn);
    PERFORM pg_temp.check(
        v_claim -> 'event' ->> 'title' = 'A call on Projective'
        AND v_claim -> 'event' ->> 'room_slug' = v_slug,
        'the other party''s copy says the same, so nobody is named');
    PERFORM pg_temp.settle(v_claim);

    -- A call has no entry of its own: its slot is held once, and nothing exists to edit.
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.events e WHERE e.schedule_id = v_schedule),
        'publishing a call adds no events row');
    PERFORM pg_temp.check(
        NOT scheduling.fn_has_conflicting_event(v_schedule, v_start, v_end)
        AND NOT scheduling.fn_slot_is_free(v_schedule, v_start, v_end)
        AND scheduling.fn_slot_is_free(v_schedule, v_start, v_end, v_call),
        'so the call holds its slot and a move of it is judged without it');
    PERFORM pg_temp.as_user(v_host);
    SELECT count(*) INTO v_spans FROM scheduling.get_free_busy(v_schedule, v_start - interval '1 day', v_start + interval '1 day');
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM pg_temp.check(v_spans = 1, 'and free/busy reports the one span');

    -- The address follows the room.
    UPDATE scheduling.rooms SET status = 'failed' WHERE call_id = v_call;
    v_claim := pg_temp.call_claim(v_call, v_host_conn);
    PERFORM pg_temp.check(v_claim -> 'event' -> 'room_slug' = 'null'::jsonb, 'a room that failed leaves the copy');
    PERFORM pg_temp.settle(v_claim);
    UPDATE scheduling.rooms SET status = 'pending' WHERE call_id = v_call;
    v_claim := pg_temp.call_claim(v_call, v_host_conn);
    PERFORM pg_temp.check(v_claim -> 'event' ->> 'room_slug' = v_slug, 'and a room that came back returns to it');
    PERFORM pg_temp.settle(v_claim);
    PERFORM pg_temp.settle(pg_temp.call_claim(v_call, v_guest_conn));

    -- A host who offers no platform has no room, and the call still goes out.
    v_other := pg_temp.call(v_host, v_guest, v_start + interval '8 days', 'confirmed', NULL);
    v_claim := pg_temp.call_claim(v_other, v_guest_conn);
    PERFORM pg_temp.check(
        v_claim -> 'event' ->> 'title' = 'A call on Projective'
        AND v_claim -> 'event' -> 'room_slug' = 'null'::jsonb,
        'a call with no room goes out as a title and a time');
    PERFORM pg_temp.settle(v_claim);

    -- A move waits for its counterparty, so the agreed copy comes off.
    PERFORM pg_temp.as_user(v_guest);
    PERFORM scheduling.propose_call_time(v_call, v_start + interval '1 day', v_end + interval '1 day');
    PERFORM set_config('request.jwt.claims', '', true);
    v_claim := pg_temp.call_claim(v_call, v_host_conn);
    PERFORM pg_temp.check(
        v_claim -> 'event' = 'null'::jsonb AND v_claim ->> 'external_event_id' = 'copy-1',
        'a move takes the copy off, and names it');
    PERFORM pg_temp.removed(v_claim);
    PERFORM pg_temp.check((pg_temp.call_mirror(v_call, v_host_conn)).id IS NULL, 'and the row goes with the copy');

    -- Agreed again: one side's copy already came off, the other's job has not run yet.
    PERFORM pg_temp.as_user(v_host);
    PERFORM scheduling.confirm_discovery_call(v_call);
    PERFORM set_config('request.jwt.claims', '', true);
    v_claim := pg_temp.call_claim(v_call, v_host_conn);
    PERFORM pg_temp.check(
        (v_claim -> 'event' ->> 'starts_at')::timestamptz = v_start + interval '1 day'
        AND v_claim -> 'external_event_id' = 'null'::jsonb,
        'the new time starts a new copy where the old one came off');
    PERFORM pg_temp.settle(v_claim);
    v_claim := pg_temp.call_claim(v_call, v_guest_conn);
    PERFORM pg_temp.check(
        (v_claim -> 'event' ->> 'starts_at')::timestamptz = v_start + interval '1 day'
        AND v_claim ->> 'external_event_id' = 'copy-1',
        'and updates it where it had not yet');
    PERFORM pg_temp.settle(v_claim);

    PERFORM pg_temp.as_user(v_guest);
    PERFORM scheduling.cancel_discovery_call(v_call);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM pg_temp.check(
        pg_temp.call_claim(v_call, v_host_conn) -> 'event' = 'null'::jsonb
        AND pg_temp.call_claim(v_call, v_guest_conn) -> 'event' = 'null'::jsonb,
        'a cancel takes both copies off');

    -- Booked straight into confirmed, as auto_confirm does.
    v_other := pg_temp.call(v_host, v_guest, v_start + interval '2 days', 'confirmed');
    PERFORM pg_temp.settle(pg_temp.call_claim(v_other, v_host_conn));
    PERFORM pg_temp.check(
        (pg_temp.call_mirror(v_other, v_host_conn)).external_event_id = 'copy-1',
        'a call booked already agreed goes out too');
    PERFORM pg_temp.as_user(v_guest);
    PERFORM scheduling.propose_call_time(v_other, v_start + interval '3 days', v_end + interval '3 days');
    PERFORM pg_temp.as_user(v_host);
    PERFORM scheduling.decline_discovery_call(v_other);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM pg_temp.check(
        pg_temp.call_claim(v_other, v_host_conn) -> 'event' = 'null'::jsonb,
        'a decline leaves it off');

    -- A call that took place keeps its copy, and finishing writes to no provider.
    v_other := pg_temp.call(v_host, v_guest, v_start + interval '5 days', 'confirmed');
    PERFORM pg_temp.settle(pg_temp.call_claim(v_other, v_host_conn));
    UPDATE scheduling.discovery_calls SET status = 'completed' WHERE id = v_other;
    PERFORM pg_temp.check(
        (pg_temp.call_mirror(v_other, v_host_conn)).dirty_at IS NULL,
        'finishing a call changes nothing a copy says, so it queues nothing');
    UPDATE scheduling.event_mirrors SET dirty_at = now() WHERE call_id = v_other AND connection_id = v_host_conn;
    PERFORM pg_temp.check(
        pg_temp.call_claim(v_other, v_host_conn) -> 'event' <> 'null'::jsonb,
        'and a retry still writes it rather than taking it off');

    -- An entry with an opt-out of its own speaks for the call drawn from it.
    v_other := pg_temp.call(v_host, v_guest, v_start + interval '6 days', 'confirmed');
    PERFORM pg_temp.settle(pg_temp.call_claim(v_other, v_host_conn));
    v_entry := pg_temp.entry(v_host, 'Drawn from a call');
    UPDATE scheduling.events SET external_sync = false WHERE id = v_entry;
    UPDATE scheduling.discovery_calls SET event_id = v_entry WHERE id = v_other;
    PERFORM pg_temp.check(
        pg_temp.call_claim(v_other, v_host_conn) -> 'event' = 'null'::jsonb
        AND pg_temp.mirror_claim(v_entry, v_host_conn) -> 'event' = 'null'::jsonb,
        'a call drawn from an opted-out entry comes off, so external_sync is never gone round');

    -- On and off, with a call still to come and one already over.
    v_other := pg_temp.call(v_host, v_guest, v_start + interval '7 days', 'confirmed');
    v_past := pg_temp.call(v_host, v_guest, now() - interval '3 days', 'confirmed');
    PERFORM pg_temp.check(
        integrations.fn_set_sync_direction(v_quiet, 'bidirectional'),
        'the other connection starts publishing');
    PERFORM pg_temp.check((pg_temp.call_mirror(v_other, v_quiet)).id IS NOT NULL, 'an upcoming call is queued on it');
    PERFORM pg_temp.check((pg_temp.call_mirror(v_past, v_quiet)).id IS NULL, 'a past one is left alone');
    PERFORM pg_temp.check((pg_temp.call_mirror(v_call, v_quiet)).id IS NULL, 'and so is a cancelled one');
    PERFORM pg_temp.settle(pg_temp.call_claim(v_other, v_quiet));
    PERFORM integrations.fn_set_sync_direction(v_quiet, 'inbound');
    v_claim := pg_temp.call_claim(v_other, v_quiet);
    PERFORM pg_temp.check(v_claim -> 'event' = 'null'::jsonb, 'turning it off takes the copy off');
    PERFORM pg_temp.removed(v_claim);

    -- A calendar deleted at the provider.
    PERFORM pg_temp.settle(pg_temp.call_claim(v_other, v_guest_conn));
    v_first := (pg_temp.call_mirror(v_other, v_guest_conn)).id;
    PERFORM integrations.fn_reset_outbound_calendar(v_guest_conn);
    PERFORM pg_temp.check(
        (pg_temp.call_mirror(v_other, v_guest_conn)).id <> v_first
        AND (pg_temp.call_mirror(v_other, v_guest_conn)).external_event_id IS NULL
        AND (pg_temp.call_mirror(v_other, v_guest_conn)).dirty_at IS NOT NULL,
        'a calendar made again takes an upcoming call back');

    -- A deleted call, as a party's erasure cascades it.
    PERFORM pg_temp.settle(pg_temp.call_claim(v_other, v_host_conn), 'doomed-call');
    v_first := (pg_temp.call_mirror(v_other, v_host_conn)).id;
    DELETE FROM scheduling.discovery_calls WHERE id = v_other;
    PERFORM pg_temp.check(
        (SELECT call_id IS NULL AND external_event_id = 'doomed-call' AND dirty_at IS NOT NULL
           FROM scheduling.event_mirrors WHERE id = v_first),
        'a deleted call leaves its copy queued, so it can still be removed');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM jsonb_array_elements(scheduling.claim_event_mirrors(500)) c
                 WHERE c ->> 'mirror_id' = v_first::text AND c -> 'event' = 'null'::jsonb
                   AND c ->> 'external_event_id' = 'doomed-call'),
        'and the claim names it for removal');

    BEGIN
        INSERT INTO scheduling.event_mirrors (event_id, call_id, connection_id)
        VALUES (v_entry, v_call, v_stranger_conn);
        RAISE EXCEPTION 'FAIL a copy held two anchors';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS a copy has one anchor';
    END;
END $$;
-- #endregion

-- #region 14. What the owner reads
DO $$
DECLARE
    v_owner uuid := pg_temp.user_at(15);
    v_stranger uuid := pg_temp.user_at(16);
    v_conn uuid := pg_temp.connect(v_owner, 'probe-details');
    v_other_conn uuid := pg_temp.connect(v_owner, 'probe-details-off');
    v_schedule uuid;
    v_start timestamptz := date_trunc('hour', now()) + interval '41 days';
    v_at timestamptz := now();
    v_ids uuid[];
    v_named uuid;
    v_read jsonb := '{}';
    v_stranger_rows integer;
    v_visible integer;
    v_refused boolean := false;
    v_oversized integer;
    v_rows integer;
    d scheduling.connected_event_details;
BEGIN
    PERFORM pg_temp.check(
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'scheduling.connected_event_details'::regclass),
        'the details table has RLS on');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'scheduling' AND tablename = 'connected_event_details'),
        'and no policy: it is definer-only');
    PERFORM pg_temp.check(
        NOT has_table_privilege('authenticated', 'scheduling.connected_event_details', 'SELECT, INSERT, UPDATE, DELETE')
        AND NOT has_table_privilege('anon', 'scheduling.connected_event_details', 'SELECT, INSERT, UPDATE, DELETE'),
        'no client role reads or writes it');

    UPDATE integrations.connection_sync_state SET claimed_at = v_at WHERE connection_id IN (v_conn, v_other_conn);
    PERFORM integrations.fn_apply_busy_sync(
        v_conn, 'calendar:primary', v_at, true,
        jsonb_build_array(
            jsonb_build_object(
                'id', 'named', 'title', '  Salary talk  ', 'location', ' The boardroom ', 'description', '<b>Notes</b>',
                'series_id', 'series-1', 'recurrence_rule', 'FREQ=DAILY', 'join_url', 'https://meet.google.com/abc',
                'starts_at', v_start, 'ends_at', v_start + interval '1 hour'),
            jsonb_build_object('id', 'blank', 'title', '   ', 'start_date', '2027-03-01', 'end_date', '2027-03-02'),
            jsonb_build_object('id', 'absent', 'starts_at', v_start + interval '2 hours', 'ends_at', v_start + interval '3 hours'),
            jsonb_build_object(
                'id', 'long', 'title', repeat('x', 300), 'location', repeat('y', 300), 'description', repeat('z', 9000),
                'series_id', repeat('s', 2000), 'recurrence_rule', 'not a rule', 'join_url', 'javascript:alert(1)',
                'starts_at', v_start + interval '4 hours', 'ends_at', v_start + interval '5 hours')
        ),
        '{}', 'cursor-1');

    SELECT schedule_id, id INTO v_schedule, v_named FROM scheduling.events
     WHERE source_connection_id = v_conn AND external_event_id = 'named';
    SELECT array_agg(id) INTO v_ids FROM scheduling.events WHERE source_connection_id = v_conn;

    PERFORM pg_temp.check(
        (SELECT title = '' AND is_masked AND location IS NULL AND description IS NULL AND recurrence_rule IS NULL
           FROM scheduling.events WHERE id = v_named),
        'the entry itself stays an empty masked span');
    SELECT * INTO d FROM scheduling.connected_event_details WHERE event_id = v_named;
    PERFORM pg_temp.check(
        d.title = 'Salary talk' AND d.location = 'The boardroom' AND d.description = '<b>Notes</b>'
        AND d.series_id = 'series-1' AND d.recurrence_rule = 'FREQ=DAILY'
        AND d.join_url = 'https://meet.google.com/abc',
        'what it says lands beside it, trimmed');
    PERFORM pg_temp.check(
        (SELECT count(*) = 2 FROM scheduling.connected_event_details d2
           JOIN scheduling.events e ON e.id = d2.event_id
          WHERE e.source_connection_id = v_conn AND e.external_event_id IN ('blank', 'absent') AND d2.title IS NULL),
        'a blank title and a missing one hold nothing');
    SELECT d2.* INTO d FROM scheduling.connected_event_details d2
      JOIN scheduling.events e ON e.id = d2.event_id
     WHERE e.source_connection_id = v_conn AND e.external_event_id = 'long';
    PERFORM pg_temp.check(
        char_length(d.title) = 200 AND char_length(d.location) = 160 AND char_length(d.description) = 8000
        AND char_length(d.series_id) = 1024,
        'what runs long is cut, rather than losing the read');
    PERFORM pg_temp.check(d.recurrence_rule IS NULL, 'and a rule that is not one is dropped');
    PERFORM pg_temp.check(d.join_url IS NULL, 'as is a link that is not https');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.event_mirrors m WHERE m.event_id = ANY (v_ids)),
        'and none of it goes back out');

    PERFORM pg_temp.as_user(v_owner);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT jsonb_object_agg(event_id, join_url), count(*) INTO v_read, v_rows
      FROM scheduling.get_own_event_details(v_ids);
    SELECT count(*) INTO v_oversized
      FROM scheduling.get_own_event_details(array_fill(v_named, ARRAY[501]));
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.check(
        v_rows = 4 AND v_read ->> v_named::text = 'https://meet.google.com/abc',
        'the owner reads every entry through the door');
    PERFORM pg_temp.check(v_oversized = 0, 'a request past the cap answers nothing');

    -- Publishing a schedule shows its busy time, and still none of this.
    UPDATE scheduling.schedules SET is_published = true WHERE id = v_schedule;
    SELECT count(*) INTO v_visible
      FROM scheduling.get_free_busy(v_schedule, v_start - interval '1 day', v_start + interval '1 day');
    PERFORM pg_temp.as_user(v_stranger);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_stranger_rows FROM scheduling.get_own_event_details(v_ids);
    BEGIN
        PERFORM 1 FROM scheduling.connected_event_details LIMIT 1;
    EXCEPTION WHEN insufficient_privilege THEN
        v_refused := true;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM pg_temp.check(v_visible >= 1, 'a published schedule still shows the time as taken');
    PERFORM pg_temp.check(v_stranger_rows = 0, 'and somebody else gets nothing from the door');
    PERFORM pg_temp.check(v_refused, 'or from the table');
    PERFORM pg_temp.check(
        NOT has_function_privilege('anon', 'scheduling.get_own_event_details(uuid[])', 'EXECUTE'),
        'and a visitor cannot call it');

    UPDATE integrations.connection_sync_state SET claimed_at = v_at WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(
        v_conn, 'calendar:primary', v_at, false,
        jsonb_build_array(jsonb_build_object(
            'id', 'named', 'title', 'Pay review', 'series_id', 'series-1',
            'starts_at', v_start, 'ends_at', v_start + interval '1 hour')),
        '{}', 'cursor-2');
    SELECT * INTO d FROM scheduling.connected_event_details WHERE event_id = v_named;
    PERFORM pg_temp.check(
        d.title = 'Pay review' AND d.location IS NULL,
        'a change at the provider arrives with the same times');
    PERFORM pg_temp.check(d.recurrence_rule = 'FREQ=DAILY', 'and a read that could not get the rule keeps it');

    UPDATE integrations.connection_sync_state SET claimed_at = v_at WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(
        v_conn, 'calendar:primary', v_at, false, '[]', ARRAY['named'], 'cursor-3');
    PERFORM pg_temp.check(
        (SELECT archived_at IS NOT NULL FROM scheduling.events WHERE id = v_named)
        AND NOT EXISTS (SELECT 1 FROM scheduling.connected_event_details WHERE event_id = v_named),
        'an entry gone from the provider takes its details with it');

    UPDATE integrations.connection_sync_state SET claimed_at = v_at WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(
        v_conn, 'calendar:primary', v_at, false,
        jsonb_build_array(jsonb_build_object('id', 'named', 'title', 'Pay review', 'starts_at', v_start, 'ends_at', v_start + interval '1 hour')),
        '{}', 'cursor-4');
    PERFORM pg_temp.check(
        (SELECT archived_at IS NULL FROM scheduling.events WHERE id = v_named)
        AND EXISTS (SELECT 1 FROM scheduling.connected_event_details WHERE event_id = v_named AND title = 'Pay review'),
        'and one that comes back brings them');

    UPDATE integrations.connection_sync_state SET claimed_at = v_at WHERE connection_id = v_conn;
    PERFORM integrations.fn_apply_busy_sync(
        v_conn, 'calendar:primary', v_at, true,
        jsonb_build_array(jsonb_build_object('id', 'long', 'title', 'Kept', 'starts_at', v_start + interval '4 hours', 'ends_at', v_start + interval '5 hours')),
        '{}', 'cursor-5');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.connected_event_details WHERE event_id = v_named),
        'a full read that no longer sees an entry clears it too');

    PERFORM pg_temp.connect(v_owner, 'probe-details', ARRAY['calendar']::integrations.provider_kind[], v_conn);
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.connected_event_details dd
                      JOIN scheduling.events e ON e.id = dd.event_id WHERE e.source_connection_id = v_conn),
        'a consent that stops reading clears the rest');

    PERFORM integrations.fn_apply_busy_sync(
        v_other_conn, 'calendar:primary', v_at, true,
        jsonb_build_array(jsonb_build_object('id', 'kept', 'title', 'Dentist', 'starts_at', v_start, 'ends_at', v_start + interval '1 hour')),
        '{}', 'cursor-1');
    PERFORM integrations.fn_revoke_connection(v_other_conn);
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM scheduling.connected_event_details dd
                      JOIN scheduling.events e ON e.id = dd.event_id WHERE e.source_connection_id = v_other_conn),
        'disconnecting clears everything it held');
END $$;
-- #endregion

ROLLBACK;
