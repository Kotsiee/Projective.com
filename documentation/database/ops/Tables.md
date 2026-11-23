# ops: Tables

_Not yet documented._ This file is scaffolded to match the domain/kind structure described in
[../README.md](../README.md), but no Tables content has been written for the `ops` schema yet.

See `brain2.md`'s Database section for the general migration-numbering and RLS conventions this
domain follows once populated.

## `ops.reports` — the one review sink (T&S R1; Decisions #148, #340 T4, #496, #533)

Migration [`00000013_tables_ops.sql`](../../../supabase/migrations/00000013_tables_ops.sql) (region
`[reports]`); doors [Functions.md](Functions.md) (`00001665`); guard trigger `trg_reports_guard`
(`00001897`); RLS [Policies.md](Policies.md); indexes in `00004002`. Zod SSOT:
`@projective/types/ops` (`reports.ts`: `ReportRowSchema`, `REPORT_REASONS`, `REPORT_SUBJECT_ROWS`,
`ReportSnapshotSchema`, `AutomatedEvidenceSchema`, `ReportNoticeSchema`). People's reports, detector
findings and copyright notices land in one table for a reviewer (R3) to resolve. Written only by the
definer doors, called by `ReportsBackendService` as the service role; a report is a record — the guard
refuses any change but its resolution, for every role, and no role holds DELETE (only the erasure
chain, a definer, removes one). Lifecycle: [PRODUCT_MANAGEMENT.md](../../PRODUCT_MANAGEMENT.md)
§3.5, "Report".

