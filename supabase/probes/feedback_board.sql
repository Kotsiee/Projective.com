-- =============================================================================================
-- Probe: the feedback board (community.feedback_ideas / feedback_votes / feedback_status_events and
-- their doors in 00001320 [community.feedback], Decision #272).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/feedback_board.sql
--
-- Asserts, each as PASS or an aborting FAIL:
--   * a guest cannot vote, suggest or moderate (refused by the grant), and a subject-less session is
--     refused by the doors' own auth.uid() check;
--   * one vote per person per idea — a repeat vote and a repeat retraction change nothing, and
--     vote_count always equals the vote rows;
--   * only an operator (ops.admin_users) changes an idea's status or writes the team response, and only
--     along the legal moves; a move notifies the author;
--   * an idea under review (Backlog) is visible to its author and operators only; an Archived idea to
--     operators only; neither can be voted on by anyone else;
--   * comms.mask_pii screens an idea's text on insert and on update (Decision #147), and the evidence
--     column and the history's operator columns are withheld from client roles;
--   * the history is append-only and an idea is never deleted;
--   * the submit door's validation and its five-a-day limit;
--   * the seeded board (12_community_feedback.sql), when present, obeys the same visibility.
-- Fixtures: three seeded people (deno task db:reset); one is made an operator inside the transaction.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_people uuid[];
BEGIN
    SELECT array_agg(u.user_id ORDER BY u.user_id) INTO v_people
    FROM (
        SELECT p.user_id
        FROM org.users_public p
        WHERE NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = p.user_id)
        ORDER BY p.user_id
        LIMIT 3
    ) u;
    IF coalesce(array_length(v_people, 1), 0) < 3 THEN
        RAISE EXCEPTION 'FAIL no fixture: need three seeded people who are not operators (deno task db:reset)';
    END IF;
    PERFORM set_config('probe.author', v_people[1]::text, true);
    PERFORM set_config('probe.voter', v_people[2]::text, true);
    PERFORM set_config('probe.operator', v_people[3]::text, true);
    INSERT INTO ops.admin_users (user_id, role) VALUES (v_people[3], 'admin');
    RAISE NOTICE 'fixture author=% voter=% operator=%', v_people[1], v_people[2], v_people[3];
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'community'
          AND c.relname IN ('feedback_ideas', 'feedback_votes', 'feedback_status_events')
          AND NOT c.relrowsecurity
    ) THEN
        RAISE EXCEPTION 'FAIL a feedback table has RLS off';
    END IF;
    RAISE NOTICE 'PASS RLS is on for all three feedback tables';
END $$;
-- #endregion

-- #region 1. A guest — refused by the grant before any body runs; reads the public board only
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        'SELECT community.submit_feedback_idea(''A guest idea title'', ''other'', ''A guest says why it matters.'')',
        'SELECT community.vote_feedback_idea(''fbk-2222222222'')',
        'SELECT community.unvote_feedback_idea(''fbk-2222222222'')',
        'SELECT community.set_feedback_idea_status(''fbk-2222222222'', ''ready'')',
        'SELECT community.respond_to_feedback_idea(''fbk-2222222222'', ''Hello'')',
        'INSERT INTO community.feedback_votes (idea_id, user_id) VALUES (gen_random_uuid(), gen_random_uuid())',
        'INSERT INTO community.feedback_ideas (title, impact, category) VALUES (''Direct insert'', ''Straight into the table.'', ''other'')'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL anon executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS anon refused [%]: %', SQLERRM, left(v_sql, 70);
        END;
    END LOOP;
    -- The tab counts are an invoker read under the caller's own policies.
    PERFORM community.feedback_status_counts();
    RAISE NOTICE 'PASS anon may read the tab counts';
END $$;
RESET ROLE;
-- #endregion

