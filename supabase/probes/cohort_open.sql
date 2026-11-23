-- =============================================================================================
-- Probe: a seller opens a cohort on a group-session listing, and the waitlist hears about it
-- (Decision #498, MARKETPLACE SC3; USER_FLOWS MK-40, MK-12).
--
--   1. Before: the published group listing offers no cohort, and no client writes projects.cohorts.
--   2. projects.open_cohort — only a seller who manages the listing; its terms refused when they do
--      not fit (seats, minimum, close, cadence, dates); a weekly cohort of the listing's sitting count
--      with every sitting on the provider's calendar; the public offer discloses its minimum, close and
--      cadence; a second open refuses while the first takes bookings.
--   3. Opening wakes the waitlist: the job's next run invites the queue in order, each with a one-seat
--      48-hour hold; a sitting cannot be scheduled before the close.
--   4. The close binds by its instant: no seat after it, no public offer, and the sweep makes the
--      cohort active, puts an unused invite back to waiting where it stood, and tells the seller it
--      closed under its minimum.
--   5. projects.cancel_cohort — only the seller; under_filled; every seat refunded in full (money
--      conserved: what left the escrows reached the payers' wallets); the refunded buyer's converted
--      place reopens at its original queue time; sittings and mirrors cancelled; seat-holders and the
--      queue told; a second cancel refuses; a 1-1 cohort and a started cohort refuse.
--   6. get_listing_cohorts answers its manager only; the grants.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/cohort_open.sql
-- A clean run prints only PASS notices; any failure raises `PROBE FAIL …` and aborts.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.fail(p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'PROBE FAIL %', p_what;
END;
$$;

-- Run p_sql as whoever's claims are set and answer its SQLSTATE ('' when it succeeded).
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

-- #region 0. Fixtures (as postgres)
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
         ORDER BY u.user_id LIMIT 5
    ) p;
    IF COALESCE(array_length(v_people, 1), 0) < 5 THEN
        PERFORM pg_temp.fail('no fixture: need five adults besides the seller');
    END IF;

    -- The probe owns this listing for its transaction: three two-hour sittings, a cohort of four, no
    -- queue, no cohort, no engagement, and the seller's calendar clear over the probe's weeks.
    UPDATE marketplace.service_blueprints SET session_count = 3, session_minutes = 120, max_seats_per_cohort = 4
     WHERE id = v_bp.id;
    DELETE FROM projects.waitlists WHERE service_blueprint_id = v_bp.id;
    UPDATE projects.cohorts c SET status = 'cancelled'
      FROM projects.projects p
     WHERE p.id = c.project_id AND p.source_blueprint_id = v_bp.id AND c.status IN ('enrolling', 'active');

    PERFORM set_config('probe.bp', v_bp.id::text, true);
    PERFORM set_config('probe.slug', v_bp.slug, true);
    PERFORM set_config('probe.listing', v_listing::text, true);
    PERFORM set_config('probe.host', v_bp.host::text, true);
    PERFORM set_config('probe.a', v_people[1]::text, true);
    PERFORM set_config('probe.b', v_people[2]::text, true);
    PERFORM set_config('probe.c', v_people[3]::text, true);
    PERFORM set_config('probe.w', v_people[4]::text, true);
    PERFORM set_config('probe.x', v_people[5]::text, true);
    -- The first sitting ten days out at 18:00 UTC; enrolment closes a day before it.
    PERFORM set_config('probe.first', (date_trunc('day', now()) + interval '10 days 18 hours')::text, true);
    RAISE NOTICE 'fixture listing=% seller=%', v_bp.slug, v_bp.host;
END $$;

CREATE FUNCTION pg_temp.as_user(p_who text) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.' || p_who), 'role', 'authenticated')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO PUBLIC;
-- #endregion

-- #region 1. Before: waitlist-only, and no direct writes (as the seller)
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM pg_temp.as_user('host');
    IF projects.get_cohort_offer(current_setting('probe.bp')::uuid) IS NOT NULL THEN
        PERFORM pg_temp.fail('premise: the listing already offers a cohort');
    END IF;
    IF pg_temp.sqlstate_of(format(
        'INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats) VALUES (%L, %L, %L, 4)',
        gen_random_uuid(), gen_random_uuid(), 'x')) <> '42501' THEN
        PERFORM pg_temp.fail('a client wrote projects.cohorts directly');
    END IF;
    RAISE NOTICE 'PASS before opening, the listing offers no cohort and no client writes one';

    -- Two buyers queue before any cohort exists.
    PERFORM pg_temp.as_user('a');
    PERFORM projects.join_waitlist(current_setting('probe.bp')::uuid);
    PERFORM pg_temp.as_user('b');
    PERFORM projects.join_waitlist(current_setting('probe.bp')::uuid);
END $$;
RESET ROLE;
-- The queue order the invites must follow: a, then b.
UPDATE projects.waitlists SET queued_at = now() - interval '2 hours'
 WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.a')::uuid;
UPDATE projects.waitlists SET queued_at = now() - interval '1 hour'
 WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.b')::uuid;
-- #endregion

-- #region 2. Opening: who may, which terms, the cohort and its sittings
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_listing uuid := current_setting('probe.listing')::uuid;
    v_first timestamptz := current_setting('probe.first')::timestamptz;
    v_close timestamptz := current_setting('probe.first')::timestamptz - interval '1 day';
    v jsonb;
    v_offer jsonb;
    s text;
    k integer;
BEGIN
    PERFORM pg_temp.as_user('a');
    s := pg_temp.sqlstate_of(format('SELECT projects.open_cohort(%L, %L, %L)', v_listing, v_first, 'weekly'));
    IF s <> 'P0002' THEN PERFORM pg_temp.fail('a stranger opened a cohort, or was refused as ' || s); END IF;
    RAISE NOTICE 'PASS only a seller who manages the listing opens a cohort (P0002 otherwise)';

    PERFORM pg_temp.as_user('host');
    FOREACH s IN ARRAY ARRAY[
        format('SELECT projects.open_cohort(%L, %L, %L)', v_listing, now() - interval '1 hour', 'weekly'),
        format('SELECT projects.open_cohort(%L, %L)', v_listing, v_first),
        format('SELECT projects.open_cohort(%L, %L, %L, ARRAY[%L]::timestamptz[])', v_listing, v_first, 'fixed', v_first + interval '7 days'),
        format('SELECT projects.open_cohort(%L, %L, %L, ARRAY[%L]::timestamptz[])', v_listing, v_first, 'weekly', v_first + interval '7 days'),
        format('SELECT projects.open_cohort(%L, %L, %L, NULL, 0)', v_listing, v_first, 'weekly'),
        format('SELECT projects.open_cohort(%L, %L, %L, NULL, 4, 5, %L)', v_listing, v_first, 'weekly', v_close),
        format('SELECT projects.open_cohort(%L, %L, %L, NULL, 4, 3, %L)', v_listing, v_first, 'weekly', v_first + interval '1 hour'),
        format('SELECT projects.open_cohort(%L, %L, %L, NULL, 4, 3)', v_listing, v_first, 'weekly'),
        format('SELECT projects.open_cohort(%L, %L, %L, ARRAY[%L, %L]::timestamptz[])', v_listing, v_first, 'fixed',
            v_first + interval '1 hour', v_first + interval '7 days')
    ] LOOP
        IF pg_temp.sqlstate_of(s) <> '22023' THEN
            PERFORM pg_temp.fail('terms that do not fit were not refused 22023: ' || s);
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS a passed start, a missing or mismatched cadence, seats, a minimum over the size, a late close and overlapping dates are refused 22023';

    v := projects.open_cohort(v_listing, v_first, 'weekly', NULL, 4, 3, v_close, 'Winter cohort');
    PERFORM set_config('probe.cohort', v ->> 'cohort_id', true);
    IF v ->> 'status' <> 'enrolling' OR (v ->> 'max_seats')::int <> 4 OR (v ->> 'min_seats')::int <> 3
       OR (v ->> 'enrolment_closes_at')::timestamptz <> v_close OR v ->> 'cadence' <> 'weekly'
       OR jsonb_array_length(v -> 'sittings') <> 3 THEN
        PERFORM pg_temp.fail('the opened cohort is not what was asked: ' || v::text);
    END IF;
    FOR k IN 0 .. 2 LOOP
        IF (v -> 'sittings' -> k ->> 'starts_at')::timestamptz <> v_first + make_interval(days => 7 * k)
           OR (v -> 'sittings' -> k ->> 'ends_at')::timestamptz <> v_first + make_interval(days => 7 * k, hours => 2)
           OR v -> 'sittings' -> k ->> 'calendar_event_id' IS NULL
           OR v -> 'sittings' -> k ->> 'title' <> format('Winter cohort — session %s of 3', k + 1) THEN
            PERFORM pg_temp.fail('sitting ' || k || ' is not a week after the last, two hours long and on the calendar: ' || (v -> 'sittings' -> k)::text);
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS open_cohort makes an enrolling cohort of four, minimum three, closing a day ahead, with three weekly two-hour sittings';

    v_offer := projects.get_cohort_offer(current_setting('probe.bp')::uuid);
    IF v_offer IS NULL OR v_offer ->> 'cohort_id' <> current_setting('probe.cohort')
       OR (v_offer ->> 'min_seats')::int <> 3 OR (v_offer ->> 'enrolment_closes_at')::timestamptz <> v_close
       OR v_offer ->> 'cadence' <> 'weekly' OR (v_offer ->> 'first_start')::timestamptz <> v_first
       OR jsonb_array_length(v_offer -> 'sittings') <> 3 THEN
        PERFORM pg_temp.fail('the public offer does not disclose the cohort''s terms: ' || COALESCE(v_offer::text, 'NULL'));
    END IF;
    RAISE NOTICE 'PASS the listing now offers the cohort, with its minimum, close, cadence and sittings';

    s := pg_temp.sqlstate_of(format('SELECT projects.open_cohort(%L, %L, %L)', v_listing, v_first + interval '30 days', 'weekly'));
    IF s <> 'PS409' THEN PERFORM pg_temp.fail('a second cohort opened while the first takes bookings, or refused as ' || s); END IF;
    RAISE NOTICE 'PASS a second open refuses PS409 while a cohort takes bookings';

    s := pg_temp.sqlstate_of(format('SELECT projects.schedule_sitting(%L, %L, %L, %L)', current_setting('probe.cohort'),
        'Early bird', v_close - interval '3 hours', v_close - interval '1 hour'));
    IF s <> 'PS409' THEN PERFORM pg_temp.fail('a sitting was scheduled before the enrolment close, or refused as ' || s); END IF;
    RAISE NOTICE 'PASS no sitting may start before the cohort''s enrolment close';
END $$;
RESET ROLE;

DO $$
BEGIN
    IF (SELECT count(*) FROM scheduling.events ev
          JOIN projects.session_events se ON se.id = ev.source_session_event_id
         WHERE se.cohort_id = current_setting('probe.cohort')::uuid
           AND ev.capacity = 4 AND ev.status = 'confirmed' AND ev.kind = 'session') <> 3 THEN
        PERFORM pg_temp.fail('the three sittings are not mirrored onto the seller''s calendar');
    END IF;
    IF (SELECT p.session_kind FROM projects.cohorts c JOIN projects.projects p ON p.id = c.project_id
         WHERE c.id = current_setting('probe.cohort')::uuid) <> 'group' THEN
        PERFORM pg_temp.fail('the cohort does not hang off a group engagement');
    END IF;
    RAISE NOTICE 'PASS the sittings are on the seller''s calendar, on a group engagement';
END $$;
-- #endregion

-- #region 3. The waitlist hears: invited in order, each seat held 48 hours
DO $$
DECLARE
    v jsonb;
    v_a projects.waitlists;
    v_b projects.waitlists;
BEGIN
    v := projects.fn_waitlist_dispatch(now());
    SELECT * INTO v_a FROM projects.waitlists
     WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.a')::uuid;
    SELECT * INTO v_b FROM projects.waitlists
     WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.b')::uuid;
    IF (v ->> 'invited')::int <> 2 OR v_a.status <> 'invited' OR v_b.status <> 'invited'
       OR v_a.cohort_id <> current_setting('probe.cohort')::uuid THEN
        PERFORM pg_temp.fail('opening did not wake the queue: ' || v::text);
    END IF;
    IF v_a.invite_expires_at <> now() + interval '48 hours'
       OR (SELECT h.expires_at FROM projects.cohort_seat_holds h WHERE h.id = v_a.hold_id) <> now() + interval '48 hours'
       OR (SELECT h.seats FROM projects.cohort_seat_holds h WHERE h.id = v_a.hold_id) <> 1 THEN
        PERFORM pg_temp.fail('the first invite does not hold one seat for 48 hours');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notifications n
                    WHERE n.user_id = current_setting('probe.a')::uuid AND n.type = 'waitlist.invited'
                      AND n.entity_id = v_a.id) THEN
        PERFORM pg_temp.fail('the first person in the queue was not told');
    END IF;
    RAISE NOTICE 'PASS the next waitlist run invites the queue in order, the first holding one seat for 48 hours, and tells them';
END $$;
-- #endregion

-- #region 4. Seats, then the close: no seat after it, and the sweep
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_c uuid := current_setting('probe.c')::uuid;
    v_type text;
    v_hold uuid;
    v_m uuid;
BEGIN
    -- a buys their held seat; c walks in for one of the two seats left.
    v_type := finance.fn_person_wallet_type(v_a);
    PERFORM finance.fn_ensure_wallet(v_type, v_a, 'USD');
    PERFORM finance.fn_wallet_credit(v_a, v_type, 'USD', 20000, 'topup', NULL, NULL);
    SELECT hold_id INTO v_hold FROM projects.waitlists
     WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = v_a;
    v_m := projects.fn_confirm_seat(v_hold, v_a, v_type, v_a, 9000, 'USD', NULL);
    PERFORM set_config('probe.m_a', v_m::text, true);

    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
    v_hold := (projects.reserve_seat(current_setting('probe.cohort')::uuid, 1) ->> 'hold_id')::uuid;
    v_type := finance.fn_person_wallet_type(v_c);
    PERFORM finance.fn_ensure_wallet(v_type, v_c, 'USD');
    PERFORM finance.fn_wallet_credit(v_c, v_type, 'USD', 20000, 'topup', NULL, NULL);
    v_m := projects.fn_confirm_seat(v_hold, v_c, v_type, v_c, 9000, 'USD', NULL);
    PERFORM set_config('probe.m_c', v_m::text, true);
    RAISE NOTICE 'PASS an invited buyer and a walk-in each buy a seat';

    -- The close arrives (moved to just past, the clock being fixed inside a transaction).
    UPDATE projects.cohorts SET enrolment_closes_at = now() - interval '1 second'
     WHERE id = current_setting('probe.cohort')::uuid;
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
    s text;
BEGIN
    PERFORM pg_temp.as_user('x');
    s := pg_temp.sqlstate_of(format('SELECT projects.reserve_seat(%L, 1)', current_setting('probe.cohort')));
    IF s <> 'PS409' THEN PERFORM pg_temp.fail('a seat was reserved after the enrolment close, or refused as ' || s); END IF;
    IF projects.get_cohort_offer(current_setting('probe.bp')::uuid) IS NOT NULL THEN
        PERFORM pg_temp.fail('the listing still offers a cohort whose enrolment has closed');
    END IF;
    RAISE NOTICE 'PASS past the close no seat is sold and the listing offers no cohort, before any sweep';
END $$;
RESET ROLE;

DO $$
DECLARE
    v jsonb;
    v_b projects.waitlists;
BEGIN
    v := projects.fn_waitlist_dispatch(now());
    SELECT * INTO v_b FROM projects.waitlists
     WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.b')::uuid;
    IF (SELECT status FROM projects.cohorts WHERE id = current_setting('probe.cohort')::uuid) <> 'active'
       OR (v ->> 'closed')::int < 1 THEN
        PERFORM pg_temp.fail('the sweep did not close the cohort''s enrolment: ' || v::text);
    END IF;
    IF v_b.status <> 'waiting' OR v_b.hold_id IS NOT NULL OR v_b.queued_at <> now() - interval '1 hour' THEN
        PERFORM pg_temp.fail('the unused invite did not go back to waiting where it stood');
    END IF;
    IF EXISTS (SELECT 1 FROM projects.cohort_seat_holds h
                WHERE h.cohort_id = current_setting('probe.cohort')::uuid AND h.status = 'held') THEN
        PERFORM pg_temp.fail('a hold is still live on a closed cohort');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notifications n
                    WHERE n.user_id = current_setting('probe.host')::uuid AND n.type = 'session.cohort_under_filled'
                      AND n.entity_id = current_setting('probe.cohort')::uuid) THEN
        PERFORM pg_temp.fail('the seller was not told the cohort closed under its minimum');
    END IF;
    RAISE NOTICE 'PASS the sweep makes the cohort active, returns the unused invite to its place, and tells the seller it is under its minimum (2 of 3)';
