# comms: Functions

Functions and scheduled jobs for the `comms` schema. Tables: [Tables.md](Tables.md) · Policies:
[Policies.md](Policies.md).

---

## The pipeline

```
Event (RPC / trigger / cron)
  └─ comms.fn_notify ──┬─ fn_resolve_type_key   (alias → canonical key)
                       ├─ collapse into a recent same-group row?
                       ├─ fn_resolve_channels   (catalog ∩ preferences ∩ quiet hours ∩ digest)
                       ├─ INSERT comms.notifications        ──► Realtime  (in-app, migration 0206)
                       ├─ INSERT comms.notification_deliveries (one per channel, per device)
                       │     └─ trigger fn_dispatch_notification ──► Edge Function (push/email/SMS)
                       └─ security.audit_logs               (catalog rows flagged `audit`)
```

Time-based flows go the other way round: a scheduler calls `comms.fn_enqueue`, and
`comms.fn_process_queue` (cron, every minute) turns each due promise into a real notification
through the same `fn_notify`.

---

## The writer

### `comms.fn_notify(...) → uuid`

**Compatible superset** of the six-argument signature introduced in migration 0305. The original
parameters — `(p_user_id, p_type, p_title, p_body, p_entity_table, p_entity_id)` — keep their order
and meaning; eight optional ones follow (`p_payload`, `p_actor_user_id`, `p_context_type`,
`p_context_id`, `p_group_key`, `p_action_url`, `p_urgency`, `p_expires_at`). Every existing
six-argument call site therefore resolves to the new function **unchanged**.

