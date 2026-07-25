# integrations Schema: Policies

RLS is **always on** for `integrations`. The schema deliberately mixes three postures because it
mixes three kinds of data: **public catalogues**, **secret / operational stores**, and
**user-owned records**.

## Posture at a glance

| Object | RLS | `authenticated` grant | Policy |
| :--- | :-- | :--- | :--- |
| **Public catalogues** | | | |
| `providers` · `extension_points` · `plugin_scopes` | on | `SELECT` | `USING (true)` — reference data |
| **Secret / operational — no policy, service-role only** | | | |
| `user_connections` | on | **none** | **none — definer-only** |
| `connection_secrets` | on | **none** | **none — the token vault** |
| `connection_sync_state` · `webhook_subscriptions` · `webhook_deliveries` | on | **none** | **none** |
| `plugin_grants` | on | **none** | **none — hashed client secrets** |
| **Safe projections (views)** | | | |
| `v_my_connections` | — | `SELECT` | definer view, filtered to `auth.uid()` |
| `v_plugin_catalog` | — | `SELECT` | definer view, filtered to `status = 'published'` |
| **User-owned records** | | | |
| `connection_audit` | on | `SELECT` | own rows or admin |
| `plugins` | on | `SELECT`+`INSERT`+`UPDATE` | published, or own (publisher), or admin |
| `plugin_versions` | on | `SELECT`+`INSERT`+`UPDATE` | published, or own plugin, or admin |
| `plugin_installations` | on | `SELECT`+`INSERT`+`UPDATE` | own (installer) or admin |
| `plugin_audit` | on | `SELECT` | own, or own-plugin publisher, or admin |

## 🔓 Public catalogues

`providers`, `extension_points`, `plugin_scopes` are `USING (true)` for `anon`, `authenticated`.
Labels/capabilities/scopes drive the Settings → Integrations chips and the plugin consent UI, and a
visitor on a public availability page may legitimately see a host uses Zoom. `default_scopes` is
**configuration, not a credential** — nothing is hidden because nothing secret is stored. Writes are
service-role only.

## 🔒 Definer-only, no policy — the connection + vault + operational tables

`user_connections`, `connection_secrets`, `connection_sync_state`, `webhook_subscriptions`,
`webhook_deliveries` and `plugin_grants` have RLS enabled and **no policy, no `authenticated`
grant** — the hidden-ledger posture the core `finance` money tables use. There is no client path to
any of them.

This is **not** an oversight to be "fixed" later with a `user_id = auth.uid()` policy. Such a policy
on `user_connections` would make the connection reachable and re-introduce the very join-to-secrets
risk the split prevents. **Column security here is structural** — the client-facing surface is a
view that cannot name the secret columns — rather than a policy a later edit could weaken. The token
vault (`connection_secrets`) is a step further: it has no view either.

## 👁 `v_my_connections` — the safe connection projection

A **non-`security_invoker`** view: it runs as its owner (so it can read the un-policied base table)
and its `WHERE c.user_id = auth.uid ()` clause scopes each caller to their own rows. Only `SELECT`,
only to `authenticated`. The token vault is a **different table**, so the view cannot project a
token even by accident.

> ⚠️ **Do not add `WITH (security_invoker = true)`** to this view. Under invoker semantics it would
> execute as the caller, who has no privilege on `user_connections`, and every read would fail.

## 🧩 Plugin records — publisher- and installer-scoped

- **`plugins` / `plugin_versions`** — visible when `published`, or to the **publisher**
  (`developer_user_id = auth.uid()` / `fn_is_plugin_publisher`), or an admin. A publisher may
  `INSERT`/`UPDATE` only their own rows (`FOR ALL` with a matching `USING` + `WITH CHECK`). Approval
  transitions (`in_review` → `approved` → `published`) are performed by the review pipeline running
  as service-role, not by the publisher flipping their own `status`.
- **`plugin_installations`** — an installer sees and manages only their own. `INSERT` requires
  `installer_user_id = auth.uid()`; uninstall is a soft `UPDATE` (`status → revoked`), never a
  delete. The consented `granted_scopes` are the gate the Plugin-API mediator enforces at runtime.
- **`plugin_audit`** — read-only for the acting user and the plugin's publisher; every line is
  appended service-side, so a client can't forge an invocation record.

## 👁 `v_plugin_catalog` — the public marketplace

A **definer** view (like `v_my_connections`) with an explicit `WHERE status = 'published'`, so it
exposes only published plugins to everyone without needing base-table grants for `anon`. A publisher
sees their own drafts through the base `plugins` table (their RLS grant), not this catalogue. Granted
`SELECT` to `anon`, `authenticated`.

## 📜 `connection_audit` — own history

`USING (user_id = auth.uid () OR security.is_admin ())`, `SELECT` only. **No write policy** — every
line is appended by the OAuth/sync Edge Function running as service-role, so a consent record can't
be forged or backdated.

## Capability checks never leak secrets

The predicates in [Functions.md](Functions.md) — `fn_has_capability`, `fn_conferencing_provider`,
`fn_plugin_installed`, `fn_plugin_has_scope`, `fn_is_plugin_publisher` — are `SECURITY DEFINER` and
return **only a boolean or a slug**. They are the sanctioned way to ask *"can this user mint a
room?"* or *"may this plugin read messages?"* with no path to the credentials or the other users'
rows that would answer it.

---

See [Tables.md](Tables.md) for the schema and [Functions.md](Functions.md) for the predicates.
