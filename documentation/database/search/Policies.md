# search: Policies

_Not yet documented._ This file is scaffolded to match the domain/kind structure described in
[../README.md](../README.md), but no Policies content has been written for the `search` schema yet.

See `brain2.md`'s Database section for the general migration-numbering and RLS conventions this
domain follows once populated.

## `search.query_logs`

| Policy                        | Command | Rule                                                            |
| :---------------------------- | :------ | :-------------------------------------------------------------- |
| Users view own query logs     | SELECT  | `user_id = auth.uid()`                                          |
| Users insert own query logs   | INSERT  | `user_id = auth.uid()` or a guest (`auth.uid() IS NULL`)        |

The app writes it only through the `SECURITY DEFINER` `search.fn_log_query`, so the INSERT policy
governs direct PostgREST writes, not the app path.

## `search.interest_events`

| Policy                       | Command | Rule                                     |
| :--------------------------- | :------ | :--------------------------------------- |
| Insert own interest events   | INSERT  | `user_id = auth.uid() OR user_id IS NULL` |
| Read own interest events     | SELECT  | `user_id = auth.uid()`                   |

Grants: `INSERT` to `anon` and `authenticated`, `SELECT` to `authenticated`, `ALL` to
`service_role`. There is no UPDATE or DELETE policy: rows are append-only. A writer can attribute a
row to themselves or to nobody, never to someone else.
