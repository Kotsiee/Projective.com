-- =============================================================================================
-- Probe: the storage rollup meters every stored byte, an image's WebP variants included (PROJECTS
-- FL1, Decision #564; F14). files.storage_usage is the total the quota gate and the
-- allowance meter read, so a byte it misses is a byte nobody pays for.
--
-- THE DEFECT (2026-11-25): files.fn_recompute_usage summed files.items.size_bytes only. The sm / md /
-- lg tiers the media pipeline writes beside an image (files.item_variants) were never metered, and no
-- trigger on item_variants recomputed the owner, so an image library held more bytes than its
-- allowance said.
--
-- What is asserted, as postgres (the pipeline writes variants with the service role):
--   1. An asset's three tiers add their bytes to its owner's rollup, and no items; a re-encoded tier
--      is re-metered and a removed one released; soft-deleting the asset releases it and its tiers.
--   2. With storage_quota_enforced switched on inside this transaction, an upload that fits beside
--      the originals is refused once the variants fill the allowance (the variants themselves are
--      never refused: the pipeline writes them after the asset was admitted).
--   3. The backfill (documentation/database/files/Functions.md §fn_recompute_usage) rebuilds every
--      owner's row from zero to what the triggers had kept.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/storage_usage_variants.sql
-- Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers and fixture
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.used(p_owner uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE((SELECT u.bytes_used FROM files.storage_usage u
                     WHERE u.owner_type = 'user'::files.owner_kind AND u.owner_id = p_owner), 0);
$$;

CREATE FUNCTION pg_temp.items(p_owner uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT COALESCE((SELECT u.item_count FROM files.storage_usage u
                     WHERE u.owner_type = 'user'::files.owner_kind AND u.owner_id = p_owner), 0);
$$;

-- One file row in the owner's personal library.
CREATE FUNCTION pg_temp.put(p_id uuid, p_owner uuid, p_name text, p_bytes bigint) RETURNS void
LANGUAGE sql AS $$
    INSERT INTO files.items (id, owner_user_id, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes, status, visibility, source, owner_type)
    VALUES (p_id, p_owner, 'personal', p_owner || '/' || p_name, p_name, p_name, 'image/png', p_bytes,
            'uploaded', 'private', 'supabase', 'user');
$$;

-- The pipeline's three tiers for one asset.
CREATE FUNCTION pg_temp.tiers(p_item uuid, p_owner uuid, p_sm bigint, p_md bigint, p_lg bigint)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO files.item_variants (item_id, tier, bucket_id, storage_path, width, height, size_bytes)
    VALUES (p_item, 'sm', 'personal', p_owner || '/' || p_item || '.sm.webp', 320, 320, p_sm),
           (p_item, 'md', 'personal', p_owner || '/' || p_item || '.md.webp', 800, 800, p_md),
           (p_item, 'lg', 'personal', p_owner || '/' || p_item || '.lg.webp', 1600, 1600, p_lg);
$$;

-- A person with a finite allowance and at least 8 MiB of room under it.
DO $$
DECLARE
    v_owner uuid;
    v_limit integer;
BEGIN
    SELECT u.owner_id, finance.fn_effective_limit ('user', u.owner_id, 'storage_megabytes'::finance.entitlement_key)
    INTO v_owner, v_limit
    FROM files.storage_usage u
    WHERE u.owner_type = 'user'::files.owner_kind
      AND finance.fn_effective_limit ('user', u.owner_id, 'storage_megabytes'::finance.entitlement_key) IS NOT NULL
      AND u.bytes_used + 8 * 1048576
          < finance.fn_effective_limit ('user', u.owner_id, 'storage_megabytes'::finance.entitlement_key)::bigint * 1048576
    ORDER BY u.owner_id
    LIMIT 1;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: no person with a finite storage allowance (deno task db:reset)';
    END IF;
    PERFORM set_config('probe.owner', v_owner::text, true);
    PERFORM set_config('probe.limit_bytes', (v_limit::bigint * 1048576)::text, true);
END $$;
-- #endregion

-- #region 1. The rollup meters an asset's variants with it
DO $$
DECLARE
    v_owner uuid := current_setting('probe.owner')::uuid;
    v_before bigint := pg_temp.used(current_setting('probe.owner')::uuid);
    v_count integer := pg_temp.items(current_setting('probe.owner')::uuid);
    v_item uuid := gen_random_uuid();
BEGIN
    PERFORM pg_temp.put(v_item, v_owner, 'probe-variants.png', 4000);
    PERFORM pg_temp.ok(pg_temp.used(v_owner) = v_before + 4000, 'the original is metered on insert');

    PERFORM pg_temp.tiers(v_item, v_owner, 100, 300, 600);
    PERFORM pg_temp.ok(pg_temp.used(v_owner) = v_before + 4000 + 1000,
        format('the three WebP tiers are metered beside the original (want %s, got %s)',
               v_before + 5000, pg_temp.used(v_owner)));
    PERFORM pg_temp.ok(pg_temp.items(v_owner) = v_count + 1, 'the tiers add bytes, never items');

    UPDATE files.item_variants SET size_bytes = 700 WHERE item_id = v_item AND tier = 'lg';
    PERFORM pg_temp.ok(pg_temp.used(v_owner) = v_before + 4000 + 1100, 'a re-encoded tier is re-metered');

    DELETE FROM files.item_variants WHERE item_id = v_item AND tier = 'sm';
    PERFORM pg_temp.ok(pg_temp.used(v_owner) = v_before + 4000 + 1000, 'a removed tier is released');

    UPDATE files.items SET deleted_at = now() WHERE id = v_item;
    PERFORM pg_temp.ok(pg_temp.used(v_owner) = v_before,
        'soft-deleting the asset releases its original and every tier');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM files.items i WHERE i.id = v_item),
        'the soft-deleted row stays');
