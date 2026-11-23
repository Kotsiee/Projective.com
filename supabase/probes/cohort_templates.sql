-- =============================================================================================
-- Probe: a group session runs on rolling weekly templates, each buyer starting on the next open chain
-- (MARKETPLACE SC11; USER_FLOWS MK-63).
--
--   1. projects.save_group_schedule — only a seller who manages the listing; an unknown mode, an
--      overlapping week (wrapping Sunday into Monday) and a rolling schedule short of the listing's
--      sittings are refused 22023.
--   2. A rolling save opens the listing's chains at once: each an enrolling cohort of the listing's size
--      whose enrolment closes at its session 1, session k at the next occurrence of template k after
--      session k-1 ends, in the seller's zone.
--   3. Across the March 2027 clock change (Europe/London) the chain keeps its wall-clock time: session 1
--      Thu 25 Mar 06:10 GMT, session 2 Mon 29 Mar 06:10 BST, session 3 Wed 31 Mar 06:10 BST. Four chains in
--      the four-week horizon; a second run opens none (idempotent per chain start); no two sittings of
--      the listing's chains overlap.
--   4. A buyer lands on the earliest chain with a seat to sell: once the first chain is full the offer
--      and the waitlist move to the next, and `chains` lists every start with its remaining seats.
--   5. open_cohort refuses a rolling listing (PU422); switched back to fixed it is refused only because
--      chains are enrolling (PS409).
--   6. The close: an empty chain is cancelled quietly (under_filled, sittings and mirrors cancelled, not
--      listed to the seller, never reopened); a chain with a paid seat goes active.
--   7. A generated chain cancels exactly as a manual cohort: the seat is refunded in full.
--   8. A chain whose session 1 clashes with the seller's calendar is skipped.
--   9. The grants: no client runs the generator.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/cohort_templates.sql
-- A clean run prints only PASS notices; any failure raises `PROBE FAIL …` and aborts.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

