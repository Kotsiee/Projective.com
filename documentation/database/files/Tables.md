# files Schema: Tables

The `files` schema is the platform's **asset-management** layer: a virtual filesystem over Supabase
Storage, the mounted third-party connectors, and links. Users organize assets into folders, track
metadata, and manage file statuses independently of the physical storage buckets.

Migration: [`00000010_tables_files.sql`](../../../supabase/migrations/00000010_tables_files.sql).
Enums: [`00000004`](../../../supabase/migrations/00000004_enums_domains.sql). Indexes:
[`00004011`](../../../supabase/migrations/00004011_indexes_files.sql). See also
[Functions.md](Functions.md) · [Policies.md](Policies.md) · [Storage.md](Storage.md).

## Scope of the hub

`/files` is **both** a personal/entity library **and** a read-only window onto project/channel
attachments. A hub-native asset is owned here; a mounted asset is surfaced here but owned by its
engagement — `comms.channel_files`, `comms.message_attachments` and `projects.submission_files`
remain the SSOT for those relationships, and `files.items` deliberately carries **no**
`channel_id`/`message_id` columns rather than duplicating them.

## Ownership is a pair, not a column

`(owner_type, owner_entity_id)` names the principal that owns the bytes and is metered for quota;
`owner_user_id` always names the human who created the row.

- Personal asset → `owner_type = 'user'`, `owner_entity_id IS NULL` (`owner_user_id` carries it).
- Entity asset → `owner_entity_id` names the team / business / organisation.

A `CHECK (owner_type = 'user' OR owner_entity_id IS NOT NULL)` on both tables makes the NULL
combination unrepresentable.

## Enums

| Type                      | Members                                                                    |
| :------------------------ | :------------------------------------------------------------------------- |
| `files.file_source`       | `supabase` · `google_drive` · `dropbox` · `frameio` · `s3` · `link`        |
| `files.file_visibility`   | `private` · `link` · `public`                                              |
| `files.file_status`       | `pending_upload` · `scanning` · `uploaded` · `error` · `quarantined`       |
| `files.link_scan_status`  | `pending` · `safe` · `suspicious` · `blocked` · `unscannable`              |
| `files.owner_kind`        | `user` · `team` · `business` · `organisation`                              |
| `files.download_via`      | `hub` · `share` · `picker` · `preview` · `api`                             |
| `files.file_category`     | the 28 `FileCategory` literals (pre-existing)                              |

Each mirrors a Zod enum in `@projective/types/files` (`assets.ts`) **member-for-member, in the same
order**. `owner_kind` deliberately omits the `freelancer` pseudo-owner that `scheduling.owner_type`
carries: a freelancer's bytes are their user's bytes, and a second quota key for the same human
would double-count.

`files.file_status` **replaces** the old free-text `files.items.status` column, which had a `DEFAULT`
but no domain — so a typo was storable and no reader could exhaustively switch on it.

## Storage quota

Metered against `(owner_type, owner_id)` via `files.storage_usage`, checked against the
`finance.entitlement_key` value `storage_megabytes`.

> **The unit is MEBIBYTES, never bytes.** `finance.plan_entitlements.limit_value` and every resolver
> over it (`fn_effective_limit` / `fn_footprint_usage` / `fn_footprint_remaining`) return `integer`.
> 25 GB expressed in bytes is 26,843,545,600 — an int4 overflow. MiB keeps the whole ladder
> (25 GiB … 500 GiB) inside 2,147,483,647.

Ladder (MiB): `individual_free` 25600 · `individual_pro` 153600 · `team_free` 25600 · `team_pro`
512000 · `business_free` 25600 · `business_pro` 512000 · `organisation_free` 25600 · `organisation`
`is_unlimited = true`.

