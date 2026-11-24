# comms: Functions

**`EXECUTE` is deny by default (Decision #477).** The first region of `00002510` revokes it from
`PUBLIC`, `anon` and `authenticated` on every function here and `00002500` closes the default for
functions created later, so a client role holds only what `00002510` grants by name. `anon` may
execute none of them. The full allowlist, one reason per line, is in
`supabase/probes/function_grants.sql`.

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
                       │     └─ AFTER INSERT on_notification_created_dispatch
                       │           → fn_dispatch_notification ──pg_net──► POST /api/comms/dispatch
                       │                 (Bearer COMMS_DISPATCH_SECRET)    └─ fn_claim_deliveries
                       │                                                      → transport → fn_record_delivery_result
                       ├─ INSERT comms.notification_deliveries (one per channel, per device)
                       └─ security.audit_logs               (catalog rows flagged `audit`)
```

The dispatch hook hangs off `comms.notifications`, not `notification_deliveries` (#339 (i)). It is
off by default (`security.feature_flags` `comms.dispatch_webhook`) and posts with a Vault-held bearer
(#339 ruling N3 (c) = #335 (e)) to the Fresh dispatcher (Decision #344 (a)); see §The dispatch
webhook.

Time-based flows go the other way round: a scheduler calls `comms.fn_enqueue`, and
`comms.fn_process_queue` turns each due promise into a real notification through the same
`fn_notify`. It runs every minute as the `comms-process-queue` job (`00005060`).

---

## The writer

### `comms.fn_notify(...) → uuid`

**Compatible superset** of the six-argument signature introduced in migration 0305. The original
parameters — `(p_user_id, p_type, p_title, p_body, p_entity_table, p_entity_id)` — keep their order
and meaning; eight optional ones follow (`p_payload`, `p_actor_user_id`, `p_context_type`,
`p_context_id`, `p_group_key`, `p_action_url`, `p_urgency`, `p_expires_at`). Every existing
six-argument call site therefore resolves to the new function **unchanged**. `EXECUTE`:
`service_role` only — `comms` is deny-by-default (`00002510` region "comms"), so no client can write
a notification into another user's inbox.

> It is replaced with `DROP` + `CREATE`, not `CREATE OR REPLACE`, because adding parameters changes
> the signature — leaving both in place would make a six-argument call ambiguous (_"function is not
> unique"_).

What it does, in order: resolve the catalog key (aliases included) → auto-register an unknown key →
collapse into a recent same-`group_key` row if the catalog defines a window → resolve the channel
fan-out → insert the notification → resolve the deep link → materialise one delivery row per channel
(and per device for push) → write `security.audit_logs` when the catalog says `audit`.

The collapse first takes `pg_advisory_xact_lock(hashtextextended(user_id::text || group_key, 0))`,
held to the end of the caller's transaction, so a concurrent event with the same recipient and
`group_key` waits and then refreshes the row: two at once end as one row with `group_count` 2 (CAS
N3). The refresh rewrites the title, body and payload, and the link when the event passes one
(`p_action_url`), so a folded notice opens what its newest line names (Decision #494 (C)). `fn_notify_many` takes its recipients in id order, so two fan-outs over one key cannot deadlock
on those locks.

**⚠️ It never raises.** The whole body is wrapped in an exception handler that returns `NULL`. It is
called from inside escrow and stage RPCs — a notification problem must never roll back a money
movement. The audit write and the auto-registration have their own inner handlers for the same
reason. Each handler first raises a `WARNING` naming the type key and the SQLSTATE, never the
payload, so a lost notification or audit row shows in the database log (CAS N1).

### `comms.fn_notify_many(p_user_ids uuid[], …) → integer`

Fan-out helper. Recipients are de-duplicated (a user who is both stage lead and team member is told
once) and **the actor is never notified about their own action**.

---

## The router

### `comms.fn_resolve_channels(p_user_id, p_type_key) → comms.notification_channel[]`

The routing matrix in one function. Precedence, highest first:

1. **catalog `mandatory`** — returns `default_channels`, ignoring every preference and the snooze;
   inside quiet hours it drops `push`/`sms` unless the type sets `overrides_quiet_hours` (Decision
   #339, ruling N3 (a)).
2. **global snooze** (`muted_until`) — silences everything except `critical`.
3. **per-type mute** — total, or narrowed to specific transports.
4. **per-category toggles** — the category's own value, else the global toggle
   (`comms.fn_category_channel_on`). **Marketing has no global fallback:** it is opt-in, so a
   Marketing channel with no explicit yes is off whatever the global toggle says (CK5, Decision
   #492).
5. **global toggles**.
6. **quiet hours** — drops `push`/`sms` only (the inbox and email still land), unless the catalog
   row sets `overrides_quiet_hours`. The same rule holds a mandatory type's push and SMS (item 1).
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

### `comms.fn_category_channel_on(p_category, p_category_value, p_master) → boolean`

The one opt-in rule (CK5, Decision #492): a category's own value for a channel wins; with none, the
channel's global toggle decides — except **Marketing**, which is off without an explicit yes, so no
default and no global toggle ever opts anyone in. `IMMUTABLE`, `search_path = ''`. Read by the
router (item 4 above), the unread escalation and the digests; Settings → Notifications draws its
switches through the same rule (`categoryChannelOn`, `apps/web/features/settings/core/`). A global
toggle clears every category's value for its channel (`resetChannels`), so it withdraws a Marketing
yes rather than granting one.

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

`fn_enqueue` never raises either: a failed write logs a `WARNING` (type key and SQLSTATE) and
returns `NULL`. Each caller belongs to the track that owns the reason for the reminder:

| Caller                                                                         | Track                                                                                    |
| :----------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| Session reminders and calendar alerts (`scheduling.fn_enqueue_due_reminders`)  | Scheduling (`00001510` §7b; SCH-WP3, Decision #388)                                      |
| The abandoned-basket nudge (`comms.fn_enqueue_basket_nudges`, below)           | This file (CK5, Decision #492); built, and switched off until counsel confirms                  |
| The 7- and 13-day ghosting auto-approve notices                                | Finance and projects (`PM_BUILD_PROMPTS.md` PM-GH1; Decision #337, ruling P3); not built |

### `comms.fn_enqueue_basket_nudges(p_limit integer DEFAULT 500) → integer`

The daily abandoned-basket finder (`comms-basket-nudges`, CK5; owner ruling A, Decision #492: the
nudge is **Marketing**). `SECURITY DEFINER`, `search_path = ''`; service role only. It queues one
`basket.abandoned` (Marketing · low · email · opens `/checkout`) through `fn_enqueue` for each
basket that passes every test:

- a **personal default** basket (`owner_type = 'user'`, `is_default`) — never a wishlist, nor a
  team, business or enterprise basket, which has no one person to remind;
- at least one **live** line: not removed, not bought, not saved for later;
- **idle**: neither the basket nor any line touched (`updated_at`) for the catalogue's
  `default_lead_time` (1 day);
- **no order since**: its owner has placed no `finance.orders` row since that touch;
- **one reminder per idle spell, none twice in a window**: no `basket.abandoned` for the basket
  queued, processing or sent since that touch, nor inside the catalogue's `group_window` (3 days);
- an **adult** owner (`NOT org.fn_is_minor`, which fails closed on an unknown date of birth);
- **reachable within consent**: the router's answer for the type (so only someone who turned
  Marketing on, never a muted type or a snooze), less email when the primary verified address is
  missing or suppressed for Marketing (a one-click unsubscribe or a complaint).

The notice names up to five lines (`payload.lines`, `line_count`) and **never a price**, which may
have moved: the link opens `/checkout`, which reprices every line. It is due at once, so
`comms-process-queue` sends it within the minute through `fn_notify`, and NT3's email carries the
RFC 8058 one-click unsubscribe. The `dedupe_key` and `group_key` are `basket.abandoned:<basket id>`.
Returns how many it queued. **Off** until counsel confirms the consent basis:
`security.feature_flags['comms.basket_nudge'].enabled` is `false` in every seed, and while it is off
the finder returns `0`. Probe: `supabase/probes/basket_nudge.sql`.

---

## Inbox RPCs (`SECURITY INVOKER` — RLS is the guard)

| Function                                       | Returns   | Notes                                                                              |
| :--------------------------------------------- | :-------- | :--------------------------------------------------------------------------------- |
| `comms.mark_notifications_read(uuid[])`        | `integer` | Also sets `seen_at` if unset.                                                      |
| `comms.mark_all_notifications_read(category?)` | `integer` | Omit the category to clear everything.                                             |
| `comms.mark_notifications_seen()`              | `integer` | Clears the **badge** without marking anything read — what opening the drawer does. |
| `comms.archive_notifications(uuid[])`          | `integer` | Dismiss = archive. Nothing is hard-deleted.                                        |
| `comms.get_notification_summary()`             | `jsonb`   | `{ unread, unseen, total, by_category }` — the shell badge in one round trip.      |
| `comms.register_device(…)`                     | `uuid`    | Upserts the caller's live row for a browser; resets `failure_count`. A browser belongs to whoever turned alerts on in it last (COMMS NT4): another account's live row for the same token is first revoked (`revoked_reason = 'reassigned'`, keys dropped), so a shared browser never shows the previous person's notifications. That release is why it is `SECURITY DEFINER` (`search_path = ''`, every write pinned to `auth.uid()`; no caller, no write). Called by `POST /api/notifications/devices` (`PushDeviceBackendService`) under the caller's JWT, with `token = endpoint`, `provider 'web_push'`, `platform 'web'`, after the service checks the endpoint is a known push service. |
| `comms.revoke_device(id, reason)`              | `boolean` | Soft-revokes and clears the Web Push keys. Called by `DELETE /api/notifications/devices`: "Stop on this device", and signing out on that browser (`AuthService.logout`). |

These run as the caller (`register_device` excepted, above), so the policies in
[Policies.md](Policies.md) are the real boundary; the explicit `auth.uid()` predicates are
belt-and-braces. They write only `read_at` / `seen_at` /
`archived_at`, the three columns `authenticated` holds `UPDATE` on (`00002520` §2). The app reaches
the first five through `NotificationInboxBackendService` (`/api/notifications/*`).

**Not granted to `authenticated`:** `fn_notify`, `fn_notify_many`, `fn_enqueue`, `fn_cancel_queued`,
`fn_process_queue`, `fn_resolve_channels`, `fn_is_quiet_hours`, `fn_is_suppressed`,
`fn_category_channel_on`, `fn_enqueue_basket_nudges`. A client that could call `fn_notify` could
spoof any notification to any user; one that could call `fn_process_queue` could force-send every
pending reminder.

---

## Scheduled jobs (`pg_cron`)

> Every job below is a row of `ops.scheduled_jobs` in `00005060` (Decision #203 flag (a), ruled as
> FOUNDER_QUESTIONNAIRE Q0.3), which is the source of truth for its minute; the minutes avoid ticks
> other jobs use. Each runs in every environment and can be run by hand with
> `deno task cron:run <job>`. See `SYSTEM_ARCHITECTURE.md` §Scheduled jobs.

| Job                     | Schedule     | Function                       | What it does                                                                                       |
| :---------------------- | :----------- | :----------------------------- | :------------------------------------------------------------------------------------------------- |
| `comms-process-queue`   | every minute | `fn_process_queue(500)`        | Materialises due reminders (session T-60/T-15/T-5, basket nudges, ghosting timers).                |
| `comms-escalate-unread` | every 5 min  | `fn_escalate_unread(500)`      | Unread `critical`/`high` past the user's `escalate_after` → email fallback.                        |
| `comms-digest-daily`    | hourly (:02) | `fn_build_digests('daily')`    | Builds the digest for users whose **local** clock just hit `digest_hour`.                          |
| `comms-digest-weekly`   | hourly (:08) | `fn_build_digests('weekly')`   | Same, gated additionally on the local ISO weekday.                                                 |
| `comms-sweep-expired`   | hourly (:35) | `fn_sweep_expired()`           | Archives (never deletes) notifications past `expires_at`.                                          |
| `comms-reap-devices`    | daily 03:32  | `fn_reap_dead_devices()`       | Soft-revokes tokens with ≥5 gateway failures or unseen for 180 days.                               |
| `comms-compact-events`  | daily 03:47  | `fn_compact_delivery_events()` | Empties the `raw` body of callbacks older than 30 days; keeps the row (it is the idempotency key). |
| `comms-dispatch-sweep`  | every minute | http: `POST /api/comms/cron/dispatch?limit=200` (`COMMS_DISPATCH_SECRET`) | The dispatcher's retry sweep: sends what the trigger's post missed and retries failures past their backoff, through `fn_claim_deliveries`. Claims nothing while `comms.dispatch_webhook` is off. |
| `comms-basket-nudges`   | daily 10:17  | `fn_enqueue_basket_nudges(500)` | Queues one `basket.abandoned` per idle personal basket, within consent (CK5). Queues nothing while `comms.basket_nudge` is off. |

`fn_escalate_unread` is idempotent by construction: a `NOT EXISTS` guard on an existing `email`
delivery row is what stops every tick sending another copy. It adds the email only where the
person's email channel for that type is on, read in the router's order: a snooze withholds it unless
the event is `critical`, then a live mute of the type that covers email, then the category's email
toggle, else the global one — Marketing only by its own yes (CAS N9; `fn_category_channel_on`).
`fn_build_digests` is idempotent by the unique index on
`(user_id, period, window_start)`. It picks every person whose cadence for some category is this
period — the category row's `digest_frequency`, else the global one, as the router defers on — and
rolls up the digestible rows of only those categories whose email is on (read through
`fn_category_channel_on`, so Marketing joins a digest only by its own yes), so a per-category digest
is no longer lost (CAS N10).

`comms.fn_local_now(timezone, at)` is the safe local-clock helper the digest gate uses — a bad IANA
zone degrades to UTC instead of aborting the run for every other user.

---

## Triggers

| Trigger                                      | Table                    | Function                                                                  |
| :------------------------------------------- | :----------------------- | :------------------------------------------------------------------------ |
| `on_users_public_created_notification_prefs` | `org.users_public`       | `comms.seed_notification_prefs()`                                         |
| `on_notification_created_dispatch`           | `comms.notifications`    | `comms.fn_dispatch_notification()`                                        |
| `trg_*_touch`                                | every engine table       | `comms.fn_touch_updated_at()`                                             |
| `trg_mask_message_pii`                       | `comms.project_messages` | `comms.tg_mask_message_pii()`                                             |
| `trg_project_messages_guard_reply`           | `comms.project_messages` | `comms.tg_guard_message_reply()`                                          |
| `trg_dm_messages_mask_pii`                   | `comms.dm_messages`      | `comms.tg_mask_dm_message_pii()`                                          |
| `trg_dm_messages_promote_on_reply`           | `comms.dm_messages`      | `comms.fn_promote_thread_on_reply()`                                      |
| `trg_dm_messages_guard_reply`                | `comms.dm_messages`      | `comms.tg_guard_dm_message_reply()`                                       |
| `trg_dm_messages_bind_project`               | `comms.dm_messages`      | `comms.tg_bind_dm_project()`                                              |
| `trg_dm_messages_thread_summary` (AFTER)     | `comms.dm_messages`      | `comms.tg_dm_thread_summary()`                                            |
| `trg_dm_threads_derived`                     | `comms.dm_threads`       | `security.fn_guard_derived_columns('last_message_at', 'last_message_id')` |
| `trg_dm_threads_ref` (`00001890`)            | `comms.dm_threads`       | `security.fn_ref_guard('cht')`                                            |

Every message trigger is `BEFORE` (`00001840`) except `trg_dm_messages_thread_summary` and the
auto-reply, which run `AFTER INSERT`. The mask and promotion triggers fire on `INSERT` and are
documented under §Inbox folders, hiring requests & the DM contact filter below; the two reply guards
fire on `INSERT` and on `UPDATE OF reply_to_id` plus the room column, and are documented under
§Replies stay in their room; the project stamp, the thread summary and the ref under §The inbox read
model and project-stamped DMs. Triggers of one timing fire in name order, which is why
`trg_dm_messages_bind_project` sorts before `trg_dm_messages_mask_pii`.

`seed_notification_prefs` mirrors `org.seed_user_preferences` (Decision #47) — a focused
`AFTER INSERT` trigger under a **separate name**, so the existing `on_users_public_created` trigger
is untouched. It calls `comms.fn_seed_notification_prefs(p_user_id uuid, p_meta jsonb)` with the
sign-up metadata (`org.fn_signup_meta`), which inserts the row and, only when it is new, sets
`timezone` to the profile's zone, else the sign-up `timezone` hint — only a zone Postgres resolves,
because quiet hours and digests run `AT TIME ZONE` it, otherwise the `UTC` default — and `locale` to
the supported sign-up locale (`org.fn_supported_locale`), else `NULL` (Decision #207). An invoker
function: a client calling it directly meets the INSERT-own policy. An enterprise owner is seeded by
the same trigger, since `public.create_enterprise` gives them a profile row
([org/Functions.md](../org/Functions.md)).
`comms.fn_ensure_notification_prefs(user_id)` is the callable defaults-only equivalent.

### The dispatch webhook

The dispatcher is a Fresh route, `POST /api/comms/dispatch`, thin over
`@server/services/comms/NotificationDispatchService` (Decision #344 (a); ruling C4 (a) of #343 for
the runtime), and `supabase/functions/` stays empty. Two doors reach it, and both end in
`fn_claim_deliveries`, so the one flag governs both:

- **The trigger.** `fn_dispatch_notification` (`AFTER INSERT` on `comms.notifications`) posts
  `{notification_id}` and nothing else to `<CRON_APP_URL>/api/comms/dispatch` with
  `Authorization: Bearer <COMMS_DISPATCH_SECRET>`, both read from `vault.decrypted_secrets` exactly as
  `ops.fn_dispatch_http_job` reads them. pg_net sends it when the emitting transaction commits, so the
  dispatcher finds the delivery rows `fn_notify` wrote. It checks, in order: the flag
  (`fn_dispatch_enabled()`; **off in every seed**), an outbound channel (`email`, `push` or `sms`;
  an in-app-only row is already delivered), pg_net, Vault, an http(s) `CRON_APP_URL` and a bearer of
  32+ characters. Each missing piece logs in the scheduler's style
  (`ops.fn_log_scheduler_event('comms-dispatch', <reason>, 'warn', …)`: a `WARNING` every time and one
  `ops.log_entries` row per reason a day, naming the secret, never its value) and posts nothing; the
  deliveries stay `pending` for the sweep. It never raises, so it can never roll back the transaction
  that emitted the notification.
- **The sweep.** The `comms-dispatch-sweep` http job (every minute, same bearer) calls
  `POST /api/comms/cron/dispatch?limit=200`, one pass over every due delivery.

Both routes compare the bearer in constant time and answer 404 otherwise. `/api/comms/dispatch` is a
named server-to-server door in `apps/web/utils/csrf.ts`, since the database sends no `Origin`. The
service claims only the channels its transport registry (`dispatch-transports.ts`) can send. Email
is registered (COMMS NT3, `email-transport.ts`, Resend) while `RESEND_API_KEY` and `MAIL_FROM` are
well formed; NT4 adds push and NT5 SMS. Every other channel's deliveries wait `pending` and are not
claimed. Each payload carries the title, the absolute deep link
(`APP_URL` + `action_url`, a same-origin path, else `/notifications`) and the notification id,
never the body or the payload (EPI §3.5 rules 2 and 4). The runbook for turning the flag on is EPI
§8.1.

#### `comms.fn_dispatch_enabled() → boolean`

The switch: `security.feature_flags['comms.dispatch_webhook'].enabled`, `false` when the row is
missing. Read by the trigger, by the claim, and by the app's channel liveness
(`NotificationDispatchService.isRunning`, which also requires a well-formed `COMMS_DISPATCH_SECRET`
and caches the read for 30 s). `SECURITY DEFINER`, `search_path = ''`; service role only.

#### `comms.fn_claim_deliveries(p_channels notification_channel[], p_notification uuid DEFAULT NULL, p_limit integer DEFAULT 200) → TABLE (delivery_id, notification_id, user_id, channel, status, attempts, suppressed_reason, destination jsonb, title, action_url, type, category, urgency, group_key)`

Hands up to `p_limit` due deliveries of `p_channels` (one notification's, or any) to exactly one
caller (`FOR UPDATE SKIP LOCKED`), and nothing while the flag is off. A row of any other channel stays
`pending`, untouched, so no attempt is burned on a transport that is not configured yet. A row is
due when it is younger than 24 hours and one of:

- `pending`;
- `failed` with `attempts < 5` and `updated_at` older than `2^attempts` minutes (the backoff);
- `queued` with `attempts < 5` and `queued_at` older than 15 minutes (a lapsed lease: the dispatcher
  died mid-send).

A `pending` row older than 24 hours is never sent and is closed `skipped` with
`suppressed_reason = 'expired'`: a notification is not news a day later, and the in-app row is the
record. Each claimed row is resolved to its destination: for email the primary verified
`org.user_emails` address; for SMS the confirmed `auth.users.phone` (`phone_confirmed_at`); for push
the unrevoked `comms.device_tokens` row (endpoint and keys). In the same statement a row with no
destination becomes `skipped` (`no_target`), one `fn_is_suppressed` refuses becomes `suppressed`
(`suppressed_destination`; a hard bounce blocks every category, an unsubscribe Marketing only, CAS
N8), and the rest become `queued` with `attempts + 1` and `queued_at`. Returns every claimed row with
its status, and the destination on a `queued` row only. The title and action URL come with it, and
so do the notification's `urgency` and `group_key` (COMMS NT4: the push `Urgency` header, and the
`Topic` that lets a newer push of the same group replace an undelivered older one); the body and
payload never do. A destination never leaves the dispatch service and is never logged.
`SECURITY DEFINER`, `search_path = ''`; service role only.

#### `comms.fn_record_delivery_result(p_delivery uuid, p_status delivery_status, p_provider text DEFAULT NULL, p_provider_ref text DEFAULT NULL, p_error text DEFAULT NULL) → boolean`

Records one send's outcome: `sent` (`sent_at`), `delivered` (`delivered_at`) or `failed`
(`failed_at`, the error cut to 500 characters), with the provider and its message id. Anything else
raises `22023`. It only moves a row forward: `sent` needs `queued`, and `delivered` and `failed` need
`queued` or `sent`. A late or replayed answer returns `false` and changes nothing. For push,
`p_error = 'gone'` revokes the device (`comms.revoke_device`'s semantics: `revoked_at`,
`revoked_reason = 'gone'`, keys cleared), and the row's next claim closes it `skipped`. Any other push
failure counts against the device (`failure_count + 1`, which `fn_reap_dead_devices` reads), and a
success resets it. `SECURITY DEFINER`, `search_path = ''`; service role only.

Probes: `supabase/probes/comms_dispatch.sql` (rolled back) and `comms_dispatch_race.sql` (two
sessions claim at once; commits, so it runs only under `--disposable`).

### Email: provider callbacks and the account unsubscribe (COMMS NT3; Decision #339, ruling N3 (b))

The email transport sends a notification's title as the subject, one sentence for its category, an
"Open in Projective" link and a link to Settings → Notifications. It never sends the body or the
payload. Each send carries the delivery id as Resend's Idempotency-Key, and records Resend's message
id as the delivery's `provider_ref`. Marketing mail also carries the RFC 8058 pair
(`List-Unsubscribe: <…/api/comms/unsubscribe?token=…>`, `List-Unsubscribe-Post`) and is refused
(`no_unsubscribe_link`) rather than sent without one. The token names the person, never an address.

Suppression has one active row per (channel, address) (`idx_channel_suppressions_active`), so every
writer below takes a per-address transaction lock (`hashtext('comms-suppression:email:' || address)`)
and then inserts, widens or leaves that row.

#### `comms.fn_record_delivery_event(p_provider, p_provider_event_id, p_event_type, p_provider_ref DEFAULT NULL, p_recipient DEFAULT NULL, p_bounce_kind DEFAULT NULL, p_occurred_at DEFAULT NULL) → text`

Applies one verified provider event. `POST /api/comms/webhooks/resend` (`DeliveryEventService`)
checks the Svix signature first. The `(provider, provider_event_id)` claim on
`comms.delivery_events` (`ON CONFLICT DO NOTHING`) and every effect share one transaction, so a
replay answers `replayed` and changes nothing (EPI §3.3). The delivery is found by
`(provider, provider_ref)`.

| Event                                      | Effect                                                                                                                                                                                                                                                                                                                                             | Answers       |
| :----------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------ |
| `email.delivered`                          | The delivery is `delivered` (forward only, through `fn_record_delivery_result`).                                                                                                                                                                                                                                                                  | `delivered`   |
| `email.bounced`, `bounce.type = Permanent` | The delivery fails for good (`error = 'hard_bounce'`, `attempts ≥ 5`, never retried, even after `delivered`). The ADDRESS is suppressed for email in every category (`marketing_only = false`, `reason = 'hard_bounce'`, `source_event_id`), widening an unsubscribe or complaint row. The first time, its owner receives the mandatory in-app `account.email_undeliverable`. | `hard_bounce` |
| `email.complained`                         | The address is suppressed for Marketing only (`reason = 'complaint'`), unless a row already covers it: a complaint is not a bounce.                                                                                                                                                                                                              | `complaint`   |
| `email.failed`, `email.suppressed`         | The delivery fails (the provider refused or skipped the send).                                                                                                                                                                                                                                                                                    | `failed`      |
| anything else                              | Recorded only (a `Temporary` bounce, `delivery_delayed`, `sent`, `opened`).                                                                                                                                                                                                                                                                      | `recorded`    |

The owner is the delivery's person, or else the account holding the address verified. The event row
keeps no payload beyond the bounce kind; the address is stored only on the suppression row.
`SECURITY DEFINER`, `search_path = ''`; service role only.

#### `comms.fn_unsubscribe_marketing(p_user uuid) → text`

The account's one-click marketing unsubscribe (`POST /api/comms/unsubscribe`, after
`MarketingUnsubscribeService` verifies the signed link). It suppresses the person's primary verified
address for email, Marketing only (`reason = 'unsubscribe'`), so security and money mail still
reaches it. Answers `unsubscribed`, `already` (an active row covers it) or `no_address`. Service role
only.

**Lifting.** A hard bounce is lifted only by the owner confirming the address again: Settings →
Account's **Confirm again** re-issues a token for a verified but undeliverable address
(`security.issue_email_verification`), and `org.confirm_user_email` lifts it
(`lifted_reason = 'reverified'`). An unsubscribe or a complaint is never lifted by re-verifying.
Changing the primary address leaves the old address's row in place. **Not built:** turning
Marketing email back on in Settings does not yet lift a one-click unsubscribe (PRD-E16).

Probe: `supabase/probes/email_bounce.sql` (rolled back).

---

## Messaging helpers (pre-existing)

| Function                                   | Migration | Purpose                                   |
| :----------------------------------------- | :-------- | :---------------------------------------- |
| `comms.can_access_scope(uuid, uuid, text)` | 0311      | Private-channel scope check.              |
| `comms.has_channel_access(uuid)`           | 0311      | Channel membership predicate used by RLS. |
| `comms.get_stage_channels(uuid)`           | 0311      | Channels visible for a stage. Skips an archived stage or room and never provisions a Session's stage rooms (Decision #163). |
| `comms.get_or_create_project_channel(...)` | 0112      | Idempotent project-channel provisioning.  |
| `comms.get_or_create_dm_thread(target_user_id, p_subject_listing DEFAULT NULL)` | 0113      | Idempotent DM-thread provisioning. Excludes `group` threads since Decision #102 — a group holding both people is not their DM. With `p_subject_listing` (Decision #217(g)) the listing must be PUBLISHED and owned by the recipient (`22023` otherwise); a thread this call opens is a `service_inquiry` with that `subject_listing_id`, an existing inquiry without a subject gains it, and a thread already under way keeps its kind (one record per pair). Takes the pair lock (`comms.fn_lock_dm_pair`, CAS M5) before the lookup, so two first messages racing each other find one thread instead of minting two; refuses `42501` with no acting user and `22023 recipient: invalid` for oneself (a self-DM would be one participant row twice, which `dm_participants_thread_user_key` refuses). **Returns `jsonb` `{ thread_id, thread_ref }`** (Decision #339, ruling N1): the thread and its `cht-` address, so a caller builds the conversation's URL without a second read. Zod: `OpenedDmThreadSchema`; the backend reads it through `openedThreadId` (`services/messaging/live-writes.ts`). |

## Group conversations (`00001300`, Decision #102)

Both are `SECURITY DEFINER` with `search_path = public, comms, org, auth`, `EXECUTE` granted to
`authenticated` only (`REVOKE … FROM public, anon` in `00002510`), and both refuse a `NULL`
`auth.uid()` explicitly. They exist because `comms.dm_threads` / `comms.dm_participants` carry no
client `INSERT` policy on purpose (`00002012`): who may open a thread and who may be put into one is
decided **here**, once, exactly as `comms.get_or_create_dm_thread` already decides it for a DM. A
client `INSERT` policy on `dm_participants` would have to admit "a participant may add a row for
somebody else", which is the shape that lets anyone be added to anything.

### `comms.create_group_thread(p_title text, p_member_ids uuid[]) → uuid`

Mints a `kind = 'group'` thread containing the caller plus the given people in one transaction.
Members are de-duplicated, the caller is never listed twice, and an id naming no `org.users_public`
row is **dropped** rather than left to fail the FK — the picker offers only real people, so a
phantom id is a stale client, not a request. A blank/whitespace title is stored as `NULL` (a group
may be unnamed; the inbox titles it after its members). Raises `22023` when fewer than one other
person survives resolution.

### `comms.set_group_photo(p_thread_id uuid, p_file_id uuid) → jsonb`

Sets — or, with `NULL`, clears — a **group** thread's `photo_file_id`. Also an **entity channel's** (Decision #308), where only the channel's creator or a `manage_settings` holder may (`comms.fn_can_manage_entity_channel`; `42501 channel:` otherwise) — a channel's image is part of its identity, edited with its name. `SECURITY DEFINER`,
`search_path = ''`, `EXECUTE` to `authenticated` only. Any undeleted participant may (a group's
picture is shared furniture, like its name). Refuses `42501` for a stranger, `22023` for a thread that
is not `kind = 'group'`, and `22023` unless the file is a processed public rendition the CALLER owns
(`purpose = 'avatar'`, `bucket_id = 'avatars'`, `visibility = 'public'`, `status = 'uploaded'`, not
deleted) — the same proof `org.set_profile_avatar` demands, so a client cannot point a thread at
somebody else's file. The photo it replaces is soft-deleted. Returns `{ ok, file_id, previous }`.
The rendition itself is cut server-side from the caller's library still
(`packages/backend/services/messaging/live-group-photo.ts`, reusing `writeRendition` from
`packages/backend/services/media/showcase-rendition.ts`).

**Verified by execution** inside `BEGIN … ROLLBACK` as real roles: a member sets their own file and
replaces it (previous soft-deleted); another member clears it; somebody else's file, a DM and a
stranger are each refused; `anon` holds no `EXECUTE`.

### `comms.add_dm_thread_members(p_thread_id uuid, p_member_ids uuid[]) → integer`

Adds people to a thread the caller is an **undeleted participant** of (`comms.is_dm_participant`),
returning how many were actually added. Already-present members are skipped; a member who had
soft-deleted the conversation for themselves is **restored** (`deleted_at = NULL`) and counted —
being added back by somebody is the one event that should bring a conversation back into a person's
inbox. A plain `dm` thread that ends up with more than two participants is flipped to `group`.
Raises `42501` ("Not a participant of this conversation") for a stranger, and `22023` for an entity
channel (its people are its workspace's) and for a **`service_inquiry`** ("An inquiry is only
between its buyer and its seller. Start a group to bring someone else in.", PRD-C27, Decision #482).
An inquiry cannot become a group, which carries no listing (`ck_dm_threads_subject_inquiry`), and
before #482 it was widened in place: a `service_inquiry` with three people, which the pair lookups
in `get_or_create_dm_thread` / `send_request_message` (and the TypeScript `findExistingDmThread`,
`pairThread`) — all joined on two people only — then returned for ANY two of its members. So a
stranger who opened an inquiry on a seller's listing and added C read every later "message this
person" and hiring request between the seller and C. Since #482 every `dm` and `service_inquiry`
holds exactly its pair, the invariant those lookups rely on. `SECURITY DEFINER`,
`search_path = ''` (was `public, comms, org, auth`). The backend maps the refusal to `422`
(`INQUIRY_CLOSED_MESSAGE`, `live-conversation-writes.ts`); the fixture path refuses in the same words
and no longer offers Add members on an inquiry (`canAddMembers`). Verified by
`supabase/probes/dm_pair_isolation.sql`: seven failures before the fix (the widen accepted, the
request and both "message this person" doors landing in the stranger's inquiry, the newcomer reading
its history, a three-person inquiry), green after, with a DM still becoming a group that no pair
lookup returns.

**Verified by execution** against the local Postgres (inside `BEGIN … ROLLBACK`, then applied): a
named group with three participants; a blank title → `NULL`; the DM lookup no longer returning the
group that holds both people, and idempotent; a third person converting a DM to a group with a
repeat adding nobody; a self-deletion restored; a phantom uuid dropped; a stranger refused; `anon`
holding no `EXECUTE` on either.

## Inbox folders, hiring requests & the DM contact filter (`00001300` / `00001840`, Decision #128)

The folder is a column of the PARTICIPANT row (`comms.dm_participants.inbox_folder`, see Tables),
so these doors write only the caller's own row — or, for a request, file both rows once, when the
request opens the thread. The TypeScript twins of both rules are `folderAfterSend` /
`requestRouting` in `packages/types/messaging/folders.ts`, pinned to this SQL by
`folders.test.ts`.

### `comms.set_dm_inbox_folder(p_thread_id uuid, p_folder text) → text`

`SECURITY DEFINER`, `EXECUTE` to `authenticated`. Moves the caller's own undeleted participant row
to `primary` / `requests` / `archived` and returns the folder. Raises `42501` for a caller who is
not a participant (or not signed in) and `22023 'folder: not_a_folder'` for anything else.

### `comms.send_request_message(p_recipient uuid, p_body text, p_project_id uuid) → jsonb`

`SECURITY DEFINER`, `EXECUTE` to `authenticated`. Posts a hiring request's opening message — an
invitation's intro or an application's cover note — into the pair's DM. It refuses (`42501`) unless
an OPEN invitation or a PENDING application on `p_project_id` stands between the caller and the
recipient, so it cannot be used to cold-message anybody; the body is required and at most 4,000
characters. It finds the pair's non-group thread or creates one — under the same pair lock as
`get_or_create_dm_thread` (CAS M5), so the two doors cannot each mint a thread — restores a participant row the
recipient had deleted, and — only when the request OPENS the thread (created, empty, or restored
from the recipient's deletion) — files it: the recipient's row in `requests` unless the two follow
each other (`org.profile_follows` both ways), the sender's in `primary`. An existing conversation is
never re-filed. The message is inserted with `project_id`, so the contact filter applies to it; the
project stamp keeps it, because a pending invitee or applicant is a party to the project.
Returns `{ thread_id, thread_ref, message_id, opened, routed_to }` (`thread_ref` is the thread's
`cht-` address, Decision #339 ruling N1).

### `comms.fn_promote_thread_on_reply()` — trigger

`BEFORE INSERT ON comms.dm_messages`. A reply accepts a request: the SENDER's own row moves
`requests → primary`. No other participant's folder is touched, so a requester's follow-ups can
never pull a thread out of the recipient's Requests, and a reply into an archived thread leaves it
archived. An automatic reply (`auto_response_id` set) is not the person answering and promotes
nothing.

## Auto-replies (`00001300` / `00001840`, Decision #156)

### `comms.tg_dm_auto_reply()` — trigger

`AFTER INSERT ON comms.dm_messages` (`trg_dm_messages_auto_reply`). For a human message in a two-person
thread whose recipient has `auto_responses_enabled`, it posts the recipient's best matching enabled
rule as the recipient, marked with `auto_response_id`. Most specific first: a keyword in the body → a
named service → a pending hiring invitation from the sender (`project_invitation`) → any service
inquiry (the thread is a `service_inquiry` or the message names a service) → a `status` → `any`
(only while the recipient has never replied in the thread). Each rule fires at most once per thread
per 24 hours, only inside its `starts_at`/`ends_at` window, and never in answer to an automatic
message. `product` rules match nothing yet. Best effort: a failure is a `WARNING` and the person's own
message stands. `SECURITY DEFINER`; `REVOKE`d from the client roles (`00002510`).

### `comms.fn_auto_reply_status(p_user, p_status, p_at) → boolean`

Each status is DERIVED, never chosen (Decision #149(C)): `away` — notifications paused
(`notification_prefs.muted_until > p_at`); `busy` — inside an event or blackout on the person's own
schedule (`scheduling.fn_has_conflicting_event` / `fn_is_blacked_out`); `out_of_hours` — a published
schedule with working-hours bands that do not cover `p_at` (`scheduling.fn_band_covers`); `holiday` —
true, the rule's own window having already applied. `REVOKE`d from `PUBLIC`/`anon`/`authenticated`: a
person's availability is theirs (the comms schema does not revoke PUBLIC by default, Decision #151(c)).

### `comms.tg_mask_dm_message_pii()` · `comms.fn_dm_protected_project(thread, sender, project) → uuid`

`BEFORE INSERT OR UPDATE OF body, body_delta ON comms.dm_messages` (no client `UPDATE` door exists;
the trigger covers one anyway, with categories sticky as on a stage message). Applies `comms.mask_pii` to the body — the same rules as the
stage-message filter (PRODUCT_SPEC §3 "Handover") — when the message falls under a protected
engagement: the project the message names, while it is protected, or else a protected project the
sender and the thread's other participant are both engaged in. "Protected" is
`projects.is_protected_phase` — the stage rooms' own predicate; status is not part of it, so an owner
setting `cancelled` does not lift the DM mask while the rooms stay masked (SEC L4 (c)). "Engaged" is
`projects.fn_engaged_projects`: owner, participant, an active member of the client business (SEC
L4 (a)), live assignee or team member,
pending/accepted invitee or applicant). Sets `pii_masked` / `pii_categories`, and — like the stage
filter `comms.tg_mask_message_pii` — sets `body_delta` to `NULL` whenever it rewrites the body: the
Delta spells the unmasked words, and masking it run by run would miss a contact detail split across
formatting runs, so a masked message renders plain. The helper and
`projects.fn_engaged_projects` are executable by NO client role — only the definer trigger reaches
them. `packages/types/comms/pii.ts` is the TypeScript twin, pinned to `comms.mask_pii`'s patterns by
`pii.contract.test.ts`.

**Verified by execution** inside `BEGIN … ROLLBACK` against the local Postgres as real roles: the
request routing with and without a mutual follow, an existing thread never re-filed, a deleted row
restored and re-filed, the reply promotion for the sender only, the folder door's two refusals, the
cold-message refusal, masking in a protected pair's DM and none in an unrelated one.

## The protected-phase contact filter (`00001300` / `00001840`, Decision #147)

Tier 2 — the authoritative tier — of the leakage-prevention pipeline (`SYSTEM_ARCHITECTURE.md`
§Messaging services → Contact & financial leakage prevention; `PRODUCT_SPEC.md` §Messaging 1.A).

### `comms.mask_pii(p_text text) → TABLE (masked text, categories text[])`

A pure masker: `IMMUTABLE`, not `SECURITY DEFINER`, reads no table and knows nothing about phases.
`NULL` or `''` is returned unchanged with `'{}'`. Otherwise four POSIX passes run **in this order**,
each replacing every match and appending its category once:

| # | Category       | Matches                                                                                           | Placeholder        |
| :- | :------------- | :------------------------------------------------------------------------------------------------ | :----------------- |
| 1 | `email`        | `local@domain.tld` (case-insensitive)                                                             | `[email hidden]`   |
| 2 | `payment_link` | PayPal · Venmo · Cash App · Zelle · Wise · Revolut · Monzo · Ko-fi · Buy Me a Coffee · `t.me` · `wa.me` · `telegram.me`, with or without scheme, plus the rest of the token | `[link hidden]`    |
| 3 | `handle`       | `$cashtag` (`$` + letter + 1+ word characters)                                                    | `[handle hidden]`  |
| 4 | `phone`        | 8+ characters of digits / spaces / `( ) . -`, optional leading `+` or `(`, digit at both ends     | `[phone hidden]`   |

Order is load-bearing: a payment URL can contain digits the phone pass would otherwise consume. The
phone pass also consumes any long digit run — a card number is masked as `phone`, and so is a long
numeric reference; there is no Luhn or confusable handling at this tier yet (Decision #147 flag (e)).
`packages/types/comms/pii.ts` is the TypeScript twin; `pii.contract.test.ts` pins its
`SQL_PII_PATTERNS` to this function verbatim, so a pattern edited on one side fails until the other
follows.

### `comms.tg_mask_message_pii()` — trigger

`BEFORE INSERT OR UPDATE OF body, body_delta ON comms.project_messages` (`trg_mask_message_pii`),
`SECURITY DEFINER`. An edit is masked like an insert (the sender's column grant reaches `body`), and
an edit's categories are added to the row's, never replacing them. Phase check:
resolves the channel's `project_id` from `comms.project_channels` and returns `NEW` untouched when
there is none or `projects.is_protected_phase(project)` is false — i.e. once
`projects.projects.handover_unlocked_at` is set (the final stage settling through
`projects.approve_stage`, or `projects.tg_project_handover_on_complete` on a force-completion). `is_protected_phase` defaults to **true** for an unknown
id, so a missing project fails toward masking. The DM equivalent is `comms.tg_mask_dm_message_pii`
above, which resolves the phase through `comms.fn_dm_protected_project`.

### `comms.fn_delta_text(p_delta jsonb) → text` — Delta agreement (SEC L2)

`IMMUTABLE`, `search_path = ''`, no client `EXECUTE` (the comms schema-wide revoke). The plain text a
stored Delta spells — its `ops` runs' `insert`s joined in order, the SQL twin of `messageDeltaText`
(`packages/types/projects/message-rich.ts`) — or `NULL` for anything that is not the normalised
shape `MessageDeltaSchema` admits: an `{ ops }` envelope and nothing else, each op an object with a
string `insert` and at most an `attributes` object of the four marks set to `true`.

Both mask triggers run it FIRST, on every write and in every phase: a `body_delta` beside an empty
body, or one whose text is not exactly `body`, is set to `NULL`. Before this, the mask read only
`body` and returned early on an empty one, so `body: "hi"` beside a Delta spelling a phone number
was stored verbatim and readable over PostgREST and realtime (Delta smuggling). Strict shape on
purpose: a key the renderer ignores is still stored and readable. Every writer already sends an
agreeing Delta and every read drops a disagreeing one, so the only Delta this removes is one no
reader would render.

**Masking contract (both triggers).** On any category hit, in one row write:

- `body` := the masked text — the original words are never stored;
- `body_delta` := `NULL` — the Delta spells the original, so the message renders plain;
- `pii_masked` := `true`, `pii_categories` := the categories in pass order.

No hit → the row is stored exactly as sent with `pii_masked = false`. The triggers never raise: a
protected-phase message is masked, not refused. Masking is one-way; nothing restores the original,
and the Projective Unlock does not unmask rows written before it.

**Other callers.** `projects.invite_to_project`, `projects.apply_to_project` and
`projects.redeem_invite_link` pass a request's free-text message through `comms.mask_pii` while the
project is protected, before it is stored on the request row or quoted in the owner's
notification.

**Gap — edits are not masked.** Both triggers fire on `INSERT` only. `comms.project_messages` is
editable by its sender through `edit_own_messages` (`00002012`, no column restriction), so a body —
or `pii_masked` itself — can be rewritten after the mask ran. Decision #147 flag (c).

## Replies stay in their room (`00001300` / `00001840`)

### `comms.tg_guard_message_reply()` · `comms.tg_guard_dm_message_reply()` — triggers

`reply_to_id` is a self-referencing foreign key ([Tables.md](Tables.md)), so the original is
guaranteed to exist and to be a message of the same table. What a key cannot say is that it sits in
the reply's own **channel** (`project_messages`) or **thread** (`dm_messages`) — and a reply quoting a
message from another room would show that room's words to readers who may not be cleared for it.

- `BEFORE INSERT OR UPDATE OF reply_to_id, channel_id` on `comms.project_messages` (`thread_id` on
  `comms.dm_messages`). The `UPDATE` arm exists because `edit_own_messages` lets a sender update their
  own project message ([Policies.md](Policies.md)); a guard on `INSERT` alone would be one `PATCH`
  away from bypassed.
- A `NULL` `reply_to_id` passes. Otherwise the original must exist in the same room and must not be
  the row itself, or the trigger raises **`check_violation` — "That message can't be replied to
  here."** — one sentence for every cause, so it cannot be used to probe which ids exist where.
  `refusalFrom` (`packages/backend/services/projects/live-writes.ts`) matches those words and reports
  a `422` on the `replyToId` field — the same refusal the fat services return from their own
  pre-check before inserting (`services/projects/message-replies.ts#replyRefusal`).
- A soft-deleted original is NOT refused: it still exists and is still in the room, and the reply's
  quote renders as unavailable.
- `SECURITY DEFINER`, `search_path = public, comms`: the rule is structural, so its lookup does not
  depend on what the inserting role's `SELECT` policy admits. `EXECUTE` is revoked from every client
  role (`00002510`) — a trigger function's `EXECUTE` is checked once, at `CREATE TRIGGER`.

**Not yet verified by execution** against a local Postgres (no database was run for this change):
the guard's refusal of a cross-room reply and of a self-reply, an `UPDATE` moving a reply out of its
room, a soft-deleted original accepted, and `body_delta` nulled by both mask triggers.

## The send: a message and its files in one write (`00001300`, CAS M15, M18; PROJECTS CH4)

### `comms.send_message(p_kind text, p_target_id uuid, p_body text, p_body_delta jsonb, p_reply_to_id uuid, p_project_id uuid, p_copies uuid[], p_links uuid[], p_audio jsonb) → uuid`

The one send door's write (`MessagingBackendService.sendMessage`, #508), for a stage room
(`p_kind 'room'` → `comms.project_messages` in room `p_target_id`) and a DM (`'dm'` →
`comms.dm_messages` in thread `p_target_id`, with `p_project_id` when the thread was opened inside a
project). In ONE transaction it writes the message, a `comms.message_attachments` row per file
(`p_copies` then `p_links`, in the order attached, a microsecond apart) and a `comms.channel_files`
row per file. It used to be three PostgREST calls whose second and third answers were never read, so a
refused link left a delivered message with nothing attached, reported as sent.

- **SECURITY INVOKER** (`search_path = ''`): it adds no authority. The INSERT policies of the four
  tables ([Policies.md](Policies.md)), the column grants (`00002520`), the DM shield, the reply guards
  and the PII mask all run as the caller, exactly as for the separate inserts. Granted to
  `authenticated` only (`00002510`).
- **Any refused link fails the whole send:** `PA422` "A file could not be attached to this message, so
  nothing was sent.", with the cause in DETAIL. The send door answers 422 with
  `errors.attachmentIds = "not_attached"`, and the composer keeps the draft.
- **The voice memo** (`p_audio` = `{attachmentId, durationMs, peaks}`): its file must be one of
  `p_copies`; a whole-millisecond length ≥ 0; at most 512 samples, each a number in 0..1. A malformed
  memo is refused `22023` `audio: …` before anything is written. Its length and envelope land on that
  file's own link row (`audio_duration_ms`, `audio_peaks`, [Tables.md](Tables.md)), which the feed
  rebuilds the player from after a reload. The message's `is_audio` and `has_attachments` are set
  from the arguments.
- Returns the new message id; the door reads the stored row back (the mask may have rewritten it).
- Probe: `supabase/probes/message_send.sql`.

## Conversation stars (`00001300`, Decision #180)

### `comms.set_dm_starred(p_thread_id uuid, p_starred boolean) → boolean`

`SECURITY DEFINER`, modelled on `comms.set_dm_inbox_folder`: `comms.dm_participants` has no client
`UPDATE` policy (a policy wide enough to write `is_starred` would also reach `last_read_at` and
`deleted_at`), so this door writes exactly the caller's own undeleted participant row and exactly
that column and its `starred_at` (stamped on a new star, kept on a repeat, cleared on un-star —
Decision #370). Idempotent. `42501` when there is no acting user or the caller is not a participant
(the service answers 404); `22023 starred: required` for a `NULL`. Granted to `authenticated` only.
Called by `MessagingBackendService.setStarred`, which `SavedBackendService` dispatches the
conversation kind to; the inbox reads the star back through `is_starred` as before.

### `comms.set_dm_muted(p_thread_id uuid, p_muted boolean) → boolean`

The mute twin of `set_dm_starred` (Decision #308): writes exactly the caller's own undeleted
participant row's `is_muted`. Idempotent. `42501` when there is no acting user or the caller is not
a participant (the service answers 404); `22023 muted: required` for a `NULL`. Granted to
`authenticated` only. Called by `MessagingBackendService.setMuted` (`POST
/api/messaging/conversations/[id]/mute`); the entity channel header is its first caller.

### `comms.mark_dm_read(p_thread_id uuid) → boolean`

CAS M10. `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` to `authenticated` only. Advances the
caller's own undeleted participant row's `last_read_at` to `now()` — the watermark the inbox's
`unread` compares the latest message against, which had no writer before, so every live thread
with a message was unread forever. It moves only when there is something to read past it (never
opened, or a message newer than the mark) and returns whether it moved, so the service drops the
tenant's inbox cache only then. `42501` with no acting user or for a caller who is not an undeleted
participant. Called by `MessagingBackendService.markRead` from `POST
/api/messaging/conversations/[id]/read`, which the chat island sends once the thread has painted in a
visible tab; the `/messages/[conversationId]` page's GET never calls it (PRD-C11). The live inbox projection also never counts the
viewer's own latest message as unread.

### Room read marks and the project's Private Messages (`00001300`, PROJECTS CH3; Decision #560)

| Function | Security | What it does |
| :------- | :------- | :----------- |
| `comms.mark_room_read(p_channel_id uuid) → boolean` | `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` to `authenticated` | The room twin of `mark_dm_read` (PRD-E13). Moves the caller's own `comms.project_channel_reads` mark to `now()` in a room they can read (`comms.has_channel_access`), only when there is something to read past it (never opened, or a message newer than the mark); true when it moved, so the service drops the reader's cached project reads only then. `42501` with no acting user or for a room the caller cannot read. Called by `MessagingBackendService.markChatRead` from `POST /api/projects/messages/read`, which the project chat island sends once the room has painted in a visible tab; no GET calls it (PRD-C11). |
| `comms.unread_rooms(p_project_id uuid) → SETOF uuid` | `SECURITY INVOKER`, `search_path = ''` | The project's rooms the caller can read that hold news for them: an undeleted message by somebody else newer than their mark in the room, or, in a room they never opened, newer than their first lane mark on the engagement (`projects.view_reads`, the `get_nav_activity` baseline: no lane mark, no news yet). RLS on rooms, messages and marks is the guard, so an unreadable or archived room never answers. The tree's per-room unread dot (`live-detail.ts` `withRoomUnread`). |
| `comms.project_dm_threads(p_project_id uuid) → TABLE (thread_id, ref, kind, title, last_stamped_at)` | `SECURITY INVOKER`, `search_path = ''` | The project's Private Messages group (#508 (e)–(g)): every undeleted thread of the caller's (dm · service_inquiry · group) holding an undeleted message stamped with the project **or** brought into it, and not taken out (`comms.dm_thread_projects`), one row per thread with its newest stamped or brought-in instant, newest first. Read thread by thread from the caller's own participant rows (one index probe each), replacing a scan capped at 500 stamped messages. `live-detail.ts` `fetchProjectDms`. |
| `comms.fn_dm_in_project(p_thread_id uuid, p_project_id uuid) → boolean` | `SECURITY DEFINER`, `search_path = ''`, **no client `EXECUTE`** | The rule the two doors below share with `project_dm_threads`: a stamped undeleted message or a bring-in, and no take-out. |
| `comms.bring_dm_into_project(p_project_id uuid, p_target_user_id uuid) → jsonb` | `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` to `authenticated` | The owner's ruling on stop 23: either participant brings their one-to-one conversation with another party to the project into its group. Refuses `42501` when the caller is not a party (`projects.fn_engaged_projects`), as if the project did not exist; `CH409` (a sentence the roster shows) when the other is not. The pair's thread is found or opened by `comms.get_or_create_dm_thread`, so the pair lock, the DM shield (`PM403`) and the self-DM refusal (`22023`) hold. A thread already in the group answers `moved: false` and tells nobody; otherwise the link is written (a past take-out cleared) and the other person gets `message.brought_into_project`, linking `/projects/<prj-slug>/<cht-ref>`. Answers `{ thread_id, thread_ref, moved }`. `MessagingBackendService.bringDmIntoProject`, `POST /api/projects/messages/dm` (the Members "Message" action). |
| `comms.take_dm_out_of_project(p_thread_id uuid, p_project_id uuid) → boolean` | `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` to `authenticated` | Either participant takes a one-to-one conversation out of the group, for both people; the stamps stay (no `dm_messages` write). True when it left the group, false when it was not in it. `42501` for a non-participant; `22023` for a group, which the pair door could not bring back. `MessagingBackendService.takeDmOutOfProject`, `DELETE /api/projects/messages/dm` (the room header's "Take out of this project"). |

### `comms.fn_lock_dm_pair(p_a uuid, p_b uuid) → void`

CAS M5. `pg_advisory_xact_lock` on a key derived from the ORDERED pair, held to the caller's
transaction end. `comms.get_or_create_dm_thread` and `comms.send_request_message` take it before
their select-then-insert, so two first messages between the same two people serialise and the second
finds the first one's thread; unrelated pairs never contend. No client `EXECUTE`. The row-level half
is `dm_participants_thread_user_key UNIQUE (thread_id, user_id)` ([Tables.md](Tables.md)).

## The inbox read model and project-stamped DMs (`00001300` / `00001840` / `00001890`, Decision #339 ruling N1)

One conversation per pair, drawn the same in the inbox and in its project (CAS §6.1). The two
message stores stay separate; what unifies them is the thread's `cht-` address (`dm_threads.ref`), a
summary of each thread's newest message that the inbox reads instead of every thread's messages (RED
D-04), and the project a DM is about, written on the message. Proven by
`supabase/probes/comms_thread_refs.sql`.

### `comms.inbox_tails(p_thread_ids uuid[], p_k integer DEFAULT 1) → TABLE (thread_id, id, sender_user_id, body, has_attachments, is_audio, created_at)`

`SECURITY INVOKER`, `STABLE`, `EXECUTE` to `authenticated` only (`00002510`). The newest `p_k`
undeleted messages of each listed thread, newest first by `(created_at, id)`, threads in the order
given; RLS on `dm_threads` / `dm_messages` is the guard, so a thread the caller is not in returns
nothing. `p_k` is clamped to 1..20, the list to its first 200 ids, and a repeated id is read once.
With `p_k = 1` it reads through `dm_threads.last_message_id` (a primary-key lookup), falling back to
the thread's own newest message when that one has been deleted since; a larger `p_k` walks
`idx_dm_messages_thread_recent`. Zod: `InboxTailRowSchema` (`@projective/types/messaging`).

### `comms.tg_dm_thread_summary()` — trigger

`AFTER INSERT ON comms.dm_messages` (`trg_dm_messages_thread_summary`). Points the thread's
`last_message_at` / `last_message_id` at the new message when `(created_at, id)` is newer than the
recorded pair, so seeds and out-of-order inserts never move it back; a message inserted already
deleted is skipped. `SECURITY DEFINER`, `search_path = ''`: the sender's role holds no `UPDATE` on
`comms.dm_threads` and `trg_dm_threads_derived` refuses it these columns, and the owner passes both.
One extra row update per message, on the thread's own row.

### `comms.tg_bind_dm_project()` — trigger

`BEFORE INSERT ON comms.dm_messages` (`trg_dm_messages_bind_project`, sorting before
`trg_dm_messages_mask_pii` so the mask reads the project settled here). A supplied `project_id` is
kept only when the sender **and every other undeleted participant** are parties to it
(`projects.fn_engaged_projects`, the predicate `comms.fn_dm_protected_project` derives with).
Otherwise it is derived with `comms.fn_dm_protected_project(thread, sender, NULL)`, a protected
project the sender and another member share, else left `NULL`, so no client can file a DM under a
project it is not on. An entity-channel message carries none: a channel is its entity's room, not a
project's conversation. `SECURITY DEFINER`, `search_path = ''`; neither lookup it makes is
client-executable. The mask functions are unchanged; a forged id now reaches them already replaced.

### `security.fn_ref_guard()` — trigger (`00001001`)

`trg_dm_threads_ref` (`00001890`): `BEFORE INSERT OR UPDATE ON comms.dm_threads` with
`TG_ARGV[0] = 'cht'`. `security.fn_slug_guard`'s contract on a column named `ref`, with one
difference: the insert **always** mints (`security.mint_slug`) and replaces a supplied value, so no
caller chooses a conversation's address; an update that moves it raises `23514`. `SECURITY DEFINER`
for the slug guard's reason (it calls the revoked `mint_slug`), revoked from `PUBLIC`. A second
small function rather than a column-name argument to the shared guard, whose closed body is what
makes it safe as a definer.

## Message favourites and pins (Decision #180)

No new function: `comms.message_favorites` (the caller's own, listed on `/saved`) and
`comms.message_pins` (room-wide) are written directly under the caller's JWT through their existing
policies (`user_id = auth.uid() AND comms.can_read_message(...)` and `pinned_by_user_id = auth.uid()
AND comms.can_read_message(...)`). `packages/backend/services/messaging/live-message-marks.ts` first
finds which message table holds the id, as the caller, so a message they cannot read is a 404.

## Direct-message shielding for under-18 accounts (`00001300`, Decision #208)

| Function | Bound as | Rule |
| :------- | :------- | :--- |
| `comms.fn_is_mutual_follow(p_a uuid, p_b uuid) → boolean` | — | Both `org.profile_follows` edges exist (`target_entity_type = 'user'`). |
| `comms.fn_dm_allowed(p_a uuid, p_b uuid) → boolean` | — | Always, unless either person is a minor — then only between mutual follows. |
| `comms.trg_dm_shield()` | `trg_dm_shield` BEFORE INSERT on `dm_participants` and `dm_messages` (`00001840`) | A participant joins a direct thread only if allowed with every participant already there; a message is sent only while its sender is allowed with every other participant, so an unfollow ends it. `PM403` otherwise — every thread-creating RPC (`get_or_create_dm_thread`, `create_group_thread`, `add_dm_thread_members`, `send_request_message`) and the direct insert alike. |

All `SECURITY DEFINER`, `search_path = ''`, granted to no client. The services map `PM403` to
`DM_SHIELD_REFUSAL` (403). Project and stage channels are a different table and unaffected. An
**entity channel** (Decision #306) is exempt: `trg_dm_shield` returns early for a thread of kind
`entity_channel`, because its people are the entity's roster, decided when they joined the entity.

## Entity channels (`00001300` / `00001840`, Decision #306)

A team's or business's named rooms are `comms.dm_threads` rows of kind `entity_channel` (columns in
[Tables.md](Tables.md#entity-channels-decision-306)). Every function below pins `search_path = ''`.
The doors follow the workspace refusal convention (`'<field>: <reason>'`, mapped by `refusalFrom` in
`packages/backend/services/workspace/live-support.ts`).

**Why the two doors are `SECURITY DEFINER`.** `dm_threads` / `dm_participants` carry no client write
policy on purpose (`00002012`), and creating a channel writes participant rows for OTHER people —
every active member — which no `INSERT` policy may admit without becoming "anyone may add anyone to
anything". The created row is also not readable to its creator (the `RETURNING` the door needs)
until the participant trigger has run. So, like `create_group_thread`, the membership decision is
made here, once: each door re-checks the caller's active seat (`org.fn_member_seat`).

### `comms.create_entity_channel(p_entity_type text, p_entity_id uuid, p_name text, p_topic text DEFAULT NULL) → jsonb`

Any **active member** of a team or business that is not archived. The name is normalised by
`comms.fn_channel_slug` (trimmed, a leading `#` dropped, lowercased) and then held to the slug rule.
Refusals, in order: `42501 auth:` (signed out) · `22023 kind:` · `P0002 workspace: not found` ·
`42501 workspace: only its members can add a channel` · `55000 workspace: restore it before adding a
channel` · `22023 name:` (the rule) · `22023 topic:` (> 200) · `23505 name: there is already a #… channel`
(a live duplicate) · `55000 channel: a workspace holds at most 30 channels …` (`CHANNEL_LIVE_CAP`). The
duplicate and cap checks run under `pg_advisory_xact_lock` on the entity, so two concurrent creates
cannot both take the last place. Returns `{ id, slug, topic, is_default: false, unread: 0,
last_activity_at: null }`. Participants come from `trg_entity_channel_seed_members`. `EXECUTE`:
`authenticated`, `service_role`.

### `comms.archive_entity_channel(p_channel_id uuid) → jsonb`

Sets `archived_at`. The channel's **creator**, or a member holding `manage_settings`. A channel the
caller cannot see — not an active member of its entity, already archived, or not a channel — is one
answer, `P0002 channel: not found`, so the door cannot probe ids. `55000` for the default channel;
`42501 channel:` for anybody else. Returns `{ id, owner_type, owner_entity_id, archived_at }`.
`EXECUTE`: `authenticated`, `service_role`.

### `comms.update_entity_channel(p_channel_id uuid, p_name text, p_topic text, p_emoji text) → jsonb`

Decision #308. Replaces a channel's display name (`title`, ≤ 60), topic (≤ 200) and emoji (≤ 16); a
blank or `NULL` field clears it. The **slug never changes**, so a rename breaks no link. The channel's
creator or a `manage_settings` holder (`comms.fn_can_manage_entity_channel`), on an entity that is not
archived; the default channel may be renamed like any other. Refusals: `42501 auth:` · `P0002 channel:
not found` (not a member, archived, not a channel — one answer, as on archive) · `42501 channel:` (no
edit right) · `55000 workspace: restore it before editing a channel` · `22023 name:` / `topic:` /
`emoji:`. Returns `{ id, slug, name, topic, emoji }`. `EXECUTE`: `authenticated`, `service_role`.

**Verified by execution** inside `BEGIN … ROLLBACK` as real roles (2026-10-20): the owner renames,
sets a topic and an emoji, mutes and stars; the list projection carries all five; a member of another
team is `P0002`; `anon` holds no `EXECUTE`; a 61-character name is `22023`; blanks clear every field.

### Internals (granted to no client)

| Function | Role |
| :------- | :--- |
| `comms.fn_channel_slug(p_name text) → text` | IMMUTABLE normaliser; TS twin `channelSlugOf` (pinned by `workspace.contract.test.ts`). Granted to `authenticated` (pure). |
| `comms.fn_entity_member_ids(p_kind text, p_entity uuid) → SETOF uuid` | The entity's active members who have an `org.users_public` row (the participant FK). |
| `comms.fn_entity_channel_list(p_kind text, p_entity uuid, p_viewer uuid) → jsonb` | The live channels for one viewer — default first, then by slug — each `{ id, slug, topic, is_default, unread, last_activity_at, name, emoji, photo_file_id, starred, muted, can_manage }`: `unread` counts other people's undeleted messages after the viewer's `last_read_at` (all of them while it is NULL). Read only by `org.get_workspace_detail` (`channels`), which has already decided the viewer is an active member. |
| `comms.fn_can_manage_entity_channel(p_channel_id uuid, p_user uuid) → boolean` | Decision #308. Whether a user may edit or archive a LIVE entity channel: an active member who created it, or one holding `manage_settings`. STABLE DEFINER; read by `update_entity_channel`, `set_group_photo` and `fn_entity_channel_list` (`can_manage`). |
| `comms.fn_ensure_default_channel(p_kind, p_entity, p_creator) → uuid` | The entity's `general`, created when missing (DEFINER). NULL, creating nothing, when the creator has no `org.users_public` row — the entity's own insert is never refused for it. The seed backfill calls it for every entity. |
| `comms.fn_sync_channel_member(p_kind, p_entity, p_user, p_active boolean)` | Joining: restores a soft-deleted participation and inserts the missing ones, on LIVE channels. Leaving: soft-deletes the participation on EVERY channel of the entity, archived included. |
| `comms.tg_entity_channel_seed_members()` | `trg_entity_channel_seed_members` AFTER INSERT ON `comms.dm_threads` `WHEN (NEW.kind = 'entity_channel')`: every active member joins. |
| `comms.tg_entity_member_channels()` | `trg_team_member_channels` / `trg_business_member_channels` AFTER INSERT OR UPDATE OF `status` on `org.team_members` / `org.business_members` (`TG_ARGV[0]` = the kind): a membership becoming active joins, one leaving active leaves. |
| `comms.tg_entity_default_channel()` | `trg_team_default_channel` / `trg_business_default_channel` AFTER INSERT on `org.teams` / `org.business_profiles`: the `general` channel. |

### What an entity channel is excluded from

| Path | Change |
| :--- | :----- |
| `comms.get_or_create_dm_thread`, `comms.send_request_message` | The pair lookup reads `kind IN ('dm', 'service_inquiry')` (was `<> 'group'`), so two co-members' channel is never "their DM" and a hiring request never lands in a channel. |
| `comms.fn_promote_thread_on_reply` | Returns early for a channel (no request folder to promote). |
| `comms.tg_dm_auto_reply` | Answers only `dm` / `service_inquiry` threads. |
| `comms.trg_dm_shield` | Exempt (above). |
| `comms.add_dm_thread_members` | Refuses a channel (`22023`) — joining the entity is the only way in — and, since Decision #482, a `service_inquiry` too. `comms.set_group_photo` accepts a channel only from its editors (Decision #308). |
| `comms.tg_mask_dm_message_pii` | **Unchanged**: a channel message is masked when the sender and another member share a protected engagement (`comms.fn_dm_protected_project`) — the same rule as a DM. Flagged on Decision #306. |
