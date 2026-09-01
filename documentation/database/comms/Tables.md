# comms Schema: Tables

The `comms` schema handles all real-time and asynchronous communication within the platform. It is
split between project-specific collaboration (Channels) and personal messaging (DMs), supported by a
robust notification delivery system.

## 🔔 The Notification Engine

Migrations `20260724090000`–`20260724094000`. Zod SSOT:
[`@projective/types/comms`](../../../packages/types/comms/mod.ts). Policies:
[Policies.md](Policies.md) · Functions: [Functions.md](Functions.md).

**The routing contract, in one place:**

1. A notification **row is always written** (unless the recipient is NULL). It is the ledger.
2. `comms.notifications.channels` records what the router decided to deliver over. An **empty array
   means "recorded, delivered nowhere"** — the user muted it.
3. The in-app inbox shows a row only when `in_app` is among its channels (the
   `comms.notification_feed` view filters on exactly that). Realtime already streams the table.
4. `mandatory` catalog types **ignore every user preference** — security, money-movement, legal and
   moderation events are not suppressible.
5. `critical` urgency pierces a global snooze; a catalog row's `overrides_quiet_hours` pierces quiet
   hours.
6. **Nothing in the engine ever raises.** `comms.fn_notify` is called from inside escrow and stage
   RPCs — a notification problem must never roll back a money movement.

### `comms.notification_types`

The routing matrix **as data**: one row per event key declaring how that event is delivered. 81 keys
are seeded (money · work · messages · schedule · discovery · account · system · marketing).

⚠️ **Deliberately NOT referenced by a foreign key** from `comms.notifications.type`. An unregistered
key must never raise inside a money-movement RPC — `fn_notify` auto-registers it as
`system`/`medium` and carries on. The catalog is policy, not a gate.

| Column                  | Type                           | Notes                                                                           |
| :---------------------- | :----------------------------- | :------------------------------------------------------------------------------ |
| `key`                   | text                           | PK. Canonical dotted `domain.event` form, enforced by CHECK.                    |
| `aliases`               | text[]                         | Legacy keys resolving here (see the conflict note below). GIN-indexed.          |
| `category`              | `comms.notification_category`  | The preference-centre / inbox-tab grouping.                                     |
| `urgency`               | `comms.notification_urgency`   | `critical` pierces a global snooze.                                             |
| `default_channels`      | `comms.notification_channel[]` | Fan-out **before** preferences. Preferences may only narrow it.                 |
| `mandatory`             | boolean                        | User cannot mute. Preference centre renders these read-only.                    |
| `overrides_quiet_hours` | boolean                        | Push/SMS still fire inside quiet hours.                                         |
| `digestible`            | boolean                        | May be rolled into a daily/weekly digest.                                       |
| `audit`                 | boolean                        | Also writes a `security.audit_logs` row.                                        |
| `group_window`          | interval                       | Collapse window; a same-`group_key` event inside it refreshes rather than adds. |
| `action_url_template`   | text                           | `{id}` / `{entity_id}` / `{context_id}` substituted server-side.                |
| `default_lead_time`     | interval                       | Suggested lead time for reminder-style events.                                  |
| `enabled`               | boolean                        | `false` retires an event without deleting the row (root CLAUDE.md §5).          |