-- #region 0. Helpers and fixtures (as postgres)
CREATE FUNCTION pg_temp.fail(p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'PROBE FAIL %', p_what;
END;
$$;

CREATE FUNCTION pg_temp.sqlstate_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN '';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.fail(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.sqlstate_of(text) TO PUBLIC;

CREATE FUNCTION pg_temp.as_user(p_who text) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.' || p_who), 'role', 'authenticated')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;

-- A week of three sittings: Thu 06:10, Mon 06:10, Wed 06:10 (ISO weekdays 4, 1, 3; minute 370).
CREATE FUNCTION pg_temp.week() RETURNS jsonb LANGUAGE sql AS $$
    SELECT '[{"weekday":4,"startMinute":370},{"weekday":1,"startMinute":370},{"weekday":3,"startMinute":370}]'::jsonb;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.week() TO PUBLIC;

-- The listing's enrolling chains, soonest first.
CREATE FUNCTION pg_temp.chains() RETURNS TABLE (id uuid, chain_start timestamptz, status text) LANGUAGE sql AS $$
    SELECT c.id, c.chain_start, c.status::text
      FROM projects.cohorts c
      JOIN projects.projects p ON p.id = c.project_id
     WHERE p.source_blueprint_id = current_setting('probe.bp')::uuid AND c.chain_start IS NOT NULL
     ORDER BY c.chain_start;
$$;

-- Seat a buyer on a cohort: their hold, then the paid seat (the path checkout settles through).
CREATE FUNCTION pg_temp.seat(p_who text, p_cohort uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_user uuid := current_setting('probe.' || p_who)::uuid;
    v_type text := finance.fn_person_wallet_type(v_user);
    v_hold uuid;
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    v_hold := (projects.reserve_seat(p_cohort, 1) ->> 'hold_id')::uuid;
    PERFORM finance.fn_ensure_wallet(v_type, v_user, 'USD');
    PERFORM finance.fn_wallet_credit(v_user, v_type, 'USD', 20000, 'topup', NULL, NULL);
    RETURN projects.fn_confirm_seat(v_hold, v_user, v_type, v_user, 9000, 'USD', NULL);
END;
$$;

DO $$
DECLARE
    v_bp record;
    v_listing uuid;
    v_people uuid[];
BEGIN
    SELECT sb.id, sb.slug, sb.freelancer_profile_id AS host, sb.owner_team_id INTO v_bp
      FROM marketplace.service_blueprints sb
     WHERE sb.delivery_model = 'group_session' AND sb.is_published
       AND EXISTS (SELECT 1 FROM catalogue.listings l WHERE l.service_blueprint_id = sb.id)
     ORDER BY sb.slug LIMIT 1;
    IF v_bp.id IS NULL THEN
        PERFORM pg_temp.fail('no fixture: need a published group-session listing (deno task db:reset)');
    END IF;
    SELECT l.id INTO v_listing FROM catalogue.listings l WHERE l.service_blueprint_id = v_bp.id LIMIT 1;

    SELECT array_agg(p.user_id ORDER BY p.user_id) INTO v_people FROM (
        SELECT u.user_id FROM org.users_public u
         WHERE u.user_id <> v_bp.host
           AND NOT org.fn_is_minor(u.user_id)
           AND (v_bp.owner_team_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM org.team_members tm WHERE tm.team_id = v_bp.owner_team_id AND tm.user_id = u.user_id))
         ORDER BY u.user_id LIMIT 4
    ) p;
    IF COALESCE(array_length(v_people, 1), 0) < 4 THEN
        PERFORM pg_temp.fail('no fixture: need four adults besides the seller');
    END IF;

    -- The probe owns this listing for its transaction: three one-hour sittings, a chain of two seats, no
    -- plan lengths, no queue, no open cohort, and the seller's calendar read in Europe/London.
    UPDATE marketplace.service_blueprints
       SET session_count = 3, session_minutes = 60, max_seats_per_cohort = 2, session_plan = '[]'::jsonb
     WHERE id = v_bp.id;
    DELETE FROM projects.waitlists WHERE service_blueprint_id = v_bp.id;
    UPDATE projects.cohorts c SET status = 'cancelled'
      FROM projects.projects p
     WHERE p.id = c.project_id AND p.source_blueprint_id = v_bp.id AND c.status IN ('enrolling', 'active');
    UPDATE scheduling.schedules s SET timezone = 'Europe/London'
     WHERE s.owner_id IN (v_bp.host, v_bp.owner_team_id);
    IF projects.fn_blueprint_timezone(v_bp.id) <> 'Europe/London' THEN
        PERFORM pg_temp.fail('no fixture: the seller publishes no schedule to read a zone from');
    END IF;

    PERFORM set_config('probe.bp', v_bp.id::text, true);
    PERFORM set_config('probe.listing', v_listing::text, true);
    PERFORM set_config('probe.host', v_bp.host::text, true);
    PERFORM set_config('probe.a', v_people[1]::text, true);
    PERFORM set_config('probe.b', v_people[2]::text, true);
    PERFORM set_config('probe.c', v_people[3]::text, true);
    PERFORM set_config('probe.x', v_people[4]::text, true);
    RAISE NOTICE 'fixture listing=% seller=%', v_bp.slug, v_bp.host;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.chains() TO PUBLIC;
-- #endregion

-- #region 1. The seller's door refuses what cannot run (as the seller, then a stranger)
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_listing text := current_setting('probe.listing');
    s text;
BEGIN
    PERFORM pg_temp.as_user('host');
    s := pg_temp.sqlstate_of(format('SELECT projects.save_group_schedule(%L, %L, %L)', v_listing, 'weekly', pg_temp.week()));
    IF s <> '22023' THEN PERFORM pg_temp.fail('an unknown mode was saved, or refused as ' || s); END IF;
    s := pg_temp.sqlstate_of(format('SELECT projects.save_group_schedule(%L, %L, %L)', v_listing, 'rolling_templates',
        '[{"weekday":7,"startMinute":1410},{"weekday":1,"startMinute":0},{"weekday":3,"startMinute":370}]'));
    IF s <> '22023' THEN PERFORM pg_temp.fail('a week overlapping Sunday into Monday was saved, or refused as ' || s); END IF;
    s := pg_temp.sqlstate_of(format('SELECT projects.save_group_schedule(%L, %L, %L)', v_listing, 'rolling_templates',
        '[{"weekday":4,"startMinute":370},{"weekday":1,"startMinute":370}]'));
    IF s <> '22023' THEN PERFORM pg_temp.fail('a rolling week short of the listing''s three sittings was saved, or refused as ' || s); END IF;
    s := pg_temp.sqlstate_of(format('SELECT projects.save_group_schedule(%L, %L, %L)', v_listing, 'rolling_templates',
        '[{"weekday":8,"startMinute":370},{"weekday":1,"startMinute":370},{"weekday":3,"startMinute":370}]'));
    IF s <> '22023' THEN PERFORM pg_temp.fail('weekday 8 was saved, or refused as ' || s); END IF;

    PERFORM pg_temp.as_user('x');
    s := pg_temp.sqlstate_of(format('SELECT projects.save_group_schedule(%L, %L, %L)', v_listing, 'rolling_templates', pg_temp.week()));
    IF s <> 'P0002' THEN PERFORM pg_temp.fail('a stranger saved the schedule, or was refused as ' || s); END IF;
    RAISE NOTICE 'PASS the door refuses an unknown mode, an overlapping week, a short week, a bad weekday and a stranger';
END $$;
-- #endregion

-- #region 2. A rolling save opens the chains at once
DO $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM pg_temp.as_user('host');
    v_out := projects.save_group_schedule(current_setting('probe.listing')::uuid, 'rolling_templates', pg_temp.week());
    PERFORM set_config('probe.opened', v_out ->> 'opened', true);
END $$;
RESET ROLE;
DO $$
DECLARE
    v_out jsonb := jsonb_build_object('opened', current_setting('probe.opened'));
    r record;
    v_n integer := 0;
    v_s timestamptz[];
    v_cohort projects.cohorts;
BEGIN
    IF (v_out ->> 'opened')::integer < 3 THEN
        PERFORM pg_temp.fail('a rolling save opened ' || (v_out ->> 'opened') || ' chains in four weeks, not three or more');
    END IF;
    FOR r IN SELECT * FROM pg_temp.chains() LOOP
        v_n := v_n + 1;
        SELECT * INTO v_cohort FROM projects.cohorts WHERE id = r.id;
        SELECT array_agg(se.start_time ORDER BY se.start_time) INTO v_s
          FROM projects.session_events se WHERE se.cohort_id = r.id AND se.status = 'scheduled';
        IF cardinality(v_s) <> 3 OR v_s[1] <> r.chain_start
           OR to_char(v_s[1] AT TIME ZONE 'Europe/London', 'ID HH24:MI') <> '4 06:10'
           OR to_char(v_s[2] AT TIME ZONE 'Europe/London', 'ID HH24:MI') <> '1 06:10'
           OR to_char(v_s[3] AT TIME ZONE 'Europe/London', 'ID HH24:MI') <> '3 06:10'
           OR v_s[2] - v_s[1] <> interval '4 days' OR v_s[3] - v_s[2] <> interval '2 days' THEN
            PERFORM pg_temp.fail('chain ' || r.chain_start || ' does not follow Thu → next Mon → next Wed at 06:10: ' || v_s::text);
        END IF;
        IF v_cohort.status <> 'enrolling' OR v_cohort.max_seats <> 2 OR v_cohort.enrolment_closes_at <> r.chain_start
           OR v_cohort.cadence IS DISTINCT FROM 'fixed' OR v_cohort.min_seats IS NOT NULL THEN
            PERFORM pg_temp.fail('a generated chain is not an enrolling cohort of two closing at its session 1');
        END IF;
    END LOOP;
    IF v_n <> (v_out ->> 'opened')::integer THEN
        PERFORM pg_temp.fail('the save answered ' || (v_out ->> 'opened') || ' chains but ' || v_n || ' exist');
    END IF;
    RAISE NOTICE 'PASS a rolling save opens % chains at once, each Thu → Mon → Wed at 06:10 London, closing at its session 1', v_n;
END $$;
-- #endregion

-- #region 3. Across the clock change, idempotent, disjoint (as postgres: the job's view)
DO $$
DECLARE
    v_bp uuid := current_setting('probe.bp')::uuid;
    v_opened integer;
    v_s timestamptz[];
BEGIN
    v_opened := projects.fn_open_template_cohorts('2027-03-21 12:00+00', 200, v_bp);
    IF v_opened <> 4 THEN
        PERFORM pg_temp.fail('four Thursdays fall in the horizon from 21 Mar 2027, but ' || v_opened || ' chains opened');
    END IF;
    SELECT array_agg(se.start_time ORDER BY se.start_time) INTO v_s
      FROM projects.session_events se
      JOIN projects.cohorts c ON c.id = se.cohort_id
     WHERE c.chain_start = '2027-03-25 06:10+00' AND se.status = 'scheduled';
    IF v_s IS DISTINCT FROM ARRAY['2027-03-25 06:10+00', '2027-03-29 05:10+00', '2027-03-31 05:10+00']::timestamptz[] THEN
        PERFORM pg_temp.fail('the chain across the clock change did not keep 06:10 London: ' || COALESCE(v_s::text, 'none'));
    END IF;
    RAISE NOTICE 'PASS across the March clock change a chain keeps 06:10 London (06:10Z, then 05:10Z, 05:10Z)';

    v_opened := projects.fn_open_template_cohorts('2027-03-21 12:00+00', 200, v_bp);
    IF v_opened <> 0 THEN PERFORM pg_temp.fail('a second run opened ' || v_opened || ' more chains'); END IF;
    IF EXISTS (
        SELECT 1
          FROM projects.session_events a
          JOIN projects.cohorts ca ON ca.id = a.cohort_id
          JOIN projects.session_events b ON b.id <> a.id AND b.status = 'scheduled'
          JOIN projects.cohorts cb ON cb.id = b.cohort_id AND cb.project_id = ca.project_id
         WHERE ca.chain_start IS NOT NULL AND cb.chain_start IS NOT NULL AND a.status = 'scheduled'
           AND a.start_time < b.end_time AND b.start_time < a.end_time
    ) THEN
        PERFORM pg_temp.fail('two chains share or overlap a sitting');
    END IF;
    RAISE NOTICE 'PASS a second run opens nothing, and no two chains share or overlap a sitting';
END $$;
-- #endregion

-- #region 4. A buyer lands on the earliest chain with a seat to sell
DO $$
DECLARE
    v_bp uuid := current_setting('probe.bp')::uuid;
    v_first uuid;
    v_second uuid;
    v_offer jsonb;
    v_enrolling integer;
BEGIN
    SELECT id INTO v_first FROM pg_temp.chains() ORDER BY chain_start LIMIT 1;
    SELECT id INTO v_second FROM pg_temp.chains() ORDER BY chain_start OFFSET 1 LIMIT 1;
    SELECT count(*) INTO v_enrolling FROM pg_temp.chains() WHERE status = 'enrolling';
    PERFORM set_config('probe.first', v_first::text, true);
    PERFORM set_config('probe.second', v_second::text, true);

    PERFORM pg_temp.as_user('a');
    v_offer := projects.get_cohort_offer(v_bp);
    IF (v_offer ->> 'cohort_id')::uuid <> v_first OR jsonb_array_length(v_offer -> 'chains') <> v_enrolling
       OR (v_offer -> 'chains' -> 0 ->> 'cohort_id')::uuid <> v_first
       OR (v_offer -> 'chains' -> 0 ->> 'remaining')::integer <> 2
       OR jsonb_array_length(v_offer -> 'chains' -> 0 -> 'sittings') <> 3 THEN
        PERFORM pg_temp.fail('the offer does not land on the first chain and list every chain: ' || v_offer::text);
    END IF;

    PERFORM pg_temp.seat('a', v_first);
    PERFORM pg_temp.seat('b', v_first);
    PERFORM pg_temp.as_user('c');
    v_offer := projects.get_cohort_offer(v_bp);
    IF (v_offer ->> 'cohort_id')::uuid <> v_second OR (v_offer -> 'chains' -> 0 ->> 'remaining')::integer <> 0
       OR (v_offer ->> 'remaining')::integer <> 2 THEN
        PERFORM pg_temp.fail('a full first chain still holds the offer: ' || v_offer::text);
    END IF;
    IF projects.fn_waitlist_cohort(v_bp) <> v_second THEN
        PERFORM pg_temp.fail('the waitlist still invites into the full first chain');
    END IF;
    RAISE NOTICE 'PASS the offer lists every chain and lands on the earliest with a seat; once it fills, offer and waitlist move to the next';
END $$;
-- #endregion

-- #region 5. Open cohort beside it (as the seller)
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_listing text := current_setting('probe.listing');
    s text;
BEGIN
    PERFORM pg_temp.as_user('host');
    s := pg_temp.sqlstate_of(format('SELECT projects.open_cohort(%L, %L, %L)', v_listing, now() + interval '60 days', 'weekly'));
    IF s <> 'PU422' THEN PERFORM pg_temp.fail('a rolling listing opened a cohort by hand, or was refused as ' || s); END IF;
    PERFORM projects.save_group_schedule(v_listing::uuid, 'fixed_cohorts', pg_temp.week());
    s := pg_temp.sqlstate_of(format('SELECT projects.open_cohort(%L, %L, %L)', v_listing, now() + interval '60 days', 'weekly'));
    IF s <> 'PS409' THEN PERFORM pg_temp.fail('back on fixed cohorts, open_cohort was not refused for the enrolling chains: ' || s); END IF;
    PERFORM projects.save_group_schedule(v_listing::uuid, 'rolling_templates', pg_temp.week());
    RAISE NOTICE 'PASS a rolling listing refuses Open cohort; back on fixed cohorts only its enrolling chains block one';
END $$;
-- #endregion

-- #region 6. The close: an empty chain goes quietly, a seated one runs (as postgres: the sweep)
RESET ROLE;
DO $$
DECLARE
    v_first uuid := current_setting('probe.first')::uuid;
    v_second uuid := current_setting('probe.second')::uuid;
    v_c projects.cohorts;
    v_list jsonb;
BEGIN
    UPDATE projects.cohorts SET enrolment_closes_at = now() - interval '1 second' WHERE id IN (v_first, v_second);
    PERFORM projects.fn_close_cohort_enrolment(now());

    SELECT * INTO v_c FROM projects.cohorts WHERE id = v_second;
    IF v_c.status <> 'cancelled' OR v_c.cancel_reason IS DISTINCT FROM 'under_filled' OR v_c.chain_start IS NULL THEN
        PERFORM pg_temp.fail('an empty chain at its close was not cancelled quietly: ' || v_c.status);
    END IF;
    IF EXISTS (SELECT 1 FROM projects.session_events se WHERE se.cohort_id = v_second AND se.status = 'scheduled')
       OR EXISTS (SELECT 1 FROM scheduling.events ev JOIN projects.session_events se ON se.id = ev.source_session_event_id
                   WHERE se.cohort_id = v_second AND ev.status <> 'cancelled') THEN
        PERFORM pg_temp.fail('an empty chain''s sittings or calendar mirrors outlived it');
    END IF;
    SELECT * INTO v_c FROM projects.cohorts WHERE id = v_first;
    IF v_c.status <> 'active' THEN PERFORM pg_temp.fail('a seated chain did not go active at its close: ' || v_c.status); END IF;

    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.host'), 'role', 'authenticated')::text, true);
    v_list := projects.get_listing_cohorts(current_setting('probe.listing')::uuid);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_list -> 'cohorts') e WHERE (e ->> 'cohort_id')::uuid = v_second)
       OR v_list ->> 'schedule_mode' <> 'rolling_templates' OR jsonb_array_length(v_list -> 'weekly_templates') <> 3
       OR v_list ->> 'timezone' <> 'Europe/London' OR (v_list ->> 'horizon_weeks')::integer <> 4
       OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_list -> 'cohorts') e
                       WHERE (e ->> 'cohort_id')::uuid = v_first AND (e ->> 'generated')::boolean) THEN
        PERFORM pg_temp.fail('the seller''s list does not hide the empty chain or answer the schedule: ' || v_list::text);
    END IF;
    IF projects.fn_open_template_cohorts(now(), 200, current_setting('probe.bp')::uuid) <> 0 THEN
        PERFORM pg_temp.fail('the generator reopened a chain that was cancelled');
    END IF;
    RAISE NOTICE 'PASS an empty chain is cancelled quietly at its close, unlisted and never reopened; a seated chain goes active';
