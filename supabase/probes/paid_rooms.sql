-- =============================================================================================
-- Probe: a copied provider link opens no paid sitting, and a host no-show still refunds behind a
-- knock (Decision #392, which amends Decision #383, ruling R5, for paid sittings).
--
--   1  the mint queue says which rooms are paid, sittings yes, entries and free calls no, and carries
--      the connection's scopes; a paid call would read paid, though none can be booked yet
--   2  attach keeps what the provider confirmed, and a manual link is never guarded
--   3  the door: a room that approves its own people approves at the press, never falls back on its
--      plain link, and records the press; a stranger and a non-payer still get nothing
--   4  the refund path on Meet, Teams and Zoom: kept outside, no room record, one join_click. It holds
--      until the provider's record is read, then refunds through the sweep
--   5  a Zoom Basic host: the read is refused, so nothing refunds on its own. The money holds, the
--      attendee is asked, and a no reaches a person. This is the known limit, pinned so it stays seen
--   6  a host who keeps somebody out does not collect: held, not released. Only where the host decides
--      who comes in, because an attendee who could have walked in has no such excuse. It reads what
--      the room is, so a provider's unconfirmed answer cannot switch it off
--   7  fn_room_unmatched: who was in the room with no seat, on one-seat rooms too; a knock, a click and
--      a repeat are not people; the provider's record replaces the webhooks
--   8  an operator reads that on a case, and a party does not
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/paid_rooms.sql
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. No provider is called:
-- this proves what Projective does with an answer, not what a live account answers.
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
DECLARE v_project uuid; v_stage uuid; v_host uuid; v_a uuid; v_b uuid; v_op uuid; v_schedule uuid;
BEGIN
    SELECT p.id, s.id, p.owner_user_id INTO v_project, v_stage, v_host
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id IS NOT NULL AND p.owner_team_id IS NULL
     ORDER BY p.id, s.id LIMIT 1;
    SELECT u.user_id INTO v_a FROM org.users_public u
     WHERE u.user_id <> v_host AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_b FROM org.users_public u
     WHERE u.user_id NOT IN (v_host, v_a) AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_op FROM org.users_public u
     WHERE u.user_id NOT IN (v_host, v_a, v_b) ORDER BY u.user_id LIMIT 1;
    INSERT INTO ops.admin_users (user_id) VALUES (v_op) ON CONFLICT DO NOTHING;
    SELECT sc.id INTO v_schedule FROM scheduling.schedules sc
     WHERE scheduling.fn_schedule_host(sc.id) IS NOT NULL ORDER BY sc.id LIMIT 1;
    PERFORM set_config('probe.project', v_project::text, true);
    PERFORM set_config('probe.stage', v_stage::text, true);
    PERFORM set_config('probe.host', v_host::text, true);
    PERFORM set_config('probe.a', v_a::text, true);
    PERFORM set_config('probe.b', v_b::text, true);
    PERFORM set_config('probe.op', v_op::text, true);
    PERFORM set_config('probe.schedule', v_schedule::text, true);
END $$;

-- A one-hour sitting ending p_ago from now (negative: it ends in the future), with a minted room and an
-- escrow held for the attendee. The room's shape is set directly: attach_room is pinned in region 2.
CREATE FUNCTION pg_temp.sitting(
    p_tag text, p_provider text, p_ago interval, p_guarded boolean, p_registration boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_cohort uuid; v_member uuid; v_event uuid;
BEGIN
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid, 'Probe ' || p_tag)
    RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_a) RETURNING id INTO v_member;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, status, meeting_provider,
                                         provider_meeting_id, attendee_join_url)
    VALUES (v_cohort, 'Probe ' || p_tag, now() - p_ago - interval '1 hour', now() - p_ago, 'scheduled', p_provider,
            'paid-' || p_tag, 'https://rooms.example.test/plain-' || p_tag)
    RETURNING id INTO v_event;
    INSERT INTO finance.escrows (project_stage_id, cohort_membership_id, session_event_id, payer_user_id,
                                 payee_type, payee_id, amount_cents, currency, status)
    VALUES (current_setting('probe.stage')::uuid, v_member, v_event, v_a, 'freelancer',
            current_setting('probe.host')::uuid, 10000, 'GBP', 'held');
    UPDATE scheduling.rooms
       SET provider_host_id = 'host-account', guarded = p_guarded, registration = p_registration
     WHERE session_event_id = v_event;
    RETURN v_event;
