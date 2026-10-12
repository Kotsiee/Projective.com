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
