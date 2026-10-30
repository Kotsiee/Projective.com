# files: Policies

RLS enablement:
[`00002001_policies_enable_rls.sql`](../../../supabase/migrations/00002001_policies_enable_rls.sql).
Policies: the `from 0208_files.sql` region of
[`00002011_policies_projects.sql`](../../../supabase/migrations/00002011_policies_projects.sql) —
mid-file, between the projects and the `0303_projects_lifecycle_rls` policies (there is deliberately
no `policies_files` file — the files policies have always lived there). The one exception is
`files.item_variants`, whose RLS and two policies sit in `00002017` (see below).
Grants: [`00002500`](../../../supabase/migrations/00002500_permissions_schema_grants.sql) ·
[`00002510`](../../../supabase/migrations/00002510_permissions_function_grants.sql) ·
[`00002520`](../../../supabase/migrations/00002520_permissions_table_grants.sql). Storage-object
policies: [`00002017`](../../../supabase/migrations/00002017_policies_storage.sql).

---

## ⚠️ Three pre-existing holes this pass closed

All were **live** and all predate the asset-management work. The first two were not scoping bugs in
one branch — in each there was no scoping at all; the third checked the wrong fact. They are recorded here rather than quietly fixed
because the shape of each is worth recognising again elsewhere.

### 1. `files.items` `SELECT` was `USING (true)` for every signed-in user

The shipped policy, live since `0208`:

```sql
CREATE POLICY "Authenticated users can view files" ON files.items
  FOR SELECT TO authenticated USING (true);
```

It meant literally what it said. **Any** authenticated account — a brand-new signup, a freelancer on
an unrelated project, a client who had never met the owner — could read **every row of the table**:
every other tenant's `display_name` / `original_name`, `mime_type`, `size_bytes`, `bucket_id`,
`storage_path`, `link_url` and `share_slug`, across every project, every DM, every private drive and
every KYC-adjacent upload on the platform. `SELECT * FROM files.items` was a full platform
inventory.

It did not leak the **bytes** — `storage.objects` has always been separately policed per bucket
(`00002017`) — but it leaked the complete metadata index, which is enough to reconstruct who is
working with whom on what, and enough to hand an attacker every id needed for the share-link forgery
described under `files.share_links` below.

Now delegated to `files.fn_can_read(id)` — the **single** read predicate the share route also calls,
so a read rule can no longer be tightened in one place and left open in the other.

### 2. `files.folders` shipped with a blanket `authenticated` CRUD grant and RLS entirely off