END $$;
-- #endregion

-- #region 5. Cancelling: who may, the refunds, the queue
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v jsonb;
    s text;
BEGIN
    PERFORM pg_temp.as_user('a');
    s := pg_temp.sqlstate_of(format('SELECT projects.cancel_cohort(%L)', current_setting('probe.cohort')));
    IF s <> '42501' THEN PERFORM pg_temp.fail('a seat-holder cancelled the cohort, or was refused as ' || s); END IF;

    PERFORM pg_temp.as_user('host');
    v := projects.get_listing_cohorts(current_setting('probe.listing')::uuid);
    IF (v ->> 'session_count')::int <> 3 OR v -> 'cohorts' -> 0 ->> 'phase' <> 'closed'
       OR (v -> 'cohorts' -> 0 ->> 'seats_paid')::int <> 2 OR (v -> 'cohorts' -> 0 ->> 'under_filled')::boolean IS NOT TRUE
       OR (v -> 'cohorts' -> 0 ->> 'can_cancel')::boolean IS NOT TRUE THEN
        PERFORM pg_temp.fail('the seller''s read does not show a closed, under-filled, cancellable cohort: ' || v::text);
    END IF;
    PERFORM pg_temp.as_user('a');
    IF pg_temp.sqlstate_of(format('SELECT projects.get_listing_cohorts(%L)', current_setting('probe.listing'))) <> 'P0002' THEN
        PERFORM pg_temp.fail('someone who does not manage the listing read its cohorts');
    END IF;
    RAISE NOTICE 'PASS only the seller cancels or reads the cohorts; the read says closed, 2 paid, under-filled, cancellable';
