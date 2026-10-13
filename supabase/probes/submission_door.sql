-- submission_door.sql — probe for the review door (submit_deliverable · send_submission_draft).
--
-- A submission reaches review only through the two RPCs, only from the ticket's assignee (or an active
-- member of the stage's accepted team), only against the ticket's own stage, and only with files that
-- exist and belong to the submitter. A sent draft runs the same transitions as a fresh submission.
-- One transaction, ROLLED BACK, so the seeded database is left as it was. Run after `deno task db:reset`:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/submission_door.sql
\set ON_ERROR_STOP on
\set QUIET on
BEGIN;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.act(p_uid text) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', p_uid, true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key, true);
$$;

-- Runs p_sql and asserts it raised p_state; with p_detail_code, also asserts DETAIL's `code`.
CREATE FUNCTION pg_temp.refused(p_sql text, p_state text, p_what text, p_detail_code text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_state text; v_detail text;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
    END;
    PERFORM pg_temp.ok(v_state = p_state
        AND (p_detail_code IS NULL OR (NULLIF(v_detail, '')::jsonb ->> 'code') = p_detail_code),
        format('%s (%s%s, got %s)', p_what, p_state, COALESCE(' ' || p_detail_code, ''), COALESCE(v_state, 'success')));
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.s(text), pg_temp.ok(boolean, text), pg_temp.refused(text, text, text, text)
    TO authenticated;
-- #endregion

-- #region Fixture: a solo-assigned ticket in progress, a second stage, the assignee's files and a stranger's
DO $$
DECLARE r record; v_other_stage uuid; v_mine uuid[]; v_foreign uuid;
BEGIN
    SELECT ps.id AS stage, p.id AS project, p.owner_user_id AS owner, t.id AS ticket,
           t.current_assignee_id AS assignee
      INTO r
      FROM projects.tickets t
      JOIN projects.project_stages ps ON ps.id = t.current_stage_id
      JOIN projects.projects p ON p.id = t.project_id
     WHERE t.current_assignee_id IS NOT NULL AND t.current_assignee_id <> p.owner_user_id
       AND t.status = 'in_progress'
       AND NOT EXISTS (SELECT 1 FROM projects.stage_assignments sa
                        WHERE sa.project_stage_id = ps.id AND sa.assignee_type = 'team' AND sa.status = 'accepted')
     ORDER BY t.id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture ticket — run `deno task db:reset` for the seeded world';
    END IF;

    INSERT INTO projects.project_stages (project_id, name, sort_order)
    VALUES (r.project, 'Probe other stage', 998)
    RETURNING id INTO v_other_stage;

    SELECT array_agg(id) INTO v_mine FROM (
        SELECT fi.id FROM files.items fi
         WHERE fi.deleted_at IS NULL AND fi.owner_type = 'user' AND fi.owner_user_id <> r.owner
         ORDER BY fi.id LIMIT 2
    ) x;
    UPDATE files.items SET owner_user_id = r.assignee WHERE id = ANY (v_mine);
    SELECT fi.id INTO v_foreign FROM files.items fi
     WHERE fi.deleted_at IS NULL AND fi.owner_type = 'user' AND fi.owner_user_id <> r.assignee
     ORDER BY fi.id LIMIT 1;
    IF array_length(v_mine, 1) IS DISTINCT FROM 2 OR v_foreign IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: not enough seeded files';
    END IF;

    -- An open revision round on the ticket, raised the way a client raises one.
    UPDATE projects.project_stages SET file_revisions_allowed = NULL WHERE id = r.stage;
    UPDATE projects.tickets SET status = 'in_review' WHERE id = r.ticket;
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status, number)
    VALUES (r.stage, r.ticket, r.assignee, 'Probe v1', 'pending_review', 9101);
    PERFORM pg_catalog.set_config('probe.sub1', (SELECT id FROM projects.stage_submissions
        WHERE ticket_id = r.ticket AND number = 9101)::text, true);

    PERFORM pg_catalog.set_config('probe.stage', r.stage::text, true);
    PERFORM pg_catalog.set_config('probe.other_stage', v_other_stage::text, true);
    PERFORM pg_catalog.set_config('probe.owner', r.owner::text, true);
    PERFORM pg_catalog.set_config('probe.ticket', r.ticket::text, true);
    PERFORM pg_catalog.set_config('probe.assignee', r.assignee::text, true);
    PERFORM pg_catalog.set_config('probe.file_a', v_mine[1]::text, true);
    PERFORM pg_catalog.set_config('probe.file_b', v_mine[2]::text, true);
    PERFORM pg_catalog.set_config('probe.file_foreign', v_foreign::text, true);
    PERFORM pg_catalog.set_config('probe.file_unknown', gen_random_uuid()::text, true);
END $$;

SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT projects.review_submission(pg_temp.s('sub1')::uuid, 'request_revision', '{"global":"Probe round"}');
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'open' FROM projects.stage_revision_requests
    WHERE submission_id = pg_temp.s('sub1')::uuid) AND (SELECT status::text = 'in_progress'
    FROM projects.tickets WHERE id = pg_temp.s('ticket')::uuid), 'fixture: round open, ticket back in progress');
-- #endregion

-- #region 1. submit_deliverable — caller, stage and file guards
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT pg_temp.refused(format('SELECT projects.submit_deliverable(%L, %L, %L)',
    pg_temp.s('ticket'), pg_temp.s('stage'), 'Owner v2'), '42501',
    'submit: project access without the assignment is refused');
RESET ROLE;

SELECT pg_temp.act(pg_temp.s('assignee')); SET LOCAL ROLE authenticated;
SELECT pg_temp.refused(format('SELECT projects.submit_deliverable(%L, %L, %L)',
    pg_temp.s('ticket'), pg_temp.s('other_stage'), 'Wrong stage'), '23514',
    'submit: a ticket filed against a stage it is not in is refused');
SELECT pg_temp.refused(format('SELECT projects.submit_deliverable(%L, %L, %L, ''{}'', ''[]'', ARRAY[%L, %L]::uuid[])',
    pg_temp.s('ticket'), pg_temp.s('stage'), 'Unknown file', pg_temp.s('file_a'), pg_temp.s('file_unknown')),
    'PU422', 'submit: an unknown file id is refused, not skipped', 'file_unknown');
SELECT pg_temp.refused(format('SELECT projects.submit_deliverable(%L, %L, %L, ''{}'', ''[]'', ARRAY[%L]::uuid[])',
    pg_temp.s('ticket'), pg_temp.s('stage'), 'Foreign file', pg_temp.s('file_foreign')),
    'PU422', 'submit: somebody else''s file is refused', 'file_foreign');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) = 0 FROM projects.stage_submissions WHERE ticket_id = pg_temp.s('ticket')::uuid
    AND title IN ('Owner v2', 'Wrong stage', 'Unknown file', 'Foreign file')), 'submit: no refused call left a row behind');
SELECT pg_temp.ok((SELECT status = 'open' FROM projects.stage_revision_requests
    WHERE submission_id = pg_temp.s('sub1')::uuid), 'submit: a refused call resolved no round');
-- #endregion

-- #region 2. The bare UPDATE door is closed
SELECT pg_temp.act(pg_temp.s('assignee')); SET LOCAL ROLE authenticated;
WITH ins AS (
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status)
    VALUES (pg_temp.s('stage')::uuid, pg_temp.s('ticket')::uuid, pg_temp.s('assignee')::uuid, 'Probe draft', 'draft')
    RETURNING id
) SELECT pg_catalog.set_config('probe.draft', ins.id::text, true) FROM ins;
INSERT INTO projects.submission_files (submission_id, file_id)
VALUES (pg_temp.s('draft')::uuid, pg_temp.s('file_a')::uuid);
UPDATE projects.stage_submissions SET status = 'pending_review' WHERE id = pg_temp.s('draft')::uuid;
SELECT pg_temp.ok((SELECT status = 'draft' FROM projects.stage_submissions WHERE id = pg_temp.s('draft')::uuid),
    'policy: a bare status UPDATE no longer sends a draft');
RESET ROLE;
-- #endregion

-- #region 3. send_submission_draft — the same transitions as a fresh submission
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT pg_temp.refused(format('SELECT projects.send_submission_draft(%L)', pg_temp.s('draft')), 'PC409',
    'send: somebody else''s draft reads as no draft at all');
RESET ROLE;

SELECT pg_temp.act(pg_temp.s('assignee')); SET LOCAL ROLE authenticated;
SELECT pg_temp.refused(format('SELECT projects.send_submission_draft(%L, NULL, ARRAY[%L]::uuid[])',
    pg_temp.s('draft'), pg_temp.s('file_unknown')), 'PU422', 'send: an unknown staged file is refused', 'file_unknown');
SELECT projects.send_submission_draft(pg_temp.s('draft')::uuid, '["task-1"]'::jsonb,
    ARRAY[pg_temp.s('file_a'), pg_temp.s('file_b')]::uuid[]);
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'pending_review' AND number IS NOT NULL AND checked_item_ids = '["task-1"]'::jsonb
    FROM projects.stage_submissions WHERE id = pg_temp.s('draft')::uuid), 'send: pending_review, numbered, checklist kept');
SELECT pg_temp.ok((SELECT revision_of = pg_temp.s('sub1')::uuid FROM projects.stage_submissions
    WHERE id = pg_temp.s('draft')::uuid), 'send: revision_of names the submission sent back');
