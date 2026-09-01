# analytics Schema: Functions

Two functions, both `SECURITY DEFINER` with a pinned `search_path` (migration
`20260724110000_analytics_event_substrate.sql`).

## `analytics.fn_emit(...) → uuid`

```sql
analytics.fn_emit(
    p_name          text,
    p_subject_kind  analytics.subject_kind,
    p_subject_id    uuid    DEFAULT NULL,
    p_properties    jsonb   DEFAULT '{}',
    p_value         numeric DEFAULT NULL,
    p_project_id    uuid    DEFAULT NULL,
    p_domain        text    DEFAULT NULL,
    p_actor         uuid    DEFAULT NULL
) RETURNS uuid
```

The **single write path** into `analytics.events`. `authenticated` has no `INSERT` grant, so every
event — from a client, from a trigger, or from a backend service — arrives through here.

Two properties make it safe to call from anywhere:

1. **The actor cannot be spoofed.** `p_actor` is honoured only for a privileged caller
   (`security.is_admin()`, or a session with no `auth.uid()`, i.e. service role / a definer chain).
   Everyone else is attributed to `auth.uid()`.
2. **It never raises.** The body is wrapped in an `EXCEPTION WHEN OTHERS` that returns `NULL` —
   telemetry must never break the business transaction that emitted it. A failed emit loses a data
   point; it does not lose a proposal, a payout or a project.

`domain` falls back to the `event_catalogue` entry's domain, then to `'platform'`.

## `analytics.fn_subject_visible(subject_kind, subject_id) → boolean`

`STABLE`. The RLS predicate behind every `SELECT` policy in the schema — see
[Policies.md](Policies.md).

---

## 📇 Registered event vocabulary

Seeded into `analytics.event_catalogue` by the same migration. These 15 names are the measurement
substrate for the subscription, entitlement and Standing systems.

### Billing (`domain = 'billing'`)

| Event                    | Emitted when                        | Key properties                                             |
| :----------------------- | :---------------------------------- | :--------------------------------------------------------- |
| `subscription.started`   | A plan became active for a subject. | `plan_code`, `tier`, `audience`, `price_cents`, `interval` |
| `subscription.changed`   | A subject moved between plans.      | `from_plan`, `to_plan`, `direction`, `reason`              |
| `subscription.cancelled` | Cancelled or allowed to lapse.      | `plan_code`, `at_period_end`, `reason`                     |

### Entitlements & allowances (`domain = 'allowance'`)

| Event                          | Emitted when                                             | Key properties                                             |
| :----------------------------- | :------------------------------------------------------- | :--------------------------------------------------------- |
| `entitlement.checked`          | A limit was resolved for a subject.                      | `key`, `effective_limit`, `source`                         |
| `entitlement.denied`           | An action was blocked by a cap — **the upgrade signal**. | `key`, `effective_limit`, `attempted`                      |
| `allowance.consumed`           | A metered unit was spent (one proposal).                 | `key`, `units`, `remaining`, `from_buffer`, `period_start` |
| `allowance.exhausted`          | A subject hit zero.                                      | `key`, `granted`, `period_start`                           |
| `allowance.period_rolled`      | A new period opened with a fresh grant.                  | `key`, `granted`, `base`, `standing_bonus`, `plan_code`    |
| `allowance.buffer_replenished` | The rolling drip topped the buffer back up.              | `key`, `units`, `buffer_cap`                               |

`entitlement.denied` is the metric that matters commercially: it is simultaneously the anti-spam
proof (caps are binding) and the conversion funnel (who is hitting them, on which lever).

### Standing & gamification (`domain = 'standing'`)

| Event                    | Emitted when                         | Key properties                                              |
| :----------------------- | :----------------------------------- | :---------------------------------------------------------- |
| `standing.recomputed`    | The composite was recalculated.      | `score`, `level`, `components`                              |
| `standing.level_changed` | A subject moved a rung.              | `from_level`, `to_level`, `direction`, `score`              |
| `mastery.progressed`     | CREATE-category mastery advanced.    | `category`, `stages_completed`, `mastery_level`, `share_bp` |
| `achievement.awarded`    | A milestone/designation was granted. | `code`, `tier`                                              |
| `streak.extended`        | A quality streak was extended.       | `kind`, `current_count`, `best_count`                       |
| `streak.broken`          | A quality streak lapsed.             | `kind`, `previous_count`                                    |

Emitters: `org.fn_recompute_standing`, `org.fn_award_achievement`, `org.fn_touch_streak`,
`org.fn_record_mastery` (migration `20260724111000`); `finance.fn_current_allowance`,
`finance.fn_consume_allowance`, and the two enforcement triggers (migration `20260724113000`).
