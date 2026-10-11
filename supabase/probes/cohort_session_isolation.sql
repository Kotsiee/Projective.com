-- =============================================================================================
-- Probe: cohort / session isolation (projects.cohorts "View cohorts", projects.session_events
-- "View session events", projects.session_attendance with no client INSERT, and
-- projects.stage_revision_requests "Request own revisions").
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/cohort_session_isolation.sql
--
-- A clean run prints only PASS notices; any leak raises `FAIL …` and aborts (non-zero exit under
-- ON_ERROR_STOP). The seed has no cohorts, so two are built here on two seeded private projects,
-- each with one member who neither owns nor reviews either project.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_pa uuid; v_pb uuid; v_ua uuid; v_ub uuid; v_ca uuid; v_cb uuid; v_ea uuid; v_eb uuid;
    v_stage uuid; v_ticket uuid;
BEGIN
    SELECT p.id INTO v_pa FROM projects.projects p
    WHERE p.visibility::text <> 'public' ORDER BY p.id LIMIT 1;
    SELECT p.id INTO v_pb FROM projects.projects p
    WHERE p.visibility::text <> 'public' AND p.id <> v_pa ORDER BY p.id LIMIT 1;
    IF v_pb IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need two seeded private projects (deno task db:reset)';
    END IF;

    SELECT u.user_id INTO v_ua FROM org.users_public u
    WHERE u.user_id NOT IN (SELECT owner_user_id FROM projects.projects WHERE id IN (v_pa, v_pb))
    ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_ub FROM org.users_public u
    WHERE u.user_id NOT IN (SELECT owner_user_id FROM projects.projects WHERE id IN (v_pa, v_pb))
        AND u.user_id <> v_ua
    ORDER BY u.user_id LIMIT 1;

    INSERT INTO projects.cohorts (project_id, name) VALUES (v_pa, 'Probe cohort A') RETURNING id INTO v_ca;
    INSERT INTO projects.cohorts (project_id, name) VALUES (v_pb, 'Probe cohort B') RETURNING id INTO v_cb;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_ca, v_ua), (v_cb, v_ub);
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, host_join_url)
    VALUES (v_ca, 'Probe A', now(), now() + interval '1 hour', 'https://host.example/a')
    RETURNING id INTO v_ea;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, host_join_url)
    VALUES (v_cb, 'Probe B', now(), now() + interval '1 hour', 'https://host.example/b')
    RETURNING id INTO v_eb;

    -- A revision round raised by member A on a stage of project B (as the definer RPC would).
    SELECT s.id INTO v_stage FROM projects.project_stages s WHERE s.project_id = v_pb LIMIT 1;
    SELECT t.id INTO v_ticket FROM projects.tickets t ORDER BY t.id LIMIT 1;
    IF v_stage IS NULL OR v_ticket IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a stage on project B and a seeded ticket';
    END IF;
    INSERT INTO projects.stage_revision_requests (project_stage_id, ticket_id, requested_by, request_type, reason)
    VALUES (v_stage, v_ticket, v_ua, 'revision', 'probe');

    PERFORM set_config('probe.ua', v_ua::text, true);
    PERFORM set_config('probe.ca', v_ca::text, true);
    PERFORM set_config('probe.pb', v_pb::text, true);
    PERFORM set_config('probe.cb', v_cb::text, true);
    PERFORM set_config('probe.ea', v_ea::text, true);
    PERFORM set_config('probe.eb', v_eb::text, true);
    PERFORM set_config('probe.stage', v_stage::text, true);
    PERFORM set_config('probe.ticket', v_ticket::text, true);
END $$;
-- #endregion

-- #region 1. Member of cohort A
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.ua'), 'role', 'authenticated')::text, true);

DO $$
DECLARE n int;
BEGIN
    IF projects.can_review_project(current_setting('probe.pb')::uuid) THEN
        RAISE EXCEPTION 'FAIL fixture: member A must not hold review authority on project B';
    END IF;

    SELECT count(*) INTO n FROM projects.session_events WHERE id = current_setting('probe.eb')::uuid;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL member of cohort A reads cohort B''s session event'; END IF;
    RAISE NOTICE 'PASS member of cohort A cannot read cohort B''s session event';

    SELECT count(*) INTO n FROM projects.session_events WHERE id = current_setting('probe.ea')::uuid;
    IF n <> 1 THEN RAISE EXCEPTION 'FAIL member of cohort A cannot read their own cohort''s event'; END IF;
    RAISE NOTICE 'PASS member of cohort A reads their own cohort''s event';

    SELECT count(*) INTO n FROM projects.cohorts WHERE id = current_setting('probe.cb')::uuid;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL member of cohort A reads cohort B'; END IF;
    SELECT count(*) INTO n FROM projects.cohorts WHERE id = current_setting('probe.ca')::uuid;
    IF n <> 1 THEN RAISE EXCEPTION 'FAIL member of cohort A cannot read cohort A'; END IF;
    RAISE NOTICE 'PASS cohorts: own cohort visible, other cohort hidden';

    BEGIN
        INSERT INTO projects.session_attendance (session_event_id, user_id)
        VALUES (current_setting('probe.eb')::uuid, current_setting('probe.ua')::uuid);
        RAISE EXCEPTION 'FAIL client inserted attendance for another cohort''s event';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS client attendance INSERT refused [%]', SQLERRM;
    END;

    BEGIN
        INSERT INTO projects.stage_revision_requests (project_stage_id, ticket_id, requested_by, request_type, reason)
        VALUES (current_setting('probe.stage')::uuid, current_setting('probe.ticket')::uuid,
                current_setting('probe.ua')::uuid, 'revision', 'probe');
        RAISE EXCEPTION 'FAIL non-reviewer raised a revision request';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS non-reviewer revision INSERT refused [%]', SQLERRM;
    END;

    UPDATE projects.stage_revision_requests SET status = 'resolved'
    WHERE requested_by = current_setting('probe.ua')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL requester updated their own revision request'; END IF;
    DELETE FROM projects.stage_revision_requests WHERE requested_by = current_setting('probe.ua')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL requester deleted their own revision request'; END IF;
    SELECT count(*) INTO n FROM projects.stage_revision_requests
    WHERE requested_by = current_setting('probe.ua')::uuid;
    IF n <> 1 THEN RAISE EXCEPTION 'FAIL requester cannot read their own revision request'; END IF;
    RAISE NOTICE 'PASS requester reads but cannot update or delete their revision request';
END $$;

RESET ROLE;
-- #endregion

ROLLBACK;
