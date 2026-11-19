-- =============================================================================================
-- Probe: a cohort waitlist invites in order, holds a seat, and converts or expires (Decision #455,
-- LV4, USER_FLOWS MK-13).
--
--   1. projects.join_waitlist — a published group session only, never the seller's own, idempotent;
--      no client may write a place directly, so nobody can jump the queue or invite themselves.
--   2. The queue fence: a seat that frees belongs to the queue before the job runs — a walk-in is
--      refused it and the public offer counts it taken.
--   3. First in, first out: the job invites the head of the queue, one per free seat, with a one-seat
--      hold of waitlist_invite_hold_hours and an in-app notice; the hold blocks the next person and the
--      walk-in; the invitee's own reserve renews the hold without shortening it.
--   4. Expiry: a lapsed invite reads expired at once, the job expires it (hold released, buyer told)
--      and invites the next person; the expired buyer rejoins at the back.
--   5. A purchase converts the place (projects.fn_confirm_seat).
--   6. The seller's read answers its manager only; grants, the job row, the dial and the notice types.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/waitlist_invite.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. The seed has a
-- published group-session listing and no session engagement, so one is built from it: a two-seat
-- cohort, both seats sold, three buyers waiting and a fourth who never joined.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_bp record;
    v_listing uuid;
    v_other uuid;
    v_people uuid[];
    v_project uuid;
    v_stage uuid;
    v_cohort uuid;
BEGIN
    SELECT sb.id, sb.slug, sb.freelancer_profile_id AS host, sb.owner_team_id INTO v_bp
      FROM marketplace.service_blueprints sb
     WHERE sb.delivery_model = 'group_session' AND sb.is_published
       AND EXISTS (SELECT 1 FROM catalogue.listings l WHERE l.service_blueprint_id = sb.id)
     ORDER BY sb.slug LIMIT 1;
    IF v_bp.id IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a published group-session listing (deno task db:reset)';
    END IF;
    SELECT l.id INTO v_listing FROM catalogue.listings l WHERE l.service_blueprint_id = v_bp.id LIMIT 1;
    SELECT sb.id INTO v_other FROM marketplace.service_blueprints sb
     WHERE sb.is_published AND sb.delivery_model <> 'group_session' ORDER BY sb.slug LIMIT 1;

    SELECT array_agg(p.user_id ORDER BY p.user_id) INTO v_people FROM (
        SELECT u.user_id FROM org.users_public u
         WHERE u.user_id <> v_bp.host
           AND NOT org.fn_is_minor(u.user_id)
           AND (v_bp.owner_team_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM org.team_members tm WHERE tm.team_id = v_bp.owner_team_id AND tm.user_id = u.user_id))
         ORDER BY u.user_id LIMIT 6
    ) p;
    IF COALESCE(array_length(v_people, 1), 0) < 6 OR v_other IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need six adults besides the seller and a published listing of another model';
    END IF;

    -- The probe owns this listing's queue and cohorts for the length of its transaction.
    DELETE FROM projects.waitlists WHERE service_blueprint_id = v_bp.id;
    UPDATE projects.cohorts c SET status = 'cancelled'
      FROM projects.projects p
     WHERE p.id = c.project_id AND p.source_blueprint_id = v_bp.id AND c.status = 'enrolling';

    INSERT INTO projects.projects (owner_user_id, title, format, session_kind, status, visibility,
                                   publish_visibility, source_blueprint_id)
    VALUES (v_bp.host, 'Probe waitlist cohort', 'session', 'group', 'active', 'unlisted', 'unlisted', v_bp.id)
    RETURNING id INTO v_project;
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_project, 'Sessions', 0)
    RETURNING id INTO v_stage;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_project, v_stage, 'Probe waitlist cohort', 2, 'enrolling') RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id, seats, status)
    VALUES (v_cohort, v_people[1], 1, 'active'), (v_cohort, v_people[2], 1, 'active');

    PERFORM set_config('probe.bp', v_bp.id::text, true);
    PERFORM set_config('probe.slug', v_bp.slug, true);
    PERFORM set_config('probe.host', v_bp.host::text, true);
    PERFORM set_config('probe.listing', v_listing::text, true);
    PERFORM set_config('probe.other', v_other::text, true);
    PERFORM set_config('probe.cohort', v_cohort::text, true);
    PERFORM set_config('probe.m1', v_people[1]::text, true);
    PERFORM set_config('probe.m2', v_people[2]::text, true);
    PERFORM set_config('probe.a', v_people[3]::text, true);
    PERFORM set_config('probe.b', v_people[4]::text, true);
    PERFORM set_config('probe.c', v_people[5]::text, true);
    PERFORM set_config('probe.w', v_people[6]::text, true);
    RAISE NOTICE 'fixture listing=% cohort=% (2 seats, both sold)', v_bp.slug, v_cohort;
