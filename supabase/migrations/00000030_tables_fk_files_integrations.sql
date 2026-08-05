-- =============================================================================================
-- 00000030_tables_fk_files_integrations.sql — trailing FK closure (Category 0).
--
-- The ONE permitted `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` (root CLAUDE.md §1), and it is
-- here for the reason the rule carves out: a genuine ordering dependency that no inline FK can
-- express.
--
--   files.folders  (00000010) --source_connection_id--> integrations.user_connections (00000020)
--   files.items    (00000010) --source_connection_id--> integrations.user_connections (00000020)
--
-- The referenced table is created TWENTY numbers later, so the inline REFERENCES clause would fail
-- at reset time. Nothing else was moved out of 00000010 — every other column, constraint and index
-- for the files schema stays folded into its own category file.
--
-- ON DELETE SET NULL is deliberate: disconnecting a Drive/Dropbox/S3 account must ORPHAN the mount,
-- never delete the user's asset history. The row survives, `source_connection_id` goes NULL, and
-- the hub renders it as an unresolvable mount the owner can re-link or clear.
-- =============================================================================================

ALTER TABLE files.items
    ADD CONSTRAINT items_source_connection_fkey
    FOREIGN KEY (source_connection_id)
    REFERENCES integrations.user_connections (id) ON DELETE SET NULL;

ALTER TABLE files.folders
    ADD CONSTRAINT folders_source_connection_fkey
    FOREIGN KEY (source_connection_id)
    REFERENCES integrations.user_connections (id) ON DELETE SET NULL;
