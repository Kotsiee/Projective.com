# integrations Schema: Functions

Capability/authorization **predicates**, the connector runtime's **doors**, and maintenance
**triggers**. Every predicate is `SECURITY DEFINER` (so it can read the definer-only tables) and
returns **only a boolean or a slug** — the sanctioned way to ask an authorization question with no
path to the credentials or other users' rows that answer it. Functions live in `00001500`; their
triggers in `00001870`.

---

## Connector capability predicates

### `fn_has_capability(p_user uuid, p_kind integrations.provider_kind) → boolean`

Does the user hold an **active** connection granting that capability?

```sql
SELECT EXISTS (
    SELECT 1 FROM integrations.user_connections c
    WHERE c.user_id = p_user
      AND c.status = 'active'
      AND p_kind = ANY (c.granted_kinds)
);
```

Tests `granted_kinds` (what the consent actually returned), **not** the provider's `capabilities`
(what it could in principle do). A user who connected Google for calendar only does not thereby get
conferencing or storage. `STABLE`. `EXECUTE` → `authenticated`.

### `fn_conferencing_provider(p_user uuid) → text`

Which provider slug should mint a meeting room for this user right now — the most recently updated
active conferencing connection — or **NULL** when none is connected. NULL is a normal answer, not an
error: the caller falls back to `scheduling.call_settings.preferred_provider_slug`, a platform room,
or a manual link. **A discovery call stays bookable by someone who has connected nothing**
(`PRODUCT_SPEC.md` §Discovery & Courtesy Calls). `STABLE`. `EXECUTE` → `authenticated`.

---

## The connector runtime's doors

