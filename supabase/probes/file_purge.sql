-- =============================================================================================
-- Probe: a soft-deleted file's stored bytes are purged 30 days after its deletion and its row stays
-- (PROJECTS FL1 step 3, Decision #564, owner ruling). files.claim_purge stamps purged_at on what is
-- due and answers every object to delete, the original and its WebP tiers; files.release_purge hands
-- back a row whose objects could not be deleted. A file something must keep is never claimed.
--
-- What is asserted, as postgres unless named:
--   1. A file deleted 31 days ago is claimed with all four of its objects; its row stays, deleted,
--      with purged_at. A second run claims nothing more of it.
--   2. Never claimed: a file deleted 29 days ago, a deleted link, a deleted file a submission names
--      and a deleted file an order version names.
--   3. release_purge clears the stamp, and the next run claims the file again.
--   4. A purged row cannot be restored (items_purged_check); its owner cannot stamp purged_at on a
--      file (42501) and cannot reach a purged row to clear it.
--   5. Only the service role may call either door.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/file_purge.sql
-- Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers and fixtures
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- One deleted file row in p_owner's personal library, deleted p_days ago.
CREATE FUNCTION pg_temp.put(p_key text, p_owner uuid, p_days integer, p_source text DEFAULT 'supabase')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid := gen_random_uuid();
BEGIN
    INSERT INTO files.items (id, owner_user_id, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes, status, visibility, source, owner_type, link_url,
                             deleted_at)
    VALUES (v_id, p_owner,
            CASE WHEN p_source = 'link' THEN 'link' ELSE 'personal' END,
            CASE WHEN p_source = 'link' THEN v_id::text ELSE p_owner || '/probe-purge-' || p_key || '.png' END,
            'probe-purge-' || p_key, 'probe-purge-' || p_key, 'image/png', 4000, 'uploaded', 'private',
            p_source::files.file_source, 'user',
            CASE WHEN p_source = 'link' THEN 'https://example.com/' || p_key END,
            now() - make_interval(days => p_days));
    INSERT INTO probe_ids VALUES (p_key, v_id);
    RETURN v_id;
END $$;

CREATE TEMP TABLE probe_claim (item_id uuid, bucket_id text, storage_path text);

CREATE FUNCTION pg_temp.claimed(p_key text) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM probe_claim c WHERE c.item_id = pg_temp.id(p_key);
$$;

DO $$
DECLARE
    v_owner uuid;
    v_submission uuid;
    v_product uuid;
    v_due uuid;
    v_live uuid;
BEGIN
    SELECT u.owner_id INTO v_owner FROM files.storage_usage u
     WHERE u.owner_type = 'user'::files.owner_kind ORDER BY u.owner_id LIMIT 1;
    SELECT s.id INTO v_submission FROM projects.stage_submissions s ORDER BY s.id LIMIT 1;
    SELECT p.id INTO v_product FROM catalogue.products p ORDER BY p.id LIMIT 1;
    IF v_owner IS NULL OR v_submission IS NULL OR v_product IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: a person with files, a submission and a product (deno task db:reset)';
    END IF;
    INSERT INTO probe_ids VALUES ('owner', v_owner);

    v_due := pg_temp.put('due', v_owner, 31);
    INSERT INTO files.item_variants (item_id, tier, bucket_id, storage_path, width, height, size_bytes)
    VALUES (v_due, 'sm', 'personal', v_owner || '/probe-purge-due.sm.webp', 320, 320, 100),
           (v_due, 'md', 'personal', v_owner || '/probe-purge-due.md.webp', 800, 800, 300),
           (v_due, 'lg', 'personal', v_owner || '/probe-purge-due.lg.webp', 1600, 1600, 600);
    PERFORM pg_temp.put('young', v_owner, 29);
    v_live := pg_temp.put('live', v_owner, 0);
    UPDATE files.items SET deleted_at = NULL WHERE id = v_live;
    PERFORM pg_temp.put('link', v_owner, 31, 'link');
    INSERT INTO projects.submission_files (submission_id, file_id)
    VALUES (v_submission, pg_temp.put('submitted', v_owner, 31));
    INSERT INTO catalogue.product_versions (product_id, version, manifest)
    SELECT v_product, COALESCE(max(pv.version), 0) + 1,
           jsonb_build_array(jsonb_build_object('fileId', pg_temp.put('sold', v_owner, 31),
               'name', 'probe-purge-sold', 'label', 'Probe', 'extension', 'png', 'bytes', 4000,
               'mime', 'image/png'))
      FROM catalogue.product_versions pv WHERE pv.product_id = v_product;
END $$;
-- #endregion

-- #region 1–2. One run claims what is due, and nothing that must keep its bytes
INSERT INTO probe_claim SELECT * FROM files.claim_purge (1000);

DO $$
BEGIN
    PERFORM pg_temp.ok(pg_temp.claimed('due') = 4,
        format('a file deleted 31 days ago is claimed with its object and its three tiers (got %s)', pg_temp.claimed('due')));
    PERFORM pg_temp.ok(
        (SELECT i.purged_at IS NOT NULL AND i.deleted_at IS NOT NULL FROM files.items i WHERE i.id = pg_temp.id('due')),
        'its row stays, deleted, and says when its bytes were purged');
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM files.item_variants v WHERE v.item_id = pg_temp.id('due')) = 3,
        'its tier rows stay too');
    PERFORM pg_temp.ok(pg_temp.claimed('young') = 0, 'a file deleted 29 days ago is not claimed');
    PERFORM pg_temp.ok(pg_temp.claimed('link') = 0, 'a deleted link (no stored bytes) is not claimed');
    PERFORM pg_temp.ok(pg_temp.claimed('submitted') = 0, 'a deleted file a submission names is never claimed');
    PERFORM pg_temp.ok(pg_temp.claimed('sold') = 0, 'a deleted file an order version names is never claimed');
