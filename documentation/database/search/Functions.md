# search: Functions

Declared in `00001400_functions_search.sql`; the triggers that fire them are in
`00001800_triggers_core_search.sql`. Tables: [Tables.md](Tables.md) · Policies:
[Policies.md](Policies.md).

Only the **index-sync triggers** are documented here. The ranking and query RPCs
(`fn_search_entities`, `fn_search_global`, `fn_log_query`, `fn_search_analytics`, `fn_get_weights`,
`fn_set_weight`, `fn_norm`, `fn_mock_embedding`, `is_admin`) are not yet written up.

---

## The index-sync triggers

Six `AFTER INSERT OR UPDATE` triggers keep `search.*_index` in step with the source rows, so a title
edit is searchable without a rebuild.

| Function                          | Fires on                  | Writes to               |
| :-------------------------------- | :------------------------ | :---------------------- |
| `search.sync_team_to_index`       | `org.teams`               | `search.profiles_index` |
| `search.sync_freelancer_to_index` | `org.freelancer_profiles` | `search.profiles_index` |
| `search.sync_project_to_index`    | `projects.projects`       | `search.projects_index` |
| `search.sync_user_to_index`       | `org.users_public`        | `search.profiles_index` |
| `search.sync_business_to_index`   | `org.business_profiles`   | `search.profiles_index` |
| `search.sync_service_to_index`    | `marketplace.services`    | `search.services_index` |

Each is an upsert keyed on the source id, so re-running one is idempotent and a row can never be
duplicated by a second write.

---

## ⚠️ An `INVOKER` sync trigger is a WRITE BLOCKER on its source table

`00002500` grants `authenticated` only `SELECT` on schema `search`, and every `*_index` table has
RLS enabled with a **SELECT-only** policy ([Policies.md](Policies.md)). So an `INVOKER` sync trigger
cannot write its index row on an ordinary client's behalf, and the caller's own statement fails:

```
ERROR:  permission denied for table projects_index
CONTEXT: PL/pgSQL function search.sync_project_to_index() line 3 at SQL statement
```

The error names a table the caller never mentioned, inside a statement they never wrote, on a table
their own RLS policy explicitly permits — which is what makes it expensive to diagnose. **Widening
the grant does not fix it**: with `INSERT`/`UPDATE` granted the trigger then raises
`new row violates row-level security policy for table "projects_index"`. Two layers, both blocking.

`SECURITY DEFINER` is the correct fix, and it is what every other function in
`00001400_functions_search.sql` already is. The search index is derived, internal and nobody's
row-level property: it is maintained **by the platform**, not by whoever happened to trigger it.

### Current state

- ✅ `search.sync_project_to_index` is
  `SECURITY DEFINER SET search_path = public, search, projects`. Corrected because a client write to
  `projects.projects` is a live path — the engagement editor's `PATCH /api/projects/[id]` — and was
  measurably failing on it (reproduced as `authenticated` against a seeded project the caller owns,
  then re-verified passing after the change).
- ⚠️ The **other five remain `INVOKER`** and carry the identical defect. They are latent only
  because their own client write paths are still stub-first, so nothing exercises them as
  `authenticated` today. Each gates a different domain's writes (`org`, `marketplace`) and belongs
  to that domain's pass. **A team, business, profile or service write path that goes live before its
  sync trigger is made `SECURITY DEFINER` will fail exactly as the project one did.**