END $$;

CREATE FUNCTION pg_temp.room(p_event uuid) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM scheduling.rooms WHERE session_event_id = p_event;
$$;

CREATE FUNCTION pg_temp.outcome(p_event uuid) RETURNS text LANGUAGE sql AS $$
    SELECT projects.fn_session_presence(p_event) ->> 'outcome';
$$;

CREATE FUNCTION pg_temp.escrow_status(p_event uuid) RETURNS text LANGUAGE sql AS $$
    SELECT status::text FROM finance.escrows WHERE session_event_id = p_event;
$$;

CREATE FUNCTION pg_temp.sweep() RETURNS jsonb LANGUAGE sql AS $$
    SELECT finance.auto_release_session_escrow(now());
$$;

-- The attendee's press of join, p_minutes after the start. room_join refuses a sitting that has ended,
-- so past presses are written as it writes them. Region 3 pins the door itself.
CREATE FUNCTION pg_temp.press(p_event uuid, p_minutes integer DEFAULT 2) RETURNS void LANGUAGE sql AS $$
    INSERT INTO scheduling.presence_events (room_id, idempotency_key, action, occurred_at, source, matched_by,
                                            user_id, participant_key)
    SELECT r.id, 'click:' || p_minutes, 'join_click', e.start_time + make_interval(mins => p_minutes), 'platform',
           'session', current_setting('probe.a')::uuid, current_setting('probe.a')
      FROM scheduling.rooms r
      JOIN projects.session_events e ON e.id = r.session_event_id
     WHERE r.session_event_id = p_event;
$$;