END $$;
-- #endregion

-- #region 7. A generated chain cancels exactly as a manual cohort
DO $$
DECLARE
    v_third uuid;
    v_m uuid;
    v_out jsonb;
BEGIN
    SELECT id INTO v_third FROM pg_temp.chains() WHERE status = 'enrolling' ORDER BY chain_start LIMIT 1;
    v_m := pg_temp.seat('c', v_third);
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.host'), 'role', 'authenticated')::text, true);
    v_out := projects.cancel_cohort(v_third);
    IF (v_out ->> 'seats_refunded')::integer <> 1 OR (v_out ->> 'refunded_minor')::bigint <= 0
       OR v_out ->> 'reason' <> 'provider' THEN
        PERFORM pg_temp.fail('a generated chain did not cancel like a manual cohort: ' || v_out::text);
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows e WHERE e.cohort_membership_id = v_m AND e.status <> 'refunded') THEN
        PERFORM pg_temp.fail('the generated chain''s seat escrow was not refunded');
    END IF;
    RAISE NOTICE 'PASS a generated chain cancels as a manual cohort does: its seat refunded in full';
END $$;
-- #endregion

-- #region 8. A chain that clashes with the seller's calendar is skipped
DO $$
DECLARE
    v_bp uuid := current_setting('probe.bp')::uuid;
    v_opened integer;
