-- =============================================================================================
-- Probe: the changelog's release table, editorial.changelog_releases (P5, Decisions #274 / #278).
--
--   1. The table has RLS on and exactly one policy — FOR SELECT to anon and authenticated; the client
--      roles hold SELECT and no INSERT / UPDATE / DELETE / TRUNCATE (table- or column-level); the
--      service role holds the writes; the version guard trigger is attached; the generated seed
--      (00005072) put releases in the table.
--   2. Visibility, as anon and as a signed-in seed user: a release dated today (UTC) or earlier is
--      read, one dated tomorrow and a withdrawn one are not, and each role sees exactly the rows the
--      content source's `visible` predicate would serve (not withdrawn, released_on <= UTC today).
--   3. Every client write is refused (42501), signed out and signed in.
--   4. The CHECKs refuse a non-semver or upper-case version, a blank title, an empty, unknown or
--      NULL-bearing category set, a body that is not a non-empty array and an images value that is
--      not an array (23514).
--   5. A version never changes (23514 from trg_changelog_releases_version_immutable), while the
--      generated seed's upsert — which never sets the key — still updates a row in place.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/editorial_changelog.sql
--
-- Every expected refusal is asserted: a statement that SUCCEEDS where it must be refused raises
-- `FAIL …` and aborts the run (non-zero exit under ON_ERROR_STOP). A clean run prints only PASS
-- notices. Its fixtures are its own rows (versions 99.0.0-probe.*); the signed-in reader is any seed
-- user, and a random id when the database has none (the policy reads no claim).
-- =============================================================================================

BEGIN;

-- #region 1. Catalog assertions (as postgres)
DO $$
DECLARE
    v_fail text[] := '{}';
    v_role text;
    v_priv text;
    v_policies int;
    v_seeded int;
BEGIN
    IF to_regclass('editorial.changelog_releases') IS NULL THEN
        RAISE EXCEPTION 'FAIL editorial.changelog_releases does not exist';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'editorial.changelog_releases'::regclass) THEN
        v_fail := v_fail || 'RLS is off on editorial.changelog_releases'::text;
    END IF;

    SELECT count(*) INTO v_policies FROM pg_policies
    WHERE schemaname = 'editorial' AND tablename = 'changelog_releases';
    IF v_policies <> 1 THEN
        v_fail := v_fail || format('expected exactly one policy, found %s', v_policies);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'editorial' AND tablename = 'changelog_releases'
            AND cmd = 'SELECT' AND roles @> ARRAY['anon', 'authenticated']::name[]
            AND cardinality(roles) = 2
    ) THEN
        v_fail := v_fail || 'the one policy is not FOR SELECT TO anon, authenticated'::text;
    END IF;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF NOT has_table_privilege(v_role, 'editorial.changelog_releases', 'SELECT') THEN
            v_fail := v_fail || format('%s lacks SELECT', v_role);
        END IF;
        FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
            IF has_table_privilege(v_role, 'editorial.changelog_releases', v_priv) THEN
                v_fail := v_fail || format('%s holds %s', v_role, v_priv);
            END IF;
        END LOOP;
        FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE'] LOOP
            IF has_any_column_privilege(v_role, 'editorial.changelog_releases', v_priv) THEN
                v_fail := v_fail || format('%s holds column %s', v_role, v_priv);
            END IF;
        END LOOP;
    END LOOP;
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
        IF NOT has_table_privilege('service_role', 'editorial.changelog_releases', v_priv) THEN
            v_fail := v_fail || format('service_role lacks %s', v_priv);
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'editorial.changelog_releases'::regclass
            AND tgname = 'trg_changelog_releases_version_immutable' AND NOT tgisinternal
    ) THEN
        v_fail := v_fail || 'trg_changelog_releases_version_immutable is not attached'::text;
    END IF;

    SELECT count(*) INTO v_seeded FROM editorial.changelog_releases;
    IF v_seeded = 0 THEN
        v_fail := v_fail || 'no release rows — did 00005072 run?'::text;
    END IF;

    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL %', array_to_string(v_fail, '; ');
    END IF;
    RAISE NOTICE 'PASS catalog: RLS on, one SELECT policy, read-only client roles, guard attached, % seeded releases', v_seeded;