END $$;

CREATE FUNCTION pg_temp.claims(p_who text) RETURNS text LANGUAGE sql AS $$
    SELECT json_build_object('sub', current_setting('probe.' || p_who), 'role', 'authenticated')::text;
$$;
-- #endregion

-- #region 1. Joining: who may, idempotent, and no direct writes (as buyers)
DO $$
DECLARE
    who text;
BEGIN
    FOREACH who IN ARRAY ARRAY['host', 'a', 'b', 'c', 'w'] LOOP
        PERFORM set_config('probe.claims_' || who, pg_temp.claims(who), true);
    END LOOP;
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
    v jsonb;
    who text;
BEGIN
    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_host'), true);
    BEGIN
        PERFORM projects.join_waitlist(current_setting('probe.bp')::uuid);
        RAISE EXCEPTION 'FAIL the seller joined their own waitlist';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
        IF SQLSTATE <> 'PU422' THEN
            RAISE EXCEPTION 'FAIL own-listing join refused for the wrong reason: % %', SQLSTATE, SQLERRM;
        END IF;
        RAISE NOTICE 'PASS the seller cannot join their own listing''s waitlist';
    END;

    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_w'), true);
    BEGIN
        PERFORM projects.join_waitlist(current_setting('probe.other')::uuid);
        RAISE EXCEPTION 'FAIL a listing that is not a group session took a waitlist place';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
        IF SQLSTATE <> 'PU422' THEN
            RAISE EXCEPTION 'FAIL non-cohort join refused for the wrong reason: % %', SQLSTATE, SQLERRM;
        END IF;
        RAISE NOTICE 'PASS only a group session has a waitlist';
    END;

    FOREACH who IN ARRAY ARRAY['a', 'b', 'c'] LOOP
        PERFORM set_config('request.jwt.claims', current_setting('probe.claims_' || who), true);
        v := projects.join_waitlist(current_setting('probe.bp')::uuid);
        IF v ->> 'status' <> 'waiting' OR (v ->> 'already')::boolean THEN
            RAISE EXCEPTION 'FAIL % joining answered %', who, v;
        END IF;
    END LOOP;
    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_a'), true);
    v := projects.join_waitlist(current_setting('probe.bp')::uuid);
    IF v ->> 'status' <> 'waiting' OR NOT (v ->> 'already')::boolean THEN
        RAISE EXCEPTION 'FAIL a repeat join answered %', v;
    END IF;
    RAISE NOTICE 'PASS three buyers join; a repeat answers the place already held';

    BEGIN
        UPDATE projects.waitlists SET queued_at = now() - interval '10 years'
         WHERE user_id = current_setting('probe.a')::uuid;
        RAISE EXCEPTION 'FAIL a buyer rewrote their place in the queue';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a buyer cannot rewrite their place in the queue';
    END;
    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_w'), true);
    BEGIN
        INSERT INTO projects.waitlists (service_blueprint_id, user_id, status, queued_at)
        VALUES (current_setting('probe.bp')::uuid, current_setting('probe.w')::uuid, 'waiting', now() - interval '10 years');
        RAISE EXCEPTION 'FAIL a buyer wrote their own backdated place';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a buyer cannot insert a place of their own making';
    END;
END $$;

