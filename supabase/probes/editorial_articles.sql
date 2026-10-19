-- =============================================================================================
-- Probe: Projective's articles — editorial.articles + editorial.article_authors (Decisions #271,
-- #274 (k)).
--
--   1. Catalog: both tables exist with RLS on; each carries exactly one policy, FOR SELECT to
--      `anon` and `authenticated`; both client roles hold SELECT and no INSERT / UPDATE / DELETE /
--      TRUNCATE; both slug-immutability triggers and the author index exist.
--   2. The generated seed (00005073): at least six published, already-public articles, every one
--      naming an existing author, with one to three known topics and a non-empty section array.
--   3. Visibility, as `anon` and as `authenticated`: the client sees exactly the published,
--      past-dated articles — a draft, a future-dated article and an archived (retracted) one added
--      by this probe stay hidden — and every author row.
--   4. Clients cannot write: INSERT / UPDATE / DELETE as either client role is refused (42501).
--   5. A slug is permanent: changing an article's or an author's slug is refused (23514), while
--      the seed's own upsert path (UPDATE of every other column) still works.
--   6. The CHECKs and the foreign key refuse a bad or over-long slug, a blank title, an unknown
--      topic, an empty, NULL-holding or four-topic list, an empty or non-array body, a
--      protocol-relative or loopback-http cover, an unknown status, an update dated before
--      publication, a bad former slug (its own, malformed, over-long, NULL, empty, more than 16),
--      bad author rows (each 23514, asserted by CONSTRAINT NAME so no case passes through another
--      CHECK) and an unknown author (23503); well-formed former slugs are accepted and round-trip.
--      A repeated topic is refused by the Zod row schema, before the generator writes a row (a
--      CHECK cannot hold the subquery that test needs); so are the cross-row former-slug rules
--      (content/articles.test.ts).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/editorial_articles.sql
--
-- Every expected refusal is asserted: a statement that SUCCEEDS where it must be refused raises
-- `FAIL …` and aborts the run (non-zero exit under ON_ERROR_STOP). A clean run prints only PASS
-- notices. Fixtures come from the generated seed migration; the three hidden articles are the
-- probe's own rows.
-- =============================================================================================

BEGIN;

-- #region 1. Catalog (as postgres)
DO $$
DECLARE
    v_fail text[] := '{}';
    v_rel text;
    v_role text;
    v_priv text;
    v_count int;
BEGIN
    FOREACH v_rel IN ARRAY ARRAY['editorial.articles', 'editorial.article_authors'] LOOP
        IF to_regclass(v_rel) IS NULL THEN
            RAISE EXCEPTION 'FAIL % does not exist', v_rel;
        END IF;
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel::regclass) THEN
            v_fail := v_fail || format('RLS is off on %s', v_rel);
        END IF;
        SELECT count(*) INTO v_count
        FROM pg_policies
        WHERE format('%I.%I', schemaname, tablename) = v_rel;
        IF v_count <> 1 THEN
            v_fail := v_fail || format('%s carries %s policies (expected 1)', v_rel, v_count);
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_policies
            WHERE format('%I.%I', schemaname, tablename) = v_rel
                AND (cmd <> 'SELECT' OR NOT (roles @> ARRAY['anon', 'authenticated']::name[]))
        ) THEN
            v_fail := v_fail || format('%s has a policy that is not FOR SELECT TO anon, authenticated', v_rel);
        END IF;
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF NOT has_table_privilege(v_role, v_rel, 'SELECT') THEN
                v_fail := v_fail || format('%s lacks SELECT on %s', v_role, v_rel);
            END IF;
            FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
                IF has_table_privilege(v_role, v_rel, v_priv) THEN
                    v_fail := v_fail || format('%s holds %s on %s', v_role, v_priv, v_rel);
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    FOREACH v_rel IN ARRAY ARRAY['trg_articles_slug_immutable', 'trg_article_authors_slug_immutable'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger t
            JOIN pg_proc p ON p.oid = t.tgfoid
            WHERE t.tgname = v_rel AND NOT t.tgisinternal
                AND p.oid = 'editorial.fn_guard_slug_immutable()'::regprocedure
        ) THEN
            v_fail := v_fail || format('trigger %s is missing or calls another function', v_rel);
        END IF;
    END LOOP;

    IF to_regclass('editorial.idx_editorial_articles_author') IS NULL THEN
        v_fail := v_fail || 'idx_editorial_articles_author is missing'::text;
    END IF;

    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL %', array_to_string(v_fail, E'\n     ');
    END IF;
    RAISE NOTICE 'PASS catalog: RLS on, one FOR SELECT policy each, SELECT-only client grants, slug triggers, author index';
END $$;
-- #endregion

