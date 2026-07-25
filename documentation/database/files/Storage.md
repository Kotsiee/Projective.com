# files Schema: Storage

This document outlines the Supabase Storage bucket architecture for Projective. The storage layer is
physically isolated into buckets by **sensitivity × ownership**, so that a single, path-anchored RLS
rule can govern each bucket. Buckets are seeded in
[`00005040_seed_storage_buckets.sql`](../../../supabase/migrations/00005040_seed_storage_buckets.sql);
their `storage.objects` policies live in
[`00002017_policies_storage.sql`](../../../supabase/migrations/00002017_policies_storage.sql). The
typed map — the bucket registry and the path builders that emit each RLS anchor — is the Zod SSOT at
[`@projective/types/files`](../../../packages/types/files/storage.ts); app and backend code should
build storage paths through it rather than hardcoding bucket ids or path strings.

> **The RLS anchor is the first path segment.** Every object's `name` begins with the id that its
> policy checks — `(storage.foldername(name))[1]`. Keep the conventions below exactly, or RLS will
> not resolve.

## 🪣 Bucket Overview

| Bucket          | Access       | Size / MIME               | Path anchor        | Governs                                                  |
| :-------------- | :----------- | :------------------------ | :----------------- | :------------------------------------------------------ |
| `quarantine`    | Private      | 50 MiB · any              | `{user_id}`        | Virus-scan / MIME-validation landing zone for all uploads. |
| `project`       | Private      | 50 MiB · any              | `{project_id}`     | Project / channel / stage collaboration files.          |
| `messages`      | Private      | 50 MiB · any              | `{thread_id}`      | Global DM / inbox attachments (not project-scoped).     |
| `personal`      | Private      | 50 MiB · any              | owner (`auth.uid`) | Owner-only drive: drafts, personal templates, WIP.      |
| `invoices`      | Private      | 20 MiB · pdf              | `{owner_id}`       | Wallet statements / invoices / receipts.                |
| `verification`  | **Service**  | 20 MiB · img,pdf          | `{subject_id}`     | KYC / KYB identity documents — service-role only.       |
| `public_assets` | Public       | 10 MiB · img              | `{owner_id}`       | Misc public assets (general/legacy).                    |
| `avatars`       | Public       | 5 MiB · img               | `{entity_id}`      | Profile / team / business / org branding.               |
| `catalogue`     | Public       | 10 MiB · img              | `{seller_id}`      | Marketplace storefront media (products, service showcase). |

---

## 📂 Directory Structure

### `avatars` (Public)

Profile branding, edge-cached. Public read; the owning entity writes its own prefix.

```text
avatars/
├── users/[user_id]/{avatar|banner}.webp
├── teams/[team_id]/{avatar|banner}.webp
├── businesses/[business_id]/{logo|banner}.webp
└── organisations/[org_id]/{logo|banner}.webp
```

### `catalogue` (Public)

Marketplace storefront media. Public read; the seller writes under their own id.

```text
catalogue/
└── [seller_id]/
    └── [listing_id]/
        ├── cover.webp
        └── gallery/[asset_id].webp
```

### `public_assets` (Public)

General public assets safe for global edge caching (portfolio previews, article media, etc.).

```text
public_assets/
└── [owner_id]/
    └── ...
```

### `project` (Private)

Collaboration files. Read **and** write are governed by `projects.has_project_access({project_id})`.

```text
project/
└── [project_id]/
    ├── stages/[stage_id]/submissions/[submission_id]/file.xyz
    ├── channels/[channel_id]/attachments/[attachment_id]/file.xyz
    └── assets/file.xyz
```

### `messages` (Private)

Global DM / inbox attachments — these are **not** project-scoped, so the `project` ACL cannot gate
them and `personal` (single-owner) cannot either. Read/write is gated by `comms.dm_participants`
membership on the `{thread_id}` anchor, so both parties in a DM can read what either uploads.

```text
messages/
└── [thread_id]/
    └── [message_id]/file.xyz
```

### `personal` (Private)

Owner-only storage for work-in-progress and non-project drafts.

```text
personal/
└── users/[user_id]/
    ├── drafts/{messages|projects|templates}/[draft_id]/file.xyz
    └── templates/[template_id]/bundle.zip
```

### `invoices` (Private)

Wallet statements, invoices, receipts. Owner read on the `{owner_id}` anchor; **no** authenticated
write — documents are generated and written by the service role.

```text
invoices/
└── [owner_id]/            -- personal user id OR team/business/org wallet-scope id
    └── [period]/statement.pdf
```

### `verification` (Service-role only)

KYC / KYB identity documents — the highest sensitivity class. There is **no `authenticated` policy
at all**: RLS is on, so a user JWT is default-denied, and only the service role (in Edge Functions)
can touch the bucket. Client uploads land in `quarantine` and are **promoted** into `verification`
by a `SECURITY DEFINER` / service-role move, so no user JWT ever reads or writes here directly.

