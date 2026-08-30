-- =============================================================================================
-- 00000010_tables_files.sql — files schema tables (Category 0). Source: 0002_files_tables.sql.
--
-- The `files` schema is the platform's ASSET-MANAGEMENT layer: a virtual filesystem over Supabase
-- Storage, the mounted third-party connectors, and links.
--
-- Scope of `/files` (locked decision): the hub is BOTH a personal/entity library AND a read-only
-- window onto project/channel attachments. A hub-native asset is owned here; a mounted asset is
-- surfaced here but owned by its engagement (comms.channel_files / comms.message_attachments /
-- projects.submission_files remain the SSOT for those relationships — this table does not duplicate
-- them, and deliberately carries no channel_id/message_id columns).
--
-- Ownership is a PAIR, not one column: (owner_type, owner_entity_id) names the principal that owns
-- the bytes and is metered for quota, while `owner_user_id` always names the human who created the
-- row. For a personal asset owner_type = 'user' and owner_entity_id IS NULL (owner_user_id carries
-- the identity); for an entity asset owner_entity_id names the team/business/organisation. The
-- CHECK constraint below makes the NULL combination unrepresentable.
--
-- DEPENDENCY NOTE: `source_connection_id` references integrations.user_connections, which is
-- created in 00000020 — LATER than this file. An inline FK is therefore impossible; that ONE
-- constraint lives in the trailing 00000030_tables_fk_files_integrations.sql (the single permitted
-- ALTER TABLE ... ADD CONSTRAINT, root CLAUDE.md §1). Nothing else was moved out.
-- =============================================================================================

-- #region files.folders — the hierarchy
-- Folders carry the same ownership/provenance/visibility axes as items so a folder can itself be a
-- mounted connector directory or a shared node. `path` is a MATERIALISED ancestor-name trail
-- (root-first): the breadcrumb renders without a recursive CTE per row, which is what makes the
-- hub's tree cheap at depth.
CREATE TABLE files.folders (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    owner_user_id uuid NOT NULL,
    parent_folder_id uuid,
    name text NOT NULL,

    -- Ownership axis (see header). Mirrors files.items exactly.
    owner_type files.owner_kind NOT NULL DEFAULT 'user',
    owner_entity_id uuid,

    -- Provenance: where this directory actually lives.
    source files.file_source NOT NULL DEFAULT 'supabase',
    source_connection_id uuid,
    external_folder_id text,
    external_parent_id text,

    -- Sharing.
    visibility files.file_visibility NOT NULL DEFAULT 'private',
    share_slug text,

    -- Materialised ancestor names, root-first. Empty at the library root.
    path text[] NOT NULL DEFAULT '{}',

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    -- Soft delete. Nothing in this schema is hard-deleted by the app (root CLAUDE.md §5); the row
    -- survives so a restore, an audit and the quota rollup all stay coherent.
    deleted_at timestamp with time zone,

    CONSTRAINT folders_pkey PRIMARY KEY (id),
    CONSTRAINT folders_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users (id),
    CONSTRAINT folders_parent_fkey FOREIGN KEY (parent_folder_id) REFERENCES files.folders (id),
    CONSTRAINT folders_share_slug_key UNIQUE (share_slug),
    CONSTRAINT folders_external_unique UNIQUE (source_connection_id, external_folder_id),
    CONSTRAINT folders_owner_entity_check CHECK (
        owner_type = 'user' OR owner_entity_id IS NOT NULL
    )
);
-- #endregion

