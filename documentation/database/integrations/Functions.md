# integrations Schema: Functions

Two capability predicates and one maintenance trigger. Added 2026-07-24 by migration
`20260724101000_integrations_connections.sql`.

Both predicates are `SECURITY DEFINER` (so they can read the definer-only
`integrations.user_connections`) and return **only a boolean or a slug** — they are the sanctioned
way for the booking flow to ask *"can this user mint a room?"* with no path to the credentials that
answer it.

---

## `integrations.fn_has_capability(p_user uuid, p_kind integrations.provider_kind) → boolean`

Does the user hold an **active** connection granting that capability?

```sql
SELECT EXISTS (
    SELECT 1 FROM integrations.user_connections c
    WHERE c.user_id = p_user
      AND c.status = 'active'
      AND p_kind = ANY (c.granted_kinds)
);
```

Note it tests `granted_kinds` (what the consent actually returned), **not** the provider's
`capabilities` (what it could in principle do). A user who connected Google for calendar sync only
does not thereby get conferencing.

`STABLE`. `EXECUTE` granted to `authenticated`.

---

## `integrations.fn_conferencing_provider(p_user uuid) → text`

Which provider slug should mint a meeting room for this user right now — the most recently updated
active conferencing connection — or **NULL** when none is connected.

NULL is a normal, expected answer, not an error: the caller then falls back to
`scheduling.call_settings.preferred_provider_slug`, a platform-hosted room, or a manually entered
link. **A discovery call must remain bookable by someone who has connected nothing at all** — the
courtesy call is meant to be frictionless (`PRODUCT_SPEC.md` §Discovery & Courtesy Calls).

`STABLE`. `EXECUTE` granted to `authenticated`.

---

## `integrations.fn_touch_updated_at()`

The shared `BEFORE UPDATE` trigger function maintaining `updated_at`. Bound to
`user_connections` as `trg_user_connections_touch`.

---

## Not yet implemented (deferred, deliberately)

The schema is the durable half; the moving parts are Edge Functions, which are code rather than
migrations and are **not** written yet:

- **The consent handshake** — authorize → callback → encrypt with `ENCRYPTION_KEY` → insert a
  `user_connections` row + a `connected` audit line.
- **Token refresh** — a scheduled/lazy refresh writing a `refreshed` line, flipping `status` to
  `expired` or `error` on failure.
- **Revocation** — call the provider's revoke endpoint, set `status = 'revoked'` + `revoked_at`,
  and null the cipher columns.
- **Free/busy sync** — pull external events into `scheduling.events` keyed by
  `(source_connection_id, external_event_id)`, always with `is_masked = true` unless the owner opts
  out (`schedules.mask_external_events`).
- **Room provisioning + attendance webhooks** — mint the meeting URL onto
  `scheduling.discovery_calls`, then feed `participant_joined`-style callbacks into
  `scheduling.call_attendance` (the "Digital Handshake", `SYSTEM_ARCHITECTURE.md` §Conferencing).

Every one of those paths runs as service-role and writes tables that have no client write policy —
which is the point.