-- The provider's own record read back, as the reconcile sweep does: as the service role, and stamped
-- only when p_error is NULL.
CREATE FUNCTION pg_temp.read_back(p_event uuid, p_error text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_room uuid := pg_temp.room(p_event);
BEGIN
    PERFORM set_config('role', 'service_role', true);
    PERFORM scheduling.room_reconciled(v_room, p_error);
    PERFORM set_config('role', 'postgres', true);
END $$;

-- One event from the room, the way a provider's report reaches the door.
CREATE FUNCTION pg_temp.ev(
    p_tag text, p_provider text, p_action text, p_minutes numeric, p_key text,
    p_registrant text DEFAULT NULL, p_account text DEFAULT NULL, p_source text DEFAULT 'webhook'
) RETURNS jsonb LANGUAGE sql AS $$
    SELECT scheduling.record_presence(p_provider, 'paid-' || p_tag, p_action,
        (SELECT e.start_time + make_interval(secs => p_minutes * 60)
           FROM projects.session_events e WHERE e.provider_meeting_id = 'paid-' || p_tag),
        p_source || ':' || p_action || ':' || p_key || ':' || p_minutes, p_key, NULL, p_registrant, p_account, p_source);
$$;

CREATE FUNCTION pg_temp.unmatched(p_event uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT scheduling.fn_room_unmatched(pg_temp.room(p_event));
$$;
-- #endregion

-- #region 1. The mint queue says which rooms are paid
DO $$
DECLARE
    v_host uuid := current_setting('probe.host')::uuid;
    v_a uuid := current_setting('probe.a')::uuid;
    v_schedule uuid := current_setting('probe.schedule')::uuid;
    v_cohort uuid;
    v_sitting uuid;
    v_entry uuid;
    v_free uuid;
    v_paid uuid;
    v_room_sitting uuid;
    v_room_entry uuid;
    v_room_free uuid;
    v_room_paid uuid;
    c record;
    r scheduling.rooms;
    f record;
BEGIN
    INSERT INTO integrations.user_connections (user_id, provider_slug, status, granted_kinds, granted_scopes)
    VALUES (v_host, 'zoom', 'active', ARRAY['conferencing']::integrations.provider_kind[],
            ARRAY['meeting:write:meeting', 'meeting:write:batch_registrants']);

    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid, 'Probe queue')
    RETURNING id INTO v_cohort;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, meeting_provider)
    VALUES (v_cohort, 'Probe queue', now() + interval '1 day', now() + interval '1 day 1 hour', 'zoom')
    RETURNING id INTO v_sitting;
    SELECT id INTO v_room_sitting FROM scheduling.rooms WHERE session_event_id = v_sitting;

    INSERT INTO scheduling.events (schedule_id, kind, title, starts_at, ends_at, created_by)
    VALUES (v_schedule, 'general', 'Probe entry', now() + interval '1 day', now() + interval '1 day 30 minutes',
            scheduling.fn_schedule_host(v_schedule))
    RETURNING id INTO v_entry;
    INSERT INTO scheduling.rooms (event_id, provider, status) VALUES (v_entry, 'zoom', 'pending')
    RETURNING id INTO v_room_entry;

    -- The request door refuses a paid call today (Decision #343, ruling C1), so these rows are placed
    -- directly. The facts must already read it right on the day that door opens.
    ALTER TABLE scheduling.discovery_calls DISABLE TRIGGER USER;
    INSERT INTO scheduling.discovery_calls (host_schedule_id, host_user_id, requester_user_id, call_type, status,
        proposed_start, proposed_end, confirmed_start, confirmed_end, provider_slug)
    VALUES (v_schedule, scheduling.fn_schedule_host(v_schedule), v_a, 'courtesy', 'confirmed',
        now() + interval '2 days', now() + interval '2 days 30 minutes',
        now() + interval '2 days', now() + interval '2 days 30 minutes', 'zoom')
    RETURNING id INTO v_free;
    INSERT INTO scheduling.discovery_calls (host_schedule_id, host_user_id, requester_user_id, call_type, status,
        proposed_start, proposed_end, confirmed_start, confirmed_end, provider_slug, fee_amount_minor, fee_currency)
    VALUES (v_schedule, scheduling.fn_schedule_host(v_schedule), v_a, 'paid', 'confirmed',
        now() + interval '3 days', now() + interval '3 days 30 minutes',
        now() + interval '3 days', now() + interval '3 days 30 minutes', 'zoom', 5000, 'GBP')
    RETURNING id INTO v_paid;
    ALTER TABLE scheduling.discovery_calls ENABLE TRIGGER USER;
    INSERT INTO scheduling.rooms (call_id, provider, status) VALUES (v_free, 'zoom', 'pending') RETURNING id INTO v_room_free;
    INSERT INTO scheduling.rooms (call_id, provider, status) VALUES (v_paid, 'zoom', 'pending') RETURNING id INTO v_room_paid;

    PERFORM set_config('role', 'service_role', true);
    FOR c IN SELECT * FROM scheduling.claim_rooms_to_mint(1000) LOOP
        CASE c.room_id
            WHEN v_room_sitting THEN
                PERFORM pg_temp.check(c.paid IS TRUE, '1 a sitting''s room is paid');
                IF c.host_user_id = v_host THEN
                    PERFORM pg_temp.check('meeting:write:batch_registrants' = ANY (c.granted_scopes),
                        '1 and the claim carries what the connection was granted');
                END IF;
            WHEN v_room_entry THEN
                PERFORM pg_temp.check(c.paid IS FALSE, '1 a calendar entry''s room is not');
            WHEN v_room_free THEN
                PERFORM pg_temp.check(c.paid IS FALSE, '1 a courtesy call''s room is not');
            WHEN v_room_paid THEN
                PERFORM pg_temp.check(c.paid IS TRUE, '1 a paid call''s room would be');
            ELSE
                NULL;
        END CASE;
    END LOOP;
    PERFORM set_config('role', 'postgres', true);

    PERFORM pg_temp.check((SELECT status = 'minting' FROM scheduling.rooms WHERE id = v_room_sitting),
        '1 and the sitting''s room was claimed');
    SELECT * INTO r FROM scheduling.rooms WHERE id = v_room_paid;
    f := scheduling.fn_room_facts(r);
    PERFORM pg_temp.check(f.o_paid IS TRUE AND f.o_title IS NOT NULL, '1 the facts name a paid call as paid');
    PERFORM set_config('probe.minting', v_room_sitting::text, true);
    PERFORM set_config('probe.minting_sitting', v_sitting::text, true);
END $$;
-- #endregion

-- #region 2. Attach, and a manual link
DO $$
DECLARE
    v_room uuid := current_setting('probe.minting')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v_event uuid;
BEGIN
    PERFORM set_config('role', 'service_role', true);
    PERFORM scheduling.attach_room(v_room, NULL, 'paid-attached', 'host-account', 'https://zoom.us/j/attached', NULL, true, true);
    PERFORM set_config('role', 'postgres', true);
    PERFORM pg_temp.check((SELECT guarded AND registration FROM scheduling.rooms WHERE id = v_room),
        '2 attach keeps what the provider confirmed');

    v_event := pg_temp.sitting('remint', 'zoom', interval '-2 hours', true, true);
    UPDATE scheduling.rooms SET status = 'minting' WHERE session_event_id = v_event RETURNING id INTO v_room;
    PERFORM scheduling.attach_room(v_room, NULL, 'paid-remint', 'host-account', 'https://zoom.us/j/remint', NULL);
    PERFORM pg_temp.check((SELECT NOT guarded AND NOT registration FROM scheduling.rooms WHERE id = v_room),
        '2 nothing stays guarded unless a provider says so again');

    v_event := pg_temp.sitting('manual', 'zoom', interval '-2 hours', true, true);
    PERFORM pg_temp.act(v_host);
    PERFORM projects.set_sitting_link(v_event, 'https://studio.example.test/room');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((SELECT provider = 'custom' AND NOT guarded AND NOT registration
        FROM scheduling.rooms WHERE session_event_id = v_event), '2 a manual link is never guarded');
END $$;
-- #endregion

-- #region 3. The door
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_b uuid := current_setting('probe.b')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v_schedule uuid := current_setting('probe.schedule')::uuid;
    v_free_host uuid;
    v_guest uuid;
    v_entry uuid;
    v_event uuid;
    v_slug text;
    j jsonb;
BEGIN
    v_event := pg_temp.sitting('door', 'zoom', interval '-55 minutes', true, true);
    SELECT slug INTO v_slug FROM scheduling.rooms WHERE session_event_id = v_event;

    PERFORM pg_temp.act(v_a);
    j := scheduling.room_join(v_slug);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(j ->> 'state' = 'open', '3 a funded seat gets in');
    PERFORM pg_temp.check((j -> 'register' ->> 'approve')::boolean, '3 and is approved at the press');
    PERFORM pg_temp.check((j ->> 'link_required')::boolean, '3 with no falling back on the plain link');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM scheduling.presence_events p
        WHERE p.room_id = pg_temp.room(v_event) AND p.user_id = v_a AND p.action = 'join_click'),
        '3 and the press is on record before any provider is asked');

    PERFORM pg_temp.act(v_host);
    j := scheduling.room_join(v_slug);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(j ->> 'role' = 'host' AND (j ->> 'link_required')::boolean AND j ->> 'register' IS NULL,
        '3 a host needs a fresh link too, and is never registered');

    PERFORM scheduling.save_room_registrant(pg_temp.room(v_event), v_a, 'reg-door', 'https://zoom.us/w/door');
    PERFORM pg_temp.act(v_a);
    j := scheduling.room_join(v_slug);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(j ->> 'url' = 'https://zoom.us/w/door' AND NOT (j ->> 'link_required')::boolean
        AND j ->> 'register' IS NULL, '3 somebody holding their own link just uses it');

    PERFORM pg_temp.act(v_b);
    j := scheduling.room_join(v_slug);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(j ->> 'state' = 'not_party' AND j ->> 'url' IS NULL, '3 a stranger gets nothing');

    UPDATE finance.escrows SET status = 'refunded' WHERE session_event_id = v_event;
    DELETE FROM scheduling.room_registrants WHERE room_id = pg_temp.room(v_event);
    PERFORM pg_temp.act(v_a);
    j := scheduling.room_join(v_slug);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(j ->> 'state' = 'unfunded' AND j ->> 'url' IS NULL AND j ->> 'register' IS NULL,
        '3 nor does a seat nobody paid for, and no provider is asked to approve it');

    v_event := pg_temp.sitting('knock', 'google', interval '-55 minutes', true);
    SELECT slug INTO v_slug FROM scheduling.rooms WHERE session_event_id = v_event;
    PERFORM pg_temp.act(v_a);
    j := scheduling.room_join(v_slug);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(j ->> 'url' = 'https://rooms.example.test/plain-knock'
        AND NOT (j ->> 'link_required')::boolean AND j ->> 'register' IS NULL,
        '3 a room people knock at hands out its shared link, because that link gets them no further');

    -- A provider's answer that did not confirm the setting changes nothing here. The batch door works
    -- on either approval type, and the plain link might be a form nobody answers.
    v_event := pg_temp.sitting('unconfirmed', 'zoom', interval '-55 minutes', false, true);
    SELECT slug INTO v_slug FROM scheduling.rooms WHERE session_event_id = v_event;
    PERFORM pg_temp.act(v_a);
    j := scheduling.room_join(v_slug);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((j -> 'register' ->> 'approve')::boolean AND (j ->> 'link_required')::boolean,
        '3 a paid room still approves when its provider''s answer confirmed nothing, so nobody who paid is stranded');

    v_free_host := scheduling.fn_schedule_host(v_schedule);
    v_guest := CASE WHEN v_free_host = v_a THEN v_b ELSE v_a END;
    INSERT INTO scheduling.events (schedule_id, kind, status, title, starts_at, ends_at, created_by, meeting_url)
    VALUES (v_schedule, 'sync', 'confirmed', 'Probe free', now() - interval '5 minutes', now() + interval '1 hour',
            v_free_host, 'https://zoom.us/j/probe-free')
    RETURNING id INTO v_entry;
    INSERT INTO scheduling.event_attendees (event_id, user_id, role, response, responded_at)
    VALUES (v_entry, v_guest, 'participant', 'accepted', now());
    INSERT INTO scheduling.rooms (event_id, provider, provider_meeting_id, provider_host_id, status, registration)
    VALUES (v_entry, 'zoom', 'paid-free-entry', 'host-account', 'ready', true)
    RETURNING slug INTO v_slug;
    PERFORM pg_temp.act(v_guest);
    j := scheduling.room_join(v_slug);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(NOT (j -> 'register' ->> 'approve')::boolean AND NOT (j ->> 'link_required')::boolean
        AND j ->> 'url' = 'https://zoom.us/j/probe-free',
        '3 a free room is approved by nobody and keeps its plain link');