RESET ROLE;
-- Joined in one transaction, so the probe spaces the three places out: A first, then B, then C.
UPDATE projects.waitlists SET queued_at = now() - interval '3 hours'
 WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.a')::uuid;
UPDATE projects.waitlists SET queued_at = now() - interval '2 hours'
 WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.b')::uuid;
UPDATE projects.waitlists SET queued_at = now() - interval '1 hour'
 WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.c')::uuid;
-- #endregion

-- #region 2. The queue fence: a freed seat is the queue's before the job runs
DO $$
DECLARE
    v jsonb;
BEGIN
    v := projects.fn_waitlist_dispatch();
    IF (v ->> 'invited')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL the job invited someone into a full cohort: %', v;
    END IF;
    RAISE NOTICE 'PASS a full cohort invites nobody';

    UPDATE projects.cohort_memberships SET status = 'cancelled', cancelled_at = now()
     WHERE cohort_id = current_setting('probe.cohort')::uuid AND user_id = current_setting('probe.m1')::uuid;
    IF projects.fn_cohort_seats_owed(current_setting('probe.cohort')::uuid) <> 1 THEN
        RAISE EXCEPTION 'FAIL the freed seat is not owed to the queue (owed %)',
            projects.fn_cohort_seats_owed(current_setting('probe.cohort')::uuid);
    END IF;
    v := projects.get_cohort_offer(current_setting('probe.bp')::uuid);
    IF (v ->> 'remaining')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL the public offer shows the queue''s seat as free: %', v;
    END IF;
    RAISE NOTICE 'PASS a freed seat is owed to the queue and the public offer counts it taken';
END $$;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_w'), true);
    BEGIN
        PERFORM projects.reserve_seat(current_setting('probe.cohort')::uuid, 1);
        RAISE EXCEPTION 'FAIL a walk-in took the seat the queue is owed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
        IF SQLSTATE <> 'PS409' OR SQLERRM NOT LIKE '%waitlist%' THEN
            RAISE EXCEPTION 'FAIL the walk-in was refused for the wrong reason: % %', SQLSTATE, SQLERRM;
        END IF;
        RAISE NOTICE 'PASS a walk-in is refused the seat the queue is owed [%]', SQLERRM;
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 3. First in, first out: the head of the queue is invited and holds the seat
DO $$
DECLARE
    v jsonb;
    w projects.waitlists;
    h projects.cohort_seat_holds;
BEGIN
    v := projects.fn_waitlist_dispatch();
    IF (v ->> 'invited')::integer <> 1 OR (v ->> 'expired')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL one free seat should make one invite: %', v;
    END IF;
    SELECT * INTO w FROM projects.waitlists
     WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.a')::uuid;
    IF w.status <> 'invited' OR w.cohort_id <> current_setting('probe.cohort')::uuid
       OR w.invite_expires_at NOT BETWEEN now() + interval '47 hours' AND now() + interval '49 hours' THEN
        RAISE EXCEPTION 'FAIL the head of the queue was not invited for 48 hours: %', row_to_json(w);
    END IF;
    SELECT * INTO h FROM projects.cohort_seat_holds WHERE id = w.hold_id;
    IF h.status <> 'held' OR h.seats <> 1 OR h.expires_at <> w.invite_expires_at OR h.user_id <> w.user_id THEN
        RAISE EXCEPTION 'FAIL the invite holds no one-seat hold to its end: %', row_to_json(h);
    END IF;
    IF EXISTS (SELECT 1 FROM projects.waitlists x
                WHERE x.service_blueprint_id = w.service_blueprint_id
                  AND x.user_id IN (current_setting('probe.b')::uuid, current_setting('probe.c')::uuid)
                  AND x.status <> 'waiting') THEN
        RAISE EXCEPTION 'FAIL someone behind the head of the queue was invited too';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notifications n
                    WHERE n.user_id = w.user_id AND n.type = 'waitlist.invited' AND n.entity_id = w.id
                      AND n.action_url = '/view/' || current_setting('probe.slug')
                      AND n.expires_at = w.invite_expires_at) THEN
        RAISE EXCEPTION 'FAIL the invited buyer got no in-app invite linking to the listing';
    END IF;
    RAISE NOTICE 'PASS the first to join is invited first: a 48-hour one-seat hold and an in-app notice';

    v := projects.fn_waitlist_dispatch();
    IF (v ->> 'invited')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL a second run invited again: %', v;
    END IF;
    RAISE NOTICE 'PASS a second run with no free seat invites nobody';
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v jsonb;
    n integer;