END $$;
RESET ROLE;

-- The money before the cancel.
DO $$
BEGIN
    PERFORM set_config('probe.before_wallets', (
        SELECT COALESCE(sum(w.balance_cents), 0)::text FROM finance.wallets w
         WHERE w.owner_id IN (current_setting('probe.a')::uuid, current_setting('probe.c')::uuid)), true);
    PERFORM set_config('probe.before_held', (
        SELECT COALESCE(sum(e.amount_cents), 0)::text FROM finance.escrows e
         WHERE e.cohort_membership_id IN (current_setting('probe.m_a')::uuid, current_setting('probe.m_c')::uuid)
           AND e.status = 'held'), true);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v jsonb;
BEGIN
    PERFORM pg_temp.as_user('host');
    v := projects.cancel_cohort(current_setting('probe.cohort')::uuid);
    PERFORM set_config('probe.cancel', v::text, true);
    IF v ->> 'reason' <> 'under_filled' OR (v ->> 'seats_refunded')::int <> 2
       OR (v ->> 'refunded_minor')::bigint <> 18000 OR v ->> 'currency' <> 'USD' THEN
        PERFORM pg_temp.fail('the cancel did not refund both seats as under-filled: ' || v::text);
    END IF;
    IF pg_temp.sqlstate_of(format('SELECT projects.cancel_cohort(%L)', current_setting('probe.cohort'))) <> 'PS409' THEN
        PERFORM pg_temp.fail('a cancelled cohort was cancelled again');
    END IF;
    RAISE NOTICE 'PASS the seller cancels the under-filled cohort: both seats refunded, 180.00 USD; a second cancel refuses PS409';