END $$;
-- #endregion

-- #region 4. The refund path: kept outside, one press, no room record
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    c record;
    v_event uuid;
    v jsonb;
    p jsonb;
BEGIN
    FOR c IN
        SELECT * FROM (VALUES
            ('google', 'Meet: knocking'),
            ('microsoft_teams', 'Teams: in the lobby'),
            ('zoom', 'Zoom: in the waiting room')
        ) x (provider, label)
    LOOP
        v_event := pg_temp.sitting('outside-' || c.provider, c.provider, interval '2 hours', true);
        PERFORM pg_temp.press(v_event);
        PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'untracked',
            '4 ' || c.label || ': before the provider''s record is read, it holds');
        PERFORM pg_temp.sweep();
        PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'held', '4 ' || c.label || ': the sweep moves nothing yet');

        PERFORM pg_temp.read_back(v_event);
        p := projects.fn_session_presence(v_event);
        PERFORM pg_temp.check(p ->> 'outcome' = 'provider_no_show', '4 ' || c.label || ': read back with no host, a no-show');
        PERFORM pg_temp.check(NOT (p ->> 'tracked')::boolean AND (p ->> 'attendees_present')::integer = 0,
            '4 ' || c.label || ': and that took no record of them in the room');
        v := pg_temp.sweep();
        PERFORM pg_temp.check((v ->> 'refunded')::integer >= 1 AND pg_temp.escrow_status(v_event) = 'refunded',
            '4 ' || c.label || ': the sweep refunds it');
        PERFORM pg_temp.check((SELECT cm.status = 'cancelled' FROM projects.cohort_memberships cm
            JOIN projects.session_events se ON se.cohort_id = cm.cohort_id
            WHERE se.id = v_event AND cm.user_id = v_a), '4 ' || c.label || ': and the seat settles with it');
    END LOOP;

    v_event := pg_temp.sitting('nopress', 'google', interval '2 hours', true);
    PERFORM pg_temp.read_back(v_event);
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'untracked', '4 no press and no host: silence is never enough');
    PERFORM pg_temp.sweep();
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'held', '4 and it refunds nobody');

    v_event := pg_temp.sitting('toolate', 'google', interval '2 hours', true);
    PERFORM pg_temp.press(v_event, 16);
    PERFORM pg_temp.read_back(v_event);
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'untracked', '4 a press after the window proves nothing');
END $$;
-- #endregion

