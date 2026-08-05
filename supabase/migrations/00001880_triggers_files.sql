-- =============================================================================================
-- 00001880_triggers_files.sql — files schema triggers (Category 1).
-- Runs after 00001160_functions_files.sql (a trigger needs its function to exist first).
-- =============================================================================================

-- #region updated_at touch
-- Both tables carry `updated_at` and neither had a trigger, so the column was only ever correct
-- when the application remembered to set it.
CREATE TRIGGER trg_files_items_touch
    BEFORE UPDATE ON files.items
    FOR EACH ROW EXECUTE FUNCTION files.fn_touch_updated_at ();

CREATE TRIGGER trg_files_folders_touch
    BEFORE UPDATE ON files.folders
    FOR EACH ROW EXECUTE FUNCTION files.fn_touch_updated_at ();
-- #endregion

-- #region storage usage rollup
-- Maintains files.storage_usage, the table the quota gate reads. The UPDATE column list is
-- deliberately WIDER than "size_bytes, deleted_at": `source` decides whether a row counts at all
-- (a hub-native upload that becomes a mounted reference stops consuming our bytes), and
-- `owner_type` / `owner_entity_id` decide WHOSE rollup it counts against. Narrowing the list back
-- to two columns would let a re-owned or re-sourced asset stay charged to the wrong principal
-- until the next unrelated write happened to fire the trigger.
CREATE TRIGGER trg_files_items_usage
    AFTER INSERT
        OR UPDATE OF size_bytes, deleted_at, source, owner_type, owner_entity_id
        OR DELETE
    ON files.items
    FOR EACH ROW EXECUTE FUNCTION files.fn_usage_trigger ();
-- #endregion

-- #region quota gate
-- ⚠️ FAIL-OPEN. This trigger fires on every stored-byte write, but files.fn_check_storage_quota
-- returns immediately unless `security.platform_params.storage_quota_enforced` is true — and that
-- param is seeded FALSE. Flipping it is a human decision (00005001), not a migration side effect.
--
-- BEFORE (not AFTER) so a refusal aborts before the row exists, and scoped to `size_bytes` on
-- UPDATE so a rename or a re-tag never re-runs the quota arithmetic.
CREATE TRIGGER trg_files_items_quota
    BEFORE INSERT OR UPDATE OF size_bytes ON files.items
    FOR EACH ROW EXECUTE FUNCTION files.fn_check_storage_quota ();
-- #endregion
