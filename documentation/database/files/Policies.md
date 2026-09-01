# files: Policies

RLS enablement:
[`00002001_policies_enable_rls.sql`](../../../supabase/migrations/00002001_policies_enable_rls.sql).
Policies: the tail of
[`00002011_policies_projects.sql`](../../../supabase/migrations/00002011_policies_projects.sql)
(there is deliberately no `policies_files` file — the files policies have always lived there).
Grants: [`00002500`](../../../supabase/migrations/00002500_permissions_schema_grants.sql) ·
[`00002510`](../../../supabase/migrations/00002510_permissions_function_grants.sql) ·
[`00002520`](../../../supabase/migrations/00002520_permissions_table_grants.sql). Storage-object
policies: [`00002017`](../../../supabase/migrations/00002017_policies_storage.sql).

---

## ⚠️ Two pre-existing holes this pass closed

Both were **live**, both predate the asset-management work, and neither was a scoping bug in one
branch — in each case there was no scoping at all. They are recorded here rather than quietly fixed
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
(`parent_folder_id` was writable) and cascading a `DELETE` through it.

This is the more instructive of the two: the `files.items` hole at least required someone to write a
wrong predicate. This one required only that a table be **forgotten**, and a blanket schema grant
then made the omission maximally expensive. It is the reason `00002001` now carries an explicit
comment beside each `files` table rather than a bare list.

`RLS` is now enabled on all five `files` tables (`items`, `folders`, `share_links`,
`download_events`, `storage_usage`), and `folders` has the full four-policy set below.

---

**Both fail silently in the safe direction.** A caller that relied on reading a foreign row now gets
**zero rows**, not an error — nothing raises, a leak just stops. That is deliberate, and it is also
why neither hole would have shown up as a failure in a test suite: the wrong behaviour and the right
behaviour differ only in row count.

---

## `files.items`

| Command  | Role            | Predicate                                                   |
| :------- | :-------------- | :---------------------------------------------------------- |
| `SELECT` | `authenticated` | `files.fn_can_read(id)` — see [Functions.md](Functions.md)  |
| `SELECT` | `anon`          | `visibility = 'public' AND deleted_at IS NULL`              |
| `INSERT` | `authenticated` | `WITH CHECK (owner_user_id = auth.uid())`                   |
| `UPDATE` | `authenticated` | `USING` **and** `WITH CHECK` `(owner_user_id = auth.uid())` |
| `DELETE` | `authenticated` | `owner_user_id = auth.uid()`                                |

**The `UPDATE` `WITH CHECK` arm is new.** The shipped policy had `USING` only, and an `UPDATE`
policy without a `WITH CHECK` validates the row you **started** from, never the row you are
**writing**. A user could take their own row and set `owner_user_id` to someone else (donating a row
into another tenancy), or repoint `bucket_id`/`storage_path` at another tenant's stored object and
read it back through their own now-legitimate row. Re-asserting ownership on the post-image closes
both.

**Note on cost:** the `SELECT` predicate is a per-row function call. It is correct first; if the
hub's list queries ever need it, the owner-scoped arms are index-backed
(`idx_files_items_owner_entity`, `idx_files_items_owner_category`).

## `files.folders`

Same INSERT/UPDATE/DELETE shape as `files.items` (including the `WITH CHECK` arm, so a folder cannot
be re-parented **into** another tenant's tree). `SELECT` mirrors `fn_can_read`'s ownership arms
inline — creator, `public`, or active member of the owning team / business / organisation. Folders
carry no project-mount case: a mounted connector directory is reached through its connection, and a
project's tree is the channel tree, not a folder.

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
> **entity-owned** (team / business / organisation) asset cannot currently be shared by a member who
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

`SELECT` for the actor or the item's owner. **No `INSERT` policy anywhere** — that absence is the
point: _"this asset was downloaded"_ is a server observation, not a claim a browser gets to make
(the same discipline as `comms.notifications`). The schema-wide `INSERT` grant in `00002500` is
harmless precisely because RLS is on and no `INSERT` policy exists.

## `files.storage_usage`

`SELECT` for the owning user or an active member of the owning entity, so the hub can render _"12.4
GB of 25 GB used"_ without a round trip. **No write policy at all** — the rollup is maintained
exclusively by `files.fn_usage_trigger` (a `SECURITY DEFINER` trigger) and the service role. A
client that could write it could write itself unlimited storage.

---

## Grants

| Grant                                   | Where      | Why                                                              |
| :-------------------------------------- | :--------- | :--------------------------------------------------------------- |
| `USAGE ON SCHEMA files TO anon`         | `00002500` | Pre-existing.                                                    |
| `SELECT ON files.items TO anon`         | `00002520` | The schema's **only** anon table grant — the `public` tier.      |
| `EXECUTE ON files.fn_resolve_share`     | `00002510` | To `anon`; the one visitor door into `share_links`.              |
| `REVOKE` on the four internal functions | `00002510` | `fn_recompute_usage`, the two trigger fns, `fn_mint_share_slug`. |

`files.fn_can_read` is deliberately left executable by `PUBLIC`: it **is** the `SELECT` policy on
`files.items`, and a policy expression runs as the invoking role — revoking it would deny every
read.

---

## `storage.objects` — the new `workspace` bucket

These policies govern the **bytes**, not the registry rows above; the two layers are enforced
independently, which is why a `files.items` read leaking metadata (hole 1) never leaked the objects
themselves.

Four policies, anchored on `{entity_id}` and gated by **active membership** of that entity — team
**or** business **or** organisation, OR-ed because one uuid anchor may name any of the three.
Deliberately **not** `auth.uid() = owner`: an entity asset must outlive the member who uploaded it.
`DELETE` is narrower than `UPDATE` on purpose (any member may revise a shared asset; only the
uploader may destroy one).

> Multiple permissive `SELECT` policies on `storage.objects` are **OR-combined**. The workspace
> rules are written as the sole policies for that bucket; adding a broad "any authenticated" read
> would not loosen `workspace` alone. Do not add one (the same warning `00002017`'s own header
> carries for the `project` and `messages` buckets).

Full predicate, path convention and the metering consequence:
[Storage.md → `workspace`](Storage.md#workspace-private).

See also [Tables.md](Tables.md) · [Functions.md](Functions.md) · [Storage.md](Storage.md).