END $$;
RESET ROLE;

DO $$
DECLARE
    v_cohort uuid := current_setting('probe.cohort')::uuid;
    v_a projects.waitlists;
BEGIN
    IF (SELECT COALESCE(sum(w.balance_cents), 0) FROM finance.wallets w
         WHERE w.owner_id IN (current_setting('probe.a')::uuid, current_setting('probe.c')::uuid))
       <> current_setting('probe.before_wallets')::bigint + current_setting('probe.before_held')::bigint THEN
        PERFORM pg_temp.fail('the refunds did not reach the payers'' wallets in full');
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows e
                WHERE e.cohort_membership_id IN (current_setting('probe.m_a')::uuid, current_setting('probe.m_c')::uuid)
                  AND e.status <> 'refunded') THEN
        PERFORM pg_temp.fail('a seat escrow was not refunded');
    END IF;
    RAISE NOTICE 'PASS money is conserved: what the two seat escrows held is back in the buyers'' wallets, and both escrows read refunded';

    IF (SELECT status FROM projects.cohorts WHERE id = v_cohort) <> 'cancelled'
       OR (SELECT cancel_reason FROM projects.cohorts WHERE id = v_cohort) <> 'under_filled'
       OR (SELECT cancelled_at FROM projects.cohorts WHERE id = v_cohort) IS NULL
       OR EXISTS (SELECT 1 FROM projects.cohort_memberships WHERE cohort_id = v_cohort AND status <> 'cancelled')
       OR EXISTS (SELECT 1 FROM projects.session_events WHERE cohort_id = v_cohort AND status <> 'cancelled_by_freelancer')
       OR EXISTS (SELECT 1 FROM scheduling.events ev JOIN projects.session_events se ON se.id = ev.source_session_event_id
                   WHERE se.cohort_id = v_cohort AND ev.status <> 'cancelled') THEN
        PERFORM pg_temp.fail('the cohort, its seats, sittings or calendar mirrors were not all cancelled');
    END IF;
    RAISE NOTICE 'PASS the cohort, both seats, the three sittings and their calendar entries read cancelled';

    SELECT * INTO v_a FROM projects.waitlists
     WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.a')::uuid;
    IF v_a.status <> 'waiting' OR v_a.resolved_at IS NOT NULL OR v_a.queued_at <> now() - interval '2 hours' THEN
        PERFORM pg_temp.fail('the refunded buyer''s place did not reopen at its original queue time');
    END IF;
    IF EXISTS (SELECT 1 FROM projects.waitlists
                WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.c')::uuid) THEN
        PERFORM pg_temp.fail('the walk-in buyer, who never queued, was given a place');
    END IF;
    RAISE NOTICE 'PASS the refunded buyer is back on the waitlist first, at their original time; the walk-in is not queued for them';

    IF (SELECT count(*) FROM comms.notifications n
         WHERE n.type = 'session.cancelled' AND n.entity_table = 'projects.cohort_memberships'
           AND n.entity_id IN (current_setting('probe.m_a')::uuid, current_setting('probe.m_c')::uuid)) <> 2
       OR NOT EXISTS (SELECT 1 FROM comms.notifications n
                       WHERE n.user_id = current_setting('probe.b')::uuid AND n.type = 'waitlist.cohort_cancelled')
       OR EXISTS (SELECT 1 FROM comms.notifications n
                   WHERE n.user_id = current_setting('probe.a')::uuid AND n.type = 'waitlist.cohort_cancelled') THEN
        PERFORM pg_temp.fail('the seat-holders and the queue were not each told once');
    END IF;
    RAISE NOTICE 'PASS both seat-holders are told of their refund, and the person still waiting is told the cohort was cancelled';
END $$;

-- A new cohort may open now; a started one, and a 1-1's, cannot be cancelled.
DO $$
DECLARE
    v_project uuid;
    v_stage uuid;
    v_one uuid;
BEGIN
    INSERT INTO projects.projects (owner_user_id, title, format, session_kind, status, visibility,
                                   publish_visibility, source_blueprint_id, currency)
    VALUES (current_setting('probe.host')::uuid, 'Probe 1-1', 'session', 'normal', 'active', 'unlisted', 'unlisted',
            current_setting('probe.bp')::uuid, 'USD')
    RETURNING id INTO v_project;
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_project, 'Sessions', 0)
    RETURNING id INTO v_stage;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_project, v_stage, 'Probe 1-1', 1, 'active') RETURNING id INTO v_one;
    PERFORM set_config('probe.one', v_one::text, true);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v jsonb;
    s text;
