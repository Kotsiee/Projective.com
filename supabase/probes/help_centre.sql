-- =============================================================================================
-- Probe: the help centre's tables, policies and helpfulness writer (P2, Decision #274).
--
--   1. Catalog: editorial.help_categories / help_articles and community.help_feedback exist with
--      RLS on; both help tables are SELECT-only for anon and authenticated (no client INSERT,
--      UPDATE or DELETE, and SELECT-only policies); community.help_feedback has NO policy and NO
--      client privilege; community.submit_help_feedback is executable by anon and authenticated;
--      both slug guards are attached.
--   2. The generated seed (00005071): eight categories, at least thirty articles, FAQ ranks 1–8.
--   3. Visibility: anon reads every published article and none dated in the future or archived.
--   4. Permanent slugs: a slug UPDATE is refused (23514); a title edit and a by-slug upsert keep it.
--      4b. The order keys are DEFERRABLE INITIALLY DEFERRED: a regenerated seed's upsert that swaps
--      two FAQ ranks, two places in a category or two Topics places applies; a real duplicate is
--      still refused (23505) once checked; a slug over 80 characters is refused on both tables.
--   5. The writer as a guest: a vote lands with no voter; a "No" comment is masked through
--      comms.mask_pii with its categories; a comment with "Yes", an over-long comment and a NULL
--      answer are refused (22023); an unpublished or unknown article is refused (PH404).
--   6. The writer as a member: the voter is stamped from auth.uid(); a second vote on one article
--      inside a day writes nothing and answers duplicate; the per-voter hourly ceiling and the
--      per-article guest ceiling refuse (PH429).
--   7. No client reads, writes, edits or deletes a vote or an editorial row directly (42501).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/help_centre.sql
--
-- Every expected refusal is asserted: a statement that SUCCEEDS where it must be refused raises
-- `FAIL …` and aborts the run (non-zero exit under ON_ERROR_STOP). A clean run prints only PASS
-- notices. Fixtures: the generated help seed, and any seeded profile (org.users_public) as the member.
-- =============================================================================================

BEGIN;

-- #region 1. Catalog (as postgres)
DO $$
DECLARE
    v_fail text[] := '{}';
    v_table text;
    v_role text;
    v_priv text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['editorial.help_categories', 'editorial.help_articles', 'community.help_feedback'] LOOP
        IF to_regclass(v_table) IS NULL THEN
            RAISE EXCEPTION 'FAIL % does not exist', v_table;
        END IF;
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table::regclass) THEN
            v_fail := v_fail || format('RLS is off on %s', v_table);
        END IF;
    END LOOP;

    FOREACH v_table IN ARRAY ARRAY['editorial.help_categories', 'editorial.help_articles'] LOOP
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF NOT has_table_privilege(v_role, v_table, 'SELECT') THEN
                v_fail := v_fail || format('%s cannot SELECT %s', v_role, v_table);
            END IF;
            FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
                IF has_table_privilege(v_role, v_table, v_priv) THEN
                    v_fail := v_fail || format('%s holds %s on %s', v_role, v_priv, v_table);
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'editorial' AND tablename IN ('help_categories', 'help_articles')
            AND cmd <> 'SELECT'
    ) THEN
        v_fail := v_fail || 'a help table carries a non-SELECT policy'::text;
    END IF;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'editorial' AND tablename IN ('help_categories', 'help_articles')) <> 2 THEN
        v_fail := v_fail || 'the help tables should carry exactly one SELECT policy each'::text;
    END IF;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
            IF has_table_privilege(v_role, 'community.help_feedback', v_priv) THEN
                v_fail := v_fail || format('%s holds %s on community.help_feedback', v_role, v_priv);
            END IF;
        END LOOP;
        IF NOT has_function_privilege(v_role, 'community.submit_help_feedback(text, boolean, text)', 'EXECUTE') THEN
            v_fail := v_fail || format('%s cannot EXECUTE community.submit_help_feedback', v_role);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'community' AND tablename = 'help_feedback') THEN
        v_fail := v_fail || 'community.help_feedback carries a policy'::text;
    END IF;

    IF (SELECT count(*) FROM pg_trigger
        WHERE tgname IN ('trg_help_categories_slug_immutable', 'trg_help_articles_slug_immutable')
            AND NOT tgisinternal) <> 2 THEN
        v_fail := v_fail || 'a help slug guard is not attached'::text;
    END IF;

    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL %', array_to_string(v_fail, E'\n     ');
    END IF;
    RAISE NOTICE 'PASS catalog: RLS on, help tables read-only, votes closed, writer open to clients, slug guards attached';
