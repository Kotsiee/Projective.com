# ops: Functions

## The job registry (Decision #203)

Migration [`00001650_functions_ops_scheduler.sql`](../../../supabase/migrations/00001650_functions_ops_scheduler.sql);
triggers `00001897`; grants at the end of `00002510`. Every function is `SECURITY DEFINER` with
`search_path = ''` and owned by `postgres`, the pg_cron owner. Only `ops.run_job` is executable by a
role (`service_role`); `ops` is exposed to PostgREST, so every other one is revoked from `PUBLIC`,
`anon`, `authenticated` and `service_role`. Every skip or failure raises a `WARNING` and writes an
`ops.log_entries` row (`scope = 'ops.scheduler'`, `client_id = 'scheduler:<job>:<reason>'`).

| Function                                                     | Returns   | What it does                                                                                                                                                                                                                                                             |
| :----------------------------------------------------------- | :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn_log_scheduler_event(job, reason, level, message, data, once_a_day)` | `void`    | The scheduler's log: WARNING + one ops row; `once_a_day` collapses a repeating configuration skip to one row per job and reason a day.                                                                                                                                         |
| `fn_job_command(name)`                                       | `text`    | What pg_cron runs: the row's `SELECT` (sql), or `SELECT ops.fn_dispatch_http_job('<name>')` (http).                                                                                                                                                                     |
| `fn_schedule_job(name)`                                      | `boolean` | Applies one row to pg_cron (`cron.schedule` upserts by name; a disabled row is unscheduled). An invalid cron expression raises `22023`, refusing the write. A missing pg_cron (`pg_cron_unavailable`) or any other refusal (`schedule_failed`) is logged and returns `false`. Unknown name: `PJ404`. |
| `fn_unschedule_job(name)`                                    | `void`    | `cron.unschedule` when the job exists; a no-op without pg_cron.                                                                                                                                                                                                          |
| `tg_scheduled_jobs_apply()` · `fn_touch_updated_at()`        | trigger   | AFTER INSERT/UPDATE/DELETE: unschedules a deleted or renamed job and applies the row. BEFORE UPDATE: stamps `updated_at`.                                                                                                                                                  |
| `fn_dispatch_http_job(name)`                                 | `bigint`  | Reads `CRON_APP_URL` and the row's `secret_name` from `vault.decrypted_secrets`, queues `net.http_post(<origin><path>, '{}', Authorization: Bearer …, 120 s timeout)` and records it in `http_job_dispatches`; returns the request id. Missing pg_net, Vault, origin or a bearer under 32 characters → `NULL` and a once-a-day `warn` row; a pg_net refusal → an `error` row. |
| `fn_settle_http_dispatches()`                                | `integer` | Settles pending dispatches from `net._http_response` (`FOR UPDATE SKIP LOCKED`), logs every non-2xx, error or timeout (`http_failed`) and every dispatch unanswered after 7 hours (`no_response`) as `error`; returns the failure count. |
| `fn_report_failed_runs()`                                    | `integer` | Reports every failed pg_cron run of the last day (`cron.job_run_details`) as one `run_failed` error row, keyed by run id so it is reported once; returns the number newly reported. |
| `fn_watch_jobs()`                                            | `integer` | `fn_settle_http_dispatches() + fn_report_failed_runs()` — the `ops-watch-jobs` job, every 10 minutes. |
| `run_job(name)` — **`service_role`**                         | `jsonb`   | Runs one job now, enabled or not: a sql job's `SELECT` (`{job, kind, result}`, the result as jsonb) or an http job's dispatch (`{job, kind, request_id}`). Unknown name: `PJ404`. Behind `deno task cron:run` (`ScheduledJobsBackendService`).                                   |

Probe: [`supabase/probes/scheduled_jobs.sql`](../../../supabase/probes/scheduled_jobs.sql) (registration,
registry ↔ `cron.job` agreement, reschedule/disable, loud skips, the queued request and its bearer,
settlement, grants).