END $$;
-- #endregion

-- #region 2. Fixtures (as postgres): one public, one scheduled for tomorrow, one withdrawn
INSERT INTO editorial.changelog_releases
    (version, released_on, title, summary, categories, body, images, withdrawn)
VALUES
    ('99.0.0-probe.1', (now() AT TIME ZONE 'UTC')::date, 'Probe public', 'Shown today.',
        ARRAY['ux']::text[], '[{"type":"p","content":"x"}]'::jsonb, '[]'::jsonb, false),
    ('99.0.0-probe.2', (now() AT TIME ZONE 'UTC')::date + 1, 'Probe scheduled', 'Shown tomorrow.',
        ARRAY['ux']::text[], '[{"type":"p","content":"x"}]'::jsonb, '[]'::jsonb, false),
    ('99.0.0-probe.3', (now() AT TIME ZONE 'UTC')::date - 1, 'Probe withdrawn', 'Never shown.',
        ARRAY['ux']::text[], '[{"type":"p","content":"x"}]'::jsonb, '[]'::jsonb, true);

-- What the content source's `visible` predicate would serve, counted as postgres (RLS bypassed).
SELECT set_config('probe.visible',
    (SELECT count(*)::text FROM editorial.changelog_releases
     WHERE NOT withdrawn AND released_on <= (now() AT TIME ZONE 'UTC')::date), true);
SELECT set_config('probe.reader',
    COALESCE((SELECT user_id::text FROM org.users_public ORDER BY user_id LIMIT 1), gen_random_uuid()::text), true);
-- #endregion

-- #region 3. Reads (anon, then authenticated)
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_seen int;
BEGIN
    SELECT count(*) INTO v_seen FROM editorial.changelog_releases;
    IF v_seen <> current_setting('probe.visible')::int THEN
        RAISE EXCEPTION 'FAIL anon sees % releases, the visible predicate serves %', v_seen, current_setting('probe.visible');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM editorial.changelog_releases WHERE version = '99.0.0-probe.1') THEN
        RAISE EXCEPTION 'FAIL anon cannot read a release dated today';
    END IF;
    IF EXISTS (SELECT 1 FROM editorial.changelog_releases WHERE version IN ('99.0.0-probe.2', '99.0.0-probe.3')) THEN
        RAISE EXCEPTION 'FAIL anon reads a scheduled or withdrawn release';
    END IF;
    RAISE NOTICE 'PASS anon reads the % visible releases and neither the scheduled nor the withdrawn one', v_seen;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.reader'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_seen int;
BEGIN
    SELECT count(*) INTO v_seen FROM editorial.changelog_releases;
    IF v_seen <> current_setting('probe.visible')::int THEN
        RAISE EXCEPTION 'FAIL authenticated sees % releases, the visible predicate serves %', v_seen, current_setting('probe.visible');
    END IF;
    IF EXISTS (SELECT 1 FROM editorial.changelog_releases WHERE version IN ('99.0.0-probe.2', '99.0.0-probe.3')) THEN
        RAISE EXCEPTION 'FAIL authenticated reads a scheduled or withdrawn release';
    END IF;
    RAISE NOTICE 'PASS authenticated reads the same % releases', v_seen;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 4. Client writes are refused (42501)
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        $q$INSERT INTO editorial.changelog_releases (version, released_on, title, summary, categories, body)
           VALUES ('99.0.0-probe.9', current_date, 't', 's', ARRAY['ux'], '[{"type":"p","content":"x"}]')$q$,
        $q$UPDATE editorial.changelog_releases SET title = 'hijacked' WHERE version = '99.0.0-probe.1'$q$,
        $q$DELETE FROM editorial.changelog_releases WHERE version = '99.0.0-probe.1'$q$
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL anon ran: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS anon refused [%]', SQLSTATE;
        END;
    END LOOP;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.reader'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        $q$INSERT INTO editorial.changelog_releases (version, released_on, title, summary, categories, body)
           VALUES ('99.0.0-probe.9', current_date, 't', 's', ARRAY['ux'], '[{"type":"p","content":"x"}]')$q$,
        $q$UPDATE editorial.changelog_releases SET withdrawn = false WHERE version = '99.0.0-probe.3'$q$,
        $q$DELETE FROM editorial.changelog_releases WHERE version = '99.0.0-probe.1'$q$
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL authenticated ran: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS authenticated refused [%]', SQLSTATE;
        END;
    END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 5. CHECK constraints (as postgres)