END $$;
-- #endregion

-- #region 2. The generated seed (as postgres)
DO $$
DECLARE
    v_categories integer;
    v_articles integer;
    v_ranks smallint[];
BEGIN
    SELECT count(*) INTO v_categories FROM editorial.help_categories;
    SELECT count(*) INTO v_articles FROM editorial.help_articles;
    SELECT array_agg(faq_rank ORDER BY faq_rank) INTO v_ranks FROM editorial.help_articles WHERE faq_rank IS NOT NULL;
    IF v_categories <> 8 OR v_articles < 30 OR v_ranks <> ARRAY[1, 2, 3, 4, 5, 6, 7, 8]::smallint[] THEN
        RAISE EXCEPTION 'FAIL seed: % categories, % articles, FAQ ranks %', v_categories, v_articles, v_ranks;
    END IF;
    PERFORM set_config('probe.articles', v_articles::text, true);
    RAISE NOTICE 'PASS seed: % categories, % articles, FAQ ranks %', v_categories, v_articles, v_ranks;
END $$;
-- #endregion

-- #region 3. Visibility (a future and an archived article, then anon)
INSERT INTO editorial.help_articles (slug, category_slug, position, title, summary, roles, sections, updated_on, published_on, archived_on)
VALUES
    ('probe-future', 'getting-started', 900, 'Future', 'Not yet.', ARRAY['client']::text[],
     '[{"id":"a","heading":"A","body":[{"type":"p","content":"x"}]}]'::jsonb,
     (now() AT TIME ZONE 'UTC')::date + 1, (now() AT TIME ZONE 'UTC')::date + 1, NULL),
    ('probe-archived', 'getting-started', 901, 'Archived', 'Gone.', ARRAY['client']::text[],
     '[{"id":"a","heading":"A","body":[{"type":"p","content":"x"}]}]'::jsonb,
     (now() AT TIME ZONE 'UTC')::date - 3, (now() AT TIME ZONE 'UTC')::date - 3, (now() AT TIME ZONE 'UTC')::date);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_seen integer;
BEGIN
    SELECT count(*) INTO v_seen FROM editorial.help_articles;
    IF v_seen <> current_setting('probe.articles')::integer THEN
        RAISE EXCEPTION 'FAIL anon sees % articles, expected %', v_seen, current_setting('probe.articles');
    END IF;
    IF EXISTS (SELECT 1 FROM editorial.help_articles WHERE slug IN ('probe-future', 'probe-archived')) THEN
        RAISE EXCEPTION 'FAIL anon sees a future or archived article';
    END IF;
    IF (SELECT count(*) FROM editorial.help_categories) <> 8 THEN
        RAISE EXCEPTION 'FAIL anon does not see every category';
    END IF;
    RAISE NOTICE 'PASS visibility: anon reads % published articles, no future or archived one', v_seen;
END $$;
RESET ROLE;
-- #endregion

-- #region 4. Permanent slugs (as postgres)
DO $$
BEGIN
    UPDATE editorial.help_articles SET title = 'What escrow means on Projective (edited)' WHERE slug = 'what-is-escrow';
    INSERT INTO editorial.help_articles AS a (slug, category_slug, position, title, summary, roles, sections, updated_on, published_on)
    SELECT slug, category_slug, position, title, summary, roles, sections, updated_on, published_on
    FROM editorial.help_articles WHERE slug = 'what-is-escrow'
    ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title;
    BEGIN
        UPDATE editorial.help_articles SET slug = 'escrow-explained' WHERE slug = 'what-is-escrow';
        RAISE EXCEPTION 'FAIL an article slug changed';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS an article slug change is refused [%]', SQLSTATE;
    END;
    BEGIN
        UPDATE editorial.help_categories SET slug = 'money' WHERE slug = 'escrow-and-payments';
        RAISE EXCEPTION 'FAIL a category slug changed';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS a category slug change is refused [%]', SQLSTATE;
    END;
    RAISE NOTICE 'PASS a title edit and a by-slug upsert leave the slug alone';
