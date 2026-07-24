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

| Policy                                | Command  | Rule                                             |
| :------------------------------------ | :------- | :----------------------------------------------- |
| _Users view own notifications_        | `SELECT` | `user_id = auth.uid()`                           |
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

A hard `DELETE` **is** allowed here, unlike a notification: un-registering a browser should genuinely
remove its push credentials. `comms.revoke_device` remains the preferred path — it keeps the audit
row and clears the keys.

### Delivery, queue, digests, suppressions — read-own, write-never

| Table                           | Command  | Rule                                                     |
| :------------------------------ | :------- | :------------------------------------------------------- |
| `comms.notification_deliveries` | `SELECT` | `user_id = auth.uid() OR security.is_admin()`             |
| `comms.notification_queue`      | `SELECT` | `user_id = auth.uid() OR security.is_admin()`             |
| `comms.notification_digests`    | `SELECT` | `user_id = auth.uid() OR security.is_admin()`             |
| `comms.channel_suppressions`    | `SELECT` | `user_id = auth.uid() OR security.is_admin()`             |
| `comms.delivery_events`         | —        | **No `authenticated` policy at all.** Service role only.  |

Suppressions are readable by their owner so the settings screen can explain _"we stopped emailing
you because your address hard-bounced"_. Raw gateway callbacks are operational data and are never
exposed to a client.

### Views

`comms.notification_feed`, `comms.notification_unread_counts` and
`comms.notification_delivery_health` are all declared `WITH (security_invoker = true)`, so the
caller's RLS decides visibility. A view must never become a privilege-escalation hole (root
CLAUDE.md §6 — RLS is always on).

---

## Messaging (pre-existing, migration 0202)

| Policy                               | Table                       | Rule                                                  |
| :----------------------------------- | :-------------------------- | :---------------------------------------------------- |
| _view_channels_if_member_            | `comms.project_channels`    | `projects.has_project_access(project_id)`              |
| _view_messages_if_member_            | `comms.project_messages`    | Channel's project passes `has_project_access`          |
| _send_messages_if_member_            | `comms.project_messages`    | Same, on `INSERT`                                      |
| _view_attachments_if_member_         | `comms.message_attachments` | Project access (project messages) or DM participation  |
| _Users link own message attachments_ | `comms.message_attachments` | `INSERT` only for a message the caller sent            |

Private-channel scoping and the PII handover gate are layered on top by migration 0311
(`comms.can_access_scope`, `comms.has_channel_access`).
