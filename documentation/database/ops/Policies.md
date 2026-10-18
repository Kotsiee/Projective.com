# ops: Policies

_Not yet documented._ This file is scaffolded to match the domain/kind structure described in
[../README.md](../README.md), but no Policies content has been written for the `ops` schema yet.

See `brain2.md`'s Database section for the general migration-numbering and RLS conventions this
domain follows once populated.

## `ops.log_entries`

RLS enabled in `00002001`; policies in `00002019_policies_security_ops.sql`; grants in `00002520`
(`INSERT` to `anon` and `authenticated`, `SELECT` to `authenticated`, `ALL` to `service_role`).
`00002500` grants `USAGE ON SCHEMA ops` to all three roles. That grant confers no table privilege:
`ops.admin_users` stays revoked.

| Policy                              | Command | Role                    | Rule                                        |
| :---------------------------------- | :------ | :---------------------- | :------------------------------------------ |
| Insert own or anonymous log entries | INSERT  | `anon`, `authenticated` | `user_id IS NULL OR user_id = auth.uid()`   |
| Admins read log entries             | SELECT  | `authenticated`         | `security.is_admin()`                       |

No UPDATE or DELETE policy. A writer can attribute a row to themselves or to nobody, never to
someone else, and only an admin can read diagnostics back.

## `ops.scheduled_jobs` · `ops.http_job_dispatches` (Decision #203)

RLS enabled in `00002001`; policies in `00002019`; grants in `00002520`: `SELECT` to `authenticated` on both,
`SELECT, UPDATE` on `scheduled_jobs` and `SELECT` on `http_job_dispatches` to `service_role`.

| Policy                          | Table                 | Command | Role            | Rule                  |
| :------------------------------ | :-------------------- | :------ | :-------------- | :-------------------- |
| Admins read scheduled jobs      | `scheduled_jobs`      | SELECT  | `authenticated` | `security.is_admin()` |
| Admins read http job dispatches | `http_job_dispatches` | SELECT  | `authenticated` | `security.is_admin()` |

No client write policy. A cadence changes through the service role or SQL (the registry trigger
reschedules pg_cron in the same transaction); new jobs arrive with a migration. Dispatch rows are
written only by the definer dispatcher.

## `ops.contact_requests` · `ops.contact_request_attachments` (Decision #276)

RLS enabled in `00002001`; policies in `00002019`; grants in `00002520`: `SELECT` to `authenticated`
and `service_role` on both, and **no** `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE` for any role.

| Policy                                  | Table                         | Command | Role            | Rule                  |
| :-------------------------------------- | :---------------------------- | :------ | :-------------- | :-------------------- |
| Admins read contact requests            | `contact_requests`            | SELECT  | `authenticated` | `security.is_admin()` |
| Admins read contact request attachments | `contact_request_attachments` | SELECT  | `authenticated` | `security.is_admin()` |

No write policy at all. Requests arrive only through the definer door `ops.submit_contact_request`
(callable by `anon` and `authenticated`), and their status moves only through
`ops.set_contact_request_status` (operators). A sender never reads a request back — they keep the
reference they were shown. The attachments' bytes sit in the private `contact` bucket, whose one
storage policy is operator read ([files Policies.md](../files/Policies.md), `00002017`), and their
`files.items` rows are readable by their uploader and, through `files.fn_can_read`'s contact arm, by
operators. Probe: [`supabase/probes/contact_requests.sql`](../../../supabase/probes/contact_requests.sql).