END $$;
-- #endregion

-- #region 4b. A regenerated seed that reorders applies (as postgres)
-- The order keys are deferred to COMMIT, so the generator's by-slug upsert can swap two places in one
-- statement — a re-ranked FAQ, a reordered category, a reordered Topics list. SET CONSTRAINTS …
-- IMMEDIATE then checks them here, before the ROLLBACK, and a real duplicate is still refused.
DO $$
DECLARE
    v_fail text[] := '{}';
    v_a text;
    v_b text;
    v_first text;
BEGIN
    SELECT array_agg(conname::text ORDER BY conname) FILTER (WHERE NOT (condeferrable AND condeferred))
    INTO v_fail
    FROM pg_constraint
    WHERE conname IN ('help_categories_position_key', 'help_articles_category_position_key', 'help_articles_faq_rank_key')
        AND connamespace = 'editorial'::regnamespace;
    IF v_fail IS NOT NULL OR (SELECT count(*) FROM pg_constraint
        WHERE conname IN ('help_categories_position_key', 'help_articles_category_position_key', 'help_articles_faq_rank_key')
            AND connamespace = 'editorial'::regnamespace) <> 3 THEN
        RAISE EXCEPTION 'FAIL an order key is missing or not DEFERRABLE INITIALLY DEFERRED: %', v_fail;
    END IF;

    -- The FAQ's first two questions swap ranks, through the generated upsert's own shape.
    SELECT slug INTO v_a FROM editorial.help_articles WHERE faq_rank = 1;
    SELECT slug INTO v_b FROM editorial.help_articles WHERE faq_rank = 2;
    INSERT INTO editorial.help_articles (slug, category_slug, position, title, summary, roles, sections, updated_on, published_on, faq_rank, faq_question)
    SELECT s.slug, s.category_slug, s.position, s.title, s.summary, s.roles, s.sections, s.updated_on, s.published_on,
        CASE WHEN s.slug = v_a THEN 2 ELSE 1 END, s.faq_question
    FROM editorial.help_articles s
    WHERE s.slug IN (v_a, v_b)
    ON CONFLICT ("slug") DO UPDATE SET "faq_rank" = EXCLUDED."faq_rank", "faq_question" = EXCLUDED."faq_question";

    -- A category's first two articles swap places.
    INSERT INTO editorial.help_articles (slug, category_slug, position, title, summary, roles, sections, updated_on, published_on)
    SELECT s.slug, s.category_slug, 1 - s.position, s.title, s.summary, s.roles, s.sections, s.updated_on, s.published_on
    FROM editorial.help_articles s
    WHERE s.category_slug = 'escrow-and-payments' AND s.position IN (0, 1)
    ON CONFLICT ("slug") DO UPDATE SET "position" = EXCLUDED."position";

    -- The Topics list's first two categories swap places.
    INSERT INTO editorial.help_categories (slug, position, title, description, icon)
    SELECT c.slug, 1 - c.position, c.title, c.description, c.icon
    FROM editorial.help_categories c
    WHERE c.position IN (0, 1)
    ON CONFLICT ("slug") DO UPDATE SET "position" = EXCLUDED."position";

    SET CONSTRAINTS editorial.help_categories_position_key, editorial.help_articles_category_position_key,
        editorial.help_articles_faq_rank_key IMMEDIATE;

    SELECT slug INTO v_first FROM editorial.help_articles WHERE faq_rank = 1;
    IF v_first IS DISTINCT FROM v_b OR (SELECT slug FROM editorial.help_articles WHERE faq_rank = 2) IS DISTINCT FROM v_a THEN
        RAISE EXCEPTION 'FAIL the FAQ swap did not land: rank 1 is %', v_first;
    END IF;
    RAISE NOTICE 'PASS a reordered upsert applies: FAQ ranks swapped (% ↔ %), a category reordered, the Topics reordered', v_a, v_b;

    BEGIN
        UPDATE editorial.help_articles SET faq_rank = 1 WHERE slug = v_a;
        RAISE EXCEPTION 'FAIL two articles share FAQ rank 1';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'PASS a real duplicate rank is still refused [%]', SQLSTATE;
    END;

    SET CONSTRAINTS editorial.help_categories_position_key, editorial.help_articles_category_position_key,
        editorial.help_articles_faq_rank_key DEFERRED;

    -- One slug bound for both tables and a vote (HELP_CENTRE_SLUG_MAX = 80).
    BEGIN
        INSERT INTO editorial.help_categories (slug, position, title, description, icon)
        VALUES (repeat('a', 81), 99, 'X', 'X.', 'flag');
        RAISE EXCEPTION 'FAIL an 81-character category slug was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS an 81-character category slug is refused [%]', SQLSTATE;
    END;
    BEGIN
        INSERT INTO editorial.help_articles (slug, category_slug, position, title, summary, roles, sections, updated_on, published_on)
        VALUES (repeat('a', 81), 'getting-started', 950, 'X', 'X.', ARRAY['client']::text[],
            '[{"id":"a","heading":"A","body":[{"type":"p","content":"x"}]}]'::jsonb,
            (now() AT TIME ZONE 'UTC')::date, (now() AT TIME ZONE 'UTC')::date);
        RAISE EXCEPTION 'FAIL an 81-character article slug was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS an 81-character article slug is refused [%]', SQLSTATE;
    END;