BEGIN
    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_b'), true);
    BEGIN
        PERFORM projects.reserve_seat(current_setting('probe.cohort')::uuid, 1);
        RAISE EXCEPTION 'FAIL the next in line took the invited seat';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
        IF SQLSTATE <> 'PS409' THEN RAISE EXCEPTION 'FAIL wrong refusal: % %', SQLSTATE, SQLERRM; END IF;
    END;
    v := projects.get_waitlist_place(current_setting('probe.bp')::uuid);
    IF v ->> 'status' <> 'waiting' OR (v ->> 'position')::integer <> 1 OR (v ->> 'seats_open')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL the next in line reads %', v;
    END IF;
    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_w'), true);
    BEGIN
        PERFORM projects.reserve_seat(current_setting('probe.cohort')::uuid, 1);
        RAISE EXCEPTION 'FAIL a walk-in took the invited seat';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
        IF SQLSTATE <> 'PS409' THEN RAISE EXCEPTION 'FAIL wrong refusal: % %', SQLSTATE, SQLERRM; END IF;
    END;
    RAISE NOTICE 'PASS the invite''s hold blocks the next in line (position 1) and the walk-in';

    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_a'), true);
    v := projects.get_waitlist_place(current_setting('probe.bp')::uuid);
    IF v ->> 'status' <> 'invited' OR v ->> 'hold_expires_at' IS NULL OR (v ->> 'seats_open')::integer <> 1
       OR (v ->> 'invite_hold_hours')::integer <> 48 THEN
        RAISE EXCEPTION 'FAIL the invited buyer reads %', v;
    END IF;
    BEGIN
        PERFORM projects.reserve_seat(current_setting('probe.cohort')::uuid, 2);
        RAISE EXCEPTION 'FAIL the invited buyer took a second seat';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
        IF SQLSTATE <> 'PS409' THEN RAISE EXCEPTION 'FAIL wrong refusal: % %', SQLSTATE, SQLERRM; END IF;
    END;
    v := projects.reserve_seat(current_setting('probe.cohort')::uuid, 1);
    IF (v ->> 'expires_at')::timestamptz < now() + interval '47 hours' THEN
        RAISE EXCEPTION 'FAIL reserving shortened the invite''s hold to %', v ->> 'expires_at';
    END IF;
    RAISE NOTICE 'PASS the invited buyer reserves their held seat and the hold keeps its 48 hours';

    DELETE FROM projects.waitlists WHERE user_id = current_setting('probe.a')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL an invited place was deleted from under its hold'; END IF;
    RAISE NOTICE 'PASS an invited place cannot be deleted';
END $$;
RESET ROLE;
-- #endregion

-- #region 4. Expiry: the lapsed invite expires and the next person is invited; a rejoin goes last
UPDATE projects.cohort_seat_holds SET expires_at = now() - interval '1 minute'
 WHERE id = (SELECT hold_id FROM projects.waitlists
              WHERE service_blueprint_id = current_setting('probe.bp')::uuid
                AND user_id = current_setting('probe.a')::uuid);

SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v jsonb;
BEGIN
    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_a'), true);
    v := projects.get_waitlist_place(current_setting('probe.bp')::uuid);
    IF v ->> 'status' <> 'expired' THEN
        RAISE EXCEPTION 'FAIL a lapsed invite reads %', v;
    END IF;
    RAISE NOTICE 'PASS a lapsed invite reads expired before the job writes it';
END $$;
RESET ROLE;

DO $$
DECLARE
    v jsonb;
    a projects.waitlists;
