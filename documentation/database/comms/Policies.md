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
| _view_channels_if_member_             | `comms.project_channels`             | `SELECT` | `comms.has_channel_access(id)`                                  |
| _view_messages_if_member_             | `comms.project_messages`             | `SELECT` | `comms.has_channel_access(channel_id)`                          |
| _send_messages_if_member_             | `comms.project_messages`             | `INSERT` | `sender_user_id = auth.uid()` **AND** channel access            |
| _edit_own_messages_                   | `comms.project_messages`             | `UPDATE` | Both arms: `sender_user_id = auth.uid()` **AND** channel access |
| _view_attachments_if_member_          | `comms.message_attachments`          | `SELECT` | Channel access (project messages) or DM participation           |
| _Users link own message attachments_  | `comms.message_attachments`          | `INSERT` | Only for a message the caller sent                              |
| _view_channel_files_if_member_        | `comms.channel_files`                | `SELECT` | Channel access (`'project'`) or DM participation (`'dm'`)       |
| _register_channel_files_if_member_    | `comms.channel_files`                | `INSERT` | Same predicate as the read                                      |
| _view_channel_participants_if_member_ | `comms.project_channel_participants` | `SELECT` | `comms.has_channel_access(channel_id)`                          |

Private-channel scoping and the PII handover gate are layered on top by migration 0311
(`comms.can_access_scope`, `comms.has_channel_access`).

### ⚠️ The sender pin on `send_messages_if_member`

Channel access answers _"may this person post here"_. It says nothing about **whose name goes on the
message**. Without `sender_user_id = auth.uid()` any member of a channel could insert a row
attributed to another member of the same channel — and a chat message is read as a statement its
named author made, so that is impersonation inside the one surface where a client and a freelancer
negotiate scope and agree changes. The feed renders the claimed sender verbatim; nothing downstream
can tell the difference.

### `edit_own_messages` — and why the `WITH CHECK` arm is the half that matters

`comms.project_messages` carried `edited_at` and `deleted_at` with **no `UPDATE` policy**, so both
were unwritable by any client and the edit path was silently impossible rather than refused.

The `WITH CHECK` arm re-asserts authorship on the **post-image**. A `USING` clause alone validates
the row you started from, so a sender could edit their own message and set `sender_user_id` to
somebody else in the same statement — turning their own words into that person's, which is the
impersonation the `INSERT` policy closes, reached from the other side. Channel access is re-checked
so an edit cannot outlive the sender's membership of the room.

Soft delete goes through this same policy (`deleted_at`); nothing here is hard-deleted (root
`CLAUDE.md` §5).

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
| `comms.dm_threads`               | `comms.is_dm_participant(id)`        | —                                                         |
| `comms.dm_messages`              | `comms.is_dm_participant(thread_id)` | —                                                         |
| `comms.message_reactions`        | `comms.can_read_message(...)`        | `INSERT` as self on a readable message; `DELETE` own row. |
| `comms.message_pins`             | `comms.can_read_message(...)`        | `INSERT` as self; `DELETE` by anyone who can read it.     |
| `comms.message_favorites`        | Own row only.                        | `INSERT` as self on a readable message; `DELETE` own row. |
| `comms.auto_responses`           | Own row only.                        | Four separate policies so `UPDATE` carries both arms.     |
| `comms.newsletter_subscriptions` | —                                    | — **No policy, deliberately.**                            |

`comms.dm_participants` is own-row-only on purpose: RLS is row-level, and every private per-viewer
field (`last_read_at`, `is_starred`, `is_archived`, `is_muted`, `deleted_at`) lives on that row, so
returning a co-participant's row discloses whether they muted, archived or deleted the conversation
and exactly when they last read it. The roster the inbox actually needs is identity, not state, and
is served by `comms.dm_thread_roster()` — three columns, none of them state.

`comms.message_pins` `DELETE` is deliberately **not** restricted to the pinner: the UNIQUE carries
no `user_id`, so a pin is channel-wide, and in a two-person DM the counterparty must be able to
clear one.

`comms.newsletter_subscriptions` is default-deny and reachable only through the service-role key.
That is **not** the same shape as the DM-stack bug: nothing should read this table as a user,
because every row is an email address paired with a `token` that is the unsubscribe capability. Read
the note above the absent policy in `00002012` before adding one.
