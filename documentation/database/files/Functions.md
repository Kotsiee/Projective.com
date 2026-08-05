# files: Functions

Migration: [`00001160_functions_files.sql`](../../../supabase/migrations/00001160_functions_files.sql)
(functions) and
[`00001880_triggers_files.sql`](../../../supabase/migrations/00001880_triggers_files.sql) (the
triggers that bind them).

Before the asset-management pass the `files` schema had **zero** functions — no touch trigger, no
read predicate, no quota gate, no usage rollup. Every access rule therefore had to be written as a
raw predicate inline in each policy, which is precisely how a read rule and a share route drift
apart. **There are now seven**, plus one `finance` branch that reads this schema.

Every function pins `SET search_path = ''` and fully qualifies every identifier. `SECURITY DEFINER`
is used **only** where a function must read a table the caller cannot: the membership tables, the
item row itself, or `security.platform_params`.

## The seven

| Function                                    | Kind      | Definer | Reachable by                    | Purpose                                                      |
| :------------------------------------------ | :-------- | :------ | :------------------------------ | :------------------------------------------------------------ |
| `fn_touch_updated_at()`                     | trigger   | —       | trigger only (`REVOKE`d)        | `updated_at` maintenance on `items` + `folders`.             |
| `fn_recompute_usage(owner_kind, uuid)`      | `void`    | ✅      | `service_role`                  | Rebuilds one owner's `storage_usage` row from scratch.       |
| `fn_usage_trigger()`                        | trigger   | ✅      | trigger only (`REVOKE`d)        | Adapter — recomputes **both** sides of an ownership change.  |
| `fn_can_read(uuid) → boolean`               | `STABLE`  | ✅      | `PUBLIC` (it **is** the policy) | **The** read predicate for `files.items`.                    |
| `fn_check_storage_quota()`                  | trigger   | ✅      | trigger only (`REVOKE`d)        | The **fail-open** quota gate.                                |
| `fn_resolve_share(text) → TABLE`            | `STABLE`  | ✅      | `anon` · `authenticated` · svc  | The **only** door from a slug into `share_links`.            |
| `fn_mint_share_slug() → text`               | `VOLATILE`| —       | `service_role`                  | Mints the opaque capability token.                           |