BEGIN
    v := projects.fn_waitlist_dispatch();
    IF (v ->> 'expired')::integer <> 1 OR (v ->> 'invited')::integer <> 1 THEN
        RAISE EXCEPTION 'FAIL the lapse should expire one invite and invite the next: %', v;
    END IF;
    SELECT * INTO a FROM projects.waitlists
     WHERE service_blueprint_id = current_setting('probe.bp')::uuid AND user_id = current_setting('probe.a')::uuid;
    IF a.status <> 'expired' OR a.resolved_at IS NULL
       OR (SELECT h.status FROM projects.cohort_seat_holds h WHERE h.id = a.hold_id) <> 'released' THEN
        RAISE EXCEPTION 'FAIL the lapsed invite was not expired with its hold released: %', row_to_json(a);
    END IF;
    IF (SELECT x.status FROM projects.waitlists x
         WHERE x.service_blueprint_id = a.service_blueprint_id AND x.user_id = current_setting('probe.b')::uuid) <> 'invited'
       OR (SELECT x.status FROM projects.waitlists x
         WHERE x.service_blueprint_id = a.service_blueprint_id AND x.user_id = current_setting('probe.c')::uuid) <> 'waiting' THEN
        RAISE EXCEPTION 'FAIL the next in line (B) was not the one invited';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notifications n
                    WHERE n.user_id = a.user_id AND n.type = 'waitlist.invite_expired' AND n.entity_id = a.id) THEN
        RAISE EXCEPTION 'FAIL the expired buyer was not told';
    END IF;
    RAISE NOTICE 'PASS expiry releases the hold, tells the buyer and invites the next in line';
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v jsonb;
BEGIN
    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_a'), true);
    v := projects.join_waitlist(current_setting('probe.bp')::uuid);
    IF v ->> 'status' <> 'waiting' OR (v ->> 'already')::boolean THEN
        RAISE EXCEPTION 'FAIL an expired buyer could not rejoin: %', v;
    END IF;
    v := projects.get_waitlist_place(current_setting('probe.bp')::uuid);
    IF (v ->> 'position')::integer <> 2 THEN
        RAISE EXCEPTION 'FAIL a rejoin did not go to the back of the queue: %', v;
    END IF;
    RAISE NOTICE 'PASS an expired buyer rejoins at the back of the queue';
END $$;
RESET ROLE;
-- #endregion

-- #region 5. A purchase converts the place
DO $$
DECLARE
    v_b uuid := current_setting('probe.b')::uuid;
    v_hold uuid;
    v_type text := finance.fn_person_wallet_type(current_setting('probe.b')::uuid);
    v_membership uuid;
    v jsonb;
BEGIN
    SELECT w.hold_id INTO v_hold FROM projects.waitlists w
     WHERE w.service_blueprint_id = current_setting('probe.bp')::uuid AND w.user_id = v_b;
    PERFORM finance.fn_ensure_wallet(v_type, v_b, 'USD');
    PERFORM finance.fn_wallet_credit(v_b, v_type, 'USD', 10000, 'topup', NULL, NULL);
    v_membership := projects.fn_confirm_seat(v_hold, v_b, v_type, v_b, 5000, 'USD', NULL);
    IF (SELECT w.status FROM projects.waitlists w
         WHERE w.service_blueprint_id = current_setting('probe.bp')::uuid AND w.user_id = v_b) <> 'converted'
       OR (SELECT w.resolved_at FROM projects.waitlists w
         WHERE w.service_blueprint_id = current_setting('probe.bp')::uuid AND w.user_id = v_b) IS NULL THEN
        RAISE EXCEPTION 'FAIL buying the held seat did not convert the place';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.cohort_memberships cm WHERE cm.id = v_membership AND cm.status = 'active') THEN
        RAISE EXCEPTION 'FAIL no active seat after the purchase';
    END IF;
    v := projects.fn_waitlist_dispatch();
    IF (v ->> 'invited')::integer <> 0 OR (v ->> 'expired')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL the job moved a converted place or invited into a full cohort: %', v;
    END IF;
    RAISE NOTICE 'PASS a purchase converts the place, and the converted invite is left alone';