-- #region 5. A Zoom Basic host: the read is refused, so it holds
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v_event uuid := pg_temp.sitting('basic', 'zoom', interval '25 hours', true);
    v_dispute uuid;
    v jsonb;
BEGIN
    PERFORM pg_temp.press(v_event);
    -- GET /past_meetings/{id}/participants answers 400 / 200 on Basic: paid accounts only.
    PERFORM pg_temp.read_back(v_event, '200');
    PERFORM pg_temp.check((SELECT reconciled_at IS NULL FROM scheduling.rooms WHERE session_event_id = v_event),
        '5 a refused read is never stamped as read');
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'untracked', '5 so a Basic host''s no-show does not read as one');
    v := pg_temp.sweep();
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'held', '5 nothing refunds, and nothing releases to the host');
    PERFORM pg_temp.check((SELECT count(*) = 1 FROM comms.notifications n
        WHERE n.type = 'session.review_requested' AND n.entity_id = v_event AND n.user_id = v_a),
        '5 the attendee is asked instead');

    PERFORM pg_temp.act(v_a);
    v := projects.answer_session_review(v_event, false);
    PERFORM pg_temp.act(NULL);
    v_dispute := (v ->> 'dispute_id')::uuid;
    PERFORM pg_temp.check((SELECT audit ->> 'verdict' = 'ambiguous' FROM finance.disputes WHERE id = v_dispute),
        '5 their no opens a case the logs cannot settle');
    PERFORM pg_temp.check(v ->> 'status' = 'awaiting_response', '5 so it goes to the host, then to a person');
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'held', '5 and the money waits for that');
END $$;
-- #endregion