The app makes the network calls (Fresh routes plus pg_cron `http` jobs, Decision #343, ruling C4 (a))
and each function here is one SQL call, so a connection, its sealed tokens and its audit line land or
fail together. All live in `00001500`, run `SECURITY DEFINER` with `search_path = ''`, and are the
**service role's alone** unless noted. None sees a plaintext: `p_secret` is the envelope
`token-vault.ts` sealed, keyed by column (`SealedSecretSchema`), with each `bytea` as `\x` hex. A
proof: `supabase/probes/integrations_runtime.sql`.

| Function                                                                                                                                                                                                             | Does                                                                                                                                                                                                                                                                                                                          |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn_open_consent(p_state, p_provider_slug, p_code_verifier, p_requested_kinds, p_return_to) → timestamptz`                                                                                                           | **`EXECUTE` → `authenticated`.** The one client door: it runs under the caller's JWT, so a consent binds to `auth.uid()` and never to what a cookie claims. Sets the 10-minute window itself and answers it.                                                                                                                  |
| `fn_sweep_consent_states() → integer`                                                                                                                                                                                | Deletes consents a day past their window (`integrations-consent-sweep`).                                                                                                                                                                                                                                                      |
| `fn_store_connection(p_connection_id, p_user_id, p_provider_slug, p_external_account_id, p_external_account_label, p_granted_kinds, p_granted_scopes, p_access_expires_at, p_refresh_expires_at, p_secret) → uuid`   | Stores a consent: `user_connections`, `connection_secrets` and a `connected` or `reconnected` line. Each ciphertext's AAD names the connection, so an account already linked under another id writes nothing and answers that id, for the caller to seal again. A fresh consent reopens an `expired` or `revoked` row. A consent with `freebusy` puts the calendar in the read queue; a reconnect without it drops the cursor and archives the busy rows, removing their details. |
| `fn_claim_connections_for_refresh(p_limit) → jsonb`                                                                                                                                                                  | Claims the connections due (providers spec §7.6), `SKIP LOCKED`, each with its sealed row and its provider's `auth_config`. `refresh_claimed_at` is a 5-minute lease.                                                                                                                                                         |
| `fn_commit_refresh(p_connection_id, p_read_cipher, p_secret, p_access_expires_at, p_refresh_expires_at) → boolean`                                                                                                   | Lands a refresh, only if the row still holds `p_read_cipher`, the refresh token that run spent. Heals the connection to `active` and clears the lease.                                                                                                                                                                        |
| `fn_record_refresh_failure(p_connection_id, p_read_cipher, p_invalid_grant, p_detail) → text`                                                                                                                        | `invalid_grant` sets `expired` and sends `integration.reconnect_required`; anything else counts, and the third in a row sets `degraded`. A failure about a token the row no longer holds is ignored (`NULL`). `p_detail` reaches the owner as `last_error`, so it carries a provider's status and code and nothing else.      |
| `fn_claim_channels_for_renewal(p_limit) → jsonb`                                                                                                                                                                     | Claims the push channels within 24 hours of lapsing, `SKIP LOCKED`, marking each `expiring`, each with its connection's sealed row. A run that died leaves one claimable after 30 minutes.                                                                                                                                    |
| `fn_record_channel_renewal(p_subscription_id, p_renewed, p_expires_at, p_external_channel_id, p_external_resource_id) → text`                                                                                        | Stores what the provider answered. A failure counts, and the third fails the channel and degrades its connection.                                                                                                                                                                                                             |
| `fn_claim_connection_token(p_connection_id) → jsonb` | A token to call a provider with now, for work that cannot wait for the refresh job (minting a room, reading a meeting's record). Stamps `last_used_at`, which keeps the job on the connection. The stored token with two minutes left; otherwise a lease to refresh it (`refresh`), or `busy` while another run holds one. `NULL` for a connection that cannot give one. Service role only. |
| `fn_record_presence_delivery(p_provider, p_meeting_id, p_action, p_at, p_event_key, p_participant_key, p_email, p_registrant_id, p_account_id) → jsonb`                                                                                                        | Claims the delivery and calls `scheduling.record_presence` in one SQL call: a replay answers `replayed` with no effect, and a failed effect leaves no claim to swallow the redelivery.                                                                                                                                          |
| `fn_revoke_connection(p_connection_id, p_detail) → boolean`                                                                                                                                                          | The revoke-on-disconnect door, and the one account erasure calls. Deletes the secret row, sets `revoked`, expires the connection's channels, archives its busy rows (`scheduling.events` by `source_connection_id`: `status = 'cancelled'`, `archived_at`), removes their `connected_event_details`, deletes its read cursor and mirror queue, and puts `sync_direction` back to `inbound` with `outbound_calendar_id` forgotten. `false` when nothing was left to close. The provider is told by the app, after this commits. |
| `fn_deauthorize_connection(p_provider_slug, p_external_account_id, p_delivery_id) → integer`                                                                                                                         | A provider says the app was removed (Zoom's `app_deauthorized`): claims the delivery, then revokes that account's connections.                                                                                                                                                                                                |
| `fn_write_secret(…)` · `fn_claim_webhook_delivery(p_provider_slug, p_external_delivery_id)`                                                                                                                          | **Internal, no role may call them**, like `finance.fn_claim_stripe_event`. A `webhook_deliveries` row exists only for a delivery that verified.                                                                                                                                                                               |

**A refresh cannot share one transaction with its read.** The exchange is a network call, and
PostgREST holds no transaction across two calls. The lease keeps a second run off a refresh token in
flight, and the conditional commit lands the rotated token atomically or not at all, which is the
guarantee a held transaction would give. A crash after the provider rotates and before the commit
strands the connection either way: its next refresh answers `invalid_grant`, and its owner reconnects.

### Calendar sync (Decision #383, ruling R3)

Two one-way flows. All live in `00001500`, and all are the service role's. A proof:
`supabase/probes/calendar_sync.sql`. The outbound half's queue doors are `scheduling.*`, in
[`scheduling/Functions.md`](../scheduling/Functions.md) §7g.

| Function                                                                                                                         | Does                                                                                                                                                                                                                                                                                         |
| :------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn_claim_calendar_syncs(p_limit) → jsonb`                                                                                       | Claims the calendars a push marked due or an hour unread, `SKIP LOCKED`, under a 10-minute lease. `cursor` is `null` when the read must be full: no cursor yet, or a week since the last full read. `has_channel` says whether to open a push channel. Answers no sealed token.                  |
| `fn_apply_busy_sync(p_connection_id, p_resource, p_claimed_at, p_full, p_busy, p_gone, p_cursor) → boolean`                      | Lands one read in one transaction, keyed on `uq_event_external`, only while the run still holds its claim and the connection is open. A busy row is `kind = status = 'busy'`, `title = ''`, `is_masked`, and carries a span and nothing else. What it says lands in `scheduling.connected_event_details` (trimmed, cut to fit, blank is NULL; a rule that is not one or a link that is not https is dropped, and a read that got no rule keeps the one held; Decision #387). A full read archives what it did not see, otherwise `p_gone` names what went, and an archive removes the details. Opens a person's schedule if they have none. Heals the connection. |
| `fn_release_calendar_sync(p_connection_id, p_resource, p_claimed_at, p_error) → void`                                            | Gives a claim back. No error counts nothing; an error counts as a refresh failure does, and the third in a row sets `degraded`. `p_error` reaches the owner, so it is a provider's status and nothing else.                                                                                  |
| `fn_register_channel(p_connection_id, p_resource, p_external_channel_id, p_external_resource_id, p_verification_token, p_callback_url, p_expires_at) → boolean` | Records a channel the provider just opened, taking over any row for that resource, with a `webhook_registered` line. `false` on a connection that closed meanwhile.                                                                                                                        |
| `fn_mark_calendar_due(p_provider_slug, p_channel, p_renew) → boolean`                                                            | A verified push. Marks the calendar due and stamps the delivery, and that is all, so a replay changes nothing and no `webhook_deliveries` row is claimed. `p_renew` brings the channel's lapse forward, for the renewal job.                                                                  |
| `fn_set_sync_direction(p_connection_id, p_direction) → boolean`                                                                  | Turns the Projective calendar on (`scheduling.fn_open_event_mirrors` queues upcoming events and calls) or off (every copy is queued, and the job removes it), with a `scope_changed` line. The caller has proved the connection is the owner's.                                                        |
| `fn_set_outbound_calendar(p_connection_id, p_calendar_id) → text`                                                                | Stores the calendar's id in `config`. The first id wins and is the answer.                                                                                                                                                                                                                   |
| `fn_reset_outbound_calendar(p_connection_id) → void`                                                                             | The person deleted the calendar at the provider: forgets it, drops the mirror rows and queues upcoming events and calls again.                                                                                                                                                                         |

---

## Plugin authorization predicates

### `fn_plugin_installed(p_plugin uuid) → boolean`

Is this plugin **active-installed** for the current user (`auth.uid()`)? The gate a host surface
checks before rendering a plugin's contributed slot. `SECURITY DEFINER`, `STABLE`.

### `fn_plugin_has_scope(p_plugin uuid, p_scope text) → boolean`

Has the current user's active installation been granted a given capability scope? **This is the gate
the Plugin-API mediator checks before honouring a plugin's data request** — a plugin that never
received `read:messages` cannot read a message, regardless of what its manifest asked for.
`SECURITY DEFINER`, `STABLE`.

### `fn_is_plugin_publisher(p_plugin uuid) → boolean`

Does the current user publish this plugin? Backs the "publisher manages own plugin/versions"
policies. `SECURITY DEFINER`, `STABLE`.

All three: `EXECUTE` → `authenticated`.

---

## Triggers

### `fn_touch_updated_at() → trigger`

Shared `BEFORE UPDATE` `updated_at` maintainer, bound in `00001870` to `user_connections`,
`connection_secrets`, `connection_sync_state`, `webhook_subscriptions`, `plugins`,
`plugin_installations`.

### `fn_recount_installs() → trigger`

Keeps `integrations.plugins.install_count` in step, counting only **active** installations. Bound
`AFTER INSERT OR UPDATE OF status OR DELETE ON plugin_installations`. `SECURITY DEFINER`.

---

## Not yet implemented (deferred, deliberately)

The schema is the durable half, and these moving parts are code, not migrations. The critical
engineering is here, not in the "list of providers":

### Connectors

- **Canonical-model sync** — map provider shapes into `scheduling.events` (and a future `files.*`)
  through per-provider adapters; MVP is **read-only inbound**, bidirectional is a per-connector
  project with echo-suppression + conflict resolution.
- **Per-user + global rate limiting** — a provider quota is shared across all users; one aggressive
  sync must not rate-limit everyone.

### Plugins

- **The Plugin-API mediator** — a capability-scoped server API every plugin call passes through,
  enforced with `fn_plugin_has_scope`; a plugin never touches the DB directly.
- **Sandboxed runtime** — sandboxed cross-origin iframes (`bundle_url` on a separate origin) with a
  typed `postMessage` host bridge, plus a declarative (Block-Kit-style) tier the host renders with
  `@projective/ui`. Shadow DOM is **not** a security boundary.
- **Version review + publish pipeline** — the `submitted → in_review → approved → published`
  transitions and SRI (`bundle_integrity`) verification, run as service-role.

Every one of those paths runs as service-role and writes tables with no client write policy — which
is the point.