The table has existed since `0002`. It was **never** added to the RLS-enable migration, and the
schema-wide grant in `00002500` hands `authenticated` full DML on every table in the schema:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA files TO authenticated;
```

With no `ENABLE ROW LEVEL SECURITY`, a grant is the _whole_ access decision — there is no policy
layer left to filter it. So every signed-in user could **read, rename, re-parent and delete every
other user's folder tree**, including re-parenting a stranger's folder into their own
(`parent_folder_id` was writable) and deleting it leaf-first. Nothing cascades: neither
`folders_parent_fkey` nor `files_folder_fkey` carries an `ON DELETE` action, so a folder that still
holds folders or items is refused by the FK (only `files.share_links.folder_id` cascades).

This is the more instructive of the two: the `files.items` hole at least required someone to write a
wrong predicate. This one required only that a table be **forgotten**, and a blanket schema grant
then made the omission maximally expensive. It is the reason `00002001` now carries an explicit
comment beside `files.folders` (and beside the audit and rollup tables) rather than a bare list.

`RLS` is now enabled on all six `files` tables — `items`, `folders`, `share_links`,
`download_events` and `storage_usage` in `00002001`, and `item_variants` beside its policies in
`00002017` — and `folders` has the full four-policy set below.

### 3. A signed-in user could file things into a library they do not belong to

The `items` and `folders` INSERT policies checked `owner_user_id = auth.uid()` — who **created** the
row — and never whether the creator belonged to the library the row names. Verified by execution
(2026-09-23): a freelancer with no connection to Atelier Nova could insert a folder, or a link
labelled anything, with `owner_type = 'team'` and Atelier Nova's id, and every Atelier Nova member
would see it in their team library as their own team's file. A link row carries no bytes, so the
pipeline guard never saw it.

Both INSERT and both UPDATE `WITH CHECK`s now also require
[`files.fn_owns_library(owner_type, owner_entity_id)`](Functions.md#-filesfn_owns_libraryp_owner_type-filesowner_kind-p_owner_entity_id-uuid--boolean):
a personal row names no entity, and an entity row needs active membership of the entity it names.

---

**Both fail silently in the safe direction.** A caller that relied on reading a foreign row now gets
**zero rows**, not an error — nothing raises, a leak just stops. That is deliberate, and it is also
why neither hole would have shown up as a failure in a test suite: the wrong behaviour and the right
behaviour differ only in row count.

---

## `files.items`

| Policy                                  | Command  | Role            | Predicate                                                   |
| :-------------------------------------- | :------- | :-------------- | :---------------------------------------------------------- |
| "Users can view permitted files"        | `SELECT` | `authenticated` | `files.fn_can_read(id)` — see [Functions.md](Functions.md)  |
| "Public files are viewable by everyone" | `SELECT` | `anon`          | `visibility = 'public' AND deleted_at IS NULL`              |
| "Users can insert own files"            | `INSERT` | `authenticated` | `WITH CHECK (owner_user_id = auth.uid() AND files.fn_owns_library(owner_type, owner_entity_id))` |
| "Users can update own files"            | `UPDATE` | `authenticated` | `USING (owner_user_id = auth.uid())` · `WITH CHECK` the INSERT predicate |
| "Users can delete own files"            | `DELETE` | `authenticated` | `owner_user_id = auth.uid()`                                |

**The DELETE policy is unreachable by design (Decision #314).** A client's hard delete on
`files.items` — and likewise on `files.folders`, whose "Users can delete own folders" has the same
shape — is refused `BEFORE DELETE` by
[`files.fn_guard_hard_delete`](Functions.md#-filesfn_guard_hard_delete): nothing here is
hard-deleted, and an erase would otherwise slip past the archived-library and mounted-row rules. A
delete is the `deleted_at` stamp the hub writes. Dropping the two policies would say the same thing
in RLS; it is left for the change that next touches `00002011`.

**The `UPDATE` `WITH CHECK` arm is explicit, not corrective.** Postgres reuses an `UPDATE` policy's
`USING` as its `WITH CHECK` when none is written, so the shipped `USING`-only policy already held
the post-image to `owner_user_id = auth.uid()` — donating a row into another tenancy by rewriting
`owner_user_id` was never open. What the written-out arm adds is the `fn_owns_library` clause
(hole 3 above).

> ⚠️ **No `WITH CHECK` here stops a repoint.** Both forms test ownership only, so an owner moving
> their own row's `bucket_id` / `storage_path` onto another tenant's stored object passes the policy.
> What refuses it is `files.fn_guard_pipeline_columns`, which rejects any client change to either
> column (`42501`), with `UNIQUE (bucket_id, storage_path)` refusing a path another row already
> holds. The comment beside this policy in `00002011` over-states what the `WITH CHECK` stops —
> flagged (Decision #313).

**Note on cost:** the `SELECT` predicate is a per-row function call. It is correct first; if the
hub's list queries ever need it, the owner-scoped arms are index-backed
(`idx_files_items_owner_entity`, `idx_files_items_owner_category`).

**What the INSERT/UPDATE policies cannot say, a trigger does.** A row-level policy cannot tell a
rename from a forgery, so an owner's own-row write could otherwise claim processing it never went
through — `status = 'uploaded'`, a public bucket, `purpose = 'avatar'`. `files.fn_guard_pipeline_columns`
(`BEFORE INSERT OR UPDATE`) refuses exactly those columns to `anon`/`authenticated`, and since
Decision #314 also a link inserted with a verdict, a `folder_id` outside the row's own library, any
write into or out of an archived entity's library, and a rename, move or re-share of a mounted row;
see [Functions.md](Functions.md#-filesfn_guard_pipeline_columns).

## `files.item_variants`

| Policy                                     | Command  | Role            | Predicate                                                                              |
| :----------------------------------------- | :------- | :-------------- | :------------------------------------------------------------------------------------- |
| "Variants follow their asset"              | `SELECT` | `authenticated` | `files.fn_can_read(item_id)` — the parent asset's own read predicate                   |
| "Public variants are viewable by everyone" | `SELECT` | `anon`          | the parent is `visibility = 'public'` and not deleted                                  |
| —                                          | write    | —               | **none** — the media pipeline writes as the service role                               |

A tier can never be readable when its original is not, because the read is the parent's through the
same predicate the `files.items` policy uses. RLS is enabled beside these policies in
[`00002017`](../../../supabase/migrations/00002017_policies_storage.sql), which also holds the
storage-object rules, because every row here names a stored object.

> ⚠️ **The `anon` policy is unreachable.** `anon` holds no privilege on `files.item_variants` — the
> schema's only anon table grant is `SELECT ON files.items` (`00002520`) — so a signed-out direct
> read is refused with `permission denied` before the policy is consulted. Visitors get tiers only
> through `files.get_public_media` / `fn_public_media_ref`, which are definers. Making the policy
> live is a `GRANT SELECT ON files.item_variants TO anon` beside the `files.items` one — flagged
> (Decision #313).

## `files.folders`

Same INSERT/UPDATE/DELETE shape as `files.items` — "Users can insert own folders", "Users can update
own folders", "Users can delete own folders" — including the `WITH CHECK` arm and its
`fn_owns_library` clause, so a folder can be neither created in nor moved **into** another tenant's
library. `SELECT` ("Users can view permitted folders") mirrors `fn_can_read`'s ownership arms
inline — creator, `public`, or active member of the owning team / business / enterprise. Folders
carry no project-mount case: a mounted connector directory is reached through its connection, and a
project's tree is the channel tree, not a folder. Unlike `fn_can_read`, the `SELECT` carries no
`deleted_at IS NULL` term, so a soft-deleted folder stays readable to its creator, the entity's
members and, if `public`, any signed-in user.

**The parent is enforced by the guards, not the policies (Decision #314).** Both `WITH CHECK`s test
only the row's own `owner_user_id` / `owner_type` / `owner_entity_id`, and a foreign-key check does
not consult RLS, so the policies alone would let a folder or an item be parented under any existing
folder id. The two guard triggers close it: `files.fn_guard_folder_columns` requires a folder's
parent, and `files.fn_guard_pipeline_columns` an item's `folder_id`, to be a live folder of the
row's **own** library ([`fn_folder_in_library`](Functions.md#-filesfn_folder_in_library--boolean) —
the same library, not the same creator, so team members file into each other's folders). The folder
guard also refuses a cycle, a `path` that is not the real ancestry, a client-set share slug or
mount, and any client edit of a mounted folder. The hub's write service checks the same rule first
(`services/files/live-library-writes.ts`) so a refusal reads in words; the database is the gate.
The comment beside these policies in `00002011` over-states what the `WITH CHECK` alone enforces —
still flagged (Decision #313).

## `files.share_links`

Only one policy — `"Creators manage their share links" FOR ALL TO authenticated` — and its two arms
are **not** symmetrical:

| Arm          | Predicate                                                                                |
| :----------- | :--------------------------------------------------------------------------------------- |
| `USING`      | `created_by = auth.uid()`                                                                |
| `WITH CHECK` | `created_by = auth.uid()` **AND** the target is owned by the caller (both clauses below) |

```sql
WITH CHECK (
  created_by = auth.uid()
  AND (item_id   IS NULL OR EXISTS (SELECT 1 FROM files.items   i
        WHERE i.id = share_links.item_id   AND i.owner_user_id = auth.uid() AND i.deleted_at IS NULL))
  AND (folder_id IS NULL OR EXISTS (SELECT 1 FROM files.folders f
        WHERE f.id = share_links.folder_id AND f.owner_user_id = auth.uid() AND f.deleted_at IS NULL))
);
```

### ⚠️ The INSERT ownership arm, and why `created_by` alone is not enough

`created_by = auth.uid()` only proves the row is **not being attributed to someone else**. It says
nothing about the thing being shared. On its own, any signed-in user could

```sql
INSERT INTO files.share_links (slug, item_id, created_by)
VALUES ('…', '<an asset they do NOT own>', auth.uid());
```

and the link would **work**: `authenticated` holds a direct `INSERT` grant on this table through the
schema-wide grant in `00002500`, and `files.fn_resolve_share` is `SECURITY DEFINER` and checks only
**liveness** (not revoked / not expired / not exhausted) — it never re-checks who owns the target,
because by then the slug has already been accepted as the credential. The forged link would resolve
and serve the bytes.

It needs a known item id, which uuid4 makes unguessable in general — but **ids leak legitimately**.
A member removed from a team, or a user removed from a project, keeps every id they ever saw, and
could otherwise mint themselves permanent, revocation-proof access on the way out. The `WITH CHECK`
arm is what closes that exit.

Because the policy is `FOR ALL`, the **same** predicate governs `UPDATE`, so an existing link cannot
be **re-pointed** at another tenant's asset after the fact — the shape that would otherwise turn one
legitimately-created link into a permanent skeleton key.

There is no "any member" arm: revocation authority sits with the person who took the decision to
publish.

> **Deliberately strict, and it fails CLOSED.** Authority is `owner_user_id = auth.uid()`, so an
> **entity-owned** (team / business / enterprise) asset cannot currently be shared by a member who
> is not its owner — even though that member can _read_ it. That is the correct direction to be
> wrong in while the entity share-capability question is open (the same owner-axis question flagged
> for connections, Decision #59). Widening it belongs with whoever settles that question, not with a
> passing edit.

> ### ⚠️ Deviation from the brief, flagged rather than silently resolved
>
> The specification asked for
> `anon SELECT ... USING (revoked_at IS NULL AND (expires_at IS NULL OR
> expires_at > now()))`.
> Taken literally that is a **credential leak**: RLS filters rows, and cannot require that the
> caller already knew the slug. An anon grant plus that predicate permits
>
> ```sql
> SELECT slug FROM files.share_links
> ```
>
> through PostgREST — harvesting every live share credential on the platform. An enumerable
> credential is not a credential, and revocation would become meaningless.
>
> Resolved **structurally**, the way this codebase already handles a secret it must expose an
> operation on but never the value of (`integrations.connection_secrets`: RLS on, no policy, definer
> only — "column safety is structural, not a policy"):
>
> - **No** anon table grant, and therefore no enumerable visitor `SELECT` policy.
> - `files.fn_resolve_share(slug)` — `SECURITY DEFINER`, `EXECUTE` to `anon` — takes the slug as
>   **input** and carries the exact revoked / expired / exhausted predicate the brief asked for.
>
> The predicate is unchanged. Only the reachability model is: you must present the slug rather than
> being handed the list.

## `files.download_events`

`SELECT` for the actor or the item's owner ("Actors and owners can read download events"). The
owner arm reads `files.items` under the caller's own `SELECT` policy (`fn_can_read`), so once an item
is soft-deleted its owner, unless they are also the actor, no longer sees its download events.
**No `INSERT` policy anywhere** — that absence is the point: _"this asset was downloaded"_ is a
server observation, not a claim a browser gets to make (the same discipline as
`comms.notifications`). The schema-wide `INSERT` grant in `00002500` is
harmless precisely because RLS is on and no `INSERT` policy exists.

## `files.storage_usage`

`SELECT` ("Owners can read their storage usage") for the owning user or an active member of the
owning entity, so the hub can render _"12.4 GB of 25 GB used"_ without a round trip. **No write
policy at all** — the rollup is maintained
exclusively by `files.fn_usage_trigger` (a `SECURITY DEFINER` trigger) and the service role. A
client that could write it could write itself unlimited storage.

---

## Grants

| Grant                                   | Where      | Why                                                              |
| :-------------------------------------- | :--------- | :--------------------------------------------------------------- |
| `USAGE ON SCHEMA files TO anon`         | `00002500` | Pre-existing.                                                    |
| `ALL` and `SELECT, INSERT, UPDATE, DELETE` `ON ALL TABLES IN SCHEMA files` | `00002500` | To `authenticated` + `service_role`, and again in default privileges. RLS is what bounds `authenticated`. |
| `SELECT ON files.items TO anon`         | `00002520` | The schema's **only** anon table grant — the `public` tier.      |
| `EXECUTE ON files.fn_resolve_share`     | `00002510` | To `anon`; the one visitor door into `share_links`.              |
| `REVOKE` on the five internal functions | `00002510` | `fn_recompute_usage`, the three trigger fns (`fn_usage_trigger`, `fn_check_storage_quota`, `fn_touch_updated_at`), `fn_mint_share_slug`. |
| `EXECUTE ON files.get_public_media`     | `00002510` | To `anon` + `authenticated`: returns only world-readable refs.   |
| `REVOKE` on `fn_public_media_ref` · `fn_guard_pipeline_columns` · `fn_guard_folder_columns` · `fn_guard_hard_delete` | `00002510` | Reached only through definers / as a trigger. |
| `EXECUTE ON files.fn_folder_in_library` · `fn_library_archived` | `00002510` | To `anon` + `authenticated` + svc: the guards call them as the client's own role (Decision #314). |
| `REVOKE TRUNCATE … SCHEMA files`        | `00002500` | From `anon` + `authenticated`, and from default privileges. TRUNCATE is not row-level, so RLS never bounded it. |
| `EXECUTE ON files.fn_owns_library`      | `00002510` | To `anon` + `authenticated` + svc: it is called by the write policies themselves. |
| `EXECUTE ON files.get_storage_quota`    | `00002510` | To `authenticated` + svc, `REVOKE`d from `PUBLIC`/`anon`; it authorises its own caller. |
| `EXECUTE ON files.fn_record_download`   | `00002510` | To the **service role only** — a download is a server observation. |

`files.fn_can_read` and `files.fn_owns_library` are deliberately left executable by `PUBLIC`: they
**are** the `SELECT` and write policies on `files.items`, and a policy expression runs as the invoking
role — revoking either would deny every read or every write.

---

## `storage.objects` — the new `workspace` bucket

These policies govern the **bytes**, not the registry rows above; the two layers are enforced
independently, which is why a `files.items` read leaking metadata (hole 1) never leaked the objects
themselves.

One policy, a read, anchored on `{entity_id}` and gated by **active membership** of that entity —
team **or** business **or** enterprise, OR-ed because one uuid anchor may name any of the three.
Deliberately **not** `auth.uid() = owner`: an entity asset must outlive the member who uploaded it.
No member writes the bucket directly: the `/files` pipeline promotes an upload here as the service
role (Decision #340, Q0.2 (a)).

> Multiple permissive `SELECT` policies on `storage.objects` are **OR-combined**. The workspace
> rules are written as the sole policies for that bucket; adding a broad "any authenticated" read
> would not loosen `workspace` alone. Do not add one (the same warning `00002017`'s own header
> carries for the `project` and `messages` buckets).

Full predicate, path convention and the metering consequence:
[Storage.md → `workspace`](Storage.md#workspace-private).

## `storage.objects` — the public profile buckets (`avatars`, `showcase`) and `quarantine`

- **`avatars` and `showcase` have public `SELECT` and no client write policy at all** (2026-09-22).
  Everything in them is served to the whole internet, so everything in them must have been through
  the quarantine scan and re-encoded by the media pipeline, which writes as the service role. The
  former `avatars` policy "Owners can write their branding assets" (`FOR ALL TO authenticated`) let
  any signed-in user PUT an arbitrary, unscanned file straight into a public bucket, bypassing both.
- **`quarantine`'s INSERT policy now anchors the path**:
  `(storage.foldername(name))[1] = auth.uid()::text` beside `auth.uid() = owner`, so a user cannot
  write objects under another user's prefix.

> Closed by Decision #340 (Q0.2 (a)): `catalogue` and `public_assets` also have public `SELECT` and
> no client write policy, like every bucket but `quarantine`. The service role writes them, and
> `public_assets` takes raster images only (no SVG).

## `storage.objects` — the `contact` bucket (Decision #276)

- **One policy, operator `SELECT` of SENT attachments**: "Operators read contact attachments"
  (`00002017`, region `[contact]`) — `bucket_id = 'contact' AND security.is_admin()` AND the object's
  `files.items` row (`bucket_id = 'contact'`, `storage_path = name`, not deleted) is linked in
  `ops.contact_request_attachments`, the same rule as `files.fn_can_read`'s contact arm. A file its
  sender removed or left on an unsent form is not readable. It is the bucket's sole policy, so no
  broader read can be OR-combined in by accident.
- **No client write policy at all.** A `/contact` attachment is declared like any upload (a
  `pending_upload` row in `quarantine`, marked `target_bucket = 'contact'`); the contact pipeline
  (service role, `services/contact/live-attachments.ts`) sniffs the bytes and promotes the original
  to `contact/{user_id}/{asset_id}/…` with `files.items.purpose = 'contact'`. The sender keeps no read
  path to the promoted object (they hold their own copy); the `files.items` row stays readable by its
  owner, and by operators through `files.fn_can_read`'s contact arm once it is sent
  ([Functions.md](Functions.md)).
- **Unsent files do not linger.** Remove soft-deletes the sender's own unsent row
  (`ops.discard_contact_attachment`) and the service role deletes its object; the hourly
  `contact-attachment-sweep` does the same for every contact upload older than six hours that no
  request links (`ops.fn_claim_stale_contact_attachments`, then the Storage API — `storage.objects`
  rows cannot be deleted from SQL). The library's own upload-complete steps refuse a row with a
  `target_bucket`, so only the contact pipeline finishes a contact declaration.

See also [Tables.md](Tables.md) · [Functions.md](Functions.md) · [Storage.md](Storage.md).