Grants are in
[`00002510`](../../../supabase/migrations/00002510_permissions_function_grants.sql); the reasoning
for each `REVOKE` / `GRANT` is in [Policies.md](Policies.md#grants).

### Triggers bound in `00001880`

| Trigger                    | Timing                                                                                             | Function                  |
| :------------------------- | :--------------------------------------------------------------------------------------------------- | :------------------------ |
| `trg_files_items_touch`    | `BEFORE UPDATE ON files.items`                                                                     | `fn_touch_updated_at`     |
| `trg_files_folders_touch`  | `BEFORE UPDATE ON files.folders`                                                                   | `fn_touch_updated_at`     |
| `trg_files_items_usage`    | `AFTER INSERT OR UPDATE OF size_bytes, deleted_at, source, owner_type, owner_entity_id OR DELETE`  | `fn_usage_trigger`        |
| `trg_files_items_quota`    | `BEFORE INSERT OR UPDATE OF size_bytes ON files.items`                                             | `fn_check_storage_quota`  |

> **The usage trigger's `UPDATE OF` list is deliberately wider than `size_bytes, deleted_at`.**
> `source` decides whether a row counts **at all** (a hub-native upload that becomes a mounted
> reference stops consuming our bytes), and `owner_type` / `owner_entity_id` decide **whose** rollup
> it counts against. Narrowing the list back to two columns would leave a re-owned or re-sourced asset
> charged to the wrong principal until some unrelated write happened to fire the trigger.

---

## 🔁 `files.fn_touch_updated_at()`

`RETURNS trigger` · not definer.

Sets `NEW.updated_at := now()`. Bound `BEFORE UPDATE` on both `files.items` and `files.folders`.
Both columns existed before this pass and neither had a trigger, so `updated_at` was only ever
correct when the application remembered to set it.

---

## 📊 `files.fn_recompute_usage(p_owner_type files.owner_kind, p_owner_id uuid)`

`RETURNS void` · `SECURITY DEFINER`.

Recomputes one owner's stored-byte total from scratch and upserts `files.storage_usage`.

- **Recompute, not increment — deliberately.** An incremental counter drifts silently the first
  time a write path is missed, and a storage total that is quietly wrong is worse than one that is
  momentarily expensive.
- Counts **only what we actually store**: `source = 'supabase'` and `deleted_at IS NULL`. A mounted
  Drive/Dropbox/S3/Frame.io file consumes the **provider's** quota; a `link` consumes none.
- Definer because it runs from an `AFTER` trigger and must see every row of the owner's library,
  including rows the acting user cannot read.

### `files.fn_usage_trigger()`

`RETURNS trigger` · `SECURITY DEFINER`. The adapter that lets a trigger call the function above (a
trigger function must be `RETURNS trigger` with no declared parameters). It recomputes **both sides**
of an ownership change: moving an asset from a personal library into a team vault has to debit one
rollup and credit the other, and a single-sided recompute would leave the origin permanently
overstated.

---

## 🔐 `files.fn_can_read(p_item_id uuid) → boolean`

`STABLE` · `SECURITY DEFINER`. **The** read predicate — one function, called by the RLS `SELECT`
policy on `files.items` and by the share route, so a read rule cannot be tightened in one place and
left open in the other (the `scheduling` refusal-function precedent).

**Grants a read:**

| Condition                                                                           |
| :---------------------------------------------------------------------------------- |
| `visibility = 'public'`                                                             |
| `owner_user_id = auth.uid()`                                                        |
| `owner_type = 'team'` and `org.is_active_team_member(owner_entity_id)`              |
| `owner_type = 'business'` and `org.is_active_business_member(owner_entity_id)`      |
| `owner_type = 'organisation'` and `org.is_organisation_member(owner_entity_id)`     |
| `bucket_id = 'project'` and `projects.has_project_access({project_id} path anchor)` |

**Does not grant a read, deliberately:** `visibility = 'link'`. The opaque **slug** is the
credential, not the item id. If `link` returned true here, any signed-in user could enumerate every
link-shared asset on the platform with a bare `SELECT * FROM files.items`. The share route resolves
slug → item through `files.fn_resolve_share()`, which takes the slug as **input** and carries the
revoked / expired / exhausted predicate, and only then serves the bytes.

A soft-deleted row (`deleted_at IS NOT NULL`) is never readable. An unparseable project path anchor
returns `false` — a malformed anchor is not an authorization.

---

## 🚦 `files.fn_check_storage_quota()`

`RETURNS trigger` · `SECURITY DEFINER`. `BEFORE INSERT OR UPDATE OF size_bytes ON files.items`.

> ⚠️ **Ships FAIL-OPEN.** While `security.platform_params.storage_quota_enforced` is `false` — its
> seeded value — this function returns without raising. It is the third member of the fail-open
> enforcement family alongside `proposal_allowance_enforced` and `footprint_caps_enforced`. Flipping
> it starts **refusing uploads** on a live tenant and is a deliberate human decision, never a side
> effect of running a migration.

- Returns immediately for `source <> 'supabase'` (mounted and link assets cost us nothing) and for a
  soft-deleted row.
- Resolves the ceiling through `finance.fn_effective_limit(..., 'storage_megabytes')`, so plan ×
  standing × grant resolution and the `NULL = unlimited` convention live in one place.
- **Units.** The entitlement is **mebibytes**; the rollup is **bytes**. The conversion happens here,
  once, and nowhere else. `plan_entitlements.limit_value` is `integer` and 25 GB in bytes is
  26,843,545,600 — an int4 overflow — so the ladder is never denominated in bytes anywhere.
- On `UPDATE` only the **delta** counts as new capacity; on `INSERT` the whole file does.
- Raises `check_violation` when exceeded.

**Known limit, inherited from the same design:** once enforcement is on, the `RAISE` aborts the
transaction and would roll back any denial telemetry written moments earlier in the same statement
(Postgres has no autonomous transactions). A denial under active enforcement must be recorded by the
**app** layer catching the `check_violation`.

---

## 🎟 `files.fn_resolve_share(p_slug text) → TABLE(…)`

`STABLE` · `SECURITY DEFINER` · `EXECUTE` to **`anon`**, `authenticated`, `service_role`.

Resolves a share slug to its target, or returns **nothing**.

```sql
RETURNS TABLE (
  share_id uuid, item_id uuid, folder_id uuid,
  visibility files.file_visibility,
  expires_at timestamptz,
  downloads_remaining integer   -- NULL when download_limit IS NULL (unlimited)
)
```

### It exists instead of an `anon SELECT` policy on `files.share_links`, and that is not stylistic

RLS filters **rows**. It cannot require that the caller **already knew the slug**. Granting `anon`
`SELECT` on the table plus the obvious liveness predicate would let any anonymous visitor run

```sql
SELECT slug FROM files.share_links;
```

through PostgREST and harvest **every live share credential on the platform**. The slug *is* the
credential, so it must be an **input**, never an output of an unfiltered read — an enumerable
credential is not a credential, and revocation becomes meaningless.

Same structural discipline as `integrations.connection_secrets`: RLS on, **no** visitor policy, **no**
visitor table grant, and one sanctioned operation exposed as a definer function. `EXECUTE` to `anon`
grants nothing on its own, because holding it without holding a slug returns zero rows.

### The whole liveness predicate lives here, in one place

```sql
WHERE s.slug = p_slug
  AND s.revoked_at IS NULL
  AND (s.expires_at IS NULL OR s.expires_at > now())
  AND (s.download_limit IS NULL OR s.download_count < s.download_limit)
  AND (s.item_id IS NULL OR EXISTS (
        SELECT 1 FROM files.items i WHERE i.id = s.item_id AND i.deleted_at IS NULL))
```

so a route that forgets to check **cannot resurrect a revoked link**. The last clause is easy to miss
and matters: a share of a **soft-deleted** asset resolves to nothing, because a link outliving its
target would otherwise present as a broken download rather than an honest 404.

### What it does not do

- **It never returns the bytes, and never a signed URL.** Minting a download URL stays a server
  decision so the download can be counted and audited into `files.download_events` — a function that
  handed back a URL would make the audit optional.
- **It does not re-check ownership.** By the time it runs, the slug has already been accepted as the
  credential. That is exactly why the `WITH CHECK` ownership arm on the `share_links` policy is
  load-bearing (see [Policies.md](Policies.md)) — this function will faithfully resolve a **forged**
  link, so forgery has to be impossible at write time.
- **It does not distinguish its failures.** All four failure modes return zero rows. The client-facing
  `ShareResolution` union (`not_found` / `expired` / `revoked` / `exhausted`, in
  `@projective/types/files/sharing.ts`) exists so the **service** can log and meter them; the route
  maps all four to the same 404 with the same body, because telling an anonymous caller *"this link
  expired"* rather than *"no such link"* confirms a link existed — precisely the fact a scanner probes
  for.

---

## 🎲 `files.fn_mint_share_slug() → text`

`VOLATILE` · not definer. Mints the opaque, URL-safe share token.

The slug **is** the credential for a `link`-visibility asset, so it is never derived from the item
id, the filename or a counter — anything guessable would make revocation meaningless.

> **Deviation, deliberate and flagged.** The specification called for `gen_random_bytes(16)`
> (pgcrypto). pgcrypto's home schema is not stable across environments — a from-scratch
> `CREATE EXTENSION pgcrypto` puts it in `public`, hosted Supabase puts it in `extensions` — so no
> single qualified reference works under `SET search_path = ''`, and relaxing the search_path would
> weaken every other function in the file by example. `gen_random_uuid()` is a `pg_catalog` builtin
> backed by the same CSPRNG; two of them yield 244 bits, of which 24 bytes (**192 bits**) are taken
> and base64url-encoded. Strictly more entropy than 128 bits, and portable.

---

## 📈 `finance.fn_footprint_usage` — the `storage_megabytes` branch

Lives in
[`00001220_functions_finance_billing_entitlements.sql`](../../../supabase/migrations/00001220_functions_finance_billing_entitlements.sql),
not here, because it belongs to the entitlement resolver. It reads `files.storage_usage` (the
materialised rollup, never a live `sum()` over `files.items` — that is the cost that only appears
once a tenant succeeds) and returns floored mebibytes. `'freelancer'` is folded to `'user'`: a
freelancer's bytes are their user's bytes, and a second quota key for the same human would
double-count.

`fn_effective_limit`, `fn_has_entitlement` and `fn_footprint_remaining` needed **no** edits — they
are already generic over `finance.entitlement_key`.

See also [Policies.md](Policies.md) · [Tables.md](Tables.md) · [Storage.md](Storage.md).