-- #region 6. A host who keeps somebody out does not collect
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_event uuid;
    p jsonb;
BEGIN
    v_event := pg_temp.sitting('lockout', 'google', interval '25 hours', true);
    PERFORM pg_temp.press(v_event);
    PERFORM pg_temp.ev('lockout', 'google', 'joined', 1, 'host', p_account => 'host-account', p_source => 'reconcile');
    PERFORM pg_temp.ev('lockout', 'google', 'left', 60, 'host', p_account => 'host-account', p_source => 'reconcile');
    PERFORM pg_temp.read_back(v_event);
    p := projects.fn_session_presence(v_event);
    PERFORM pg_temp.check((p ->> 'host_present')::boolean AND (p ->> 'attendees_present')::integer = 0,
        '6 the host was in, the attendee who pressed join never was');
    PERFORM pg_temp.check(p ->> 'outcome' = 'untracked', '6 that is not an attendee no-show');
    PERFORM pg_temp.sweep();
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'held', '6 so it does not release at +24 h');
    PERFORM pg_temp.check((SELECT count(*) = 1 FROM comms.notifications n
        WHERE n.type = 'session.review_requested' AND n.entity_id = v_event AND n.user_id = v_a),
        '6 the attendee is asked what happened');

    v_event := pg_temp.sitting('admitlate', 'google', interval '25 hours', true);
    PERFORM pg_temp.press(v_event);
    PERFORM pg_temp.ev('admitlate', 'google', 'joined', 1, 'host', p_account => 'host-account', p_source => 'reconcile');
    PERFORM pg_temp.ev('admitlate', 'google', 'joined', 20, 'guest', p_source => 'reconcile');
    PERFORM pg_temp.read_back(v_event);
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'untracked',
        '6 nor is being let in only after the window closed');

    v_event := pg_temp.sitting('admitted', 'google', interval '25 hours', true);
    PERFORM pg_temp.press(v_event);
    PERFORM pg_temp.ev('admitted', 'google', 'joined', 1, 'host', p_account => 'host-account', p_source => 'reconcile');
    PERFORM pg_temp.ev('admitted', 'google', 'joined', 3, 'guest', p_source => 'reconcile');
    PERFORM pg_temp.read_back(v_event);
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'successful', '6 let in on time is a success');
    PERFORM pg_temp.sweep();
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'released', '6 and pays out');

    v_event := pg_temp.sitting('neverpressed', 'google', interval '25 hours', true);
    PERFORM pg_temp.ev('neverpressed', 'google', 'joined', 1, 'host', p_account => 'host-account', p_source => 'reconcile');
    PERFORM pg_temp.read_back(v_event);
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'attendee_no_show', '6 an attendee who never pressed join is a no-show');
    PERFORM pg_temp.sweep();
    PERFORM pg_temp.check(pg_temp.escrow_status(v_event) = 'released', '6 and the host is paid');

    v_event := pg_temp.sitting('walkin', 'zoom', interval '25 hours', true, true);
    PERFORM pg_temp.press(v_event);
    PERFORM pg_temp.ev('walkin', 'zoom', 'joined', 1, 'host', p_account => 'host-account');
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'attendee_no_show',
        '6 where an approved attendee could walk in, a press and no entry changes nothing');

    v_event := pg_temp.sitting('unconfirmed-knock', 'google', interval '25 hours', false);
    PERFORM pg_temp.press(v_event);
    PERFORM pg_temp.ev('unconfirmed-knock', 'google', 'joined', 1, 'host', p_account => 'host-account');
    PERFORM pg_temp.check(pg_temp.outcome(v_event) = 'untracked',
        '6 a provider''s answer that confirmed nothing cannot switch this off');
