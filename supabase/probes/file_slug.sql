-- =============================================================================================
-- Probe: every stored file has an opaque `fil-` address, minted once and never changed, so the
-- inspector routes by it and a uuid no longer does (PROJECTS FL3 step 2; Decision #563, ruling
-- #161 (a) as recommended: Decision #88's slug).
--
-- THE DEFECT (2026-11-25): `/inspect/[fileId]` took the row's uuid, the one public route left on a
-- uuid (#161 (a)); files.items had no slug column for a page to resolve.
--
-- What is asserted:
--   1. Every seeded files.items row carries a slug of the minter's exact shape, and no two share one.
--   2. An insert that supplies no slug gets one from security.fn_slug_guard('fil').
--   3. A slug never changes: an UPDATE that names a new one is refused, and an ordinary write keeps it.
--   4. A malformed or duplicate slug is refused by its CHECK and its UNIQUE.
--   5. The readers that build inspector links return it: files.list_shared_with_me's result and
--      org.fn_export_files's manifest both carry `slug`.
--   6. A person grant's `file.shared` notice opens the file at `/inspect/<slug>`, never its uuid.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/file_slug.sql
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- Whether a statement fails with the given SQLSTATE.
CREATE FUNCTION pg_temp.refused(p_sql text, p_state text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN false;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE = p_state;
END $$;

DO $$
DECLARE
    v_shape constant text := '^fil-[23456789abcdefghjkmnopqrstuvwxyz]{10}$';
    v_src files.items%ROWTYPE;
    v_id uuid;
    v_slug text;
    v_after text;
BEGIN
    -- #region 1. Every row has one, of the minter's shape, and none repeats
    PERFORM pg_temp.ok((SELECT count(*) > 0 FROM files.items), 'the seed has files to check');
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM files.items WHERE slug IS NULL OR slug !~ v_shape),
        'every files.items row has a fil- slug of the minter''s shape');
    PERFORM pg_temp.ok(
        (SELECT count(DISTINCT slug) = count(*) FROM files.items),
        'no two files share a slug');
    -- #endregion

    -- #region 2. An insert that supplies none is minted one
    SELECT * INTO v_src FROM files.items WHERE source = 'supabase' ORDER BY created_at, id LIMIT 1;
    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes)
    VALUES (v_src.owner_user_id, v_src.bucket_id, v_src.storage_path || '.probe-slug', 'probe.pdf',
            'probe.pdf', 'application/pdf', 1)
    RETURNING id, slug INTO v_id, v_slug;
    PERFORM pg_temp.ok(v_slug ~ v_shape, 'an insert with no slug is minted a fil- slug');
    -- #endregion

    -- #region 3. It never changes
    UPDATE files.items SET display_name = 'renamed.pdf' WHERE id = v_id;
    SELECT slug INTO v_after FROM files.items WHERE id = v_id;
    PERFORM pg_temp.ok(v_after = v_slug, 'an ordinary write keeps the slug');
    PERFORM pg_temp.ok(
        pg_temp.refused(format('UPDATE files.items SET slug = %L WHERE id = %L', 'fil-abcdefghjk', v_id),
                        '23514'),
        'a slug cannot be changed once minted (fn_slug_guard, 23514)');
    SELECT slug INTO v_after FROM files.items WHERE id = v_id;
    PERFORM pg_temp.ok(v_after = v_slug, 'the slug is the one first minted');
    -- #endregion

    -- #region 4. Its CHECK and UNIQUE
    PERFORM pg_temp.ok(
        pg_temp.refused(format(
            'INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name, '
            'mime_type, size_bytes, slug) VALUES (%L, %L, %L, %L, %L, %L, 1, %L)',
            v_src.owner_user_id, v_src.bucket_id, v_src.storage_path || '.probe-bad', 'x', 'x',
            'text/plain', 'fil-0000000000'), '23514'),
        'a malformed slug is refused by ck_items_slug_shape');
    PERFORM pg_temp.ok(
        pg_temp.refused(format(
            'INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name, '
            'mime_type, size_bytes, slug) VALUES (%L, %L, %L, %L, %L, %L, 1, %L)',
            v_src.owner_user_id, v_src.bucket_id, v_src.storage_path || '.probe-dup', 'x', 'x',
            'text/plain', v_slug), '23505'),
        'a duplicate slug is refused by items_slug_key');
    -- #endregion

    -- #region 5. The link readers carry it
    PERFORM pg_temp.ok(
        pg_catalog.pg_get_function_result('files.list_shared_with_me(integer)'::regprocedure)
            LIKE '%slug text%',
        'files.list_shared_with_me returns each file''s slug');
    PERFORM pg_temp.ok(
        (SELECT bool_and(e ? 'slug' AND e ->> 'slug' ~ v_shape)
           FROM jsonb_array_elements(org.fn_export_files(v_src.owner_user_id)) e),
        'org.fn_export_files gives every file its slug');
    -- #endregion

    PERFORM pg_catalog.set_config('probe.owner', v_src.owner_user_id::text, true);
    PERFORM pg_catalog.set_config('probe.item', v_id::text, true);
    PERFORM pg_catalog.set_config('probe.slug', v_slug, true);
    PERFORM pg_catalog.set_config('probe.person', (
        SELECT u.user_id::text FROM org.users_public u WHERE u.user_id <> v_src.owner_user_id
        ORDER BY u.user_id LIMIT 1), true);
    UPDATE files.items SET status = 'uploaded', source = 'supabase', visibility = 'restricted',
                           owner_type = 'user', owner_entity_id = NULL
     WHERE id = v_id;
END $$;

-- #region 6. The sharing notice opens the file by its slug
CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', p_uid::text, true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM pg_temp.act(pg_catalog.current_setting('probe.owner')::uuid);
    PERFORM files.set_item_access(pg_catalog.current_setting('probe.item')::uuid, NULL, NULL,
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'kind', 'user', 'id', pg_catalog.current_setting('probe.person')::uuid, 'role', 'viewer')));
END $$;
RESET ROLE;

DO $$
DECLARE
    v_url text;
BEGIN
    SELECT n.action_url INTO v_url FROM comms.notifications n
    WHERE n.user_id = pg_catalog.current_setting('probe.person')::uuid AND n.type = 'file.shared'
      AND n.entity_id = pg_catalog.current_setting('probe.item')::uuid;
    PERFORM pg_temp.ok(v_url = '/inspect/' || pg_catalog.current_setting('probe.slug'),
        'the file.shared notice opens /inspect/<slug>, not the uuid (got ' || COALESCE(v_url, 'none') || ')');
END $$;
-- #endregion

ROLLBACK;