⚠️ **Flagged conflict (root CLAUDE.md §8, Decision #56).** Two key conventions exist: this file has
always documented **dotted** keys (`message.new`), while the live callers in migrations 0305 / 0311
emit **underscored** ones (`stage_funded`, `stage_approved`, `stage_cancelled`, `project_handover`).
Resolved non-destructively — dotted is canonical, and the four legacy keys are carried in
`aliases[]` so those call sites keep working byte-for-byte unchanged. Rewriting the escrow/stage
RPCs needs human sign-off.

### `comms.notifications`

The central ledger of all system-generated alerts. Real-time delivery is via Supabase Realtime
(published since migration 0206). The 0008 columns are unchanged; everything below the rule is
additive.

| Column          | Type                           | Notes                                                                      |
| :-------------- | :----------------------------- | :------------------------------------------------------------------------- |
| `id`            | uuid                           | PK.                                                                        |
| `user_id`       | uuid                           | Recipient.                                                                 |
| `type`          | text                           | Canonical event key, e.g. `stage.funded`.                                  |
| `title`/`body`  | text                           | Rendered copy.                                                             |
| `entity_table`  | text                           | Source table for the event.                                                |
| `entity_id`     | uuid                           | Specific row ID related to the alert.                                      |
| `read_at`       | timestamptz                    | Null if unread.                                                            |
| —               |                                | _additive from `20260724090000`_                                           |
| `category`      | `comms.notification_category`  | Denormalised at write time, so a re-classification never rewrites history. |
| `urgency`       | `comms.notification_urgency`   | Denormalised likewise.                                                     |
| `actor_user_id` | uuid                           | Who caused it. NULL = the platform (cron, webhook, system).                |
| `context_type`  | text                           | `personal`/`project`/`team`/`business`/`organisation`/`conversation`.      |
| `context_id`    | uuid                           | Scopes the inbox to the active context (Decision #16).                     |
| `action_url`    | text                           | Resolved deep link, or NULL — never a broken one.                          |
| `payload`       | jsonb                          | Render/localization data only. **Never PII, never secrets.**               |
| `group_key`     | text                           | Collapse key for the catalog's `group_window`.                             |
| `group_count`   | integer                        | How many source events this row represents (1 = not collapsed).            |
| `channels`      | `comms.notification_channel[]` | What the router resolved. **Empty = recorded, delivered nowhere.**         |
| `seen_at`       | timestamptz                    | Badge cleared. **Distinct from `read_at`** — do not conflate.              |
| `archived_at`   | timestamptz                    | Dismissed. Nothing is hard-deleted.                                        |
| `expires_at`    | timestamptz                    | Stops surfacing in the live inbox; swept to archived by cron.              |

Nine partial indexes back the feed, the badge, category tabs, collapse lookup, entity
back-references, context scoping, the expiry sweep and the escalation job.

### `comms.notification_prefs`

Per-user delivery configuration. One row per user, seeded on signup by
`comms.seed_notification_prefs`.

| Column                              | Type                     | Notes                                                                  |
| :---------------------------------- | :----------------------- | :--------------------------------------------------------------------- |
| `user_id`                           | uuid                     | PK, FK → `org.users_public.user_id`.                                   |
| `email` / `push` / `in_app` / `sms` | boolean                  | Transport master switches. `sms` is additive.                          |
| `digest_frequency`                  | `comms.digest_frequency` | Authoritative cadence. `off` = deliver in real time.                   |
| `digest_hour` / `digest_weekday`    | smallint                 | Local delivery time; weekday is ISO (1 = Mon … 7 = Sun).               |
| `timezone`                          | text                     | IANA zone the local-time columns are evaluated in.                     |
| `quiet_hours_enabled`               | boolean                  | Master switch for the recurring window.                                |
| `quiet_hours_start` / `_end`        | time                     | Local wall clock. `start > end` = the window crosses midnight.         |
| `muted_until`                       | timestamptz              | Global snooze. `critical` still pierces it.                            |
| `locale`                            | text                     | Email/push copy language; falls back to `org.user_preferences.locale`. |
| `escalate_after`                    | interval                 | Unread wait before the email fallback (default 15 min).                |
| `quiet_hours`                       | tstzrange                | ⚠️ **Legacy** (0008) — see below.                                      |
| `digest`                            | boolean                  | ⚠️ **Legacy** (0008) — see below.                                      |

⚠️ **Flagged supersessions (Decision #56).** Both legacy columns are **kept** under the Additive
Rule but are no longer the source of truth:

- `quiet_hours tstzrange` is an **absolute** instant range — it can say "quiet from 22:00 tonight to
  07:00 tomorrow" but not "quiet 22:00–07:00 every night in Europe/London". Superseded by the
  recurring `quiet_hours_*` + `timezone` columns; still honoured as an extra absolute window so an
  existing row keeps working.
- `digest boolean` is superseded by `digest_frequency`, which is **backfilled** from it (`true` →
  `daily`) so nobody silently loses an opted-in digest.

⚠️ Also flagged: `org.user_preferences` (0213) carries `notification_email` / `notification_push` —
a second, coarser copy of the same two toggles. `comms.notification_prefs` is the engine's source of
truth; the two are **not reconciled** (that is a data decision) — reconcile with a human.

### `comms.notification_category_prefs`

Sparse per-category narrowing — a freelancer muting `discovery` while keeping every `money` and
`work` alert. PK `(user_id, category)`. A **NULL column inherits** the corresponding global toggle;
an **absent row inherits everything**, so the table stays sparse and a new category needs no
backfill.

### `comms.notification_type_mutes`

The finest grain: mute exactly one noisy event (`message.reaction`), optionally **until** a date,
optionally only on **some transports**. PK `(user_id, type_key)`. A mute on a `mandatory` catalog
type is stored but **ignored** by the router. Lapsed mutes are kept, not deleted.

### `comms.device_tokens`

Push registration. The 0008 shape stored a string; these additive columns make it possible to
actually send.

| Column                   | Type                    | Notes                                                    |
| :----------------------- | :---------------------- | :------------------------------------------------------- |
| `platform`               | `comms.device_platform` | `web` (VAPID) · `ios` (APNs) · `android` (FCM).          |
| `endpoint`               | text                    | Web Push subscription endpoint.                          |
| `p256dh` / `auth_key`    | text                    | Web Push subscription keys — see the note below.         |
| `label` / `user_agent`   | text                    | For the device list in settings.                         |
| `last_seen_at`           | timestamptz             | Drives the stale-device reaper.                          |
| `revoked_at` / `_reason` | timestamptz / text      | Soft retirement; the router skips revoked tokens.        |
| `failure_count`          | smallint                | Consecutive gateway failures; auto-revoked at threshold. |

A partial unique index on `(user_id, token) WHERE revoked_at IS NULL` means re-registering a browser
**updates** rather than accumulating duplicates that each cost a push request.

⚠️ `p256dh` / `auth_key` are **browser-generated, per-subscription transport credentials** — not
user PII and not a platform secret. They are useless without the server's VAPID private key, which
lives in the Edge Function environment and never in the database. Both are cleared on revocation and
are never returned by a read endpoint.

### `comms.notification_deliveries`

One row per **(notification, channel, device)**. A notification is one event but many sends; without
this table nothing can answer "did the push arrive?", "has the email fallback already fired?" (the
unread-escalation job would double-send on every cron tick) or "why was this user not told?".

`status` distinguishes **`suppressed`** (policy said no — muted, quiet hours, suppressed
destination) from **`skipped`** (nothing to send to — no device, no email on file). Unique on
`(notification_id, channel, COALESCE(device_token_id, <nil uuid>))` so the dispatcher is idempotent.

### `comms.notification_queue`

A **promise** of a notification, not a notification. Backs every time-based flow: session
T-60/T-15/T-5 reminders, the abandoned-basket nudge, ghosting/auto-approve timers, and quiet-hours
deferral. A deterministic `dedupe_key` (e.g. `session:{id}:reminder_15m`) makes re-running a
scheduler a no-op and lets the event that invalidates the reminder cancel it **by key** — enforced
by a partial unique index over live rows only.

### `comms.notification_digests`

The rolled-up delivery a `digest_frequency` user gets instead of N individual sends. Unique on
`(user_id, period, window_start)`, so a double cron tick produces one email. `status = 'skipped'`
records an empty window, making the job provably idempotent rather than silently absent.

### `comms.delivery_events`

Inbound gateway callbacks (delivered / bounced / complaint / device unregistered).
**`UNIQUE (provider, provider_event_id)` IS the platform's webhook idempotency guarantee**
(`SYSTEM_ARCHITECTURE.md` §Webhook Standards) — a replayed event can never double-apply. The `raw`
body is emptied after 30 days by `comms.fn_compact_delivery_events`; the row itself is never
deleted, because the row is the idempotency key.

### `comms.channel_suppressions`

Destinations that must never be contacted again (hard bounce, spam complaint, unsubscribe). Held
here rather than only on `org.user_emails` because a suppression must survive the user changing the
address and must apply even if no account currently owns it.

`marketing_only = true` suppresses **only** the `marketing` category — an unsubscribe can never
silence a security or money-movement email. Lifting sets `lifted_at`; nothing is deleted.

---

## 💬 Direct Messaging (DMs)

### `comms.dm_threads`

Containers for 1:1 or group conversations separate from project work.

### `comms.dm_participants`

Join table mapping users to threads. Only users in this table can access thread history.

### `comms.dm_messages`

The individual message entries for DMs.

| Column            | Type    | Notes                       |
| :---------------- | :------ | :-------------------------- |
| `thread_id`       | uuid    | FK → `comms.dm_threads.id`. |
| `sender_user_id`  | uuid    | FK → `auth.users.id`.       |
| `body`            | text    | Message content.            |
| `has_attachments` | boolean | Flag for UI optimization.   |

---

## 🧱 Project Collaboration

### `comms.project_channels`

Themed chat rooms within a project workspace. Channels can be global to the project or restricted to
specific stages.

| Column       | Type | Notes                                       |
| :----------- | :--- | :------------------------------------------ |
| `project_id` | uuid | FK → `projects.projects.id`.                |
| `stage_id`   | uuid | Optional FK → `projects.project_stages.id`. |
| `visibility` | text | `project_all` or restricted.                |

### `comms.project_messages`

Stage-aware communication between clients and freelancers.

```sql
CREATE TABLE comms.project_messages (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    channel_id uuid NOT NULL,
    sender_user_id uuid NOT NULL,
    body text NOT NULL,
    has_attachments boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    CONSTRAINT project_messages_pkey PRIMARY KEY (id)
);
```

---

## 📎 Attachments & Shared Files

### `comms.message_attachments`

Poly-morphic link table connecting messages to `org.attachments`.

| Column          | Type | Notes                                            |
| :-------------- | :--- | :----------------------------------------------- |
| `message_table` | text | `comms.project_messages` or `comms.dm_messages`. |
| `message_id`    | uuid | ID from the specified message table.             |
| `attachment_id` | uuid | FK → `org.attachments.id`.                       |

### `comms.channel_files`

Aggregates all files shared within a channel for easy gallery browsing.

---

## 🚩 Refactor Notes & Suggestions

- **Message Retention**: `deleted_at` columns exist for soft-deletion. Ensure a background cron job
  handles permanent purging for privacy compliance if required.
- **Presence Tracking**: While table-based notifications are implemented, ephemeral user presence
  (typing indicators, "online" status) should be handled via **Supabase Realtime Broadcast** rather
  than database writes to reduce IO.
- **Attachment Logic**: The `message_attachments` table uses a text-based `message_table` reference.
  This prevents hard foreign keys at the DB level.
  - _Suggestion_: Consider using a database view or function for unified attachment retrieval to
    simplify frontend queries.
