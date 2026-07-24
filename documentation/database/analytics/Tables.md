# analytics Schema: Tables

The `analytics` schema is the platform's **event substrate** and its pre-calculated daily rollups. It
was scaffolded by `0001_init_schemas.sql` and stayed empty until migration
`20260724110000_analytics_event_substrate.sql`, which landed it as the measurement layer beneath the
subscription / Standing / allowance systems.

Zod SSOT: **`@projective/types/analytics`** (`packages/types/analytics/events.ts`).

> **Why it exists.** Every allowance magnitude, entitlement cap and Standing threshold in the
> subscription system is an explicitly **tunable dial**, not a law — 50 proposals/week, the 3-per-10h
> drip, the listing ladder, the rung thresholds. Those dials can only be re-fitted if the platform
> records what actually happened. Allowance grants and consumption, entitlement denials, rung
> transitions and achievement awards therefore all write here.

---

## 🗂 `analytics.event_catalogue`

The documented event vocabulary. Event **names stay `text`** (a new event must not require an enum
migration mid-feature) but every name the platform emits is registered here.

| Column          | Type                       | Notes                                                |
| :-------------- | :------------------------- | :---------------------------------------------------- |
| `name`          | text                       | PK. Dotted convention, e.g. `allowance.consumed`.    |
| `domain`        | text                       | `billing` / `standing` / `allowance` / `projects` /… |
| `description`   | text                       | What the event means.                                |
| `subject_kinds` | `analytics.subject_kind[]` | Which subjects this event may be attributed to.      |
| `property_keys` | text[]                     | Documented keys expected inside `events.properties`. |
| `is_active`     | boolean                    | Default `true`.                                      |

Seeded with the 15 events of the billing / allowance / standing systems (see
[Functions.md](Functions.md) for the emit contract).

---

## 📈 `analytics.events`

The append-only substrate. **Append-only by discipline** — there is no `UPDATE`/`DELETE` policy, and
the only write path is `analytics.fn_emit`.

| Column          | Type                     | Notes                                                                           |
| :-------------- | :----------------------- | :-------------------------------------------------------------------------------- |
| `id`            | uuid                     | PK.                                                                              |
| `occurred_at`   | timestamptz              | Default `now()`.                                                                 |
| `name`          | text                     | Registered in `event_catalogue` by convention (drift is reported, not blocked).  |
| `domain`        | text                     | Resolved from the catalogue when omitted; default `platform`.                    |
| `subject_kind`  | `analytics.subject_kind` | The entity the event is **about**.                                               |
| `subject_id`    | uuid                     | `NULL` only when `subject_kind = 'platform'` (CHECK-enforced).                   |
| `actor_user_id` | uuid                     | FK → `auth.users.id` (SET NULL). The user who **caused** it.                     |
| `project_id`    | uuid                     | FK → `projects.projects.id` (SET NULL). Optional project scope.                  |
| `value`         | numeric(18,4)            | Numeric payload lifted out of `properties` so rollups skip JSON extraction.      |
| `properties`    | jsonb                    | Default `{}`.                                                                    |

**Indexes:** BRIN on `occurred_at` (naturally correlated with physical order), btree on
`(subject_kind, subject_id, occurred_at DESC)` and `(name, occurred_at DESC)`, and a partial index on
`actor_user_id`.

> **Scale-out (deferred, deliberate):** monthly `RANGE` partitioning is the documented next step. It
> is a physical reorganisation rather than an additive change, so it is left to a dedicated migration
> with human sign-off.

---

## 📊 `analytics.daily_rollups`

One row per `(day, metric, subject)`. A new breakdown never needs a new column — it goes in
`dimensions`.

| Column         | Type                     | Notes                                                                  |
| :------------- | :----------------------- | :----------------------------------------------------------------------- |
| `id`           | uuid                     | PK.                                                                     |
| `day`          | date                     | Rollup day.                                                             |
| `metric`       | text                     | e.g. `proposals.consumed`, `entitlement.denials`.                       |
| `subject_kind` | `analytics.subject_kind` | —                                                                       |
| `subject_id`   | uuid                     | Nullable (platform-wide rollups).                                       |
| `dimensions`   | jsonb                    | Optional breakdown (plan code, entitlement key, rung, CREATE category). |
| `value`        | numeric(18,4)            | The aggregate.                                                          |
| `sample_count` | integer                  | Rows behind the aggregate.                                              |
| UNIQUE         | —                        | `(day, metric, subject_kind, subject_id, dimensions)`.                  |

---

## 👁 `analytics.v_unregistered_events`

A catalogue-drift monitor: event names present in `events` but absent from `event_catalogue`, with
occurrence counts and last-seen timestamps. `service_role` only.

---

## 🏷 Enum

```sql
CREATE TYPE analytics.subject_kind AS ENUM (
    'user', 'freelancer', 'business', 'team', 'organisation',
    'project', 'stage', 'ticket', 'listing', 'platform'
);
```