-- #region 2. The generated seed
DO $$
DECLARE
    v_published int;
    v_bad text;
BEGIN
    SELECT count(*) INTO v_published
    FROM editorial.articles
    WHERE status = 'published' AND published_at <= now();
    IF v_published < 6 THEN
        RAISE EXCEPTION 'FAIL only % published articles are seeded (expected at least 6)', v_published;
    END IF;

    SELECT string_agg(a.slug, ', ') INTO v_bad
    FROM editorial.articles a
    LEFT JOIN editorial.article_authors w ON w.slug = a.author_slug
    WHERE w.slug IS NULL
        OR jsonb_typeof(a.body) <> 'array' OR jsonb_array_length(a.body) = 0
        OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(a.body) AS s (section)
            WHERE NOT (section ? 'id' AND section ? 'heading' AND jsonb_typeof(section -> 'body') = 'array')
        );
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL seeded articles with a missing author or a malformed body: %', v_bad;
    END IF;
    RAISE NOTICE 'PASS seed: % published articles, every author present, every body a section array', v_published;
END $$;

-- The probe's own hidden rows: a draft, a future-dated article and a retracted one.
INSERT INTO editorial.articles
    (slug, title, standfirst, topics, body, cover_path, cover_alt, cover_w, cover_h, author_slug,
     status, published_at, updated_at)
SELECT v.slug, 'Probe article', 'A row the probe adds and rolls back.', ARRAY['agile-delivery'],
    '[{"id":"probe","heading":"Probe","body":[{"type":"p","content":"Probe."}]}]'::jsonb,
    '/test_images/banner_1.jpg', 'Probe cover', 643, 360,
    (SELECT slug FROM editorial.article_authors ORDER BY slug LIMIT 1),
    v.status, v.published_at, v.published_at
FROM (VALUES
    ('probe-draft-article', 'draft', now() - interval '1 day'),
    ('probe-future-article', 'published', now() + interval '1 day'),
    ('probe-archived-article', 'archived', now() - interval '2 days')
) AS v (slug, status, published_at);

SELECT set_config('probe.visible', (
    SELECT count(*)::text FROM editorial.articles WHERE status = 'published' AND published_at <= now()
), true);
SELECT set_config('probe.authors', (SELECT count(*)::text FROM editorial.article_authors), true);
-- #endregion

-- #region 3 + 4. Signed out, then signed in: reads see only what is public; writes are refused
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_seen int;
    v_authors int;
    v_sql text;
