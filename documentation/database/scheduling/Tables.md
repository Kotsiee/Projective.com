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
| `timezone`             | text                    | IANA id, default `Europe/London`. Every minute-of-day column resolves in this zone.          |
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
> would materially complicate every downstream free/busy query for a case no surface needs yet.

### `scheduling.blackout_dates`

An absolute span overriding every band beneath it.

| Column                  | Type        | Notes                                         |
| :---------------------- | :---------- | :-------------------------------------------- |
| `id` · `schedule_id`    | uuid        | PK · FK → `schedules` (CASCADE).              |
| `starts_at` · `ends_at` | timestamptz | `CHECK ends_at > starts_at`.                  |
| `label`                 | text        | Owner-authored, default `'Unavailable'`.      |
| `label_is_public`       | boolean     | Default `false` — see the privacy note below. |

> **Privacy.** A published schedule's blackout **spans** are readable by `anon` (a visitor must see
> the gaps), but a label can be intimate ("Surgery", "Bereavement"). `label_is_public` defaults to
> false and a reader that is not `fn_can_view_schedule` must render the generic `Unavailable`
> string, never `label`.

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
| `title` · `starts_at` · `ends_at` | text · timestamptz        | `CHECK ends_at > starts_at`.                                                          |
| `all_day` · `is_masked`           | boolean                   | `is_masked` → render `status` only, never `title`.                                    |
| `accent`                          | text                      | A CSS custom-property **name** (`--primary`), never a literal colour.                 |
| `location` · `meta` · `href`      | text                      | Presentational.                                                                       |
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

### `scheduling.discovery_calls`

The booking record.

| Group        | Columns                                                                                                                                                                              |
| :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parties      | `host_schedule_id` · `host_user_id` · `requester_user_id` (`CHECK` host ≠ requester)                                                                                                 |
| Kind/state   | `call_type` (`courtesy`/`paid`) · `status` (see [the lifecycle](#the-discovery-call-lifecycle))                                                                                      |
| Slots        | `proposed_start`/`_end` (kept after a reschedule) · `confirmed_start`/`_end` (null until confirmed) · `requester_timezone`                                                           |
| Intent       | `agenda`                                                                                                                                                                             |
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
and appends a `call_audit` line. `declined` / `cancelled` / `completed` / `no_show` / `expired` are
terminal — nothing is hard-deleted (root `CLAUDE.md` §5). Enforced by
`scheduling.fn_enforce_call_transition` and mirrored in `PRODUCT_MANAGEMENT.md` §3.5.

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