END $$;
-- #endregion

-- #region 6. The seller's read, grants, the job, the dial and the notice types
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v jsonb;
BEGIN
    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_host'), true);
    v := projects.get_listing_waitlist(current_setting('probe.listing')::uuid);
    IF (v #>> '{counts,waiting}')::integer <> 2 OR (v #>> '{counts,converted}')::integer <> 1
       OR (v #>> '{counts,invited}')::integer <> 0 OR (v #>> '{counts,expired}')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL the seller''s counts read %', v -> 'counts';
    END IF;
    IF (v #>> '{entries,0,user_id}')::uuid <> current_setting('probe.c')::uuid
       OR (v #>> '{entries,0,position}')::integer <> 1
       OR (v #>> '{entries,1,user_id}')::uuid <> current_setting('probe.a')::uuid
       OR v #>> '{entries,2,status}' <> 'converted' THEN
        RAISE EXCEPTION 'FAIL the seller''s queue is out of order: %', v -> 'entries';
    END IF;
    RAISE NOTICE 'PASS the seller reads the counts and the queue in order';

    PERFORM set_config('request.jwt.claims', current_setting('probe.claims_w'), true);
    BEGIN
        PERFORM projects.get_listing_waitlist(current_setting('probe.listing')::uuid);
        RAISE EXCEPTION 'FAIL a stranger read the seller''s waitlist';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
        IF SQLSTATE <> 'P0002' THEN RAISE EXCEPTION 'FAIL wrong refusal: % %', SQLSTATE, SQLERRM; END IF;
        RAISE NOTICE 'PASS only the listing''s manager reads its waitlist';
    END;
END $$;
RESET ROLE;

DO $$
BEGIN
    IF has_function_privilege('anon', 'projects.join_waitlist(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'projects.join_waitlist(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'projects.get_waitlist_place(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'projects.get_listing_waitlist(uuid,integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fn_waitlist_dispatch(timestamptz)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fn_cohort_seats_owed(uuid,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fn_waitlist_cohort(uuid)', 'EXECUTE')
       OR has_table_privilege('authenticated', 'projects.waitlists', 'INSERT')
       OR has_table_privilege('authenticated', 'projects.waitlists', 'UPDATE') THEN
        RAISE EXCEPTION 'FAIL the waitlist grants are wrong';
    END IF;
    RAISE NOTICE 'PASS grants: three signed-in doors, the job and helpers nobody''s, no client writes';

    IF NOT EXISTS (SELECT 1 FROM ops.scheduled_jobs j
                    WHERE j.name = 'cohort-waitlist-invites' AND j.kind = 'sql' AND j.enabled
                      AND j.command LIKE '%projects.fn_waitlist_dispatch()%') THEN
        RAISE EXCEPTION 'FAIL the waitlist job is not scheduled';
    END IF;
    IF (SELECT (pp.value #>> '{}')::integer FROM security.platform_params pp
         WHERE pp.key = 'waitlist_invite_hold_hours') IS DISTINCT FROM 48 THEN
        RAISE EXCEPTION 'FAIL waitlist_invite_hold_hours is not seeded at 48';
    END IF;
    -- The invitation also emails (#455, COMMS NT3); the expiry notice stays in-app only.
    IF (SELECT t.default_channels FROM comms.notification_types t WHERE t.key = 'waitlist.invited')
           IS DISTINCT FROM ARRAY['in_app', 'email']::comms.notification_channel[]
       OR (SELECT t.default_channels FROM comms.notification_types t WHERE t.key = 'waitlist.invite_expired')
           IS DISTINCT FROM ARRAY['in_app']::comms.notification_channel[] THEN
        RAISE EXCEPTION 'FAIL waitlist.invited is not seeded in-app + email, or waitlist.invite_expired not in-app only';
    END IF;
    RAISE NOTICE 'PASS the job runs the dispatch, the dial is 48 hours, the invitation emails, the expiry is in-app';
END $$;
-- #endregion

ROLLBACK;