SELECT pg_temp.ok((SELECT status = 'resolved' AND resolved_at IS NOT NULL FROM projects.stage_revision_requests
    WHERE submission_id = pg_temp.s('sub1')::uuid), 'send: the open round is resolved');
SELECT pg_temp.ok((SELECT status::text = 'in_review' FROM projects.tickets WHERE id = pg_temp.s('ticket')::uuid),
    'send: the ticket moves into Review');
SELECT pg_temp.ok((SELECT count(*) = 2 FROM projects.submission_files WHERE submission_id = pg_temp.s('draft')::uuid),
    'send: files linked once each (the draft''s own + the staged one)');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM projects.stage_submissions WHERE ticket_id = pg_temp.s('ticket')::uuid
    AND title LIKE 'Review: %'), 'send: the Review trigger filed no placeholder');

SELECT pg_temp.act(pg_temp.s('assignee')); SET LOCAL ROLE authenticated;
SELECT pg_temp.refused(format('SELECT projects.send_submission_draft(%L)', pg_temp.s('draft')), 'PC409',
    'send: a sent draft cannot be sent again');
SELECT pg_temp.refused(format('INSERT INTO projects.submission_files (submission_id, file_id) VALUES (%L, %L)',
    pg_temp.s('draft'), pg_temp.s('file_foreign')), '42501',
    'policy: no file is attached to a sent submission outside the door');
DELETE FROM projects.submission_files WHERE submission_id = pg_temp.s('draft')::uuid;
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) = 2 FROM projects.submission_files WHERE submission_id = pg_temp.s('draft')::uuid),
    'policy: a sent submission''s files cannot be detached');
SELECT pg_temp.act(pg_temp.s('assignee')); SET LOCAL ROLE authenticated;

WITH ins AS (
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status)
    VALUES (pg_temp.s('stage')::uuid, pg_temp.s('ticket')::uuid, pg_temp.s('assignee')::uuid, 'Probe draft 2', 'draft')
    RETURNING id
) SELECT pg_catalog.set_config('probe.draft2', ins.id::text, true) FROM ins;
INSERT INTO projects.submission_files (submission_id, file_id)
VALUES (pg_temp.s('draft2')::uuid, pg_temp.s('file_foreign')::uuid);
SELECT pg_temp.refused(format('SELECT projects.send_submission_draft(%L)', pg_temp.s('draft2')), 'PU422',
    'send: a foreign file attached to the draft earlier is caught at send time', 'file_foreign');
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'draft' FROM projects.stage_submissions WHERE id = pg_temp.s('draft2')::uuid),
    'send: a refused send leaves the draft a draft');
-- #endregion

-- #region 4. A teammate on the stage's accepted team may submit; the steps are not client doors
DO $$
DECLARE r record;
BEGIN
    SELECT t.id AS ticket, t.current_stage_id AS stage, tm.user_id AS mate
      INTO r
      FROM projects.tickets t
      JOIN projects.stage_assignments sa ON sa.project_stage_id = t.current_stage_id AND sa.assignee_type = 'team'
       AND sa.status = 'accepted' AND sa.team_id IS NOT NULL
      JOIN org.team_members tm ON tm.team_id = sa.team_id AND tm.status = 'active'
       AND tm.user_id IS DISTINCT FROM t.current_assignee_id
     WHERE t.status = 'in_progress'
     ORDER BY t.id, tm.user_id LIMIT 1;
    PERFORM pg_catalog.set_config('probe.team_ticket', COALESCE(r.ticket::text, ''), true);
    PERFORM pg_catalog.set_config('probe.team_stage', COALESCE(r.stage::text, ''), true);
    PERFORM pg_catalog.set_config('probe.mate', COALESCE(r.mate::text, ''), true);
END $$;
SELECT pg_temp.act(COALESCE(NULLIF(pg_temp.s('mate'), ''), pg_temp.s('assignee'))); SET LOCAL ROLE authenticated;
DO $$
BEGIN
    IF pg_temp.s('mate') = '' THEN
        RAISE NOTICE 'skip team arm: no seeded team-staffed ticket in progress';
        RETURN;
    END IF;
    PERFORM pg_temp.ok((projects.submit_deliverable(pg_temp.s('team_ticket')::uuid, pg_temp.s('team_stage')::uuid,
        'Team probe') ->> 'status') = 'pending_review', 'team: an active member of the stage''s team may submit');
END $$;
RESET ROLE;

SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'projects.fn_link_submission_files(uuid,uuid[])', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'projects.fn_enter_review(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'projects.fn_assert_can_submit(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'projects.send_submission_draft(uuid,jsonb,uuid[])', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'projects.send_submission_draft(uuid,jsonb,uuid[])', 'EXECUTE'),
    'grants: the door is granted, its steps are not');
-- #endregion

ROLLBACK;
\echo 'submission_door probe: all checks passed (rolled back)'
