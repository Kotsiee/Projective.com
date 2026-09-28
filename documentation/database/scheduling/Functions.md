# scheduling Schema: Functions

The booking engine. Every predicate is pure and `STABLE`, so **the same function backs the
pre-flight "is this slot bookable?" check the UI makes and the hard gate the trigger applies at
INSERT** — the rules cannot drift between the two. Added 2026-07-24 by migrations `20260724100000`,
`20260724102000` and `20260724104000`; the public free/busy read and the discovery-call request door
(§7) by `00001520_functions_scheduling_free_busy.sql`.

> Why in the database at all: the booking rules protect a person's calendar and (for a paid call)
> their money, so they are enforced where RLS is — not only in a service.

---

## 1. Authorization predicates (`20260724100000`)

Covered in [Policies.md](Policies.md): `fn_owner_visible` · `fn_owner_manages` ·
`fn_can_view_schedule` · `fn_can_manage_schedule` · `fn_schedule_is_public`. All `SECURITY DEFINER`,
`STABLE`, `SET search_path`. Since 2026-09-28 `fn_schedule_is_public` is `is_published` **and**
`org.fn_profile_visible` of the owner, so every visitor path it gates (§7, and the visitor SELECT
policies) goes dark for a profile its owner has hidden. The event-level predicates are in §9.

`scheduling.fn_touch_updated_at()` is the shared `BEFORE UPDATE` trigger function maintaining
`updated_at` on every table in the schema.

---

## 2. Time primitives (`20260724104000`)

| Function                                          | Returns  | Notes                                                                      |
| :------------------------------------------------ | :------- | :------------------------------------------------------------------------- |
| `fn_local_minute_of_day(at timestamptz, tz text)` | integer  | Minutes from **local** midnight. `AT TIME ZONE` does the DST work, not us. |
| `fn_local_weekday(at timestamptz, tz text)`       | smallint | 0 = Sunday … 6 = Saturday, matching the `weekday` column and JS `getDay`.  |

Both `STABLE`. (Postgres marks `timestamptz AT TIME ZONE text` immutable, but `STABLE` is the safer
declaration here and costs nothing — neither function is used in an index.)

---

## 3. Coverage & conflict predicates

### `scheduling.fn_band_covers(schedule, kind, starts_at, ends_at) → boolean`

Is the whole span inside **one** active weekly band of that kind? Resolves the schedule's own
timezone, then compares local weekday + minute-of-day at both edges.

> ⚠️ **Known bound.** Because `end_minute > start_minute` is a table constraint, a band cannot cross
> local midnight — so neither can a call booked against one. A provider taking calls 23:00–01:00
> expresses it as two bands and the call must fit inside one. Deliberate; see
> [Tables.md](Tables.md).

**The midnight edge (2026-09-28).** The weekday is tested at the START only; the end must either
fall on the same local weekday at or before `end_minute`, or — for a band with
`end_minute = 1440` — be exactly minute 0 of the NEXT local date. Midnight is minute 0 of the
following day, so the old same-weekday test refused a slot ending at 24:00 that the slot grid
(`slot-grid.ts`, which admits `start + duration <= 1440`) offered and the editor allows
(`end_minute <= 1440`).

**`scheduling.fn_call_window_covers(schedule, starts_at, ends_at)`** is the convenience wrapper for
`kind = 'call_window'`.

### `scheduling.fn_has_conflicting_event(schedule, starts_at, ends_at) → boolean` (`20260724102000`)

Does a non-`cancelled`, non-`availability` event on this schedule overlap the span? (`availability`
rows describe openness, so they never occupy time.)

### `scheduling.fn_is_blacked_out(schedule, starts_at, ends_at) → boolean` (`20260724102000`)

Does the span intersect a blackout?

### `scheduling.fn_slot_is_free(schedule, starts_at, ends_at) → boolean`

The composite: rejects on blackout, conflicting event, or an existing `proposed`/`confirmed` call.
Falls back to `security.platform_params.discovery_call_default_buffer_minutes` when no settings row
exists.

**Buffer geometry.** Buffers belong to **every** commitment, not just the one being requested — an
existing call at 14:00–14:15 with a 10-minute trailing buffer must block a 14:15 request. Comparing
two spans each widened by `(before, after)` is algebraically identical to widening only the
**requested** span by `(before + after)` on **both** edges and comparing against the raw stored
span, which is what the function does — so stored rows need no per-row buffer lookup.