-- #region files.items — the asset registry
CREATE TABLE files.items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  folder_id uuid,
  bucket_id text NOT NULL,
  storage_path text NOT NULL,
  target_bucket text,
  target_path text,
  display_name text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  -- Rich taxonomy for search/filter/facets/analytics; classified by the fat backend on upload from
  -- (original_name, mime_type) via @projective/types/files `describeFile`. NOT NULL so every row is
  -- faceable; defaults to 'Other' until classified. See documentation/database/files/Storage.md.
  category files.file_category NOT NULL DEFAULT 'Other',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Was `text DEFAULT 'pending_upload'` — a defaulted free-text column with no domain, so any typo
  -- was storable and no reader could exhaustively switch on it. Now the closed files.file_status
  -- enum, NOT NULL.
  status files.file_status NOT NULL DEFAULT 'pending_upload',
  is_archived boolean DEFAULT false,
  -- The owner's shelf mark, driving the hub's Starred filter and its star-first sort. A column
  -- rather than a `metadata` key because it is a FILTER and an ORDER BY predicate on the hub's
  -- hottest read, and a jsonb key cannot be constrained NOT NULL nor indexed as cheaply — the two
  -- reasons metadata is the wrong home for anything the list query touches.
  --
  -- NOT NULL DEFAULT false (unlike `is_archived` above, which predates this and is nullable): a
  -- star is a two-valued fact, and a third "unknown" state would force every reader to COALESCE.
  --
  -- ⚠️ SCOPE (flagged, not silently decided): this is the OWNER's star on their OWN asset, which is
  -- what /files toggles. It is deliberately NOT a per-viewer mark — a second person viewing a
  -- shared asset would see and toggle the owner's star. If per-viewer starring is ever required,
  -- that is a (user_id, item_id) pivot, not a widening of this column.
  starred boolean NOT NULL DEFAULT false,

  -- #region Ownership + sharing
  -- WHERE the bytes live. `supabase` is the only source that consumes OUR quota; a connector source
  -- is mounted (the provider meters it) and `link` stores no bytes at all.
  source files.file_source NOT NULL DEFAULT 'supabase',
  visibility files.file_visibility NOT NULL DEFAULT 'private',
  owner_type files.owner_kind NOT NULL DEFAULT 'user',
  -- NULL when owner_type = 'user' — `owner_user_id` carries the identity in that case.
  owner_entity_id uuid,
  -- #endregion

  -- #region Deduplication
  -- `content_hash` is computed CLIENT-side before upload so a duplicate is caught before its bytes
  -- cross the wire. `hash_algo` records HOW ('sha-256' = whole file; 'sampled-sha-256' = head, tail
  -- and length only) and `hash_sampled` records the STRENGTH of the claim: a sampled digest is a
  -- strong hint and is never on its own sufficient to collapse two assets onto one stored object.
  content_hash text,
  -- Domained by CHECK rather than a dedicated enum: two members that mirror `HashAlgo` in
  -- @projective/types/files/dedup.ts. Leaving it free text would repeat the very mistake the
  -- `status` column above was just fixed for — a closed vocabulary no reader can switch on.
  hash_algo text CONSTRAINT items_hash_algo_check CHECK (
    hash_algo IS NULL OR hash_algo IN ('sha-256', 'sampled-sha-256')
  ),
  hash_sampled boolean NOT NULL DEFAULT false,
  -- #endregion

  -- #region Mounted connector provenance (NULL for a hub-native asset)
  -- FK to integrations.user_connections lives in 00000030 (see header). ON DELETE SET NULL there:
  -- disconnecting Drive must not delete the user's attachment history, it must orphan the mount.
  source_connection_id uuid,
  external_file_id text,
  external_parent_id text,
  external_web_url text,
  -- The provider's change token. Present so a delta sync can tell "unchanged" from "not re-read".
  external_etag text,
  -- #endregion

  -- #region Link assets (source = 'link')
  link_url text,
  link_domain text,
  link_title text,
  link_description text,
  link_favicon_url text,
  -- NULL until the safety pipeline has run at all — distinct from 'pending' (queued) and from
  -- 'unscannable' (reached for, refused inspection).
  link_scan_status files.link_scan_status,
  link_scanned_at timestamp with time zone,
  -- #endregion

  -- The opaque, server-minted share token (files.fn_mint_share_slug). NULL while private.
  share_slug text,
  download_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  -- Soft delete: the row survives a "delete" so the quota rollup, the download audit and any
  -- share link that pointed at it all stay explicable.
  deleted_at timestamp with time zone,

  CONSTRAINT items_pkey PRIMARY KEY (id),
  CONSTRAINT files_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id),
  CONSTRAINT files_folder_fkey FOREIGN KEY (folder_id) REFERENCES files.folders(id),
  -- One row per remote file per connection: re-running a sync UPSERTs instead of duplicating.
  CONSTRAINT items_external_unique UNIQUE (source_connection_id, external_file_id),
  -- One row per stored object. Without this two tenants could register the same storage_path and
  -- a repointed row could silently shadow another's bytes.
  --
  -- ⚠️ CONSEQUENCE FOR NON-STORED ASSETS (flagged, not silently worked around): `bucket_id` and
  -- `storage_path` are NOT NULL and predate this pass, but a `link` or a mounted connector asset
  -- has no stored object at all. Those rows must therefore SYNTHESISE a unique path — e.g.
  -- `bucket_id = 'link'` / `storage_path = id::text` — because a shared constant would collide on
  -- the second row. The alternative (relaxing both columns to NULL and making the constraint
  -- partial on `source = 'supabase'`) is the cleaner shape but changes two long-standing NOT NULL
  -- columns, which is a human decision, not one to take inside a fold.
  CONSTRAINT items_storage_object_unique UNIQUE (bucket_id, storage_path),
  CONSTRAINT items_share_slug_key UNIQUE (share_slug),
  -- A link asset must actually carry a URL; otherwise it is an empty row claiming to be a link.
  CONSTRAINT items_link_url_check CHECK (source <> 'link' OR link_url IS NOT NULL),
  CONSTRAINT items_owner_entity_check CHECK (
      owner_type = 'user' OR owner_entity_id IS NOT NULL
  )
);
-- #endregion

