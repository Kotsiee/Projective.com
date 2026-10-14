-- =============================================================================================
-- 00000033_tables_fk_comms_catalogue.sql — trailing FK closure (Category 0).
--
-- The permitted `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` (root CLAUDE.md §1), for the ordering
-- dependency the rule carves out:
--
--   comms.dm_threads (00000016) --subject_listing_id--> catalogue.listings (00000023)
--
-- The referenced table is created seven files later, so the inline REFERENCES clause would fail at
-- reset time. SET NULL: a listing is archived rather than deleted, but if one ever went, the
-- conversation must survive it and only lose its subject.
-- =============================================================================================

ALTER TABLE comms.dm_threads
    ADD CONSTRAINT dm_threads_subject_listing_fkey
    FOREIGN KEY (subject_listing_id)
    REFERENCES catalogue.listings (id) ON DELETE SET NULL;