The **blackout** test deliberately uses the **raw** span: a blackout is an absolute boundary, and a
call that ends exactly when time-off begins is legitimate. Buffers exist to stop back-to-back
_calls_, not to erode declared time off.

---

## 4. The booking gate

### `scheduling.fn_call_request_refusal(schedule, requester, type, starts_at, ends_at) → text`

Returns **NULL when the request is allowed**, or a machine-readable reason code when it is not.
Returning a _reason_ rather than a bare boolean lets the UI explain a refusal without re-deriving
the rules client-side. The codes are mirrored in `packages/types/scheduling/calls.ts`
(`CallRefusalReason` + `CALL_REFUSAL_COPY`) — keep the two in step.

| Code                            | Cause                                                             |
| :------------------------------ | :---------------------------------------------------------------- |
| `calls_not_offered`             | No settings row, or `accepts_calls = false`.                      |
| `courtesy_not_offered`          | `courtesy_enabled = false`.                                       |
| `paid_not_offered`              | `paid_enabled = false`.                                           |
| `duration_mismatch`             | The span isn't the configured length for that call type.          |
| `duration_exceeds_platform_max` | Beyond `discovery_call_max_duration_minutes`.                     |
| `inside_minimum_notice`         | Closer than `min_notice_minutes`.                                 |
| `beyond_booking_horizon`        | Further ahead than `max_advance_days`.                            |
| `outside_call_window`           | Not covered by a `call_window` band.                              |
| `slot_unavailable`              | Fails `fn_slot_is_free` (blackout / conflict / buffer collision). |
| `weekly_courtesy_cap_reached`   | `courtesy_max_per_week` already met in that week — the provider's own week, Monday 00:00 in the schedule's `timezone` (UTC if none), not the database session's UTC week (since 2026-09-28). |
| `requester_in_cooldown`         | This requester had a free call inside `courtesy_cooldown_days`.   |

**The duration is the provider's, not the requester's**: a booking must match the configured length
exactly, so the grid and the calendar always agree. The two anti-abuse checks apply to **courtesy
calls only** — a paid call is self-limiting.

### `scheduling.fn_can_request_call(…) → boolean`

The boolean face of the same gate (`refusal IS NULL`), for a pre-flight UI check.

---

## 5. Enforcement triggers

| Trigger                       | Timing                                           | Function                       |
| :---------------------------- | :----------------------------------------------- | :----------------------------- |
| `trg_enforce_call_request`    | BEFORE INSERT                                    | `fn_enforce_call_request()`    |
| `trg_enforce_call_transition` | BEFORE UPDATE                                    | `fn_enforce_call_transition()` |
| `trg_log_call_event`          | AFTER INSERT/UPDATE                              | `fn_log_call_event()`          |
| `trg_guard_rostered_event`    | BEFORE UPDATE OR DELETE on `events`              | `fn_guard_rostered_event()` (§9) |
| `trg_check_schedule_timezone` | BEFORE INSERT OR UPDATE OF `timezone` on `schedules` | `fn_check_schedule_timezone()` |

(All in `00001860_triggers_scheduling.sql`, after every functions file; the reschedule-round
triggers are listed in §9.)

**`fn_enforce_call_request`** raises `check_violation` with the refusal code when the gate refuses.

**`fn_enforce_call_transition`** enforces the legal-transition matrix and **derives the lifecycle
stamps so a client cannot forge them**: `confirmed_at` / `responded_at` / `completed_at` /
`cancelled_at`, and `is_late_cancel` (computed against
`security.platform_params.discovery_call_cancellation_window_hours`). A reschedule — a return to
`proposed` from another status — increments `reschedule_count` and clears `confirmed_at`,
`confirmed_start` and `confirmed_end`. (Until 2026-09-28 it cleared `confirmed_at` only, and because
free/busy, the agendas and the booking gate all read `COALESCE(confirmed_*, proposed_*)`, a moved
call kept its OLD slot occupied and left its new one bookable by somebody else.) Terminal states
accept no further transition. The matrix is mirrored in `packages/types/scheduling/calls.ts`
(`CALL_TRANSITIONS` / `canTransitionCall`); **the trigger is the authority**, the TypeScript is the
pre-check.

The trigger returns immediately when the status is unchanged and never asks WHICH party is moving
the call, so it is not an authorization layer: that is why the client `UPDATE` policy and grant were
removed (2026-09-28, [Policies.md](Policies.md)). There is **no client write path for any transition
today** — the definer RPCs that will confirm, decline, reschedule and cancel a call, each naming who
may make the move, are not yet written (see _Not yet implemented_ below).

