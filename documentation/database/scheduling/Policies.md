# scheduling Schema: Policies

RLS is **always on** for `scheduling`. The schema's posture differs from `finance`'s hidden ledger:
a schedule is meant to be **partly public** — a visitor must be able to see when someone is free in
order to book them — so the model is **shape is public, content is not**.

## The visibility tiers

| Tier                    | Who                                                                                             | Sees                                                                                                                                                                  |
| :---------------------- | :---------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Visitor** (`anon`)    | Anyone, only when `fn_schedule_is_public` — the schedule is published **and** its owner's profile is visible | Bands, blackout **spans** (`get_public_blackouts`, label masked), free/busy **spans** (`get_free_busy`), the public call offer — never an event row, never a blackout row |
| **Owner side**          | `fn_owner_visible` — self / team / business / organisation                                      | Everything on the schedule, except an event's **room** unless they created it or are seated on it                                                                    |
| **Project participant** | `projects.has_project_access` on the event's engagement                                         | A project event's row — its time, title and kind — but not its room, and not its coordination unless they are a party                                                |
| **Event party**         | Seated on the event, or its creator (coordination also admits whoever manages its schedule)     | That event's row, its room (`get_event_rooms`), its roster, negotiation, log and attachments                                                                         |
| **Call party**          | The two people on a `discovery_calls` row (+ admins)                                            | That call, its attendance log, its audit trail                                                                                                                        |

A discovery call is **never** readable by `anon` — there is deliberately no visitor policy on
`discovery_calls`, `call_attendance`, or `call_audit`. Since 2026-09-28 the same holds for
`scheduling.events` and `blackout_dates` rows: a visitor's whole view of a schedule is two definer
reads (`get_free_busy`, `get_public_blackouts`) and four visitor-readable configuration tables
(`schedules`, `availability_rules`, `call_settings`, `call_platforms`).

## 🛡️ Shared authorization helpers

All `SECURITY DEFINER` (so a policy reads membership tables without RLS recursion) — mirroring the
`finance.fn_owner_visible` / `fn_can_view_wallet` pattern rather than inventing a second one.

- **`scheduling.fn_owner_visible(owner_type, owner_id)`** — may the caller see this owner's schedule
  internals? Self for `user`/`freelancer`; `org.is_active_team_member` /
  `org.is_active_business_member` / `org.is_organisation_member` for the shared kinds; or
  `security.is_admin()`.
- **`scheduling.fn_owner_manages(owner_type, owner_id)`** — may the caller **mutate** it?
  Deliberately narrower: an individual owns their schedule outright, a team's is edited by
  `org.is_team_lead` (since 2026-09-28: a member holding the `bind_seat` workspace capability).
  > ⚠️ **Flagged (root `CLAUDE.md` §8):** tightening the shared-entity write gate to a specific
  > `org.workspace_capability` (rather than "any active member" for a business / organisation) is
  > left for human sign-off rather than guessed at. (The `org.team_permission` /
  > `org.business_permission` enums this note once named were retired 2026-09-28.)
- **`scheduling.fn_can_view_schedule(schedule_id)`** / **`fn_can_manage_schedule(schedule_id)`** —
  resolve a schedule to its owner then defer to the two above. Reused by every child table's policy.
- **`scheduling.fn_schedule_is_public(schedule_id)`** — `is_published` **and**
  `org.fn_profile_visible` of the schedule's owner (a `user` / `freelancer` schedule is checked as
  the `user` profile, the shared kinds as themselves). Since 2026-09-28: publishing a schedule does
  not publish a profile its owner has hidden (a `private` individual, a suspended team), and before
  this a visitor could list a private profile's published schedule through PostgREST while the
  profile's own availability page answered 404. Granted to `anon` as well, because it gates every
  visitor read path — the `schedules`, `availability_rules`, `call_settings` and `call_platforms`
  SELECT policies, `get_free_busy`, `get_public_blackouts` and `request_discovery_call` all key on it.
- **`scheduling.fn_is_event_attendee(event_id)`** — is the caller seated on this event? The roster
  arm of the `events` SELECT policy (below). `EXECUTE` to `authenticated` and `service_role` only.
- **`scheduling.fn_is_call_party(call_id)`** — is the caller the host or the requester? Gates the
  call attendance/audit reads.

