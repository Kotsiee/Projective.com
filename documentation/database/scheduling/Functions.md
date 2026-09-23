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
`STABLE`, `SET search_path`.

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
| `weekly_courtesy_cap_reached`   | `courtesy_max_per_week` already met in that ISO week.             |
| `requester_in_cooldown`         | This requester had a free call inside `courtesy_cooldown_days`.   |

**The duration is the provider's, not the requester's**: a booking must match the configured length
exactly, so the grid and the calendar always agree. The two anti-abuse checks apply to **courtesy
calls only** — a paid call is self-limiting.

### `scheduling.fn_can_request_call(…) → boolean`

The boolean face of the same gate (`refusal IS NULL`), for a pre-flight UI check.

---

## 5. Enforcement triggers

| Trigger                       | Timing              | Function                       |
| :---------------------------- | :------------------ | :----------------------------- |
| `trg_enforce_call_request`    | BEFORE INSERT       | `fn_enforce_call_request()`    |
| `trg_enforce_call_transition` | BEFORE UPDATE       | `fn_enforce_call_transition()` |
| `trg_log_call_event`          | AFTER INSERT/UPDATE | `fn_log_call_event()`          |

**`fn_enforce_call_request`** raises `check_violation` with the refusal code when the gate refuses.

**`fn_enforce_call_transition`** enforces the legal-transition matrix and **derives the lifecycle
stamps so a client cannot forge them**: `confirmed_at` / `responded_at` / `completed_at` /
`cancelled_at`, and `is_late_cancel` (computed against
`security.platform_params.discovery_call_cancellation_window_hours`). A reschedule — a return to
`proposed` — increments `reschedule_count` and clears `confirmed_at`. Terminal states accept no
further transition. The matrix is mirrored in `packages/types/scheduling/calls.ts`
(`CALL_TRANSITIONS` / `canTransitionCall`); **the trigger is the authority**, the TypeScript is the
pre-check.

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
as the anonymous client, so a guest and a member are answered identically. Three functions make that
possible without widening any policy.

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
what (`PRODUCT_SPEC.md` §The Proactive Calendar, Part 1.4). Answers for a **published** schedule, or
one the caller may already view (`fn_can_view_schedule`); for anything else it returns no rows
rather than raising. The window is clamped to **120 days** so it cannot page through a provider's
history in one call. `SECURITY DEFINER`, because `scheduling.events` itself stays private (see
[Policies.md](Policies.md)); `EXECUTE` to `anon`, `authenticated`, `service_role`.

The app turns these spans into the slot grid in `packages/backend/services/scheduling/slot-grid.ts`,
which applies the **same** buffer geometry as `fn_slot_is_free` (§3) — a busy span blocks any slot
within `before + after` minutes of either edge, and a blackout blocks on the raw span — so a slot
the grid offers is a slot the gate accepts.

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
on the roster, whoever manages the schedule the event is anchored to (`fn_can_manage_schedule`), or
a participant of the engagement it belongs to (`projects.has_project_access`). `SECURITY DEFINER` so
the roster lookup does not recurse into `event_attendees`' own policy, which calls it. `EXECUTE` to
`authenticated` and `service_role`. See the flagged disclosure note in [Policies.md](Policies.md).

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

It updates the round **conditioned on it still being open** (`collecting` · `awaiting_counterparty`
· `voting`) and returns `NULL` when it was not — so two readers settling the same vote a moment
apart produce one move, and the caller treats `NULL` as "somebody else got there first" and
re-reads. On success it moves `events.starts_at` / `ends_at` (for `resolved`) and appends one
`event_history` line (`rescheduled` for `resolved`, `vote` for `lapsed`, `target_id` = the
proposal), returning its id.

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

---

## Not yet implemented (deferred, deliberately)

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