**`fn_check_schedule_timezone`** (since 2026-09-28) refuses a `schedules.timezone` that is not in
`pg_catalog.pg_timezone_names` with `22023` (`timezone: not a recognised time zone`), for every role.
`save_owner_availability` (§8) already checked the zone, but a direct `UPDATE` did not, and an unknown
zone made every booking against the schedule raise `time zone "…" not recognized` instead of refusing
with a reason — while the slot grid silently fell back to UTC and kept offering slots. `SECURITY
INVOKER`; `EXECUTE` revoked from `PUBLIC` · `anon` · `authenticated` (a trigger function is never
called directly).

**`fn_log_call_event`** appends to `scheduling.call_audit` on every request, status change, and
meeting-link generation — which is how a reschedule chain stays reconstructable despite not being a
status.

> Both enforcement triggers **skip when `auth.uid()` is NULL**: a service-role caller (conferencing
> webhook, expiry sweep, backfill) owns the rules in its own layer. The triggers guard the client
> path.

---

## 6. Platform parameters (`20260724104000`)

Inserted additively into the existing `security.platform_params` table (migration 0004), so the
knobs live with every other tunable rather than in a new config surface.

| Key                                        | Default | Meaning                                                                 |
| :----------------------------------------- | :------ | :---------------------------------------------------------------------- |
| `discovery_call_cancellation_window_hours` | `24`    | Inside this, a cancel is flagged `is_late_cancel`.                      |
| `discovery_call_default_buffer_minutes`    | `10`    | Trailing buffer when a provider hasn't set their own.                   |
| `discovery_call_max_duration_minutes`      | `240`   | Hard ceiling on any single call.                                        |
| `discovery_call_reminder_lead_minutes`     | `60`    | How far ahead the reminder is dispatched.                               |
| `discovery_call_proposal_ttl_hours`        | `72`    | How long an unanswered proposal stays live before the sweep expires it. |

> The **cancellation window flags** a late cancel; it does not price one. A **courtesy** call has no
> money, so a late cancel carries no financial consequence at all. For a **paid** call the
> `finance-model.md` §4 (50%) vs `PRODUCT_SPEC.md` §Sessions (full forfeit) conflict is already
> logged and is deliberately **not** resolved in SQL — the per-call `refund_amount_minor` /
> `penalty_amount_minor` columns record whichever outcome a human ratifies.

---

## 7. Public reads and the request door (`00001520`)

The booking surfaces — a listing's Book modal, the discovery-call handshake,
`/[handle]/availability` and a session listing's schedule — read a provider's **published** schedule
as the anonymous client, so a guest and a member are answered identically. Four functions make that
possible without widening any policy — and since 2026-09-28 the two reads below are a visitor's
ONLY way to see what occupies a schedule, because neither `scheduling.events` nor
`scheduling.blackout_dates` has a visitor policy any more ([Policies.md](Policies.md)). The two reads
answer for a schedule only while `fn_schedule_is_public` holds (published, and the owner's profile
visible) or the caller may already view it; the request door requires `fn_schedule_is_public`.

### `scheduling.fn_schedule_host(schedule) → uuid`

The accountable **person** a schedule belongs to: the individual for a `user`/`freelancer` schedule,
and the `owner_user_id` of the team, business or organisation otherwise. A discovery call names a
host user (it is a meeting between two people), so a team's calls are hosted by whoever answers for
the team. `SECURITY DEFINER`; **`EXECUTE` is `service_role` only** — it is an internal resolver for
the request door below, not something a client needs to call.

### `scheduling.get_free_busy(schedule, from, to) → TABLE(starts_at, ends_at)`

