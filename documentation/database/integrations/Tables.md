# integrations Schema: Tables

The `integrations` schema is the platform's **connector + plugin substrate** — a generic provider /
consent / sync framework, not a per-vendor set of tables. Adding a 50th connector is a seed row plus
adapter code, never a schema change. See
[`SYSTEM_ARCHITECTURE.md` §Integration & Plugin Platform](../../architecture/SYSTEM_ARCHITECTURE.md)
for the strategy and roadmap.

> **Zod SSOT:** `packages/types/integrations/*` (`providers.ts`, `connections.ts`, `secrets.ts`,
> `plugins.ts`) mirrors these rows. The migration, the Zod, and this file land together (root
> `CLAUDE.md` §1).

## Two subsystems, one schema

|         | **A. Connectors**                                                                                                                                 | **B. Plugins**                                                                                                             |
| :------ | :------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------- |
| What    | A user's stored authorization to act at a third party                                                                                             | Third-party code injected into governed extension points                                                                   |
| Tables  | `providers`, `consent_states`, `user_connections`, `connection_secrets`, `connection_sync_state`, `webhook_subscriptions`, `webhook_deliveries`, `connection_audit` | `extension_points`, `plugin_scopes`, `plugins`, `plugin_versions`, `plugin_installations`, `plugin_grants`, `plugin_audit` |
| Roadmap | MVP → V2                                                                                                                                          | Post-MVP (schema laid now so the later build is not a rewrite)                                                             |

**Not modelled here, by design:** platform **AUTH** (SSO/OAuth login is GoTrue's; no third-party
token is retained) and platform **INFRA** (Stripe, Maps — server-owned keys behind the service
layer). These are four different runtime/trust models; only the last two live in this schema.

## Read this first: authentication ≠ authorization

|                 | Sign-in OAuth                                                           | Connection OAuth (this schema)                                  |
| :-------------- | :---------------------------------------------------------------------- | :-------------------------------------------------------------- |
| Purpose         | Prove who you are                                                       | Act on your behalf at a third party                             |
| Owner           | GoTrue (`supabase/config.toml`, `apps/web/features/auth/core/oauth.ts`) | This schema                                                     |
| Token retained? | **No**                                                                  | Yes — encrypted, in `connection_secrets`                        |
| Example         | "Sign in with Google"                                                   | "Read my Google free/busy", "sync my Drive", "mint a Meet room" |

The two flows **never** share a token store. A user signed in with Google still grants a calendar
**connection** explicitly, and that connection's token lives in the vault below — never in
`user_connections`.

---

# A. Connector substrate

## 1. `integrations.providers`

The public, non-sensitive catalogue: one row per integrable **vendor**. Reference data — a new
provider is a seed row, not a migration. `slug` is the stable identity that `scheduling.*` and the
connection rows reference.

| Column                                 | Type                | Notes                                                                                                              |
| :------------------------------------- | :------------------ | :----------------------------------------------------------------------------------------------------------------- |
| `slug`                                 | text (PK)           | `google`, `github`, `zoom`, …                                                                                      |
| `label`                                | text                | Display name.                                                                                                      |
| `category`                             | `provider_category` | Coarse UI family (one value): `calendar`/`storage`/`developer`/…                                                   |
| `capabilities`                         | `provider_kind[]`   | Every capability the vendor can offer (multi-valued). `CHECK` non-empty.                                           |
| `auth_scheme`                          | `auth_scheme`       | `oauth2` / `oauth1` / `api_key` / `app_password` / `none`.                                                         |
| `is_enabled`                           | boolean             | Platform kill-switch — a row may exist (so history resolves) while new consents are refused. Default **false**. On its own it offers nothing: an OAuth provider is offered only with this environment's client behind it (Decision #386). |
| `is_beta`                              | boolean             | Surfaces a "beta" chip.                                                                                            |
| `broker`                               | text                | Integration STRATEGY: `direct` / `nylas` / `merge`. Where the adapter routes.                                      |
| `supports_webhooks`                    | boolean             | Whether the provider pushes change notifications (drives `webhook_subscriptions`).                                 |
| `default_scopes`                       | text[]              | Scopes requested at consent time. **Config/documentation only** — no credential.                                   |
| `auth_config`                          | jsonb               | Non-secret OAuth config (`ProviderAuthConfigSchema`), below. **The client secret is never here** — it is in the Environment Variable Contract. |
| `docs_url` · `icon_url` · `sort_order` | text · text · int   | Presentation.                                                                                                      |

