# scheduling Schema: Tables

The `scheduling` schema owns **time**: when an entity is generally available, when it will take a
call, and the pre-engagement **discovery call** itself. Added 2026-07-24 by migrations
`20260724100000` (schema + availability), `20260724102000` (events) and `20260724103000` (discovery
calls).

> **Zod SSOT:** `packages/types/scheduling/rows.ts` mirrors the availability/event rows and
> `packages/types/scheduling/calls.ts` the call rows; `packages/types/scheduling/scheduling.ts`
> remains the READ PROJECTION the calendar engine renders. **Additive Rule:** this schema is new —
> nothing existing was altered (root `CLAUDE.md` §1). This file documents the **real migrated schema
> only** (`database/CLAUDE.md`).

## Why a new schema (read first)

`0001_init_schemas.sql` created eleven schemas; `scheduling` was **not** among them, even though
`@projective/types/scheduling` has described itself as a read projection "over the eventual
`scheduling.*` tables" since Decision #37. This materialises that layer. It is deliberately not
folded into `projects` (a `@handle`'s availability is not project-scoped) nor `org` (a schedule is
not identity).

**Boundaries with what already exists — nothing is forked:**

| Concern                               | Owner                                                               | Status                                          |
| :------------------------------------ | :------------------------------------------------------------------ | :---------------------------------------------- |
| A **paid Session Service's** delivery | `projects.session_events` / `cohorts` / `session_attendance` (0007) | Untouched; still authoritative for money + work |
| Coarse discovery signal ("available") | `org.freelancer_profiles.availability_status` (0003)                | Untouched; a ranking cache, not a calendar      |
| **When** someone is bookable          | `scheduling.schedules` + `availability_rules` + `blackout_dates`    | New                                             |
| **Pre-engagement** calls (no project) | `scheduling.discovery_calls`                                        | New                                             |

A `scheduling.events` row may **mirror** a `projects.session_events` row for calendar rendering via
`source_session_event_id`; the projects row stays the source of truth.

---

## 1. Availability (`20260724100000`)

### `scheduling.schedules`

One owner-level header. Everything below it is expressed in **this row's timezone**.

| Column                 | Type                    | Notes                                                                                        |
| :--------------------- | :---------------------- | :------------------------------------------------------------------------------------------- |
| `id`                   | uuid                    | PK.                                                                                          |
| `owner_type`           | `scheduling.owner_type` | `user` / `freelancer` / `team` / `business` / `organisation` — mirrors `wallets.owner_type`. |
| `owner_id`             | uuid                    | The owning entity.                                                                           |
| `timezone`             | text                    | IANA id, default `Europe/London`. Every minute-of-day column resolves in this zone. Must be a name in `pg_catalog.pg_timezone_names` — `trg_check_schedule_timezone` (BEFORE INSERT / UPDATE OF `timezone`, every role) refuses anything else with `22023` `timezone: not a recognised time zone`. |
| `is_published`         | boolean                 | Whether `/[handle]/availability` renders to a visitor at all. Default `false`.               |
| `mask_external_events` | boolean                 | When true a synced block shows only its status label, never its title. Default `true`.       |
| UNIQUE                 | —                       | `(owner_type, owner_id)`.                                                                    |

### `scheduling.availability_rules`

One weekly-recurring band. **`kind` is the load-bearing column**: `working_hours` is the broad "at
my desk" overlay, `call_window` the narrower subset during which the owner accepts a discovery call
— so the UI can paint a call band as a visually distinct subset instead of conflating "I am working"
with "interrupt me".

| Column                      | Type                           | Notes                                            |
| :-------------------------- | :----------------------------- | :----------------------------------------------- |
| `id`                        | uuid                           | PK.                                              |
| `schedule_id`               | uuid                           | FK → `schedules` (CASCADE).                      |
| `kind`                      | `scheduling.availability_kind` | `working_hours` (default) / `call_window`.       |
| `weekday`                   | smallint                       | 0 = Sunday … 6 = Saturday (`CHECK 0–6`).         |
| `start_minute` `end_minute` | integer                        | Minutes from local midnight (`CHECK 0–1440`).    |
| `label` · `is_active`       | text · boolean                 | Optional caption; soft-disable without deleting. |
| CHECK                       | —                              | `end_minute > start_minute`.                     |

