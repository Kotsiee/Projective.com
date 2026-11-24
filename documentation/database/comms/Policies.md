# comms: Policies

RLS policies for the `comms` schema. Tables: [Tables.md](Tables.md) · Functions:
[Functions.md](Functions.md).

---

## ⚠️ The bug this domain's policies fix

`comms.notifications`, `comms.notification_prefs` and `comms.device_tokens` have had **row level
security enabled since migration 0201 and zero policies ever since**. RLS with no policy is
**default-deny**, so `authenticated` could not read a single notification — and because Supabase
Realtime enforces the same `SELECT` policy before it will emit a row, the in-app channel could never
have delivered anything, even though the table has been in the `supabase_realtime` publication since
migration 0206.

Migration `20260724094000_comms_notification_rls_jobs.sql` is what makes the in-app channel actually
work.

---

## Notification engine

### `comms.notifications`

| Policy                                | Command  | Rule                                               |
| :------------------------------------ | :------- | :------------------------------------------------- |
| _Users view own notifications_        | `SELECT` | `user_id = auth.uid()`                             |
| _Users update own notification state_ | `UPDATE` | `USING` / `WITH CHECK` both `user_id = auth.uid()` |

**No `INSERT` policy and no `DELETE` policy — deliberately.**

- **INSERT** — a notification is written only by `comms.fn_notify` (SECURITY DEFINER) or the service
  role. A client that could insert could spoof _"Payout sent"_ to itself or to anyone else.
- **DELETE** — nothing is hard-deleted (root CLAUDE.md §5); dismissing sets `archived_at` through
  the `UPDATE` policy.

The `WITH CHECK` clause on the update policy is what stops a client rewriting `user_id` to hand its
notification to someone else. Both refusals are verified: a forged insert and a reassignment attempt
each fail with _"new row violates row-level security policy"_.

**Which columns** the policy admits is a GRANT question, not a policy one. `00002500` grants `ALL`
on every comms table to `authenticated`, so the own-row policy alone let a recipient rewrite their
own `title`, `body`, `action_url` — forging a platform message inside the trusted inbox. `00002520`
§2 revokes table-level `UPDATE` and grants `UPDATE (read_at, seen_at, archived_at)` only; any other
column fails with `42501` _permission denied_. The writer (`comms.fn_notify`, SECURITY DEFINER) is
unaffected. Proven by `supabase/probes/comms_column_grants.sql`.

**The service role** has `USAGE` on the schema (`00002500`, Decision #344 (a)), which the notification
dispatcher needs to call `comms.fn_claim_deliveries`, `fn_record_delivery_result` and
`fn_dispatch_enabled`; `00002510` gives it `EXECUTE` on every comms function. Before the dispatcher no
service-role caller reached `comms`, and the grant was missing. Proven by
`supabase/probes/comms_dispatch.sql` §0.

### Preferences — full self-service, scoped to the owner

| Table                               | Commands                     | Rule                   |
| :---------------------------------- | :--------------------------- | :--------------------- |
| `comms.notification_prefs`          | `SELECT`, `INSERT`, `UPDATE` | `user_id = auth.uid()` |
| `comms.notification_category_prefs` | `ALL`                        | `user_id = auth.uid()` |
| `comms.notification_type_mutes`     | `ALL`                        | `user_id = auth.uid()` |

A mute row on a `mandatory` catalog type is _accepted_ by RLS and _ignored_ by the router — the
enforcement lives in `comms.fn_resolve_channels`, not in a policy, so the preference centre can
still show the user what they tried to mute.

### `comms.notification_types` (the catalog)

`SELECT` to `authenticated` where `enabled OR security.is_admin()` — the preference centre renders
from it. Writes are service-role/definer only: the catalog is **platform policy, not user data**.

### `comms.device_tokens`

`SELECT` / `INSERT` / `UPDATE` / `DELETE`, all `user_id = auth.uid()`.

A hard `DELETE` **is** allowed here, unlike a notification: un-registering a browser should
genuinely remove its push credentials. `comms.revoke_device` remains the preferred path — it keeps
the audit row and clears the keys.

### Delivery, queue, digests, suppressions — read-own, write-never

| Table                           | Command  | Rule                                                     |
| :------------------------------ | :------- | :------------------------------------------------------- |
| `comms.notification_deliveries` | `SELECT` | `user_id = auth.uid() OR security.is_admin()`            |
| `comms.notification_queue`      | `SELECT` | `user_id = auth.uid() OR security.is_admin()`            |
| `comms.notification_digests`    | `SELECT` | `user_id = auth.uid() OR security.is_admin()`            |
| `comms.channel_suppressions`    | `SELECT` | `user_id = auth.uid() OR security.is_admin()`            |
| `comms.delivery_events`         | —        | **No `authenticated` policy at all.** Service role only. |

Suppressions are readable by their owner so the settings screen can explain _"we stopped emailing
you because your address hard-bounced"_. Raw gateway callbacks are operational data and are never
exposed to a client.

### Views

`comms.notification_feed`, `comms.notification_unread_counts` and
`comms.notification_delivery_health` are all declared `WITH (security_invoker = true)`, so the
caller's RLS decides visibility. A view must never become a privilege-escalation hole (root
CLAUDE.md §6 — RLS is always on).

