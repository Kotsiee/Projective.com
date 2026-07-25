# integrations Schema: Functions

Capability/authorization **predicates** plus maintenance **triggers**. Every predicate is
`SECURITY DEFINER` (so it can read the definer-only tables) and returns **only a boolean or a slug**
— the sanctioned way to ask an authorization question with no path to the credentials or other
users' rows that answer it. Functions live in `00001500`; their triggers in `00001870`.

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

The schema is the durable half; the moving parts are Edge Functions (code, not migrations) and are
**not written yet**. The critical engineering is here, not in the "list of providers":

### Connectors

- **The consent handshake** — authorize → callback → **envelope-encrypt** with the KMS key
  (`connection_secrets.key_id`) → insert a `user_connections` row + a `connected` audit line.
- **A proactive token-refresh scheduler** — a background job refreshing tokens **before** expiry
  (not lazily on 401), writing a `refreshed` line and flipping `status` to `degraded` → `expired` on
  repeated failure. Providers differ (Google refresh tokens lapse if unused ~6 months; Microsoft
  rotates on every refresh) — this is where connector platforms bleed.
- **Webhook ingestion + renewal** — verify each provider signature, dedupe on
  `webhook_deliveries (provider_slug, external_delivery_id)`, and a cron that **re-registers
  channels before `expires_at`** (a lapsed channel silently stops sync).
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
