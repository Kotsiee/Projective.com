-- =============================================================================================
-- Probe: providers review the client too, double-blind, and the Client Trust Score and its warning
-- run (RV2; USER_FLOWS MK-33; Decision #486).
--
--   1  provider → client: a freelancer who held a completed seat reviews the client party of the
--      engagement; a provider whose seat was released after work began does too; a stranger is
--      PT403, a second review PT409; the review targets the client person (`user`)
--   2  double-blind: a review on an engagement is read by its author alone, moves no average and
--      tells nobody until the other side's review of it on the same anchor arrives (the second
--      submit reveals the pair and tells both) or the window closes (reviews.fn_reveal_due); a
--      session review reveals on submit; the reminder asks the provider to review the client back
--   3  Client Trust Score v1: the Bayesian mean (k = 5 at the client track's corpus mean) of the
--      party's revealed, visible provider reviews, less 0.25 per dispute it opened and lost in 12
--      months; matches a hand-computed fixture; a refunded or split dispute costs nothing; hidden
--      below 3 reviews; a withdrawal recomputes it
--   4  the warning: below 3.00 with 3 reviews, a freelancer applying to, or accepting a hire on, the
--      party's project is PT428 until reviews.acknowledge_client_trust logs the score once; the
--      `client_trust` ranking weight is seeded in the opportunity scope
--   5  the new doors are SECURITY DEFINER with search_path ''; the new tables take no client write
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run with
-- `deno task test:probes reviews_reciprocal`. Every region records its failures and the last block
-- raises one `PROBE FAIL: …` naming all of them.
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

CREATE FUNCTION pg_temp.submit(p_kind text, p_anchor uuid, p_type text, p_target uuid, p_rating numeric DEFAULT 4)
RETURNS text LANGUAGE sql AS $$
    SELECT format('SELECT reviews.submit_review(%L, %L::uuid, %L::reviews.review_target_type, %L::uuid, %s, %L, %L)',
                  p_kind, p_anchor, p_type, p_target, p_rating, 'Probe',
                  repeat('A careful, complete and honest account of the work. ', 3));
$$;

-- What `p_viewer` (NULL: a guest) reads of review `p_review` through the SELECT policy.
CREATE FUNCTION pg_temp.reads(p_viewer uuid, p_review uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
    v boolean;
BEGIN
    IF p_viewer IS NULL THEN
        PERFORM pg_temp.act('anon');
    ELSE
        PERFORM pg_temp.act('authenticated', p_viewer);
    END IF;
    SELECT EXISTS (SELECT 1 FROM reviews.entity_reviews r WHERE r.id = p_review) INTO v;
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.avg_of(p_user uuid) RETURNS text LANGUAGE sql AS $$
    SELECT fp.rating_average::text || '/' || fp.rating_count::text FROM org.freelancer_profiles fp WHERE fp.user_id = p_user;
$$;

CREATE FUNCTION pg_temp.client_avg_of(p_user uuid) RETURNS text LANGUAGE sql AS $$
    SELECT u.rating_average::text || '/' || u.rating_count::text FROM org.users_public u WHERE u.user_id = p_user;
$$;

CREATE FUNCTION pg_temp.told(p_user uuid, p_review uuid) RETURNS boolean LANGUAGE sql AS $$
    SELECT EXISTS (SELECT 1 FROM comms.notifications n
                    WHERE n.user_id = p_user AND n.type = 'review.received' AND n.entity_id = p_review);
$$;

CREATE FUNCTION pg_temp.review_by(p_reviewer uuid, p_target uuid, p_anchor uuid) RETURNS uuid LANGUAGE sql AS $$
    SELECT r.id FROM reviews.entity_reviews r
     WHERE r.reviewer_user_id = p_reviewer AND r.target_entity_id = p_target
       AND COALESCE(r.project_id, r.cohort_membership_id) = p_anchor;
$$;

-- A person (adult unless p_dob says otherwise), and a freelancer profile when p_freelancer.
CREATE FUNCTION pg_temp.person(p_tag text, p_freelancer boolean) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v uuid := gen_random_uuid();
BEGIN
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    VALUES (v, 'rv2-probe-' || v || '@projective.invalid', 'authenticated', 'authenticated', '{}'::jsonb, now());
    INSERT INTO org.users_public (user_id, username, dob, first_name, last_name, visibility)
    VALUES (v, 'rv2probe_' || p_tag || '_' || left(replace(v::text, '-', ''), 10), DATE '1990-01-01',
            'Probe', upper(p_tag), 'public');
    IF p_freelancer THEN
        INSERT INTO org.freelancer_profiles (user_id) VALUES (v);
    END IF;
    RETURN v;
END $$;

-- An engagement of `p_client` that completed two days ago, on whose one stage each of p_seats held a
-- completed seat. Returns the project.
CREATE FUNCTION pg_temp.engagement(p_client uuid, p_seats uuid[], p_title text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v uuid := gen_random_uuid();
    v_stage uuid;
    f uuid;
BEGIN
    INSERT INTO projects.projects (id, owner_user_id, title, status, visibility, currency, budget_type)
    VALUES (v, p_client, p_title, 'active', 'unlisted', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v, 'Build', 1)
    RETURNING id INTO v_stage;
    FOREACH f IN ARRAY p_seats LOOP
        INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
        VALUES (v_stage, 'freelancer', f, p_client, 'completed');
    END LOOP;
    UPDATE projects.projects SET status = 'completed' WHERE id = v;
    INSERT INTO projects.project_status_history (project_id, actor_user_id, from_status, to_status, created_at)
    VALUES (v, p_client, 'active', 'completed', now() - interval '2 days');
    RETURN v;
END $$;
-- #endregion

-- #region Fixtures (as postgres)
-- A client C; freelancers F, G and K; a stranger S. One completed engagement of C's on which F and G
-- held seats; one running engagement on which K's seat was released after K submitted work; one
-- session engagement of F's on which C holds a seat with a completed sitting.
DO $$
DECLARE
    c uuid := pg_temp.person('c', false); f uuid := pg_temp.person('f', true);
    g uuid := pg_temp.person('g', true); k uuid := pg_temp.person('k', true);
    s uuid := pg_temp.person('s', true);
    v_done uuid; v_run uuid := gen_random_uuid(); v_ses uuid := gen_random_uuid();
    v_rstage uuid; v_sstage uuid; v_cohort uuid; v_membership uuid; v_ticket uuid;
BEGIN
    v_done := pg_temp.engagement(c, ARRAY[f, g], 'RV2 probe: completed');

    INSERT INTO projects.projects (id, owner_user_id, title, status, visibility, currency, budget_type)
    VALUES (v_run, c, 'RV2 probe: running', 'active', 'unlisted', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_run, 'Build', 1)
    RETURNING id INTO v_rstage;
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
    VALUES (v_rstage, 'freelancer', k, c, 'accepted');
    INSERT INTO projects.tickets (project_id, current_stage_id, title) VALUES (v_run, v_rstage, 'Probe ticket')
    RETURNING id INTO v_ticket;
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title)
    VALUES (v_rstage, v_ticket, k, 'Probe deliverable');
    UPDATE projects.stage_assignments SET status = 'released' WHERE project_stage_id = v_rstage;

    INSERT INTO projects.projects (id, owner_user_id, title, format, session_kind, status, visibility, currency, budget_type)
    VALUES (v_ses, f, 'RV2 probe: sessions', 'session', 'normal', 'active', 'unlisted', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_ses, 'Sessions', 0)
    RETURNING id INTO v_sstage;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_ses, v_sstage, 'Probe cohort', 1, 'active') RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id, seats, status)
    VALUES (v_cohort, c, 1, 'active') RETURNING id INTO v_membership;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, status)
    VALUES (v_cohort, 'Probe sitting', now() - interval '25 hours', now() - interval '24 hours', 'completed');

    PERFORM set_config('probe.c', c::text, true);
    PERFORM set_config('probe.f', f::text, true);
    PERFORM set_config('probe.g', g::text, true);
    PERFORM set_config('probe.k', k::text, true);
    PERFORM set_config('probe.s', s::text, true);
    PERFORM set_config('probe.done', v_done::text, true);
    PERFORM set_config('probe.run', v_run::text, true);
    PERFORM set_config('probe.membership', v_membership::text, true);
