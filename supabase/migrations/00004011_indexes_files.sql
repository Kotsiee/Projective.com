-- Indexes: files domain (Category 4).
--
-- NOTE ON WHAT WAS MISSING: files.folders carried NO index at all — not on `owner_user_id`, not on
-- `parent_folder_id`. Postgres indexes the PK and nothing else, so every hub tree render and every
-- cascade check on a folder FK was a sequential scan of the whole platform's folder table.

-- #region files.items — hub + explorer read paths

-- Faceting / filtering the File Explorer by category, scoped to an owner's non-archived library.
CREATE INDEX IF NOT EXISTS idx_files_items_owner_category
    ON files.items (owner_user_id, category)
    WHERE is_archived = false;

-- Cross-owner category analytics (counts / rollups by file category).
CREATE INDEX IF NOT EXISTS idx_files_items_category
    ON files.items (category);

-- Listing a folder's contents — the hub's single most frequent query, and the FK's cascade check.
CREATE INDEX IF NOT EXISTS idx_files_items_folder
    ON files.items (folder_id);

-- The upload-sweeper's worklist. Partial: `pending_upload` rows are a vanishing fraction of the
-- table, so the index stays tiny and the sweep never touches a settled row.
CREATE INDEX IF NOT EXISTS idx_files_items_pending_upload
    ON files.items (status)
    WHERE status = 'pending_upload'::files.file_status;

-- Deduplication lookup: "has this owner already stored these bytes?" Ordered
-- (content_hash, owner_type, owner_entity_id) because the hash is the selective column — the probe
-- is always by digest first, and a soft-deleted row must never satisfy a dedup hit (its bytes are
-- on their way out).
CREATE INDEX IF NOT EXISTS idx_files_items_dedup
    ON files.items (content_hash, owner_type, owner_entity_id)
    WHERE deleted_at IS NULL;

-- Connector delta sync: resolving a provider's file id back to our row. Mirrors the UNIQUE
-- constraint's columns, and also serves the ON DELETE SET NULL check when a connection is removed.
CREATE INDEX IF NOT EXISTS idx_files_items_external
    ON files.items (source_connection_id, external_file_id);

-- Share-slug resolution. Partial because the overwhelming majority of assets are private and carry
-- no slug at all, so the index covers only the shared minority.
CREATE INDEX IF NOT EXISTS idx_files_items_share_slug
    ON files.items (share_slug)
    WHERE share_slug IS NOT NULL;

-- The quota rollup's own aggregation key, and the owner-scoped hub listing.
CREATE INDEX IF NOT EXISTS idx_files_items_owner_entity
    ON files.items (owner_type, owner_entity_id)
    WHERE deleted_at IS NULL;

-- #endregion

-- #region files.folders — previously unindexed entirely

CREATE INDEX IF NOT EXISTS idx_files_folders_owner
    ON files.folders (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_files_folders_parent
    ON files.folders (parent_folder_id);

-- #endregion

-- #region files.download_events — audit read paths
-- Both are (key, downloaded_at DESC): every read of this table is "the most recent N for X", and a
-- plain single-column index would leave a sort on top of it.

CREATE INDEX IF NOT EXISTS idx_files_download_events_item
    ON files.download_events (item_id, downloaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_download_events_actor
    ON files.download_events (actor_user_id, downloaded_at DESC);

-- #endregion

-- #region files.share_links — slug resolution
-- `slug` is already UNIQUE (and therefore indexed). This one serves the owner's "my shared links"
-- list and the revocation sweep.

CREATE INDEX IF NOT EXISTS idx_files_share_links_creator
    ON files.share_links (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_share_links_item
    ON files.share_links (item_id)
    WHERE item_id IS NOT NULL;

-- #endregion
