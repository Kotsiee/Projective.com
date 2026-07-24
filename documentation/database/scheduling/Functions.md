# scheduling Schema: Functions

The booking engine. Every predicate is pure and `STABLE`, so **the same function backs the
pre-flight "is this slot bookable?" check the UI makes and the hard gate the trigger applies at
INSERT** — the rules cannot drift between the two. Added 2026-07-24 by migrations
`20260724100000`, `20260724102000` and `20260724104000`.

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

| Function                                         | Returns  | Notes                                                                     |
| :----------------------------------------------- | :------- | :-------------------------------------------------------------------------- |
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
*calls*, not to erode declared time off.

---

## 4. The booking gate

### `scheduling.fn_call_request_refusal(schedule, requester, type, starts_at, ends_at) → text`

Returns **NULL when the request is allowed**, or a machine-readable reason code when it is not.
Returning a *reason* rather than a bare boolean lets the UI explain a refusal without re-deriving
the rules client-side. The codes are mirrored in `packages/types/scheduling/calls.ts`
(`CallRefusalReason` + `CALL_REFUSAL_COPY`) — keep the two in step.

| Code                            | Cause                                                                  |
| :------------------------------ | :---------------------------------------------------------------------- |
| `calls_not_offered`             | No settings row, or `accepts_calls = false`.                            |
| `courtesy_not_offered`          | `courtesy_enabled = false`.                                             |
| `paid_not_offered`              | `paid_enabled = false`.                                                 |
| `duration_mismatch`             | The span isn't the configured length for that call type.                |
| `duration_exceeds_platform_max` | Beyond `discovery_call_max_duration_minutes`.                           |
| `inside_minimum_notice`         | Closer than `min_notice_minutes`.                                       |
| `beyond_booking_horizon`        | Further ahead than `max_advance_days`.                                  |
| `outside_call_window`           | Not covered by a `call_window` band.                                    |
| `slot_unavailable`              | Fails `fn_slot_is_free` (blackout / conflict / buffer collision).       |
| `weekly_courtesy_cap_reached`   | `courtesy_max_per_week` already met in that ISO week.                   |
| `requester_in_cooldown`         | This requester had a free call inside `courtesy_cooldown_days`.         |

**The duration is the provider's, not the requester's**: a booking must match the configured length
exactly, so the grid and the calendar always agree. The two anti-abuse checks apply to **courtesy
calls only** — a paid call is self-limiting.

### `scheduling.fn_can_request_call(…) → boolean`

The boolean face of the same gate (`refusal IS NULL`), for a pre-flight UI check.

---

## 5. Enforcement triggers

| Trigger                        | Timing               | Function                          |
| :----------------------------- | :------------------- | :--------------------------------- |
| `trg_enforce_call_request`     | BEFORE INSERT        | `fn_enforce_call_request()`       |
| `trg_enforce_call_transition`  | BEFORE UPDATE        | `fn_enforce_call_transition()`    |
| `trg_log_call_event`           | AFTER INSERT/UPDATE  | `fn_log_call_event()`             |

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
| :----------------------------------------- | :------ | :------------------------------------------------------------------------ |
| `discovery_call_cancellation_window_hours` | `24`    | Inside this, a cancel is flagged `is_late_cancel`.                       |
| `discovery_call_default_buffer_minutes`    | `10`    | Trailing buffer when a provider hasn't set their own.                    |
| `discovery_call_max_duration_minutes`      | `240`   | Hard ceiling on any single call.                                         |
| `discovery_call_reminder_lead_minutes`     | `60`    | How far ahead the reminder is dispatched.                                |
| `discovery_call_proposal_ttl_hours`        | `72`    | How long an unanswered proposal stays live before the sweep expires it.  |

> The **cancellation window flags** a late cancel; it does not price one. A **courtesy** call has no
> money, so a late cancel carries no financial consequence at all. For a **paid** call the
> `finance-model.md` §4 (50%) vs `PRODUCT_SPEC.md` §Sessions (full forfeit) conflict is already
> logged and is deliberately **not** resolved in SQL — the per-call `refund_amount_minor` /
> `penalty_amount_minor` columns record whichever outcome a human ratifies.

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
