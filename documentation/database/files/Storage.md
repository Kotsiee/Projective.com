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

| Bucket          | Access      | Size / MIME      | Path anchor        | Governs                                                                               |
| :-------------- | :---------- | :--------------- | :----------------- | :------------------------------------------------------------------------------------ |
| `quarantine`    | Private     | 50 MiB · any     | `{user_id}`        | Virus-scan / MIME-validation landing zone for all uploads.                            |
| `project`       | Private     | 50 MiB · any     | `{project_id}`     | Project / channel / stage collaboration files.                                        |
| `messages`      | Private     | 50 MiB · any     | `{thread_id}`      | Global DM / inbox attachments (not project-scoped).                                   |
| `personal`      | Private     | 50 MiB · any     | owner (`auth.uid`) | Owner-only drive: drafts, personal templates, WIP.                                    |
| `workspace`     | Private     | 50 MiB · any     | `{entity_id}`      | **Entity-owned** drive: the team / business / organisation counterpart of `personal`. |
| `invoices`      | Private     | 20 MiB · pdf     | `{owner_id}`       | Wallet statements / invoices / receipts.                                              |
| `verification`  | **Service** | 20 MiB · img,pdf | `{subject_id}`     | KYC / KYB identity documents — service-role only.                                     |
| `public_assets` | Public      | 10 MiB · img     | `{owner_id}`       | Misc public assets (general/legacy).                                                  |
| `avatars`       | Public      | 5 MiB · img      | `{entity_id}`      | Profile photos (user / team / business / org). **Service-role write only.**           |
| `showcase`      | Public      | 50 MiB · img,vid | `{entity_id}`      | A profile's six-slot showcase — stills and full-length videos. **Service-role write.** |
| `catalogue`     | Public      | 10 MiB · img     | `{seller_id}`      | Marketplace storefront media (products, service showcase).                            |

---

## 📂 Directory Structure

### `avatars` (Public)

Profile photos, edge-cached. Public read; **written only by the media pipeline** (service role) —
there is deliberately no `authenticated` write policy (2026-09-22). Every object here is served to
the whole internet, so every object must have been through the quarantine scan and re-encoded by the
pipeline; the former "Owners can write their branding assets" policy let any signed-in user PUT an
arbitrary, unscanned file straight into a public bucket over the Storage API.

```text
avatars/
└── [entity_id]/                          -- the user, team, business or organisation it belongs to
    ├── avatar/[rendition_id]/
    │   ├── full.webp                     -- the cropped 1:1 rendition (≤ 2048 px)
    │   └── {sm|md|lg}.webp               -- 96 / 256 / 1024 px tiers (files.item_variants)
    └── avatar.{jpg|webp|…}               -- a seeded development photo (no tiers)
```

A rendition is written by `renditionLocation("avatars", ownerId, renditionId, name)`. (The older
`avatarLocation(entity, entityId, name)` builder emits `{entity}/{entity_id}/…`, which does **not**
put the anchor first; nothing calls it.)

### `showcase` (Public)

A profile's six-slot showcase — the hero carousel, and slot 1 as the thumbnail every card of the
profile leads with. Stills **and** full-length videos, which is why it is not `avatars` (images
only, 5 MiB). Public read (`"Showcase media is viewable by everyone"`); written only by the media
pipeline, exactly like `avatars`. 50 MiB is the platform's global object ceiling, so a larger bucket
limit would be unenforceable.

```text
showcase/
└── [entity_id]/
    └── showcase/[rendition_id]/
        ├── full.webp                     -- a still, cropped to 16:10 (≤ 3200 px)
        ├── video.{mp4|webm|mov}          -- a video slot keeps its bytes as uploaded
        └── {sm|md|lg}.webp               -- 480 / 1280 / 2400 px tiers (a video's are its poster)
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
    ├── library/[asset_id]/               -- the media library: an admitted upload's ORIGINAL…
    │   ├── [name].{jpg|png|webp|mp4|…}
    │   └── {sm|md|lg}.webp               -- …and its WebP tiers (a video's are its poster)
    ├── drafts/{messages|projects|templates}/[draft_id]/file.xyz
    └── templates/[template_id]/bundle.zip
```

The library original stays **private**: what a profile shows publicly is a rendition cut from it
into `avatars` or `showcase`, never the original itself.

### `workspace` (Private)

The **entity-owned** counterpart of `personal` — the shared drive behind a team / business /
organisation library in the `/files` hub. Seeded alongside the other private buckets in `00005040`
(private, **50 MiB**, any MIME); policies in `00002017`.

```text
workspace/
└── [entity_id]/          -- a team_id OR a business_id OR an organisation_id
    └── ...
```

