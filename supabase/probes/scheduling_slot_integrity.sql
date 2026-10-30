-- =============================================================================================
-- Probe: one free-time rule and one queue per provider calendar, and the visitor's slice of
-- call_settings (SCHEDULING_COMPLETENESS_AUDIT S-06, S-07, S-16).
--
--   1. S-06 — projects.fn_book_session_slot refuses a 1-1 session on top of a requested discovery
--      call: it asks scheduling.fn_slot_is_free, the discovery-call gate's own predicate, which tests
--      calls as well as events and blackouts.
--   2. S-07 — scheduling.request_discovery_call holds the schedule's row FOR UPDATE until its
--      transaction ends, so a second request for the same slot from another session WAITS for it
--      instead of reading the first as absent and double-booking the host. Read from the row's lock
--      (pgrowlocks), so the probe needs one session and commits nothing; once the first request is
--      visible, the gate refuses the twin.
--   3. S-16 — anon reads the public columns of call_settings and none of the anti-abuse ones;
--      the owner (authenticated) still reads the whole row for their editor.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. The pgrowlocks extension is
-- created inside the transaction (and so rolled back) when the database does not carry it. Run
-- against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/scheduling_slot_integrity.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts (non-zero exit under
-- ON_ERROR_STOP). Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgrowlocks WITH SCHEMA extensions;

-- #region 1. S-06: a 1-1 booking sees discovery calls (as postgres)
DO $$
DECLARE
    v_bp marketplace.service_blueprints;
    v_schedule uuid;
    v_buyer uuid;
    v_minutes integer;
    t timestamptz;
    v_found boolean := false;
BEGIN
    FOR v_bp IN
        SELECT b.* FROM marketplace.service_blueprints b
         WHERE b.delivery_model = 'session' AND b.is_published
         ORDER BY b.id
    LOOP
        SELECT s.id INTO v_schedule FROM scheduling.schedules s
         WHERE (v_bp.owner_team_id IS NOT NULL AND s.owner_type = 'team' AND s.owner_id = v_bp.owner_team_id)
            OR (v_bp.owner_team_id IS NULL AND s.owner_type IN ('user', 'freelancer') AND s.owner_id = v_bp.freelancer_profile_id)
         ORDER BY (s.owner_type = 'freelancer') DESC LIMIT 1;
        CONTINUE WHEN v_schedule IS NULL;
        v_minutes := COALESCE(v_bp.session_minutes, 60);
        t := date_trunc('hour', now()) + interval '3 days';
        FOR i IN 1 .. 1500 LOOP
            IF scheduling.fn_band_covers(v_schedule, 'working_hours', t, t + make_interval(mins => v_minutes), v_bp.id)
               AND scheduling.fn_slot_is_free(v_schedule, t, t + make_interval(mins => v_minutes)) THEN
                v_found := true;
                EXIT;
            END IF;
            t := t + interval '1 hour';
        END LOOP;
        EXIT WHEN v_found;
    END LOOP;
    IF NOT v_found THEN
        RAISE EXCEPTION 'FAIL no fixture: need a published session listing with a free working hour on its provider''s calendar';
    END IF;
    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE NOT org.fn_is_minor(u.user_id)
       AND u.user_id <> v_bp.freelancer_profile_id
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm
                        WHERE tm.team_id = v_bp.owner_team_id AND tm.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;

    -- A courtesy call requested inside the session's slot (as postgres, so the request gate is not
    -- asked: the fixture is the call, not its booking).
    INSERT INTO scheduling.discovery_calls (host_schedule_id, host_user_id, requester_user_id, call_type,
                                            status, proposed_start, proposed_end)
    VALUES (v_schedule, scheduling.fn_schedule_host(v_schedule), v_buyer, 'courtesy', 'proposed',
            t + interval '15 minutes', t + interval '30 minutes');
    IF scheduling.fn_slot_is_free(v_schedule, t, t + make_interval(mins => v_minutes)) THEN
        RAISE EXCEPTION 'FAIL fixture: fn_slot_is_free does not see the requested call';
    END IF;

    BEGIN
        PERFORM projects.fn_book_session_slot(v_bp.id, v_buyer, 'user', v_buyer, 5000, 1,
            COALESCE(v_bp.currency, 'GBP'), t, gen_random_uuid());
        RAISE EXCEPTION 'FAIL a 1-1 session was booked on top of a requested discovery call';
    EXCEPTION
        WHEN SQLSTATE 'PS409' THEN
            IF SQLERRM NOT LIKE '%just taken%' THEN
                RAISE EXCEPTION 'FAIL the booking was refused, but not for the call: %', SQLERRM;
            END IF;
            RAISE NOTICE 'PASS a 1-1 booking over a requested discovery call is refused [%]', SQLERRM;
        WHEN OTHERS THEN
            IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
            -- The fixture's order line is not real, so a booking that got past the slot test dies on
            -- the seat's foreign key (or the wallet) instead.
            RAISE EXCEPTION 'FAIL a 1-1 booking got past the slot test over a requested discovery call (it went on to: %)', SQLERRM;
    END;
