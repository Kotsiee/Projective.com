-- Indexes: files domain (Category 4).

-- Faceting / filtering the File Explorer by category, scoped to an owner's non-archived library.
CREATE INDEX IF NOT EXISTS idx_files_items_owner_category
    ON files.items (owner_user_id, category)
    WHERE is_archived = false;

-- Cross-owner category analytics (counts / rollups by file category).
CREATE INDEX IF NOT EXISTS idx_files_items_category
    ON files.items (category);
