-- Probe: routines and availability behaviour (Decision #389).
--
--   1  gate        a passive entry frees its slot in fn_slot_is_free, get_free_busy and the presence
--                  check, a disruptive one does not, and the two readers agree on both
--   2  guard       a commitment can never be passive, by any path, under any role
--   3  anchor      an entry joins a routine on its own schedule only, and never an engagement's meeting
--   4  series      a routine takes a whole series; an entry taken out keeps what it was doing
--   5  follow      a routine's behaviour moves the entries that agree with it, and only those
--   6  connected   an imported series joins whole, queues nothing outbound, keeps its routine through
--                  a re-read, and a new occurrence joins its siblings
--   7  mirror      a passive entry's copy goes out transparent, and the change re-queues it
--   8  rls         a visitor reads no routine; a stranger neither reads nor organises; nobody deletes one
--   9  slug        minted on insert, frozen on update
--
-- Run: docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/scheduling_routines.sql
\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.ok(p boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
END;
$$;

-- Raises unless `p_sql` is refused with `p_code`.
CREATE FUNCTION pg_temp.refused(p_sql text, p_code text, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_code THEN RETURN; END IF;
        RAISE EXCEPTION 'PROBE FAIL: % answered % (%), not %', p_what, SQLSTATE, SQLERRM, p_code;
    END;
    RAISE EXCEPTION 'PROBE FAIL: % was allowed', p_what;
END;
$$;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

DO $probe$
DECLARE
    v_host uuid;
    v_other uuid;
    v_schedule uuid;
    v_other_schedule uuid;
    v_routine uuid;
    v_loud uuid;
    v_foreign uuid;
    v_event uuid;
    v_master uuid;
    v_child uuid;
    v_session uuid;
    v_connection uuid;
    v_slug text;
    v_ids uuid[];
    v_at timestamptz := date_trunc('hour', pg_catalog.now()) + interval '10 days';
    v_n integer;
BEGIN
    SELECT (array_agg(p.user_id))[1], (array_agg(p.user_id))[2] INTO v_host, v_other
      FROM (SELECT user_id FROM org.users_public ORDER BY user_id LIMIT 2) p;
    PERFORM pg_temp.ok(v_other IS NOT NULL, 'the seed has two people');

    INSERT INTO scheduling.schedules (owner_type, owner_id) VALUES ('user', v_host)
    ON CONFLICT ON CONSTRAINT uq_schedule_owner DO UPDATE SET owner_id = EXCLUDED.owner_id
    RETURNING id INTO v_schedule;
    INSERT INTO scheduling.schedules (owner_type, owner_id) VALUES ('user', v_other)
    ON CONFLICT ON CONSTRAINT uq_schedule_owner DO UPDATE SET owner_id = EXCLUDED.owner_id
    RETURNING id INTO v_other_schedule;
    UPDATE scheduling.schedules SET is_published = true WHERE id = v_schedule;

    INSERT INTO scheduling.routines (schedule_id, name) VALUES (v_schedule, 'Gym')
    RETURNING id, slug INTO v_routine, v_slug;
    INSERT INTO scheduling.routines (schedule_id, name, behavior) VALUES (v_schedule, 'Deep work', 'disruptive')
    RETURNING id INTO v_loud;
    INSERT INTO scheduling.routines (schedule_id, name) VALUES (v_other_schedule, 'Not yours')
    RETURNING id INTO v_foreign;

    -- 9 ------------------------------------------------------------------------------------------
    PERFORM pg_temp.ok(v_slug ~ '^rtn-[23456789abcdefghjkmnopqrstuvwxyz]{10}$', 'a routine mints an rtn- slug');
    PERFORM pg_temp.refused(
        format('UPDATE scheduling.routines SET slug = %L WHERE id = %L', 'rtn-2222222222', v_routine),
        '23514', 'moving a routine''s slug');

    -- 1 ------------------------------------------------------------------------------------------
    -- A row in the middle of the window, so the spans and the predicate have one thing to say.
    INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'confirmed', 'Gym', v_at, v_at + interval '1 hour', v_host)
    RETURNING id INTO v_event;

    PERFORM pg_temp.ok(
        scheduling.fn_has_conflicting_event(v_schedule, v_at, v_at + interval '30 minutes'),
        'a disruptive entry conflicts');
    PERFORM pg_temp.ok(
        NOT scheduling.fn_slot_is_free(v_schedule, v_at, v_at + interval '30 minutes'),
        'a disruptive entry takes the slot');
    PERFORM pg_temp.as_user(v_host);
    SELECT count(*) INTO v_n FROM scheduling.get_free_busy(v_schedule, v_at - interval '1 day', v_at + interval '1 day');
    PERFORM pg_temp.ok(v_n = 1, 'a disruptive entry is a busy span');

    UPDATE scheduling.events SET availability_behavior = 'passive' WHERE id = v_event;
    PERFORM pg_temp.ok(
        NOT scheduling.fn_has_conflicting_event(v_schedule, v_at, v_at + interval '30 minutes'),
        'a passive entry does not conflict');
    PERFORM pg_temp.ok(
        scheduling.fn_slot_is_free(v_schedule, v_at, v_at + interval '30 minutes'),
        'a passive entry leaves the slot free');
    SELECT count(*) INTO v_n FROM scheduling.get_free_busy(v_schedule, v_at - interval '1 day', v_at + interval '1 day');
    PERFORM pg_temp.ok(v_n = 0, 'a passive entry is no busy span, so the grid agrees with the gate');

    -- 2 ------------------------------------------------------------------------------------------
    PERFORM pg_temp.refused(
        format($sql$INSERT INTO scheduling.events (schedule_id, kind, starts_at, ends_at, availability_behavior)
                    VALUES (%L, 'session', now(), now(), 'passive')$sql$, v_schedule),
        '55000', 'a passive session');
    PERFORM pg_temp.refused(
        format($sql$INSERT INTO scheduling.events (schedule_id, kind, starts_at, ends_at, availability_behavior)
                    VALUES (%L, 'booking', now(), now(), 'passive')$sql$, v_schedule),
        '55000', 'a passive booking');
    PERFORM pg_temp.refused(
        format($sql$UPDATE scheduling.events SET kind = 'session' WHERE id = %L$sql$, v_event),
        '55000', 'turning a passive entry into a session');

    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'sync', 'With people', v_at, v_at + interval '1 hour', v_host)
    RETURNING id INTO v_session;
    INSERT INTO scheduling.event_attendees (event_id, user_id, role, response)
    VALUES (v_session, v_other, 'participant', 'accepted');
    PERFORM pg_temp.refused(
        format($sql$UPDATE scheduling.events SET availability_behavior = 'passive' WHERE id = %L$sql$, v_session),
        '55000', 'a rostered entry going passive');
    PERFORM pg_temp.refused(
        format($sql$SELECT scheduling.organise_event(%L, '{"availability_behavior":"passive"}'::jsonb)$sql$, v_session),
        '55000', 'the door making a rostered entry passive');

    -- Seating somebody makes an entry a commitment, whichever door the seat came through.
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by, availability_behavior)
    VALUES (v_schedule, 'sync', 'Open', v_at, v_at + interval '1 hour', v_host, 'passive')
    RETURNING id INTO v_child;
    INSERT INTO scheduling.event_attendees (event_id, user_id, role, response)
    VALUES (v_child, v_other, 'participant', 'pending');
    PERFORM pg_temp.ok(
        (SELECT availability_behavior = 'disruptive' FROM scheduling.events WHERE id = v_child),
        'a seat on a passive entry takes its time back');

    -- A commitment may still sit in a passive routine: it only keeps holding its time.
    PERFORM scheduling.organise_event(v_session, jsonb_build_object('routine_id', v_routine));
    PERFORM pg_temp.ok(
        (SELECT routine_id = v_routine AND availability_behavior = 'disruptive'
           FROM scheduling.events WHERE id = v_session),
        'a commitment joins a passive routine and stays disruptive');
    PERFORM scheduling.organise_event(v_session, jsonb_build_object('routine_id', NULL));

    -- 3 ------------------------------------------------------------------------------------------
    PERFORM pg_temp.refused(
        format($sql$UPDATE scheduling.events SET routine_id = %L WHERE id = %L$sql$, v_foreign, v_event),
        '23503', 'naming a routine on another schedule');
    PERFORM pg_temp.refused(
        format($sql$SELECT scheduling.organise_event(%L, jsonb_build_object('routine_id', %L::uuid))$sql$, v_event, v_foreign),
        '55000', 'the door taking a routine on another schedule');
    PERFORM pg_temp.refused(
        format($sql$UPDATE scheduling.events SET routine_id = %L, project_id = (SELECT id FROM projects.projects LIMIT 1) WHERE id = %L$sql$, v_routine, v_session),
        '23514', 'an engagement''s meeting in a routine');

    -- 4 ------------------------------------------------------------------------------------------
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, recurrence_rule, created_by)
    VALUES (v_schedule, 'sync', 'Series', v_at, v_at + interval '1 hour', 'FREQ=DAILY', v_host)
    RETURNING id INTO v_master;
    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, recurrence_parent_id, created_by)
    VALUES (v_schedule, 'sync', 'Series', v_at + interval '1 day', v_at + interval '25 hours', v_master, v_host)
    RETURNING id INTO v_child;

    -- From an occurrence: the master moves with it, and takes the routine's behaviour.
    v_ids := scheduling.organise_event(v_child, jsonb_build_object('routine_id', v_routine));
    PERFORM pg_temp.ok(cardinality(v_ids) = 2, 'the door answers both rows of the series');
    PERFORM pg_temp.ok(
        (SELECT bool_and(routine_id = v_routine AND availability_behavior = 'passive')
           FROM scheduling.events WHERE id IN (v_master, v_child)),
        'a whole series joins, and takes the routine''s behaviour');

    -- Saying again what is already so writes nothing, so a save cannot queue a provider write.
    v_ids := scheduling.organise_event(v_child, jsonb_build_object('routine_id', v_routine, 'availability_behavior', 'passive'));
    PERFORM pg_temp.ok(cardinality(v_ids) = 0, 'a no-op organise writes no row');

    v_ids := scheduling.organise_event(v_master, jsonb_build_object('routine_id', NULL));
    PERFORM pg_temp.ok(
        (SELECT bool_and(routine_id IS NULL AND availability_behavior = 'passive')
           FROM scheduling.events WHERE id IN (v_master, v_child)),
        'leaving a routine keeps what the entry was doing');

    -- An archived routine takes nobody new, and keeps who it has: a save saying so is no join.
    PERFORM scheduling.organise_event(v_master, jsonb_build_object('routine_id', v_loud));
    UPDATE scheduling.routines SET is_active = false WHERE id = v_loud;
    PERFORM pg_temp.refused(
        format($sql$SELECT scheduling.organise_event(%L, jsonb_build_object('routine_id', %L::uuid))$sql$, v_event, v_loud),
        '55000', 'joining an archived routine');
    v_ids := scheduling.organise_event(v_master, jsonb_build_object('routine_id', v_loud, 'availability_behavior', 'disruptive'));
    PERFORM pg_temp.ok(cardinality(v_ids) = 0, 'an entry saves in the archived routine it is in');
    UPDATE scheduling.routines SET is_active = true WHERE id = v_loud;
    PERFORM scheduling.organise_event(v_master, jsonb_build_object('routine_id', NULL));

    -- 5 ------------------------------------------------------------------------------------------
    PERFORM scheduling.organise_event(v_master, jsonb_build_object('routine_id', v_routine));
    PERFORM scheduling.organise_event(v_event, jsonb_build_object('routine_id', v_routine));
    -- One entry the host set apart.
    PERFORM scheduling.organise_event(v_event, jsonb_build_object('availability_behavior', 'disruptive'));
    PERFORM scheduling.organise_event(v_session, jsonb_build_object('routine_id', v_routine));

    UPDATE scheduling.routines SET behavior = 'disruptive' WHERE id = v_routine;
    PERFORM pg_temp.ok(
        (SELECT bool_and(availability_behavior = 'disruptive') FROM scheduling.events WHERE id IN (v_master, v_child)),
        'the entries that agreed follow the routine');

    UPDATE scheduling.routines SET behavior = 'passive' WHERE id = v_routine;
    PERFORM pg_temp.ok(
        (SELECT availability_behavior = 'disruptive' FROM scheduling.events WHERE id = v_session),
        'a commitment does not follow a routine into passive');

    PERFORM scheduling.organise_event(v_session, jsonb_build_object('routine_id', NULL));
    PERFORM scheduling.organise_event(v_event, jsonb_build_object('routine_id', NULL));

    -- 6 ------------------------------------------------------------------------------------------
    INSERT INTO integrations.user_connections (user_id, provider_slug, external_account_id, status, granted_kinds, sync_direction)
    VALUES (v_host, 'google', 'probe-routines', 'active', '{calendar,freebusy}', 'bidirectional')
    RETURNING id INTO v_connection;
    INSERT INTO integrations.connection_sync_state (connection_id, kind, resource, claimed_at)
    VALUES (v_connection, 'freebusy', 'primary', v_at);

    PERFORM integrations.fn_apply_busy_sync(v_connection, 'primary', v_at, false,
        jsonb_build_array(
            jsonb_build_object('id', 'occ-1', 'starts_at', v_at + interval '2 days', 'ends_at', v_at + interval '49 hours', 'title', 'Yoga', 'series_id', 'yoga'),
            jsonb_build_object('id', 'occ-2', 'starts_at', v_at + interval '9 days', 'ends_at', v_at + interval '217 hours', 'title', 'Yoga', 'series_id', 'yoga'),
            jsonb_build_object('id', 'lone', 'starts_at', v_at + interval '3 days', 'ends_at', v_at + interval '73 hours', 'title', 'Dentist')
        ), '{}', 'cursor-1');

    SELECT id INTO v_event FROM scheduling.events WHERE source_connection_id = v_connection AND external_event_id = 'occ-1';
    PERFORM pg_temp.as_user(v_host);
    v_ids := scheduling.organise_event(v_event, jsonb_build_object('routine_id', v_routine));
    PERFORM pg_temp.ok(cardinality(v_ids) = 2, 'an imported series joins whole, through its provider''s series id');
    PERFORM pg_temp.ok(
        (SELECT routine_id IS NULL FROM scheduling.events WHERE source_connection_id = v_connection AND external_event_id = 'lone'),
        'an entry outside the series stays out');
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM scheduling.event_mirrors m WHERE m.event_id = ANY (v_ids)),
        'organising an imported entry writes nothing to its provider');

    UPDATE integrations.connection_sync_state SET claimed_at = v_at + interval '1 minute'
     WHERE connection_id = v_connection;
    PERFORM integrations.fn_apply_busy_sync(v_connection, 'primary', v_at + interval '1 minute', false,
        jsonb_build_array(
            -- The same occurrence, moved an hour: the routine survives the read.
            jsonb_build_object('id', 'occ-1', 'starts_at', v_at + interval '49 hours', 'ends_at', v_at + interval '50 hours', 'title', 'Yoga', 'series_id', 'yoga'),
            -- The provider rolled the series forward.
            jsonb_build_object('id', 'occ-3', 'starts_at', v_at + interval '16 days', 'ends_at', v_at + interval '385 hours', 'title', 'Yoga', 'series_id', 'yoga')
        ), '{}', 'cursor-2');
    PERFORM pg_temp.ok(
        (SELECT bool_and(routine_id = v_routine AND availability_behavior = 'passive')
           FROM scheduling.events WHERE source_connection_id = v_connection AND external_event_id IN ('occ-1', 'occ-3')),
        'a re-read keeps the routine, and a new occurrence joins its siblings');

    -- 7 ------------------------------------------------------------------------------------------
    INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at, created_by, availability_behavior)
    VALUES (v_schedule, 'sync', 'confirmed', 'Goes out', v_at, v_at + interval '1 hour', v_host, 'passive')
    RETURNING id INTO v_event;
    UPDATE scheduling.event_mirrors SET dirty_at = NULL WHERE event_id = v_event;
    PERFORM pg_temp.ok(FOUND, 'a new entry is queued on the connection');

    UPDATE scheduling.events SET availability_behavior = 'disruptive' WHERE id = v_event;
    PERFORM pg_temp.ok(
        (SELECT bool_and(dirty_at IS NOT NULL) FROM scheduling.event_mirrors WHERE event_id = v_event),
        'changing behaviour re-queues the copy');
    UPDATE scheduling.events SET availability_behavior = 'passive' WHERE id = v_event;

    UPDATE scheduling.event_mirrors SET dirty_at = NULL WHERE event_id IS DISTINCT FROM v_event;
    UPDATE scheduling.event_mirrors SET dirty_at = pg_catalog.now() - interval '1 minute' WHERE event_id = v_event;
    PERFORM pg_temp.ok(
        (SELECT bool_and((c.value #>> '{event,transparent}')::boolean)
           FROM jsonb_array_elements(scheduling.claim_event_mirrors(500)) c
          WHERE c.value -> 'event' IS NOT NULL AND c.value -> 'event' <> 'null'::jsonb),
        'the claim says a passive entry''s copy is transparent');

    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('probe.host', v_host::text, true);
    PERFORM set_config('probe.other', v_other::text, true);
    PERFORM set_config('probe.routine', v_routine::text, true);
    PERFORM set_config('probe.event', v_child::text, true);
    PERFORM set_config('probe.schedule', v_schedule::text, true);
END;
$probe$;

-- 8 ----------------------------------------------------------------------------------------------
-- A published schedule shows a visitor that a time is taken: never what a person calls it.
SET LOCAL ROLE anon;
DO $probe$
BEGIN
    PERFORM pg_temp.refused('SELECT 1 FROM scheduling.routines', '42501', 'a visitor reading routines');
END;
$probe$;
RESET ROLE;

SELECT pg_temp.as_user(current_setting('probe.other')::uuid);
SET LOCAL ROLE authenticated;
DO $probe$
DECLARE
    v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM scheduling.routines WHERE schedule_id = current_setting('probe.schedule')::uuid;
    PERFORM pg_temp.ok(v_n = 0, 'a stranger reads nobody else''s routines');
    PERFORM pg_temp.refused(
        format($sql$SELECT scheduling.organise_event(%L, '{"routine_id":null}'::jsonb)$sql$, current_setting('probe.event')),
        '42501', 'a stranger organising an entry');
END;
$probe$;
RESET ROLE;

SELECT pg_temp.as_user(current_setting('probe.host')::uuid);
SET LOCAL ROLE authenticated;
DO $probe$
DECLARE
    v_routine uuid := current_setting('probe.routine')::uuid;
    v_id uuid;
    v_ids uuid[];
BEGIN
    -- The owner's own path, under RLS and the column grants, cascade included.
    INSERT INTO scheduling.routines (schedule_id, name, behavior, recurrence_rule)
    VALUES (current_setting('probe.schedule')::uuid, 'Language study', 'disruptive', 'FREQ=WEEKLY;BYDAY=MO,WE')
    RETURNING id INTO v_id;
    PERFORM pg_temp.ok(v_id IS NOT NULL, 'the owner creates a routine');
    UPDATE scheduling.routines SET name = 'Spanish', behavior = 'passive' WHERE id = v_id;
    UPDATE scheduling.routines SET behavior = 'disruptive' WHERE id = v_routine;
    v_ids := scheduling.organise_event(current_setting('probe.event')::uuid, jsonb_build_object('routine_id', v_id));
    PERFORM pg_temp.ok(cardinality(v_ids) = 2, 'the owner organises under their own role');
    PERFORM pg_temp.refused(
        format($sql$UPDATE scheduling.routines SET metadata = '{"x":1}' WHERE id = %L$sql$, v_id),
        '42501', 'a client writing metadata');
    PERFORM pg_temp.refused(
        format($sql$UPDATE scheduling.routines SET schedule_id = gen_random_uuid() WHERE id = %L$sql$, v_id),
        '42501', 'a client moving a routine to another schedule');
    PERFORM pg_temp.refused(
        format($sql$DELETE FROM scheduling.routines WHERE id = %L$sql$, v_id),
        '42501', 'deleting a routine rather than archiving it');
END;
$probe$;
RESET ROLE;

ROLLBACK;

\echo 'PASS scheduling_routines'