END $$;

DELETE FROM probe_claim;
INSERT INTO probe_claim SELECT * FROM files.claim_purge (1000);
DO $$
BEGIN
    PERFORM pg_temp.ok(pg_temp.claimed('due') = 0, 'a second run claims nothing more of a purged file');
END $$;
-- #endregion

-- #region 3. A release hands the file back to the next run
DO $$
BEGIN
    PERFORM pg_temp.ok(files.release_purge (ARRAY[pg_temp.id('due'), pg_temp.id('young')]) = 1,
        'release_purge clears the stamp on the purged file only');
    PERFORM pg_temp.ok((SELECT i.purged_at IS NULL FROM files.items i WHERE i.id = pg_temp.id('due')),
        'the released row is unstamped');
END $$;

DELETE FROM probe_claim;
INSERT INTO probe_claim SELECT * FROM files.claim_purge (1000);
DO $$
BEGIN
    PERFORM pg_temp.ok(pg_temp.claimed('due') = 4, 'the next run claims the released file again');
END $$;
-- #endregion

-- #region 4. A purged row is never restored, and its stamp is the purge's alone
DO $$
DECLARE
    v_state text;
BEGIN
    BEGIN
        UPDATE files.items SET deleted_at = NULL WHERE id = pg_temp.id('due');
    EXCEPTION WHEN check_violation THEN
        v_state := SQLSTATE;
    END;
    PERFORM pg_temp.ok(v_state = '23514', 'a purged row cannot be restored');
END $$;

SELECT set_config('probe.live', pg_temp.id('live')::text, true),
       set_config('probe.due', pg_temp.id('due')::text, true),
       set_config('request.jwt.claims',
           json_build_object('sub', pg_temp.id('owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_set text := 'allowed';
    v_cleared integer;
BEGIN
    BEGIN
        UPDATE files.items SET purged_at = now() WHERE id = current_setting('probe.live')::uuid;
    EXCEPTION WHEN insufficient_privilege THEN
        v_set := SQLSTATE;
    END;
    -- A deleted row is outside its owner's reach (files.fn_can_read), so a clear touches nothing.
    UPDATE files.items SET purged_at = NULL WHERE id = current_setting('probe.due')::uuid;
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
    PERFORM set_config('probe.set', v_set, true), set_config('probe.cleared', v_cleared::text, true);
END $$;
RESET ROLE;
DO $$
BEGIN
    PERFORM pg_temp.ok(current_setting('probe.set') = '42501',
        format('the owner cannot stamp purged_at on their own file (%s)', current_setting('probe.set')));
    PERFORM pg_temp.ok(current_setting('probe.cleared') = '0'
        AND (SELECT i.purged_at IS NOT NULL FROM files.items i WHERE i.id = pg_temp.id('due')),
        'the owner cannot reach a purged row, and its stamp stays');
END $$;
-- #endregion

-- #region 5. Only the service role may call the doors
DO $$
BEGIN
    PERFORM pg_temp.ok(
        has_function_privilege('service_role', 'files.claim_purge(integer, timestamptz)', 'EXECUTE')
        AND has_function_privilege('service_role', 'files.release_purge(uuid[])', 'EXECUTE'),
        'the service role may call claim_purge and release_purge');
    PERFORM pg_temp.ok(
        NOT has_function_privilege('authenticated', 'files.claim_purge(integer, timestamptz)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'files.claim_purge(integer, timestamptz)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'files.release_purge(uuid[])', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'files.release_purge(uuid[])', 'EXECUTE'),
        'no signed-in or anonymous caller may call either door');
END $$;
-- #endregion

ROLLBACK;