BEGIN
    SELECT count(*) INTO v_seen FROM editorial.articles;
    SELECT count(*) INTO v_authors FROM editorial.article_authors;
    IF v_seen <> current_setting('probe.visible')::int THEN
        RAISE EXCEPTION 'FAIL anon sees % articles (expected %)', v_seen, current_setting('probe.visible');
    END IF;
    IF EXISTS (SELECT 1 FROM editorial.articles WHERE slug LIKE 'probe-%') THEN
        RAISE EXCEPTION 'FAIL anon sees a draft, future-dated or archived article';
    END IF;
    IF v_authors <> current_setting('probe.authors')::int THEN
        RAISE EXCEPTION 'FAIL anon sees % authors (expected %)', v_authors, current_setting('probe.authors');
    END IF;
    RAISE NOTICE 'PASS anon reads % published articles, no hidden one, every author', v_seen;

    FOREACH v_sql IN ARRAY ARRAY[
        'INSERT INTO editorial.article_authors (slug, name, role, kind, bio, avatar_path, avatar_alt, avatar_w, avatar_h) VALUES (''x'', ''X'', ''X'', ''team'', ''X'', ''/x.png'', ''X'', 1, 1)',
        'UPDATE editorial.articles SET title = ''Vandalised''',
        'DELETE FROM editorial.articles'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL anon ran: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS anon refused [%]: %', SQLSTATE, left(v_sql, 60);
        END;
    END LOOP;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_seen int;
    v_sql text;
BEGIN
    SELECT count(*) INTO v_seen FROM editorial.articles;
    IF v_seen <> current_setting('probe.visible')::int
        OR EXISTS (SELECT 1 FROM editorial.articles WHERE slug LIKE 'probe-%') THEN
        RAISE EXCEPTION 'FAIL authenticated sees % articles (expected %, none hidden)',
            v_seen, current_setting('probe.visible');
    END IF;
    RAISE NOTICE 'PASS authenticated reads % published articles, no hidden one', v_seen;

    FOREACH v_sql IN ARRAY ARRAY[
        'UPDATE editorial.article_authors SET name = ''Vandalised''',
        'DELETE FROM editorial.article_authors',
        'INSERT INTO editorial.articles (slug) VALUES (''x'')'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL authenticated ran: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS authenticated refused [%]: %', SQLSTATE, left(v_sql, 60);
        END;
    END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 5. A slug is permanent (as postgres — even the owner of the data cannot move one)
DO $$
DECLARE
    v_article text := (SELECT slug FROM editorial.articles WHERE slug NOT LIKE 'probe-%' ORDER BY slug LIMIT 1);
    v_author text := (SELECT slug FROM editorial.article_authors ORDER BY slug LIMIT 1);
BEGIN
    BEGIN
        UPDATE editorial.articles SET slug = 'moved-' || v_article WHERE slug = v_article;
        RAISE EXCEPTION 'FAIL an article slug moved';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS article slug change refused [%]: %', SQLSTATE, SQLERRM;
    END;
    BEGIN
        UPDATE editorial.article_authors SET slug = 'moved-' || v_author WHERE slug = v_author;
        RAISE EXCEPTION 'FAIL an author slug moved';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS author slug change refused [%]', SQLSTATE;
    END;

    -- The generated seed's upsert never names the slug, so a regenerated row still updates.
    UPDATE editorial.articles SET title = title || ' (probe edit)', updated_at = now()
    WHERE slug = v_article;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL an ordinary update of % did not apply', v_article;
    END IF;
    RAISE NOTICE 'PASS an ordinary update of % still applies', v_article;
END $$;
-- #endregion

-- #region 6. CHECKs and the foreign key — each refusal by the constraint it is aimed at
-- Every case names the constraint that must refuse it (GET STACKED DIAGNOSTICS … CONSTRAINT_NAME),
-- so a row that trips some other CHECK by accident fails the probe instead of passing it.
DO $$
DECLARE
    v_author text := (SELECT slug FROM editorial.article_authors ORDER BY slug LIMIT 1);
    v_case record;
    v_con text;
BEGIN
    FOR v_case IN
        SELECT * FROM (VALUES
            ('slug with a capital', 'Bad-Slug', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY[]::text[], 'articles_slug_check'),
            ('97-character slug', repeat('a', 97), 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY[]::text[], 'articles_slug_check'),
            ('blank title', 'probe-c0', '   ', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY[]::text[], 'articles_title_check'),
            ('unknown topic', 'probe-c1', 'T', ARRAY['marketing'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY[]::text[], 'articles_topics_check'),
            ('empty topics', 'probe-c2', 'T', ARRAY[]::text[], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY[]::text[], 'articles_topics_check'),
            ('NULL topic', 'probe-c3', 'T', ARRAY['agile-delivery', NULL], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY[]::text[], 'articles_topics_check'),
            ('four topics', 'probe-c4', 'T', ARRAY['agile-delivery', 'value-pricing', 'team-structure', 'escrow-and-trust'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY[]::text[], 'articles_topics_check'),
            ('empty body', 'probe-c5', 'T', ARRAY['agile-delivery'], '[]', '/c.jpg', 'published', 0, ARRAY[]::text[], 'articles_body_check'),
            ('object body', 'probe-c6', 'T', ARRAY['agile-delivery'], '{"id":"a"}', '/c.jpg', 'published', 0, ARRAY[]::text[], 'articles_body_check'),
            ('protocol-relative cover', 'probe-c7', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '//evil.example/c.jpg', 'published', 0, ARRAY[]::text[], 'articles_cover_check'),
            ('loopback http cover', 'probe-c8', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', 'http://127.0.0.1/c.jpg', 'published', 0, ARRAY[]::text[], 'articles_cover_check'),
            ('unknown status', 'probe-c9', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'live', 0, ARRAY[]::text[], 'articles_status_check'),
            ('updated before published', 'probe-c10', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', -1, ARRAY[]::text[], 'articles_dates_check'),
            ('own slug as a former one', 'probe-c11', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY['probe-c11'], 'articles_former_slugs_check'),
            ('malformed former slug', 'probe-c12', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY['old-name', 'Old_Name'], 'articles_former_slugs_check'),
            ('97-character former slug', 'probe-c13', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY['old-name', repeat('b', 97)], 'articles_former_slugs_check'),
            ('NULL former slug', 'probe-c14', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY['old-name', NULL], 'articles_former_slugs_check'),
            ('empty former slug', 'probe-c15', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY['old-name', ''], 'articles_former_slugs_check'),
            ('lone empty former slug', 'probe-c17', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY[''], 'articles_former_slugs_check'),
            ('former slug holding a space', 'probe-c18', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY['old name'], 'articles_former_slugs_check'),
            ('former slugs hiding an empty one', 'probe-c19', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, ARRAY['', 'old-name'], 'articles_former_slugs_check'),
            ('seventeen former slugs', 'probe-c16', 'T', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'published', 0, (SELECT array_agg('old-' || i) FROM generate_series(1, 17) AS i), 'articles_former_slugs_check')
        ) AS t (label, slug, title, topics, body, cover, status, updated_shift, former, constraint_name)
    LOOP
        BEGIN
            INSERT INTO editorial.articles
                (slug, title, standfirst, topics, body, cover_path, cover_alt, cover_w, cover_h,
                 author_slug, status, published_at, updated_at, former_slugs)
            VALUES (v_case.slug, v_case.title, 'S', v_case.topics, v_case.body::jsonb, v_case.cover, 'Alt',
                10, 10, v_author, v_case.status, now(), now() + make_interval(days => v_case.updated_shift),
                v_case.former);
            RAISE EXCEPTION 'FAIL % was accepted', v_case.label;
        EXCEPTION
            WHEN check_violation THEN
                GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
                IF v_con IS DISTINCT FROM v_case.constraint_name THEN
                    RAISE EXCEPTION 'FAIL % was refused by % (expected %)',
                        v_case.label, v_con, v_case.constraint_name;
                END IF;
                RAISE NOTICE 'PASS % refused by % [%]', v_case.label, v_con, SQLSTATE;
        END;
    END LOOP;

    -- A rename's new row: well-formed former slugs (one at the 96-character cap) are accepted.
    INSERT INTO editorial.articles
        (slug, title, standfirst, topics, body, cover_path, cover_alt, cover_w, cover_h,
         author_slug, status, published_at, updated_at, former_slugs)
    VALUES ('probe-renamed', 'T', 'S', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'Alt', 10, 10,
        v_author, 'draft', now(), now(), ARRAY['old-name', repeat('c', 96), 'an-older-name-2']);
    RAISE NOTICE 'PASS well-formed former slugs accepted';
    IF (SELECT former_slugs FROM editorial.articles WHERE slug = 'probe-renamed')
        <> ARRAY['old-name', repeat('c', 96), 'an-older-name-2'] THEN
        RAISE EXCEPTION 'FAIL former slugs did not round-trip';
    END IF;
    IF EXISTS (SELECT 1 FROM editorial.articles WHERE slug NOT LIKE 'probe-%' AND former_slugs <> '{}') THEN
        RAISE EXCEPTION 'FAIL a seeded article carries former slugs (the corpus has no renames yet)';
    END IF;
    RAISE NOTICE 'PASS seeded articles default to no former slugs';

    BEGIN
        INSERT INTO editorial.articles
            (slug, title, standfirst, topics, body, cover_path, cover_alt, cover_w, cover_h,
             author_slug, status, published_at, updated_at)
        VALUES ('probe-orphan', 'T', 'S', ARRAY['agile-delivery'], '[{"id":"a"}]', '/c.jpg', 'Alt', 10, 10,
            'nobody-at-all', 'published', now(), now());
        RAISE EXCEPTION 'FAIL an article naming no author was accepted';
    EXCEPTION WHEN foreign_key_violation THEN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        RAISE NOTICE 'PASS unknown author refused by % [%]', v_con, SQLSTATE;
    END;

    FOR v_case IN
        SELECT * FROM (VALUES
            ('unknown kind', 'probe-a1', 'P', 'robot', '/a.png', NULL, 'article_authors_kind_check'),
            ('off-site profile link', 'probe-a2', 'P', 'person', '/a.png', 'https://elsewhere.example/me', 'article_authors_profile_href_check'),
            ('blank name', 'probe-a3', '  ', 'person', '/a.png', NULL, 'article_authors_name_check'),
            ('loopback http avatar', 'probe-a4', 'P', 'person', 'http://localhost/a.png', NULL, 'article_authors_avatar_check'),
            ('97-character slug', repeat('d', 97), 'P', 'person', '/a.png', NULL, 'article_authors_slug_check')
        ) AS t (label, slug, name, kind, avatar, profile_href, constraint_name)
    LOOP
        BEGIN
            INSERT INTO editorial.article_authors
                (slug, name, role, kind, bio, avatar_path, avatar_alt, avatar_w, avatar_h, profile_href)
            VALUES (v_case.slug, v_case.name, 'R', v_case.kind, 'B', v_case.avatar, 'A', 1, 1,
                v_case.profile_href);
            RAISE EXCEPTION 'FAIL author with % was accepted', v_case.label;
        EXCEPTION WHEN check_violation THEN
            GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
            IF v_con IS DISTINCT FROM v_case.constraint_name THEN
                RAISE EXCEPTION 'FAIL author with % was refused by % (expected %)',
                    v_case.label, v_con, v_case.constraint_name;
            END IF;
            RAISE NOTICE 'PASS author with % refused by % [%]', v_case.label, v_con, SQLSTATE;
        END;
    END LOOP;
END $$;
-- #endregion

ROLLBACK;
