# ops: Tables

_Not yet documented._ This file is scaffolded to match the domain/kind structure described in
[../README.md](../README.md), but no Tables content has been written for the `ops` schema yet.

See `brain2.md`'s Database section for the general migration-numbering and RLS conventions this
domain follows once populated.

## `ops.reports` — not migrated

The user-reporting table of the Two-Zone moderation model (Decision #148) **does not exist yet**:
`00000013_tables_ops.sql` defines only `ops.admin_users` and `ops.log_entries`. Its proposed shape —
`reporter_user_id`, `reported_subject_type`, `reported_subject_id`, `reason`, an immutable
server-built `evidence_snapshot jsonb`, `status` (`pending` · `dismissed` · `actioned`) and
`resolution_notes` — is in `SYSTEM_ARCHITECTURE.md` §Backend Services → Content moderation. It is
documented here only when its migration, RLS policies and Zod schema land (see
[../CLAUDE.md](../CLAUDE.md): this folder documents the migrated schema).

## `ops.log_entries` — production diagnostics and web vitals

Migration [`00000013_tables_ops.sql`](../../../supabase/migrations/00000013_tables_ops.sql); RLS
[Policies.md](Policies.md); indexes `idx_log_entries_created` and `idx_log_entries_level_created` in
`00004002`. Zod SSOT: `@projective/types/logging` (`LogBatchSchema`, `WebVitalsBatchSchema`,
`PersistedLogLevel`). Written only by `LogBackendService` (`packages/backend/services/logging/`),
inserted **as the caller** through PostgREST (the `ops` schema is exposed for this table alone) and
retried anonymously when the caller's token no longer verifies. Gated by `LOGGING_BACKEND_LIVE`:
off ⇒ log batches are echoed to the server console and vitals are acknowledged silently.

Three writers, one table:

| Writer                                                      | Route                   | `level`          | `source` | `scope`      |
| :---------------------------------------------------------- | :---------------------- | :--------------- | :------- | :----------- |
| The app logger (`apps/web/utils/logger.ts`), production only | `POST /api/logs`        | `warn` · `error` | `client` | caller-set   |
| `WebVitalsBridge` (shell island), production only           | `POST /api/logs/vitals` | `metric`         | `client` | `web-vitals` |
| `routes/_error.tsx` on a 5xx                                | (none: server-side)     | `error`          | `server` | `ssr`        |
| `finance.fn_reconcile_wallets` (pg_cron, nightly — Decision #186) | (none: in-database) | `error`          | `server` | `finance.reconcile_wallets` |
| The job registry's functions (`ops.fn_log_scheduler_event` — Decision #203) | (none: in-database) | `warn` · `error` | `server` | `ops.scheduler` |
| `finance.settle_card_payment` — a settlement whose amount / currency cannot match its payment, held for reconciliation (one row per Stripe event, `client_id = 'stripe:<evt_id>'`) | (none: in-database) | `error` | `server` | `finance.settle_card_payment` |
| `finance.claim_due_deposit_rules` — an unbound scheduled-deposit run closed without being re-sent (`client_id = 'deposit:<payment id>'`; `data.reason` = `unbound_expired` / `unbound_canceled`) | (none: in-database) | `error` · `warn` | `server` | `finance.claim_due_deposit_rules` |

A reconciliation row is one drifted wallet: `client_id` is `reconcile:<run id>` and `data` carries
the wallet and its three figures (see [finance Functions.md § Ledger integrity](../finance/Functions.md#ledger-integrity-decision-186)).
A retention sweep may remove old rows; a drift that persists is re-reported by the next night's run.

| Column                                                         | Meaning                                                                                                                                  |
| :------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `client_id`                                                    | `LogEntry.id` (a correlation handle, never trusted as identity); `<pageViewId>:<metric>` for vitals.                                     |
| `level`                                                        | CHECK `warn` · `error` · `metric`. The logger levels `debug` · `info` · `network` are dropped by the service before insert.              |
| `message`                                                      | The log line; for vitals a readable summary, e.g. `LCP 2481ms (good)`.                                                                   |
| `occurred_at`                                                  | Client event time. Untrusted: a non-finite value or one more than a day ahead becomes the receipt time.                                  |
| `method` · `url` · `status` · `duration_ms` · `request` · `response` | Network context of a failed request (integers rounded).                                                                            |
| `data`                                                         | Structured payload. Vitals: `{ name, value, rating, navigationType }`, where CLS is unitless and LCP/INP are ms. Server errors: `{ name, stack }` (stack capped at 8,000 chars). |
| `path` · `user_agent` · `release`                              | `LogBatchMeta`, copied onto every row of a batch.                                                                                        |
| `user_id`                                                      | The signed-in writer, NULL when anonymous (the normal case). `ON DELETE SET NULL`.                                                       |
| `created_at`                                                   | Server receipt time: the only column retention and ordering may key on.                                                                  |

Append-only; the one legitimate hard delete is a retention sweep run as the service role (none is
scheduled yet).

## `ops.scheduled_jobs` — the job registry (Decision #203)

Migration [`00000013_tables_ops.sql`](../../../supabase/migrations/00000013_tables_ops.sql); functions
[Functions.md](Functions.md) (`00001650`); triggers `00001897`; RLS [Policies.md](Policies.md); rows
seeded by `00005060`. Zod SSOT: `@projective/types/ops` (`ScheduledJobSchema`). Every recurring job is
one row, and the row IS the pg_cron job: an insert, update or delete is applied to `cron.job` in the
same transaction. The job table (cadence, owner, idempotency) is in `SYSTEM_ARCHITECTURE.md`
§Scheduled jobs.

| Column        | Meaning                                                                                                                                  |
| :------------ | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | PK and the pg_cron job name. CHECK kebab-case.                                                                                           |
| `kind`        | CHECK `sql` · `http`.                                                                                                                    |
| `schedule`    | Five-field cron, UTC. **The configurable cadence**: an `UPDATE` reschedules the job; pg_cron refuses an invalid expression with the write. |
| `command`     | `sql` only: one `SELECT` (CHECK `^SELECT [^;]+;?$`), so `ops.run_job` can return its result.                                             |
| `path`        | `http` only: the app route with its query (CHECK `^/api/\S*$`), e.g. `/api/finance/cron/deposits?limit=50`.                             |
| `secret_name` | `http` only: the bearer's Vault secret name, which is also the app's env key (CHECK `^[A-Z][A-Z0-9_]*$`).                                 |
| `description` | One sentence for `deno task cron:run --list` and admins.                                                                                 |
| `enabled`     | `false` unschedules the job; the row stays, and a manual run still works.                                                                |
| `created_at` · `updated_at` | `updated_at` is set by `trg_scheduled_jobs_touch`.                                                                                |

## `ops.http_job_dispatches` — one row per pg_net request (Decision #203)

Same migration; partial index `idx_http_job_dispatches_unsettled` (`dispatched_at` WHERE unsettled) and
`idx_http_job_dispatches_job` (`job_name, dispatched_at DESC`) in `00004002`. Zod: `HttpJobDispatchSchema`.
Written by `ops.fn_dispatch_http_job` when it queues a POST, settled once by
`ops.fn_settle_http_dispatches` from `net._http_response` (pg_net keeps a response for 6 hours). Never
deleted.

| Column          | Meaning                                                                                       |
| :-------------- | :-------------------------------------------------------------------------------------------- |
| `job_name`      | FK `ops.scheduled_jobs(name)`, `ON UPDATE CASCADE ON DELETE RESTRICT`.                        |
| `request_id`    | pg_net's request id (`net.http_request_queue.id` = `net._http_response.id`).                  |
| `dispatched_at` | When the POST was queued (pg_net sends it when that transaction commits).                     |
| `settled_at`    | When the outcome was copied; `NULL` while pending.                                            |
| `status_code`   | The route's HTTP status; `NULL` on a transport error, a timeout or no response.               |
| `error`         | pg_net's error, `timed out`, or `no response recorded within the pg_net TTL` (after 7 hours). |