```text
verification/
└── [subject_id]/         -- user_id (KYC) or business/org_id (KYB)
    └── [document_type]/file.xyz
```

### `quarantine` (Restricted)

The entry point for **all** user uploads. Files are moved to their target bucket only after passing
system checks (AV scan + MIME validation).

```text
quarantine/
└── [user_id]/
    └── [upload_session_id]/original_file.xyz
```

---

## 🔗 Database Integration

Storage paths are mapped to the database through:

- **[`files.items`](Tables.md)** — the virtualized path (folders/items) for a user's file library.
  Carries `bucket_id` + `storage_path` for the current location and `target_bucket` + `target_path`
  for the quarantine → destination promotion.
- **`projects.project_attachments`** — links project/stage/channel deliverables to their storage
  object.
- **`comms.message_attachments`** — links DM / channel message attachments to their storage object.

### Example: resolving a stage-submission path

```sql
-- The storage object for a stage submission deliverable
SELECT
  'project/' || ps.project_id || '/stages/' || ps.id
    || '/submissions/' || ss.id || '/' || fi.storage_path AS storage_path
FROM projects.stage_submissions ss
JOIN projects.project_stages ps ON ps.id = ss.project_stage_id
JOIN files.items fi ON fi.id = ss.file_item_id
WHERE ss.id = :submission_id;
```

## 🔐 Security Enforcement

- **Path anchor = RLS anchor.** Each policy checks `(storage.foldername(name))[1]` against the id in
  the table above. Uploading to the wrong prefix fails the `WITH CHECK`.
- **Signed URLs.** All private buckets (`quarantine`, `project`, `messages`, `personal`, `invoices`,
  `verification`) are downloaded via short-lived signed URLs; the public buckets (`avatars`,
  `catalogue`, `public_assets`) serve directly from the edge cache.
- **Per-bucket limits.** Each bucket sets its own `file_size_limit` and `allowed_mime_types` in the
  seed — nothing inherits the global 50 MiB / any-MIME default.
- **Promote, don't cross.** Moving a file from `quarantine` to any destination bucket is an atomic
  operation performed by a `SECURITY DEFINER` function or the service role, so a user can never
  bypass a project-access, DM-membership, or verification check by writing straight to a
  restricted bucket.

## 🏷️ File classification

On upload, a file is classified into a rich, searchable **`FileCategory`** (~27 categories:
`Document`, `Image`, `Vector`, `Audio`, `Video`, `Code`, `3D`, `CAD`, `Data`, `Database`, …) by the
Zod SSOT at
[`@projective/types/files`](../../../packages/types/files/categories.ts) — `categorizeFile(name,
mimeType)` / `describeFile(name, mimeType)`. It is pure and isomorphic, so the **fat backend**
classifies authoritatively on upload (the server-of-record for search/analytics) and an island can
classify identically for instant UI.

- **Two layers, one source.** `FileCategory` (rich taxonomy, for search/filter/facets/analytics)
  maps to the coarse `FileKind` (the 8 rendering buckets — glyph + inline preview renderer) via
  `CATEGORY_META`, so classification and rendering never fork.
- **What to persist.** `files.items.category` (a `files.file_category` enum whose values are the
  canonical `FileCategory` literals — indexed in `00004011_indexes_files.sql`) holds the taxonomy
  for faceting. `kind` is derivable from `category` via `CATEGORY_META` for rendering, and the
  human-readable `application` ("Adobe Photoshop Document") rides `metadata jsonb`. On upload the fat
  backend calls `describeFile(original_name, mime_type)` and writes `category`.
- **Icons.** `CATEGORY_META[c].icon` is a semantic slug. For now the UI resolves it through `kind`
  to the existing 8-glyph set (`file-glyphs.tsx`); a future per-file-type icon pack (e.g. VSCode
  Material Icons) maps to that slug or the raw extension without touching call sites. Any icon pack
  must be added as its own inline glyph set / app-side asset — **not** as a `@projective/ui`
  dependency (root CLAUDE.md §3 forbids UI-library deps in the component layer).
- **Ambiguous extensions.** When one extension lives under several categories, the first in enum
  order wins; genuine context collisions (e.g. `.ts` = TypeScript, not MPEG Transport Stream) are
  resolved in the visible `EXTENSION_OVERRIDES` map, not by reordering the taxonomy.

## 🚧 Deferred / live-path TODOs

- **AV-scan promotion is modelled, not wired.** `files.items.target_bucket` / `target_path` describe
  the quarantine → destination move, but the Edge Function that scans and promotes clean files is not
  yet implemented.
- **Image transformation is off.** `[storage.image_transformation]` is commented out in
  `supabase/config.toml`; enable it (imgproxy) before relying on server-side avatar/thumbnail
  resizing.
- **Public vs. signed for branding/catalogue.** `avatars`, `catalogue`, and `public_assets` are true
  **public** buckets (fast CDN, but object URLs are enumerable). Whether profile/storefront media
  should instead be private-with-signed-URLs is a product privacy call flagged for a human, not a
  technical default.