-- #region files.share_links — READ-ONLY, revocable, expiring access grants
-- A share link is the ONLY way an asset leaves its owner's tenancy without an account. It is
-- deliberately read-only (no upload/replace/delete path exists through a slug), the slug is opaque
-- and server-minted with >= 128 bits of entropy (files.fn_mint_share_slug), and revocation is a
-- column rather than a DELETE so a revoked link stays auditable.
--
-- The slug — not the item id — is the credential. That is why files.fn_can_read does NOT return
-- true for a `link`-visibility asset: an authenticated user who can guess an id must still not be
-- able to enumerate link-shared rows.
CREATE TABLE files.share_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    slug text UNIQUE NOT NULL,
    item_id uuid REFERENCES files.items (id) ON DELETE CASCADE,
    folder_id uuid REFERENCES files.folders (id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES auth.users (id),
    visibility files.file_visibility NOT NULL DEFAULT 'link',
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    -- NULL = unlimited. A limit is enforced by the share route against download_count.
    download_limit integer,
    download_count integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    -- Exactly one target: a link points at an item OR a folder, never both and never neither.
    CONSTRAINT share_links_target_check CHECK (num_nonnulls (item_id, folder_id) = 1)
);
-- #endregion

-- #region files.download_events — the download audit
-- Written by the SERVER only (no client INSERT policy — the same discipline as comms.notifications:
-- "this was downloaded" is not a claim a browser gets to make). `device_fingerprint` answers the
-- duplicate-download prompt server-side so the client never has to guess from localStorage, and
-- `share_slug` is denormalised so an anonymous download stays attributable after the link is
-- revoked and the grant row is gone from the hot path.
CREATE TABLE files.download_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    item_id uuid NOT NULL REFERENCES files.items (id) ON DELETE CASCADE,
    -- NULL for an anonymous share download.
    actor_user_id uuid REFERENCES auth.users (id),
    device_fingerprint text,
    via files.download_via NOT NULL DEFAULT 'hub',
    share_slug text,
    downloaded_at timestamp with time zone NOT NULL DEFAULT now()
);
-- #endregion

-- #region files.storage_usage — the metered rollup
-- A materialised per-owner total, maintained by files.fn_recompute_usage (00001160) off a trigger
-- on files.items. It exists because the quota gate runs on the INSERT path: summing size_bytes
-- across a growing library on every upload is the kind of cost that only shows up once a tenant is
-- successful.
--
-- `bytes_used` is bigint — the honest unit for a byte total. The QUOTA it is checked against is
-- denominated in MEBIBYTES (finance.entitlement_key 'storage_megabytes'), because
-- plan_entitlements.limit_value and every resolver over it are `integer` and 25 GB in bytes
-- overflows int4. The conversion happens once, in files.fn_check_storage_quota.
CREATE TABLE files.storage_usage (
    owner_type files.owner_kind NOT NULL,
    owner_id uuid NOT NULL,
    bytes_used bigint NOT NULL DEFAULT 0,
    item_count integer NOT NULL DEFAULT 0,
    recomputed_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_type, owner_id)
);
-- #endregion