END $$;
-- #endregion

-- #region 2. The enforced gate counts what the variants hold
DO $$
DECLARE
    v_owner uuid := current_setting('probe.owner')::uuid;
    v_limit bigint := current_setting('probe.limit_bytes')::bigint;
    v_big uuid := gen_random_uuid();
    v_refused text;
BEGIN
    UPDATE security.platform_params SET value = 'true'::jsonb WHERE key = 'storage_quota_enforced';

    -- An original that leaves 2 MiB of room, then 3 MiB of tiers the pipeline writes after it.
    PERFORM pg_temp.put(v_big, v_owner, 'probe-variants-big.png', v_limit - pg_temp.used(v_owner) - 2097152);
    PERFORM pg_temp.tiers(v_big, v_owner, 1048576, 1048576, 1048576);
    PERFORM pg_temp.ok(pg_temp.used(v_owner) = v_limit + 1048576,
        'the tiers are written past the allowance: the pipeline is never refused');

    BEGIN
        PERFORM pg_temp.put(gen_random_uuid(), v_owner, 'probe-variants-next.png', 1);
    EXCEPTION WHEN check_violation THEN
        v_refused := SQLERRM;
    END;
    PERFORM pg_temp.ok(v_refused LIKE 'Storage quota exceeded%',
        'the next upload is refused once the variants fill the allowance');
END $$;
-- #endregion

-- #region 3. The backfill recomputes every owner
CREATE TEMP TABLE probe_kept AS
SELECT u.owner_type, u.owner_id, u.bytes_used, u.item_count FROM files.storage_usage u;

UPDATE files.storage_usage SET bytes_used = 0, item_count = 0;

-- The backfill, as Functions.md gives it.
SELECT count(*) AS owners_recomputed
FROM (
    SELECT files.fn_recompute_usage (o.owner_type, o.owner_id)
    FROM (
        SELECT i.owner_type, COALESCE(i.owner_entity_id, i.owner_user_id) AS owner_id FROM files.items i
        UNION
        SELECT u.owner_type, u.owner_id FROM files.storage_usage u
    ) o
) r;

DO $$
BEGIN
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM probe_kept) > 0
        AND NOT EXISTS (
            SELECT 1 FROM probe_kept k
            JOIN files.storage_usage u USING (owner_type, owner_id)
            WHERE (u.bytes_used, u.item_count) IS DISTINCT FROM (k.bytes_used, k.item_count)
        )
        AND (SELECT count(*) FROM files.storage_usage) = (SELECT count(*) FROM probe_kept),
        'the backfill rebuilds every owner''s row to what the triggers kept');
END $$;
-- #endregion

ROLLBACK;