**Enforcement ships fail-open** behind `security.platform_params.storage_quota_enforced`
(seeded `false`) — see [Functions.md](Functions.md#-filesfn_check_storage_quota).

## 📂 Directory Structure

### `files.folders`

Hierarchical organization of assets. Carries the same ownership / provenance / visibility axes as
`files.items`, so a folder can itself be a mounted connector directory or a shared node.

| Column                 | Type                    | Notes                                                                 |
| :--------------------- | :---------------------- | :--------------------------------------------------------------------- |
| `id`                   | uuid                    | PK.                                                                   |
| `owner_user_id`        | uuid                    | FK → `auth.users.id` — the human who created it.                       |
| `parent_folder_id`     | uuid                    | FK → `files.folders.id` (nested directories).                          |
| `name`                 | text                    | Folder display name.                                                  |
| `owner_type`           | `files.owner_kind`      | The owning principal's class. Default `'user'`.                       |
| `owner_entity_id`      | uuid                    | NULL when `owner_type = 'user'`.                                      |
| `source`               | `files.file_source`     | Default `'supabase'`.                                                 |
| `source_connection_id` | uuid                    | FK → `integrations.user_connections` (added in `00000030`).           |
| `external_folder_id`   | text                    | The provider's directory id.                                          |
| `external_parent_id`   | text                    | The provider's parent id.                                             |
| `visibility`           | `files.file_visibility` | Default `'private'`.                                                  |
| `share_slug`           | text                    | UNIQUE; server-minted.                                                |
| `path`                 | text[]                  | **Materialised** ancestor names, root-first. `NOT NULL DEFAULT '{}'`. |
| `created_at`           | timestamptz             |                                                                       |
| `updated_at`           | timestamptz             | Maintained by `files.fn_touch_updated_at`.                            |
| `deleted_at`           | timestamptz             | Soft delete — nothing here is hard-deleted.                            |

`path` is materialised so the breadcrumb renders without a recursive CTE per row — that is what
makes the hub's tree cheap at depth.

**Indexes:** `owner_user_id`, `parent_folder_id`. Before this pass the table had **no index at all**,
not even on its foreign keys, so every tree render and every cascade check was a sequential scan.

---

## 📄 File Management

### `files.items`

The central registry for all files uploaded to the platform. It tracks the relationship between the
database entry and the actual Supabase Storage object.

| Column          | Type    | Notes                                                         |
| :-------------- | :------ | :------------------------------------------------------------ |
| `id`            | uuid    | PK.                                                           |
| `owner_user_id` | uuid    | FK → `auth.users.id`.                                         |
| `folder_id`     | uuid    | FK → `files.folders.id` (Optional).                           |
| `bucket_id`     | text    | Supabase Storage bucket name (e.g., `project`, `quarantine`). |
| `storage_path`  | text    | Full path to the object within the bucket.                    |
| `display_name`  | text    | User-defined name.                                            |
| `original_name` | text    | Filename as uploaded by the client.                           |
| `mime_type`     | text    | Sanitized MIME type.                                          |
| `size_bytes`    | bigint  | File size for quota management.                               |
| `category`      | `files.file_category` | Rich, searchable taxonomy (`Document`, `Image`, `Code`, …). Classified by the fat backend on upload from `(original_name, mime_type)` via `@projective/types/files` `describeFile`; `NOT NULL DEFAULT 'Other'`. See [Storage.md](Storage.md#-file-classification). |
| `metadata`      | jsonb   | Extra fields (e.g., image dimensions, PDF page count).        |
| `status`        | `files.file_status` | **Changed** from free-text: `pending_upload` · `scanning` · `uploaded` · `error` · `quarantined`. Now `NOT NULL`. |
| `is_archived`   | boolean | Logical deletion flag (pre-existing; distinct from `deleted_at`).      |
| `source`        | `files.file_source` | Where the bytes live. Only `supabase` consumes our quota.       |
| `visibility`    | `files.file_visibility` | `private` · `link` · `public`.                                |
| `owner_type` / `owner_entity_id` | `files.owner_kind` / uuid | The metered owning principal.             |
| `content_hash` / `hash_algo` / `hash_sampled` | text / text / boolean | Client-computed digest for dedup **before** bytes cross the wire. `hash_sampled` records the STRENGTH of the claim — a sampled digest (head, tail, length) is a strong hint, never on its own sufficient to collapse two assets onto one stored object. |
| `source_connection_id` | uuid | FK → `integrations.user_connections`, `ON DELETE SET NULL` (added in `00000030`). |
| `external_file_id` / `external_parent_id` / `external_web_url` / `external_etag` | text | Mounted-connector provenance. `external_etag` is the provider's change token, so a delta sync can tell "unchanged" from "not re-read". |
| `link_url` / `link_domain` / `link_title` / `link_description` / `link_favicon_url` | text | Link assets (`source = 'link'`). |
| `link_scan_status` / `link_scanned_at` | `files.link_scan_status` / timestamptz | NULL until the safety pipeline has run **at all** — distinct from `pending` (queued) and `unscannable` (reached for, refused inspection). |
| `share_slug`    | text    | UNIQUE; minted by `files.fn_mint_share_slug`. NULL while private.      |
| `download_count`| integer | `NOT NULL DEFAULT 0`.                                                 |
| `deleted_at`    | timestamptz | Soft delete.                                                      |

**Constraints:** `UNIQUE (source_connection_id, external_file_id)` (a re-run sync UPSERTs instead of
duplicating) · `UNIQUE (bucket_id, storage_path)` · `UNIQUE (share_slug)` ·
`CHECK (source <> 'link' OR link_url IS NOT NULL)` ·
`CHECK (owner_type = 'user' OR owner_entity_id IS NOT NULL)`.

> ⚠️ **Consequence of `UNIQUE (bucket_id, storage_path)` for non-stored assets — flagged.**
> `bucket_id` and `storage_path` are `NOT NULL` and predate this pass, but a `link` or mounted asset
> has no stored object. Those rows must **synthesise** a unique path (e.g. `bucket_id = 'link'`,
> `storage_path = id::text`) — a shared constant would collide on the second row. The cleaner shape
> (both columns nullable, the constraint partial on `source = 'supabase'`) changes two long-standing
> `NOT NULL` columns, which is a human decision.

```sql
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
  category files.file_category NOT NULL DEFAULT 'Other',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status files.file_status NOT NULL DEFAULT 'pending_upload',
  is_archived boolean DEFAULT false,
  -- ... ownership / dedup / connector / link / share columns; see the table above ...
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  CONSTRAINT items_pkey PRIMARY KEY (id),
  CONSTRAINT files_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id),
  CONSTRAINT files_folder_fkey FOREIGN KEY (folder_id) REFERENCES files.folders(id)
);
```

The full DDL is in
[`00000010_tables_files.sql`](../../../supabase/migrations/00000010_tables_files.sql) — this file
does not restate it verbatim.

---

## 🔗 `files.share_links`

READ-ONLY, revocable, expiring access grants — the only way an asset leaves its owner's tenancy
without an account. No upload/replace/delete path exists through a slug, and revocation is a
**column** rather than a `DELETE` so a revoked link stays auditable.

| Column                              | Type                    | Notes                              |
| :---------------------------------- | :---------------------- | :---------------------------------- |
| `id`                                | uuid                    | PK.                                |
| `slug`                              | text                    | UNIQUE, `NOT NULL`. **The credential.** |
| `item_id` / `folder_id`             | uuid                    | FKs, `ON DELETE CASCADE`.          |
| `created_by`                        | uuid                    | FK → `auth.users.id`.              |
| `visibility`                        | `files.file_visibility` | Default `'link'`.                  |
| `expires_at` / `revoked_at`         | timestamptz             |                                    |
| `download_limit` / `download_count` | integer                 | `NULL` limit = unlimited.          |
| `created_at`                        | timestamptz             |                                    |

`CHECK (num_nonnulls(item_id, folder_id) = 1)` — exactly one target, never both and never neither.

The slug — not the item id — is the credential, which is why `files.fn_can_read` does **not** return
true for a `link`-visibility asset, and why this table has no visitor grant. See
[Policies.md](Policies.md).

## 📉 `files.download_events`

The download audit, written by the **server only** (no client `INSERT` policy — the same discipline
as `comms.notifications`).

| Column               | Type                 | Notes                                                     |
| :------------------- | :------------------- | :---------------------------------------------------------- |
| `id`                 | uuid                 | PK.                                                       |
| `item_id`            | uuid                 | FK → `files.items.id`, `ON DELETE CASCADE`.               |
| `actor_user_id`      | uuid                 | NULL for an anonymous share download.                     |
| `device_fingerprint` | text                 | Answers the duplicate-download prompt server-side, so the client never guesses from `localStorage`. |
| `via`                | `files.download_via` | `hub` · `share` · `picker` · `preview` · `api`.           |
| `share_slug`         | text                 | Denormalised so an anonymous download stays attributable after the grant is revoked. |
| `downloaded_at`      | timestamptz          |                                                           |

## 📊 `files.storage_usage`

The metered rollup, maintained by `files.fn_recompute_usage` off a trigger on `files.items`.
PK `(owner_type, owner_id)`; columns `bytes_used bigint`, `item_count integer`, `recomputed_at`.

It exists because the quota gate runs on the **INSERT path**: summing `size_bytes` across a growing
library on every upload is the kind of cost that only shows up once a tenant is successful.

`bytes_used` is `bigint` — the honest unit for a byte total. The quota it is checked against is in
**mebibytes**; the conversion happens once, in `files.fn_check_storage_quota`.

---

## 🚩 Refactor Notes & Suggestions

- **Bucket synchronization.** The `bucket_id` and `storage_path` columns must stay in sync with the
  physical Supabase Storage state.
  - _Suggestion_: an Edge Function reconciling soft-deleted rows against their stored objects, so a
    `deleted_at` eventually frees the bytes. Note this cannot be a plain `AFTER DELETE` trigger —
    nothing here is hard-deleted (root CLAUDE.md §5), so the sweep keys off `deleted_at`, not `DELETE`.
- **Overlap with the engagement attachment tables.** `files.items` coexists with
  **`projects.project_attachments`** and **`comms.message_attachments`**, and the boundary is
  deliberate rather than redundant: those two remain the SSOT for _which engagement an object belongs
  to_, while `files.items` is the asset registry the hub renders. That is why this table carries **no**
  `channel_id`/`message_id` columns — see [Scope of the hub](#scope-of-the-hub).
  > **Corrected.** This note previously described an overlap with **`org.attachments`**. **No such
  > table exists** — no migration creates it, in `org` or anywhere else. The real attachment tables are
  > the two named above. (`org/Tables.md`, `org/Policies.md` and `comms/Tables.md` still carry the same
  > stale reference; those are other domains' docs and are flagged rather than edited here.)
- **Target bucket fields.** `target_bucket` / `target_path` describe the **quarantine → destination
  promotion**: a client upload always lands in `quarantine`, and a clean file is moved to the bucket
  and path these columns name. The promoting Edge Function is **not yet implemented** — see
  [Storage.md](Storage.md#-deferred--live-path-todos).