END $$;
-- #endregion

-- #region 1. Provider → client
DO $$
DECLARE
    c uuid := current_setting('probe.c'); f uuid := current_setting('probe.f');
    k uuid := current_setting('probe.k'); s uuid := current_setting('probe.s');
    v_done uuid := current_setting('probe.done'); v_run uuid := current_setting('probe.run');
    v text;
BEGIN
    v := pg_temp.door(f, pg_temp.submit('project', v_done, 'user', c, 4));
    PERFORM pg_temp.check(v = '', format('1a F, who held a completed seat, reviews the client C (got %L)', v));
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM reviews.entity_reviews r
                                   WHERE r.reviewer_user_id = f AND r.target_entity_type = 'user'
                                     AND r.target_entity_id = c AND r.project_id = v_done
                                     AND r.window_closes_at > now() + interval '27 days'),
        '1b the review targets the client person, on the engagement, with its 30-day window');
    v := pg_temp.door(s, pg_temp.submit('project', v_done, 'user', c, 4));
    PERFORM pg_temp.check(v = 'PT403', format('1c a stranger reviewing the client is PT403 (got %L)', v));
    v := pg_temp.door(f, pg_temp.submit('project', v_done, 'user', c, 2));
    PERFORM pg_temp.check(v = 'PT409', format('1d a second review of C by F on it is PT409 (got %L)', v));
    v := pg_temp.door(k, pg_temp.submit('project', v_run, 'user', c, 3));
    PERFORM pg_temp.check(v = '', format('1e K, released after submitting work, reviews C (got %L)', v));
    v := pg_temp.door(f, pg_temp.submit('project', v_done, 'user', f, 4));
    PERFORM pg_temp.check(v IN ('PT422', 'PT404'), format('1f a provider never reviews themselves (got %L)', v));