DO $$
DECLARE
    v_case text[];
    v_cases text[][] := ARRAY[
        ARRAY['version not semver', 'version', '''1.0'''],
        ARRAY['version with a leading zero', 'version', '''01.0.0'''],
        ARRAY['version in upper case', 'version', '''1.0.0-RC.1'''],
        ARRAY['blank title', 'title', ''' '''],
        ARRAY['empty title', 'title', ''''''],
        ARRAY['blank summary', 'summary', ''' '''],
        ARRAY['no category', 'categories', '''{}''::text[]'],
        ARRAY['unknown category', 'categories', 'ARRAY[''ux'', ''gossip'']::text[]'],
        ARRAY['NULL category', 'categories', 'ARRAY[''ux'', NULL]::text[]'],
        ARRAY['body an object', 'body', '''{"type":"p"}''::jsonb'],
        ARRAY['body empty', 'body', '''[]''::jsonb'],
        ARRAY['images an object', 'images', '''{}''::jsonb']
    ];
    v_cols text := 'version, released_on, title, summary, categories, body, images';
    v_good jsonb := jsonb_build_object(
        'version', '''99.0.0-probe.8''',
        'released_on', 'current_date',
        'title', '''t''',
        'summary', '''s''',
        'categories', 'ARRAY[''ux'']::text[]',
        'body', '''[{"type":"p","content":"x"}]''::jsonb',
        'images', '''[]''::jsonb'
    );
    v_values text;
BEGIN
    FOREACH v_case SLICE 1 IN ARRAY v_cases LOOP
        SELECT string_agg(CASE WHEN c = v_case[2] THEN v_case[3] ELSE v_good ->> c END, ', ' ORDER BY o)
        INTO v_values
        FROM unnest(string_to_array(replace(v_cols, ' ', ''), ',')) WITH ORDINALITY AS t(c, o);
        BEGIN
            EXECUTE format('INSERT INTO editorial.changelog_releases (%s) VALUES (%s)', v_cols, v_values);
            RAISE EXCEPTION 'FAIL accepted %: %', v_case[1], v_values;
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS refused % [%]', v_case[1], SQLSTATE;
        END;
    END LOOP;
END $$;
-- #endregion

-- #region 6. The version is permanent; the seed's upsert still updates in place
DO $$
DECLARE
    v_title text;
BEGIN
    BEGIN
        UPDATE editorial.changelog_releases SET version = '99.0.1-probe.1' WHERE version = '99.0.0-probe.1';
        RAISE EXCEPTION 'FAIL a release changed its version';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS version change refused [%]', SQLSTATE;
    END;

    -- The shape 00005072 emits: ON CONFLICT on the key, every other column updated, never the key.
    INSERT INTO editorial.changelog_releases
        (version, released_on, title, summary, categories, body, images, withdrawn)
    VALUES ('99.0.0-probe.1', (now() AT TIME ZONE 'UTC')::date, 'Probe public, edited', 'Shown today.',
        ARRAY['ux', 'security']::text[], '[{"type":"p","content":"y"}]'::jsonb, '[]'::jsonb, false)
    ON CONFLICT (version) DO UPDATE SET
        released_on = EXCLUDED.released_on,
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        categories = EXCLUDED.categories,
        body = EXCLUDED.body,
        images = EXCLUDED.images,
        withdrawn = EXCLUDED.withdrawn;
    SELECT title INTO v_title FROM editorial.changelog_releases WHERE version = '99.0.0-probe.1';
    IF v_title <> 'Probe public, edited' THEN
        RAISE EXCEPTION 'FAIL the seed-shaped upsert did not update the row (title %)', v_title;
    END IF;
    RAISE NOTICE 'PASS the seed-shaped upsert updates a release in place';
END $$;
-- #endregion

ROLLBACK;