**The anchor is the entity id, not the uploader's user id, and that is the whole design.** An entity
asset must **outlive the member who uploaded it**: anchoring on the uploader would strand a
departing member's files behind a personal gate, so a team would lose its own brand assets the day
someone left. The gate is therefore **active membership of the anchor**, not object ownership:

```sql
bucket_id = 'workspace' AND (
     org.is_active_team_member    ((storage.foldername(name))[1]::uuid)
  OR org.is_active_business_member((storage.foldername(name))[1]::uuid)
  OR org.is_organisation_member   ((storage.foldername(name))[1]::uuid)
)
```

The three helpers are OR-ed because **one uuid anchor may name any of the three entity kinds** — the
caller passes exactly one and the other two return `false`. (There is no discriminator in the path,
by design: adding one would mean a folder rename whenever an entity changed class.)

`DELETE` is **narrower than `UPDATE`** on purpose — any member may revise a shared asset, but only
the uploader (`auth.uid() = owner`, _and_ still a member) may destroy one. Entity-wide deletion
authority belongs behind a capability check in the fat service, not in a blanket storage policy.

> ⚠️ These four are written as the **sole** policies for this bucket. Multiple permissive `SELECT`
> policies on `storage.objects` are **OR-combined**, so adding a broad "any authenticated" read
> would not loosen `workspace` alone — it would loosen it _and_ leave the intended rule looking
> correct. Do not add one. (The same warning `00002017`'s header carries for `project` and
> `messages`.)