### Category vs. capability — two distinct axes

**Category** is the coarse family a vendor is filed under in the UI (one value). **Capability**
(`provider_kind`) is the fine-grained thing a connection is authorized to _do_, and it is the **unit
of consent** — a user may grant `calendar` but not `storage` at the same vendor, so the catalogue
advertises the full array and the connection records the granted subset. Never collapse two
capabilities into one chip.

### `broker` documents the integration strategy

Calendar and conferencing go `direct` (Decision #383, ruling R1), with no third party holding a
connected calendar's tokens. Storage/developer go `direct` too (a unified file API is too leaky to be
worth the per-connection bill). The CRM long tail (`monday`, …) rides a unified broker (`merge`)
where an adapter-per-vendor stops being worth it. `apple` keeps its seeded `nylas`, deferred. **The
broker is always wrapped behind our own adapter interface**, so it stays an implementation detail we
can replace.

### `auth_config` is what a consent needs

`authorize_url`, `token_url`, `revoke_url` (absent for Microsoft, which has no per-grant revoke),
`pkce`, `authorize_params` (Google's `access_type=offline`, `prompt=consent`,
`include_granted_scopes=true`), `token_auth` (`basic` for Zoom, else the form body), `identity_url`
with `identity_id_field` and `identity_label_fields` (who the linked account is), and `kind_scopes`
(which scopes each capability takes, so a consent asks only for what its kinds want and a narrowed
grant records only what it covers). `{tenant}` in Microsoft's URLs is filled from
`MICROSOFT_INTEGRATION_TENANT`. Only `google`, `google_drive`, `outlook` and `zoom` are seeded one, so
no other provider can start a consent yet. `google_drive` omits `include_granted_scopes`, so its token
reaches files only (Decision #394).

### Seeded rows

`google`, `google_drive`, `outlook` (labelled Microsoft: one Entra app and one consent for its calendar
and Teams) and `zoom` ship `is_enabled = true`, and are offered wherever their credentials are set. The
rest ship `false`.
Calendars/conferencing (`google`, `outlook`, `apple`, `samsung`, `calendly`, `zoom`,
`microsoft_teams`, `discord`), storage/docs (`google_drive`, `dropbox`, `onedrive`, `frameio`, `s3`,
`notion`), developer/CRM (`github`, `slack`, `monday`, `google_contacts`). `microsoft_teams` stays as
meeting vocabulary with no consent of its own: Teams rooms mint through the `outlook` connection.
Zoom's scopes are its granular names, to confirm against the registered app. `notion` has no
`calendar` capability (Decision #383, ruling R9). `onedrive` ("OneDrive &
SharePoint", `Files.Read.All` · `offline_access`) and the `frameio` row's Frame.io V4 / Adobe IMS
scopes (`openid` · `email` · `profile` · `offline_access` · `additional_info.roles`) are Decision #313.
Every storage row has a real client in `services/integrations/adapters/` — the five connector
`files.file_source` values, one each. The calendar sources match
`@projective/types/scheduling` `INTEGRATION_SOURCES` — one vocabulary, not two.

## 2. `integrations.user_connections`

One row per **(user, provider, external account)** — a user's stored authorization. `id` is the
identity `scheduling.events` / `scheduling.discovery_calls` reference. **Definer-only** (RLS on, no
policy, no `authenticated` grant); clients read
[`v_my_connections`](#7-integrationsv_my_connections).

| Column                                           | Type                          | Notes                                                                                                                                   |
| :----------------------------------------------- | :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                             | uuid (PK)                     | Referenced by `scheduling.*`.                                                                                                           |
| `user_id`                                        | uuid → `org.users_public`     | CASCADE.                                                                                                                                |
| `provider_slug`                                  | text → `providers`            | RESTRICT — a provider in use can't vanish.                                                                                              |
| `status`                                         | `connection_status`           | The state machine (below).                                                                                                              |
| `granted_kinds`                                  | `provider_kind[]`             | What the consent actually granted — may be narrower than the provider's capabilities.                                                   |
| `granted_scopes`                                 | text[]                        | The scopes actually returned.                                                                                                           |
| `sync_direction`                                 | `sync_direction`              | `inbound` (the default: busy time read from a primary calendar) or `bidirectional` (a separate Projective calendar as well, Decision #383, ruling R3). `integrations.fn_set_sync_direction` is the writer, and a revoke sets it back. `outbound` has no writer. |
| `external_account_id` · `external_account_label` | text                          | **Which** account is linked — modelling it lets one user connect two accounts (personal + work) per provider without a later migration. |
| `broker_account_id`                              | text                          | The Nylas/Merge grant id when a unified broker fronts the provider.                                                                     |
| `config`                                         | jsonb `NOT NULL DEFAULT '{}'` | **Non-secret, per-connection mount settings**, projected to the client through `v_my_connections`. See below.                           |
| `token_expires_at`                               | timestamptz                   | **Cached, non-secret** expiry for the "reconnect soon" UI. Authoritative expiry is in `connection_secrets`.                             |
| `last_synced_at` · `last_error` · `error_count`  | timestamptz · text · int      | Operational state. `last_error` reaches the owner, so it holds a provider's status and code and nothing else.                           |
| `last_used_at`                                   | timestamptz                   | When something last called the provider on this connection (`fn_claim_connection_token`). Keeps the refresh job on it. Not projected by `v_my_connections`. |
| `refresh_claimed_at`                             | timestamptz                   | The refresh job's lease: keeps a second run off a refresh token in flight. Not projected by `v_my_connections`.                         |
| `connected_at` · `revoked_at`                    | timestamptz                   | Lifecycle stamps.                                                                                                                       |
| UNIQUE                                           | —                             | `(user_id, provider_slug, external_account_id)` **NULLS NOT DISTINCT** — two pending rows collapse.                                     |

### `config` — non-secret mount settings, and why it is deliberately client-visible

OAuth returns a **credential**, not a **configuration**. Several storage connectors need per-user
settings the token does not carry and the provider catalogue cannot hold:

| Provider       | What `config` carries (each parsed by its own schema in `@projective/types/integrations`)                                                                    |
| :------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `s3`           | `endpoint` (R2 / MinIO / Wasabi; absent = AWS) · `region` · `bucket` · `prefix` (the tenant boundary) · `pathStyle` · `roleArn` — `S3ConnectionConfigSchema` |
| `google_drive` | `driveId` — a shared drive (its id is its root folder's); absent = My Drive — `GoogleDriveConnectionConfigSchema`                                            |
| `dropbox`      | `rootNamespaceId` — a team space's root, sent as `Dropbox-API-Path-Root`; absent = the member's root — `DropboxConnectionConfigSchema`                       |
| `onedrive`     | `driveId` — a SharePoint document library; absent = the person's OneDrive — `OneDriveConnectionConfigSchema`                                                 |
| `frameio`      | `accountId` plus `projectId` (its root folder is the root) or `workspaceId` (its projects are the root) — `FrameIoConnectionConfigSchema`                    |
| `google` · `outlook` | `outbound_calendar_id` — the separate Projective calendar this connection writes to, set by `fn_set_outbound_calendar` the first time it has something to put there |

`config` is a flat scalar record with no `null` (`v_my_connections` projects scalars only), so an
optional key is **absent**, never `null` — which is why `S3ConnectionConfigSchema.endpoint` is
`.nullish()`: an AWS connection's projected config has no endpoint key at all.

**S3 credentials follow the endpoint (Decision #314).** The schema requires `roleArn` exactly when
`endpoint` is absent:

- **AWS bucket:** `roleArn` is an IAM role ARN in the aws, aws-cn or aws-us-gov partition, and
  `region` must be a real AWS region whose partition matches the ARN's. The connection stores **no
  secret**: the platform principal assumes that role through STS with the external id
  `projective-{connection id}`.
- **S3-compatible endpoint:** `roleArn` is refused, and the connection's key pair is sealed in
  `connection_secrets`.

`region` (`a–z 0–9 -`) and `bucket` (3–63 characters of `A–Z a–z 0–9 . _ -`) are validated as names
in both cases, because on AWS they form the request's hostname.

None of this is **catalogue** config — `providers.auth_config` is global to a provider, while a
bucket and a prefix are per _connection_, and two users of the same provider will have different
ones.

**It lives here rather than in `connection_secrets` for a reason that is about the UI, not
convenience.** `connection_secrets` has RLS on, **no policy, no `authenticated` grant, and no
client-facing view at all** — service-role only. Config placed there would be structurally
unreadable from any client path, which would leave the settings screen unable to answer the most
basic question a user has about a mount: _"which bucket did I actually connect?"_ A connector you
cannot describe is one nobody can debug or trust.

So the split is drawn along **secrecy**, not along "everything about a connection":

- **`user_connections.config`** — what the mount _is_. Projected by
  [`v_my_connections`](#7-integrationsv_my_connections), which the client reads.
- **`connection_secrets`** — what the mount can _do on your behalf_. Ciphertext, envelope-encrypted,
  never projected by anything.

> ⚠️ **Nothing secret may ever be written to `config`.** There is no access key, no secret key, no
> token and no signed URL here — an S3 connection's `aws_secret_access_key` is a
> `connection_secrets` row. This is not a convention a reviewer has to remember: a key written into
> `config` would be handed to the browser by `v_my_connections` **on the very next read**, with no
> policy anywhere in the path capable of stopping it. That is the same class of failure as the
> `files.share_links` slug leak — a value whose only protection is that nobody thought to look.

**Shape (Zod SSOT, `@projective/types/integrations/connections.ts`).** `UserConnectionSchema.config`
is a deliberately **flat scalar record** (`Record<string, string | number | boolean> | null`), not a
nested union of per-provider shapes: it is projected straight out of a `jsonb` column and every
provider wants different keys, so a provider that needs structure parses this against **its own**
schema (`S3ConnectionConfigSchema`) rather than widening the shared one. Widening it would force
every future provider's keys to satisfy every previous provider's schema. The vault's own shape
(`secrets.ts`) is ciphertext, server-only, and appears in no shape a client reads.

### The connection state machine (`connection_status`)

`active` → `degraded` (three failed refreshes or channel renewals; a good refresh heals it) →
`expired` (the refresh job, on `invalid_grant`; needs a fresh consent, and the owner is told) /
`revoked` (**terminal** — the owner, or the provider's `app_deauthorized`) / `disconnected` / `error`.
`pending`, `disconnected` and `error` have no writer today: a consent stores its connection `active`
in one transaction. One account has one row, so a fresh consent reopens an `expired` or `revoked` row.
The settings UI shows a **reconnect** affordance for the recoverable states rather than letting sync
silently die — a dead token that stops syncing without telling anyone is the classic
connector-platform support fire.

## 2a. `integrations.consent_states`

The in-flight consent: one row per started authorization, spent exactly once when the provider
redirects back. The `state` is the credential the callback presents, so nothing client-facing reads
this table; a client writes a row only through `fn_open_consent`, which binds it to `auth.uid()`.

| Column                       | Type                      | Notes                                                                                 |
| :--------------------------- | :------------------------ | :------------------------------------------------------------------------------------- |
| `state`                      | text (PK)                 | At least 22 characters (`ck_consent_state_entropy`).                                  |
| `user_id` · `provider_slug`  | uuid · text               | Who consented, and to whom. CASCADE · RESTRICT.                                       |
| `code_verifier`              | text                      | The PKCE verifier. NULL where `auth_config.pkce` is false.                            |
| `requested_kinds`            | `provider_kind[]`         | Compared with what the grant covered, to record a narrowed consent.                   |
| `return_to`                  | text                      | A same-origin path (`ck_consent_return_to_relative`); the callback lands there.       |
| `expires_at` · `consumed_at` | timestamptz               | A 10-minute window, and the single-use stamp. The sweep drops a row a day past it.    |

## 3. `integrations.connection_secrets` — the token vault

Split from the connection so the security story is **structural, not a policy**: RLS on, **no
policy, no view, no `authenticated` grant** — service-role only.

| Column                                                             | Type         | Notes                                                                                   |
| :----------------------------------------------------------------- | :----------- | :--------------------------------------------------------------------------------------- |
| `connection_id`                                                    | uuid (PK)    | → `user_connections` (CASCADE).                                                         |
| `access_token_cipher` · `refresh_token_cipher` · `api_secret_cipher` | bytea      | ⚠️ **Ciphertext only, never plaintext.** `api_secret_cipher` is an S3-compatible secret or an API key. |
| `nonce` · `refresh_token_nonce` · `api_secret_nonce`               | bytea        | One nonce per ciphertext; `nonce` is the access token's. `ck_secret_nonces` refuses a cipher without its nonce. |
| `wrapped_dek` · `wrapped_dek_nonce`                                | bytea        | The row's data key under `ENCRYPTION_KEY`, and that wrap's own nonce. Both required.    |
| `key_id`                                                           | text         | `env:` + the first 8 hex of sha256(the key). A row under any other key refuses to open. |
| `token_type` · `encryption_alg`                                    | text         | Usually `bearer` · `aes-256-gcm`.                                                       |
| `access_token_expires_at` · `refresh_token_expires_at`             | timestamptz  | Authoritative expiries.                                                                 |
| `rotated_at`                                                       | timestamptz  | Last key rotation. No writer yet: there is no rewrap.                                   |

> ⚠️ **Envelope encryption under `ENCRYPTION_KEY`** (Decision #343, ruling C4 (c)). Each write of a row
> mints a fresh data key, wrapped by the env key `key_id` names, and each token is sealed under it with
> the AAD `<connection_id>|<kind>|<key_id>` (`token-vault.ts`; providers spec §9.4). The Zod SSOT holds
> this row as ciphertext only (`secrets.ts`), server-only — it is unreachable from every client path.

## 4. `integrations.connection_sync_state`

Per-resource sync cursors — the delta tokens that make **incremental** sync possible (Google
`syncToken`, Microsoft `deltaLink`, an opaque page cursor). One connection may sync several
resources (primary + shared calendar; drive root + a folder), each with its own cursor. Service-role
only.

| Column                                                    | Type                      | Notes                                         |
| :-------------------------------------------------------- | :------------------------ | :-------------------------------------------- |
| `connection_id`                                           | uuid → `user_connections` | CASCADE.                                      |
| `resource`                                                | text                      | `calendar:primary`, `drive:root`, `contacts`. |
| `kind`                                                    | `provider_kind`           | Which capability this resource serves.        |
| `sync_token`                                              | text                      | The provider delta cursor.                    |
| `full_sync_completed_at` · `last_delta_at` · `last_error` | timestamptz · text        | Progress.                                     |
| `due_at`                                                  | timestamptz               | A verified push sets this and nothing else; the read happens in the job. |
| `claimed_at`                                              | timestamptz               | A run reading this resource, a 10-minute lease. The stamp a read must still hold for its result to land. |
| UNIQUE                                                    | —                         | `(connection_id, resource)`.                  |

## 5. `integrations.webhook_subscriptions`

Provider **push** channels. A provider's change notifications require a registered channel that
**expires and must be re-registered before `expires_at`** — miss the window and sync silently stops,
so the expiry is a first-class, indexed column a renewal cron sweeps (`status = 'expiring'`).
Service-role only.

| Column                                                   | Type                      | Notes                                                                     |
| :------------------------------------------------------- | :------------------------ | :------------------------------------------------------------------------ |
| `connection_id`                                          | uuid → `user_connections` | CASCADE.                                                                  |
| `provider_slug` · `resource`                             | text                      | What is watched.                                                          |
| `external_channel_id` · `external_resource_id`           | text                      | The provider's channel identifiers; a push names its channel by the first. |
| `verification_token`                                     | text                      | The per-channel secret a push must present (Google's channel token, Graph's `clientState`), compared in constant time. Not a user credential. |
| `callback_url`                                           | text                      | Where the provider posts.                                                 |
| `status`                                                 | `webhook_status`          | `active` / `expiring` / `expired` / `failed`.                             |
| `expires_at`                                             | timestamptz               | **THE renewal driver** (indexed).                                         |
| `last_renewed_at` · `last_delivery_at` · `failure_count` | timestamptz · int         | Operational.                                                              |
| UNIQUE                                                   | —                         | `(connection_id, resource)`.                                              |

## 6. `integrations.webhook_deliveries`

The **idempotency ledger** for inbound provider pushes. Providers redeliver and reorder; this table
dedupes on the provider's own delivery id and records whether the signature verified, so a replayed
or forged push can't double-process. Same discipline as `comms.delivery_events`. Service-role only.

| Column                                   | Type                           | Notes                                        |
| :--------------------------------------- | :----------------------------- | :------------------------------------------- |
| `subscription_id`                        | uuid → `webhook_subscriptions` | SET NULL.                                    |
| `provider_slug` · `external_delivery_id` | text                           | **UNIQUE together — the idempotency key.**   |
| `signature_verified`                     | boolean                        | Whether the push authenticated.              |
| `status` · `payload_digest` · `error`    | text                           | `received`/`processed`/`failed`/`duplicate`. |
| `received_at` · `processed_at`           | timestamptz                    | Timing.                                      |

A row is written only by a delivery that verified, in the same SQL call as its effect
(`fn_claim_webhook_delivery`), so a forged push leaves none, a replay is a 2xx no-op, and a failed
effect leaves no claim to swallow the redelivery. Today `status` is always `processed`.

## 7. `integrations.v_my_connections`

The **only** connection shape a client sees: a non-`security_invoker` view (runs as owner, reads the
un-policied base table) filtered to `user_id = auth.uid()`, joined to `providers` for label /
category / capabilities. Token columns live on a **different table** this view never joins. Granted
`SELECT` to `authenticated`; mirrored by `UserConnectionSchema`.

It projects the connection's identity and operational state — `status`, `granted_kinds` /
`granted_scopes`, `sync_direction`, the external account, **`config`** (the non-secret mount
settings above), the cached `token_expires_at`, `last_synced_at` / `last_error` / `error_count`, and
the lifecycle stamps.

> **Column safety here is structural, not a policy.** The view is safe to expose _precisely because_
> the credentials are in a table it cannot reach — not because someone remembered to omit a column
> from the `SELECT` list. A projection that had to be kept correct by review would eventually be
> extended by someone adding `c.*`. Adding a token column to `user_connections` itself would defeat
> this, which is why the vault was split off in the first place.

## 8. `integrations.connection_audit`

The consent trail — _"when did I grant this, and what has happened since?"_ Denormalised
`provider_slug` so a line reads standalone; `action` is the `connection_action` enum (`connected` /
`refreshed` / `refresh_failed` / `scope_changed` / `sync_*` / `webhook_*` / `revoked` / …). `detail`
carries human context but **never a token or PII** beyond the account label.

---

# B. Plugin ecosystem

Post-MVP by roadmap, laid down now so the later build is not a rewrite. The trust model is
**adversarial** (Figma/Shopify, **not** Obsidian): third-party code never runs in the host origin
(sandboxed iframe / declarative), and every data touch is mediated against consented capability
scopes.

## 9. `integrations.extension_points`

The **slot registry** — the catalogue of surfaces a plugin may inject into, and the first-party
counterpart of the app's own URL-keyed slot resolvers (`channelHeaderFor`, `laneFor`,
`middleNavFooterFor`). A plugin can only target a `key` that exists and is enabled. Reference data.

| Column                  | Type               | Notes                                                |
| :---------------------- | :----------------- | :--------------------------------------------------- |
| `key`                   | text (PK)          | `messages.tab`, `project.panel`, `dashboard.widget`. |
| `surface`               | `plugin_surface`   | `page_tab` / `panel` / `dashboard_widget` / …        |
| `label` · `description` | text               | Presentation.                                        |
| `allowed_runtimes`      | `plugin_runtime[]` | Which runtimes may render into this slot.            |
| `is_enabled`            | boolean            | Platform gate.                                       |

## 10. `integrations.plugin_scopes`

The Plugin-API **permission vocabulary as data** — `read:messages`, `write:files`, `read:calendar`.
A version requests a subset; the user consents; the host mediates every call against the
installation's granted set. Kept a table (not an enum) so a new capability is a seed row. `risk`
(`low`/`medium`/`high`) drives consent-UI emphasis. **This is the same consent machinery as
connection scopes** — a plugin is a first-party OAuth client with extra UI rights.

## 11. `integrations.plugins`

The developer **registry**: one row per plugin, hosted from a GitHub repo, connected through the
Developer Kit. `install_count` is a trigger-maintained counter. The currently-published version is
**derived** (see `v_plugin_catalog`), not a stored back-pointer, to avoid a circular FK with
`plugin_versions`.

| Column                                                                   | Type                      | Notes                                                                          |
| :----------------------------------------------------------------------- | :------------------------ | :----------------------------------------------------------------------------- |
| `id`                                                                     | uuid (PK)                 |                                                                                |
| `slug`                                                                   | text UNIQUE               | `email-suite`.                                                                 |
| `name` · `tagline` · `description`                                       | text                      | Listing copy.                                                                  |
| `developer_user_id`                                                      | uuid → `org.users_public` | SET NULL — the publisher.                                                      |
| `developer_name` · `homepage_url` · `repo_url` · `icon_url` · `category` | text                      | Presentation + source.                                                         |
| `status`                                                                 | `plugin_status`           | `draft`→`submitted`→`in_review`→`approved`→`published`→`suspended`/`delisted`. |
| `runtime`                                                                | `plugin_runtime`          | `iframe` (zero-trust default) / `declarative` / `headless`.                    |
| `is_verified`                                                            | boolean                   | First-party / reviewed badge.                                                  |
| `install_count`                                                          | int                       | Trigger-maintained.                                                            |

## 12. `integrations.plugin_versions`

An immutable, reviewable version. The `manifest` (jsonb) is the source of truth for what the version
contributes (targeted extension points, requested scopes, entry points); `bundle_url` serves the
sandboxed bundle from a **separate origin** and `bundle_integrity` is its SRI hash; `source_commit`
pins the GitHub commit.

| Column                                               | Type                    | Notes                                        |
| :--------------------------------------------------- | :---------------------- | :------------------------------------------- |
| `plugin_id`                                          | uuid → `plugins`        | CASCADE.                                     |
| `semver`                                             | text                    | UNIQUE with `plugin_id`.                     |
| `status`                                             | `plugin_version_status` | `draft`→…→`published`/`deprecated`/`yanked`. |
| `runtime`                                            | `plugin_runtime`        | May narrow the plugin default.               |
| `manifest`                                           | jsonb                   | `{ surfaces[], scopes[], config }`.          |
| `bundle_url` · `bundle_integrity` · `source_commit`  | text                    | The served bundle + provenance.              |
| `requested_scopes`                                   | text[]                  | Keys into `plugin_scopes`.                   |
| `min_platform_version` · `changelog` · `reviewed_by` | text · text · uuid      | Review metadata.                             |
| `submitted_at` · `approved_at` · `published_at`      | timestamptz             | Review lifecycle.                            |

## 13. `integrations.plugin_installations`

A user's (or workspace's) install with the consented scope set. `install_scope` + `owner_id` mirror
the platform owner axis (personal vs a team/business/enterprise vault); `version_id` is the pinned version.
Uninstall is soft (`status = revoked`).

| Column                       | Type                      | Notes                                                                                   |
| :--------------------------- | :------------------------ | :-------------------------------------------------------------------------------------- |
| `plugin_id`                  | uuid → `plugins`          | RESTRICT.                                                                               |
| `version_id`                 | uuid → `plugin_versions`  | RESTRICT — the pinned version.                                                          |
| `installer_user_id`          | uuid → `org.users_public` | CASCADE.                                                                                |
| `install_scope` · `owner_id` | `install_scope` · uuid    | `user` (personal) or a team/business/enterprise vault.                                         |
| `status`                     | `install_status`          | `active` / `disabled` / `revoked`.                                                      |
| `granted_scopes`             | text[]                    | The scopes the installer **actually consented to** (a subset of the version's request). |
| `config` · `auto_update`     | jsonb · boolean           | Per-install config.                                                                     |
| UNIQUE                       | —                         | `(plugin_id, installer_user_id, install_scope, owner_id)` NULLS NOT DISTINCT.           |

## 14. `integrations.plugin_grants`

OAuth-client-style credentials for **headless/automation** plugins that call the Plugin API
server-to-server. The secret is stored **hashed** (never ciphertext-decryptable, never plaintext) —
a leaked row can't be replayed. Service-role only.

| Column                                                  | Type                          | Notes                     |
| :------------------------------------------------------ | :---------------------------- | :------------------------ |
| `installation_id`                                       | uuid → `plugin_installations` | CASCADE.                  |
| `client_id`                                             | text UNIQUE                   | Public identifier.        |
| `secret_hash`                                           | text                          | **Hashed** client secret. |
| `scopes` · `last_used_at` · `expires_at` · `revoked_at` | text[] · timestamptz          | Grant state.              |

## 15. `integrations.plugin_audit`

The install/consent/invocation trail — the plugin counterpart of `connection_audit`. `action` is the
`plugin_action` enum (`installed`/`updated`/`scope_granted`/`scope_revoked`/`invoked`/`api_call`/…).

## 16. `integrations.v_plugin_catalog`

The public marketplace listing: each **published** plugin joined (LATERAL) to its latest published
version. A **definer** view (like `v_my_connections`) with an explicit `WHERE status = 'published'`
filter, so it is safe to expose to `anon` without granting the base tables — a publisher sees their
own drafts through the base table (their RLS grant), not this catalogue. Granted `SELECT` to `anon`,
`authenticated`; mirrored by `PluginCatalogEntrySchema`.

---

## Enums added

```sql
CREATE TYPE integrations.provider_kind         AS ENUM ('calendar','conferencing','freebusy','storage','docs','contacts','code','issues','crm','messaging','identity','payments');
CREATE TYPE integrations.provider_category     AS ENUM ('identity','payments','calendar','conferencing','storage','productivity','developer','crm','communication','automation');
CREATE TYPE integrations.auth_scheme           AS ENUM ('oauth2','oauth1','api_key','app_password','none');
CREATE TYPE integrations.connection_status     AS ENUM ('pending','active','degraded','expired','revoked','disconnected','error');
CREATE TYPE integrations.sync_direction        AS ENUM ('inbound','outbound','bidirectional');
CREATE TYPE integrations.webhook_status        AS ENUM ('active','expiring','expired','failed');
CREATE TYPE integrations.connection_action     AS ENUM ('connected','reconnected','refreshed','refresh_failed','scope_changed','sync_started','sync_completed','sync_failed','webhook_registered','webhook_renewed','webhook_expired','expired','revoked','error','synced');
CREATE TYPE integrations.plugin_status         AS ENUM ('draft','submitted','in_review','approved','published','suspended','delisted');
CREATE TYPE integrations.plugin_version_status AS ENUM ('draft','submitted','in_review','approved','published','deprecated','yanked');
CREATE TYPE integrations.plugin_runtime        AS ENUM ('iframe','declarative','headless');
CREATE TYPE integrations.plugin_surface        AS ENUM ('page_tab','panel','dashboard_widget','sidebar_item','command','settings_section','automation_action');
CREATE TYPE integrations.install_status        AS ENUM ('active','disabled','revoked');
CREATE TYPE integrations.install_scope         AS ENUM ('user','team','business','enterprise');
CREATE TYPE integrations.scope_risk            AS ENUM ('low','medium','high');
CREATE TYPE integrations.plugin_action         AS ENUM ('installed','updated','enabled','disabled','uninstalled','scope_granted','scope_revoked','version_pinned','invoked','api_call','error');
```

## Consumed by

`scheduling.events.source_connection_id` (mirrored external blocks) and
`scheduling.discovery_calls.provider_slug` / `connection_id`. See
[../scheduling/Tables.md](../scheduling/Tables.md).

See [Policies.md](Policies.md) for RLS and [Functions.md](Functions.md) for the predicates.