-- #region 2. `authenticated` with no subject — refused by the doors' own auth.uid() check
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        'SELECT community.submit_feedback_idea(''A subjectless idea'', ''other'', ''Nobody is signed in here.'')',
        'SELECT community.vote_feedback_idea(''fbk-2222222222'')',
        'SELECT community.set_feedback_idea_status(''fbk-2222222222'', ''ready'')'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL subject-less caller executed: %', v_sql;
        EXCEPTION WHEN invalid_authorization_specification THEN
            RAISE NOTICE 'PASS no-subject refused [%]', SQLERRM;
        END;
    END LOOP;
END $$;
RESET ROLE;
-- #endregion

-- #region 3. The author suggests an idea — screened, under review, self-voted, one history row
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.author'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v jsonb;
BEGIN
    v := community.submit_feedback_idea(
        'Export my invoices as one PDF',
        'escrow_payments',
        'My accountant wants every invoice at once — write to me at ada@example.com for the details.',
        '  Call +44 20 7946 0958 if anything is unclear.  '
    );
    IF v->>'status' <> 'backlog' THEN RAISE EXCEPTION 'FAIL a new idea is %, not backlog', v->>'status'; END IF;
    IF (v->>'vote_count')::int <> 1 OR NOT (v->>'viewer_voted')::boolean THEN
        RAISE EXCEPTION 'FAIL the author''s vote was not cast with the idea: %', v;
    END IF;
    IF v->>'slug' !~ '^fbk-[23456789abcdefghjkmnopqrstuvwxyz]{10}$' THEN
        RAISE EXCEPTION 'FAIL the idea got no fbk- slug: %', v->>'slug';
    END IF;
    IF v->>'impact' NOT LIKE '%[email hidden]%' OR v->>'impact' LIKE '%ada@example.com%' THEN
        RAISE EXCEPTION 'FAIL mask_pii did not screen the impact: %', v->>'impact';
    END IF;
    IF v->>'body' NOT LIKE '%[phone hidden]%' OR v->>'body' <> btrim(v->>'body') THEN
        RAISE EXCEPTION 'FAIL mask_pii did not screen (or the door did not trim) the body: %', v->>'body';
    END IF;
    IF v ? 'pii_categories' THEN RAISE EXCEPTION 'FAIL the door answered the evidence column'; END IF;
    PERFORM set_config('probe.idea', v->>'slug', true);
    RAISE NOTICE 'PASS submitted % (backlog, 1 vote, screened)', v->>'slug';
END $$;
RESET ROLE;

DO $$
DECLARE
    v_cats text[];
    v_events int;
BEGIN
    SELECT pii_categories INTO v_cats FROM community.feedback_ideas WHERE slug = current_setting('probe.idea');
    IF v_cats <> ARRAY['email', 'phone'] THEN
        RAISE EXCEPTION 'FAIL pii_categories is %, expected {email,phone}', v_cats;
    END IF;
    SELECT count(*) INTO v_events FROM community.feedback_status_events e
    JOIN community.feedback_ideas i ON i.id = e.idea_id
    WHERE i.slug = current_setting('probe.idea') AND e.from_status IS NULL AND e.to_status = 'backlog';
    IF v_events <> 1 THEN RAISE EXCEPTION 'FAIL the submission history row is missing'; END IF;
    RAISE NOTICE 'PASS mask_pii evidence recorded % and the submission history row exists', v_cats;
END $$;
-- #endregion