| Column | Meaning |
| :----- | :------ |
| `id` | PK, `gen_random_uuid()`. Never a route (Decision #88). |
| `source` | CHECK `user` · `automated` · `notice` (#340 T4, #496 (A)). |
| `reporter_user_id` | The filing person: set exactly when `source = 'user'`, checked **on INSERT** by `ops.fn_guard_report`, not by a CHECK, because FK `auth.users(id)` `ON DELETE SET NULL` must let a report outlive its reporter (#496 (d)). Never projected to the reported person. |
| `detector` | CHECK `nudenet` · `ocr` · `sightengine` · `presidio` · `fragmentation`; set exactly when `source = 'automated'`. |
| `reported_subject_type` | CHECK `project_message` · `dm_message` · `stage_submission` · `file` · `profile` · `listing` · `service` · `project` · `review` (#487 (d)) · `workload_report` (PROJECTS EX4). |
| `reported_subject_id` | The subject row. Deliberately not an FK: subjects span schemas and the report outlives the subject. |
| `reported_user_id` | The author R4 penalises. FK `auth.users(id)` `ON DELETE SET NULL`. |
| `reason` | CHECK the closed vocabulary (Decision #533): `contact_leakage` · `evasion_fragmentation` · `harassment` · `hate` · `sexual_content` · `child_safety` · `violence` · `illegal_content` · `spam_or_scam` · `impersonation` · `intellectual_property` · `other`. `evasion_fragmentation` is the fragmentation detector's alone (`ops.file_report` refuses it). |
| `evidence_snapshot` | jsonb object, ≤ 64 KB. A user row: the stored row read under the reporter's JWT, `{subjectType, capturedAt, row}` (`ReportSnapshotSchema`, one shape per subject type). An automated row: ids, categories and scores only (`AutomatedEvidenceSchema`, strict). Immutable. |
| `notice` | jsonb object, set exactly when `source = 'notice'`, and then `reason = 'intellectual_property'` (CHECK `reports_notice_check`). A Zod shell (`ReportNoticeSchema`) whose fields are counsel's; MARKETPLACE SC8 fills it and files notice rows through its own door. Immutable. |
| `status` | CHECK `pending` · `dismissed` · `actioned`, `DEFAULT 'pending'`. Moves only pending → dismissed \| actioned, once. |
| `resolution_notes` · `resolved_by` · `resolved_at` | NULL while pending; leaving pending needs notes and a time (CHECK `reports_resolution_check`). `resolved_by` (FK `auth.users`, `ON DELETE SET NULL`) is set by R3's door. |
| `created_at` | `DEFAULT now()`. |

Indexes (`00004002`): `idx_reports_status_created` (the reviewer's queue), `idx_reports_reported_user`
(the author's history), `idx_reports_reporter_created` (the daily cap) and the partial unique
`uq_reports_pending_per_reporter` (`reporter_user_id, reported_subject_type, reported_subject_id`
WHERE pending), which holds one pending report per reporter and subject against a race. A reported
file's bytes are copied to the service-only `evidence` bucket ([files Storage.md](../files/Storage.md)).

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
| The job registry's functions (`ops.fn_log_scheduler_event` — Decision #203), including the staleness pass's `stale` (error) and `cadence_unknown` (warn) rows (OPS5) | (none: in-database) | `warn` · `error` | `server` | `ops.scheduler` |
| The webhook services, through `ops.fn_record_webhook_failure` (OPS5): one row per provider, outcome class and minute, `client_id = 'webhook:<provider>:<class>:minute'`, `data` = `{provider, class, status, reason, count, event_id?, event_type?}`. No alert rule matches these | the four webhook routes | `warn` | `server` | `webhook.<provider>` |
| `ops.fn_watch_webhooks` (OPS5): a provider's burst, `client_id = 'webhook:<provider>:failing'` (error) or `'webhook:<provider>:signature'` (warn), `data` = `{provider, reason, failures, threshold, window_minutes, last_status}` | (none: in-database) | `warn` · `error` | `server` | `ops.webhooks` |
| `ops.fn_raise_alert` — the alert drill (OPS5, OPS7), `client_id = 'alert:drill'` | (none: in-database) | `warn` | `server` | `test` |
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

Append-only, with one exception: within its minute, `ops.fn_record_webhook_failure` raises a
`webhook.<provider>` row's `data.count` (and its message) instead of adding a row, so a flood of
forged posts costs a row a minute (OPS5). The one legitimate hard delete is a retention sweep run as
the service role (none is scheduled yet).

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

## `ops.contact_requests` — what `/contact` files (Decision #276)

Migration [`00000013_tables_ops.sql`](../../../supabase/migrations/00000013_tables_ops.sql) (region
`[contact]`); functions [Functions.md](Functions.md) (`00001655`); guard trigger `00001897`; RLS
[Policies.md](Policies.md); indexes in `00004002`. Zod SSOT: `@projective/types/contact`
(`ContactRequestRowSchema`, `ContactSubmissionSchema`, `CONTACT_PAYLOAD_KEYS`). Written only by
`ops.submit_contact_request`, called by `ContactBackendService` as the caller (anon for a guest, the
sender's own JWT when signed in) behind `CONTACT_BACKEND_LIVE`. A request is a record: never deleted,
and nothing but `status` (and `updated_at`) changes after insert — `ops.fn_guard_contact_request`
refuses every other change for every role, except `user_id → NULL` on account erasure. Its lifecycle
is the unified machine ([PRODUCT_MANAGEMENT.md](../../PRODUCT_MANAGEMENT.md) §3.5, "Contact request").

| Column       | Meaning                                                                                                                                                                                                                                                            |
| :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | PK, `gen_random_uuid()`. Never a route (Decision #88).                                                                                                                                                                                                             |
| `reference`  | UNIQUE. The human reference the sender is shown and quotes back: `CT-XXXX-XXXX` over Crockford base32 (CHECK `contact_requests_reference_check`), minted by `ops.fn_contact_reference()` and re-drawn on a collision.                                               |
| `intent`     | CHECK `sales` · `support` · `dispute` · `security` (`CONTACT_INTENTS`).                                                                                                                                                                                            |
| `status`     | CHECK `backlog` · `in_progress` · `complete` · `archived`, `DEFAULT 'backlog'`. Moves only along the guard's transitions (`CONTACT_STATUS_TRANSITIONS`).                                                                                                           |
| `email`      | The reply address, lower-cased (CHECK: ≤ 254, address-shaped, lower case). `NULL` only on an anonymous report.                                                                                                                                                      |
| `user_id`    | The signed-in sender (`auth.uid()` at write time), when not anonymous. FK `auth.users(id)` `ON DELETE SET NULL` — the identity, not the profile: an account that has not finished `/join` has no `org.users_public` row and is still a signed-in sender. |
| `anonymous`  | `true` only for a security report with no address and no account (CHECK `contact_requests_anonymous_check`); otherwise `email` is required.                                                                                                                       |
| `payload`    | The intent's own fields, as written: `name`, `message`, and per intent `company` · `companySize` · `budget` (sales), `accountEmail` · `topic` (support), `referenceId` · `engagement {slug,title,format}` (dispute), `reportType` (security). CHECK: an object with a 1–5,000-character `message`, ≤ 16 KB. Not masked through `comms.mask_pii` — only operators read it (Decision #147). |
| `created_at` · `updated_at` | `updated_at` is stamped by the guard on every (status) change.                                                                                                                                                                                       |

Indexes (`00004002`): `idx_contact_requests_status_created` (the operator queue) and four partial
indexes behind the writer's hourly ceilings — `idx_contact_requests_email_created` (WHERE `email`
IS NOT NULL), `idx_contact_requests_user_created` (WHERE `user_id` IS NOT NULL),
`idx_contact_requests_guest_created` (WHERE `user_id` IS NULL AND NOT `anonymous`) and
`idx_contact_requests_anonymous_created` (WHERE `anonymous`).

## `ops.contact_request_attachments` — a request's files (Decision #276)

Same migration and region. One row per attached file: PK `(request_id, file_id)`, UNIQUE `file_id`
(a file is attached to one request at most), both FKs `ON DELETE RESTRICT` — `request_id` →
`ops.contact_requests(id)`, `file_id` → `files.items(id)`. Linked only by
`ops.submit_contact_request`, and only for the caller's own `files.items` rows with
`purpose = 'contact'`, `status = 'uploaded'` and no `deleted_at` (the contact upload pipeline's
output, in the private `contact` bucket — [files Storage.md](../files/Storage.md)). Never updated or
deleted. A link is what lets operators read a file (`files.fn_can_read`, the `contact` bucket
policy): an unsent contact upload has none, and is taken back by Remove
(`ops.discard_contact_attachment`) or the hourly sweep (`ops.fn_claim_stale_contact_attachments`).

## `ops.alert_rules` · `ops.alert_deliveries` · `ops.alert_seen` — money, job and webhook alerts (MR4, Decision #461; OPS5)

Migration `00000013` (region `[alerts]`); functions `00001660`; triggers `00001897`; the rules seeded
in `00005065`. RLS on, no client policy, no client grant: the claim and the record are service-role
definers, and operators read through `ops.read_alert_deliveries` (`/admin/ledger`'s Alerts section).
Zod: `@projective/types/ops` (`alerts.ts`).

| Table | Purpose & key columns |
| :---- | :-------------------- |
| `ops.alert_rules` | What the sweep watches, one channel per row. `kind` `level` (every server row whose `scope` is LIKE `scope_pattern` at `min_level` `warn` / `error` or above; a `metric` row never alerts) or `silence` (a dead-man switch: no server row of the scope for `max_silence`, counted from the rule's `created_at` while the scope never wrote one). `channel` `webhook` / `email` / `in_app` (a notice to every operator, OPS5); `dedupe_window` (≥ 5 minutes); `enabled`; `description`. Unique on (`kind`, `scope_pattern`, `channel`), so a scope's levels share one window per channel and a writer that must repeat less often throttles itself. Seeded in `00005065`, each on all three channels unless named: `finance.%` at `error` (36 h window); `ops.scheduler` at `warn` (1 h: every failure, stale job and configuration skip; the skips and stale rows are written at most daily); `ops.webhooks` at `warn` by webhook and at `error` by email and in-app (1 h: a failing provider everywhere, a signature burst by webhook only); `finance.reconcile_wallets` and `finance.conservation` silent for 26 h; `test` at `warn` (5 minutes, the drill). No rule matches `webhook.<provider>`. |
| `ops.alert_deliveries` | One alert on one channel (`webhook` / `email` / `in_app`): a group (`group_key` = `scope` + `:` + `fingerprint`) inside one dedupe window, however many rows it folded (`count`, `first_seen` … `last_seen`, `window_ends_at`). `sample` holds the newest row's figures and 8-character ids only (`ops.fn_alert_sample`), never its message. `status` `pending` → `sent` (`sent_at` exactly when sent); a failed send stays `pending` with `attempts`, `last_error` (a status or class, ≤ 120 characters) and a backed-off `next_attempt_at`; `lease_until` keeps two sweeps from sending one alert twice. Never deleted (`trg_alert_deliveries_keep`, `trg_alert_deliveries_no_truncate`). |
| `ops.alert_seen` | The claim's cursor: (`log_entry_id`, `rule_id`) → `delivery_id`, one row per log row each rule folded, so a re-run folds nothing twice. Never deleted. |
