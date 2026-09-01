# analytics Schema: Policies

RLS is **always on**. The posture is **read-scoped, write-closed**: a subject may read the telemetry
attributed to it, and nothing outside `analytics.fn_emit` may write. There is no `UPDATE` or
`DELETE` policy anywhere in the schema — the substrate is append-only, so history can never be
rewritten to flatter a subject's Standing or allowance record.

## 🛡️ Shared authorization helper

- **`analytics.fn_subject_visible(subject_kind, subject_id)`** — `SECURITY DEFINER`, `STABLE`. True
  when the caller may see telemetry attributed to that subject: self for `user`/`freelancer`,
  `org.is_active_business_member` for `business`, `org.is_active_team_member` for `team`,
  `org.is_organisation_member` for `organisation`, or `security.is_admin()`.

  Mirrors `finance.fn_owner_visible`'s posture but covers the broader, non-money subject kinds. The
  `project` / `stage` / `ticket` / `listing` / `platform` subjects are **admin-only** — project
  analytics are read through the `projects` domain, not here.

## 📋 Policies

| Table                       | Policy                     | Effect                                                                   |
| :-------------------------- | :------------------------- | :----------------------------------------------------------------------- |
| `analytics.event_catalogue` | `Read event catalogue`     | `SELECT` to `authenticated`, `USING (true)` — the vocabulary is public.  |
| `analytics.events`          | `View own subject events`  | `SELECT` where `analytics.fn_subject_visible(subject_kind, subject_id)`. |
| `analytics.daily_rollups`   | `View own subject rollups` | `SELECT` where `analytics.fn_subject_visible(subject_kind, subject_id)`. |

## 🔑 Grants

- `authenticated` — `SELECT` on all three tables; `EXECUTE` on `analytics.fn_subject_visible` and
  `analytics.fn_emit`.
- `service_role` — `ALL` on every table, plus `SELECT` on `analytics.v_unregistered_events`.
- **No `INSERT`/`UPDATE`/`DELETE` grant to `authenticated`.** Writes flow exclusively through the
  `SECURITY DEFINER` `analytics.fn_emit`, which resolves the actor from the session — a client can
  never forge an event attributed to another entity.