END $$;
-- #endregion

-- #region 2. Double-blind
DO $$
DECLARE
    c uuid := current_setting('probe.c'); f uuid := current_setting('probe.f');
    g uuid := current_setting('probe.g'); k uuid := current_setting('probe.k');
    v_done uuid := current_setting('probe.done'); v_run uuid := current_setting('probe.run');
    v_membership uuid := current_setting('probe.membership');
    v text;
    v_cg uuid; v_gc uuid; v_fc uuid; v_cf uuid; v_kc uuid; v_ses uuid;
BEGIN
    v := pg_temp.door(c, pg_temp.submit('project', v_done, 'freelancer', g, 2));
    PERFORM pg_temp.check(v = '', format('2a the client reviews G (got %L)', v));
    v_cg := pg_temp.review_by(c, g, v_done);
    PERFORM pg_temp.check(NOT pg_temp.reads(NULL, v_cg), '2b a guest does not read C''s review of G before G''s arrives');
    PERFORM pg_temp.check(NOT pg_temp.reads(g, v_cg), '2c nor does G, its target');
    PERFORM pg_temp.check(pg_temp.reads(c, v_cg), '2d its author C does');
    PERFORM pg_temp.check(pg_temp.avg_of(g) = '0.00/0', format('2e G''s average has not moved (%s)', pg_temp.avg_of(g)));
    PERFORM pg_temp.check(NOT pg_temp.told(g, v_cg), '2f G is not told yet');

    v := pg_temp.door(g, pg_temp.submit('project', v_done, 'user', c, 5));
    PERFORM pg_temp.check(v = '', format('2g G reviews C back (got %L)', v));
    v_gc := pg_temp.review_by(g, c, v_done);
    PERFORM pg_temp.check(pg_temp.reads(NULL, v_cg) AND pg_temp.reads(NULL, v_gc),
        '2h the second submit reveals the pair: a guest reads both');
    PERFORM pg_temp.check(pg_temp.avg_of(g) = '2.00/1', format('2i G''s average moves at reveal (%s)', pg_temp.avg_of(g)));
    PERFORM pg_temp.check(pg_temp.told(g, v_cg) AND pg_temp.told(c, v_gc), '2j each side is told at reveal');

    v_fc := pg_temp.review_by(f, c, v_done);
    PERFORM pg_temp.check(NOT pg_temp.reads(NULL, v_fc), '2k F''s review of C (1a) is still blind: C has not reviewed F');
    v := pg_temp.door(c, pg_temp.submit('project', v_done, 'freelancer', f, 5));
    v_cf := pg_temp.review_by(c, f, v_done);
    PERFORM pg_temp.check(v = '' AND pg_temp.reads(NULL, v_fc) AND pg_temp.reads(NULL, v_cf),
        format('2l C''s review of F reveals F''s of C (got %L)', v));
    PERFORM pg_temp.check(pg_temp.client_avg_of(c) = '4.50/2',
        format('2m C''s client rating counts the two revealed provider reviews (%s)', pg_temp.client_avg_of(c)));

    v_kc := pg_temp.review_by(k, c, v_run);
    PERFORM pg_temp.check(NOT pg_temp.reads(NULL, v_kc), '2n K''s lone review of C stays blind inside the window');
    PERFORM reviews.fn_reveal_due(now());
    PERFORM pg_temp.check(NOT pg_temp.reads(NULL, v_kc), '2o the job leaves it blind while its window is open');
    UPDATE reviews.entity_reviews SET window_closes_at = now() - interval '1 minute' WHERE id = v_kc;
    PERFORM pg_temp.check(reviews.fn_reveal_due(now()) >= 1, '2p the job reveals a review whose window closed');
    PERFORM pg_temp.check(pg_temp.reads(NULL, v_kc) AND pg_temp.told(c, v_kc),
        '2q K''s review of C is now public, and C is told');

    v := pg_temp.door(c, pg_temp.submit('cohort_membership', v_membership, 'freelancer', f, 4));
    SELECT r.id INTO v_ses FROM reviews.entity_reviews r WHERE r.cohort_membership_id = v_membership;
    PERFORM pg_temp.check(v = '' AND pg_temp.reads(NULL, v_ses) AND pg_temp.told(f, v_ses),
        format('2r a session review reveals on submit (got %L)', v));