> ⚠️ **A band cannot cross local midnight** (that CHECK). A provider taking calls 23:00–01:00
> expresses it as two bands, and a call must fit inside one. Deliberate: midnight-spanning bands
> would materially complicate every downstream free/busy query for a case no surface needs yet. A
> band may still END at midnight (`end_minute = 1440`), and since 2026-09-28 the booking gate
> accepts a slot that ends exactly there (`fn_band_covers`, [Functions.md](Functions.md) §3) — the
> slot grid (`slot-grid.ts`) had always offered a slot ending at 24:00, and the gate refused it.

### `scheduling.blackout_dates`

An absolute span overriding every band beneath it.

| Column                  | Type        | Notes                                         |
| :---------------------- | :---------- | :-------------------------------------------- |
| `id` · `schedule_id`    | uuid        | PK · FK → `schedules` (CASCADE).              |
| `starts_at` · `ends_at` | timestamptz | `CHECK ends_at > starts_at`.                  |
| `label`                 | text        | Owner-authored, default `'Unavailable'`.      |
| `label_is_public`       | boolean     | Default `false` — see the privacy note below. |

> **Privacy.** A published schedule's blackout **spans** are public (a visitor must see the gaps),
> but a label can be intimate ("Surgery", "Bereavement"), so `label_is_public` defaults to false.
> Since 2026-09-28 the rows themselves are readable by the schedule's own members only, and a visitor
> reads the spans through `scheduling.get_public_blackouts` ([Functions.md](Functions.md) §7), which
> returns `label` where `label_is_public` (or the caller may view the schedule) and the generic
> `Unavailable` otherwise. Before that the mask was a render-time convention, and a guest reading
> the table through PostgREST received the private label. See [Policies.md](Policies.md).

---

## 2. Events (`20260724102000`)

### `scheduling.events`

One positioned calendar entry — the persisted backing for the `CalendarEvent` projection.

| Column                            | Type                      | Notes                                                                                 |
| :-------------------------------- | :------------------------ | :------------------------------------------------------------------------------------ |
| `id`                              | uuid                      | PK.                                                                                   |
| `schedule_id`                     | uuid                      | Owner anchor → `schedules` (CASCADE).                                                 |
| `project_id` · `channel_id`       | uuid                      | Project anchor → `projects.projects` (CASCADE) · `comms.project_channels` (SET NULL). |
| `kind`                            | `scheduling.event_kind`   | Mirrors `CalendarEventKind` value-for-value.                                          |
| `status`                          | `scheduling.event_status` | Mirrors `CalendarEventStatus`.                                                        |
| `title` · `starts_at` · `ends_at` | text · timestamptz        | `ck_event_span`: `ends_at >= starts_at` — equal is a deadline, a point in time.       |
| `all_day` · `is_masked`           | boolean                   | `is_masked` → render `status` only, never `title`.                                    |
| `accent`                          | text                      | A CSS custom-property **name** (`--primary`), never a literal colour.                 |
| `location` · `meta` · `href`      | text                      | Presentational.                                                                       |
| `meeting_provider` · `meeting_provider_label` · `meeting_pending` | text · text · boolean | The online room's provider (a slug, or `custom`; deliberately no FK), its display label, and "still to be minted". Readable wherever the row is. |
| `meeting_url` · `meeting_passcode` · `meeting_details` | text      | **The room.** Withheld from every client role at the COLUMN level (`00002520`, since 2026-09-28): a party — the creator, or someone seated — reads them through `scheduling.get_event_rooms`. See [Policies.md](Policies.md). |
| `attendee_count` · `capacity`     | integer                   | Group-session counters (`CHECK >= 0`).                                                |
| `source_connection_id`            | uuid                      | → `integrations.user_connections` (SET NULL) when mirrored in.                        |
| `external_event_id`               | text                      | The provider's own id.                                                                |
| `source_session_event_id`         | uuid                      | → `projects.session_events` (CASCADE) when mirroring a delivered session.             |
| `created_by`                      | uuid                      | → `auth.users` (SET NULL).                                                            |
| CHECK                             | —                         | `schedule_id IS NOT NULL OR project_id IS NOT NULL` (always anchored).                |
| UNIQUE                            | —                         | `(source_connection_id, external_event_id)` — the re-sync upsert key.                 |

