# scheduling Schema: Policies

RLS is **always on** for `scheduling`. The schema's posture differs from `finance`'s hidden ledger:
a schedule is meant to be **partly public** — a visitor must be able to see when someone is free in
order to book them — so the model is **shape is public, content is not**.

## The three visibility tiers

| Tier                 | Who                                                        | Sees                                                                 |
| :------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------- |
| **Visitor** (`anon`) | Anyone, only when `schedules.is_published`                 | Bands, blackout **spans**, free/busy overlays, the public call offer |
| **Owner side**       | `fn_owner_visible` — self / team / business / organisation | Everything on the schedule                                           |
| **Call party**       | The two people on a `discovery_calls` row (+ admins)       | That call, its attendance log, its audit trail                       |

A discovery call is **never** readable by `anon` — there is deliberately no visitor policy on
`discovery_calls`, `call_attendance`, or `call_audit`.

## 🛡️ Shared authorization helpers

All `SECURITY DEFINER` (so a policy reads membership tables without RLS recursion) — mirroring the
`finance.fn_owner_visible` / `fn_can_view_wallet` pattern rather than inventing a second one.

- **`scheduling.fn_owner_visible(owner_type, owner_id)`** — may the caller see this owner's schedule
  internals? Self for `user`/`freelancer`; `org.is_active_team_member` /
  `org.is_active_business_member` / `org.is_organisation_member` for the shared kinds; or
  `security.is_admin()`.
- **`scheduling.fn_owner_manages(owner_type, owner_id)`** — may the caller **mutate** it?
  Deliberately narrower: an individual owns their schedule outright, a team's is edited by
  `org.is_team_lead`.
  > ⚠️ **Flagged (root `CLAUDE.md` §8):** tightening the shared-entity write gate to a specific
  > `org.team_permission` / `org.business_permission` (rather than "any active member") is left for
  > human sign-off rather than guessed at.
- **`scheduling.fn_can_view_schedule(schedule_id)`** / **`fn_can_manage_schedule(schedule_id)`** —
  resolve a schedule to its owner then defer to the two above. Reused by every child table's policy.
- **`scheduling.fn_schedule_is_public(schedule_id)`** — `is_published`. Granted to `anon` as well,
  because it gates the visitor read path.
- **`scheduling.fn_is_call_party(call_id)`** — is the caller the host or the requester? Gates the
  call attendance/audit reads.

## 📅 Availability (`20260724100000`)

`scheduling.schedules` · `availability_rules` · `blackout_dates` each carry the same pair: a
**visitor-or-owner SELECT** and an **owner-only ALL**.

```sql
CREATE POLICY "View published or own schedule" ON scheduling.schedules FOR SELECT TO anon, authenticated
USING (is_published OR scheduling.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "Manage own schedule" ON scheduling.schedules FOR ALL TO authenticated
USING (scheduling.fn_owner_manages (owner_type, owner_id))
WITH CHECK (scheduling.fn_owner_manages (owner_type, owner_id));
```

The child tables substitute
`fn_schedule_is_public (schedule_id) OR fn_can_view_schedule
(schedule_id)` and
`fn_can_manage_schedule (schedule_id)` respectively.

> **A policy cannot mask a column.** `blackout_dates.label` is therefore protected by data, not by
> policy: `label_is_public` defaults to `false` and a reader that is not `fn_can_view_schedule`
> **must** render the generic `Unavailable` string. See [Tables.md](Tables.md).

## 🗓 Events (`20260724102000`)

`scheduling.events` is the one table with a genuinely compound policy, because a row can be anchored
two different ways:

```sql
CREATE POLICY "View scheduling events" ON scheduling.events FOR SELECT TO anon, authenticated USING (
    (schedule_id IS NOT NULL AND scheduling.fn_can_view_schedule (schedule_id))
 OR (schedule_id IS NOT NULL AND scheduling.fn_schedule_is_public (schedule_id)
     AND kind IN ('availability', 'busy', 'holiday'))
 OR (project_id IS NOT NULL AND projects.has_project_access (project_id))
);
```

The middle clause is the privacy contract in one expression: a **published** schedule exposes only
its free/busy **overlay** kinds to the world. A `sync`, `milestone`, `deadline` or `booking` on the
same schedule stays private. Project-anchored rows simply reuse the pre-existing
`projects.has_project_access` gate — no second authority is invented.

A booking grid still needs to know WHEN those private rows occupy the calendar. It learns that
through `scheduling.get_free_busy` ([Functions.md](Functions.md) §7), a definer read that returns
bare `(starts_at, ends_at)` spans for a published schedule — never a title, an id or a kind. So the
policy above is not widened to serve the grid: the rows stay private, and only their occupancy is
public.

`Manage scheduling events` mirrors the same two anchors with `fn_can_manage_schedule` /
`has_project_access`.

## 📞 Discovery calls (`20260724103000`)

| Table             | SELECT                                                 | Write                                                                                              |
| :---------------- | :----------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| `call_settings`   | `anon` when the schedule is published, else owner side | `fn_can_manage_schedule` (ALL)                                                                     |
| `call_platforms`  | Same as `call_settings` — a booker picks a platform BEFORE signing in | `fn_can_manage_schedule` (ALL). Discloses only which providers are offered; never a connection, token or account id |
| `discovery_calls` | Host **or** requester **or** admin — never `anon`      | **No client `INSERT` policy** — `scheduling.request_discovery_call` is the only door; `UPDATE` by either party |
| `call_attendance` | `fn_is_call_party`                                     | None — webhooks write as service-role                                                              |
| `call_audit`      | `fn_is_call_party`                                     | None — the audit trigger writes it                                                                 |

`call_settings` is visitor-readable on purpose: someone must be able to learn **whether** calls are
offered, **how long** they run, and **what a paid one costs** before signing in. The private fields
— caps, cooldowns, buffers — are excluded at the projection layer (`PublicCallOfferSchema` in
`packages/types/scheduling/calls.ts`), not by a second policy.

### Why there is no insert policy, and why the rules are in a trigger

There used to be one: _"you are requesting as yourself, in the `proposed` state."_ It was removed
(`00002015`) because it proved identity and nothing else — the requester wrote every OTHER column of
the row too, so they chose the host the request notifies, the fee a paid call is charged at, and the
meeting link the host would click. A request now goes through `scheduling.request_discovery_call`
([Functions.md](Functions.md) §7), a definer function that takes only what is the requester's to say
(the schedule, the flavour, the time, an agenda, a platform from the host's list) and derives the
rest from the schedule and its settings.

Everything about the SLOT — call windows, minimum notice, booking horizon, buffers, weekly caps,
per-requester cooldowns, whether calls are offered at all — is still enforced by the **BEFORE
INSERT** trigger `scheduling.fn_enforce_call_request`, which fires inside the function because the
insert runs with the caller's `auth.uid()`. A `WITH CHECK` expression cannot express that much logic,
and a trigger cannot be skipped by the function that performs the insert — so the request door and
any future client path are held to the same gate. The same applies to the legal-transition matrix on
UPDATE (`fn_enforce_call_transition`).

Both triggers **skip enforcement when `auth.uid()` is NULL** — a service-role caller (webhook,
sweep, backfill) owns the rules in its own layer. The triggers guard the _client_ path.

See [Functions.md](Functions.md) for the gate itself.