BEGIN
    PERFORM pg_temp.as_user('host');
    v := projects.open_cohort(current_setting('probe.listing')::uuid,
        current_setting('probe.first')::timestamptz + interval '21 days', 'fixed',
        ARRAY[current_setting('probe.first')::timestamptz + interval '23 days',
              current_setting('probe.first')::timestamptz + interval '30 days']);
    PERFORM set_config('probe.cohort2', v ->> 'cohort_id', true);
    IF v ->> 'cadence' <> 'fixed' OR jsonb_array_length(v -> 'sittings') <> 3
       OR (v -> 'sittings' -> 1 ->> 'starts_at')::timestamptz <> current_setting('probe.first')::timestamptz + interval '23 days' THEN
        PERFORM pg_temp.fail('a fixed-date cohort did not open on the seller''s dates: ' || v::text);
    END IF;
    RAISE NOTICE 'PASS with the first cancelled, the next cohort opens on fixed dates the seller picked';

    s := pg_temp.sqlstate_of(format('SELECT projects.cancel_cohort(%L)', current_setting('probe.one')));
    IF s <> 'PU422' THEN PERFORM pg_temp.fail('a 1-1 cohort was cancelled as a cohort, or refused as ' || s); END IF;
    RAISE NOTICE 'PASS a 1-1 booking''s cohort is not cancelled as a cohort (PU422)';
