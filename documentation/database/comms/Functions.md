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
explicit `auth.uid()` predicates are belt-and-braces. They write only `read_at` / `seen_at` /
`archived_at`, the three columns `authenticated` holds `UPDATE` on (`00002520` §2). The app reaches
the first five through `NotificationInboxBackendService` (`/api/notifications/*`).

**Not granted to `authenticated`:** `fn_notify`, `fn_notify_many`, `fn_enqueue`, `fn_cancel_queued`,
`fn_process_queue`, `fn_resolve_channels`, `fn_is_quiet_hours`, `fn_is_suppressed`. A client that
could call `fn_notify` could spoof any notification to any user; one that could call
`fn_process_queue` could force-send every pending reminder.

---

## Scheduled jobs (`pg_cron`)

> ⚠️ **None of these jobs is registered** (Decision #203 flag (a)): no migration has ever scheduled
> them, so the table below is the intended cadence, not running work. Every recurring job is now a
> row of `ops.scheduled_jobs` (`00005060`); registering one of these is one row there, and it then
> runs in every environment and can be run by hand with `deno task cron:run <job>`. See
> `SYSTEM_ARCHITECTURE.md` §Scheduled jobs.

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
| `trg_mask_message_pii`                       | `comms.project_messages` | `comms.tg_mask_message_pii()`   |
| `trg_project_messages_guard_reply`           | `comms.project_messages` | `comms.tg_guard_message_reply()` |
| `trg_dm_messages_mask_pii`                   | `comms.dm_messages`   | `comms.tg_mask_dm_message_pii()`   |
| `trg_dm_messages_promote_on_reply`           | `comms.dm_messages`   | `comms.fn_promote_thread_on_reply()` |
| `trg_dm_messages_guard_reply`                | `comms.dm_messages`   | `comms.tg_guard_dm_message_reply()` |

Every message trigger is `BEFORE` (`00001840`). The mask and promotion triggers fire on `INSERT`
and are documented under §Inbox folders, hiring requests & the DM contact filter below; the two
reply guards fire on `INSERT` and on `UPDATE OF reply_to_id` plus the room column, and are documented
under §Replies stay in their room.

`seed_notification_prefs` mirrors `org.seed_user_preferences` (Decision #47) — a focused
`AFTER INSERT` trigger under a **separate name**, so the existing `on_users_public_created` trigger
is untouched. It calls `comms.fn_seed_notification_prefs(p_user_id uuid, p_meta jsonb)` with the
sign-up metadata (`org.fn_signup_meta`), which inserts the row and, only when it is new, sets
`timezone` to the profile's zone, else the sign-up `timezone` hint — only a zone Postgres resolves,
because quiet hours and digests run `AT TIME ZONE` it, otherwise the `UTC` default — and `locale` to
the supported sign-up locale (`org.fn_supported_locale`), else `NULL` (Decision #207). An invoker
function: a client calling it directly meets the INSERT-own policy. `org.seed_owner_preferences` calls
it for an enterprise owner who already has a profile row ([org/Functions.md](../org/Functions.md)).
`comms.fn_ensure_notification_prefs(user_id)` is the callable defaults-only equivalent.

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
| `comms.get_stage_channels(uuid)`           | 0311      | Channels visible for a stage. Skips an archived stage or room and never provisions a Session's stage rooms (Decision #163). |
| `comms.get_or_create_project_channel(...)` | 0112      | Idempotent project-channel provisioning.  |
| `comms.get_or_create_dm_thread(target_user_id, p_subject_listing DEFAULT NULL)` | 0113      | Idempotent DM-thread provisioning. Excludes `group` threads since Decision #102 — a group holding both people is not their DM. With `p_subject_listing` (Decision #217(g)) the listing must be PUBLISHED and owned by the recipient (`22023` otherwise); a thread this call opens is a `service_inquiry` with that `subject_listing_id`, an existing inquiry without a subject gains it, and a thread already under way keeps its kind (one record per pair). |

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
inbox. A plain `dm` thread that ends up with more than two participants is flipped to `group`; a
`service_inquiry` keeps its kind. Raises `42501` ("Not a participant of this conversation") for a
stranger.

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
characters. It finds the pair's non-group thread or creates one, restores a participant row the
recipient had deleted, and — only when the request OPENS the thread (created, empty, or restored
from the recipient's deletion) — files it: the recipient's row in `requests` unless the two follow
each other (`org.profile_follows` both ways), the sender's in `primary`. An existing conversation is
never re-filed. The message is inserted with `project_id`, so the contact filter applies to it.
Returns `{ thread_id, message_id, opened, routed_to }`.

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

`BEFORE INSERT ON comms.dm_messages`. Applies `comms.mask_pii` to the body — the same rules as the
stage-message filter (PRODUCT_SPEC §3 "Handover") — when the message falls under a protected
engagement: the project the message names, while its handover is locked, or else a protected (`draft` / `active` /
`on_hold`, handover not unlocked) project the sender and the thread's other participant are both
engaged in (`projects.fn_engaged_projects`: owner, participant, live assignee or team member,
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

`BEFORE INSERT ON comms.project_messages` (`trg_mask_message_pii`), `SECURITY DEFINER`. Phase check:
resolves the channel's `project_id` from `comms.project_channels` and returns `NEW` untouched when
there is none or `projects.is_protected_phase(project)` is false — i.e. once
`projects.projects.handover_unlocked_at` is set (the final stage settling through
`projects.approve_stage`, or `projects.tg_project_handover_on_complete` on a force-completion). `is_protected_phase` defaults to **true** for an unknown
id, so a missing project fails toward masking. The DM equivalent is `comms.tg_mask_dm_message_pii`
above, which resolves the phase through `comms.fn_dm_protected_project`.

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

## Conversation stars (`00001300`, Decision #180)

### `comms.set_dm_starred(p_thread_id uuid, p_starred boolean) → boolean`

`SECURITY DEFINER`, modelled on `comms.set_dm_inbox_folder`: `comms.dm_participants` has no client
`UPDATE` policy (a policy wide enough to write `is_starred` would also reach `last_read_at` and
`deleted_at`), so this door writes exactly the caller's own undeleted participant row and exactly
that column. Idempotent. `42501` when there is no acting user or the caller is not a participant
(the service answers 404); `22023 starred: required` for a `NULL`. Granted to `authenticated` only.
Called by `MessagingBackendService.setStarred`, which `SavedBackendService` dispatches the
conversation kind to; the inbox reads the star back through `is_starred` as before.

### `comms.set_dm_muted(p_thread_id uuid, p_muted boolean) → boolean`

The mute twin of `set_dm_starred` (Decision #308): writes exactly the caller's own undeleted
participant row's `is_muted`. Idempotent. `42501` when there is no acting user or the caller is not
a participant (the service answers 404); `22023 muted: required` for a `NULL`. Granted to
`authenticated` only. Called by `MessagingBackendService.setMuted` (`POST
/api/messaging/conversations/[id]/mute`); the entity channel header is its first caller.

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
| `comms.add_dm_thread_members` | Refuses a channel (`22023`) — joining the entity is the only way in. `comms.set_group_photo` accepts a channel only from its editors (Decision #308). |
| `comms.tg_mask_dm_message_pii` | **Unchanged**: a channel message is masked when the sender and another member share a protected engagement (`comms.fn_dm_protected_project`) — the same rule as a DM. Flagged on Decision #306. |
