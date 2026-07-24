# integrations Schema: Tables

The `integrations` schema holds **third-party OAuth connections and app installations**. It was
declared in `0001_init_schemas.sql` and described in [../Schemas.md](../Schemas.md) from the start,
but stayed **empty until 2026-07-24** — migration `20260724101000_integrations_connections.sql`
adds its first tables.

> **Zod SSOT:** `packages/types/integrations/connections.ts` mirrors these rows. **Additive Rule:**
> the schema existed but had no objects; nothing was altered (root `CLAUDE.md` §1). This file
> documents the **real migrated schema only** (`database/CLAUDE.md`).

## Read this first: authentication ≠ authorization

| | Sign-in OAuth | Connection OAuth (this schema) |
| :--- | :--- | :--- |
| Purpose | Prove who you are | Act on your behalf at a third party |
| Owner | GoTrue (`supabase/config.toml`, `apps/web/features/auth/core/oauth.ts`) | This schema |
| Token retained? | **No** | Yes — encrypted |
| Example | "Sign in with Google" | "Read my Google free/busy", "mint me a Meet room" |

The two flows must **never** be conflated or share a token store. A user signed in with Google still
has to grant a calendar connection explicitly.

## Security posture

`integrations.user_connections` is **definer-only** — RLS enabled, **no policy, no `authenticated`
grant** — the same hidden-ledger posture the core `finance` money tables use. Clients read
[`integrations.v_my_connections`](#integrationsv_my_connections), a view that physically cannot
project a token column. The safety is **structural, not a policy** that could be mis-edited later.

> ⚠️ **No plaintext secrets, ever.** `access_token_cipher` / `refresh_token_cipher` hold ciphertext
> produced in an Edge Function with `ENCRYPTION_KEY` (`SYSTEM_ARCHITECTURE.md` §Environment Variable
> Contract) — the same posture as PII in `PRODUCT_SPEC.md` §Data Privacy & The "Vault". The Zod SSOT
> deliberately has **no field for either column**.

---

## 1. `integrations.providers`

The public, non-sensitive catalogue: one row per integrable third party. Reference data, not user
data — a new provider is a **seed row**, not a migration plus a type change.

| Column           | Type                             | Notes                                                              |
| :--------------- | :------------------------------- | :------------------------------------------------------------------- |
| `slug`           | text                             | PK (`google`, `zoom`, …).                                           |
| `label`          | text                             | Display name.                                                       |
| `capabilities`   | `integrations.provider_kind[]`   | `{calendar}` / `{conferencing}` / both. `CHECK` non-empty.          |
| `is_enabled`     | boolean                          | Platform kill-switch — a row may exist (so historical connections resolve) while new consents are off. Default `false`. |
| `default_scopes` | text[]                           | Scopes requested at consent time. **Config/documentation only** — no credential ever lands here. |
| `docs_url`       | text                             | Where an operator finds the provider's wiring docs.                 |

### Why `capabilities` is an array

**Calendar sync and conferencing are two genuinely different axes** and must not be collapsed into
one chip set. But a provider can be capable of both — Google mints a Meet room *through* the
Calendar API — so the catalogue carries an array rather than duplicating `google` into two rows that
would demand two separate OAuth consents for one grant.

### Seeded rows

| Slug              | Capabilities                | Enabled |
| :---------------- | :-------------------------- | :------ |
| `google`          | `calendar`, `conferencing`  | false   |
| `outlook`         | `calendar`, `conferencing`  | false   |
| `apple`           | `calendar`                  | false   |
| `samsung`         | `calendar`                  | false   |
| `notion`          | `calendar`                  | false   |
| `zoom`            | `conferencing`              | false   |
| `microsoft_teams` | `conferencing`              | false   |
| `discord`         | `conferencing`              | false   |

The five calendar sources match `@projective/types/scheduling` `INTEGRATION_SOURCES` exactly — one
vocabulary, not two. **All ship disabled**: enabling one is an operator decision that requires
credentials to exist first.

---

## 2. `integrations.user_connections`

One row per `(user, provider)` — the stored authorization. **Definer-only.**

| Column                                        | Type                             | Notes                                                          |
| :-------------------------------------------- | :------------------------------- | :--------------------------------------------------------------- |
| `id`                                          | uuid                             | PK.                                                             |
| `user_id`                                     | uuid                             | FK → `org.users_public` (CASCADE).                              |
| `provider_slug`                               | text                             | FK → `providers` (RESTRICT — a provider in use can't vanish).   |
| `status`                                      | `integrations.connection_status` | `active` / `expired` / `revoked` / `error`.                     |
| `granted_kinds`                               | `provider_kind[]`                | What the consent actually granted — may be narrower than the provider's capabilities. |
| `granted_scopes`                              | text[]                           | The scopes actually returned.                                   |
| `external_account_id` · `external_account_label` | text                          | *Which* account is linked (usually an email), so the settings UI can say so. Visible only to its owner. |
| `access_token_cipher` · `refresh_token_cipher` | text                            | ⚠️ **Ciphertext only.** Never selected by any client path.      |
| `token_expires_at` · `last_synced_at` · `last_error` · `revoked_at` | timestamptz · text | Operational state.                       |
| UNIQUE                                        | —                                | `(user_id, provider_slug)`.                                     |

`expired` is recoverable by a token refresh; `revoked` is terminal for that row and needs a fresh
consent. Nothing is hard-deleted (root `CLAUDE.md` §5).

---

## 3. `integrations.v_my_connections`

The **only** connection shape a client ever sees: a non-`security_invoker` view (so it runs as its
owner and can read the un-policied base table) filtered to `user_id = auth.uid()`, joined to
`providers` for the label and capabilities. Token columns are simply **not selected**.

Granted `SELECT` to `authenticated`. Mirrored by `UserConnectionSchema` in the Zod SSOT.

---

## 4. `integrations.connection_audit`

The consent trail, so a user can answer *"when did I grant this, and what has happened since?"*

| Column          | Type                             | Notes                                                                  |
| :-------------- | :------------------------------- | :----------------------------------------------------------------------- |
| `connection_id` | uuid                             | FK → `user_connections` **SET NULL** — the trail outlives a replaced row. |
| `user_id`       | uuid                             | FK → `org.users_public` (CASCADE).                                       |
| `provider_slug` | text                             | Denormalised, so the line reads standalone.                              |
| `action`        | `integrations.connection_action` | `connected` / `refreshed` / `scope_changed` / `expired` / `revoked` / `error` / `synced`. |
| `detail`        | text                             | Human context — **no tokens, no PII** beyond the account label.          |

---

## Enums added

```sql
CREATE TYPE integrations.provider_kind      AS ENUM ('calendar', 'conferencing');
CREATE TYPE integrations.connection_status  AS ENUM ('active', 'expired', 'revoked', 'error');
CREATE TYPE integrations.connection_action  AS ENUM ('connected','refreshed','scope_changed','expired','revoked','error','synced');
```

## Consumed by

`scheduling.events.source_connection_id` (mirrored external blocks) and
`scheduling.discovery_calls.provider_slug` / `connection_id` (which connection minted the room). See
[../scheduling/Tables.md](../scheduling/Tables.md).

See [Policies.md](Policies.md) for RLS and [Functions.md](Functions.md) for the capability
predicates.