END $$;
-- #endregion

-- #region 7. Who was in the room with no seat
DO $$
DECLARE
    v_b uuid := current_setting('probe.b')::uuid;
    v_event uuid;
BEGIN
    v_event := pg_temp.sitting('empty', 'google', interval '2 hours', true);
    PERFORM pg_temp.check(pg_temp.unmatched(v_event) = 0, '7 an empty room reads nought');

    v_event := pg_temp.sitting('oneseat', 'google', interval '2 hours', true);
    PERFORM pg_temp.ev('oneseat', 'google', 'joined', 1, 'host', p_account => 'host-account');
    PERFORM pg_temp.ev('oneseat', 'google', 'joined', 2, 'first');
    PERFORM pg_temp.ev('oneseat', 'google', 'left', 30, 'first');
    PERFORM pg_temp.check(pg_temp.unmatched(v_event) = 0, '7 one unnamed person in a one-seat room is its attendee');
    PERFORM pg_temp.ev('oneseat', 'google', 'joined', 3, 'second');
    PERFORM pg_temp.check((SELECT count(*) = 0 FROM scheduling.presence_events p
        WHERE p.room_id = pg_temp.room(v_event) AND p.matched_by = 'unmatched'),
        '7 the ledger alone calls nobody unmatched here');
    PERFORM pg_temp.check(pg_temp.unmatched(v_event) = 1, '7 but a second unnamed person cannot also be that attendee');

    v_event := pg_temp.sitting('named', 'zoom', interval '2 hours', true, true);
    PERFORM scheduling.save_room_registrant(pg_temp.room(v_event), current_setting('probe.a')::uuid, 'reg-a', 'https://zoom.us/w/a');
    PERFORM pg_temp.ev('named', 'zoom', 'joined', 2, 'reg-a', p_registrant => 'reg-a');
    PERFORM pg_temp.ev('named', 'zoom', 'joined', 3, 'stranger');
    PERFORM pg_temp.check(pg_temp.unmatched(v_event) = 1, '7 once the seat was named by its link, an unnamed person is a stranger');

    v_event := pg_temp.sitting('twoseats', 'google', interval '2 hours', true);
    INSERT INTO projects.cohort_memberships (cohort_id, user_id)
    SELECT e.cohort_id, v_b FROM projects.session_events e WHERE e.id = v_event;
    PERFORM pg_temp.ev('twoseats', 'google', 'joined', 2, 'one');
    PERFORM pg_temp.ev('twoseats', 'google', 'left', 10, 'one');
    PERFORM pg_temp.ev('twoseats', 'google', 'joined', 20, 'one');
    PERFORM pg_temp.ev('twoseats', 'google', 'joined', 3, 'two');
    PERFORM pg_temp.check(pg_temp.unmatched(v_event) = 2, '7 two strangers are two, however often they came and went');
    PERFORM pg_temp.ev('twoseats', 'google', 'waiting', 4, 'three');
    PERFORM pg_temp.press(v_event);
    PERFORM pg_temp.check(pg_temp.unmatched(v_event) = 2, '7 a knock and a press are not somebody in the room');
    PERFORM pg_temp.ev('twoseats', 'google', 'joined', 5, 'reader', p_source => 'reconcile');
    PERFORM pg_temp.check(pg_temp.unmatched(v_event) = 1, '7 and the provider''s own record replaces the webhooks');

    PERFORM pg_temp.check(NOT has_function_privilege('authenticated', 'scheduling.fn_room_unmatched(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'scheduling.fn_room_unmatched(uuid)', 'EXECUTE')
        AND has_function_privilege('service_role', 'scheduling.fn_room_unmatched(uuid)', 'EXECUTE'),
        '7 no client reaches it directly');
END $$;
-- #endregion

-- #region 8. An operator reads it on a case, and a party does not
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v_op uuid := current_setting('probe.op')::uuid;
    v_event uuid := pg_temp.sitting('case', 'google', interval '2 hours', true);
    v_id uuid;
    v jsonb;
BEGIN
    -- The host was in, so the logs settle nothing and the case stays live for a person to read.
    PERFORM pg_temp.ev('case', 'google', 'joined', 1, 'host', p_account => 'host-account');
    PERFORM pg_temp.ev('case', 'google', 'joined', 2, 'first');
    PERFORM pg_temp.ev('case', 'google', 'joined', 3, 'second');

    PERFORM pg_temp.act(v_a);
    v := projects.claim_session_no_show(v_event, 'Nobody let me in.');
    v_id := (v ->> 'dispute_id')::uuid;
    v := finance.get_dispute(v_id);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v ->> 'status' = 'awaiting_response', '8 a case the logs cannot settle');
    PERFORM pg_temp.check(v ->> 'role' = 'claimant' AND v ->> 'room' IS NULL, '8 the claimant reads no room count');

    PERFORM pg_temp.act(v_host);
    v := finance.get_dispute(v_id);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v ->> 'role' = 'respondent' AND v ->> 'room' IS NULL, '8 nor does the host');

    PERFORM pg_temp.act(v_op);
    v := finance.get_dispute(v_id);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v ->> 'role' = 'operator' AND (v -> 'room' ->> 'guarded')::boolean, '8 an operator reads that a link was not enough');
    PERFORM pg_temp.check((v -> 'room' ->> 'unmatched')::integer = 1, '8 and how many people matched no seat');

    -- Read live, so a record that lands after the audit still reaches the case.
    PERFORM pg_temp.ev('case', 'google', 'joined', 4, 'late-a', p_source => 'reconcile');
    PERFORM pg_temp.ev('case', 'google', 'joined', 4, 'late-b', p_source => 'reconcile');
    PERFORM pg_temp.ev('case', 'google', 'joined', 4, 'late-c', p_source => 'reconcile');
    PERFORM pg_temp.act(v_op);
    v := finance.get_dispute(v_id);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((v -> 'room' ->> 'unmatched')::integer = 2, '8 a provider''s record that lands later still counts');
END $$;
-- #endregion

ROLLBACK;