Metering is the matching half: a `workspace` object's `files.items` row carries
`owner_type ∈ {team, business, organisation}` with `owner_entity_id` = the anchor, so its bytes are
charged to the **entity's** `storage_megabytes` allowance, never to the uploader's personal one. See
[Tables.md](Tables.md#storage-quota).

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
system checks (AV scan + MIME validation). The INSERT policy checks the path's first segment against
`auth.uid()` as well as `owner`, so a user cannot write under another user's prefix.

```text
quarantine/
└── [user_id]/
    └── [upload_session_id]/original_file.xyz
```

#### The upload pipeline

The media library (`/[handle]/edit` → the media picker → `/api/media/*`) is the first surface wired
end to end. `packages/backend/services/media/library.ts` runs it:

1. **Declare** (`POST /api/media/upload-init`, the caller's own session): a `files.items` row at
   `status = 'pending_upload'`, `bucket_id = 'quarantine'`, `purpose = 'library'` — the only shape
   `files.fn_guard_pipeline_columns` lets a client insert — and a signed upload URL for
   `quarantine/{user_id}/{asset_id}/{name}` (`x-upsert: false`). Size and type are refused up front
   against `LIBRARY_IMAGE_MAX_BYTES` (25 MiB) / `LIBRARY_VIDEO_MAX_BYTES` (50 MiB).
2. **Claim** (`POST /api/media/upload-complete`): the caller's session proves the row is theirs, then
   the service role moves it `pending_upload → scanning` with a conditional update — exactly one
   completion can win.
3. **Sniff**: the first bytes are matched against magic numbers (`sniffBytes`), never the declared
   type or extension. An executable or markup file (an SVG named `.jpg`, say) is marked
   `quarantined` and its object deleted; anything else unusable is `error`.
4. **Decode + tier**: the picture is decoded in a Worker (decoding IS the proof it is the picture it
   claims to be) and the three WebP tiers are encoded, never upscaled. A video's tiers are its
   poster still, which the browser extracts and sends; the server never decodes video.
5. **Admit**: the original moves to `personal/users/{user_id}/library/{asset_id}/…`, the tiers beside
   it, `files.item_variants` rows are written, the row becomes `uploaded`, and the quarantine object
   is removed. A storage or pipeline failure puts the row back to `pending_upload` so a retry can
   finish it; nothing half-written is left behind.

A **rendition** (`POST /api/profile/{handle}/media`) is cut server-side from the library ORIGINAL
with the shared crop model (`@projective/types/files` `crop.ts`, the same arithmetic the browser
editor previews), re-encoded as a fresh WebP — which also strips EXIF and anything a polyglot could
smuggle — and written to `avatars` or `showcase` with its tiers. It is then attached by
`org.set_profile_avatar` / `org.save_showcase`, which check that the file is the owner's own.

---

## 🧭 Path builders (the typed SSOT)

Never hardcode a bucket id or hand-build an object path. Every path is emitted by a builder in
[`@projective/types/files/storage.ts`](../../../packages/types/files/storage.ts), and each one
**emits the RLS anchor as its first segment** — so a path produced there is guaranteed to satisfy
the matching policy's `WITH CHECK`. `BUCKETS` / `bucketMeta()` mirror the `00005040` seed
field-for-field (access tier, `maxBytes`, `allowedMime`, anchor), and `rlsAnchor(path)` reads back
what a policy would check.

| Builder                                                                       | Emits                                        |
| :---------------------------------------------------------------------------- | :------------------------------------------- |
| `quarantineLocation(userId, sessionId, filename)`                             | `quarantine/{userId}/{sessionId}/{filename}` |
| `projectLocation(projectId, ...segments)`                                     | `project/{projectId}/…`                      |
| `stageSubmissionLocation(...)` · `channelAttachmentLocation(...)`             | the two `project/` conventions above         |
| `messageAttachmentLocation(threadId, messageId, filename)`                    | `messages/{threadId}/{messageId}/{filename}` |
| `personalLocation(userId, ...segments)`                                       | `personal/users/{userId}/…`                  |
| **`workspaceLocation(entityId, ...segments)`**                                | **`workspace/{entityId}/…`**                 |
| `invoiceLocation(...)` · `verificationLocation(...)`                          | `invoices/…` · `verification/…`              |
| `avatarLocation(...)` · `catalogueLocation(...)` · `publicAssetLocation(...)` | the three public buckets                     |

> **`workspaceLocation()` is the one builder whose misuse is silent.** It takes the **team /
> business / organisation id**, and is the entity counterpart of `personalLocation()`. Reaching for
> `personalLocation()` for an entity asset does **two** wrong things at once: it mis-names the
> object _and_ it resolves against the wrong predicate — `personal` is gated on
> `auth.uid() = owner`, so the write would still **succeed** for the uploader and then be invisible
> to every teammate, which is the worst available failure mode (no error, no bytes lost, just an
> asset nobody else can ever see).
>
> The two also differ in shape, and the reason is worth knowing: `personalLocation()` interposes a
> literal `users/` segment (`personal/users/{userId}/…`) — harmless, because that bucket's policy
> reads `storage.objects.owner` and never looks at the path — whereas `workspaceLocation()` puts the
> entity id **first**, because `workspace` **is** path-anchored and `(storage.foldername(name))[1]`
> is exactly what its four policies check.

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
- **Signed URLs.** All private buckets (`quarantine`, `project`, `messages`, `personal`,
  `workspace`, `invoices`, `verification`) are downloaded via short-lived signed URLs; the public
  buckets (`avatars`, `catalogue`, `public_assets`) serve directly from the edge cache. A signed URL
  is a **bearer capability**: it is minted per request by the fat service, never cached onto a row,
  and never persisted into a projection the client reads.
- **Per-bucket limits.** Each bucket sets its own `file_size_limit` and `allowed_mime_types` in the
  seed — nothing inherits the global 50 MiB / any-MIME default.
- **Promote, don't cross.** Moving a file from `quarantine` to any destination bucket is an atomic
  operation performed by a `SECURITY DEFINER` function or the service role, so a user can never
  bypass a project-access, DM-membership, or verification check by writing straight to a restricted
  bucket.

## 🏷️ File classification

On upload, a file is classified into a rich, searchable **`FileCategory`** (~27 categories:
`Document`, `Image`, `Vector`, `Audio`, `Video`, `Code`, `3D`, `CAD`, `Data`, `Database`, …) by the
Zod SSOT at [`@projective/types/files`](../../../packages/types/files/categories.ts) —
`categorizeFile(name,
mimeType)` / `describeFile(name, mimeType)`. It is pure and isomorphic, so the
**fat backend** classifies authoritatively on upload (the server-of-record for search/analytics) and
an island can classify identically for instant UI.

- **Two layers, one source.** `FileCategory` (rich taxonomy, for search/filter/facets/analytics)
  maps to the coarse `FileKind` (the 8 rendering buckets — glyph + inline preview renderer) via
  `CATEGORY_META`, so classification and rendering never fork.
- **What to persist.** `files.items.category` (a `files.file_category` enum whose values are the
  canonical `FileCategory` literals — indexed in `00004011_indexes_files.sql`) holds the taxonomy
  for faceting. `kind` is derivable from `category` via `CATEGORY_META` for rendering, and the
  human-readable `application` ("Adobe Photoshop Document") rides `metadata jsonb`. On upload the
  fat backend calls `describeFile(original_name, mime_type)` and writes `category`.
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
  the quarantine → destination move, but the Edge Function that scans and promotes clean files is
  not yet implemented.
- **Image transformation is off.** `[storage.image_transformation]` is commented out in
  `supabase/config.toml`; enable it (imgproxy) before relying on server-side avatar/thumbnail
  resizing.
- **Public vs. signed for branding/catalogue.** `avatars`, `catalogue`, and `public_assets` are true
  **public** buckets (fast CDN, but object URLs are enumerable). Whether profile/storefront media
  should instead be private-with-signed-URLs is a product privacy call flagged for a human, not a
  technical default.