END $$;
-- #endregion

-- The reminder asks the provider too: a fresh engagement completed four days ago, nobody reviewed.
DO $$
DECLARE
    c uuid := current_setting('probe.c');
    p uuid := pg_temp.person('rp', true);
    v_rem uuid := pg_temp.engagement(c, ARRAY[p], 'RV2 probe: remind');
BEGIN
    UPDATE projects.project_status_history SET created_at = now() - interval '4 days'
     WHERE project_id = v_rem AND to_status = 'completed';
    PERFORM reviews.fn_send_review_reminders(now());
    PERFORM reviews.fn_send_review_reminders(now());
    PERFORM pg_temp.check((SELECT count(*) FROM reviews.review_reminders rr WHERE rr.user_id = p AND rr.project_id = v_rem) = 1
                          AND EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = p AND n.type = 'review.reminder'
                                        AND n.entity_id = v_rem AND n.body LIKE '%review of the client%'),
        '2s the provider is asked once to review the client back');
    PERFORM pg_temp.check((SELECT count(*) FROM reviews.review_reminders rr WHERE rr.user_id = c AND rr.project_id = v_rem) = 1,
        '2t and the client is asked once, as before');
END $$;

-- #region 3. Client Trust Score v1 (as postgres, the reviews through the provider door)
-- The client track's corpus is set aside inside this transaction, so the hand-computed figures below
-- rest on the fixture alone. X is reviewed 1, 2, 1; Y 5, 5, 4; Z 4, 4 (two reviews, so hidden).
-- m = 26 / 8 = 3.25. X: (5·3.25 + 4) / 8 = 2.53125 → 2.53. Y: (16.25 + 14) / 8 = 3.78125 → 3.78.
-- Z: (16.25 + 8) / 7 = 3.4643 → 3.46. Y's lost dispute: 3.78 − 0.25 = 3.53.
CREATE FUNCTION pg_temp.client_review(p_provider uuid, p_client uuid, p_rating numeric) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_project uuid := pg_temp.engagement(p_client, ARRAY[p_provider], 'RV2 probe: trust');
    v text;
    v_id uuid;
BEGIN
    v := pg_temp.door(p_provider, pg_temp.submit('project', v_project, 'user', p_client, p_rating));
    IF v <> '' THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture: % could not review % (%)', p_provider, p_client, v;
    END IF;
    v_id := pg_temp.review_by(p_provider, p_client, v_project);
    PERFORM reviews.fn_reveal(v_id);
    RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.trust(p_user uuid) RETURNS text LANGUAGE sql AS $$
    SELECT s.score::text || '/' || s.review_count::text || '/' || s.lost_disputes::text
      FROM reviews.client_trust_scores s WHERE s.subject_type = 'user' AND s.subject_id = p_user;
$$;

DO $$
DECLARE
    x uuid := pg_temp.person('x', false); y uuid := pg_temp.person('y', false);
    z uuid := pg_temp.person('z', false);
    p1 uuid := pg_temp.person('p1', true); p2 uuid := pg_temp.person('p2', true);
    p3 uuid := pg_temp.person('p3', true);
    v_x3 uuid;
    v_stage uuid; v_dproject uuid := gen_random_uuid(); v_escrow uuid; v_escrow2 uuid;
    v_dispute uuid; v_refund uuid;
