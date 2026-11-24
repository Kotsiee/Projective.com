-- =============================================================================================
-- Probe: a review reaches `reviews.entity_reviews` only through its doors (RV1; USER_FLOWS MK-32,
-- MK-34; Decision #83's reviews half, #244 (e)).
--
--   1  grants: anon and authenticated hold SELECT and nothing else on every table in `reviews`
--      (no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER), and no policy on the schema's
--      tables admits a client write
--   2  direct writes: as anon, and as a seeded reviewer on their own review, an INSERT, an UPDATE
--      and a DELETE each raise 42501. RLS alone answers an UPDATE or DELETE it does not admit with
--      zero rows and no error, so a refusal the caller can see is the privilege's, not the policy's
--   3  the doors: reviews.submit_review, edit_review, withdraw_review, reply_to_review, edit_reply
--      and hide_review each exist as a SECURITY DEFINER with search_path pinned to ''; authenticated
--      may EXECUTE each, anon none; reviews.recalculate_entity_rating stays callable by no client
--   5  submit_review (Decision #487): no JWT 42501, a 13-17 account PM403, no anchor PT404, not the
--      client party PT403, oneself PT422, a target with no completed seat PT404, a running seat
--      PT404, a product PT501 (until CK1), bad input 22023; a valid review carries its anchor and its
--      window, and on an engagement waits blind until the provider reviews the client back (Decision
--      #486; reviews_reciprocal.sql), which moves the provider's average and tells them; a second on
--      the same anchor is PT409; a
--      released seat after work began and a completed sitting each open a review; the sitting's
--      review_asked_at is never touched; past 30 days PT410; a listing's buyer moves the listing's
--      average too and the provider is told at /view/svc-…#evp-reviews
--   6  edits (author only, PT403), one reply (PT403 for anyone else, PT409 for a second, 22023 over
--      1,000 characters, PT410 to edit after 7 days), no edit after the reply (PT409), hiding (an
--      operator's; 42501 otherwise) moves the average back and hides the row from a guest but keeps
--      it, withdrawal does the same and still counts against a second review
--   7  the seat clock stamps a released seat and the owner cannot backdate it; get_reviewables lists
--      each provider with the party's review; the reminder asks once per anchor, only while something
--      on it is unreviewed, and links the dialog
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Needs the seed's reviews
-- (deno task db:reset). Run with `deno task test:probes reviews_writer`. Every region records its
-- failures and the last block raises one `PROBE FAIL: …` naming all of them, so a red run lists the
-- whole gap; a clean run prints only PASS notices.
-- =============================================================================================

BEGIN;
-- The pg_temp helpers run as anon and authenticated, and 00002500 gives a new function no PUBLIC
-- EXECUTE; this hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region 0. Fixtures and helpers (as postgres)
CREATE TEMP TABLE probe_fail (label text NOT NULL) ON COMMIT DROP;
GRANT INSERT ON probe_fail TO PUBLIC;

-- p_role NULL returns to postgres; otherwise the role, carrying p_user as the JWT subject (or none).
CREATE FUNCTION pg_temp.act(p_role text, p_user uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_role IS NULL THEN
        PERFORM set_config('role', 'postgres', true);
        PERFORM set_config('request.jwt.claims', '', true);
    ELSE
        PERFORM set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN ''
            ELSE json_build_object('sub', p_user, 'role', p_role)::text END, true);
        PERFORM set_config('role', p_role, true);
    END IF;
END $$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        INSERT INTO probe_fail (label) VALUES (p_label);
        RAISE NOTICE 'MISS %', p_label;
    ELSE
        RAISE NOTICE 'PASS %', p_label;
    END IF;
END $$;

-- The SQLSTATE a statement raises as the current role, '' when it runs.
CREATE FUNCTION pg_temp.state_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN '';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

DO $$
DECLARE
    v_review uuid;
    v_reviewer uuid;
    v_target uuid;
BEGIN
    SELECT r.id, r.reviewer_user_id, r.target_entity_id INTO v_review, v_reviewer, v_target
    FROM reviews.entity_reviews r
    WHERE NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = r.reviewer_user_id)
    ORDER BY r.id
    LIMIT 1;
    IF v_review IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture: no seeded review by a non-operator (deno task db:reset)';
    END IF;
    PERFORM set_config('probe.review', v_review::text, true);
    PERFORM set_config('probe.reviewer', v_reviewer::text, true);
    PERFORM set_config('probe.target', v_target::text, true);
END $$;
-- #endregion

-- #region 1. Grants (as postgres)
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT c.oid, c.relname, role, priv
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'reviews'
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS role
        CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS priv
        WHERE c.relkind IN ('r', 'p')
        ORDER BY c.relname, role, priv
    LOOP
        PERFORM pg_temp.check(NOT pg_catalog.has_table_privilege(r.role, r.oid, r.priv),
            format('1 %s holds no %s on reviews.%s', r.role, r.priv, r.relname));
    END LOOP;

    FOR r IN
        SELECT c.relname, p.polname, p.polcmd
        FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'reviews'
        ORDER BY c.relname, p.polname
    LOOP
        PERFORM pg_temp.check(r.polcmd = 'r',
            format('1 policy "%s" on reviews.%s admits reads only (cmd %s)', r.polname, r.relname, r.polcmd));
    END LOOP;
END $$;
-- #endregion

-- #region 2. Direct writes refused (anon, then the reviewer on their own review)
DO $$
DECLARE
    v_review uuid := current_setting('probe.review')::uuid;
    v_reviewer uuid := current_setting('probe.reviewer')::uuid;
    v_target uuid := current_setting('probe.target')::uuid;
    v_insert text := format(
        'INSERT INTO reviews.entity_reviews (target_entity_id, target_entity_type, reviewer_user_id, rating, comment) '
        'VALUES (%L, %L, %L, 1, repeat(''x'', 120))', v_target, 'service_blueprint', v_reviewer);
    v_update text := format('UPDATE reviews.entity_reviews SET rating = 1 WHERE id = %L', v_review);
    v_delete text := format('DELETE FROM reviews.entity_reviews WHERE id = %L', v_review);
    a record;
    v_state text;
BEGIN
    FOR a IN
        SELECT * FROM (VALUES ('anon', NULL::uuid, 'anon'), ('authenticated', v_reviewer, 'the reviewer'))
            AS t(role, uid, who)
    LOOP
        PERFORM pg_temp.act(a.role, a.uid);
        v_state := pg_temp.state_of(v_insert);
        PERFORM pg_temp.act(NULL);
        PERFORM pg_temp.check(v_state = '42501', format('2 a direct INSERT as %s is 42501 (got %L)', a.who, v_state));

        PERFORM pg_temp.act(a.role, a.uid);
        v_state := pg_temp.state_of(v_update);
        PERFORM pg_temp.act(NULL);
        PERFORM pg_temp.check(v_state = '42501', format('2 a direct UPDATE as %s is 42501 (got %L)', a.who, v_state));

        PERFORM pg_temp.act(a.role, a.uid);
        v_state := pg_temp.state_of(v_delete);
        PERFORM pg_temp.act(NULL);
        PERFORM pg_temp.check(v_state = '42501', format('2 a direct DELETE as %s is 42501 (got %L)', a.who, v_state));
    END LOOP;
END $$;
-- #endregion

-- #region 3. The doors (as postgres)
DO $$
DECLARE
    v_name text;
    v_fn record;
BEGIN
    FOREACH v_name IN ARRAY ARRAY[
        'submit_review', 'edit_review', 'withdraw_review', 'reply_to_review', 'edit_reply', 'hide_review'
    ]
    LOOP
        SELECT p.oid, p.prosecdef, p.proconfig INTO v_fn
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'reviews'
        WHERE p.proname = v_name
        LIMIT 1;
        IF v_fn.oid IS NULL THEN
            PERFORM pg_temp.check(false, format('3 reviews.%s exists', v_name));
            CONTINUE;
        END IF;
        PERFORM pg_temp.check(v_fn.prosecdef, format('3 reviews.%s is SECURITY DEFINER', v_name));
        PERFORM pg_temp.check('search_path=""' = ANY (COALESCE(v_fn.proconfig, '{}')),
            format('3 reviews.%s pins search_path to ''''', v_name));
        PERFORM pg_temp.check(pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE'),
            format('3 authenticated may EXECUTE reviews.%s', v_name));
        PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE'),
            format('3 anon may not EXECUTE reviews.%s', v_name));
    END LOOP;

    PERFORM pg_temp.check(
        NOT pg_catalog.has_function_privilege('anon', 'reviews.recalculate_entity_rating()', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', 'reviews.recalculate_entity_rating()', 'EXECUTE'),
        '3 no client role may EXECUTE reviews.recalculate_entity_rating');
END $$;
-- #endregion

-- #region 4. Fixtures for the doors (as postgres)
-- A client C, two freelancers F and G, a stranger S and a 15-year-old M, all made here, so the seed's
-- own reviews never move the figures asserted below. One completed engagement of C's on which F and
-- G held seats; one running engagement on which H's seat is still taken and K's was released, K
-- having submitted work and H not; one session engagement of F's on which C holds a seat with a
-- completed sitting. Every seat holder's average starts at zero.
DO $$
DECLARE
    v_c uuid := gen_random_uuid(); v_f uuid := gen_random_uuid(); v_g uuid := gen_random_uuid();
    v_s uuid := gen_random_uuid(); v_m uuid := gen_random_uuid(); v_h uuid := gen_random_uuid();
    v_k uuid := gen_random_uuid();
    v_done uuid := gen_random_uuid(); v_run uuid := gen_random_uuid(); v_ses uuid := gen_random_uuid();
    v_stage uuid; v_rstage uuid; v_sstage uuid; v_cohort uuid; v_membership uuid; v_ticket uuid;
    v_admin uuid;
    r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES (v_c, 'c', DATE '1990-01-01'), (v_f, 'f', DATE '1990-01-01'),
            (v_g, 'g', DATE '1990-01-01'), (v_s, 's', DATE '1990-01-01'),
            (v_m, 'm', (CURRENT_DATE - interval '15 years')::date), (v_h, 'h', DATE '1990-01-01'),
            (v_k, 'k', DATE '1990-01-01')) AS x(uid, tag, dob)
    LOOP
        INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
        VALUES (r.uid, 'reviews-probe-' || r.uid || '@projective.invalid', 'authenticated', 'authenticated',
                '{}'::jsonb, now());
        INSERT INTO org.users_public (user_id, username, dob, first_name, last_name, visibility)
        VALUES (r.uid, 'rvprobe_' || r.tag || '_' || left(replace(r.uid::text, '-', ''), 10), r.dob,
                'Probe', upper(r.tag), CASE WHEN r.tag = 'm' THEN 'unlisted' ELSE 'public' END);
        IF r.tag IN ('f', 'g', 'h', 'k') THEN
            INSERT INTO org.freelancer_profiles (user_id) VALUES (r.uid);
        END IF;
    END LOOP;

    -- The completed engagement: F and G held seats on its one stage.
    INSERT INTO projects.projects (id, owner_user_id, title, status, visibility, currency, budget_type)
    VALUES (v_done, v_c, 'Reviews probe: completed', 'active', 'unlisted', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_done, 'Build', 1)
    RETURNING id INTO v_stage;
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
    VALUES (v_stage, 'freelancer', v_f, v_c, 'completed'), (v_stage, 'freelancer', v_g, v_c, 'completed');
    UPDATE projects.projects SET status = 'completed' WHERE id = v_done;
    INSERT INTO projects.project_status_history (project_id, actor_user_id, from_status, to_status, created_at)
    VALUES (v_done, v_c, 'active', 'completed', now() - interval '2 days');

    -- The running engagement: H's seat is taken, K's was released after K submitted work.
    INSERT INTO projects.projects (id, owner_user_id, title, status, visibility, currency, budget_type)
    VALUES (v_run, v_c, 'Reviews probe: running', 'active', 'unlisted', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_run, 'Build', 1)
    RETURNING id INTO v_rstage;
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
    VALUES (v_rstage, 'freelancer', v_h, v_c, 'accepted'), (v_rstage, 'freelancer', v_k, v_c, 'accepted');
    INSERT INTO projects.tickets (project_id, current_stage_id, title) VALUES (v_run, v_rstage, 'Probe ticket')
    RETURNING id INTO v_ticket;
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title)
    VALUES (v_rstage, v_ticket, v_k, 'Probe deliverable');
    UPDATE projects.stage_assignments SET status = 'released'
     WHERE project_stage_id = v_rstage AND freelancer_profile_id = v_k;

    -- F's session engagement: C holds a seat whose one sitting completed yesterday.
    INSERT INTO projects.projects (id, owner_user_id, title, format, session_kind, status, visibility, currency, budget_type)
    VALUES (v_ses, v_f, 'Reviews probe: sessions', 'session', 'normal', 'active', 'unlisted', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_ses, 'Sessions', 0)
    RETURNING id INTO v_sstage;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_ses, v_sstage, 'Probe cohort', 1, 'active') RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id, seats, status)
    VALUES (v_cohort, v_c, 1, 'active') RETURNING id INTO v_membership;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, status)
    VALUES (v_cohort, 'Probe sitting', now() - interval '25 hours', now() - interval '24 hours', 'completed');

    SELECT a.user_id INTO v_admin FROM ops.admin_users a ORDER BY a.user_id LIMIT 1;
    IF v_admin IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture: no operator in ops.admin_users (deno task db:reset)';
    END IF;

    PERFORM set_config('probe.c', v_c::text, true);
    PERFORM set_config('probe.f', v_f::text, true);
    PERFORM set_config('probe.g', v_g::text, true);
    PERFORM set_config('probe.s', v_s::text, true);
    PERFORM set_config('probe.m', v_m::text, true);
    PERFORM set_config('probe.h', v_h::text, true);
    PERFORM set_config('probe.k', v_k::text, true);
    PERFORM set_config('probe.done', v_done::text, true);
    PERFORM set_config('probe.run', v_run::text, true);
    PERFORM set_config('probe.ses', v_ses::text, true);
    PERFORM set_config('probe.membership', v_membership::text, true);
    PERFORM set_config('probe.admin', v_admin::text, true);
END $$;

-- The SQLSTATE a door call raises as `p_user` ('' when it returns). p_user NULL: authenticated with no JWT.
CREATE FUNCTION pg_temp.door(p_user uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v text;
BEGIN
    PERFORM pg_temp.act('authenticated', p_user);
    v := pg_temp.state_of(p_sql);
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.submit(p_kind text, p_anchor text, p_type text, p_target text,
    p_rating numeric DEFAULT 4, p_comment text DEFAULT repeat('A careful, complete and honest account. ', 4))
RETURNS text LANGUAGE sql AS $$
    SELECT format('SELECT reviews.submit_review(%L, %L::uuid, %L::reviews.review_target_type, %L::uuid, %s, %L, %L)',
                  p_kind, p_anchor, p_type, p_target, p_rating, 'Probe', p_comment);
$$;

CREATE FUNCTION pg_temp.avg_of(p_user uuid) RETURNS text LANGUAGE sql AS $$
    SELECT fp.rating_average::text || '/' || fp.rating_count::text FROM org.freelancer_profiles fp WHERE fp.user_id = p_user;
$$;
-- #endregion

-- #region 5. submit_review: each refusal has its SQLSTATE; a valid review moves the average
DO $$
DECLARE
    c uuid := current_setting('probe.c'); f uuid := current_setting('probe.f');
    g uuid := current_setting('probe.g'); s uuid := current_setting('probe.s');
    m uuid := current_setting('probe.m'); h uuid := current_setting('probe.h');
    k uuid := current_setting('probe.k');
    v_done text := current_setting('probe.done'); v_run text := current_setting('probe.run');
    v_ses text := current_setting('probe.ses'); v_membership text := current_setting('probe.membership');
    v text;
    v_id uuid;
BEGIN
    v := pg_temp.door(NULL, pg_temp.submit('project', v_done, 'freelancer', f::text));
    PERFORM pg_temp.check(v = '42501', format('5a no JWT is 42501 (got %L)', v));
    v := pg_temp.door(m, pg_temp.submit('project', v_done, 'freelancer', f::text));
    PERFORM pg_temp.check(v = 'PM403', format('5b a 13-17 account is PM403 (got %L)', v));
    v := pg_temp.door(c, pg_temp.submit('project', gen_random_uuid()::text, 'freelancer', f::text));
    PERFORM pg_temp.check(v = 'PT404', format('5c no anchor is PT404 (got %L)', v));
    v := pg_temp.door(s, pg_temp.submit('project', v_done, 'freelancer', f::text));
    PERFORM pg_temp.check(v = 'PT403', format('5d not the client party is PT403 (got %L)', v));
    v := pg_temp.door(c, pg_temp.submit('project', v_done, 'freelancer', c::text));
    PERFORM pg_temp.check(v = 'PT422', format('5e a review of oneself is PT422 (got %L)', v));
    v := pg_temp.door(c, pg_temp.submit('project', v_done, 'freelancer', s::text));
    PERFORM pg_temp.check(v = 'PT404', format('5f a target who held no seat is PT404 (got %L)', v));
    v := pg_temp.door(c, pg_temp.submit('project', v_run, 'freelancer', h::text));
    PERFORM pg_temp.check(v = 'PT404', format('5g a seat still taken on a running engagement is PT404 (got %L)', v));
    v := pg_temp.door(c, pg_temp.submit('order_line', gen_random_uuid()::text, 'product', gen_random_uuid()::text));
    PERFORM pg_temp.check(v = 'PT501', format('5h a product review is PT501 until CK1 (got %L)', v));
    v := pg_temp.door(c, pg_temp.submit('project', v_done, 'freelancer', f::text, 4, 'too short'));
    PERFORM pg_temp.check(v = '22023', format('5i a comment under 100 characters is 22023 (got %L)', v));
    v := pg_temp.door(c, pg_temp.submit('project', v_done, 'freelancer', f::text, 6));
    PERFORM pg_temp.check(v = '22023', format('5j a rating over 5 is 22023 (got %L)', v));

    PERFORM pg_temp.check(pg_temp.avg_of(f) = '0.00/0', format('5k F starts unrated (%s)', pg_temp.avg_of(f)));
    v := pg_temp.door(c, pg_temp.submit('project', v_done, 'freelancer', f::text, 4));
    PERFORM pg_temp.check(v = '', format('5l the client reviews F on the completed engagement (got %L)', v));
    PERFORM pg_temp.check(pg_temp.avg_of(f) = '0.00/0', format('5l2 blind until F answers: F''s average has not moved (%s)', pg_temp.avg_of(f)));
    v := pg_temp.door(f, pg_temp.submit('project', v_done, 'user', c::text, 5));
    PERFORM pg_temp.check(v = '' AND pg_temp.avg_of(f) = '4.00/1',
        format('5m F reviews C back, which reveals the pair: F''s average moves to 4.00 over 1 (got %L, %s)', v, pg_temp.avg_of(f)));
    SELECT r.id INTO v_id FROM reviews.entity_reviews r WHERE r.target_entity_id = f AND r.reviewer_user_id = c;
    PERFORM set_config('probe.review_f', v_id::text, true);
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM reviews.entity_reviews r WHERE r.id = v_id
                                    AND r.project_id = v_done::uuid AND r.window_closes_at > now() + interval '27 days'),
        '5n the review carries its anchor and a window 30 days from completion');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = f
                                    AND n.type = 'review.received' AND n.entity_id = v_id
                                    AND n.action_url LIKE '/@%/reviews'),
        '5o F is told, at /@handle/reviews');
    v := pg_temp.door(c, pg_temp.submit('project', v_done, 'freelancer', f::text, 2));
    PERFORM pg_temp.check(v = 'PT409', format('5p a second review of F on the engagement is PT409 (got %L)', v));

    v := pg_temp.door(c, pg_temp.submit('project', v_run, 'freelancer', k::text, 5));
    PERFORM pg_temp.check(v = '', format('5q a seat released after work began opens a review (got %L)', v));
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM reviews.entity_reviews r WHERE r.target_entity_id = k
                                    AND r.stage_assignment_id IS NOT NULL),
        '5r that review names the released seat');

    v := pg_temp.door(c, pg_temp.submit('cohort_membership', v_membership, 'freelancer', f::text, 5));
    PERFORM pg_temp.check(v = '', format('5s the attendee of a completed sitting reviews the session (got %L)', v));
    PERFORM pg_temp.check(pg_temp.avg_of(f) = '4.50/2', format('5t F''s average is 4.50 over 2 (%s)', pg_temp.avg_of(f)));
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM projects.session_events se
                                       JOIN projects.cohort_memberships cm ON cm.cohort_id = se.cohort_id
                                      WHERE cm.id = v_membership::uuid AND se.review_asked_at IS NOT NULL),
        '5u a review never touches the sitting''s review_asked_at (Decision #383 R6)');

    UPDATE projects.project_status_history SET created_at = now() - interval '31 days'
     WHERE project_id = v_done::uuid AND to_status = 'completed';
    v := pg_temp.door(c, pg_temp.submit('project', v_done, 'freelancer', g::text, 3));
    PERFORM pg_temp.check(v = 'PT410', format('5v 31 days after completion the window is closed: PT410 (got %L)', v));
    UPDATE projects.project_status_history SET created_at = now() - interval '2 days'
     WHERE project_id = v_done::uuid AND to_status = 'completed';
END $$;

-- An engagement bought from a listing (a seeded one, its own reviews set aside inside this
-- transaction, so a live review written on it since the reset does not move the fixture). Its review
-- shows on the listing, moves the listing's average as well as the provider's, and the provider is
-- told at /view.
DO $$
DECLARE
    r record;
    v text;
    v_before integer;
BEGIN
    SELECT p.id, p.client_user_id, b.id AS blueprint, b.freelancer_profile_id AS provider
      INTO r
      FROM projects.projects p
      JOIN marketplace.service_blueprints b ON b.id = p.source_blueprint_id
     WHERE p.status = 'completed' AND p.client_user_id IS NOT NULL AND b.owner_team_id IS NULL
       AND NOT org.fn_is_minor(p.client_user_id)
     ORDER BY p.id
     LIMIT 1;
    IF r.id IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture: no completed engagement bought from a listing (deno task db:reset)';
    END IF;
    DELETE FROM reviews.entity_reviews er WHERE er.project_id = r.id;
    UPDATE projects.project_status_history h SET created_at = now() - interval '2 days'
     WHERE h.project_id = r.id AND h.to_status = 'completed';
    SELECT b.rating_count INTO v_before FROM marketplace.service_blueprints b WHERE b.id = r.blueprint;
    v := pg_temp.door(r.client_user_id, pg_temp.submit('project', r.id::text, 'freelancer', r.provider::text, 5));
    PERFORM pg_temp.check(v = '', format('5w the buyer of a listing reviews its provider (got %L)', v));
    v := pg_temp.door(r.provider, pg_temp.submit('project', r.id::text, 'user', r.client_user_id::text, 5));
    PERFORM pg_temp.check(v = '', format('5w2 the provider reviews the buyer back, revealing the pair (got %L)', v));
    PERFORM pg_temp.check((SELECT b.rating_count FROM marketplace.service_blueprints b WHERE b.id = r.blueprint) = v_before + 1,
        '5x the listing''s count moves with its provider''s review');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM comms.notifications n
                                   JOIN reviews.entity_reviews er ON er.id = n.entity_id
                                  WHERE er.project_id = r.id AND er.service_blueprint_id = r.blueprint
                                    AND n.user_id = r.provider AND n.type = 'review.received'
                                    AND n.action_url LIKE '/view/svc-%#evp-reviews'),
        '5y the provider is told at the listing''s /view page, #evp-reviews');
END $$;
-- #endregion

-- #region 6. Edits, the reply, withdrawal and hiding
DO $$
DECLARE
    c uuid := current_setting('probe.c'); f uuid := current_setting('probe.f');
    g uuid := current_setting('probe.g'); s uuid := current_setting('probe.s');
    v_admin uuid := current_setting('probe.admin');
    v_done text := current_setting('probe.done');
    v_review text := current_setting('probe.review_f');
    v_long text := repeat('Edited after a second look at the handover and the documentation. ', 2);
    v text;
    v_g uuid;
BEGIN
    v := pg_temp.door(s, format('SELECT reviews.edit_review(%L, 5, NULL, %L)', v_review, v_long));
    PERFORM pg_temp.check(v = 'PT403', format('6a a stranger editing is PT403 (got %L)', v));
    v := pg_temp.door(c, format('SELECT reviews.edit_review(%L, 5, NULL, %L)', v_review, v_long));
    PERFORM pg_temp.check(v = '', format('6b the author edits inside the window (got %L)', v));
    PERFORM pg_temp.check(pg_temp.avg_of(f) = '5.00/2', format('6c the edit moves F''s average to 5.00 (%s)', pg_temp.avg_of(f)));

    v := pg_temp.door(s, format('SELECT reviews.reply_to_review(%L, %L)', v_review, 'Thank you.'));
    PERFORM pg_temp.check(v = 'PT403', format('6d a stranger replying is PT403 (got %L)', v));
    v := pg_temp.door(f, format('SELECT reviews.reply_to_review(%L, %L)', v_review, repeat('x', 1001)));
    PERFORM pg_temp.check(v = '22023', format('6e a reply over 1,000 characters is 22023 (got %L)', v));
    v := pg_temp.door(f, format('SELECT reviews.reply_to_review(%L, %L)', v_review, 'Thank you, it was a pleasure.'));
    PERFORM pg_temp.check(v = '', format('6f the reviewed freelancer replies (got %L)', v));
    v := pg_temp.door(f, format('SELECT reviews.reply_to_review(%L, %L)', v_review, 'And again.'));
    PERFORM pg_temp.check(v = 'PT409', format('6g there is one reply only: a second is PT409 (got %L)', v));
    v := pg_temp.door(f, format('SELECT reviews.edit_reply(%L, %L)', v_review, 'Thank you, truly.'));
    PERFORM pg_temp.check(v = '', format('6h the reply is editable inside 7 days (got %L)', v));
    UPDATE reviews.entity_reviews SET replied_at = now() - interval '8 days' WHERE id = v_review::uuid;
    v := pg_temp.door(f, format('SELECT reviews.edit_reply(%L, %L)', v_review, 'Too late.'));
    PERFORM pg_temp.check(v = 'PT410', format('6i after 7 days the reply is fixed: PT410 (got %L)', v));
    v := pg_temp.door(c, format('SELECT reviews.edit_review(%L, 1, NULL, %L)', v_review, v_long));
    PERFORM pg_temp.check(v = 'PT409', format('6j the author may not edit after the reply: PT409 (got %L)', v));

    v := pg_temp.door(f, format('SELECT reviews.hide_review(%L, %L)', v_review, 'probe'));
    PERFORM pg_temp.check(v = '42501', format('6k hiding is an operator''s: 42501 for anyone else (got %L)', v));
    v := pg_temp.door(v_admin, format('SELECT reviews.hide_review(%L, %L)', v_review, 'Probe: off-topic'));
    PERFORM pg_temp.check(v = '', format('6l an operator hides it (got %L)', v));
    PERFORM pg_temp.check(pg_temp.avg_of(f) = '5.00/1', format('6m hiding moves F''s average back to the one visible review (%s)', pg_temp.avg_of(f)));
    PERFORM pg_temp.act('anon');
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM reviews.entity_reviews r WHERE r.id = v_review::uuid),
        '6n a guest no longer reads the hidden review');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM reviews.entity_reviews r WHERE r.id = v_review::uuid),
        '6o the hidden review is kept');

    v := pg_temp.door(c, pg_temp.submit('project', v_done, 'freelancer', g::text, 2));
    PERFORM pg_temp.check(v = '', format('6p the client reviews G (got %L)', v));
    v := pg_temp.door(g, pg_temp.submit('project', v_done, 'user', c::text, 4));
    PERFORM pg_temp.check(v = '', format('6p2 G reviews the client back, revealing the pair (got %L)', v));
    SELECT r.id INTO v_g FROM reviews.entity_reviews r WHERE r.target_entity_id = g AND r.reviewer_user_id = c;
    PERFORM pg_temp.check(pg_temp.avg_of(g) = '2.00/1', format('6q G''s average is 2.00 over 1 (%s)', pg_temp.avg_of(g)));
    v := pg_temp.door(c, format('SELECT reviews.withdraw_review(%L)', v_g));
    PERFORM pg_temp.check(v = '' AND pg_temp.avg_of(g) = '0.00/0',
        format('6r the author withdraws it and G is unrated again (got %L, %s)', v, pg_temp.avg_of(g)));
    v := pg_temp.door(c, pg_temp.submit('project', v_done, 'freelancer', g::text, 5));
    PERFORM pg_temp.check(v = 'PT409', format('6s a withdrawn review still counts: a second is PT409 (got %L)', v));
END $$;
-- #endregion

-- #region 7. The seat clock, the reads and the reminder
DO $$
DECLARE
    c uuid := current_setting('probe.c'); h uuid := current_setting('probe.h');
    v_done text := current_setting('probe.done'); v_run uuid := current_setting('probe.run');
    v_items jsonb;
    v_ended timestamptz;
    v_rem uuid;
    v_rstage uuid;
    v text;
    v_backdate text := format($q$UPDATE projects.stage_assignments sa SET ended_at = now() - interval '100 days'
      FROM projects.project_stages ps
     WHERE ps.id = sa.project_stage_id AND ps.project_id = %L AND sa.status = 'released'$q$, v_run);
BEGIN
    SELECT sa.ended_at INTO v_ended FROM projects.stage_assignments sa
      JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
     WHERE ps.project_id = v_run AND sa.status = 'released';
    PERFORM pg_temp.check(v_ended > now() - interval '1 minute', '7a a released seat is stamped as it ends');
    v := pg_temp.door(c, v_backdate);
    PERFORM pg_temp.check(v = '42501', format('7b the project owner cannot write the seat at all (ST5; got %L)', v));
    EXECUTE v_backdate;
    PERFORM pg_temp.check((SELECT sa.ended_at FROM projects.stage_assignments sa
                             JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                            WHERE ps.project_id = v_run AND sa.status = 'released') = v_ended,
        '7b2 a door''s write that leaves the status alone cannot backdate the stamp');

    PERFORM pg_temp.act('authenticated', c);
    v_items := reviews.get_reviewables((SELECT p.slug FROM projects.projects p WHERE p.id = v_done::uuid));
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(jsonb_array_length(v_items) = 2
                          AND (SELECT count(*) FROM jsonb_array_elements(v_items) e WHERE e -> 'review' IS NOT NULL
                                 AND e -> 'review' <> 'null'::jsonb) = 2,
        format('7c get_reviewables lists both providers with the client''s review of each (%s)', v_items));

    -- A fresh completed engagement on which G's seat is unreviewed, completed four days ago.
    INSERT INTO projects.projects (id, owner_user_id, title, status, visibility, currency, budget_type)
    VALUES (gen_random_uuid(), c, 'Reviews probe: remind', 'active', 'unlisted', 'USD', 'fixed_price')
    RETURNING id INTO v_rem;
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_rem, 'Build', 1)
    RETURNING id INTO v_rstage;
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
    VALUES (v_rstage, 'freelancer', current_setting('probe.g')::uuid, c, 'completed');
    UPDATE projects.projects SET status = 'completed' WHERE id = v_rem;
    INSERT INTO projects.project_status_history (project_id, actor_user_id, from_status, to_status, created_at)
    VALUES (v_rem, c, 'active', 'completed', now() - interval '4 days');

    PERFORM reviews.fn_send_review_reminders(now());
    PERFORM pg_temp.check((SELECT count(*) FROM reviews.review_reminders rr WHERE rr.user_id = c AND rr.project_id = v_rem) = 1,
        '7d the reminder asks the client about the unreviewed engagement');
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM reviews.review_reminders rr WHERE rr.user_id = c
                                        AND rr.project_id IN (v_done::uuid, v_run)),
        '7e and not about engagements whose eligible providers are all reviewed');
    PERFORM reviews.fn_send_review_reminders(now());
    PERFORM pg_temp.check((SELECT count(*) FROM reviews.review_reminders rr WHERE rr.user_id = c AND rr.project_id = v_rem) = 1,
        '7f a second run asks nobody twice');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = c AND n.type = 'review.reminder'
                                    AND n.entity_id = v_rem AND n.action_url LIKE '/projects/prj-%?review=prj-%'),
        '7g the reminder links the dialog on the project''s Overview');
END $$;
-- #endregion

-- #region Verdict
DO $$
DECLARE
    v_fails text;
    v_n integer;
BEGIN
    SELECT count(*), string_agg(label, E'\n  ' ORDER BY label) INTO v_n, v_fails FROM probe_fail;
    IF v_n > 0 THEN
        RAISE EXCEPTION E'PROBE FAIL: % check(s):\n  %', v_n, v_fails;
    END IF;
END $$;
-- #endregion

ROLLBACK;