END $$;
-- #endregion

-- #region 2. S-07: concurrent call requests queue on the schedule (as two requesters)
-- The row-lock modes held on the schedule row right now (pgrowlocks; NULL when it is not locked).
CREATE FUNCTION pg_temp.schedule_lock_modes(p_schedule uuid) RETURNS text[] LANGUAGE sql AS $$
    SELECT l.modes FROM extensions.pgrowlocks('scheduling.schedules') l
      JOIN scheduling.schedules s ON s.ctid = l.locked_row
     WHERE s.id = p_schedule;
$$;

DO $$
DECLARE
    v_schedule uuid; v_host uuid; v_minutes integer; v_platform text;
    v_r1 uuid; v_r2 uuid; t timestamptz; v_found boolean := false;
    s record;
BEGIN
    FOR s IN
        SELECT sc.id, cs.courtesy_duration_minutes, cs.min_notice_minutes, cs.max_advance_days
          FROM scheduling.schedules sc
          JOIN scheduling.call_settings cs ON cs.schedule_id = sc.id
         WHERE cs.accepts_calls AND cs.courtesy_enabled AND scheduling.fn_schedule_is_public(sc.id)
         ORDER BY sc.id
    LOOP
        v_schedule := s.id;
        v_host := scheduling.fn_schedule_host(v_schedule);
        v_minutes := s.courtesy_duration_minutes;
        SELECT cp.provider_slug INTO v_platform FROM scheduling.call_platforms cp
         WHERE cp.schedule_id = v_schedule ORDER BY cp.position LIMIT 1;
        v_r1 := NULL; v_r2 := NULL;
        t := date_trunc('hour', now() + make_interval(mins => s.min_notice_minutes)) + interval '1 day';
        WHILE t < now() + make_interval(days => s.max_advance_days) - interval '1 day' LOOP
            SELECT u.user_id INTO v_r1 FROM org.users_public u
             WHERE u.user_id <> v_host AND NOT org.fn_is_minor(u.user_id)
               AND scheduling.fn_call_request_refusal(v_schedule, u.user_id, 'courtesy', t,
                       t + make_interval(mins => v_minutes)) IS NULL
             ORDER BY u.user_id LIMIT 1;
            IF v_r1 IS NOT NULL THEN
                SELECT u.user_id INTO v_r2 FROM org.users_public u
                 WHERE u.user_id NOT IN (v_host, v_r1) AND NOT org.fn_is_minor(u.user_id)
                   AND scheduling.fn_call_request_refusal(v_schedule, u.user_id, 'courtesy', t,
                           t + make_interval(mins => v_minutes)) IS NULL
                 ORDER BY u.user_id LIMIT 1;
            END IF;
            IF v_r1 IS NOT NULL AND v_r2 IS NOT NULL THEN
                v_found := true;
                EXIT;
            END IF;
            t := t + interval '1 hour';
        END LOOP;
        EXIT WHEN v_found;
    END LOOP;
    IF NOT v_found THEN
        RAISE EXCEPTION 'FAIL no fixture: need a published schedule taking courtesy calls with a slot two people may request';
    END IF;

    PERFORM set_config('probe.schedule', v_schedule::text, true);
    PERFORM set_config('probe.r1', v_r1::text, true);
    PERFORM set_config('probe.r2', v_r2::text, true);
    PERFORM set_config('probe.start', t::text, true);
    PERFORM set_config('probe.end', (t + make_interval(mins => v_minutes))::text, true);
    PERFORM set_config('probe.platform', COALESCE(v_platform, ''), true);
END $$;

DO $$
BEGIN
    IF pg_temp.schedule_lock_modes(current_setting('probe.schedule')::uuid) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL fixture: the schedule row is already locked (%) — another session is mid-request; re-run',
            pg_temp.schedule_lock_modes(current_setting('probe.schedule')::uuid);
    END IF;