BEGIN
    DELETE FROM reviews.entity_reviews r WHERE r.target_entity_type IN ('user', 'business');
    DELETE FROM reviews.client_trust_scores;

    PERFORM pg_temp.client_review(p1, x, 1);
    PERFORM pg_temp.client_review(p2, x, 2);
    v_x3 := pg_temp.client_review(p3, x, 1);
    PERFORM pg_temp.client_review(p1, y, 5);
    PERFORM pg_temp.client_review(p2, y, 5);
    PERFORM pg_temp.client_review(p3, y, 4);
    PERFORM pg_temp.client_review(p1, z, 4);
    PERFORM pg_temp.client_review(p2, z, 4);
    -- Each reveal recomputed its own subject against the corpus as it stood then; recompute all three
    -- against the finished one, as the daily job does.
    PERFORM reviews.fn_recompute_client_trust('user', x);
    PERFORM reviews.fn_recompute_client_trust('user', y);
    PERFORM reviews.fn_recompute_client_trust('user', z);

    PERFORM pg_temp.check(pg_temp.trust(x) = '2.53/3/0', format('3a X scores 2.53 over 3 reviews (%s)', pg_temp.trust(x)));
    PERFORM pg_temp.check(pg_temp.trust(y) = '3.78/3/0', format('3b Y scores 3.78 over 3 reviews (%s)', pg_temp.trust(y)));
    PERFORM pg_temp.check(pg_temp.trust(z) = '3.46/2/0', format('3c Z scores 3.46 over 2 reviews (%s)', pg_temp.trust(z)));
    PERFORM pg_temp.check(reviews.fn_client_trust_shown('user', x) = '{"score": 2.53, "warned": true, "review_count": 3}'::jsonb,
        format('3d X''s score shows, warned (%s)', reviews.fn_client_trust_shown('user', x)));
    PERFORM pg_temp.check(reviews.fn_client_trust_shown('user', z) IS NULL, '3e Z''s score is hidden below 3 reviews');
    PERFORM pg_temp.act('anon');
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM reviews.client_trust_scores s WHERE s.subject_id = x)
                          AND NOT EXISTS (SELECT 1 FROM reviews.client_trust_scores s WHERE s.subject_id = z),
        '3f a guest reads X''s shown score and not Z''s hidden one');
    PERFORM pg_temp.act(NULL);

    -- Y opens a dispute on a stage it funded and loses it; then opens one that is refunded.
    INSERT INTO projects.projects (id, owner_user_id, title, status, visibility, currency, budget_type)
    VALUES (v_dproject, y, 'RV2 probe: dispute', 'active', 'unlisted', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_dproject, 'Build', 1)
    RETURNING id INTO v_stage;
    INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id, amount_cents, currency, status)
    VALUES (v_stage, y, 'freelancer', p1, 10000, 'USD', 'held') RETURNING id INTO v_escrow;
    INSERT INTO finance.disputes (escrow_id, opened_by_profile, reason, status)
    VALUES (v_escrow, y, 'RV2 probe: lost', 'open') RETURNING id INTO v_dispute;
    INSERT INTO finance.escrows (project_stage_id, payer_user_id, payee_type, payee_id, amount_cents, currency, status)
    VALUES (v_stage, y, 'freelancer', p2, 10000, 'USD', 'held') RETURNING id INTO v_escrow2;
    INSERT INTO finance.disputes (escrow_id, opened_by_profile, reason, status)
    VALUES (v_escrow2, y, 'RV2 probe: refunded', 'open') RETURNING id INTO v_refund;
    UPDATE finance.disputes SET status = 'resolved_release', resolved_at = now() - interval '1 day' WHERE id = v_dispute;
    PERFORM pg_temp.check(pg_temp.trust(y) = '3.53/3/1',
        format('3g a dispute Y opened and lost costs 0.25 when it is ruled (%s)', pg_temp.trust(y)));
    UPDATE finance.disputes SET status = 'resolved_refund', resolved_at = now() WHERE id = v_refund;
    PERFORM pg_temp.check(pg_temp.trust(y) = '3.53/3/1', format('3h a refunded dispute costs nothing (%s)', pg_temp.trust(y)));
    PERFORM reviews.fn_recompute_client_trust('user', y, now() + interval '13 months');
    PERFORM pg_temp.check(pg_temp.trust(y) = '3.78/3/0', format('3i after 12 months the lost dispute no longer counts (%s)', pg_temp.trust(y)));
    PERFORM reviews.fn_recompute_client_trust('user', y);

    PERFORM set_config('probe.x', x::text, true);
    PERFORM set_config('probe.y', y::text, true);
    PERFORM set_config('probe.p3', p3::text, true);
    PERFORM set_config('probe.x3', v_x3::text, true);