> ⚠️ **A discovery call is not a new `kind`.** It is projected as a `booking`. A tenth kind would
> break the shipped calendar engine's exhaustive `Record<CalendarEventKind, …>` label/accent maps,
> turning a data change into a design-system change (root `CLAUDE.md` §3).

**A rostered event moves only through its negotiation.** `trg_guard_rostered_event` (BEFORE UPDATE
OR DELETE, since 2026-09-28) refuses a **client** role (`anon` / `authenticated`) deleting an event
that has any `event_attendees` row, or changing its `starts_at`, `ends_at`, `status` or
`schedule_id` (`55000`) — so a schedule owner cannot step round the 12-hour lockout and the
majority rule, or cascade a roster, its rounds and its log away (root `CLAUDE.md` §5). The service
role is not refused. See [Functions.md](Functions.md) §9.

---

## 2b. Event coordination (`00000022`, FK in `00000031`)

`scheduling.events` positions an occurrence on a grid; these six tables record the negotiation
around it — who is coming, how a time gets moved, what has happened to it, and what was attached.
They are the persisted backing for the `@projective/types/scheduling` `coordination.ts` shapes
(`EventAttendee`, `EventReschedule`, `RescheduleProposal`, `EventHistoryEntry`).

**Read by the parties, written only by the service.** Every one of them is readable through
`scheduling.fn_can_see_event_coordination` ([Functions.md](Functions.md) §9) and carries **no client
write policy**: the 12-hour lockout, who may put a slot on the ballot, one vote per attendee per
round and the majority rule have one implementation
(`packages/backend/services/scheduling/coordination-plan.ts` over the SSOT's pure predicates), and a
direct PostgREST write would bypass every one of them. The scheduling service writes as the service
role after those rules have run (`live-coordination-writes.ts`).

### `scheduling.event_attendees`

| Column         | Type                       | Notes                                                                                           |
| :------------- | :------------------------- | :---------------------------------------------------------------------------------------------- |
| `id`           | uuid                       | PK — the key a vote and a per-attendee write address.                                           |
| `event_id`     | uuid                       | → `events` (CASCADE).                                                                           |
| `user_id`      | uuid                       | → `org.users_public` (SET NULL). Nullable, so an invitee with no account is still a seat.       |
| `role`         | `scheduling.attendee_role` | `host` · `participant` · `optional`.                                                            |
| `response`     | `scheduling.rsvp_response` | `pending` is a real answer ("has not replied"), not the absence of one.                         |
| `responded_at` | timestamptz                | `ck_attendee_pending_unanswered`: `pending` ⇒ `NULL`, so clearing an answer clears its instant. |
| `note`         | text                       | ≤ 280.                                                                                          |
| UNIQUE         | —                          | `(event_id, user_id)` — a registered user holds one seat, so cannot vote twice.                 |

`isViewer` is deliberately not a column: it is a fact about who is ASKING, resolved per request by
identity (`live-calendar.ts` seats a reader where `user_id = auth.uid()`).

### `scheduling.event_reschedules`

One ROUND of a negotiation. `round` counts from **zero**; `resolved`, `lapsed` and `withdrawn` all
end a round, and a fresh proposal opens round `n + 1` with an empty ballot, which is what stops a
withdrawn round becoming a dead end.

| Column                            | Type               | Notes                                                                                              |
| :-------------------------------- | :----------------- | :------------------------------------------------------------------------------------------------- |
| `event_id` · `round`              | uuid · integer     | UNIQUE together (`uq_reschedule_round`).                                                           |
| `mode`                            | text               | `counterparty` (two people) · `vote` (three or more) — a property of the head count, never chosen. |
| `status`                          | text               | `none` · `collecting` · `awaiting_counterparty` · `voting` · `resolved` · `lapsed` · `withdrawn`.  |
| `opened_by_user_id` · `opened_at` | uuid · timestamptz | `ck_reschedule_opened`: only `none` has no opening instant.                                        |
| `resolves_at`                     | timestamptz        | The vote deadline, capped at the event's own lockout; maintained by trigger. `NULL` once `withdrawn`. |
| `resolved_proposal_id`            | uuid               | `ck_reschedule_resolved_names_winner`: set **iff** `resolved`. FK below.                           |

**The winner's FK is composite, in `00000031_tables_fk_scheduling.sql`.** `reschedule_proposals`
references this table back, so the pair is circular and the constraint lives in the trailing FK file
(root `CLAUDE.md` §1): `(resolved_proposal_id, id) → reschedule_proposals (id, reschedule_id)`. A
single-column key would prove the winner is _a_ proposal; the composite one proves it is a proposal
**on this round**.

### `scheduling.reschedule_proposals`

A slot offered on a round. `ck_proposal_span` (`ends_at > starts_at`, strict — a replacement meeting
is not an instant), `ck_proposal_role` (`host` · `attendee`), `ck_proposal_host_preapproved` (a
host's own slot is on the ballot on arrival; an attendee's waits for the host's approval),
`uq_proposal_slot` (the same slot twice would split the vote), and
`uq_proposal_in_reschedule (id, reschedule_id)` — the target the composite FKs point at. At most
twelve rows per round (`RESCHEDULE_PROPOSALS_MAX`), enforced by the `trg_cap_reschedule_proposals`
trigger ([Functions §9](Functions.md)) — a CHECK cannot count sibling rows. A row is written, or
approved, only while its round is open (`trg_guard_reschedule_proposal_write`), and on a live vote
the same statement re-stamps the round's `resolves_at` (`fn_vote_deadline`). An attendee's slot the
host ACCEPTED on a 1-on-1 is marked approved as the round closes on it.

> ⚠️ **Still open (2026-09-28):** the twelve slots are shared by every proposer, approved or not, so
> one attendee can fill a round with unapproved slots and leave the host `ballot_full`; and
> `ck_proposal_span` asks only `ends_at > starts_at`, so nothing bounds a slot's LENGTH but the
> latest instant the route accepts (`SLOT_EPOCH_MAX_MS`). See [Functions.md](Functions.md) §9.

### `scheduling.proposal_votes`

One ballot. `reschedule_id` is denormalised so
`uq_one_vote_per_attendee_per_round
(reschedule_id, attendee_id)` can hold the rule — one vote per
attendee per NEGOTIATION, not per slot — and the composite FK
`(proposal_id, reschedule_id) → reschedule_proposals (id, reschedule_id)` makes the copy
unfalsifiable. Immutable once cast (no `updated_at`). Cast only on a round that is `voting`
(`trg_guard_reschedule_vote_write`, [Functions §9](Functions.md)).

### `scheduling.event_history`

The append-only log (`kind`: `created` · `edited` · `rescheduled` · `proposal` · `vote` · `rsvp` ·
`attachment` · `meeting_link` · `cancelled`). `actor_user_id` → `auth.users` (SET NULL) — `NULL` is
the honest actor for a vote that closed on its own deadline. `target_id` is a flat id (a proposal,
an attendee), never a path. `unread` is deliberately not a column: it is a fact about a reader, so
the live read reports every line as read until a per-viewer marker exists.

### `scheduling.event_attachments`

A JOIN onto `files.items` (CASCADE), not a copy — one asset, one owner, many anchors.

---

## 3. Discovery calls (`20260724103000`)

A discovery call is a **top-of-funnel conversion tool, not a deliverable**: it creates no project,
stage, or ticket, never enters the `PRODUCT_MANAGEMENT.md` §3.1 delivery state-machine, and does not
count toward Workload Intensity. See `PRODUCT_SPEC.md` §Discovery & Courtesy Calls.

### `scheduling.call_settings`

The provider's booking configuration, one row per schedule (PK is `schedule_id`).

| Column                                             | Type             | Notes                                                                            |
| :------------------------------------------------- | :--------------- | :------------------------------------------------------------------------------- |
| `accepts_calls`                                    | boolean          | Master switch, default `false`.                                                  |
| `courtesy_enabled` · `courtesy_duration_minutes`   | boolean · int    | Free calls. Duration `CHECK 5–240`, default 15.                                  |
| `courtesy_max_per_week` · `courtesy_cooldown_days` | integer          | Anti-abuse. `0` = unlimited / no cooldown.                                       |
| `paid_enabled` · `paid_duration_minutes`           | boolean · int    | Paid consultations. Duration `CHECK 5–480`, default 30.                          |
| `fee_amount_minor` · `fee_currency`                | bigint · char(3) | The `(amount_minor, currency)` pair — same money model as `finance`, not a fork. |
| `buffer_before_minutes` · `buffer_after_minutes`   | integer          | The burnout guard (`CHECK 0–240`; after defaults to 10).                         |
| `min_notice_minutes` · `max_advance_days`          | integer          | How close / how far ahead a request may land (default 720 min / 60 days).        |
| `auto_confirm`                                     | boolean          | True → a request inside a call window skips host approval.                       |
| `agenda_required`                                  | boolean          | The anti-tyre-kicker field. Default `true`.                                      |
| `preferred_provider_slug`                          | text             | → `integrations.providers` (SET NULL); null falls back to the active connection. |
| CHECK `ck_paid_call_priced`                        | —                | `paid_enabled` ⇒ a positive fee **and** a currency.                              |

### `scheduling.call_platforms`

The conferencing platforms a host OFFERS for a call, in their preferred order (Decision #108).

| Column          | Type     | Notes                                                                 |
| :-------------- | :------- | :-------------------------------------------------------------------- |
| `schedule_id`   | uuid     | FK → `scheduling.schedules` (CASCADE). PK with `provider_slug`.       |
| `provider_slug` | text     | FK → `integrations.providers` (CASCADE). A slug naming no provider is |
|                 |          | unrepresentable, which is why this is a table and not a `text[]`.     |
| `position`      | smallint | NOT NULL `DEFAULT 0`, `CHECK >= 0`. The host's preference order.      |

An **allow-list, not the truth about what can be minted**: a row offers nothing unless the host also
holds an ACTIVE `integrations.user_connections` row for that provider carrying the `conferencing`
capability, and the public offer (`PublicCallOffer.platforms`) is the INTERSECTION of the two. No
rows at all means "every connected conferencing provider" — what a host who never visited the
setting gets. `call_settings.preferred_provider_slug` stays the default pick within the offered set.
The Consultation modal's platform selector is bound to that resolved list and the booking write
refuses anything outside it (`platform_not_offered`). Zod: `CallPlatformSchema` /
`UpdateCallPlatformsSchema`.

### `scheduling.discovery_calls`

The booking record.

| Group        | Columns                                                                                                                                                                              |
| :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parties      | `host_schedule_id` · `host_user_id` · `requester_user_id` (`CHECK` host ≠ requester)                                                                                                 |
| Kind/state   | `call_type` (`courtesy`/`paid`) · `status` (see [the lifecycle](#the-discovery-call-lifecycle))                                                                                      |
| Slots        | `proposed_start`/`_end` (kept after a reschedule) · `confirmed_start`/`_end` (null until confirmed, and cleared again by a reschedule) · `requester_timezone`                        |
| Intent       | `agenda` · `service_blueprint_id` → `marketplace.service_blueprints` (SET NULL) — the listing the call was booked ABOUT, or NULL for a call booked from the seller's profile         |
| Conferencing | `provider_slug` · `connection_id` · `meeting_url` · `meeting_external_id`                                                                                                            |
| Calendar     | `event_id` → `scheduling.events` (SET NULL)                                                                                                                                          |
| Money        | `fee_amount_minor` · `fee_currency` · `payment_ref` · `escrow_id` · `refund_amount_minor` · `penalty_amount_minor`                                                                   |
| Lifecycle    | `proposed_at` · `responded_at` · `confirmed_at` · `cancelled_at` · `cancelled_by` · `cancellation_reason` · `is_late_cancel` · `completed_at` · `no_show_party` · `reschedule_count` |

Constraints worth knowing: `ck_call_confirmed_has_slot` (a confirmed call must have an agreed slot)
and `ck_call_fee_matches_type` — **a paid call must carry its price and a courtesy call must not**
(free means free, enforced in-DB).

> ⚠️ **FLAGGED — paid calls cannot ride `finance.escrows` yet** (root `CLAUDE.md` §8).
> `finance.escrows` requires **both** `project_stage_id` and `payer_business_id` NOT NULL, so a
> standalone 1-1 paid call between an individual client and a freelancer has no legal escrow row.
> `escrow_id` is nullable and populated only when a call attaches to an already-funded stage. The
> two candidate fixes — (a) relax those two columns (a **protected** table, root `CLAUDE.md` §1), or
> (b) auto-provision a session-format micro-project — both need human sign-off. Until then a paid
> call records its own `payment_ref` and the money path is deferred.

> ⚠️ **FLAGGED — cancellation economics.** `finance-model.md` §4 says a late session cancel forfeits
> 50%; `PRODUCT_SPEC.md` §Sessions says full forfeit (and wins per the hierarchy). That conflict is
> already logged and is **not** re-resolved here: the schema stores `refund_amount_minor` /
> `penalty_amount_minor` as recorded **outcomes**, so whichever rule a human ratifies is expressible
> without another migration. The **courtesy** rules are new and deliberate: a free call has no
> money, so a late cancel or no-show carries **no financial consequence** — it is a reliability
> signal only. Whether that signal feeds `security.penalties` / discovery rank is also flagged.

#### The discovery-call lifecycle

```
proposed  → confirmed → completed
proposed  → declined            (host says no)
proposed  → expired             (unanswered before the slot passed)
confirmed → cancelled           (either party; cancelled_by + is_late_cancel record which/when)
confirmed → no_show             (no_show_party records who)
```

A **reschedule is not a state**: it returns the row to `proposed`, increments `reschedule_count`,
and appends a `call_audit` line. Leaving `confirmed` for `proposed` also clears `confirmed_at`,
`confirmed_start` and `confirmed_end` (since 2026-09-28): free/busy, both parties' agendas and the
booking gate read `COALESCE(confirmed_*, proposed_*)`, so a stale confirmed pair kept the OLD time
occupied and left the new one bookable by somebody else. `declined` / `cancelled` / `completed` /
`no_show` / `expired` are terminal — nothing is hard-deleted (root `CLAUDE.md` §5). Enforced by
`scheduling.fn_enforce_call_transition` and mirrored in `PRODUCT_MANAGEMENT.md` §3.5.

> ⚠️ **Only the first arrow has a client door today.** A client creates a call through
> `request_discovery_call` (`proposed`, or `confirmed` under `auto_confirm`). The client `UPDATE`
> policy and grant were removed on 2026-09-28 because either party could rewrite any column of the
> row ([Policies.md](Policies.md)), and the definer RPCs that are to replace them — each naming who
> may make which move — do not exist yet, so every later transition is currently service-role only.

### `scheduling.call_attendance`

The **"Digital Handshake"** presence log, fed by server-to-server conferencing webhooks
(`SYSTEM_ARCHITECTURE.md` §Conferencing). The evidence a call actually happened — the same role
`projects.session_attendance` plays for a delivered Session Service.

| Column                                             | Type        | Notes                                                         |
| :------------------------------------------------- | :---------- | :------------------------------------------------------------ |
| `call_id`                                          | uuid        | FK → `discovery_calls` (CASCADE).                             |
| `user_id`                                          | uuid        | SET NULL — the provider may report an unmappable participant. |
| `joined_at` · `left_at`                            | timestamptz | `CHECK left_at >= joined_at`.                                 |
| `source_provider_slug` · `external_participant_id` | text        | Which webhook asserted this, and its participant id.          |

### `scheduling.call_audit`

One append-only line per transition, reschedule, or link generation: `action`, `actor_user_id`,
`from_status` → `to_status`, the slot as of that line, and a free-text `detail`. This is where a
reschedule lives, since it has no status of its own.

---

## Enums added

```sql
CREATE TYPE scheduling.owner_type        AS ENUM ('user', 'freelancer', 'team', 'business', 'organisation');
CREATE TYPE scheduling.availability_kind AS ENUM ('working_hours', 'call_window');
CREATE TYPE scheduling.event_kind        AS ENUM ('deadline','milestone','sync','session','booking','availability','busy','holiday','general');
CREATE TYPE scheduling.event_status      AS ENUM ('confirmed','tentative','busy','available','cancelled');
CREATE TYPE scheduling.call_type         AS ENUM ('courtesy', 'paid');
CREATE TYPE scheduling.call_status       AS ENUM ('proposed','confirmed','declined','cancelled','completed','no_show','expired');
CREATE TYPE scheduling.call_party        AS ENUM ('host', 'requester', 'both');
CREATE TYPE scheduling.call_action       AS ENUM ('requested','confirmed','declined','rescheduled','cancelled','completed','marked_no_show','expired','link_generated','reminder_sent');
```

See [Policies.md](Policies.md) for RLS and [Functions.md](Functions.md) for the booking gate.