## 📅 Availability (`20260724100000`)

`scheduling.schedules` and `availability_rules` each carry the same pair: a **visitor-or-owner
SELECT** and an **owner-only ALL**.

```sql
CREATE POLICY "View published or own schedule" ON scheduling.schedules FOR SELECT TO anon, authenticated
USING (scheduling.fn_schedule_is_public (id) OR scheduling.fn_owner_visible (owner_type, owner_id));

CREATE POLICY "Manage own schedule" ON scheduling.schedules FOR ALL TO authenticated
USING (scheduling.fn_owner_manages (owner_type, owner_id))
WITH CHECK (scheduling.fn_owner_manages (owner_type, owner_id));
```

`availability_rules` substitutes
`fn_schedule_is_public (schedule_id) OR fn_can_view_schedule
(schedule_id)` and
`fn_can_manage_schedule (schedule_id)` respectively. (The schedules policy read bare `is_published`
until 2026-09-28; it now asks `fn_schedule_is_public`, so a hidden profile's schedule header is not
listable either.)

**`blackout_dates` is the schedule's own members' only** (2026-09-28):

```sql
CREATE POLICY "View blackout dates" ON scheduling.blackout_dates FOR SELECT TO authenticated
USING (scheduling.fn_can_view_schedule (schedule_id));
```

> **A policy cannot mask a column.** This table used to carry the visitor arm too
> (`fn_schedule_is_public (schedule_id) OR …`, `TO anon, authenticated`), and "protected by data"
> turned out to mean protected by every reader remembering: `label_is_public = false` was honoured by
> the app's render and by nothing else, so a guest querying PostgREST read the private label
> ("Travelling") beside its span. A visitor now reads a published schedule's spans only through
> `scheduling.get_public_blackouts` ([Functions.md](Functions.md) §7), which returns the label where
> `label_is_public` (or the caller may view the schedule) and `Unavailable` otherwise — the mask is
> applied in the one place a visitor can reach. The table-level `GRANT SELECT … TO anon` remains, but
> with no `anon` policy it answers nothing.

## 🗓 Events (`20260724102000`)

`scheduling.events` is the one table with a genuinely compound policy, because a row can be anchored
two different ways and seated on by people who hold neither anchor:

```sql
CREATE POLICY "View scheduling events" ON scheduling.events FOR SELECT TO authenticated USING (
    (schedule_id IS NOT NULL AND scheduling.fn_can_view_schedule (schedule_id))
 OR (project_id IS NOT NULL AND projects.has_project_access (project_id))
 OR scheduling.fn_is_event_attendee (id)
);
```

**No visitor arm (2026-09-28).** The policy used to be `TO anon, authenticated` with a middle clause
admitting any row of kind `availability` · `busy` · `holiday` on a published schedule. It was meant
to expose free/busy **overlays**, but RLS is row-level, so it exposed every **column** of those rows
to a guest with the anon key: a busy block's private title ("Client workshop"), `created_by`, and a
masked block's external-calendar provenance (`source_connection_id`, `external_event_id`). That
defeated both `get_free_busy` and `schedules.mask_external_events`. A visitor's view of occupancy is
now `scheduling.get_free_busy` ([Functions.md](Functions.md) §7) alone — bare `(starts_at, ends_at)`
spans, never a title, an id or a kind — and `anon` reads no event row at all (no policy, and the
table grant below is `authenticated` only).