END $$;
-- #endregion

-- #region 4. The warning and the Informed Consent
DO $$
DECLARE
    x uuid := current_setting('probe.x'); y uuid := current_setting('probe.y');
    a uuid := pg_temp.person('a', true); b uuid := pg_temp.person('b', true);
    v_open uuid := gen_random_uuid(); v_clear uuid := gen_random_uuid();
    v_slug text; v_clear_slug text; v_stage uuid; v_inv uuid;
    v text;
    w jsonb;
BEGIN
    INSERT INTO projects.projects (id, owner_user_id, title, status, visibility, currency, budget_type)
    VALUES (v_open, x, 'RV2 probe: X''s brief', 'active', 'public', 'USD', 'fixed_price'),
           (v_clear, y, 'RV2 probe: Y''s brief', 'active', 'public', 'USD', 'fixed_price');
    INSERT INTO projects.project_stages (project_id, name, sort_order, hire_trigger_active, status)
    VALUES (v_open, 'Build', 1, true, 'open') RETURNING id INTO v_stage;
    INSERT INTO projects.project_stages (project_id, name, sort_order, hire_trigger_active, status)
    VALUES (v_clear, 'Build', 1, true, 'open');
    SELECT p.slug INTO v_slug FROM projects.projects p WHERE p.id = v_open;
    SELECT p.slug INTO v_clear_slug FROM projects.projects p WHERE p.id = v_clear;
    INSERT INTO projects.project_invitations (project_id, role, inviter_user_id, token, target_user_id, status)
    VALUES (v_open, 'manager', x, gen_random_uuid()::text, b, 'pending') RETURNING id INTO v_inv;

    PERFORM pg_temp.act('authenticated', a);
    w := reviews.get_client_trust_warning(v_slug);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((w ->> 'warned')::boolean AND (w ->> 'score')::numeric = 2.53
                          AND (w ->> 'review_count')::integer = 3 AND NOT (w ->> 'acknowledged')::boolean
                          AND w ->> 'reviews_href' LIKE '/@rv2probe_x_%/reviews',
        format('4a the freelancer reads X''s warning: 2.53 from 3 reviews, the reviews link, not acknowledged (%s)', w));

    v := pg_temp.door(a, format('SELECT projects.apply_to_project(%L, %L)', v_slug, v_stage));
    PERFORM pg_temp.check(v = 'PT428', format('4b a proposal before the acknowledgement is PT428 (got %L)', v));
    v := pg_temp.door(b, format('SELECT projects.respond_to_project_invitation(%L, true)', v_inv));
    PERFORM pg_temp.check(v = 'PT428', format('4c accepting a hire before the acknowledgement is PT428 (got %L)', v));
    v := pg_temp.door(b, format('SELECT projects.respond_to_project_invitation(%L, false)', v_inv));
    PERFORM pg_temp.check(v = '', format('4d declining needs no acknowledgement (got %L)', v));
    UPDATE projects.project_invitations SET status = 'pending', declined_at = NULL WHERE id = v_inv;

    v := pg_temp.door(a, format('SELECT reviews.acknowledge_client_trust(%L)', v_slug));
    PERFORM pg_temp.check(v = '', format('4e the freelancer acknowledges (got %L)', v));
    v := pg_temp.door(a, format('SELECT reviews.acknowledge_client_trust(%L)', v_slug));
    PERFORM pg_temp.check((SELECT count(*) FROM reviews.client_trust_consents k WHERE k.user_id = a AND k.project_id = v_open) = 1
                          AND EXISTS (SELECT 1 FROM reviews.client_trust_consents k WHERE k.user_id = a
                                         AND k.score = 2.53 AND k.review_count = 3 AND k.subject_id = x),
        '4f once per freelancer and project, with the score and count shown');
    v := pg_temp.door(a, format('SELECT projects.apply_to_project(%L, %L)', v_slug, v_stage));
    -- Past the consent the proposal meets the door's next gate, the fixture's empty proposal allowance.
    PERFORM pg_temp.check(v IN ('', 'PK403'), format('4g then the consent no longer stops the proposal (got %L)', v));
    v := pg_temp.door(b, format('SELECT reviews.acknowledge_client_trust(%L)', v_slug));
    v := pg_temp.door(b, format('SELECT projects.respond_to_project_invitation(%L, true)', v_inv));
    PERFORM pg_temp.check(v = '', format('4h and so does the hire, once acknowledged (got %L)', v));

    PERFORM pg_temp.act('authenticated', a);
    w := reviews.get_client_trust_warning(v_clear_slug);
    PERFORM pg_temp.act(NULL);
    v := pg_temp.door(a, format('SELECT reviews.acknowledge_client_trust(%L)', v_clear_slug));
    PERFORM pg_temp.check(w = '{"warned": false}'::jsonb AND v = ''
                          AND NOT EXISTS (SELECT 1 FROM reviews.client_trust_consents k WHERE k.project_id = v_clear),
        format('4i Y is not warned and an acknowledgement there logs nothing (%s)', w));
    v := pg_temp.door(NULL, format('SELECT reviews.get_client_trust_warning(%L)', v_slug));
    PERFORM pg_temp.check(v = '42501', format('4j signed out, the warning is 42501 (got %L)', v));

    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM search.search_weights sw WHERE sw.key = 'client_trust'
                                    AND sw.scope = 'opportunity' AND sw.weight = 2.50 AND sw.is_active),
        '4k the client_trust ranking weight is seeded at 2.50 in the opportunity scope');

    -- A withdrawal recomputes the score: X falls to 2 reviews, hidden, and no longer warns.
    v := pg_temp.door(current_setting('probe.p3')::uuid,
                      format('SELECT reviews.withdraw_review(%L)', current_setting('probe.x3')));
    PERFORM pg_temp.check(v = '' AND (SELECT s.review_count FROM reviews.client_trust_scores s WHERE s.subject_id = x) = 2
                          AND reviews.fn_project_trust_warning(v_open) IS NULL,
        format('4l a withdrawn review recomputes X: 2 reviews, hidden, no warning (got %L)', v));