END $$;

-- Requester one asks for the slot and keeps the transaction open.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.r1'), 'role', 'authenticated')::text, true);
DO $$
DECLARE r jsonb;
BEGIN
    r := scheduling.request_discovery_call(
        current_setting('probe.schedule')::uuid, 'courtesy', current_setting('probe.start')::timestamptz,
        current_setting('probe.end')::timestamptz, 'Probe agenda', 'UTC',
        NULLIF(current_setting('probe.platform'), ''), NULL);
    IF r ->> 'id' IS NULL THEN RAISE EXCEPTION 'FAIL fixture: the first request answered %', r; END IF;
    RAISE NOTICE 'PASS the first request is taken (%)', r ->> 'status';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- The lock it holds until its transaction ends: FOR UPDATE on the schedule row, which a second
-- request's own FOR UPDATE waits on. Without it the only lock is the foreign key's FOR KEY SHARE from
-- the call's insert, which a twin request takes alongside it, so both read the slot as free.
DO $$
DECLARE v_modes text[];
BEGIN
    v_modes := pg_temp.schedule_lock_modes(current_setting('probe.schedule')::uuid);
    IF v_modes IS NULL OR NOT ('For Update' = ANY (v_modes)) THEN
        RAISE EXCEPTION 'FAIL the request holds % on the schedule, not FOR UPDATE — a concurrent twin would double-book the host',
            COALESCE(v_modes::text, 'no lock');
    END IF;
    RAISE NOTICE 'PASS the request holds the schedule FOR UPDATE until it commits';
END $$;

-- Once it can see the first request (here, the same transaction), the gate refuses the twin.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.r2'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    PERFORM scheduling.request_discovery_call(
        current_setting('probe.schedule')::uuid, 'courtesy', current_setting('probe.start')::timestamptz,
        current_setting('probe.end')::timestamptz, 'Probe agenda', 'UTC',
        NULLIF(current_setting('probe.platform'), ''), NULL);
    RAISE EXCEPTION 'FAIL the same slot was requested twice';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%slot_unavailable%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS the twin request is refused once the first is visible [%]', SQLERRM;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 3. S-16: what a visitor reads of call_settings
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
DO $$
DECLARE n int; c text;
BEGIN
    SELECT count(*) INTO n FROM (
        SELECT schedule_id, accepts_calls, courtesy_enabled, courtesy_duration_minutes, paid_enabled,
               paid_duration_minutes, fee_amount_minor, fee_currency, buffer_before_minutes,
               buffer_after_minutes, min_notice_minutes, max_advance_days, agenda_required
          FROM scheduling.call_settings
         WHERE schedule_id = current_setting('probe.schedule')::uuid
    ) x;
    IF n <> 1 THEN RAISE EXCEPTION 'FAIL a visitor cannot read a published schedule''s call offer (% rows)', n; END IF;
    RAISE NOTICE 'PASS a visitor reads the offer and the grid''s guards';

    FOREACH c IN ARRAY ARRAY['courtesy_max_per_week', 'courtesy_cooldown_days', 'auto_confirm',
                             'preferred_provider_slug', '*'] LOOP
        BEGIN
            EXECUTE format('SELECT %s FROM scheduling.call_settings LIMIT 1', c);
            RAISE EXCEPTION 'FAIL a visitor read call_settings.%', c;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS a visitor cannot read call_settings.% [%]', c, SQLERRM;
        END;
    END LOOP;
END $$;
RESET ROLE;

-- The owner's Availability editor reads the whole row.
DO $$
DECLARE v_owner uuid;
BEGIN
    SELECT s.owner_id INTO v_owner FROM scheduling.schedules s
      JOIN scheduling.call_settings cs ON cs.schedule_id = s.id
     WHERE s.owner_type = 'user' ORDER BY s.id LIMIT 1;
    PERFORM set_config('probe.owner', v_owner::text, true);
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM scheduling.call_settings cs
      JOIN scheduling.schedules s ON s.id = cs.schedule_id
     WHERE s.owner_type = 'user' AND s.owner_id = auth.uid()
       AND cs.courtesy_max_per_week IS NOT NULL AND cs.auto_confirm IS NOT NULL;
    IF n < 1 THEN RAISE EXCEPTION 'FAIL the owner cannot read their own call settings'; END IF;
    RAISE NOTICE 'PASS the owner still reads their whole call_settings row';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

ROLLBACK;