BEGIN
    -- Something else on the seller's calendar at Thu 22 Apr 2027 06:10 BST, the next chain's session 1.
    UPDATE scheduling.events ev
       SET starts_at = '2027-04-22 05:10+00', ends_at = '2027-04-22 06:10+00'
      FROM projects.session_events se
      JOIN projects.cohorts c ON c.id = se.cohort_id
     WHERE ev.source_session_event_id = se.id AND c.chain_start = '2027-04-15 05:10+00'
       AND se.start_time = '2027-04-15 05:10+00';
    IF NOT FOUND THEN PERFORM pg_temp.fail('premise: no mirror to move onto the clash'); END IF;
    v_opened := projects.fn_open_template_cohorts('2027-03-28 12:00+00', 200, v_bp);
    IF v_opened <> 0 OR EXISTS (SELECT 1 FROM projects.cohorts c WHERE c.chain_start = '2027-04-22 05:10+00') THEN
        PERFORM pg_temp.fail('a chain whose session 1 clashes with the calendar was opened');
    END IF;
    RAISE NOTICE 'PASS a chain whose session 1 clashes with the seller''s calendar is skipped';
END $$;
-- #endregion

-- #region 9. The grants
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM pg_temp.as_user('host');
    IF pg_temp.sqlstate_of('SELECT projects.fn_open_template_cohorts()') <> '42501' THEN
        PERFORM pg_temp.fail('a signed-in client ran the generator');
    END IF;
    RAISE NOTICE 'PASS no client runs the generator';
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