END $$;
-- #endregion

-- #region 5. The new doors and tables
DO $$
DECLARE
    r record;
    v_names text[] := ARRAY['fn_client_targets', 'fn_counterpart', 'fn_after_review_change', 'fn_reveal',
        'fn_reveal_due', 'fn_recompute_client_trust', 'trg_dispute_client_trust', 'fn_client_trust_shown',
        'fn_project_client', 'fn_project_trust_warning', 'fn_assert_client_trust_consent',
        'get_client_trust_warning', 'acknowledge_client_trust'];
BEGIN
    PERFORM pg_temp.check((SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'reviews' AND p.proname = ANY (v_names)) = 13,
        '5a all thirteen RV2 functions exist');
    FOR r IN
        SELECT p.oid, p.proname, p.prosecdef, p.proconfig
          FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'reviews' AND p.proname = ANY (v_names)
         ORDER BY p.proname
    LOOP
        PERFORM pg_temp.check(r.prosecdef AND r.proconfig @> ARRAY['search_path=""'],
            format('5b reviews.%s is a definer with search_path pinned to empty', r.proname));
        PERFORM pg_temp.check(NOT has_function_privilege('anon', r.oid, 'EXECUTE'),
            format('5c anon may not execute reviews.%s', r.proname));
        PERFORM pg_temp.check(has_function_privilege('authenticated', r.oid, 'EXECUTE')
                                = (r.proname IN ('get_client_trust_warning', 'acknowledge_client_trust')),
            format('5d authenticated executes reviews.%s only if it is a door', r.proname));
    END LOOP;
    FOR r IN SELECT unnest(ARRAY['anon', 'authenticated']) AS role LOOP
        PERFORM pg_temp.check(NOT has_table_privilege(r.role, 'reviews.client_trust_consents', 'SELECT')
                              AND NOT has_table_privilege(r.role, 'reviews.client_trust_consents', 'INSERT')
                              AND NOT has_table_privilege(r.role, 'reviews.client_trust_scores', 'INSERT')
                              AND NOT has_table_privilege(r.role, 'reviews.client_trust_scores', 'UPDATE'),
            format('5e %s neither reads the consent log nor writes either new table', r.role));
    END LOOP;
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