END $$;
-- #endregion

-- #region 5. The writer as a guest
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_out jsonb;
    v_sql text;
BEGIN
    v_out := community.submit_help_feedback('fees', true);
    IF v_out <> '{"recorded": true, "duplicate": false}'::jsonb THEN
        RAISE EXCEPTION 'FAIL guest vote: %', v_out;
    END IF;
    v_out := community.submit_help_feedback('  FEES ', false, 'Write to me at someone@example.com please');
    IF NOT (v_out ->> 'recorded')::boolean THEN
        RAISE EXCEPTION 'FAIL guest No with a comment: %', v_out;
    END IF;
    RAISE NOTICE 'PASS a guest votes Yes, and No with a comment';

    FOREACH v_sql IN ARRAY ARRAY[
        'SELECT community.submit_help_feedback(''fees'', true, ''Great'')',
        format('SELECT community.submit_help_feedback(''fees'', false, %L)', repeat('x', 281)),
        'SELECT community.submit_help_feedback(''fees'', NULL)'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL accepted: %', left(v_sql, 120);
        EXCEPTION WHEN SQLSTATE '22023' THEN
            RAISE NOTICE 'PASS refused [%]: %', SQLSTATE, left(v_sql, 120);
        END;
    END LOOP;
    FOREACH v_sql IN ARRAY ARRAY[
        'SELECT community.submit_help_feedback(''probe-future'', true)',
        'SELECT community.submit_help_feedback(''probe-archived'', true)',
        'SELECT community.submit_help_feedback(''no-such-article'', true)'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL accepted: %', v_sql;
        EXCEPTION WHEN SQLSTATE 'PH404' THEN
            RAISE NOTICE 'PASS refused [%]: %', SQLSTATE, v_sql;
        END;
    END LOOP;
END $$;
RESET ROLE;

DO $$
DECLARE
    r record;
BEGIN
    SELECT * INTO r FROM community.help_feedback WHERE article_slug = 'fees' AND NOT helpful;
    IF r.comment IS NULL OR r.comment LIKE '%someone@example.com%' OR r.comment NOT LIKE '%[email hidden]%'
        OR r.comment_pii_categories <> ARRAY['email']::text[] OR r.user_id IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL stored comment: % categories % voter %', r.comment, r.comment_pii_categories, r.user_id;
    END IF;
    IF (SELECT count(*) FROM community.help_feedback WHERE article_slug = 'fees') <> 2 THEN
        RAISE EXCEPTION 'FAIL expected two guest votes on fees';
    END IF;
    RAISE NOTICE 'PASS the comment is stored masked (%), no voter on a guest vote', r.comment;
END $$;
-- #endregion

-- #region 6. The writer as a member
DO $$
DECLARE
    v_user uuid;
BEGIN
    SELECT user_id INTO v_user FROM org.users_public ORDER BY user_id LIMIT 1;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a seeded profile in org.users_public (deno task db:reset)';
    END IF;
    PERFORM set_config('probe.member', v_user::text, true);
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.member'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_first jsonb;
    v_again jsonb;
BEGIN
    v_first := community.submit_help_feedback('withdraw-your-earnings', true);
    v_again := community.submit_help_feedback('withdraw-your-earnings', false, 'Changed my mind');
    IF v_first <> '{"recorded": true, "duplicate": false}'::jsonb
        OR v_again <> '{"recorded": false, "duplicate": true}'::jsonb THEN
        RAISE EXCEPTION 'FAIL member vote then repeat: % / %', v_first, v_again;
    END IF;
    RAISE NOTICE 'PASS a member votes once per article per day (repeat: %)', v_again;
END $$;
RESET ROLE;

DO $$
BEGIN
    IF (SELECT count(*) FROM community.help_feedback
        WHERE article_slug = 'withdraw-your-earnings' AND user_id = current_setting('probe.member')::uuid) <> 1 THEN
        RAISE EXCEPTION 'FAIL the member vote was not stamped once with auth.uid()';
    END IF;
    RAISE NOTICE 'PASS the voter is stamped from auth.uid()';
    -- Fill the member's hour and one article's guest hour, as the writer would have.
    INSERT INTO community.help_feedback (article_slug, helpful, user_id)
    SELECT a.slug, true, current_setting('probe.member')::uuid
    FROM editorial.help_articles a
    WHERE a.slug NOT IN ('withdraw-your-earnings', 'fees', 'probe-future', 'probe-archived')
    ORDER BY a.slug
    LIMIT 29;
    INSERT INTO community.help_feedback (article_slug, helpful)
    SELECT 'what-is-escrow', true FROM generate_series(1, 120);
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.member'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    PERFORM community.submit_help_feedback('fees', true);
    RAISE EXCEPTION 'FAIL a member past 30 votes in an hour was accepted';
EXCEPTION WHEN SQLSTATE 'PH429' THEN
    RAISE NOTICE 'PASS the member hourly ceiling refuses [%]', SQLSTATE;
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
    BEGIN
        PERFORM community.submit_help_feedback('what-is-escrow', true);
        RAISE EXCEPTION 'FAIL an article past 120 guest votes in an hour was accepted';
    EXCEPTION WHEN SQLSTATE 'PH429' THEN
        RAISE NOTICE 'PASS the per-article guest ceiling refuses [%]', SQLSTATE;
    END;
    PERFORM community.submit_help_feedback('stages-and-tickets', true);
    RAISE NOTICE 'PASS another article still takes guest votes';
END $$;
RESET ROLE;
-- #endregion

-- #region 7. No direct client access
DO $$
DECLARE
    v_role text;
    v_sql text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_sql IN ARRAY ARRAY[
            'SELECT count(*) FROM community.help_feedback',
            'INSERT INTO community.help_feedback (article_slug, helpful) VALUES (''fees'', true)',
            'UPDATE community.help_feedback SET helpful = NOT helpful',
            'DELETE FROM community.help_feedback',
            'INSERT INTO editorial.help_categories (slug, position, title, description, icon) VALUES (''x'', 99, ''X'', ''X.'', ''flag'')',
            'UPDATE editorial.help_articles SET title = ''x''',
            'DELETE FROM editorial.help_articles'
        ] LOOP
            BEGIN
                EXECUTE format('SET LOCAL ROLE %I', v_role);
                EXECUTE v_sql;
                RESET ROLE;
                RAISE EXCEPTION 'FAIL % ran: %', v_role, v_sql;
            EXCEPTION WHEN insufficient_privilege THEN
                RESET ROLE;
                RAISE NOTICE 'PASS % refused [%]: %', v_role, SQLSTATE, left(v_sql, 80);
            END;
        END LOOP;
    END LOOP;
END $$;
-- #endregion

ROLLBACK;