---

## Messaging

| Policy                                | Table                                | Command  | Rule                                                            |
| :------------------------------------ | :----------------------------------- | :------- | :-------------------------------------------------------------- |
| _view_channels_if_member_             | `comms.project_channels`             | `SELECT` | `archived_at IS NULL` **AND** `comms.has_channel_access(id)` — Decision #163 |
| _view_messages_if_member_             | `comms.project_messages`             | `SELECT` | `comms.has_channel_access(channel_id)`                          |
| _send_messages_if_member_             | `comms.project_messages`             | `INSERT` | `sender_user_id = auth.uid()` **AND** channel access            |
| _(none)_                              | `comms.project_messages`, `comms.dm_messages` | `UPDATE` | No policy and no privilege: `comms.edit_message` / `comms.delete_message` are the only writers (PROJECTS CH1) |
| _(none)_                              | `comms.message_revisions`            | all      | RLS on, no policy, no grant: evidence the doors write and only definers read (PROJECTS CH1) |
| _view_attachments_if_member_          | `comms.message_attachments`          | `SELECT` | Channel access (project messages) or DM participation           |
| _Users link own message attachments_  | `comms.message_attachments`          | `INSERT` | Only for a message the caller sent, and only for a file the caller can already read (`files.fn_can_read`) — Decision #132 |
| _view_channel_files_if_member_        | `comms.channel_files`                | `SELECT` | Channel access (`'project'`) or DM participation (`'dm'`)       |
| _register_channel_files_if_member_    | `comms.channel_files`                | `INSERT` | Same predicate as the read                                      |
| _view_channel_participants_if_member_ | `comms.project_channel_participants` | `SELECT` | `comms.has_channel_access(channel_id)`                          |
| _view_own_room_reads_                 | `comms.project_channel_reads`        | `SELECT` | `user_id = auth.uid()` — one's own room read mark only (PROJECTS CH3). No write policy and no client write privilege (`00002520`): `comms.mark_room_read` is its one writer |

