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

### `scheduling.fn_band_covers(schedule, kind, starts_at, ends_at, blueprint? = NULL) → boolean`

**The preset branch (Decision #217 (d)).** With a `blueprint` whose effective preset
(`fn_preset_for_blueprint`, §10) has been compiled over the span's dates
(`compiled_from <= local date of starts_at` and `compiled_through >= local date of ends_at`, both in
the schedule's zone), coverage means "inside **one** `availability_occurrences` span of that layer"
(`fn_occurrence_covers`). Every other case uses the weekly answer below: no blueprint, no preset, a
preset not compiled yet, a slot past the horizon, or a preset whose rules changed since it was
compiled. A compiled span may cross midnight; a weekly band may not. Now plpgsql (it was SQL); the
4-argument call sites (`fn_call_window_covers`, the comms out-of-hours auto-reply) resolve to it
unchanged.

**Callers that pass a blueprint:** `projects.fn_book_session_slot` (#211) tests the FIRST sitting
against `working_hours` with the listing's blueprint and refuses `PS409` ("outside the provider's
hours"). The pencilled-in later sittings are agreed through their handshakes. **Discovery calls do
not pass one:** ruling (d) keeps discovery calls and `/[handle]/availability` on the weekly bands,
so `request_discovery_call` → `fn_call_request_refusal` → `fn_call_window_covers` is unchanged, even
for a call booked about a listing.

**The weekly answer.** Is the whole span inside **one** active weekly band of that kind? Resolves the
schedule's own timezone, then compares local weekday + minute-of-day at both edges.

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

Does a non-`cancelled`, non-`availability`, non-`passive` event on this schedule overlap the span?
(`availability` rows describe openness, so they never occupy time, and a `passive` entry is time its
owner left open to be booked over, Decision #389.) `fn_slot_is_free` reaches events only through
this, so every booking gate, and the `busy` auto-reply, follows it with no change of its own.

### `scheduling.fn_is_blacked_out(schedule, starts_at, ends_at) → boolean` (`20260724102000`)

Does the span intersect a blackout?

### `scheduling.fn_slot_is_free(schedule, starts_at, ends_at, exclude_call = NULL) → boolean`

The composite: rejects on blackout, conflicting event, or an existing `proposed`/`confirmed` call,
leaving out `exclude_call` so a call moving its own time is not refused for overlapping itself.
Falls back to `security.platform_params.discovery_call_default_buffer_minutes` when no settings row
exists. It is the one free-time predicate of all three booking gates: the discovery-call gate (§4),
the 1-1 session gate (`projects.fn_book_session_slot`, audit S-06: before 2026-10-30 that gate tested
events and blackouts only, so a paid session could be booked on top of a requested or confirmed
call) and a new group sitting (`projects.schedule_sitting`). Each caller holds the schedule's row
lock while it asks (§7).

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

### `scheduling.fn_call_request_refusal(schedule, requester, type, starts_at, ends_at, exclude_call = NULL) → text`

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
| `trg_guard_event_recurrence`  | BEFORE INSERT OR UPDATE OF `recurrence_rule`, `recurrence_parent_id`, `schedule_id`, `project_id` on `events` | `fn_guard_event_recurrence()` (§9) |
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
> path. The expiry sweep's own WHERE clause is its only guard (§7b).

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
and the `owner_user_id` of the team, business or enterprise otherwise. A discovery call names a
host user (it is a meeting between two people), so a team's calls are hosted by whoever answers for
the team. `SECURITY DEFINER`; **`EXECUTE` is `service_role` only** — it is an internal resolver for
the request door below, not something a client needs to call.

### `scheduling.get_free_busy(schedule, from, to) → TABLE(starts_at, ends_at)`

The occupied spans on a schedule inside a window: every non-`cancelled` event that is not itself an
`availability` block or `passive`, plus every discovery call still `proposed` or `confirmed`. It reads
the same rows `fn_has_conflicting_event` does and has to agree with it, or the grid refuses a slot the
gate would take. **Spans only** — no
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
- the **flavour** is courtesy only, so the row carries no fee: a paid request is refused
  `paid_unavailable` (below);
- the **platform** must be one of the host's `call_platforms`, and is required when they list any;
- the **listing** must be a published blueprint the host (or the host's team) sells;
- an **agenda** is demanded when `agenda_required`;
- the **status** is `proposed`, or `confirmed` (with `confirmed_*` stamped) when `auto_confirm`.

The slot itself — call window, notice, horizon, free time, weekly cap, cooldown — is judged by the
existing BEFORE INSERT gate (`fn_enforce_call_request`, §5), which fires because the insert runs
with the caller's `auth.uid()`.

**Paid calls are refused** (audit S-02; Decision #343, ruling C1). Nothing writes a paid call's
`payment_ref` or `escrow_id`, so this door booked a paid consultation with no money behind it, born
`confirmed` under `auto_confirm`, outside the courtesy caps and with nothing to expire it. A request
with `call_type = 'paid'` now raises `paid_unavailable`, after the sign-in and age checks and before
the schedule lock and the insert, so it never queues behind a real request. The signature is
unchanged and the refusal is permanent: the ruled money path (one hidden Consultations engagement per
host on the session rail) books a paid call through checkout, never through this door. The app hides
the flavour through one seam, `PAID_CALLS_LIVE` (`packages/types/scheduling/calls.ts`): the public
call offer reports `paidEnabled: false` and the booking service refuses a paid request first.

**One request at a time per schedule** (audit S-07, 2026-10-30). Before anything is derived, the
function takes `SELECT … FROM scheduling.schedules WHERE id = p_schedule FOR UPDATE`. The gate reads
the calls already on the schedule, so under READ COMMITTED two requests for one slot used to read
each other as absent, both pass and double-book the host. The second now waits on the row, and its
insert's gate (a fresh statement, so a fresh snapshot) sees the first. It is the same lock
`projects.fn_book_session_slot` and `projects.schedule_sitting` take, so a call, a 1-1 booking and a
new group sitting queue behind one another. Probe: `supabase/probes/scheduling_slot_integrity.sql`.

The host is then told through the notification engine
(`comms.fn_notify`, type `availability.booking_request`), which never raises and routes by the
host's own preferences. Returns `{ id, status }`.

A refusal raises `check_violation` with the message `Discovery call refused: <reason>`, where the
reason is either one of the gate codes in §4 or one of these:

| Code                   | Cause                                                        |
| :--------------------- | :----------------------------------------------------------- |
| `not_signed_in`        | No `auth.uid()`.                                             |
| `paid_unavailable`     | A paid call: off until its money path exists (above).        |
| `calls_not_offered`    | The schedule is unpublished, has no host, or takes no calls. |
| `self_booking`         | The requester is the host.                                   |
| `agenda_required`      | The host requires an agenda and none was given.              |
| `platform_not_offered` | The platform is not on the host's list.                      |
| `platform_required`    | The host lists platforms and none was chosen.                |
| `listing_mismatch`     | The listing is unpublished or not the host's to sell.        |

`EXECUTE` to `authenticated` and `service_role`; revoked from `anon` and `PUBLIC`.

---

## 7b. Expiring unanswered requests (`00001510` §7)

### `scheduling.fn_expire_discovery_calls(limit = 500) → integer`

The writer of `proposed → expired` (audit S-11; Decision #343, ruling C3). A `proposed` call holds
its slot in free/busy, the booking gate (`fn_slot_is_free`) and both agendas until it is answered,
so before this sweep a request nobody answered held the host's time for good, and one account could
hold every slot of a calendar out to its booking horizon. The sweep moves a call to `expired` once
it has waited `discovery_call_proposal_ttl_hours` (72) since `proposed_at`, or once its
`proposed_start` has come, whichever is first. It touches nothing else on the row, and an expiry is
not a response, so `responded_at` stays empty. It tells the requester and the host (`call.expired`,
in-app and email, through `comms.fn_notify`), and returns how many calls it expired or completed.

It is also the writer of `confirmed → completed` for a courtesy call past `confirmed_end` (ruling
C3). A paid call never completes here: it completes through its sitting.

`fn_enforce_call_transition` checks nothing for a writer with no `auth.uid()`, and the job has none,
so the WHERE clause is the sweep's only guard: still `proposed`, and past one of the two times.
Candidates are taken `FOR UPDATE SKIP LOCKED`, so two overlapping runs never take one call and a call
being answered at that moment waits for the next run; a row that changed before its lock is re-read
and dropped if it no longer qualifies. A run takes at most `limit` calls. It is idempotent: a second
run finds nothing to expire and tells nobody again. `trg_log_call_event` writes the `expired` audit
line, with no actor.

`SECURITY DEFINER`, `search_path = ''`. `EXECUTE` to `service_role` only (revoked from `PUBLIC`,
`anon` and `authenticated`). Scheduled as `scheduling-expire-discovery-calls` at minutes 1, 16, 31
and 46 (`00005060`): the seed registers that row by this function's name, so it registers itself on
the first reset after the function exists. `deno task cron:run scheduling-expire-discovery-calls`
runs it by hand. Probe: `supabase/probes/discovery_call_expiry.sql`.

## 7c. The discovery-call doors (`00001510` §7b; audit S-10, Decision #343, ruling C3)

There is no client write on `discovery_calls`, so each door is the only way to make its move. Every
door is `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` to `authenticated` and `service_role`, and
locks the call first through `fn_lock_call`, which refuses a stranger and a missing call alike
(`call_not_found`), so an id cannot be probed. A refusal is `Discovery call refused: <code>`.
`fn_enforce_call_transition` stays the legality authority and stamps everything derived, and
`trg_log_call_event` writes the audit line, now including a move on a call still `proposed`. Each door
tells the other party (`call.confirmed`, `call.declined`, `call.time_proposed`, `call.cancelled`,
`call.no_show`) through `fn_notify_call`, and withdraws the call's queued reminders.

| Door                                        | Who                                         | From → to                   | Refusals                                                                      |
| :------------------------------------------ | :------------------------------------------ | :-------------------------- | :---------------------------------------------------------------------------- |
| `confirm_discovery_call(call)`              | The counterparty of the last proposal       | `proposed → confirmed`      | `not_open` · `not_your_move` · `slot_passed`                                  |
| `decline_discovery_call(call, reason?)`     | The host, at any time                       | `proposed → declined`       | `not_open` · `not_your_move`                                                  |
| `propose_call_time(call, start, end)`       | Either party                                | `proposed` or `confirmed` → `proposed` | `not_open` · `inside_lockout` · `duration_mismatch` · any gate refusal |
| `cancel_discovery_call(call, reason?)`      | Either party; a requester may also withdraw | `confirmed` or `proposed` → `cancelled` | `not_open` · `slot_passed`                                         |
| `mark_call_no_show(call, party)`            | Either party, naming the other              | `confirmed → no_show`       | `not_open` · `not_your_move` · `too_early` · `attendance_contradicts`         |

**Who accepts** (Decision #383, SCH-WP3): `discovery_calls.proposed_by` names who made the proposal on
the table, and its counterparty accepts it, so a host cannot confirm their own new time.

**A move** keeps the call's length, must clear the 12-hour lockout at both the current and the new
start (the courtesy lockout, pinned to `RESCHEDULE_LOCKOUT_HOURS` by
`coordination.contract.test.ts`), takes the schedule row lock, and passes `fn_call_request_refusal`
again with the call itself excluded. A confirmed call returns to `proposed`, which frees its old span.

**A no-show** opens `session_presence_minutes` after `confirmed_start`. Where `call_attendance` shows
the named party in the room by then, the mark is refused (`attendance_contradicts`).

Paid calls: the decline refund and completion through a sitting are SCH-WP6's. Probe:
`supabase/probes/discovery_call_doors.sql`.

### `scheduling.fn_enqueue_due_reminders() → integer`

The reminder producer (audit S-18), scheduled as `scheduling-reminders` every 5 minutes. It queues
`session.reminder_60m/15m/5m` for every scheduled sitting (at each type's `default_lead_time`, for the
host and every active seat) and `call.reminder` for every confirmed call (at
`discovery_call_reminder_lead_minutes`, for both parties), through `comms.fn_enqueue`. A reminder
whose time has passed is skipped. The dedupe key names the person as well as the entity
(`sitting:<id>:<type>:<user>`, `call:<id>:<user>`), because the queue's unique index is on the key
alone. It first withdraws any queued reminder its entity no longer keeps. `EXECUTE` to `service_role`
only.

Calendar entries are its third section (Decision #388): every entry `fn_event_takes_reminders` admits,
for each of `fn_event_holders`, one row per alert of `fn_event_alerts`, on `event.reminder` or
`event.reminder_email` so the channel stays on the catalog and the person's preferences still narrow
it. A row is queued 15 minutes before it is due, so a move has little to withdraw. The key names the
start as well (`entry:<id>:<user>:<minutes>:<channel>:<epoch>`), so a moved entry alerts again. Unlike
the two above, an alert past its moment is not skipped: an entry made inside its own lead still alerts,
once (a `sent` or `failed` row is the proof), with `fn_reminder_words` saying how long is really left,
until five minutes after the start. An entry a call is drawn from alerts as the call.

### `scheduling.fn_event_takes_reminders(event row) → boolean`

Whether an entry takes a person's alerts at all: not a connected calendar's row, which alerts through
its provider; not a sitting's mirror, which has its own; not archived or cancelled; not an open slot, a
busy block or leave. `takesReminders` in `@projective/types/scheduling` is the same rule, held equal by
`reminders.test.ts`. Internal.

### `scheduling.fn_event_alerts(event, user) → TABLE(minutes, channel)`

One person's alerts for one entry: their `event_reminders` row, else
`ui_settings -> 'calendar_reminders'`, else the platform's list (`DEFAULT_ENTRY_REMINDERS`, held equal by
the same test). `SECURITY DEFINER`, because the sweep reads every person's preferences. Internal.

### `scheduling.fn_reminder_rows(reminders jsonb) → TABLE(minutes, channel)`

A stored list as rows, deduplicated, nearest first, capped at 5. Anything malformed is skipped rather
than raised: clients write both stores through PostgREST, and one bad value must not stop the sweep.
Internal, with `fn_reminder_words(minutes) → text`, which words a lead for a notification.

### `scheduling.get_own_call_settings(schedule) → SETOF call_settings`

The owner's read of their whole row (audit S-16), behind `fn_can_manage_schedule`. The client grant
stops at what a visitor may read, so the Availability editor reads through this door.

## 7d. Rooms (`00001510` §7d; Decision #343, ruling C4; Decision #383)

Whatever creates a sitting or confirms a call queues its room, through triggers, so no booking door
knows about rooms. `trg_sitting_provider` gives a new sitting its listing's provider, else the host's
connected default. `trg_sitting_room` and `trg_call_room` queue the room, mark it `moved_at` when the
time changes, and close it when the sitting or call is cancelled.

| Door (service role only)                                      | What it does                                                                                     |
| :------------------------------------------------------------ | :----------------------------------------------------------------------------------------------- |
| `claim_rooms_to_mint(limit) → TABLE(...)`                     | Takes due rooms `FOR UPDATE SKIP LOCKED` and counts an attempt. A mint left `minting` for ten minutes is taken again. |
| `attach_room(room, connection, meeting, host, url, passcode)` | Writes the room and the column its owner withholds. A second attach is a no-op.                  |
| `fail_room(room, error, final = false)`                       | Back in the queue up to `room_mint_max_attempts`, then `failed`, telling the host (`room.failed`). |
| `claim_rooms_to_sync(limit)` · `room_synced(room, error?)`    | Moved or closing rooms; best effort, and never blocks a booking.                                 |
| `claim_rooms_to_reconcile(limit)` · `room_reconciled(room, error?)` | Ended rooms whose provider's record is due a read: from 15 minutes after the end for 3 days, hourly. Only a read that worked is stamped, so a sitting that needed it stays held (ruling R5). |
| `save_room_registrant(room, user, registrant, url, attendee?)` | A person's own link, or a guest's by their seat, which the service makes the first time an attendee joins a licensed room.  |

`fn_room_connection(host, provider)` is the active connection a room mints on: a Teams room mints
through the `outlook` connection, one Entra app and one consent. Probe: `supabase/probes/rooms.sql`.

### `scheduling.fn_queue_waiting_rooms(host, provider_slug) → integer`

A host who connects an account gets the rooms that were waiting for one (Decision #386), called by
`integrations.fn_store_connection` on a grant with `conferencing`. A room that failed on that provider
is queued again, and an upcoming sitting with no room at all gets one. A Microsoft connection makes
Teams rooms. Definers only.

### `scheduling.set_entry_room(events uuid[], provider, link?, passcode?) → void`

A host setting the room on their own `/calendar` entries (Decision #383 (f)), `authenticated`. A
provider with an account behind it queues a room, a pasted link makes a `custom` room that is `ready`
at once, and anything else leaves no room, so a pick with nothing behind it is not a failure. The same
provider again is a no-op. A room that changes keeps its row and its `/meet` address, which its
attendees already hold. Another person's entry, a sitting's mirror and a project's event are skipped.
`trg_entry_room` then follows the entry: moved, the room is marked; cancelled, it is closed.

### `scheduling.get_call_rooms(call_ids uuid[]) → TABLE(call_id, room_slug)`

The rooms of the caller's own confirmed calls. A call's `meeting_url` is withheld from clients at the
column level, and a party joins through `/meet`.

### `scheduling.room_join(slug) → jsonb`

Into a room, as the signed-in person: `state` · `role` · `opens_at` · `closes_at` · `provider` · `url`.
A sitting asks `projects.session_join_link`; a call must be confirmed; an event's attendee must have
accepted or be tentative. States: `open`, `upcoming`, `ended`, `cancelled`, `not_party`, `needs_rsvp`,
`unfunded`, `unconfirmed`, `no_room`. A person's own registrant link wins over the room's. Pressing
join while the room is open writes a `join_click`, the one piece of evidence that an attendee came
which does not depend on a provider.

## 7e. Attendance (`00001510` §7e; Decision #383 (b))

### `scheduling.record_presence(provider, meeting, action, at, event_key, participant_key, email?, registrant?, account?, source?) → jsonb`

One participant joining, leaving or waiting, from a verified webhook or a post-meeting read. Service
role only. It never raises, because a webhook that fails is redelivered forever: it answers `recorded`
· `replayed` · `unmatched` · `outside_window` (an hour either side of the meeting). Who it was,
strongest first: the host by their account at the provider, a person by their registrant id, then the
email a provider reported, which never matches somebody holding a personal link on this room. In a
room with one attendee, a participant nobody can name who is not the host is that attendee, by
elimination. It then re-derives the person's one-row summary from everything that has arrived, so
delivery order cannot change the answer.

### `scheduling.fn_room_presence(room) → TABLE(user_id, participant_key, matched_by, is_host, first_join_at, last_leave_at, total_seconds, reconnect_count, in_presence_window, open_span)`

Time actually in the room. Several devices at once count once, time is clipped to the meeting, and a
join with no `left` adds nothing after it (ruling C5 (c)), which `open_span` reports. Once a provider's
own record has been read it is the whole story, so a `left` lost in a webhook costs nothing. The dispute audit
reads this. Probe: `supabase/probes/presence_ledger.sql`.

### `scheduling.fn_prune_presence() → jsonb`

Retention, finance-model.md §17 (Decision #383, ruling R8), run daily by `scheduling-presence-retention`
and by nothing else. A person's records go after `presence_retention_days` (395), and a participant with
no account behind them after `presence_unmatched_retention_days` (30), in the ledger and in its
one-row summaries. `fn_sitting_evidence_held` outranks both periods: a dispute on the sitting keeps its
records, open or closed, and so does a seat whose money is still held, because the sweep reads
attendance and a deleted record must never read as no record.

---

## 7g. Outbound mirrors (`00001510` §7g; Decision #383, ruling R3)

Triggers mark rows of `scheduling.event_mirrors` dirty, and `CalendarSyncBackendService.pushDue` claims
them, writes or removes the provider's copy and reports back. What a copy should say is read at claim
time, so a burst of edits is one write. The inbound half is `integrations.*`
([`integrations/Functions.md`](../integrations/Functions.md)). A proof:
`supabase/probes/calendar_sync.sql`.

| Function | Does |
| :------- | :--- |
| `fn_event_goes_out(event) → boolean` | Whether an event goes out at all. A busy row read from a provider never does, which is why nothing can loop, and neither does an opted-out, cancelled or archived event, an availability block or a point in time. Internal. |
| `fn_event_holders(event) → SETOF uuid` | Who holds it: everyone seated who answered accepted or tentative, or on an event with no roster its creator and, on a group sitting, its seat-holders. Internal. |
| `fn_call_goes_out(call) → boolean` | Whether a call goes out at all. Only an agreed time does: `confirmed`, and `completed` and `no_show`, which keep their copy as a past event does. A request, or a move waiting on its counterparty, holds none. A call drawn from an events row goes out as that row, so its `external_sync` is never gone round. Internal. |
| `fn_queue_event_mirrors(event) → void` | An event changed: marks its copies, and opens one on every connection that should now hold it. A copy that should no longer exist stays marked, and the job removes it. Internal. |
| `fn_queue_call_mirrors(call) → void` | The same for a call, whose holders are its two parties. Internal. |
| `fn_open_event_mirrors(connection) → integer` | Queues a connection's owner's upcoming events and calls, for a calendar just turned on or made again. Past ones stay out. Internal. |
| `claim_event_mirrors(p_limit) → jsonb` | Takes the copies due, `SKIP LOCKED`, under a 10-minute lease. `event` is what the copy should say: title, time, days in the schedule's zone and the room's slug, and never an agenda, location, attendee or provider link. A call's title is `A call on Projective`, the one its room carries at the provider, so neither party is named. `NULL` means it should not exist. Service role. |
| `finish_event_mirror(p_mirror, p_claimed_at, p_dirty_at, p_external_event_id, p_version) → void` | What the provider answered, for a claim still held. No external id means the copy is gone, and the row with it. A copy that changed during the call stays dirty, because `p_dirty_at` no longer matches. Service role. |
| `fail_event_mirror(p_mirror, p_claimed_at, p_error) → void` | A refused write backs off from 5 minutes, doubling, and the eighth stops until the event next changes. Service role. |

Triggers (`00001860`): `trg_event_mirrors` on a change to `title`, `starts_at`, `ends_at`, `all_day`,
`status`, `archived_at`, `external_sync`, `availability_behavior` (a copy says whether it blocks time:
`transparent` in the claim, Google's `transparency`, Graph's `showAs`) or `attendee_count`, which is what
moves when a group seat starts or ends, and never on `routine_id`, because a routine is in no copy;
`trg_event_mirrors_deleted`; `trg_call_mirrors` on a change to a call's `status`,
`confirmed_start`, `confirmed_end` or `event_id`, except into `completed` or `no_show`, which change
nothing a copy says; `trg_call_mirrors_deleted`; `trg_attendee_mirrors` on an RSVP; and
`trg_room_mirrors_opened` and `trg_room_mirrors_changed`, because a copy carries its room's address.
None fires for a row read from a provider.

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

## 8b. Invitations and clashes (`00001510` §5c, `00001520`; Decision #390)

### `scheduling.fn_invitable_event(event) → events`

The entry behind an invitation, locked `FOR UPDATE`, or the reason there is none to make. `42501` if
the caller cannot manage its schedule. `55000` for an engagement's meeting, a sitting, an entry from
a connected calendar, a series, a moment, a `session`, `booking`, `availability`, `busy`, `deadline`
or `holiday` kind, a mirrored call, an entry that is over, or one with a round open, because a round's
mode and electorate are counted from the roster. No client role reaches it, only its two doors.

### `scheduling.invite_to_event(event, users uuid[] = '{}', emails text[] = '{}') → integer`

Seats people on the caller's own entry and tells them (`schedule.event_invite`) in one transaction,
so no seat exists that nobody was told about. Answers how many were newly asked. Somebody already
seated keeps their answer and hears nothing; somebody withdrawn is asked afresh on the same row. The
host takes a seat with the first guest. At most 50 seats, host included (`EVENT_ROSTER_MAX`, pinned
by `coordination.contract.test.ts`). `trg_seat_holds_time` flips a passive entry to `disruptive`.
An address is a guest (Decision #391), told by a queued `guest_mail` row instead of a notice. It is
only ever an address: whether an account holds it is never looked up, so nothing here tells a host who
owns one. A seat with no `user_id` needs an address, and this is where that holds. Refuses (`55000`) a
malformed address, an address that opted out, a host under 18, and past `GUEST_INVITES_DAILY_MAX` (50)
addresses a day per host, pinned the same way. `EXECUTE` to `authenticated`.

### `scheduling.withdraw_invitation(event, attendee = NULL) → integer`

Archives one guest's seat, or with no attendee every guest's, and tells each of them
(`schedule.event_invite_withdrawn`, or by email for a guest who had heard, whose links die here). With
the last guest gone the host's seat goes too, so the entry
has no roster and moves like any other. `removeEntry` calls it when a roster refuses the removal,
which is how a host cancels an entry people are on. `EXECUTE` to `authenticated`.

## Guests (`00001510` §5d, Decision #391)

A guest is a seat held by an address. They have no session, so their link is their whole authority,
and every door they use is **service role only**: a host who could reach these could answer for their
own guests. A dead link answers the same whatever killed it.

| Function                                                 | What it does                                                                                                                                                                 |
| :------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claim_guest_mail(limit = 50)` → table                   | Takes what is due, minting a link for each message that needs one and handing back its raw value, which is stored nowhere. Skips an opted-out address. A claim is retaken after five minutes. |
| `finish_guest_mail(mail, sent)` → void                   | Records how a claimed message went. Five refusals in a row stops it, and the host is told.                                                                                   |
| `guest_invitation(token)` → jsonb                        | What a link shows. The title, time and host are all a link alone gets. The place waits until they have said they are coming.                                                 |
| `guest_answer(token, response)` → boolean                | A guest's answer. `pending` is refused (`22023`). A log line that never names the address, and none for a restated answer.                                                   |
| `guest_request_code(token)` → jsonb                      | Mints the 6-digit code, kept only as a hash, for the caller to mail. Only for somebody who has said they are coming, while the room is open: `sent` · `wait` (60s) · `limit` (10) · `closed` · `dead`. |
| `guest_room_join(token, code, device)` → jsonb           | `room_join`'s event branch, with the code standing in for a session. Records a `join_click` against the seat, with `device` as `participant_key`. Five misses lock the code.  |
| `guest_opt_out(token)` → boolean                         | Files the address's hash and drops what had not gone out. `invite_to_event` refuses that address from then on.                                                               |
| `get_guest_addresses(events uuid[])` → table             | `authenticated`. The addresses on the caller's own entries, and whether each could be reached. How a host reads a column no client role holds.                               |
| `guest_seat_is_mine(token)` → boolean                    | `authenticated`. Does the reader hold this link's address, verified? An unverified address proves nothing, because anybody can file one.                                     |
| `claim_guest_seat(token)` → uuid                         | `authenticated`. Moves the seat onto the caller's account, clearing `email` and killing its links. Never automatic, because it shows their name to the host and the other guests. Somebody already seated keeps their seat, with this answer. |
| `fn_forget_guest_addresses()` → integer                  | Job `scheduling-forget-guest-addresses`. Blanks an address 30 days after its entry ends or its seat is withdrawn. The seat stays, nameless.                                   |
| `fn_event_has_voters(event)` → boolean                   | `authenticated`, because `fn_guard_rostered_event` runs as its caller. Is anybody on this entry who can vote?                                                                |
| `fn_guest_link(token)`, `fn_guest_hash(text)`, `fn_guest_safe_text(text)`, `fn_guest_room_state(seat, event)`, `fn_retire_guest_seat(seat, tell)` | Internal. `fn_guest_safe_text` takes `comms.mask_pii` and adds every other link, because a mail client makes a link of anything that looks like one. |

`trg_guest_moved` (AFTER UPDATE OF `starts_at`, `ends_at` on `events`) returns a guest's answer to
`pending` and queues `moved`, on the table because a time moves from several places and a round can
close from a page read.

### `scheduling.fn_notify_event_seats(event, who, lead, body, actor) → void`

Tells an entry's `host`, its `guests` or `everyone`, the actor apart (`schedule.event_reschedule`).
The writer calls it for a proposed time and an opened round, and `close_reschedule_round` for a move.
A DEFINER because those run as the service role, which holds no USAGE on `comms`, and service role
only, or a client could ping a whole roster.

### `scheduling.fn_detect_event_clashes(user, starts_at, ends_at, exclude_event = NULL) → jsonb`

What already holds a person's own time across a span, as `[{kind, id, title, startsAt, endsAt}]`,
earliest first. `kind` is `event`, `call` or `blackout`. An event counts when it is on their
schedule, they created it on an engagement, or they hold an `accepted` or `tentative` seat, and it is
not `cancelled`, archived, `availability`, a `deadline`, `passive` or a moment. A pending or declined
seat holds nothing. Both edges are open, so back to back is no clash. A call mirrored into an event
answers as the call. `detectTimeClash` (`@projective/types/scheduling`) applies the same test to a
page's entries. **It names what it finds, so it answers for the caller alone** (`42501` otherwise):
a door that took anybody's id would read out their calendar. `EXECUTE` to `authenticated`.

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

### `scheduling.get_own_event_details(event_ids uuid[]) → TABLE(event_id, title, location, description, series_id, recurrence_rule, join_url)`

What the caller's connected calendars say about their own entries (Decision #387): the
`connected_event_details` row of each listed entry on a `user` schedule the caller owns, unarchived,
and nothing for any other id. Up to 500 ids; past that it answers nothing. It is that table's only way
out, and it answers the owner alone, a platform admin included. Definer, `authenticated` and
`service_role`. `readPersonalCalendar` folds it in after assembly (`connected-details.ts`), where a
series' first occurrence on the page stands as its master.

### `scheduling.get_event_rooms(event_ids uuid[]) → TABLE(event_id, meeting_url, meeting_passcode, meeting_details, room_slug)`

The meeting room for the events the caller is a **party** to — their creator, or seated on them and
having `accepted` or answered `tentative` — and nothing for any other id in the list (added
2026-09-28; the RSVP gate is Decision #383: a link reaches only somebody who is coming). `room_slug`
is the minted room's address, which the read turns into `/meet/rom-…` in place of the provider's link.
`meeting_url`, `meeting_passcode` and
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
rounds, the votes and the log away, root `CLAUDE.md` §5), and an update that changes its `status` or
`schedule_id` is refused (`55000`, "propose a new time instead"), as is one that changes its
`starts_at` or `ends_at` while anybody seated can vote (`fn_event_has_voters`). A guest holds no vote,
so an entry with only guests moves freely and the guests are told (Decision #391), while its status
still needs a withdrawal, or it could go with them never told. Any other role — the scheduling service, which closes rounds through
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

### Routines and availability behaviour (`00001510` §5b; Decision #389)

| Function | Does |
| :------- | :--- |
| `fn_event_holds_time(event row) → boolean` | Does somebody else rely on this entry? True for an engagement's meeting, a sitting's mirror, a `session` or `booking`, or anything with a roster. Those can never be passive. `EXECUTE` to `authenticated` and `service_role`, because the guard below runs as the caller. |
| `fn_guard_event_behavior()` → trigger (`trg_guard_event_behavior`) | BEFORE INSERT OR UPDATE OF `availability_behavior`, `kind`, `project_id`, `source_session_event_id`, on a passive row only. Refuses a commitment `55000`, for every role. |
| `trg_seat_holds_time()` → trigger | AFTER INSERT OR UPDATE on `event_attendees`. A seat makes an entry a commitment, so a passive one takes its time back, whichever door the seat came through. Asks `fn_event_has_roster`, so a seat that does not count changes nothing. A definer, because an attendee cannot write the event. |
| `trg_routine_behavior()` → trigger | AFTER UPDATE OF `behavior` on `routines`. Moves the entries that agreed with the routine; one its host set apart keeps its own, and a commitment stays. A **definer**, because the predicate reads the whole row and the room's columns are withheld from every client role. The routine's own RLS has already passed, and `fk_event_routine` keeps every row it can reach on that routine's schedule. |
| `organise_event(event, changes jsonb) → uuid[]` | Organises one entry and **its whole series**, a connected calendar's included. `changes` names `routine_id` (null takes it out) and `availability_behavior`; a key left out stays. Joining takes on the routine's behaviour unless the same call names one; leaving changes nothing else. Writes these two columns only, skips a row already saying so (`trg_event_mirrors` fires on the column, changed or not, so this is what keeps a save from queueing a provider write per occurrence), and answers the ids it wrote. `42501` for an entry not on a schedule the caller manages, `55000` for a commitment asked to go passive or a routine that is gone. A definer because a connected series is found through `connected_event_details`. `EXECUTE` to `authenticated` and `service_role`. Proof: `supabase/probes/scheduling_routines.sql`. |

### `scheduling.fn_guard_event_recurrence()` → trigger (`trg_guard_event_recurrence`)

Added 2026-11-03 (Decision #375); trigger in `00001860`. Keeps a recurring series one level deep
and on one anchor, for **every** role. An occurrence's `recurrence_parent_id` must name a master (a
row with `recurrence_rule`) on the same `schedule_id` and `project_id`. The master is locked
`FOR SHARE` while the occurrence attaches. A master that still has occurrences may not drop its rule
or move anchor. Both refusals are `23514` with `<field>: <reason>` messages. The table's CHECKs
cover the rest: `ck_event_recurrence_shape` (an occurrence carries no rule) and
`ck_event_recurrence_not_self`.

`SECURITY DEFINER` (`search_path = ''`), so a manager editing a master cannot pass the occurrence
check because RLS hides an occurrence from them. The body runs two key lookups on
`scheduling.events` and returns `NEW`; it has no dynamic SQL. `EXECUTE` is revoked from `PUBLIC`,
`anon` and `authenticated` (`00002510`). A trigger function's privilege is checked only at
`CREATE TRIGGER`.

### `scheduling.close_reschedule_round(round, status, resolved_proposal, actor, summary, detail) → uuid`

A round that carries also tells everyone on the entry but its actor (`schedule.event_reschedule`, by
`fn_notify_event_seats`): here because every ending comes through this door, a vote settled by
somebody's page load included. A sitting has its own session notices, so its mirror is left out.

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

**A session sitting's mirror is negotiated 1-on-1 or not at all.** `trg_sitting_round_guard`
(`BEFORE INSERT OR UPDATE OF event_id, mode` on `event_reschedules`, function
`projects.trg_sitting_round_guard` in `00001155` §4c) refuses (`55000`) any round on an event whose
`source_session_event_id` names a sitting, unless the round is `counterparty` and the sitting's
engagement is a 1-1 (`session_kind = 'normal'`). So no round, and no vote, can move a group sitting,
whichever role writes — see [`database/projects/Functions.md`](../projects/Functions.md) § Sessions —
group sittings for why (a seat's refund is judged against the cohort's first sitting).

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

## 10. Availability presets & recurrence (`00001510` §10, Decision #217)

The database stores rules and compiled spans and lets the gate read the spans. It never expands an
RRULE: `@projective/types/scheduling` `evaluate.ts` is the one evaluator. See
[Tables.md](Tables.md) §4 for the model and the horizon.

### `scheduling.save_availability_preset(schedule, preset jsonb) → uuid`

The preset editor's one write, in one transaction. **`SECURITY INVOKER`**, like
`save_owner_availability`: the preset, rule and band policies (`fn_can_manage_schedule`) decide who
may write, and the explicit check up front only names the refusal. Granted to `authenticated` and
`service_role`.

| Payload key          | Effect                                                                                                                                                                                       |
| :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | Absent creates. Present updates that live preset on this schedule, which keeps its `scope` and service (`scope: a saved preset keeps its scope and service`).                                 |
| `name` `description` | 1–60 characters (a live library name is unique per schedule, case-insensitively) · up to 200.                                                                                               |
| `scope` `blueprint_id` | `library` (default) with no service, or `service` with the blueprint being forked for.                                                                                                     |
| `is_default`         | `true` moves the default here. A library preset saved onto a schedule with no default becomes it. A default is moved, never cleared: `false` on the current default leaves it the default.   |
| `rules`              | **Replaces** the rules and bands: at most 64 rules, each `{id?, kind, effect, rrule, starts_on, ends_on?, priority?, unless_weekdays?, label?, is_active?, bands: [{start_minute, end_minute}]}` with at most 6 bands. A uuid `id` is kept; anything else is minted. |

The RRULE is checked for shape only (`FREQ=` prefix, ≤ 400 characters). The service re-validated it
with the TypeScript parser, the authority on its meaning (flag d). Refusals: `42501`
(`auth: sign in to edit availability`, `schedule: you cannot edit this schedule`), `22023` with a
`<field>: <reason>` message for the input, and **`PM403`** for a restricted caller. That last one is
raised by `trg_preset_guard` on the preset write, before any rule is touched (below). The rule writes
mark the preset not compiled (`trg_invalidate_preset_compilation`). The service compiles it straight
after.

### `scheduling.archive_availability_preset(preset) → uuid[]`

Presets are archived, never deleted. Sets `archived_at`, NULLs `availability_preset_id` on every
bound blueprint (each falls back to the schedule's default), and returns their ids so the caller can
name the services that moved. Archiving the default hands the default to the most recently edited
live library preset. **The default cannot be archived while it is the only library preset**
(`22023`). Idempotent: an archived preset returns `{}`. **`SECURITY DEFINER`**, because unbinding
writes `marketplace.service_blueprints`, whose policies are not the schedule's. The authority is
`fn_can_manage_schedule` on the preset's schedule (`42501`). A call without `auth.uid()` can only
be the service role (the grants). `P0002` for an unknown id.

### `scheduling.replace_preset_occurrences(preset, from, to, spans jsonb) → integer`

The compiler's door (`ScheduleBackendService.compileOccurrences`, C7). **`SECURITY DEFINER`, EXECUTE
granted to `service_role` only**: there is no client write path to `availability_occurrences`. It
replaces every occurrence of the preset overlapping `[from, to)` with `spans`, where each element is
an `OccurrenceSpanSchema` (`{kind, startsAt, endsAt, ruleIds}`). It then stamps the compiled window:
the preset-local dates wholly inside `[from, to)`, joined to the previous window when the two touch
(a horizon extension) and replacing it otherwise. It checks only what the database can know: each
span is a layer, ends after it starts, lies inside the window (≤ 400 days, ≤ 10,000 spans), and
names only this preset's rules (`22023`). Whether the spans are right is the evaluator's word.
Returns the number of spans written.

### `scheduling.fn_preset_for_blueprint(blueprint) → uuid`

The preset a blueprint's bookings are judged against: the bound preset, else the owner schedule's
live default, else NULL. An archived preset never answers. Between an individual's two possible
schedules, the `freelancer` one wins, as in `projects.fn_session_host_schedule`. Granted to every
client role, like `fn_band_covers`.

### `scheduling.fn_occurrence_covers(preset, kind, from, to) → boolean`

Is the span inside one compiled occurrence of that layer? It does not ask whether the preset was
compiled over the span; `fn_band_covers` asks that first. Service role only (the gate calls it as
its owner).

### Helpers and triggers

- **`fn_preset_schedule(preset)` · `fn_rule_schedule(rule)` → uuid**: the parent schedule, as
  definers, so the rule, band and occurrence policies can ask `fn_can_manage_schedule` /
  `fn_can_view_schedule` about a parent row the caller might not read. Granted to `authenticated`.
- **`fn_is_owner_schedule(schedule, owner_team, owner_person)`**: is this the schedule a blueprint
  with these owner columns books into (the team's, else the seller's `user` / `freelancer` one)?
- **`trg_preset_guard()`**: `trg_preset_guard` BEFORE INSERT OR UPDATE on `availability_presets`.
  It raises `PM403` (`scheduling: availability presets unlock at 18`) when the caller, or the
  person who owns the schedule, is restricted. That is the same `org.fn_is_minor` predicate
  `trg_schedule_age_gate` uses (Decision #208), and it holds for a direct table write too. It
  raises `23514` when a fork names a service not sold from this schedule.
- **`trg_blueprint_preset_binding()`**: `trg_blueprint_preset_binding` BEFORE INSERT OR UPDATE OF
  `availability_preset_id`, `owner_team_id`, `freelancer_profile_id` on
  `marketplace.service_blueprints`, the CHECK half of the `00000031` FK. It raises `23514` when the
  bound preset is archived, sits on another schedule, or is another service's fork.
- **`trg_invalidate_preset_compilation()`**: AFTER any write to `recurrence_rules` /
  `recurrence_rule_bands` and AFTER UPDATE OF `timezone` on `schedules`. It NULLs
  `compiled_from` / `compiled_through`, so the gate falls back to the weekly bands until the service
  recompiles.

### Callers (`ScheduleBackendService`, C7)

| Door | Called by | As |
| :-- | :-- | :-- |
| `save_availability_preset` | `savePreset` (`PUT /api/scheduling/presets`) and `bindListing`'s override fork (`POST /api/catalogue/availability`) | the owner |
| `archive_availability_preset` | `archivePreset` (`POST /api/scheduling/presets/archive`) | the owner |
| `replace_preset_occurrences` | `compileOccurrences`: straight after every save and fork, and `extendHorizons` (`POST /api/scheduling/cron/horizon`, job `scheduling-availability-horizon`) | service role |
| `save_owner_availability` | `savePreset` / `archivePreset` when the default preset changes: its active, open-ended, every-week `add` rules already in force are mirrored into `availability_rules` (calls clipped to working hours). `mirrored.full = false` tells the editor the rest is not mirrored | the owner |
| `fn_preset_for_blueprint` + the occurrence spans | the session slot grid (`live-slots.ts`), which judges each slot by `fn_band_covers`' own rule (`slot-grid.ts` `gateCovers`); the spans are read with the service client because occurrences carry no `anon` grant | service role |

A compile evaluates the preset in its schedule's zone over today → today + 120 days, with the
schedule's blackouts cut out. The gate still checks blackouts itself, so a blackout added after a
compile is honoured at once. A removed blackout leaves its hole in the spans until the next
recompile. Every rule edit invalidates the window (`trg_invalidate_preset_compilation`); a blackout
edit does not.

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
- **Room provisioning** — minting a meeting URL via the host's `integrations.user_connections`
  token. The columns, the provider resolution (`integrations.fn_conferencing_provider`), and the
  audit action (`link_generated`) exist; the Edge Function does not.
- **Paid-call settlement** — ruled (Decision #343, ruling C1): one hidden Consultations engagement
  per host on the session rail, the fee held at request. **Not built yet**; until then the paid
  flavour is refused (§7). See [Tables.md](Tables.md).
- **A reschedule-settlement sweep** — a vote whose deadline passes while nobody opens the calendar
  is settled the next time anybody reads it (`settleVote` on the read path), so the event's position
  in the database is correct only once somebody has looked. Notifications that should fire at the
  deadline need a scheduled caller of `close_reschedule_round`; none exists.

## Scheduling and under-18 accounts (`00001510`, Decision #208)

A restricted (13–17) account schedules nothing with other people. `scheduling.trg_schedule_age_gate()`
— `trg_schedule_age_gate` BEFORE INSERT / UPDATE OF `is_published`, `owner_id` on `schedules` and
`trg_call_settings_age_gate` BEFORE INSERT / UPDATE OF `accepts_calls` on `call_settings`
(`00001860`) — refuses a minor's person schedule being published or taking calls (`PM403`); the
tables are written directly under RLS (`save_owner_availability` is an invoker), hence the trigger.
`fn_schedule_is_public` never answers true for a minor's schedule, and `request_discovery_call`
asserts the requester is an adult. A minor's private calendar is untouched. Since Decision #217 a
minor also holds no availability preset (`trg_preset_guard`, §10), and
`projects.fn_book_session_slot` asserts the buyer is an adult itself, not only through
`place_wallet_order`.
