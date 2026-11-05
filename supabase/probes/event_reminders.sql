-- Probe: a calendar entry's alerts (Decision #388). The producer, its tiers, and who may touch them.
--
--   1  tiers       an entry's row beats the person's default, which beats the platform's
--   2  malformed   a row written straight through PostgREST is skipped, never fails the sweep
--   3  producer    one queue row per person per alert, on the channel's type, at its lead
--   4  repeat      a second sweep adds nothing; a sent alert does not go twice
--   5  moved       a moved entry withdraws its row and alerts again at the new time
--   6  late        an alert past its moment still goes, once; a started entry's does not
--   7  eligibility a connected calendar's row and a sitting's mirror queue nothing
--   8  rls         a person reads and writes their own row, nobody else's
--
-- Run: docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/event_reminders.sql
\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.ok(p boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
END;
$$;

DO $probe$
DECLARE
    v_host uuid;
    v_guest uuid;
    v_schedule uuid;
    v_event uuid;
    v_connected uuid;
    v_connection uuid;
    v_now timestamptz := pg_catalog.now();
    v_n integer;
BEGIN
    -- Seeded people: a queued row keys on `org.users_public`, and no ids are hard-coded.
    SELECT (array_agg(p.user_id))[1], (array_agg(p.user_id))[2] INTO v_host, v_guest
      FROM (SELECT user_id FROM org.users_public ORDER BY user_id LIMIT 2) p;
    PERFORM pg_temp.ok(v_guest IS NOT NULL, 'the seed has two people');

    SELECT id INTO v_schedule FROM scheduling.schedules
     WHERE owner_type = 'user' AND owner_id = v_host;
    IF v_schedule IS NULL THEN
        INSERT INTO scheduling.schedules (owner_type, owner_id) VALUES ('user', v_host)
        RETURNING id INTO v_schedule;
    END IF;

    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'Probe review', v_now + interval '20 minutes',
            v_now + interval '50 minutes', v_host)
    RETURNING id INTO v_event;

    -- #region 1. Tiers
    PERFORM pg_temp.ok(
        (SELECT count(*) = 1 AND min(a.minutes) = 10 AND min(a.channel) = 'in_app'
           FROM scheduling.fn_event_alerts(v_event, v_host) a),
        'a person who set nothing gets the platform default');

    UPDATE org.user_preferences
       SET ui_settings = ui_settings || '{"calendar_reminders":[{"minutes":30,"channel":"email"}]}'
     WHERE user_id = v_host;
    INSERT INTO org.user_preferences (user_id, ui_settings)
    SELECT v_host, '{"calendar_reminders":[{"minutes":30,"channel":"email"}]}'
     WHERE NOT EXISTS (SELECT 1 FROM org.user_preferences WHERE user_id = v_host);
    PERFORM pg_temp.ok(
        (SELECT count(*) = 1 AND min(a.minutes) = 30 FROM scheduling.fn_event_alerts(v_event, v_host) a),
        'their default beats the platform''s');

    INSERT INTO scheduling.event_reminders (event_id, user_id, reminders) VALUES (v_event, v_host,
        '[{"minutes":10,"channel":"in_app"},{"minutes":15,"channel":"email"}]');
    PERFORM pg_temp.ok(
        (SELECT count(*) = 2 FROM scheduling.fn_event_alerts(v_event, v_host) a),
        'the entry''s own list beats their default');

    UPDATE scheduling.event_reminders SET reminders = '[]'
     WHERE event_id = v_event AND user_id = v_host;
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM scheduling.fn_event_alerts(v_event, v_host)),
        'an empty list is an answer: no alerts, not the default');
    -- #endregion

    -- #region 2. Malformed
    PERFORM pg_temp.ok(
        (SELECT count(*) = 1 FROM scheduling.fn_reminder_rows(
            '[{"minutes":"ten","channel":"email"},{"minutes":60,"channel":"sms"},7,null,
              {"minutes":99999,"channel":"email"},{"minutes":-5,"channel":"email"},
              {"minutes":5,"channel":"email"}]')),
        'only the one well-formed element survives');
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM scheduling.fn_reminder_rows('{"minutes":5}'))
        AND NOT EXISTS (SELECT 1 FROM scheduling.fn_reminder_rows('null')),
        'a value that is not a list is no alerts, not an error');
    PERFORM pg_temp.ok(
        (SELECT count(*) = 5 FROM scheduling.fn_reminder_rows(
            '[{"minutes":1,"channel":"email"},{"minutes":2,"channel":"email"},
              {"minutes":3,"channel":"email"},{"minutes":4,"channel":"email"},
              {"minutes":5,"channel":"email"},{"minutes":6,"channel":"email"}]')),
        'an over-long list stops at the cap');
    -- #endregion

    -- #region 3. Producer
    UPDATE scheduling.event_reminders
       SET reminders = '[{"minutes":10,"channel":"in_app"},{"minutes":15,"channel":"email"}]'
     WHERE event_id = v_event AND user_id = v_host;
    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.ok(
        (SELECT count(*) = 2 FROM comms.notification_queue q
          WHERE q.entity_id = v_event AND q.status = 'scheduled'),
        'one row per alert');
    PERFORM pg_temp.ok(
        (SELECT q.type = 'event.reminder' AND q.scheduled_for = e.starts_at - interval '10 minutes'
            AND q.body = 'In 10 minutes' AND q.title = 'Probe review'
           FROM comms.notification_queue q JOIN scheduling.events e ON e.id = q.entity_id
          WHERE q.entity_id = v_event AND q.payload ->> 'channel' = 'in_app'),
        'an in-app alert lands on its type, at its lead, in words');
    PERFORM pg_temp.ok(
        (SELECT q.type = 'event.reminder_email' FROM comms.notification_queue q
          WHERE q.entity_id = v_event AND q.payload ->> 'channel' = 'email'),
        'an email alert has its own type, so its channels stay on the catalog');
    -- #endregion

    -- #region 4. Repeat
    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.ok(
        (SELECT count(*) = 2 FROM comms.notification_queue q WHERE q.entity_id = v_event),
        'a second sweep adds nothing');
    -- #endregion

    -- #region 5. Moved
    UPDATE scheduling.events
       SET starts_at = v_now + interval '21 minutes', ends_at = v_now + interval '51 minutes'
     WHERE id = v_event;
    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.ok(
        (SELECT count(*) = 2 FROM comms.notification_queue q
          WHERE q.entity_id = v_event AND q.status = 'cancelled'),
        'a move withdraws what was promised for the old time');
    PERFORM pg_temp.ok(
        (SELECT count(*) = 2 FROM comms.notification_queue q
          WHERE q.entity_id = v_event AND q.status = 'scheduled'
            AND (q.payload ->> 'starts_at')::timestamptz = v_now + interval '21 minutes'),
        'and queues it at the new one');

    UPDATE scheduling.event_reminders SET reminders = '[{"minutes":10,"channel":"in_app"}]'
     WHERE event_id = v_event AND user_id = v_host;
    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.ok(
        (SELECT count(*) = 1 FROM comms.notification_queue q
          WHERE q.entity_id = v_event AND q.status = 'scheduled'),
        'an alert taken off the list is withdrawn');
    -- #endregion

    -- #region 6. Late
    DELETE FROM comms.notification_queue WHERE entity_id = v_event;
    UPDATE scheduling.events
       SET starts_at = v_now + interval '4 minutes', ends_at = v_now + interval '34 minutes'
     WHERE id = v_event;
    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.ok(
        (SELECT count(*) = 1 AND min(q.scheduled_for) <= pg_catalog.now()
            AND min(q.body) = 'In 4 minutes'
           FROM comms.notification_queue q WHERE q.entity_id = v_event AND q.status = 'scheduled'),
        'an entry made inside its own lead still alerts, and says how long is really left');

    UPDATE comms.notification_queue SET status = 'sent' WHERE entity_id = v_event;
    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.ok(
        (SELECT count(*) = 1 FROM comms.notification_queue q WHERE q.entity_id = v_event),
        'an alert that went out does not go again');

    DELETE FROM comms.notification_queue WHERE entity_id = v_event;
    UPDATE scheduling.events
       SET starts_at = v_now - interval '6 minutes', ends_at = v_now + interval '24 minutes'
     WHERE id = v_event;
    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM comms.notification_queue q WHERE q.entity_id = v_event),
        'an entry past the sweep''s grace alerts nobody');
    -- #endregion

    -- #region 7. Eligibility
    INSERT INTO integrations.user_connections (user_id, provider_slug, status)
    VALUES (v_host, 'google', 'active') RETURNING id INTO v_connection;
    INSERT INTO scheduling.events
        (schedule_id, kind, title, starts_at, ends_at, created_by, source_connection_id)
    VALUES (v_schedule, 'sync', '', v_now + interval '20 minutes', v_now + interval '50 minutes',
            v_host, v_connection)
    RETURNING id INTO v_connected;
    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM comms.notification_queue q WHERE q.entity_id = v_connected),
        'a connected calendar''s row alerts through its provider, not here');

    UPDATE scheduling.events SET source_connection_id = NULL, status = 'cancelled'
     WHERE id = v_connected;
    PERFORM scheduling.fn_enqueue_due_reminders();
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM comms.notification_queue q WHERE q.entity_id = v_connected),
        'a cancelled entry alerts nobody');
    -- #endregion

    -- #region 8. RLS
    PERFORM pg_catalog.set_config('request.jwt.claims',
        pg_catalog.json_build_object('sub', v_guest, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM scheduling.event_reminders;
    PERFORM pg_temp.ok(v_n = 0, 'nobody reads another person''s alerts');
    BEGIN
        INSERT INTO scheduling.event_reminders (event_id, user_id, reminders)
        VALUES (v_event, v_guest, '[]');
        RAISE EXCEPTION 'PROBE FAIL: a stranger set alerts on an entry they are not on';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO scheduling.event_reminders (event_id, user_id, reminders)
        VALUES (v_event, v_host, '[]');
        RAISE EXCEPTION 'PROBE FAIL: someone wrote another person''s alerts';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;

    PERFORM pg_catalog.set_config('request.jwt.claims',
        pg_catalog.json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM scheduling.event_reminders WHERE event_id = v_event;
    PERFORM pg_temp.ok(v_n = 1, 'a person reads their own');
    UPDATE scheduling.event_reminders SET reminders = '[]' WHERE event_id = v_event;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM pg_temp.ok(v_n = 1, 'and writes it');
    RESET ROLE;
    -- #endregion
END;
$probe$;

ROLLBACK;