> It is replaced with `DROP` + `CREATE`, not `CREATE OR REPLACE`, because adding parameters changes
> the signature — leaving both in place would make a six-argument call ambiguous (_"function is not
> unique"_).

What it does, in order: resolve the catalog key (aliases included) → auto-register an unknown key →
collapse into a recent same-`group_key` row if the catalog defines a window → resolve the channel
fan-out → insert the notification → resolve the deep link → materialise one delivery row per channel
(and per device for push) → write `security.audit_logs` when the catalog says `audit`.

**⚠️ It never raises.** The whole body is wrapped in an exception handler that returns `NULL`. It is
called from inside escrow and stage RPCs — a notification problem must never roll back a money
movement. The audit write has its own inner handler for the same reason.

### `comms.fn_notify_many(p_user_ids uuid[], …) → integer`

Fan-out helper. Recipients are de-duplicated (a user who is both stage lead and team member is told
once) and **the actor is never notified about their own action**.

---

## The router

### `comms.fn_resolve_channels(p_user_id, p_type_key) → comms.notification_channel[]`

The routing matrix in one function. Precedence, highest first:

1. **catalog `mandatory`** — returns `default_channels`, ignoring every preference.
2. **global snooze** (`muted_until`) — silences everything except `critical`.
3. **per-type mute** — total, or narrowed to specific transports.
4. **per-category toggles** — `COALESCE(category, global)`.
5. **global toggles**.
6. **quiet hours** — drops `push`/`sms` only (the inbox and email still land), unless the catalog
   row sets `overrides_quiet_hours`.
7. **digest deferral** — a digestible, `low`/`medium` event's **email** is rolled up instead of
   sent. The in-app row is unaffected; the inbox is always real time.

An empty result is meaningful: the notification is still recorded, just delivered nowhere.

### `comms.fn_is_quiet_hours(p_user_id, p_at) → boolean`

Timezone-aware and midnight-crossing aware (`start > end` means the window wraps). Honours the
legacy absolute `quiet_hours tstzrange` as an additional window. An invalid IANA zone degrades to
UTC rather than raising.

### `comms.fn_is_suppressed(p_channel, p_destination, p_category) → boolean`

Destination-level suppression. A `marketing_only` suppression (an unsubscribe) blocks **only** the
`marketing` category, so it can never silence a security or money-movement email.

### `comms.fn_resolve_type_key(p_key) → text`

Maps a canonical or legacy alias key to its canonical form. **Total** — an unregistered key resolves
to itself, so an emit site can never fail on catalog data.

### `comms.fn_resolve_action_url(template, id, entity_id, context_id) → text`

Substitutes `{id}` / `{entity_id}` / `{context_id}`. Returns `NULL` when a required id is missing or
an unknown placeholder remains — **better no link than a broken one** (`/projects/{context_id}` with
no context would otherwise render as `/projects/`).

---

## Scheduling

| Function                                                                | Purpose                                                                                                                                                       |
| :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `comms.fn_enqueue(…) → uuid`                                            | Schedules a future notification. A deterministic `dedupe_key` makes re-running a scheduler a no-op and upserts a moved reminder in place.                     |
| `comms.fn_cancel_queued(dedupe_key, entity_table, entity_id) → integer` | Cancels by key (the session was cancelled) or by entity (the project ended).                                                                                  |
| `comms.fn_process_queue(p_limit) → integer`                             | Cron worker. Claims due rows `FOR UPDATE SKIP LOCKED` so two overlapping ticks cannot double-send; three failures park a row as `failed` with linear backoff. |

---

## Inbox RPCs (`SECURITY INVOKER` — RLS is the guard)

| Function                                       | Returns   | Notes                                                                              |
| :--------------------------------------------- | :-------- | :--------------------------------------------------------------------------------- |
| `comms.mark_notifications_read(uuid[])`        | `integer` | Also sets `seen_at` if unset.                                                      |
| `comms.mark_all_notifications_read(category?)` | `integer` | Omit the category to clear everything.                                             |
| `comms.mark_notifications_seen()`              | `integer` | Clears the **badge** without marking anything read — what opening the drawer does. |
| `comms.archive_notifications(uuid[])`          | `integer` | Dismiss = archive. Nothing is hard-deleted.                                        |
| `comms.get_notification_summary()`             | `jsonb`   | `{ unread, unseen, total, by_category }` — the shell badge in one round trip.      |
| `comms.register_device(…)`                     | `uuid`    | Upserts the live row for a browser; resets `failure_count`.                        |
| `comms.revoke_device(id, reason)`              | `boolean` | Soft-revokes and clears the Web Push keys.                                         |

These run as the caller, so the policies in [Policies.md](Policies.md) are the real boundary; the
explicit `auth.uid()` predicates are belt-and-braces.

**Not granted to `authenticated`:** `fn_notify`, `fn_notify_many`, `fn_enqueue`, `fn_cancel_queued`,
`fn_process_queue`, `fn_resolve_channels`, `fn_is_quiet_hours`, `fn_is_suppressed`. A client that
could call `fn_notify` could spoof any notification to any user; one that could call
`fn_process_queue` could force-send every pending reminder.

---

## Scheduled jobs (`pg_cron`)

Registration is fully guarded — the extension may be absent locally, and `cron.schedule` needs
privileges a migration run may not have. A failure only raises a `NOTICE`; the jobs can be scheduled
by hand from the same statements.

| Job                     | Schedule     | Function                       | What it does                                                                                       |
| :---------------------- | :----------- | :----------------------------- | :------------------------------------------------------------------------------------------------- |
| `comms-process-queue`   | every minute | `fn_process_queue(500)`        | Materialises due reminders (session T-60/T-15/T-5, basket nudges, ghosting timers).                |
| `comms-escalate-unread` | every 5 min  | `fn_escalate_unread(500)`      | Unread `critical`/`high` past the user's `escalate_after` → email fallback.                        |
| `comms-digest-daily`    | hourly (:05) | `fn_build_digests('daily')`    | Builds the digest for users whose **local** clock just hit `digest_hour`.                          |
| `comms-digest-weekly`   | hourly (:10) | `fn_build_digests('weekly')`   | Same, gated additionally on the local ISO weekday.                                                 |
| `comms-sweep-expired`   | hourly       | `fn_sweep_expired()`           | Archives (never deletes) notifications past `expires_at`.                                          |
| `comms-reap-devices`    | daily 03:30  | `fn_reap_dead_devices()`       | Soft-revokes tokens with ≥5 gateway failures or unseen for 180 days.                               |
| `comms-compact-events`  | daily 03:45  | `fn_compact_delivery_events()` | Empties the `raw` body of callbacks older than 30 days; keeps the row (it is the idempotency key). |

`fn_escalate_unread` is idempotent by construction: a `NOT EXISTS` guard on an existing `email`
delivery row is what stops every tick sending another copy. `fn_build_digests` is idempotent by the
unique index on `(user_id, period, window_start)`.

`comms.fn_local_now(timezone, at)` is the safe local-clock helper the digest gate uses — a bad IANA
zone degrades to UTC instead of aborting the run for every other user.

---

## Triggers

| Trigger                                      | Table                 | Function                           |
| :------------------------------------------- | :-------------------- | :--------------------------------- |
| `on_users_public_created_notification_prefs` | `org.users_public`    | `comms.seed_notification_prefs()`  |
| `on_notification_created_dispatch`           | `comms.notifications` | `comms.fn_dispatch_notification()` |
| `trg_*_touch`                                | every engine table    | `comms.fn_touch_updated_at()`      |

`seed_notification_prefs` mirrors `org.seed_user_preferences` (Decision #47) — a focused
`AFTER INSERT` trigger under a **separate name**, so the existing `on_users_public_created` trigger
is untouched. `comms.fn_ensure_notification_prefs(user_id)` is the callable equivalent.

### The dispatch webhook

`fn_dispatch_notification` pokes the push/email/SMS Edge Function for the non-`in_app` channels. It
is guarded four ways:

- `security.feature_flags['comms.dispatch_webhook']` must be enabled (**off by default**);
- `security.platform_params['comms_dispatch_url']` supplies the URL, seeded as the `XXXX-XXXX`
  placeholder (root CLAUDE.md §6 — zero-trust placeholders);
- rows whose only channel is `in_app` short-circuit (Realtime already delivered them);
- `pg_net` may be absent, so the call goes through dynamic SQL inside an exception block.

With the flag off it costs one flag lookup per notification and does nothing else. It can never
block or roll back the transaction that emitted the notification.

---

## Messaging helpers (pre-existing)

| Function                                   | Migration | Purpose                                   |
| :----------------------------------------- | :-------- | :---------------------------------------- |
| `comms.can_access_scope(uuid, uuid, text)` | 0311      | Private-channel scope check.              |
| `comms.has_channel_access(uuid)`           | 0311      | Channel membership predicate used by RLS. |
| `comms.get_stage_channels(uuid)`           | 0311      | Channels visible for a stage.             |
| `comms.get_or_create_project_channel(...)` | 0112      | Idempotent project-channel provisioning.  |
| `comms.get_or_create_dm_thread(...)`       | 0113      | Idempotent DM-thread provisioning.        |