END $$;
RESET ROLE;

UPDATE projects.session_events SET start_time = now() - interval '1 hour', end_time = now() + interval '1 hour'
 WHERE id = (SELECT se.id FROM projects.session_events se WHERE se.cohort_id = current_setting('probe.cohort2')::uuid
              ORDER BY se.start_time LIMIT 1);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    s text;
BEGIN
    PERFORM pg_temp.as_user('host');
    s := pg_temp.sqlstate_of(format('SELECT projects.cancel_cohort(%L)', current_setting('probe.cohort2')));
    IF s <> 'PS409' THEN PERFORM pg_temp.fail('a cohort whose first sitting has started was cancelled, or refused as ' || s); END IF;
    RAISE NOTICE 'PASS a cohort whose first sitting has started is not cancelled whole (PS409)';
END $$;
RESET ROLE;
-- #endregion

-- #region 6. Grants
DO $$
BEGIN
    IF NOT has_function_privilege('authenticated',
            'projects.open_cohort(uuid, timestamptz, text, timestamptz[], integer, integer, timestamptz, text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'projects.cancel_cohort(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'projects.get_listing_cohorts(uuid)', 'EXECUTE') THEN
        PERFORM pg_temp.fail('a signed-in seller cannot reach the cohort doors');
    END IF;
    IF has_function_privilege('anon',
            'projects.open_cohort(uuid, timestamptz, text, timestamptz[], integer, integer, timestamptz, text)', 'EXECUTE')
       OR has_function_privilege('anon', 'projects.cancel_cohort(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'projects.get_listing_cohorts(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fn_close_cohort_enrolment(timestamptz)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fn_write_group_sitting(uuid, text, timestamptz, timestamptz)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fn_session_engagement_for(uuid, text)', 'EXECUTE') THEN
        PERFORM pg_temp.fail('a guest reaches a cohort door, or a client reaches an internal step');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notification_types WHERE key = 'session.cohort_under_filled')
       OR NOT EXISTS (SELECT 1 FROM comms.notification_types WHERE key = 'waitlist.cohort_cancelled') THEN
        PERFORM pg_temp.fail('a cohort notice type is missing from the catalog');
    END IF;
    RAISE NOTICE 'PASS the doors are the signed-in seller''s, the sweep and the sitting writer are internal, and both notice types exist';
END $$;
-- #endregion

ROLLBACK;