Private-channel scoping and the PII handover gate are layered on top by migration 0311
(`comms.can_access_scope`, `comms.has_channel_access`). A `team_private` room is read by the active
members of the one team it names (`project_channels.team_id`) only, a `business_private` room by the
client side only (Decision #561); a released seat's holder reads neither, old messages included.

An archived room (`archived_at`, set by `projects.sanitize_single_room_topology` — Decision #163) is
filtered in `view_channels_if_member` only, never in `comms.has_channel_access`: the room stops being
listed, while its messages, attachments and channel files stay readable as history.

### ⚠️ The sender pin on `send_messages_if_member`

Channel access answers _"may this person post here"_. It says nothing about **whose name goes on the
message**. Without `sender_user_id = auth.uid()` any member of a channel could insert a row
attributed to another member of the same channel — and a chat message is read as a statement its
named author made, so that is impersonation inside the one surface where a client and a freelancer
negotiate scope and agree changes. The feed renders the claimed sender verbatim; nothing downstream
can tell the difference.

### No `UPDATE` policy on either message table (PROJECTS CH1, Decision #562)

Editing and deleting are the author's own acts and go through two definers in `00001300`,
`comms.edit_message` and `comms.delete_message` ([Functions.md](Functions.md#editing-and-deleting-a-message-00001300--00001840-projects-ch1)).
They hold what no policy could: the edit window, the freeze (an archived room or thread, a stage's
rooms and the project's General room while a dispute on the stage is live) and the evidence (the
replaced words go to `comms.message_revisions` first). The `edit_own_messages` policy they replaced let
a sender rewrite their own room message by a raw PostgREST `UPDATE` at any age, in an archived room or
mid-dispute, and the words were lost; its `WITH CHECK` arm (authorship re-asserted on the post-image)
and its column grant went with it. `00002520` revokes `UPDATE` on both message tables from
`authenticated`, so a direct write is refused `42501` rather than passing a policy (`project_messages`)
or silently matching no row (`dm_messages`). The archive gate T&S P2d planned for this policy (G5)
is the doors' `PM423`.

INSERT is column-scoped the same way (SEC L5, `00002520` §2): `authenticated` holds `INSERT
(channel_id, sender_user_id, body, body_delta, reply_to_id, has_attachments, is_audio)` on
`comms.project_messages` and the same plus `project_id` / `service_id` on `comms.dm_messages`. The
`INSERT` policies say who may post into a room, never which columns a post may set, so the blanket
grant let a client backdate `created_at` (dispute evidence), set `edited_at` / `deleted_at`, or
write `pii_masked` / `pii_categories`, which the mask triggers own. The definer doors run as their
owner and are unaffected.

Soft delete is `comms.delete_message`'s (`deleted_at`, a tombstone row); nothing here is
hard-deleted (root `CLAUDE.md` §5).

A REPLY stays in its room by trigger, not policy: `comms.tg_guard_message_reply` fires `BEFORE INSERT
OR UPDATE OF reply_to_id, channel_id` (see [Functions.md](Functions.md)), and `comms.dm_messages`
carries the same guard. No door rewrites either column, so today it guards inserts.

### `comms.channel_files` — the register a channel file is listed in

The table had `SELECT` and nothing else, so a channel attachment could be read and never recorded —
which is exactly what the message-send path has to do. An attachment reaches the Files tab through
this table, so without an `INSERT` policy a file sent in a channel is visible in its message and
absent from the channel's own file list. The write predicate is the read predicate: the right to put
a file into a room is the right to be in it.

### 🚩 Two discriminator vocabularies for one concept

`comms.channel_files.channel_type` is the **bare** `'project'` / `'dm'` pair. Its siblings —
`message_attachments`, `message_reactions`, `message_pins`, `message_favorites` — discriminate on
the **schema-qualified** `'comms.project_messages'` / `'comms.dm_messages'` pair, which is what
`comms.can_read_message()` matches on.

Matching the wrong one **returns zero rows and raises nothing**, so the failure surfaces as a
silently empty file list rather than an error anybody would chase. Check which table you are writing
a predicate against before copying one.

---

## DM stack and message interactions

Added by Decisions #82/#83; summarised here so this file is not read as the whole policy set.

| Table                            | Read                                 | Write                                                     |
| :------------------------------- | :----------------------------------- | :-------------------------------------------------------- |
| `comms.dm_participants`          | **Own row only.**                    | —                                                         |
| `comms.dm_thread_projects`       | `comms.is_dm_participant(thread_id)` | — (and no write privilege, `00002520`): `comms.bring_dm_into_project` / `take_dm_out_of_project` only (Decision #560) |
| `comms.dm_threads`               | `comms.is_dm_participant(id)`        | — (and no `INSERT` / `UPDATE` privilege, `00002520`)      |
| `comms.dm_messages`              | `comms.is_dm_participant(thread_id)` | `INSERT` as self into a thread one is a member of.        |
| `comms.message_reactions`        | `comms.can_read_message(...)`        | `INSERT` as self on a readable message; `DELETE` own row. |
| `comms.message_pins`             | `comms.can_read_message(...)`        | `INSERT` as self; `DELETE` by anyone who can read it.     |
| `comms.message_favorites`        | Own row only.                        | `INSERT` as self on a readable message; `DELETE` own row. |
| `comms.auto_responses`           | Own row only.                        | Four separate policies so `UPDATE` carries both arms.     |

`comms.dm_participants` is own-row-only on purpose: RLS is row-level, and every private per-viewer
field (`last_read_at`, `is_starred`, `is_archived`, `is_muted`, `deleted_at`) lives on that row, so
returning a co-participant's row discloses whether they muted, archived or deleted the conversation
and exactly when they last read it. The roster the inbox actually needs is identity, not state, and
is served by `comms.dm_thread_roster()` — three columns, none of them state.

`comms.dm_messages` carries the inbox's one write (`send_dm_messages_if_participant`): a participant
may post into their own thread, with `sender_user_id` pinned to `auth.uid()` for the same reason the
`comms.project_messages` INSERT pins it — membership says who may post, not whose name goes on the
row. Its third arm refuses a thread with `archived_at` set — an archived **entity channel**
(Decision #306) keeps its history readable to its participants but takes no new message. The arm
reads `comms.dm_threads` as the caller, whose own participation already admits the row. The post's
`project_id` is not the client's to choose: `comms.tg_bind_dm_project` keeps a supplied one only
when everyone in the thread is party to it, and otherwise derives it ([Functions.md](Functions.md)).

`comms.dm_threads` takes **no client write at the privilege layer** either (`00002520`, ruling N1 of
Decision #339): every thread is written by a definer door, so `authenticated` holds no `INSERT` or
`UPDATE` on the table and no column is granted back. Its `cht-` `ref` and its derived summary
(`last_message_at`, `last_message_id`) belong to their triggers; a client write naming any column is
refused with `42501` rather than an `UPDATE` RLS quietly matches to no row, and
`trg_dm_threads_derived` still refuses the summary should an `UPDATE` policy ever be added.
`comms.inbox_tails` is `SECURITY INVOKER`, so these read policies are its whole guard.

Entity channels need no policy of their own: a channel's `dm_participants` rows ARE the entity's
active members (trigger-maintained, [Functions.md](Functions.md#entity-channels-00001300--00001840-decision-306)),
so `view_dm_threads_if_participant`, `view_dm_messages_if_participant`, the send policy and every
`comms.can_read_message` policy already answer "is this person a member of the entity". A member who
leaves has their participation soft-deleted, which `comms.is_dm_participant` reads as gone.

**History before `joined_at` (PRD-C33, Decision #482 (b)).** `view_dm_messages_if_participant` asks
membership only, so a person added to a group reads every message written before they arrived.
The owner ruled (2026-11-18) that a group newcomer reads only from their own `joined_at`; an entity
channel keeps its whole history, being the workspace's record. **Not built yet:** the policy,
`comms.can_read_message` (reactions, pins, favourites, attachments), the attachment file read, the
thread summary preview and unread counts all still admit earlier messages. A service inquiry can no
longer gain a newcomer at all (`comms.add_dm_thread_members`, #482 (a)).

The thread and both participant rows are minted by `comms.get_or_create_dm_thread` (SECURITY
DEFINER), so a first message never has to insert into a thread the caller is not yet a member of.
Joining, marking read, starring and archiving remain policy-less on purpose — nothing exercises them.

`comms.message_pins` `DELETE` is deliberately **not** restricted to the pinner: the UNIQUE carries
no `user_id`, so a pin is channel-wide, and in a two-person DM the counterparty must be able to
clear one.

The newsletter opt-in, once `comms.newsletter_subscriptions`, moved to
`community.newsletter_subscriptions` (Decision #274). It still has no policy, deliberately, and now no
client privilege either — see [community/Policies.md](../community/Policies.md#newsletter).