The occupied spans on a schedule inside a window: every non-`cancelled` event that is not itself an
`availability` block, plus every discovery call still `proposed` or `confirmed`. **Spans only** — no
title, no id, no kind — so a visitor learns that a time is taken and nothing about by whom or for
what (`PRODUCT_SPEC.md` §The Proactive Calendar, Part 1.4). Answers for a **public** schedule
(`fn_schedule_is_public` — published, and the owner's profile visible), or one the caller may
already view (`fn_can_view_schedule`); for anything else it returns no rows
rather than raising. The window is clamped to **120 days** so it cannot page through a provider's
history in one call. `SECURITY DEFINER`, because `scheduling.events` itself stays private (see
[Policies.md](Policies.md)); `EXECUTE` to `anon`, `authenticated`, `service_role`.

The app turns these spans into the slot grid in `packages/backend/services/scheduling/slot-grid.ts`,
which applies the **same** buffer geometry as `fn_slot_is_free` (§3) — a busy span blocks any slot
within `before + after` minutes of either edge, and a blackout blocks on the raw span — so a slot
the grid offers is a slot the gate accepts.

**The 120-day clamp and the grid's window.** The clamp runs from `p_from`, so the caller must anchor
the window on the page it is drawing. `ScheduleBackendService.gridWindow` asks from the rail page's
own start (never earlier than today) less two days, to that start plus the rail's days plus three —
until 2026-09-28 it always started at _today_ less two days, so any rail page past about day 118
read no commitments at all and offered taken slots as free (a paid session could then be basketed
onto an occupied slot, since sessions have no database booking gate). Two spans may share a start
instant (this is a `UNION ALL` of
events and calls, and events may overlap), so the public page keys each busy span by its start
**and** its position (`live-schedule-page.ts`) rather than by the start alone.

### `scheduling.get_public_blackouts(schedule, from, to) → TABLE(id, starts_at, ends_at, label)`

A published schedule's blackout **spans** for a visitor (added 2026-09-28). The label comes back
only where the owner made it public — `label_is_public`, or the caller may view the schedule
(`fn_can_view_schedule`) — and as `Unavailable` otherwise. It exists because the `blackout_dates`
row policy used to admit `anon` and a row policy cannot mask one column: a guest querying PostgREST
received a private label ("Travelling") beside its span. The table is now readable by the
schedule's own members only, and this is the visitor's read.

Answers only while `fn_schedule_is_public (schedule)` or `fn_can_view_schedule (schedule)`; returns
the spans intersecting `[from, to)`, with the window capped at **400 days** from `from`, ordered by
start. `SECURITY DEFINER`, `STABLE`, `search_path = ''`; `EXECUTE` to `anon`, `authenticated`,
`service_role` (revoked from `PUBLIC`). Called by `live-schedule-page.ts` (the public schedule page)
and `live-slots.ts` (the slot grid), which render the label as returned — the mask is decided in the
database, not re-derived in the app.

### `scheduling.request_discovery_call(schedule, call_type, starts_at, ends_at, agenda?, requester_timezone?, provider_slug?, service_blueprint_id?) → jsonb`

**The only way a client requests a discovery call.** The direct `INSERT` policy is gone (see
[Policies.md](Policies.md)): it let the requester write every column of the row — the host it
notifies, the fee, the meeting link the host would click — none of which are the requester's to
choose. The caller now supplies the schedule, the flavour, the time, an agenda, their own timezone,
a platform and (optionally) the listing the call is about; everything else is derived:

- the **host** is `fn_schedule_host(schedule)`, never a caller's claim;
- a paid call's **fee** is the host's configured `fee_amount_minor` / `fee_currency`;
- the **platform** must be one of the host's `call_platforms`, and is required when they list any;
- the **listing** must be a published blueprint the host (or the host's team) sells;
- an **agenda** is demanded when `agenda_required`;
- the **status** is `proposed`, or `confirmed` (with `confirmed_*` stamped) when `auto_confirm`.

The slot itself — call window, notice, horizon, free time, weekly cap, cooldown — is judged by the
existing BEFORE INSERT gate (`fn_enforce_call_request`, §5), which fires because the insert runs
with the caller's `auth.uid()`. The host is then told through the notification engine
(`comms.fn_notify`, type `availability.booking_request`), which never raises and routes by the
host's own preferences. Returns `{ id, status }`.

A refusal raises `check_violation` with the message `Discovery call refused: <reason>`, where the
reason is either one of the gate codes in §4 or one of these:

| Code                   | Cause                                                        |
| :--------------------- | :----------------------------------------------------------- |
| `not_signed_in`        | No `auth.uid()`.                                             |
| `calls_not_offered`    | The schedule is unpublished, has no host, or takes no calls. |
| `self_booking`         | The requester is the host.                                   |
| `agenda_required`      | The host requires an agenda and none was given.              |
| `platform_not_offered` | The platform is not on the host's list.                      |
| `platform_required`    | The host lists platforms and none was chosen.                |
| `listing_mismatch`     | The listing is unpublished or not the host's to sell.        |

`EXECUTE` to `authenticated` and `service_role`; revoked from `anon` and `PUBLIC`.

---

## 8. The owner's Availability editor (`00001510`)

### `scheduling.save_owner_availability(owner_type, owner_id, payload jsonb) → jsonb`

The profile owner's Availability surface (`/[handle]/edit/availability`) writes three tables — the
schedule (timezone + published), its weekly bands, and the discovery-call settings — and they must
land together: a timezone saved without the bands it is expressed in re-times every band. So this is
**one call, one transaction**.

**`SECURITY INVOKER`, on purpose.** The existing policies ("Manage own schedule", "Manage
availability rules", "Manage call settings") already decide who may write, through
`scheduling.fn_owner_manages`. This function adds atomicity, not authority; the explicit
`fn_owner_manages` check at the top only turns a silent zero-row write into a named refusal. Granted
to `authenticated` and `service_role`.

An individual's schedule is `owner_type = 'user'` — **one schedule per human**, whatever their
freelancer flag — so turning freelancer on or off can never strand a second calendar.

| Payload key | Effect                                                                                                                                                                                                                                                                                                                                                   |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timezone`  | Required (`timezone: choose a time zone`). Upserts `scheduling.schedules`.                                                                                                                                                                                                                                                                               |
| `published` | Whether the schedule is readable by visitors (default `false`).                                                                                                                                                                                                                                                                                          |
| `rules`     | **Replaces** the weekly bands: `[{kind, weekday, start_minute, end_minute}]`, at most 42 (six a day). A band needs a day and an end after its start. Two overlapping bands of the same kind on the same weekday are **refused**, not merged — the editor cannot draw one, so receiving one means the request did not come from it.                       |
| `call`      | Optional; absent leaves the call settings as they are. Upserts `scheduling.call_settings`: `accepts_calls`, the courtesy half (`courtesy_enabled`, duration, weekly cap, cooldown), the paid half (`paid_enabled`, duration, `fee_amount_minor` + `fee_currency`), buffers, `min_notice_minutes`, `max_advance_days`, `auto_confirm`, `agenda_required`. |

Refusals are `42501` for the caller (`auth: sign in to edit availability`,
`owner: you cannot edit this schedule`) and `22023` with a `<field>: <reason>` message for the
input, like `org.save_profile`. Returns `{ok, schedule_id}`.

The caller-side wrapper is `packages/backend/services/scheduling/live-owner-availability.ts`
(`saveOwnerAvailability`). Two refusals happen before the database is asked: the Zod SSOT
(`@projective/types/scheduling` `owner-availability.ts`) refuses a paid call with no fee and two
overlapping hours on one day, and `ProfileBackendService.saveAvailability` refuses call settings for
a profile that cannot take calls (a buyer). The public side reads the same rows through
`live-call-offer.ts` (`readPublicCallOffer`), which requires a published schedule.

---

## 9. Event coordination (`00001510`)

### `scheduling.fn_can_see_event_coordination(event) → boolean`

The one read predicate behind all six coordination tables' SELECT policies. True for someone seated
on the roster, the event's creator (`created_by` — the host of an entry with no host seat), or
whoever manages the schedule the event is anchored to (`fn_can_manage_schedule`) — the database half
of the service's per-viewer projection (`isEventParty`, `packages/types/scheduling/privacy.ts`).
`SECURITY DEFINER` so the roster lookup does not recurse into `event_attendees`' own policy, which
calls it. `EXECUTE` to `authenticated` and `service_role`.

**Not every participant of the engagement** (2026-09-28). It used to also admit anyone with
`projects.has_project_access`, which made the service's projection a presentation layer only: a
project member not on a meeting's roster — or a freelancer who had declined a stage — could read the
roster with other attendees' private notes, the proposals and who voted for what, and the log,
straight through PostgREST. A project member still sees a meeting's time and title through the
`events` policy; its coordination is its parties' business. See [Policies.md](Policies.md).

### `scheduling.fn_is_event_attendee(event) → boolean`

Is the caller seated on this event (`auth.uid()` holds a row of `event_attendees` for it)? The
roster arm of the `events` SELECT policy (added 2026-09-28): an attendee of a meeting on somebody
else's schedule could read its coordination but not the event row itself, so the meeting vanished
from their `/calendar` agenda and every RSVP or vote on it answered 404. `SECURITY DEFINER`,
`STABLE`, `search_path = ''`, so the lookup does not recurse into `event_attendees`' policy; false
for a caller with no `auth.uid()`. `EXECUTE` to `authenticated` and `service_role` only — `anon`
reads no event row, so it needs no arm.

### `scheduling.get_event_rooms(event_ids uuid[]) → TABLE(event_id, meeting_url, meeting_passcode, meeting_details)`

The meeting room for the events the caller is a **party** to — seated on, or the creator of — and
nothing for any other id in the list (added 2026-09-28). `meeting_url`, `meeting_passcode` and
`meeting_details` are withheld from every client role at the column level (`00002520`), because
RLS is row-level: the rows a project member may see are not the rows whose link they may hold, and a
meeting link IS the access control for most providers. Before this, any project member — including
a freelancer who had declined a stage — read every project meeting's join URL and passcode through
PostgREST. Note the audience is narrower than `fn_can_see_event_coordination`'s: a schedule
**manager** who neither created the event nor is seated on it does not receive the room.

Returns nothing for a caller with no `auth.uid()`, and nothing at all for a list of more than **500**
ids (it answers no rows rather than raising). `SECURITY DEFINER`, `STABLE`, `search_path = ''`;
`EXECUTE` to `authenticated` and `service_role` (revoked from `PUBLIC` and `anon`).

**How the live read uses it** (`packages/backend/services/scheduling/live-calendar.ts`). The service
reads the rest of each event row under the caller's RLS with an explicit column list, then merges
the room from this function in chunks of 500 (`mergeRooms`, only for rows that have a
`meeting_provider`) — so the projection and the database can no longer disagree about who holds a
link. In the same pass (2026-09-28):

- **Every read that can reach PostgREST's `max_rows`** (1000, `supabase/config.toml`) pages with
  `.range()` over a deterministic order until a short page comes back (`readPaged`, at most 20
  pages, then it throws rather than answer with a truncated set). The roster, the ballots and the log
  decide who may vote and whether a vote carried, so a silently cut answer was a wrong answer that
  the settlement then persisted.
- **The whole roster is kept** for seating, party status and a vote's electorate; it is capped at
  200 seats only on the wire, after settlement (`capRosterForWire`, `ROSTER_WIRE_MAX` in
  `privacy.ts`, keeping the host's seat and the reader's own). Cutting it before those decisions let
  a minority carry a large session and dropped seat #201 onwards out of being a party at all.

### `scheduling.fn_guard_rostered_event()` → trigger (`trg_guard_rostered_event`) · `scheduling.fn_event_has_roster(event) → boolean`

`BEFORE UPDATE OR DELETE` on `scheduling.events` (trigger in `00001860`, added 2026-09-28). A
rostered event moves only through its negotiation: for a **client** role (`current_user` is `anon`
or `authenticated`), an event with any `event_attendees` row is never deleted (`55000`, "people are
booked on this event — cancel or reschedule it instead" — the delete would cascade the roster, the
rounds, the votes and the log away, root `CLAUDE.md` §5), and an update that changes its
`starts_at`, `ends_at`, `status` or `schedule_id` is refused (`55000`, "propose a new time
instead"). Any other role — the scheduling service, which closes rounds through
`close_reschedule_round` after the SSOT's rules have run — passes through, as does any edit of an
event nobody is seated on. It closes a route round the 12-hour lockout and the majority rule that
the policies could not: the `events` management policy lets a schedule's manager write their own
entries, and a policy cannot compare old values with new ones.

`fn_guard_rostered_event` is `SECURITY INVOKER` **on purpose**: inside a definer `current_user` is
the function's owner, so the client-role test would never match and the guard would wave everything
through. The roster lookup it needs is the definer helper `fn_event_has_roster` (`STABLE`,
`search_path = ''`), so the answer does not depend on the caller's RLS. `EXECUTE` on the guard to
`authenticated`; on the helper to `authenticated` and `service_role` (revoked from `PUBLIC` and
`anon`) — the guard runs as the caller, so the caller must be able to execute the helper.

### `scheduling.close_reschedule_round(round, status, resolved_proposal, actor, summary, detail) → uuid`

The one transition in the negotiation that moves **two** rows — the round comes to rest and, when it
carried, the event itself moves to the winning slot — so it is one function rather than two
PostgREST writes. Done as two, a failure between them leaves a round saying "moved to Thursday"
beside an event still on Tuesday, with nothing afterwards able to tell which to believe.

| Argument                 | Meaning                                                                                     |
| :----------------------- | :------------------------------------------------------------------------------------------ |
| `p_status`               | `resolved` or `lapsed` only (anything else → `22023`).                                      |
| `p_resolved_proposal_id` | Required for `resolved`, and must be a proposal on **this** round (else `22023`).           |
| `p_actor`                | The acting user, or `NULL` for a vote that closed on its own (deadline or full electorate). |
| `p_summary` · `p_detail` | The history line.                                                                           |

It **locks the round first** (`SELECT … FOR UPDATE`) and returns `NULL` when it is no longer open
(`collecting` · `awaiting_counterparty` · `voting`) — so two readers settling the same vote a moment
apart produce one move, and a ballot or a proposal arriving while it closes waits on the same lock
and is then refused by the write guard (below) rather than landing on a question already answered.
On `NULL` the writer re-reads the round and treats the SAME ending (status and winner) as success:
a reader who settled a decided vote a moment before the last voter's own close recorded exactly the
outcome that voter caused. On success it marks the winner `approved` (a 1-on-1 may close on an
ATTENDEE's slot the host accepted directly — that acceptance is the approval), moves
`events.starts_at` / `ends_at` (for `resolved`), and appends one `event_history` line (`rescheduled`
for `resolved`, `vote` for `lapsed`, `target_id` = the proposal), returning its id.

**The rules are not here.** Whether a vote has carried, whether a counterparty may confirm, whether
the deadline has arrived are the pure predicates in `@projective/types/scheduling` (`settleVote`,
`majorityProposal`, `canReschedule`), applied by `coordination-plan.ts` before this is called. This
function owns only what a rule cannot: that the round is still open when it is closed, that the
winner belongs to it, and that the round, the event and the log line land together.

`SECURITY INVOKER`; `EXECUTE` to `service_role` only (`00002510`) — there is no client write path
into coordination. Settlement is **lazy**: the service calls it on the read path when `settleVote`
finds a decided vote (the deadline has passed, or every eligible voter has answered), and on the
write path when a ballot or a counterparty's confirmation ends the round. There is no sweep yet (see
below).

### `scheduling.fn_cap_reschedule_proposals()` → trigger (`trg_cap_reschedule_proposals`)

`BEFORE INSERT` on `reschedule_proposals` (trigger in `00001860`). A round holds at most **twelve**
slots, approved or not — `RESCHEDULE_PROPOSALS_MAX` in `@projective/types/scheduling`, which
`coordination.contract.test.ts` pins to the SQL literal. The thirteenth raises `23514`
(`check_violation`), which the write path answers as a 409 `ballot_full`.

The same cap is enforced three times on purpose: the Zod `proposals` array, the planner's
`ballot_full` refusal (asked before the duplicate-slot check, so a full round is full whatever is
offered), and this trigger. The trigger is what makes it true of the TABLE rather than of one code
path: before it existed a thirteenth slot was stored, dropped by the read's twelve-slot bound, and
then answered "already proposed" when offered again — a time nobody could see and nobody could
offer.

The count runs under `SELECT … FOR UPDATE` on the parent `event_reschedules` row, so two offers
made against an eleven-slot round at once cannot both count eleven: the second waits for the first
to commit and its count (a fresh snapshot under `READ COMMITTED`) then includes it. `SECURITY
DEFINER` with `search_path = ''`, so the lock does not depend on the writer holding `UPDATE` on the
parent; it only reads and locks. `EXECUTE` revoked from `public` · `anon` · `authenticated`
(`00002510`) — a trigger function is never called directly.

A closed round is not capped by this: the next `propose` opens round `n + 1` with an empty ballot.

> ⚠️ **Still open (2026-09-28): the cap is shared, and a slot's length is unbounded.**
>
> - **One attendee can fill the twelve.** The count — here and in the planner's `roundHasRoom`
>   (`coordination-plan.ts`) — treats approved and unapproved slots alike, with no per-proposer or
>   per-role quota, so a single attendee offering twelve slots the host never approves leaves the
>   host's own `propose` answering `ballot_full`. The only way out is `withdraw`, after which the
>   same attendee can refill round `n + 1`.
> - **No maximum slot length.** `ck_proposal_span` asks only `ends_at > starts_at`, and the only
>   other bound is the latest instant the route's Zod accepts (`SLOT_EPOCH_MAX_MS`), so a 45-minute
>   sync can be offered — and, if accepted, moved to — a slot ending in 9999. Once moved it sits in
>   every project-calendar window indefinitely and, on a schedule event, blocks the owner's
>   free/busy. No documented cap is broken; it is a missing one.
>
> Neither is decided here: both are product rules (who may use how much of a ballot; how long a
> replacement meeting may be) to settle before they are written into the planner and this trigger.

### `scheduling.fn_vote_deadline(round, also?) → timestamptz`

The vote deadline for a round: `LEAST(earliest ballot slot − VOTE_RESOLUTION_LEAD_HOURS, event start
− RESCHEDULE_LOCKOUT_HOURS)`, or `NULL` on an empty ballot — the SQL twin of `voteResolvesAt`, with
both literals pinned by `coordination.contract.test.ts`. Only the **ballot** counts (a host's slot,
or an attendee's the host approved). `p_also` adds one slot the calling trigger is about to write,
which is not in the table yet (an insert) or not yet approved in it (an approval).

**The lockout term is the fix for a vote outliving its meeting.** Every slot on a ballot may lie
after the event being moved — moving Tuesday's crit to next week is the ordinary case — and a
deadline taken from the ballot alone kept the round `voting` for days after the event could no
longer be moved. Nobody could vote (the lockout refuses every action), and the first read past the
ballot deadline then settled it and moved a session that had already happened. Capped at the
event's lockout, a vote is always decided while the event is still movable, and every ballot slot
starts at least the lead after the deadline, so the winner was always a time the event could move
to at the instant it was decided. `SECURITY INVOKER`, `STABLE`; `EXECUTE` revoked from `public` ·
`anon` · `authenticated` — it is called only from the two definer triggers below.

### `scheduling.fn_guard_reschedule_write()` → trigger (`trg_guard_reschedule_proposal_write`, `trg_guard_reschedule_vote_write`)

`BEFORE INSERT OR UPDATE OF approved` on `reschedule_proposals`, and `BEFORE INSERT` on
`proposal_votes` (triggers in `00001860`). The planner refuses a move on a closed round, but it
plans against a READ, and the round can close between that read and the write: a host withdraws
while an attendee votes, or a reader settles a decided vote a moment before somebody else's ballot
lands. Before this guard existed the row was stored on a round that had already been answered, and
the writer's separate follow-up (re-stamping the deadline) then failed and reported the whole move
as refused while its row stayed committed. Now the round is locked (the same lock the cap and
`close_reschedule_round` take) and its status tested in the statement that writes the row: a
proposal or an approval needs an open round, a vote a round that is `voting`. Refused as `55000`
(`object_not_in_prerequisite_state`), which the writer answers with a 409.

On a live vote it also re-stamps `event_reschedules.resolves_at` from `fn_vote_deadline` in the same
statement, so a proposal or approval that brings the earliest option forward cannot commit without
its deadline, and two of them racing cannot leave a stamp computed from the ballot the loser read.
`SECURITY DEFINER`, `search_path = ''`; `EXECUTE` revoked from `public` · `anon` · `authenticated`.

### `scheduling.fn_stamp_vote_deadline()` → trigger (`trg_stamp_vote_deadline`)

`BEFORE UPDATE OF status` on `event_reschedules`, `WHEN` the round enters `voting`: stamps
`resolves_at` from the ballot the round holds at that instant, rather than from whatever ballot the
opening request read. `SECURITY DEFINER`, `search_path = ''`; `EXECUTE` revoked as above.

The READ path re-derives a live vote's deadline from the ballot it read (`voteResolvesAt`) rather
than trusting the stamp, so a reader is always shown the deadline the settlement will judge by; a
closed round keeps its stamp, because the event has since moved and re-deriving against the new
start would rewrite the instant the decision was taken.

---

## Not yet implemented (deferred, deliberately)

- **Discovery-call management RPCs** — confirming, declining, rescheduling, cancelling, and
  recording a completion or a no-show. The client `UPDATE` policy was removed on 2026-09-28 (either
  party could rewrite any column — [Policies.md](Policies.md)), so today a client can only create a
  call through `request_discovery_call`; every later transition is service-role only until each move
  has its own definer RPC naming who may make it.
- **A public slice of `call_settings`** — the table is `anon`-readable row-wide, so a visitor can
  read the courtesy caps and cooldowns the public offer (`PublicCallOfferSchema`) omits. Still open;
  see [Policies.md](Policies.md).
- **The expiry sweep** — a scheduled job moving `proposed` calls past
  `discovery_call_proposal_ttl_hours` to `expired`. The state and the parameter exist; the cron does
  not.
- **Room provisioning** — minting a meeting URL via the host's `integrations.user_connections`
  token. The columns, the provider resolution (`integrations.fn_conferencing_provider`), and the
  audit action (`link_generated`) exist; the Edge Function does not.
- **Paid-call settlement** — blocked on the flagged `finance.escrows` shape question. See
  [Tables.md](Tables.md).
- **A reschedule-settlement sweep** — a vote whose deadline passes while nobody opens the calendar
  is settled the next time anybody reads it (`settleVote` on the read path), so the event's position
  in the database is correct only once somebody has looked. Notifications that should fire at the
  deadline need a scheduled caller of `close_reschedule_round`; none exists.