**The roster arm** (`fn_is_event_attendee`) is new with it: an attendee of a meeting on somebody
else's schedule could read the meeting's coordination but not the event row itself, so the meeting
vanished from their agenda and every RSVP or vote on it answered 404. Project-anchored rows still
reuse `projects.has_project_access` — a project's meetings are on its calendar — which since the same
date ignores a `declined` / `cancelled` / `released` stage assignment
([projects Functions](../projects/Functions.md#access-predicates)).

### The room is withheld at the column level (`00002520`)

A project member may see that a meeting exists and when; that is not the same as holding its link,
and for most providers **a meeting link is the access control**. RLS cannot draw that line, so the
table grant does: `authenticated` is granted `SELECT` on every column of `scheduling.events`
**except** `meeting_url`, `meeting_passcode` and `meeting_details`. A party reads those three through
`scheduling.get_event_rooms(event_ids)` ([Functions.md](Functions.md) §9), a definer that answers
only for events the caller created or is seated on. Before this, any project member — including a
freelancer who had **declined** a stage — could read every project meeting's join URL and passcode
through PostgREST while the service's privacy projection withheld them.

A consequence for anyone querying the table directly: a column list that names a withheld column —
including `select=*`, which expands to all of them — is refused (`42501`), so a reader must name its
columns. `live-calendar.ts` selects an explicit list and merges the room in from `get_event_rooms`.

`Manage scheduling events` covers **only a schedule owner's own entries**:

```sql
CREATE POLICY "Manage scheduling events" ON scheduling.events FOR ALL TO authenticated
USING      (schedule_id IS NOT NULL AND project_id IS NULL AND scheduling.fn_can_manage_schedule (schedule_id))
WITH CHECK (schedule_id IS NOT NULL AND project_id IS NULL AND scheduling.fn_can_manage_schedule (schedule_id));
```

A **project's** events have no client write path. The policy used to admit any participant of the
engagement (`has_project_access`), which let one member move a meeting's `starts_at` straight
through PostgREST — skipping the 12-hour lockout, the host-approval gate and the majority rule the
reschedule negotiation exists to apply — or hard-delete it together with its roster and history
(root `CLAUDE.md` §5). A project event now moves only when the scheduling service closes a round
through `scheduling.close_reschedule_round` ([Functions.md](Functions.md) §9), as the service role.
The `project_id IS NULL` guard sits on **both** halves so a schedule owner cannot re-anchor their
own entry onto somebody else's engagement.

**A rostered schedule event is guarded by a trigger, not by this policy** (2026-09-28). The policy
still let a schedule's manager — its owner, or a team lead on a team schedule — `PATCH` a group
session's `starts_at` inside the 12-hour lockout while a vote was open, or `DELETE` it and cascade
away its roster, rounds, votes and log. A policy cannot compare a row's old values with its new
ones, so the rule lives in `trg_guard_rostered_event`
([Functions.md](Functions.md) §9): for a **client** role, an event with any `event_attendees` row
cannot be deleted, and cannot have its `starts_at`, `ends_at`, `status` or `schedule_id` changed
(`55000`). Its other columns (a title, a location) stay the manager's to edit, an event with nobody
seated on it is unaffected, and the service role — which moves a rostered event through
`close_reschedule_round` after the negotiation's rules have run — is not refused.

## 🤝 Event coordination (`00000022`)

`event_attendees`, `event_reschedules`, `reschedule_proposals`, `proposal_votes`, `event_history`
and `event_attachments` are each readable by `authenticated` through one predicate,
`scheduling.fn_can_see_event_coordination (event_id)` (proposals and votes reach it through their
round), and carry **no write policy at all** — `GRANT SELECT` to `authenticated`, `ALL` to
`service_role` only (`00002520`). Every write is the scheduling service's, as the service role,
after the SSOT's rules have run; a client write policy would be a second, weaker implementation of
the negotiation.

The predicate admits someone **seated** on the event, the event's **creator**, and whoever
**manages** the schedule it is anchored to — the database half of the service's per-viewer
projection (`isEventParty` / `redactEventForViewer` in `packages/types/scheduling/privacy.ts`).

> ✅ **Resolved 2026-09-28 (was flagged here): the database disclosed more than the service did.**
> The predicate also admitted any participant of the engagement (`projects.has_project_access`), so a
> project member who was **not on a meeting's roster** — or a freelancer who had **declined** a stage
> — could read its roster with other attendees' private notes, the proposals and who voted for what,
> and the log, straight through PostgREST, while the projection withheld them. That arm is gone: a
> project member still sees a meeting's time and title (the `events` policy), and its coordination is
> its parties' business. The room, which the `events` row used to carry to the same audience, is
> withheld at the column level (above).

## 📞 Discovery calls (`20260724103000`)

| Table             | SELECT                                                                | Write                                                                                                               |
| :---------------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `call_settings`   | `anon` when `fn_schedule_is_public`, else owner side                  | `fn_can_manage_schedule` (ALL)                                                                                      |
| `call_platforms`  | Same as `call_settings` — a booker picks a platform BEFORE signing in | `fn_can_manage_schedule` (ALL). Discloses only which providers are offered; never a connection, token or account id |
| `discovery_calls` | Host **or** requester **or** admin — never `anon`                     | **No client `INSERT` or `UPDATE` policy**, and `SELECT` is the only table grant — `scheduling.request_discovery_call` is the only door |
| `call_attendance` | `fn_is_call_party`                                                    | None — webhooks write as service-role                                                                               |
| `call_audit`      | `fn_is_call_party`                                                    | None — the audit trigger writes it                                                                                  |

`call_settings` is visitor-readable on purpose: someone must be able to learn **whether** calls are
offered, **how long** they run, and **what a paid one costs** before signing in. The private fields
— caps, cooldowns, buffers — are excluded at the projection layer (`PublicCallOfferSchema` in
`packages/types/scheduling/calls.ts`), not by a second policy.

> ⚠️ **Still open: the projection is the only thing excluding them.** The `View call settings`
> policy is a row policy `TO anon, authenticated` and the table grant is plain `SELECT … TO anon`, so
> a guest querying PostgREST directly reads the whole row — `courtesy_max_per_week`,
> `courtesy_cooldown_days`, `auto_confirm`, the buffers, the notice and horizon. The slot grid
> legitimately needs the buffers, notice and horizon; the caps and cooldowns do not need to be
> public. Closing it means a column-level grant (the `events` technique) or a definer read of the
> public slice; not done.

### Why there is no insert or update policy, and why the rules are in a trigger

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
insert runs with the caller's `auth.uid()`. A `WITH CHECK` expression cannot express that much
logic, and a trigger cannot be skipped by the function that performs the insert — so the request
door and any future client path are held to the same gate. The same applies to the legal-transition
matrix on UPDATE (`fn_enforce_call_transition`).

**There is no client UPDATE path either** (2026-09-28). The `Update own discovery calls` policy
checked only that the caller was a party, on both `USING` and `WITH CHECK`, and the transition
trigger returns early when the status is unchanged — so either party could rewrite any column of a
call without moving its status, and the matrix never asked WHICH party was moving it. Probed as the
requester: a paid fee cut from 7500 to 1; a paid call turned courtesy, past the courtesy caps; the
host's `meeting_url` replaced with a phishing link (then logged as `link_generated` in the requester's
name); times inside the notice window or outside every call window; a requester confirming their own
proposed call; a false `no_show` against the host; `event_id` pointed at an unrelated event, which
the personal agenda then drops as "mirrored" for both parties; and `host_schedule_id` re-pointed at
an unrelated provider's schedule, which painted a busy span onto that provider's free/busy and
counted toward their weekly courtesy cap. The policy was dropped, and the table grant is now `SELECT` only. Nothing in the app
wrote through it.

> ⚠️ **Still open: no client door for the rest of the lifecycle.** A client can only CREATE a call
> (`request_discovery_call`, `proposed` or — under `auto_confirm` — `confirmed`). Confirming,
> declining, rescheduling, cancelling and recording a completion or no-show have **no client write
> path today**; each is to be a definer RPC that names who may make which move (the host answers,
> either party cancels, and so on), running with the caller's `auth.uid()` so the transition trigger
> still applies. None of those RPCs exists yet.

Both triggers **skip enforcement when `auth.uid()` is NULL** — a service-role caller (webhook,
sweep, backfill) owns the rules in its own layer. The triggers guard the _client_ path.

See [Functions.md](Functions.md) for the gate itself.

## ⚠️ Still open (2026-09-28)

Closed on that date: the room and coordination disclosure to non-parties, the visitor read of every
busy block's columns and every blackout label, a hidden profile's published schedule, and the
discovery-call UPDATE path (all above), plus the rostered-event guard, the reschedule's stale
confirmed slot, the midnight band edge, the provider-local courtesy week and the timezone check
([Functions.md](Functions.md)). **Not** closed, and recorded rather than silently accepted:

- **`call_settings` caps and cooldowns are `anon`-readable** through PostgREST (above).
- **No discovery-call management RPCs** — confirm / decline / reschedule / cancel / complete /
  no-show have no client write path (above).
- **One attendee can fill a round's twelve-slot cap** with unapproved slots and lock the host out
  of proposing ([Functions.md](Functions.md) §9).
- **A reschedule proposal has no maximum length** ([Functions.md](Functions.md) §9).
