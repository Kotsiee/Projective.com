-- =============================================================================================
-- Probe: Standing's review component reads the reviews people actually wrote (RV3; USER_FLOWS MW-64;
-- Decision #489, closing #58-63 (h)'s ratings half).
--
--   1  a revealed client review moves its subject's `reviews` component by the hand-computed amount:
--      client_rating_avg is the Bayesian mean of the subject's revealed, visible client reviews (k = 5
--      at the delivery track's corpus mean), and the component is client_rating_avg / 5 × 20
--   2  the component is 0 until the subject's first client review (#489 (a)); `dispute_free` is 0
--      until its first escrow (#489 (b)); peer_rating_avg is never read
--   3  a team's Standing reads only the team's reviews, a member's only theirs (#489 (c))
--   4  a withdrawal recomputes the subject; a blind review moves nothing
--   5  every rung is reachable: a perfect record scores 100 and reaches Elite (L5)
--   6  org.fn_recompute_standing and org.fn_refresh_standing_reviews are definers pinned to an empty
--      search_path, and no client role executes either
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run with
-- `deno task test:probes standing_reviews`.
-- =============================================================================================

BEGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region 0. Helpers (as postgres)
CREATE TEMP TABLE probe_fail (label text NOT NULL) ON COMMIT DROP;
GRANT INSERT ON probe_fail TO PUBLIC;

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

CREATE FUNCTION pg_temp.state_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN '';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

CREATE FUNCTION pg_temp.door(p_user uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v text;
BEGIN
    PERFORM pg_temp.act('authenticated', p_user);
    v := pg_temp.state_of(p_sql);
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.person(p_tag text, p_freelancer boolean) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v uuid := gen_random_uuid();
BEGIN
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    VALUES (v, 'rv3-probe-' || v || '@projective.invalid', 'authenticated', 'authenticated', '{}'::jsonb, now());
    INSERT INTO org.users_public (user_id, username, dob, first_name, last_name, visibility)
    VALUES (v, 'rv3probe_' || p_tag || '_' || left(replace(v::text, '-', ''), 10), DATE '1990-01-01',
            'Probe', upper(p_tag), 'public');
    IF p_freelancer THEN
        INSERT INTO org.freelancer_profiles (user_id) VALUES (v);
    END IF;
    RETURN v;
END $$;

-- A completed engagement of `p_client` on which `p_provider` (a freelancer, or a team when p_team)
-- held the one completed seat; the client reviews it and the provider answers, revealing both.
-- Returns the client's review.
CREATE FUNCTION pg_temp.reviewed(p_client uuid, p_provider uuid, p_rating numeric, p_team uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_project uuid := gen_random_uuid();
    v_stage uuid;
    v text;
    v_id uuid;
    v_body text := repeat('A careful, complete and honest account of the work. ', 3);
BEGIN
    INSERT INTO projects.projects (id, owner_user_id, title, status, visibility, currency, budget_type)
    VALUES (v_project, p_client, 'RV3 probe', 'active', 'unlisted', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_project, 'Build', 1)
    RETURNING id INTO v_stage;
    IF p_team IS NULL THEN
        INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
        VALUES (v_stage, 'freelancer', p_provider, p_client, 'completed');
    ELSE
        INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, team_id, assigned_by, status)
        VALUES (v_stage, 'team', p_team, p_client, 'completed');
    END IF;
    UPDATE projects.projects SET status = 'completed' WHERE id = v_project;
    INSERT INTO projects.project_status_history (project_id, actor_user_id, from_status, to_status, created_at)
    VALUES (v_project, p_client, 'active', 'completed', now() - interval '2 days');

    v := pg_temp.door(p_client, format(
        'SELECT reviews.submit_review(%L, %L::uuid, %L::reviews.review_target_type, %L::uuid, %s, %L, %L)',
        'project', v_project, CASE WHEN p_team IS NULL THEN 'freelancer' ELSE 'team' END,
        COALESCE(p_team, p_provider), p_rating, 'Probe', v_body));
    IF v <> '' THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture: the client could not review (%)', v;
    END IF;
    SELECT r.id INTO v_id FROM reviews.entity_reviews r
     WHERE r.project_id = v_project AND r.reviewer_user_id = p_client;
    v := pg_temp.door(p_provider, format(
        'SELECT reviews.submit_review(%L, %L::uuid, %L::reviews.review_target_type, %L::uuid, %s, %L, %L)',
        'project', v_project, 'user', p_client, 5, 'Probe', v_body));
    IF v <> '' THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture: the provider could not review the client back (%)', v;
    END IF;
    RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.component(p_type text, p_id uuid, p_key text) RETURNS numeric LANGUAGE sql AS $$
    SELECT (s.components ->> p_key)::numeric FROM org.entity_standing s
     WHERE s.subject_type = p_type::org.standing_subject AND s.subject_id = p_id;
$$;
-- #endregion

-- #region 1–4. The review component (as postgres; the reviews through their doors)
-- The delivery track's corpus is set aside inside this transaction, so the figures rest on the
-- fixture alone. F is reviewed 5, G 3: m = 4. F: (5·4 + 5) / 6 = 4.1667 → 4.17 → 4.17 / 5 × 20 =
-- 16.68. G: (20 + 3) / 6 = 3.8333 → 3.83 → 15.32. Team T is reviewed 4 and its member M 2, so m over
-- all four is 3.5: T (17.5 + 4) / 6 = 3.5833 → 3.58 → 14.32; M (17.5 + 2) / 6 = 3.25 → 13.00.
DO $$
DECLARE
    c uuid := pg_temp.person('c', false);
    f uuid := pg_temp.person('f', true); g uuid := pg_temp.person('g', true);
    k uuid := pg_temp.person('k', true); m uuid := pg_temp.person('m', true);
    t uuid := gen_random_uuid();
    v_rg uuid; v_stage uuid; v_project uuid := gen_random_uuid();
    v text;
BEGIN
    DELETE FROM reviews.entity_reviews r WHERE r.target_entity_type IN ('freelancer', 'team');

    PERFORM pg_temp.reviewed(c, f, 5);
    v_rg := pg_temp.reviewed(c, g, 3);
    PERFORM org.fn_refresh_standing_reviews('freelancer', f);
    PERFORM org.fn_refresh_standing_reviews('freelancer', g);
    PERFORM pg_temp.check(
        (SELECT s.client_rating_avg FROM org.entity_standing s WHERE s.subject_type = 'freelancer' AND s.subject_id = f) = 4.17,
        '1a F''s client_rating_avg is the Bayesian mean 4.17 (k = 5 at the corpus mean 4)');
    PERFORM pg_temp.check(pg_temp.component('freelancer', f, 'reviews') = 16.68,
        format('1b F''s reviews component is 4.17 / 5 × 20 = 16.68 (got %s)', pg_temp.component('freelancer', f, 'reviews')));
    PERFORM pg_temp.check(pg_temp.component('freelancer', g, 'reviews') = 15.32,
        format('1c G''s is 15.32 (got %s)', pg_temp.component('freelancer', g, 'reviews')));

    -- 2. No review yet, no escrow yet.
    PERFORM org.fn_recompute_standing('freelancer', k);
    PERFORM pg_temp.check(pg_temp.component('freelancer', k, 'reviews') = 0,
        format('2a K, never reviewed, scores 0 for reviews (got %s)', pg_temp.component('freelancer', k, 'reviews')));
    PERFORM pg_temp.check(pg_temp.component('freelancer', k, 'dispute_free') = 0,
        format('2b K, never paid through escrow, scores 0 for dispute_free (got %s)',
               pg_temp.component('freelancer', k, 'dispute_free')));
    INSERT INTO projects.projects (id, owner_user_id, title, status, visibility, currency, budget_type)
    VALUES (v_project, c, 'RV3 probe: escrow', 'active', 'unlisted', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_project, 'Build', 1)
    RETURNING id INTO v_stage;
    INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id, amount_cents, currency, status)
    VALUES (v_stage, c, 'freelancer', k, 10000, 'USD', 'held');
    PERFORM org.fn_recompute_standing('freelancer', k);
    PERFORM pg_temp.check(pg_temp.component('freelancer', k, 'dispute_free') = 15,
        format('2c with a first escrow and no dispute, dispute_free is 15 (got %s)',
               pg_temp.component('freelancer', k, 'dispute_free')));
    UPDATE org.entity_standing SET peer_rating_avg = 5 WHERE subject_type = 'freelancer' AND subject_id = f;
    PERFORM org.fn_recompute_standing('freelancer', f);
    PERFORM pg_temp.check(pg_temp.component('freelancer', f, 'reviews') = 16.68,
        '2d peer_rating_avg is never read: a 5 written there moves nothing');
    UPDATE org.entity_standing SET peer_rating_avg = 0 WHERE subject_type = 'freelancer' AND subject_id = f;

    -- 3. A team and its member stay apart.
    INSERT INTO org.teams (id, owner_user_id, name, slug) VALUES (t, m, 'RV3 probe team', 'rv3-probe-' || left(replace(t::text, '-', ''), 10));
    PERFORM pg_temp.reviewed(c, m, 4, t);
    PERFORM pg_temp.reviewed(c, m, 2);
    PERFORM org.fn_refresh_standing_reviews('team', t);
    PERFORM org.fn_refresh_standing_reviews('freelancer', m);
    PERFORM pg_temp.check(pg_temp.component('team', t, 'reviews') = 14.32,
        format('3a the team reads only the team''s review: 14.32 (got %s)', pg_temp.component('team', t, 'reviews')));
    PERFORM pg_temp.check(pg_temp.component('freelancer', m, 'reviews') = 13.00,
        format('3b its member reads only their own: 13.00 (got %s)', pg_temp.component('freelancer', m, 'reviews')));

    -- 4. A withdrawal recomputes the subject it rated, at once; a blind review moves nothing.
    v := pg_temp.door(c, format('SELECT reviews.withdraw_review(%L)', v_rg));
    PERFORM pg_temp.check(v = '' AND pg_temp.component('freelancer', g, 'reviews') = 0,
        format('4a G''s review withdrawn: G is back to 0 for reviews (got %L, %s)', v,
               pg_temp.component('freelancer', g, 'reviews')));
END $$;

-- A review moves Standing as it is revealed: the second submit reveals the pair and the subject's
-- component moves in the same transaction, with no explicit recompute.
DO $$
DECLARE
    c uuid := pg_temp.person('c2', false);
    h uuid := pg_temp.person('h', true);
    v_project uuid := gen_random_uuid();
    v_stage uuid;
    v text;
    v_body text := repeat('A careful, complete and honest account of the work. ', 3);
    v_before numeric;
BEGIN
    INSERT INTO projects.projects (id, owner_user_id, title, status, visibility, currency, budget_type)
    VALUES (v_project, c, 'RV3 probe: live', 'active', 'unlisted', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_project, 'Build', 1)
    RETURNING id INTO v_stage;
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
    VALUES (v_stage, 'freelancer', h, c, 'completed');
    UPDATE projects.projects SET status = 'completed' WHERE id = v_project;
    INSERT INTO projects.project_status_history (project_id, actor_user_id, from_status, to_status, created_at)
    VALUES (v_project, c, 'active', 'completed', now() - interval '2 days');

    v_before := COALESCE(pg_temp.component('freelancer', h, 'reviews'), 0);
    v := pg_temp.door(c, format(
        'SELECT reviews.submit_review(%L, %L::uuid, %L::reviews.review_target_type, %L::uuid, %s, %L, %L)',
        'project', v_project, 'freelancer', h, 5, 'Probe', v_body));
    PERFORM pg_temp.check(v = '' AND COALESCE(pg_temp.component('freelancer', h, 'reviews'), 0) = v_before,
        format('4b a blind review moves nothing (got %L)', v));
    v := pg_temp.door(h, format(
        'SELECT reviews.submit_review(%L, %L::uuid, %L::reviews.review_target_type, %L::uuid, %s, %L, %L)',
        'project', v_project, 'user', c, 5, 'Probe', v_body));
    PERFORM pg_temp.check(v = '' AND pg_temp.component('freelancer', h, 'reviews') > 0,
        format('4c the reveal moves H''s reviews component off 0 at once (got %L, %s)', v,
               pg_temp.component('freelancer', h, 'reviews')));
END $$;
-- #endregion

-- #region 5. Every rung is reachable
DO $$
DECLARE
    e uuid := pg_temp.person('e', true);
    c uuid := pg_temp.person('c3', false);
    v_project uuid := gen_random_uuid();
    v_stage uuid;
BEGIN
    INSERT INTO projects.projects (id, owner_user_id, title, status, visibility, currency, budget_type)
    VALUES (v_project, c, 'RV3 probe: elite', 'active', 'unlisted', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_project, 'Build', 1)
    RETURNING id INTO v_stage;
    INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id, amount_cents, currency, status)
    VALUES (v_stage, c, 'freelancer', e, 10000, 'USD', 'released');
    INSERT INTO org.entity_standing (subject_type, subject_id, stages_completed, completion_rate, on_time_rate,
                                     client_rating_avg, dispute_rate, workload_reliability, tenure_days)
    VALUES ('freelancer', e, (SELECT max(l.min_completed_stages) FROM org.standing_levels l), 1, 1, 5, 0, 1, 400);
    PERFORM pg_temp.check(org.fn_recompute_standing('freelancer', e) = 5
                          AND (SELECT s.score FROM org.entity_standing s WHERE s.subject_type = 'freelancer' AND s.subject_id = e) = 100,
        '5a a perfect record scores 100 and reaches Elite (L5)');
END $$;
-- #endregion

-- #region 6. The functions
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT p.oid, p.proname, p.prosecdef, p.proconfig
          FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'org' AND p.proname IN ('fn_recompute_standing', 'fn_refresh_standing_reviews')
         ORDER BY p.proname
    LOOP
        PERFORM pg_temp.check(r.prosecdef AND r.proconfig @> ARRAY['search_path=""'],
            format('6a org.%s is a definer pinned to an empty search_path', r.proname));
        PERFORM pg_temp.check(NOT has_function_privilege('anon', r.oid, 'EXECUTE')
                              AND NOT has_function_privilege('authenticated', r.oid, 'EXECUTE'),
            format('6b no client role executes org.%s', r.proname));
    END LOOP;
    PERFORM pg_temp.check((SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'org' AND p.proname IN ('fn_recompute_standing', 'fn_refresh_standing_reviews')) = 2,
        '6c both functions exist');
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