-- #region 4. Under review — visible to its author and operators only
CREATE OR REPLACE FUNCTION pg_temp.sees(p_role text, p_sub text, p_slug text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_n integer;
BEGIN
    PERFORM set_config('request.jwt.claims',
        CASE WHEN p_sub IS NULL THEN json_build_object('role', p_role)::text
             ELSE json_build_object('sub', p_sub, 'role', p_role)::text END, true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    SELECT count(*) INTO v_n FROM community.feedback_ideas WHERE slug = p_slug;
    RESET ROLE;
    RETURN v_n;
END;
$$;

DO $$
DECLARE
    s text := current_setting('probe.idea');
BEGIN
    IF pg_temp.sees('anon', NULL, s) <> 0 THEN RAISE EXCEPTION 'FAIL a guest sees an idea under review'; END IF;
    IF pg_temp.sees('authenticated', current_setting('probe.voter'), s) <> 0 THEN
        RAISE EXCEPTION 'FAIL another member sees an idea under review';
    END IF;
    IF pg_temp.sees('authenticated', current_setting('probe.author'), s) <> 1 THEN
        RAISE EXCEPTION 'FAIL the author cannot see their own idea under review';
    END IF;
    IF pg_temp.sees('authenticated', current_setting('probe.operator'), s) <> 1 THEN
        RAISE EXCEPTION 'FAIL an operator cannot see an idea under review';
    END IF;
    RAISE NOTICE 'PASS Backlog is visible to its author and operators only';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.voter'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM community.vote_feedback_idea(current_setting('probe.idea'));
        RAISE EXCEPTION 'FAIL a member voted on an idea they cannot see';
    EXCEPTION WHEN no_data_found THEN
        RAISE NOTICE 'PASS a hidden idea answers not-found to a vote [%]', SQLERRM;
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 5. Only an operator moves an idea, along legal moves; the move notifies the author
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_who text;
BEGIN
    FOREACH v_who IN ARRAY ARRAY[current_setting('probe.voter'), current_setting('probe.author')] LOOP
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
        BEGIN
            PERFORM community.set_feedback_idea_status(current_setting('probe.idea'), 'ready');
            RAISE EXCEPTION 'FAIL a non-operator changed a status (%)', v_who;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS non-operator status change refused [%]', SQLERRM;
        END;
        BEGIN
            PERFORM community.respond_to_feedback_idea(current_setting('probe.idea'), 'Not mine to say');
            RAISE EXCEPTION 'FAIL a non-operator wrote the team response (%)', v_who;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS non-operator response refused [%]', SQLERRM;
        END;
    END LOOP;
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.operator'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v jsonb;
BEGIN
    BEGIN
        PERFORM community.set_feedback_idea_status(current_setting('probe.idea'), 'complete');
        RAISE EXCEPTION 'FAIL Backlog -> Complete was allowed';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        RAISE NOTICE 'PASS an illegal move is refused [%]', SQLERRM;
    END;
    v := community.set_feedback_idea_status(current_setting('probe.idea'), 'ready', 'Accepted for the roadmap');
    IF v->>'status' <> 'ready' THEN RAISE EXCEPTION 'FAIL the operator move did not land: %', v; END IF;
    v := community.set_feedback_idea_status(current_setting('probe.idea'), 'ready');
    IF v->>'status' <> 'ready' THEN RAISE EXCEPTION 'FAIL a repeat move changed something: %', v; END IF;
    v := community.respond_to_feedback_idea(current_setting('probe.idea'), '  We are on it.  ');
    IF v->>'team_response' <> 'We are on it.' OR v->>'team_response_at' IS NULL THEN
        RAISE EXCEPTION 'FAIL the team response did not land: %', v;
    END IF;
    RAISE NOTICE 'PASS an operator moves an idea (legal moves only) and responds';
END $$;
RESET ROLE;

DO $$
DECLARE
    v_moves int;
    v_note text;
    v_url text;
BEGIN
    SELECT count(*) INTO v_moves FROM community.feedback_status_events e
    JOIN community.feedback_ideas i ON i.id = e.idea_id
    WHERE i.slug = current_setting('probe.idea');
    IF v_moves <> 2 THEN RAISE EXCEPTION 'FAIL expected 2 history rows (submission + one move), found %', v_moves; END IF;
    SELECT e.note INTO v_note FROM community.feedback_status_events e
    JOIN community.feedback_ideas i ON i.id = e.idea_id
    WHERE i.slug = current_setting('probe.idea') AND e.to_status = 'ready';
    IF v_note IS DISTINCT FROM 'Accepted for the roadmap' THEN RAISE EXCEPTION 'FAIL the move note is %', v_note; END IF;
    SELECT n.action_url INTO v_url FROM comms.notifications n
    WHERE n.user_id = current_setting('probe.author')::uuid AND n.type = 'feedback.status_changed'
    ORDER BY n.created_at DESC LIMIT 1;
    IF v_url IS DISTINCT FROM '/feedback?idea=' || current_setting('probe.idea') THEN
        RAISE EXCEPTION 'FAIL the author was not notified with a link to the idea (got %)', v_url;
    END IF;
    IF EXISTS (
        SELECT 1 FROM comms.notifications n
        WHERE n.user_id = current_setting('probe.operator')::uuid AND n.type = 'feedback.status_changed'
    ) THEN
        RAISE EXCEPTION 'FAIL the operator was notified of their own move';
    END IF;
    RAISE NOTICE 'PASS the move is in the history and the author was notified (%)', v_url;
END $$;
-- #endregion

-- #region 6. Public now — one vote per person, idempotent both ways, count kept by trigger
DO $$
BEGIN
    IF pg_temp.sees('anon', NULL, current_setting('probe.idea')) <> 1 THEN
        RAISE EXCEPTION 'FAIL a Planned idea is not public';
    END IF;
    RAISE NOTICE 'PASS a Planned idea is public';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.voter'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v jsonb;
BEGIN
    v := community.vote_feedback_idea(current_setting('probe.idea'));
    IF NOT (v->>'voted')::boolean OR (v->>'vote_count')::int <> 2 THEN RAISE EXCEPTION 'FAIL vote: %', v; END IF;
    v := community.vote_feedback_idea(current_setting('probe.idea'));
    IF (v->>'vote_count')::int <> 2 THEN RAISE EXCEPTION 'FAIL a repeat vote counted twice: %', v; END IF;
    BEGIN
        INSERT INTO community.feedback_votes (idea_id, user_id)
        SELECT id, current_setting('probe.voter')::uuid FROM community.feedback_ideas
        WHERE slug = current_setting('probe.idea');
        RAISE EXCEPTION 'FAIL a member wrote a vote row directly';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS no direct vote writes [%]', SQLERRM;
    END;
    v := community.unvote_feedback_idea(current_setting('probe.idea'));
    IF (v->>'voted')::boolean OR (v->>'vote_count')::int <> 1 THEN RAISE EXCEPTION 'FAIL unvote: %', v; END IF;
    v := community.unvote_feedback_idea(current_setting('probe.idea'));
    IF (v->>'vote_count')::int <> 1 THEN RAISE EXCEPTION 'FAIL a repeat retraction changed the count: %', v; END IF;
    v := community.vote_feedback_idea(current_setting('probe.idea'));
    RAISE NOTICE 'PASS one vote per person, idempotent vote and retraction (count %)', v->>'vote_count';
END $$;
RESET ROLE;

DO $$
BEGIN
    BEGIN
        INSERT INTO community.feedback_votes (idea_id, user_id)
        SELECT id, current_setting('probe.voter')::uuid FROM community.feedback_ideas
        WHERE slug = current_setting('probe.idea');
        RAISE EXCEPTION 'FAIL a second vote row for the same person was stored';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'PASS the primary key refuses a second vote row [%]', SQLERRM;
    END;
    IF EXISTS (
        SELECT 1 FROM community.feedback_ideas i
        WHERE i.vote_count <> (SELECT count(*) FROM community.feedback_votes v WHERE v.idea_id = i.id)
    ) THEN
        RAISE EXCEPTION 'FAIL a vote_count disagrees with its vote rows';
    END IF;
    RAISE NOTICE 'PASS every vote_count equals its vote rows';
END $$;
-- #endregion

-- #region 7. Withheld columns — the evidence and the operator side of the history
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        'SELECT pii_categories FROM community.feedback_ideas',
        'SELECT team_response_by FROM community.feedback_ideas',
        'SELECT actor_id FROM community.feedback_status_events',
        'SELECT note FROM community.feedback_status_events',
        'SELECT user_id FROM community.feedback_votes'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL a guest read a withheld column: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS withheld from anon: %', v_sql;
        END;
    END LOOP;
END $$;
RESET ROLE;
-- #endregion

-- #region 8. Archived — hidden from everyone but operators; voting closed; terminal
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.operator'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v jsonb;
BEGIN
    v := community.set_feedback_idea_status(current_setting('probe.idea'), 'archived', 'Duplicate');
    IF v->>'archived_at' IS NULL THEN RAISE EXCEPTION 'FAIL archived_at was not stamped: %', v; END IF;
    BEGIN
        PERFORM community.vote_feedback_idea(current_setting('probe.idea'));
        RAISE EXCEPTION 'FAIL an archived idea took a vote';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        RAISE NOTICE 'PASS voting is closed on an archived idea [%]', SQLERRM;
    END;
    BEGIN
        PERFORM community.set_feedback_idea_status(current_setting('probe.idea'), 'ready');
        RAISE EXCEPTION 'FAIL an archived idea was reopened';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        RAISE NOTICE 'PASS Archived is terminal [%]', SQLERRM;
    END;
END $$;
RESET ROLE;

DO $$
DECLARE
    s text := current_setting('probe.idea');
BEGIN
    IF pg_temp.sees('anon', NULL, s) <> 0 THEN RAISE EXCEPTION 'FAIL a guest sees an archived idea'; END IF;
    IF pg_temp.sees('authenticated', current_setting('probe.author'), s) <> 0 THEN
        RAISE EXCEPTION 'FAIL the author still sees an archived idea';
    END IF;
    IF pg_temp.sees('authenticated', current_setting('probe.voter'), s) <> 0 THEN
        RAISE EXCEPTION 'FAIL a voter still sees an archived idea';
    END IF;
    IF pg_temp.sees('authenticated', current_setting('probe.operator'), s) <> 1 THEN
        RAISE EXCEPTION 'FAIL an operator cannot see an archived idea';
    END IF;
    RAISE NOTICE 'PASS Archived is visible to operators only';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.voter'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_n int;
BEGIN
    BEGIN
        PERFORM community.unvote_feedback_idea(current_setting('probe.idea'));
        RAISE EXCEPTION 'FAIL a member reached an archived idea';
    EXCEPTION WHEN no_data_found THEN
        RAISE NOTICE 'PASS an archived idea answers not-found to a member [%]', SQLERRM;
    END;
    SELECT count(*) INTO v_n FROM community.feedback_status_events e
    WHERE NOT EXISTS (SELECT 1 FROM community.feedback_ideas i WHERE i.id = e.idea_id);
    IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL a member reads the history of an idea they cannot see'; END IF;
    RAISE NOTICE 'PASS an idea''s history is exactly as visible as the idea';
END $$;
RESET ROLE;
-- #endregion

-- #region 9. Append-only history, no deletes, and the screen on the update path (as postgres)
DO $$
BEGIN
    BEGIN
        UPDATE community.feedback_status_events SET note = 'rewritten'
        WHERE idea_id = (SELECT id FROM community.feedback_ideas WHERE slug = current_setting('probe.idea'));
        RAISE EXCEPTION 'FAIL the history was rewritten';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        RAISE NOTICE 'PASS the history refuses an update [%]', SQLERRM;
    END;
    BEGIN
        DELETE FROM community.feedback_status_events
        WHERE idea_id = (SELECT id FROM community.feedback_ideas WHERE slug = current_setting('probe.idea'));
        RAISE EXCEPTION 'FAIL the history was deleted';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        RAISE NOTICE 'PASS the history refuses a delete [%]', SQLERRM;
    END;
    BEGIN
        DELETE FROM community.feedback_ideas WHERE slug = current_setting('probe.idea');
        RAISE EXCEPTION 'FAIL an idea was hard-deleted';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        RAISE NOTICE 'PASS an idea is never deleted [%]', SQLERRM;
    END;
    BEGIN
        UPDATE community.feedback_ideas SET slug = 'fbk-2222222222' WHERE slug = current_setting('probe.idea');
        RAISE EXCEPTION 'FAIL an idea''s address moved';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS an idea''s slug is permanent [%]', SQLERRM;
    END;
    UPDATE community.feedback_ideas SET title = 'Ring 07700 900123 about invoices'
    WHERE slug = current_setting('probe.idea');
    IF NOT EXISTS (
        SELECT 1 FROM community.feedback_ideas
        WHERE slug = current_setting('probe.idea') AND title LIKE '%[phone hidden]%'
    ) THEN
        RAISE EXCEPTION 'FAIL an edited title bypassed mask_pii';
    END IF;
    RAISE NOTICE 'PASS mask_pii screens the update path too';
END $$;
-- #endregion

-- #region 10. The submit door's validation and its five-a-day limit
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.author'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    i int;
BEGIN
    BEGIN
        PERFORM community.submit_feedback_idea('Short', 'other', 'Long enough to explain the reason.');
        RAISE EXCEPTION 'FAIL a five-character title was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN
        IF SQLERRM NOT LIKE 'title:%' THEN RAISE EXCEPTION 'FAIL the refusal names no field: %', SQLERRM; END IF;
        RAISE NOTICE 'PASS a short title is refused [%]', SQLERRM;
    END;
    BEGIN
        PERFORM community.submit_feedback_idea('A perfectly good title', 'wallets', 'Long enough to explain the reason.');
        RAISE EXCEPTION 'FAIL an unknown category was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS an unknown category is refused [%]', SQLERRM;
    END;
    -- One idea so far today; four more reach the limit.
    FOR i IN 2..5 LOOP
        PERFORM community.submit_feedback_idea('Probe idea number ' || i, 'other', 'Probing the daily limit, idea ' || i || '.');
    END LOOP;
    BEGIN
        PERFORM community.submit_feedback_idea('Probe idea number 6', 'other', 'One more than the limit allows.');
        RAISE EXCEPTION 'FAIL a sixth idea in a day was accepted';
    EXCEPTION WHEN SQLSTATE 'PR429' THEN
        RAISE NOTICE 'PASS the sixth idea in a day is refused [%]', SQLERRM;
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 11. The seeded board, when present, obeys the same visibility
DO $$
DECLARE
    v_public int;
    v_seen int;
    v_backlog record;
BEGIN
    SELECT count(*) INTO v_public FROM community.feedback_ideas
    WHERE status IN ('ready', 'in_progress', 'complete');
    IF v_public = 0 THEN
        RAISE NOTICE 'SKIP no seeded ideas (12_community_feedback.sql not loaded)';
        RETURN;
    END IF;
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_seen FROM community.feedback_ideas;
    RESET ROLE;
    IF v_seen <> v_public THEN
        RAISE EXCEPTION 'FAIL a guest sees % ideas, the public set is %', v_seen, v_public;
    END IF;
    SELECT slug, author_id INTO v_backlog FROM community.feedback_ideas
    WHERE status = 'backlog' AND author_id IS NOT NULL AND author_id <> current_setting('probe.author')::uuid
    ORDER BY created_at LIMIT 1;
    IF FOUND THEN
        IF pg_temp.sees('authenticated', v_backlog.author_id::text, v_backlog.slug) <> 1
            OR pg_temp.sees('anon', NULL, v_backlog.slug) <> 0 THEN
            RAISE EXCEPTION 'FAIL seeded idea % under review leaks or hides from its author', v_backlog.slug;
        END IF;
    END IF;
    RAISE NOTICE 'PASS the seeded board: a guest sees exactly the % public ideas', v_public;
END $$;
-- #endregion

ROLLBACK;
